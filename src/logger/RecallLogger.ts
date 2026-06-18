/**
 * RecallLogService - 召回日志服务（门面）
 *
 * V0.9.13: 重构为薄门面。所有数据存入 Logger 的统一缓存（category="recall"），
 * 不再维护独立 store / 订阅链路 / trim 逻辑。RecallLogEntry 作为 LogEntry.data
 * 承载。
 *
 * 公共 API 与原版兼容，调用方（Retriever、RecordRecallLogStep、RecallLog.tsx）
 * 无需改动。
 *
 * 注：原版的 exportLogs() 因 require() 在 ESM 不可用而始终报错，已移除——
 * 如需召回日志导出，应统一在 UI 层基于 Logger.getFiltered 实现。
 */

import { generateShortUUID } from "@/utils";
import { Logger } from "./Logger.ts";
import { LogLevel } from "./types.ts";
import type {
    RecallLogEntry,
    RecallResultItem,
    RecallStats,
} from "@/ui/views/dev-log/types.ts";

type RecallLogSubscriber = (logs: RecallLogEntry[]) => void;

class RecallLogServiceClass {
    /**
     * 记录一次召回
     */
    log(entry: Omit<RecallLogEntry, "id" | "timestamp">): void {
        const fullEntry: RecallLogEntry = {
            ...entry,
            id: generateShortUUID("recall_"),
            timestamp: Date.now(),
        };

        Logger.log({
            category: "recall",
            data: fullEntry,
            level: LogLevel.DEBUG,
            message: entry.query.slice(0, 80),
            module: "RecallLogService",
        });
    }

    /**
     * 获取所有日志（按时间倒序——后写入的在前）
     */
    getLogs(): RecallLogEntry[] {
        return Logger
            .getFiltered((e) => e.category === "recall")
            .map((e) => e.data as RecallLogEntry)
            .reverse();
    }

    /**
     * 清空日志
     */
    clear(): void {
        Logger.clear("recall");
    }

    /**
     * 订阅日志变更（仅在 recall 类别新增时触发，回调收到当前完整快照）
     */
    subscribe(callback: RecallLogSubscriber): () => void {
        return Logger.subscribe((entry) => {
            if (entry.category === "recall") {
                callback(this.getLogs());
            }
        });
    }
}

export const RecallLogService = new RecallLogServiceClass();

// 类型再导出，便于调用方就近引用
export type { RecallLogEntry, RecallResultItem, RecallStats };
