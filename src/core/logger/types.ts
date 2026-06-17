/**
 * Logger 类型定义
 */

/**
 * 日志级别枚举
 */
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

/**
 * 日志级别显示配置
 */
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

/**
 * 日志条目接口
 */
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

/**
 * 日志配置接口
 */
export interface LoggerConfig {
    maxEntries: number; // 最大存储条数
    minLevel: LogLevel; // 最低显示级别
}

/**
 * 默认配置
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
    maxEntries: 5000,
    minLevel: LogLevel.DEBUG,
};
