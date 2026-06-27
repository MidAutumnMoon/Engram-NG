/**
 * RecallLog - RAG 召回日志的全局状态。
 *
 * 取代此前将 RecallLogEntry 塞入 Logger.LogEntry.data（: unknown）再过滤/转回的
 * 间接通信。Producer（Retriever）通过 record 推入；
 * Consumer（RecallLog.tsx）订阅 entries 渲染。
 */

import { create } from "zustand";
import { generateShortUUID } from "@/utils/shortUUID.ts";

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
