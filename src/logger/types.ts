export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    SUCCESS = 2,
    WARN = 3,
    ERROR = 4,
}

/**
 * 日志类别
 *
 * 统一存储后，用 category 区分不同子系统：
 * - `app`    通用应用日志（Logger.debug/info/warn/error 默认类别）
 * - `model`  LLM 调用日志（ModelLogger 门面写入）
 * - `recall` RAG 召回日志（RecallLogService 门面写入）
 *
 * DevLog 三个 Tab 按此字段过滤。
 */
export type LogCategory = "app" | "model" | "recall";

export const LogLevelConfig: Record<
    LogLevel,
    { label: string; color: string }
> = {
    [LogLevel.DEBUG]: { color: "#6c757d", label: "DEBUG" },
    [LogLevel.INFO]: { color: "#17a2b8", label: "INFO" },
    [LogLevel.SUCCESS]: { color: "#28a745", label: "OK" },
    [LogLevel.WARN]: { color: "#ffc107", label: "WARN" },
    [LogLevel.ERROR]: { color: "#dc3545", label: "ERROR" },
};

export interface LogEntry {
    id: string;
    timestamp: number;
    level: LogLevel;
    module: string; // 如 'CORE/Pipeline', 'UI/GraphView'
    category: LogCategory;
    message: string;
    data?: unknown; // 可选的附加数据（展开查看）
    /** 关联 ID——用于链接相关条目（如 model 的 send/receive 对） */
    correlationId?: string;
    /** 生命周期状态（主要用于 category="model"） */
    status?: "pending" | "success" | "error" | "cancelled";
}

export interface RecallResultItem {
    eventId: string;
    summary: string;
    category: string;
    embeddingScore: number; // 向量相似度 [0-1]
    keywordScore?: number; // 关键词匹配分数 [0.8 / 0.9]
    rerankScore?: number; // Rerank 分数 [0-1]
    hybridScore?: number; // 混合分数
    isTopK: boolean; // 是否进入 TopK
    isReranked: boolean; // 是否通过 Rerank
    sourceFloor?: number; // 来源楼层
    reason?: string; // Agentic 召回理由
}

export interface RecallStats {
    totalCandidates: number;
    topKCount: number;
    rerankCount: number;
    latencyMs: number;
}

export interface RecallLogEntry {
    id: string;
    timestamp: number;
    query: string;
    preprocessedQuery?: string;
    mode: "embedding" | "hybrid" | "agentic"; // (Disabled in V0.8.5)
    results: RecallResultItem[];
    recalledEntities?: any[]; // V1.4: 被激活的实体列表
    stats: RecallStats;
}
