import type { ChatDatabase } from "@/data/db.ts";

/**
 * Chat context injected into memory services.
 *
 * Phase 2.2+2.4: replaces `useMemoryStore.getState()` reads inside `modules/`.
 * Services store this on `setChatContext()` and use `db` directly for Dexie queries.
 * `bootstrap.ts` resolves the current chat and dispatches on startup + `CHAT_CHANGED`.
 */
export interface ChatContext {
    chatId: string;
    db: ChatDatabase;
}

// SummarizerConfig, TriggerMode, WorldbookBindMode, and DEFAULT_SUMMARIZER_CONFIG
// moved to config/types/memory.ts (single source of truth via Zod schema).
// Re-exported here so existing domain-layer imports (`./types.ts`) keep working.
export type {
    SummarizerConfig,
    TriggerMode,
    WorldbookBindMode,
} from "@/config/types/memory.ts";
export { DEFAULT_SUMMARIZER_CONFIG } from "@/config/types/memory.ts";

/** 总结结果 */
export interface SummaryResult {
    /** 唯一标识 (V4 新增) */
    id?: string;

    /** 总结内容 */
    content: string;
    /** Token 数量 */
    tokenCount: number;
    /** 来源楼层范围 [起始, 结束] */
    sourceFloors: [number, number];
    /** 生成时间戳 */
    timestamp: number;
    /** 是否已写入世界书 */
    writtenToWorldbook: boolean;
    /** 世界书条目 ID（如果已写入） */
    worldbookEntryId?: string;
}

/** Summarizer 状态 */
export interface SummarizerStatus {
    /** 是否正在运行 */
    running: boolean;
    /** 当前楼层计数 */
    currentFloor: number;
    /** 上次总结时的楼层 */
    lastSummarizedFloor: number;
    /** 待处理楼层数 */
    pendingFloors: number;
    /**
     * 触发模式
     * auto: 自动触发 (基于楼层或 V2 Pipeline)
     * manual: 仅手动
     */
    mode?: "auto" | "manual";

    /** 总结历史记录数 */
    historyCount: number;
    /** 是否正在执行总结 */
    isSummarizing: boolean;
}
