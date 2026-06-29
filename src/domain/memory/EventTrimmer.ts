/**
 * EventTrimmer - IndexedDB 事件精简服务
 *
 * V0.6: 直接调用 llmAdapter，不再依赖 Extractor
 */

import { trimConfigSchema } from "@/config/types/memory.ts";
import type { TrimConfig } from "@/config/types/memory.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import type { EventNode } from "@/data/types/graph.ts";
import type { ChatDatabase } from "@/data/db.ts";
import { countTokens } from "@/sillytavern/tokens.ts";
import { toast } from "@/sillytavern/toast.ts";
import type { ChatContext } from "./types.ts";
import { runTrim } from "./pipelines/trim.ts";

interface TrimResult {
    /** 精简后的事件 */
    newEvent: EventNode;
    /** 被删除的事件数量 */
    deletedCount: number;
    /** 原始事件 ID 列表 */
    sourceEventIds: string[];
}

/**
 * 精简状态
 */
export interface TrimmerStatus {
    triggered: boolean;
    triggerType: "token" | "count";
    currentValue: number;
    threshold: number;
    pendingEntryCount: number;
    isTrimming: boolean;
}

/**
 * EventTrimmer 类
 */
class EventTrimmer {
    private config: TrimConfig;
    private isTrimming = false;

    // Phase 2.2+2.4: injected by bootstrap (init + setChatContext).
    // No SettingsManager or useMemoryStore reads remain.
    private globalPreviewEnabled = true;
    private chatContext: ChatContext | null = null;

    constructor(config?: Partial<TrimConfig>) {
        this.config = trimConfigSchema.parse(config ?? {});
    }

    /**
     * Inject resolved config. Called by bootstrap before `start()`.
     * Replaces constructor-time `getSetting()` reads.
     */
    init(config: TrimConfig, globalPreviewEnabled: boolean): void {
        this.config = config;
        this.globalPreviewEnabled = globalPreviewEnabled;
    }

    /**
     * Inject chat context. Called by bootstrap at startup and on `CHAT_CHANGED`.
     * Replaces `useMemoryStore.getState()` reads.
     */
    setChatContext(ctx: ChatContext): void {
        this.chatContext = ctx;
    }

    private getDb(): ChatDatabase | null {
        return this.chatContext?.db ?? null;
    }

    /**
     * 更新配置 (in-memory only; persistence is the caller's job — Phase 2.4 step F)
     */
    updateConfig(config: Partial<TrimConfig>): void {
        this.config = trimConfigSchema.parse({ ...this.config, ...config });
    }

    private getEffectiveConfig(override: Partial<TrimConfig> = {}): TrimConfig {
        return trimConfigSchema.parse({ ...this.config, ...override });
    }

    // ==================== 直接 DB 查询 (Phase 2.2: 原 memoryStore 包装内联) ====================

    /**
     * 获取可合并的事件 (level 0, 未归档, 未锁定), 排除最近 N 条
     * 从 state/memory/slices/eventSlice.ts 原样内联。
     */
    private async getEventsToMergeFromDb(
        db: ChatDatabase,
        keepRecentCount: number,
    ): Promise<EventNode[]> {
        try {
            const events = await db.events.orderBy("timestamp").toArray();
            const eligible = events.filter((e) =>
                e.level === 0 && !e.is_archived && !e.is_locked
            );
            if (eligible.length <= keepRecentCount) return [];
            return eligible.slice(0, eligible.length - keepRecentCount);
        } catch (error) {
            Logger.error(LogModule.MEMORY_TRIM, "getEventsToMergeFromDb 失败", {
                error,
            });
            return [];
        }
    }

    /**
     * 统计事件 token 数与活跃事件数。
     * 从 state/memory/slices/eventSlice.ts 原样内联。
     */
    private async countEventTokensFromDb(
        db: ChatDatabase,
    ): Promise<{
        totalTokens: number;
        eventCount: number;
        activeEventCount: number;
    }> {
        try {
            const events = await db.events.toArray();
            if (events.length === 0) {
                return { totalTokens: 0, eventCount: 0, activeEventCount: 0 };
            }
            const activeEvents = events.filter((e) =>
                e.level === 0 && !e.is_archived
            );
            const allSummaries = activeEvents.map((e) => e.summary).join(
                "\n\n",
            );
            const totalTokens = countTokens(allSummaries);
            return {
                activeEventCount: activeEvents.length,
                eventCount: events.length,
                totalTokens,
            };
        } catch (error) {
            Logger.error(LogModule.MEMORY_TRIM, "countEventTokensFromDb 失败", {
                error,
            });
            return { activeEventCount: 0, eventCount: 0, totalTokens: 0 };
        }
    }

    /**
     * 检查是否可以触发精简
     * V1.0.5: 使用 getEventsToMerge 而非 getAllEvents，确保只统计活跃事件
     */
    async canTrim(): Promise<
        { canTrim: boolean; eventCount: number; pendingCount: number }
    > {
        const db = this.getDb();
        if (!db) {
            return { canTrim: false, eventCount: 0, pendingCount: 0 };
        }
        const config = this.getEffectiveConfig();
        const eventsToMerge = await this.getEventsToMergeFromDb(
            db,
            config.keepRecentCount ?? 3,
        );
        const { activeEventCount } = await this.countEventTokensFromDb(db);

        return {
            canTrim: eventsToMerge.length >= 2, // 至少需要 2 条才能合并
            eventCount: activeEventCount,
            pendingCount: eventsToMerge.length,
        };
    }

    /**
     * 执行精简
     * 将多条旧事件合并为 1 条压缩后的事件
     */
    async trim(manual = false): Promise<TrimResult | null> {
        if (this.isTrimming) {
            Logger.warn(LogModule.MEMORY_TRIM, "正在执行精简，跳过本次触发");
            return null;
        }

        this.isTrimming = true;

        try {
            const config = this.getEffectiveConfig();
            const result = await runTrim({
                keepRecentCount: config.keepRecentCount,
                previewEnabled: this.globalPreviewEnabled &&
                    (config.previewEnabled ?? true),
                trigger: manual ? "manual" : "auto",
            });

            // runTrim returns null when there aren't enough events to merge
            // (auto-trigger case) — equivalent to the old skipTrimming early-out.
            return result;
        } catch (error) {
            const errorMsg = error instanceof Error
                ? error.message
                : String(error);
            if (errorMsg === "UserCancelled") {
                Logger.info(LogModule.MEMORY_TRIM, "精简被用户取消");
                return null;
            }
            Logger.error(LogModule.MEMORY_TRIM, "精简流程异常", {
                error: errorMsg,
            });
            if (manual) {
                toast("error", `精简异常: ${errorMsg}`, "Engram 错误");
            }
            return null;
        } finally {
            this.isTrimming = false;
        }
    }

    /**
     * 获取配置
     */
    getConfig(): TrimConfig {
        return this.getEffectiveConfig();
    }

    /**
     * 获取状态 (UI 适配)
     */
    async getStatus() {
        const config = this.getEffectiveConfig();
        const triggerType = config.trigger;
        const { tokenLimit } = config;
        const { countLimit } = config;

        const db = this.getDb();
        if (!db) {
            return {
                currentValue: 0,
                isTrimming: this.isTrimming,
                pendingEntryCount: 0,
                threshold: triggerType === "token" ? tokenLimit : countLimit,
                triggerType,
                triggered: false,
            };
        }

        // V1.0.5: 使用 activeEventCount 而非 eventCount
        const { totalTokens, activeEventCount } = await this
            .countEventTokensFromDb(db);

        // 触发检测
        let currentValue = 0;
        let threshold = 0;

        if (triggerType === "token") {
            currentValue = totalTokens;
            threshold = tokenLimit;
        } else {
            currentValue = activeEventCount;
            threshold = countLimit;
        }

        let triggered = currentValue >= threshold;

        // 待合并条目 —— 口径与 canTrim 一致
        const eventsToMerge = await this.getEventsToMergeFromDb(
            db,
            config.keepRecentCount ?? 3,
        );
        const pendingEntryCount = eventsToMerge.length;
        triggered = triggered && pendingEntryCount >= 2;

        Logger.debug(LogModule.MEMORY_TRIM, "精简状态检查", {
            currentValue,
            enabled: config.enabled,
            keepRecentCount: config.keepRecentCount,
            pendingEntryCount,
            threshold,
            triggerType,
            triggered,
        });

        return {
            currentValue,
            isTrimming: this.isTrimming,
            pendingEntryCount,
            threshold,
            triggerType,
            triggered,
        };
    }
}

/** 默认实例 */
export const eventTrimmer = new EventTrimmer();
