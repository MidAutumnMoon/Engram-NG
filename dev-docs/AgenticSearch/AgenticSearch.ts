/**
 * AgenticSearch.ts — reference snapshot.
 *
 * Captured from `src/domain/rag/retrieval/Retriever.ts` immediately before
 * removal. NOT compiled; NOT imported by anything in `src/`. Kept under
 * `dev-docs/` as a logic backup in case Agentic RAG is reintroduced.
 * See `./README.md` for the reintroduction checklist.
 *
 * To revive: copy `agenticSearch` back onto `Retriever` (or, preferably, into
 * its own `retrieval/agentic.ts` module) and re-add a caller that produces
 * `AgenticRecall[]`.
 */

import { getSetting } from "@/config/settings.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { useRecallLogStore } from "@/logger/recallLog.ts";
import { tryGetDbForChat } from "@/data/db.ts";
import { getCurrentChatId } from "@/sillytavern/index.ts";

import { DEFAULT_RECALL_CONFIG } from "@/config/types/rag.ts";
import type { AgenticRecall } from "@/config/types/rag.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { ChatHistoryHelper } from "@/sillytavern/chat/chatHistory.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import { keywordRetrieve, type RecalledEntity } from "@/domain/rag/retrieval/pipeline.ts";
import type { ScoredEvent } from "@/domain/rag/retrieval/Scorer.ts";

/** Minimal RetrievalResult shape this method returns. */
export interface RetrievalResult {
    entries: string[];
    nodes: EventNode[];
    candidates?: ScoredEvent[];
    recalledEntities?: RecalledEntity[];
}

// ============================================================================
// Helpers copied from Retriever (agenticSearch depends on getRecentContext)
// ============================================================================

function getRecentContext(count: number): string | null {
    try {
        const currentCount = ChatHistoryHelper.getCurrentMessageCount();
        if (currentCount <= 0) return null;

        return ChatHistoryHelper.getChatHistory(
            [
                Math.max(1, currentCount - count),
                currentCount,
            ],
            (t) => regexProcessor.process(t, "both"),
        );
    } catch {
        return null;
    }
}

// ============================================================================
// agenticSearch — Agentic RAG 直通检索
// ============================================================================

/**
 * 跳过 Embedding/Rerank，直接按 LLM 裁判给出的 ID 从数据库捣取事件。
 *
 * @param recalls LLM 输出的召回决策列表
 * @param options 额外配置 (mode, isManualTest, scanQuery 等)
 * @returns 检索结果
 */
export async function agenticSearch(
    recalls: AgenticRecall[],
    options?: {
        mode?: string;
        isManualTest?: boolean;
        scanQuery?: string;
    },
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const chatId = getCurrentChatId();
    if (!chatId) {
        Logger.warn(LogModule.RAG_RETRIEVE, "Agentic Search: 无当前聊天");
        return { entries: [], nodes: [] };
    }

    const db = tryGetDbForChat(chatId);
    if (!db) {
        Logger.warn(LogModule.RAG_RETRIEVE, "Agentic Search: 数据库不可用");
        return { entries: [], nodes: [] };
    }

    const config = getSetting("apiSettings")?.recallConfig ||
        DEFAULT_RECALL_CONFIG;

    // 1. 按 ID 直接从数据库捣取事件
    const ids = recalls.map((r) => r.id);
    const events = await db.events.bulkGet(ids);
    const validEvents = events.filter((e): e is EventNode => e != null);

    if (validEvents.length === 0) {
        Logger.warn(LogModule.RAG_RETRIEVE, "Agentic Search: 无有效事件", {
            requestedIds: ids,
        });
        return { entries: [], nodes: [] };
    }

    Logger.info(LogModule.RAG_RETRIEVE, "Agentic Search: 数据库查询完成", {
        found: validEvents.length,
        requested: ids.length,
    });

    // 2. 构建 ScoredEvent（用 LLM 给的 score 填充双轨）
    const validEventMap = new Map(validEvents.map((e) => [e.id, e]));
    const candidates: ScoredEvent[] = recalls
        .filter((r) => validEventMap.has(r.id))
        .map((r) => ({
            embeddingScore: r.score,
            id: r.id,
            rerankScore: r.score, // 双轨同分
        }));

    const finalNodes = validEvents;

    // 3. 关键词扫描 (实体召回保底)
    // Agentic 模式虽然跳过了事件的语义匹配，但不能丢掉实体的关键词扫描。
    // 结果直接作为 recalledEntities 返回 (此前结果被 WorkflowEngine 丢弃)。
    let recalledEntities: RecalledEntity[] = [];
    if (config.useKeywordRecall) {
        try {
            const scanQuery = options?.scanQuery ||
                getRecentContext(5) || "";
            const keyword = await keywordRetrieve(
                {
                    scanQuery,
                    // 用 LLM 给的召回理由作为额外意图信息
                    unifiedQueries: recalls.map((r) => r.reason).filter(
                        Boolean,
                    ),
                },
                config,
            );
            recalledEntities = keyword.entities;
        } catch (error) {
            Logger.warn(
                LogModule.RAG_RETRIEVE,
                "Agentic 模式下的关键词扫描失败",
                error,
            );
        }
    }

    const totalTime = Date.now() - startTime;

    // 4. 记录召回日志 (如果是手动测试确认，则跳过日志记录)
    if (!options?.isManualTest) {
        useRecallLogStore.getState().record({
            mode: (options?.mode as any) || "agentic",
            query: options?.mode === "hybrid"
                ? "[Hybrid Preview Mode]"
                : "[Agentic RAG]",
            recalledEntities,
            results: recalls
                .filter((r) => validEventMap.has(r.id))
                .map((r) => ({
                    eventId: r.id,
                    summary: validEventMap.get(r.id)!.summary,
                    category:
                        validEventMap.get(r.id)!.structured_kv?.event ||
                        "unknown",
                    embeddingScore: r.score, // 模型给出的分通常作为主分
                    rerankScore: r.score, // 对于 Agentic，Rerank 分数默认等同于评估分
                    hybridScore: r.score,
                    isTopK: true,
                    isReranked: true, // Agentic 模式下默认视为已重排 (LLM 钦定)
                    reason: r.reason,
                })),
            stats: {
                latencyMs: totalTime,
                rerankCount: 0,
                topKCount: validEvents.length,
                totalCandidates: recalls.length,
            },
        });
    }

    // 5. 返回结果
    const entries = finalNodes.map((n) => n.summary);

    Logger.info(LogModule.RAG_RETRIEVE, "Agentic Search 完成", {
        resultCount: finalNodes.length,
        totalTime,
    });

    return { candidates, entries, nodes: finalNodes, recalledEntities };
}
