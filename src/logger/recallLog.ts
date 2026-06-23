/**
 * RecallLog - RAG 召回日志的全局状态。
 *
 * 取代此前将 RecallLogEntry 塞入 Logger.LogEntry.data（: unknown）再过滤/转回的
 * 间接通信。Producer（Retriever、RecordRecallLogStep）通过 record 推入；
 * Consumer（RecallLog.tsx）订阅 entries 渲染。
 */

import { create } from "zustand";
import { generateShortUUID } from "@/utils";
import type { RecallLogEntry } from "./types.ts";

interface RecallLogState {
    /** 时间倒序：新写入的在前。 */
    entries: RecallLogEntry[];
    /** 写入一条召回日志。id / timestamp 自动填充。 */
    record: (entry: Omit<RecallLogEntry, "id" | "timestamp">) => void;
    clear: () => void;
}

export const useRecallLogStore = create<RecallLogState>((set) => ({
    entries: [],

    record: (entry) =>
        set((s) => ({
            entries: [
                {
                    ...entry,
                    id: generateShortUUID("recall_"),
                    timestamp: Date.now(),
                },
                ...s.entries,
            ],
        })),

    clear: () => set({ entries: [] }),
}));
