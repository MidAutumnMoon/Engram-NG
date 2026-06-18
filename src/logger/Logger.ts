/**
 * Logger - 日志核心服务
 *
 * 统一的日志记录与广播。所有日志（app / model / recall）流经同一份缓存、
 * 同一份订阅链路、同一套 trim 策略。ModelLogger 与 RecallLogService 作为
 * 薄门面调用本模块的 `log()` / `clear(category)` 写入或清空。
 */

import { generateShortUUID } from "@/utils";
import type { LogModule } from "./LogModule.ts";
import type { LogCategory, LogEntry } from "./types.ts";
import { LogLevel } from "./types.ts";

// 订阅者集合。回调中若抛异常，会被 pushEntry 中的 try/catch 隔离，
// 不会影响其他订阅者。
const subscribers = new Set<(entry: LogEntry) => void>();

// 内存中的日志缓存（用于快速访问和 UI 展示）
// 注意：模块级变量在 HMR 时可能被保留，但完整页面刷新会重置。
// 本项目不使用 HMR，因此无需 HMR guard；若未来引入 HMR 需重新评估。
let logCache: LogEntry[] = [];

/**
 * Prevents logCache from growing indefinitely, ensuring memory safety and UI performance.
 */
const MAX_LOG_ENTRIES = 5000;

/**
 * 写入一条日志（内部）——共享 push/trim/notify 逻辑
 */
function pushEntry(entry: LogEntry): void {
    logCache.push(entry);

    // 容量超限时原地裁剪（splice 比 slice 省一次 5000 元素数组分配）
    if (logCache.length > MAX_LOG_ENTRIES) {
        logCache.splice(0, logCache.length - MAX_LOG_ENTRIES);
    }

    // 快照迭代：避免回调内 subscribe/unsubscribe 破坏迭代；逐个 try/catch 隔离异常
    for (const cb of [...subscribers]) {
        try {
            cb(entry);
        } catch (err) {
            // 不能用 Logger.error——会重新进入 pushEntry 导致重入
            console.error("[Logger] subscriber threw:", err);
        }
    }
}

/**
 * 写入一条 app 类别日志（兼容旧的 5 个级别 API）
 */
function writeAppLog(
    level: LogLevel,
    module: string,
    message: string,
    data?: unknown,
): string {
    const entry: LogEntry = {
        category: "app",
        data,
        id: generateShortUUID("log_"),
        level,
        message,
        module,
        timestamp: Date.now(),
    };
    pushEntry(entry);
    return entry.id;
}

/**
 * Logger 公共 API
 */
export const Logger = {
    /**
     * 初始化 Logger。清空所有 category 的缓存。
     *
     * （注：本方法会清空所有 category 的日志，谨慎调用）
     */
    init(): void {
        logCache = [];
        Logger.info("System", "Logger 初始化完成");
    },

    /** DEBUG 级别日志 (调试信息) */
    debug(module: LogModule | string, message: string, data?: unknown): string {
        return writeAppLog(LogLevel.DEBUG, module as string, message, data);
    },

    /** INFO 级别日志 (常规信息) */
    info(module: LogModule | string, message: string, data?: unknown): string {
        return writeAppLog(LogLevel.INFO, module as string, message, data);
    },

    /** SUCCESS 级别日志 (操作成功) */
    success(
        module: LogModule | string,
        message: string,
        data?: unknown,
    ): string {
        return writeAppLog(LogLevel.SUCCESS, module as string, message, data);
    },

    /** WARN 级别日志 (警告信息) */
    warn(module: LogModule | string, message: string, data?: unknown): string {
        return writeAppLog(LogLevel.WARN, module as string, message, data);
    },

    /** ERROR 级别日志 (错误信息) */
    error(module: LogModule | string, message: string, data?: unknown): string {
        return writeAppLog(LogLevel.ERROR, module as string, message, data);
    },

    /**
     * 通用写入入口——供 ModelLogger / RecallLogService 等门面使用。
     * 接受除 id/timestamp 外的完整 LogEntry 字段。
     * @returns 新条目的 id
     */
    log(partial: Omit<LogEntry, "id" | "timestamp">): string {
        const entry: LogEntry = {
            ...partial,
            id: generateShortUUID("log_"),
            timestamp: Date.now(),
        };
        pushEntry(entry);
        return entry.id;
    },

    /**
     * 获取所有缓存日志（快照副本，迭代期间不受后续写入影响）
     */
    getLogs(): LogEntry[] {
        return [...logCache];
    },

    /**
     * 按谓词过滤日志（供门面查询特定 category 时使用）
     */
    getFiltered(predicate: (e: LogEntry) => boolean): LogEntry[] {
        return logCache.filter(predicate);
    },

    /**
     * 订阅新日志流
     * @returns 取消订阅函数
     */
    subscribe(callback: (entry: LogEntry) => void): () => void {
        subscribers.add(callback);
        return () => subscribers.delete(callback);
    },

    /**
     * 清空日志。
     * @param category 若指定，仅清空该类别；否则全清。
     */
    clear(category?: LogCategory): void {
        if (category) {
            logCache = logCache.filter((e) => e.category !== category);
            Logger.info("Logger", `已清空 ${category} 类别日志`);
        } else {
            logCache = [];
            Logger.info("Logger", "日志已清空");
        }
    },
};
