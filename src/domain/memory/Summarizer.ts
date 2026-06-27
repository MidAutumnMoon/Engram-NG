/**
 * SummarizerService — 剧情总结状态服务 (精简后)。
 *
 * V2.3: 自动触发 + 手动触发已迁移到 IngestionService。
 * 本服务仅保留 dashboard 所需的状态查询 (getStatus) + chat 切换时的缓存重置。
 * triggerSummary / 联动精简 / 配置管理 等已移除。
 */

import { chatManager } from "@/data/ChatManager.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { Logger } from "@/logger/Logger.ts";
import { getSTContext, onTavernEvent } from "@/sillytavern/context.ts";
import type { ChatContext, SummarizerStatus } from "./types.ts";

class SummarizerService {
    private currentChatId: string | null = null;
    private isRunning = false;
    private unsubscribeChat: (() => void) | null = null;

    // 缓存最后处理的楼层，用于 dashboard 同步读取
    private _lastProcessedFloor: number = 0;

    private chatContext: ChatContext | null = null;

    /** Inject chat context (called by bootstrap). */
    setChatContext(ctx: ChatContext): void {
        this.chatContext = ctx;
    }

    // ==================== 楼层计算 ====================

    private getCurrentFloor(): number {
        const context = getSTContext();
        if (!context.chat) return 0;
        return context.chat.length;
    }

    private getCurrentChatId(): string | null {
        return getSTContext().chatId || null;
    }

    // ==================== 生命周期 ====================

    /**
     * 启动服务。仅订阅 chat_id_changed 以重置内部缓存。
     * message_received 触发由 IngestionService 处理。
     */
    start(): void {
        if (this.isRunning) {
            Logger.warn("Summarizer", "服务已在运行");
            return;
        }
        this.initializeForCurrentChat();
        this.unsubscribeChat = onTavernEvent(
            "chat_id_changed",
            this.handleChatChanged.bind(this),
        );
        this.isRunning = true;
        Logger.info("Summarizer", "服务已启动 (仅 chat_id_changed 订阅)");
    }

    stop(): void {
        if (this.unsubscribeChat) {
            this.unsubscribeChat();
            this.unsubscribeChat = null;
        }
        this.isRunning = false;
        Logger.info("Summarizer", "服务已停止");
    }

    /**
     * 为当前聊天初始化缓存（从 DB 读取统一游标）。
     */
    async initializeForCurrentChat(): Promise<void> {
        const chatId = this.getCurrentChatId();
        this.currentChatId = chatId;
        this._lastProcessedFloor = 0;
        try {
            const state = await chatManager.getState();
            this._lastProcessedFloor = getProcessedFloor(state);
        } catch (error) {
            Logger.warn("Summarizer", "读取游标失败，使用默认值 0", error);
        }
    }

    private handleChatChanged(): void {
        this.initializeForCurrentChat();
    }

    // ==================== 状态查询 ====================

    /**
     * 获取当前状态（供 dashboard 使用）。
     */
    getStatus(): SummarizerStatus {
        const currentFloor = this.getCurrentFloor();
        const lastSummarized = this._lastProcessedFloor;
        return {
            currentFloor,
            historyCount: 0,
            isSummarizing: false,
            lastSummarizedFloor: lastSummarized,
            pendingFloors: Math.max(0, currentFloor - lastSummarized),
            running: this.isRunning,
        };
    }
}

/** 默认实例 */
export const summarizerService = new SummarizerService();
