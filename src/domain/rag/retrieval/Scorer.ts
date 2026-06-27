/**
 * Scorer — 融合多路召回分数并排序。
 *
 * 融合公式：`hybridScore = max(embeddingScore, keywordScore) + rerankScore`
 * —— 多路召回取最强基础分，Rerank 命中则叠加。当只有单路分数时，回退为
 * 该路分数本身。
 */

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import type { EventNode } from "@/data/types/graph.ts";

// ==================== 类型定义 ====================

/**
 * 带分数的事件
 */
export interface ScoredEvent {
    /** 事件 ID */
    id: string;
    /** 事件摘要 */
    summary: string;
    /** Embedding 余弦相似度分数 (0-1) */
    embeddingScore?: number;
    /** 关键词硬匹配分数 (0-1) */
    keywordScore?: number;
    /** Rerank 相关性分数 (0-1) */
    rerankScore?: number;
    /** 融合分数 */
    hybridScore?: number;
    /** 原始事件节点 */
    node?: EventNode;
}

// ==================== 打分函数 ====================

/**
 * 计算融合分数。
 *
 * @param embeddingScore Embedding 相似度分数 (0-1)
 * @param rerankScore Rerank 相关性分数 (0-1)
 * @param keywordScore 关键词硬匹配分数 (0-1)
 * @returns 融合分数
 */
function calculateHybridScore(
    embeddingScore: number | null | undefined,
    rerankScore: number | null | undefined,
    keywordScore: number | null | undefined,
): number {
    // 基础分：如果同时有 keyword 和 embedding，取最高者
    const baseScore = Math.max(embeddingScore ?? 0, keywordScore ?? 0);

    // 如果只有一个分数，直接返回
    if (baseScore === 0 && rerankScore == null) return 0;
    if (baseScore === 0) return rerankScore ?? 0;
    if (rerankScore == null) return baseScore;

    // 融合分数 = 基础分 (Embedding/Keyword) + Rerank 分数
    // 这样做可以更直观地反映多路召回的累加贡献
    return baseScore + (rerankScore ?? 0);
}

/**
 * 对候选事件进行融合打分和排序。
 *
 * @param candidates 候选事件列表
 * @returns 排序后的事件列表
 */
export function scoreAndSort(candidates: ScoredEvent[]): ScoredEvent[] {
    // 计算每个事件的融合分数
    const scored = candidates.map((event) => ({
        ...event,
        hybridScore: calculateHybridScore(
            event.embeddingScore,
            event.rerankScore,
            event.keywordScore,
        ),
    }));

    // 按融合分数降序排列
    scored.sort((a, b) => (b.hybridScore ?? 0) - (a.hybridScore ?? 0));

    Logger.debug(LogModule.RAG_INJECT, "融合打分完成", {
        candidateCount: scored.length,
        topScore: scored[0]?.hybridScore,
    });

    return scored;
}

/**
 * 将 Rerank 分数合并回候选集并重新打分排序。
 *
 * @param candidatesById 候选事件 (id -> ScoredEvent)，会被就地写入 rerankScore
 * @param rerankResults Rerank 结果 (index -> score)
 * @param indexCandidates 原始候选列表 (用于索引映射)
 * @returns 融合排序后的事件列表
 */
export function mergeResults(
    candidatesById: Map<string, ScoredEvent>,
    rerankResults: { index: number; relevance_score: number }[],
    indexCandidates: ScoredEvent[],
): ScoredEvent[] {
    // 将 Rerank 分数合并到候选结果中
    for (const rerankItem of rerankResults) {
        const candidate = indexCandidates[rerankItem.index];
        if (candidate && candidatesById.has(candidate.id)) {
            const event = candidatesById.get(candidate.id)!;
            event.rerankScore = rerankItem.relevance_score;
        }
    }

    // 转换为数组并计算融合分数
    const candidates = [...candidatesById.values()];
    return scoreAndSort(candidates);
}
