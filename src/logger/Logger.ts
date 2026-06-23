/**
 * Logger - 应用事件日志
 *
 * 通用 app 日志：5 个级别 + 订阅 + 清空 + 容量上限。仅用于 Logger.debug/info/
 * success/warn/error 写入；UI 由 DevLog 的 Runtime tab 读取。
 *
 * Model 调用日志见 ./modelLog.ts（useModelLogStore）。
 * RAG 召回日志见 ./recallLog.ts（useRecallLogStore）。
 */

import { generateShortUUID } from "@/utils";
import type { LogModule } from "./LogModule.ts";
import type { LogEntry } from "./types.ts";
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

function write(
    level: LogLevel,
    module: string,
    message: string,
    data?: unknown,
): string {
    const entry: LogEntry = {
        id: generateShortUUID("log_"),
        timestamp: Date.now(),
        level,
        module,
        message,
        data,
    };

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
            // 不能用 Logger.error——会重新进入 write 导致重入
            console.error("[Logger] subscriber threw:", err);
        }
    }

    return entry.id;
}

export const Logger = {
    /**
     * 初始化 Logger。清空日志缓存。
     */
    init(): void {
        logCache = [];
        Logger.info("System", "Logger 初始化完成");
    },

    debug(module: LogModule | string, message: string, data?: unknown): string {
        return write(LogLevel.DEBUG, module as string, message, data);
    },

    info(module: LogModule | string, message: string, data?: unknown): string {
        return write(LogLevel.INFO, module as string, message, data);
    },

    success(
        module: LogModule | string,
        message: string,
        data?: unknown,
    ): string {
        return write(LogLevel.SUCCESS, module as string, message, data);
    },

    warn(module: LogModule | string, message: string, data?: unknown): string {
        return write(LogLevel.WARN, module as string, message, data);
    },

    error(module: LogModule | string, message: string, data?: unknown): string {
        return write(LogLevel.ERROR, module as string, message, data);
    },

    /**
     * 获取所有缓存日志（快照副本，迭代期间不受后续写入影响）
     */
    getLogs(): LogEntry[] {
        return [...logCache];
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
     */
    clear(): void {
        logCache = [];
        Logger.info("Logger", "日志已清空");
    },
};
