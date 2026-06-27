/**
 * SummarizerService - 剧情总结核心服务
 */

import { getSetting, setSetting } from "@/config/settings.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { Logger } from "@/logger/Logger.ts";
import { eventTrimmer } from "@/domain/memory/EventTrimmer.ts";
import { getSTContext, onTavernEvent } from "@/sillytavern/index.ts";
import { WorldBookSlotService } from "@/domain/worldbook/index.ts";
import { useMemoryStore } from "@/state/memoryStore.ts"; // Used for setLastSummarizedFloor
import { dismissNotify, notify, notifyRunning } from "@/sillytavern/notify.ts";
import { generateShortUUID } from "@/utils/shortUUID.ts";
import { runSummary } from "@/domain/memory/pipelines/summary.ts";
import type {
    ChatContext,
    SummarizerConfig,
    SummarizerStatus,
    SummaryResult,
} from "./types.ts";
import { summarizerConfigSchema } from "@/config/types/memory.ts";

/**
 * SummarizerService 类
 * 核心总结服务
 */
class SummarizerService {
    private config: SummarizerConfig;

    private currentChatId: string | null = null;
    private isRunning = false;
    private isSummarizing = false;
    private unsubscribeMessage: (() => void) | null = null;
    private unsubscribeChat: (() => void) | null = null;
    private summaryHistory: SummaryResult[] = [];

    // 缓存最后总结的楼层，用于同步读取
    private _lastSummarizedFloor: number = 0;

    // Phase 2.2+2.4 step A: injected state (not yet wired into logic)
    private globalPreviewEnabled = true;
    private chatContext: ChatContext | null = null;

    constructor(
        config?: Partial<SummarizerConfig>,
    ) {
        const savedConfig = getSetting("summarizerConfig");
        this.config = summarizerConfigSchema.parse({
            ...savedConfig,
            ...config,
        });
    }

    /**
     * Inject resolved config. Called by bootstrap before `start()`.
     * Replaces constructor-time `getSetting()` reads.
     *
     * Phase 2.2+2.4 step A — no-op storage only; logic migration in step C.
     */
    init(config: SummarizerConfig, globalPreviewEnabled: boolean): void {
        this.config = config;
        this.globalPreviewEnabled = globalPreviewEnabled;
    }

    /**
     * Inject chat context. Called by bootstrap at startup and on `CHAT_CHANGED`.
     * Replaces `useMemoryStore.getState()` reads.
     *
     * Phase 2.2+2.4 step A — no-op storage only; logic migration in step C.
     */
    setChatContext(ctx: ChatContext): void {
        this.chatContext = ctx;
    }

    // ==================== 元数据操作 ====================
    // 注：getInfoFromChatMetadata 和 saveToChatMetadata 原方法保留作为兼容或临时使用，
    // 但主要逻辑已迁移至 WorldBookStateService。

    /**
     * 获取上次总结的楼层
     * V0.5: 优先从 memoryStore 读取
     * V0.8: 修复时序问题，直接从 chatManager.getState() 读取确保获取最新值
     */
    private async getLastSummarizedFloor(): Promise<number> {
        // 如果缓存有值且不是刚被清零，直接返回
        if (this._lastSummarizedFloor > 0) return this._lastSummarizedFloor;

        // 直接从 IndexedDB 读取，避免 memoryStore 缓存未初始化的问题
        try {
            const state = await chatManager.getState();
            // 统一摄取游标（含旧字段兜底）
            this._lastSummarizedFloor = getProcessedFloor(state);
            this.log("debug", "从 DB 读取 lastProcessedFloor", {
                value: this._lastSummarizedFloor,
            });
            return this._lastSummarizedFloor;
        } catch (error) {
            this.log(
                "warn",
                "读取 lastProcessedFloor 失败，使用默认值 0",
                error,
            );
            return 0;
        }
    }

    /**
     * 设置上次总结的楼层
     * V0.5: 保存到 memoryStore (IndexedDB)
     *
     * 统一摄取重构后写统一游标 last_processed_floor。
     */
    public async setLastSummarizedFloor(floor: number): Promise<void> {
        this._lastSummarizedFloor = floor;

        // 保存到 memoryStore（统一游标）
        const store = useMemoryStore.getState();
        await store.setLastProcessedFloor(floor);
    }

    // ==================== 楼层计算 ====================

    /**
     * 获取当前真实楼层数
     */
    private getCurrentFloor(): number {
        const context = getSTContext();
        if (!context.chat) {
            return 0;
        }
        // 楼层从0开始计数，所以 length - 1 是最后一楼的索引
        return context.chat.length;
    }

    /**
     * 获取当前聊天 ID
     */
    private getCurrentChatId(): string | null {
        const context = getSTContext();
        return context.chatId || null;
    }

    // ==================== 生命周期 ====================

    /**
     * 启动服务，开始监听事件
     *
     * V2.1: message_received 触发已迁移到 IngestionService（统一摄取）。
     * 此处仅保留 chat_id_changed 订阅以重置内部缓存；手动触发入口
     * (triggerSummary) 仍可供 UI 使用。
     */
    start(): void {
        if (this.isRunning) {
            this.log("warn", "服务已在运行");
            return;
        }

        // 初始化当前聊天状态
        this.initializeForCurrentChat();

        this.unsubscribeChat = onTavernEvent(
            "chat_id_changed",
            this.handleChatChanged.bind(this),
        );
        this.log("debug", "已订阅聊天切换事件 (message_received 由 IngestionService 处理)");

        this.isRunning = true;

        const status = this.getStatus();
        this.log("info", "服务已启动", status);
    }

    /**
     * 重置进度 (设置为 0)
     */
    public async resetProgress(): Promise<void> {
        await this.setLastSummarizedFloor(0);
        this.log("info", "进度已重置");
    }

    /**
     * 停止服务
     */
    stop(): void {
        if (this.unsubscribeMessage) {
            this.unsubscribeMessage();
            this.unsubscribeMessage = null;
        }
        if (this.unsubscribeChat) {
            this.unsubscribeChat();
            this.unsubscribeChat = null;
        }
        this.isRunning = false;
        this.log("info", "服务已停止");
    }

    /**
     * 为当前聊天初始化状态
     */
    public async initializeForCurrentChat(): Promise<void> {
        const chatId = this.getCurrentChatId();
        const currentFloor = this.getCurrentFloor();

        // 重置/加载缓存
        this.currentChatId = chatId;
        this.summaryHistory = [];
        this._lastSummarizedFloor = 0; // 先清空，迫使 reload

        const lastSummarized = await this.getLastSummarizedFloor(); // 这会更新 _lastSummarizedFloor

        this.log("info", "初始化当前聊天状态", {
            chatId,
            currentFloor,
            lastSummarizedFloor: lastSummarized,
            pendingFloors: currentFloor - lastSummarized,
        });

        // 如果从未总结过（lastSummarized=0），不要自动跳过，保持为 0，等待用户触发
        // If (lastSummarized === 0 && currentFloor > 0) {
        //     This.log('info', '首次初始化，设置基准为当前楼层', { currentFloor });
        //     Await this.setLastSummarizedFloor(currentFloor);
        // }    }
    }

    // ==================== 事件处理 ====================

    /**
     * 处理消息接收事件
     * V0.9.1: 同时检查实体提取和 Summary 的触发条件
     */
    private async handleMessageReceived(): Promise<void> {
        const currentFloor = this.getCurrentFloor();
        const lastSummarized = await this.getLastSummarizedFloor();
        const pendingFloors = currentFloor - lastSummarized;

        this.log("debug", "收到新消息", {
            currentFloor,
            lastSummarized,
            pendingFloors,
            triggerAt: this.config.floorInterval,
        });

        // 检查是否达到 Summary 触发条件
        if (pendingFloors >= this.config.floorInterval) {
            this.log("info", "达到触发条件，准备总结", {
                interval: this.config.floorInterval,
                pendingFloors,
            });
            await this.triggerSummary();
        }
    }

    /**
     * 处理聊天切换事件
     */
    private handleChatChanged(): void {
        const newChatId = this.getCurrentChatId();

        this.log("info", "聊天已切换", {
            from: this.currentChatId,
            to: newChatId,
        });

        // 重新初始化
        this.initializeForCurrentChat();
    }

    // ==================== 总结逻辑 ====================

    /**
     * 手动/自动触发总结
     */
    async triggerSummary(
        manual = false,
        rangeOverride?: [number, number],
    ): Promise<SummaryResult | null> {
        if (this.isSummarizing) {
            this.log("warn", "正在执行总结，跳过本次触发");
            return null;
        }

        if (!this.config.enabled && !manual) {
            this.log("debug", "自动总结已禁用");
            return null;
        }

        const currentFloor = this.getCurrentFloor();

        this.isSummarizing = true;

        // 创建取消信号（引用对象，传递给 WorkflowEngine）
        const cancelSignal = { cancelled: false };

        // 显示运行中通知
        const runningToast = notifyRunning(
            "总结运行中...",
            "Engram",
            () => {
                cancelSignal.cancelled = true;
                this.log("info", "用户请求取消总结");
                notify("warning", "正在取消总结...", "Engram");
            },
        );

        try {
            // 1. Calculate Range
            let startFloor: number;
            let endFloor: number;

            if (rangeOverride) {
                [startFloor, endFloor] = rangeOverride;
            } else {
                startFloor = this._lastSummarizedFloor + 1;
                const buffer = Math.max(0, this.config.bufferSize || 0);
                const interval = Math.max(1, this.config.floorInterval || 10);
                const pendingFloors = Math.max(
                    0,
                    currentFloor - this._lastSummarizedFloor,
                );
                const maxProcessableFloor = currentFloor - buffer;

                if (startFloor > maxProcessableFloor) {
                    if (manual) {
                        notify(
                            "info",
                            "暂无足够的新内容需要总结 (缓冲期内)",
                            "Engram",
                        );
                    }
                    return null;
                }

                // 稳定策略：无论自动还是手动触发，只要没有显式传入 rangeOverride，
                // 默认都按「楼层间隔 - 缓冲层」处理一个固定窗口，避免手动触发时把所有未处理楼层一次性吞掉。
                const targetProcessCount = Math.max(1, interval - buffer);
                const availableProcessCount = Math.max(
                    0,
                    maxProcessableFloor - startFloor + 1,
                );
                const processCount = Math.min(
                    targetProcessCount,
                    availableProcessCount,
                    pendingFloors,
                );

                if (processCount <= 0) {
                    if (manual) {
                        notify(
                            "info",
                            "暂无足够的新内容需要总结 (缓冲期内)",
                            "Engram",
                        );
                    }
                    return null;
                }

                endFloor = startFloor + processCount - 1;
            }

            if (startFloor > endFloor) return null;

            const range: [number, number] = [startFloor, endFloor];
            this.log("info", "准备总结", {
                autoHide: this.config.autoHide,
                bufferSize: this.config.bufferSize,
                currentFloor,
                floorInterval: this.config.floorInterval,
                lastSummarizedFloor: this._lastSummarizedFloor,
                manual,
                maxProcessableFloor: rangeOverride
                    ? endFloor
                    : currentFloor - (this.config.bufferSize || 0),
                range,
                rangeOverride: rangeOverride ?? null,
            });

            // 2. Run Workflow
            await WorldBookSlotService.init();

            const globalPreviewEnabled = getSetting("globalPreviewEnabled") ??
                true;
            const previewEnabled = globalPreviewEnabled &&
                (this.config.previewEnabled ?? true);

            const context = await runSummary(
                {
                    // episode_id: 标识本次总结 pass，stamp 到写入的事件上（同层溯源用）
                    episodeId: generateShortUUID("ep_"),
                    range: range,
                },
                {
                    autoHide: this.config.autoHide,
                    previewEnabled: previewEnabled,
                    templateId: this.config.promptTemplateId,
                },
                cancelSignal,
            );

            // 3. Construct Result (Backward Compatibility)
            const result: SummaryResult = {
                id: Date.now().toString(),
                content: context.cleanedContent || "",
                sourceFloors: range,
                timestamp: Date.now(),
                tokenCount: 0,
                writtenToWorldbook: true,
            };

            // Update local state (redundant if SaveEvent updated store, but safe)
            this._lastSummarizedFloor = endFloor;
            this.summaryHistory.push(result);

            // V1.0.5: 联动触发精简 - 总结完成后检查是否需要精简
            try {
                const trimStatus = await eventTrimmer.getStatus();
                const trimConfig = eventTrimmer.getConfig();
                const trimAvailability = await eventTrimmer.canTrim();

                this.log("debug", "自动精简触发检查", {
                    canTrim: trimAvailability.canTrim,
                    currentValue: trimStatus.currentValue,
                    enabled: trimConfig.enabled,
                    pendingEntryCount: trimStatus.pendingEntryCount,
                    threshold: trimStatus.threshold,
                    triggerType: trimStatus.triggerType,
                });

                // 只有在精简已启用、达到阈值且存在足够待合并事件时才自动执行
                if (
                    trimConfig.enabled && trimStatus.triggered &&
                    trimAvailability.canTrim
                ) {
                    this.log("info", "联动触发精简", {
                        currentValue: trimStatus.currentValue,
                        pendingEntryCount: trimStatus.pendingEntryCount,
                        threshold: trimStatus.threshold,
                        triggerType: trimStatus.triggerType,
                    });
                    // 使用 manual=false 表示自动触发
                    await eventTrimmer.trim(false);
                } else {
                    this.log("debug", "跳过自动精简", {
                        canTrim: trimAvailability.canTrim,
                        enabled: trimConfig.enabled,
                        pendingEntryCount: trimStatus.pendingEntryCount,
                        triggered: trimStatus.triggered,
                    });
                }
            } catch (trimError) {
                // 精简失败不应影响总结结果
                this.log("warn", "联动精简失败", { error: trimError });
            }

            return result;
        } catch (error) {
            const errorMsg = error instanceof Error
                ? error.message
                : String(error);

            if (errorMsg === "UserCancelled") {
                this.log("info", "总结已被用户取消");
                return null;
            }

            this.log("error", "总结执行异常", { error: errorMsg });
            notify("error", `总结异常: ${errorMsg}`, "Engram 错误");
            return null;
        } finally {
            dismissNotify(runningToast);
            this.isSummarizing = false;
        }
    }

    // ==================== 状态查询 ====================

    /**
     * 获取当前状态
     */
    getStatus(): SummarizerStatus {
        const currentFloor = this.getCurrentFloor();
        // 使用同步缓存值
        const lastSummarized = this._lastSummarizedFloor;

        return {
            currentFloor,
            historyCount: this.summaryHistory.length,
            isSummarizing: this.isSummarizing,
            lastSummarizedFloor: lastSummarized,
            pendingFloors: Math.max(0, currentFloor - lastSummarized),
            running: this.isRunning,
        };
    }

    /**
     * 刷新状态（强制重新读取）
     */
    refreshStatus(): SummarizerStatus {
        // 触发异步刷新，但返回当前缓存
        this.initializeForCurrentChat();
        return this.getStatus();
    }

    /**
     * 获取配置
     */
    getConfig(): SummarizerConfig {
        return { ...this.config };
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<SummarizerConfig>): void {
        this.config = { ...this.config, ...config };
        // 持久化保存
        setSetting("summarizerConfig", this.config);
        this.log("debug", "配置已更新并保存", this.config);
    }

    /**
     * 获取总结历史
     */
    getHistory(): SummaryResult[] {
        return [...this.summaryHistory];
    }

    /**
     * 重置基准楼层为当前楼层
     */
    async resetBaseFloor(): Promise<void> {
        const currentFloor = this.getCurrentFloor();
        await this.setLastSummarizedFloor(currentFloor);
        this.log("info", "已重置基准楼层", { currentFloor });
    }

    // ==================== 工具方法 ====================

    /**
     * 记录日志
     */
    private log(
        level: "debug" | "info" | "success" | "warn" | "error",
        message: string,
        data?: unknown,
    ): void {
        Logger[level]("Summarizer", message, data);
    }
}

/** 默认实例 */
export const summarizerService = new SummarizerService();
