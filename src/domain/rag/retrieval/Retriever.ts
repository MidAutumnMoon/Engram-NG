/**
 * Retriever Service
 *
 * 召回路径：关键词扫描 + 向量检索 (+ 可选 Rerank)。两条召回轨道并行执行，
 * 按 ID 去重合并后在 Scorer 中融合排序。
 */

import { getSetting } from "@/config/settings.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { useRecallLogStore } from "@/logger/recallLog.ts";
import { tryGetDbForChat } from "@/data/db.ts";
import { getCurrentChatId } from "@/sillytavern/context.ts";

import { DEFAULT_RECALL_CONFIG } from "@/config/types/rag.ts";
import type { RecallConfig } from "@/config/types/rag.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { ChatHistoryHelper } from "@/sillytavern/chat/chatHistory.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import {
    keywordRetrieve,
    mergeAndRerank,
    type RecalledEntity,
    vectorRetrieve,
} from "@/domain/rag/retrieval/pipeline.ts";
import type { ScoredEvent } from "@/domain/rag/retrieval/Scorer.ts";
import { WorldInfoService } from "@/domain/worldbook/WorldInfo.ts";

// ==================== 类型定义 ====================

export interface RetrievalResult {
    entries: string[]; // Formatted entries ready for injection
    nodes: EventNode[]; // Raw nodes
    candidates?: ScoredEvent[]; // V1.4: 曝露带分数的候选列表供前端装配
    recalledEntities?: RecalledEntity[]; // V1.4: 曝露被召回的实体
    skippedReason?: string; // V1.4.4: 召回短路原因（如无可召回对象）
}

// ==================== Retriever ====================

class Retriever {
    /**
     * 获取指定深度的最近聊天上下文
     * @param count 消息条数
     */
    private getRecentContext(count: number): string | null {
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

    /**
     * 执行检索流程
     * @param userInput 用户原始输入
     * @param unifiedQueries 预处理生成的查询词（可选）
     * @param options skipContext=true 时跳过历史回溯增强 (手动测试用)
     */
    async search(
        userInput: string,
        unifiedQueries?: string[],
        options?: { skipContext?: boolean },
    ): Promise<RetrievalResult> {
        Logger.debug(LogModule.RAG_INJECT, "Retriever.search 被调用", {
            input: userInput.substring(0, 20),
            skipContext: options?.skipContext,
            unifiedCount: unifiedQueries?.length || 0,
        });

        const apiSettings = getSetting("apiSettings");
        const recallConfig = apiSettings?.recallConfig || DEFAULT_RECALL_CONFIG;

        // --- 逻辑分发 ---
        let intentQuery = userInput; // 意图轨道 (Embedding/Rerank)
        let scanQuery = userInput; // 扫描轨道 (Keyword)

        // 只有在非跳过模式下才进行上下文增强
        if (!options?.skipContext) {
            // 轨道 A: 关键词扫描增强 (深层回溯: 5 条)
            if (recallConfig.useKeywordRecall) {
                const deepContext = this.getRecentContext(5);
                if (deepContext) {
                    scanQuery = `${deepContext}\n\n[Current]\n${userInput}`;
                    Logger.debug(
                        LogModule.RAG_INJECT,
                        "已回溯 5 条聊天历史增强关键词扫描深度",
                    );
                }
            }

            // 轨道 B: 意图语义增强 (浅层回溯: 2 条) - 仅限正式聊天且无预处理结果时
            const noUnifiedQueries = !unifiedQueries ||
                unifiedQueries.length === 0;
            if (noUnifiedQueries) {
                const shallowContext = this.getRecentContext(2);
                if (shallowContext) {
                    intentQuery =
                        `${shallowContext}\n\n[Current]\n${userInput}`;
                    Logger.debug(
                        LogModule.RAG_INJECT,
                        "已回溯 2 条聊天历史进行意图兜底增强",
                    );
                }
            }
        } else {
            Logger.debug(LogModule.RAG_INJECT, "手动测试模式：跳过上下文增强");
        }

        // 未启用召回，使用滚动窗口策略
        if (!recallConfig.enabled && !recallConfig.useKeywordRecall) {
            Logger.debug(
                LogModule.RAG_INJECT,
                "召回与关键词模式均未启用，使用滚动窗口策略",
            );
            const limit = recallConfig.embedding?.topK || 20;
            return this.rollingSearch(limit);
        }

        // 冷启动保护 —— 没有可召回对象时，不进入召回工作流。
        // 召回资格不再与 is_archived 绑定（那是 trim/budget 的标志）：任何事件/实体都可被
        // 关键词或向量召回。因此这里只问「库里有没有东西」，用主键存在性探测，常数时间。
        const chatId = getCurrentChatId();
        const db = chatId ? tryGetDbForChat(chatId) : null;
        if (db) {
            try {
                const [anyEventCount, anyEntityCount] = await Promise.all([
                    db.events.limit(1).count(),
                    db.entities.limit(1).count(),
                ]);

                const canRecall = anyEventCount > 0 || anyEntityCount > 0;
                if (!canRecall) {
                    Logger.info(
                        LogModule.RAG_INJECT,
                        "冷启动保护：无可召回对象，跳过召回流程",
                    );
                    const limit = recallConfig.embedding?.topK || 20;
                    const fallback = await this.rollingSearch(limit);
                    return {
                        ...fallback,
                        skippedReason: "当前没有任何事件或实体，已跳过召回流程",
                    };
                }
            } catch (error) {
                Logger.warn(
                    LogModule.RAG_INJECT,
                    "冷启动检查失败，跳过保护逻辑",
                    { error: error },
                );
            }
        }

        // 到这里至少一个召回开关已开 (上面已 early-return 两开关皆关的情况)，
        // 直接进入检索流水线。
        return this.runRetrieval(
            intentQuery,
            unifiedQueries,
            recallConfig,
            scanQuery,
        );
    }

    private async runRetrieval(
        userInput: string,
        unifiedQueries: string[] | undefined,
        config: RecallConfig,
        scanQuery?: string,
    ): Promise<RetrievalResult> {
        const startTime = Date.now();
        Logger.debug(
            LogModule.RAG_INJECT,
            "--- 进入检索流水线 (keyword + vector 并行) ---",
            {
                scanQueryLen: scanQuery?.length,
            },
        );

        try {
            // Stage 1 + 2: keyword 和 vector 并行执行。两路独立，并行可省下
            // 关键词扫描的整段时间。向量失败时降级为仅关键词结果。
            // 实体在这里复活 —— 之前多跳结果被写进 context.data 后丢弃，
            // 现在直接流回 RetrievalResult。
            const keywordPromise = keywordRetrieve(
                {
                    query: userInput,
                    scanQuery: scanQuery || userInput,
                    unifiedQueries,
                },
                config,
            );

            const vectorPromise = vectorRetrieve(
                { query: userInput, unifiedQueries },
                config,
            ).catch((error: any) => {
                Logger.warn(
                    LogModule.RAG_INJECT,
                    "向量检索阶段失败，仅使用关键词结果",
                    { error: error.message },
                );
                return { candidates: [] as ScoredEvent[], retrieveTime: 0 };
            });

            const [keyword, vector] = await Promise.all([
                keywordPromise,
                vectorPromise,
            ]);

            // Stage 3: merge + optional rerank.
            const merged = await mergeAndRerank(
                keyword.events,
                vector.candidates,
                config,
                { query: userInput, unifiedQueries },
            );

            const candidates = merged.candidates;
            const recalledEntities = keyword.entities;

            // Assemble result.
            const nodes = candidates
                .filter((c) => c.node)
                .map((c) => c.node!);
            const entries = candidates.map((c) => c.summary);

            const totalTime = Date.now() - startTime;

            // Record recall log (replaces RecordRecallLogStep).
            // NOTE: "hybrid" 在这里是显示标签 (RecallLog UI 读取 entry.mode)，
            // 不是代码分支名 —— 检索路径由 runRetrieval 统一承载。
            let worldbookEntriesCount = 0;
            try {
                const worldInfoText = await WorldInfoService
                    .getActivatedWorldInfo();
                worldbookEntriesCount = worldInfoText
                    ? worldInfoText.split("\n\n").length
                    : 0;
            } catch {
                Logger.debug(LogModule.RAG_INJECT, "获取世界书条目统计失败");
            }

            useRecallLogStore.getState().record({
                mode: "hybrid",
                preprocessedQuery: unifiedQueries?.[0],
                query: userInput,
                recalledEntities,
                results: candidates.map((c) => ({
                    eventId: c.id,
                    summary: c.summary,
                    category: c.node?.structured_kv?.event || "unknown",
                    embeddingScore: c.embeddingScore || 0,
                    keywordScore: c.keywordScore,
                    rerankScore: c.rerankScore,
                    hybridScore: c.hybridScore,
                    isTopK: true,
                    isReranked: c.rerankScore != null,
                    sourceFloor: c.node?.source_range?.start_index,
                })),
                stats: {
                    latencyMs: totalTime,
                    rerankCount: candidates.length,
                    topKCount: candidates.length,
                    totalCandidates: merged.originalCandidateCount ||
                        candidates.length,
                },
            });

            Logger.info(LogModule.RAG_INJECT, "检索完成", {
                candidateCount: candidates.length,
                entityCount: recalledEntities.length,
                isEmbedding: config.useEmbedding,
                isRerank: config.useRerank,
                reranked: merged.reranked,
                totalTime: `${totalTime}ms`,
                worldbook: worldbookEntriesCount,
            });

            return { candidates, entries, nodes, recalledEntities };
        } catch (error: any) {
            Logger.error(
                LogModule.RAG_INJECT,
                "检索遭遇毁灭性失败",
                {
                    error: error.message,
                    stack: error.stack,
                },
            );
            return { entries: [], nodes: [] };
        }
    }

    /**
     * 滚动窗口策略 (基础模式)
     * 返回最近的事件，不使用向量检索
     */
    private async rollingSearch(limit: number): Promise<RetrievalResult> {
        const chatId = getCurrentChatId();
        if (!chatId) {
            return { entries: [], nodes: [] };
        }

        const db = tryGetDbForChat(chatId);
        if (!db) {
            return { entries: [], nodes: [] };
        }

        // 1. Get recent Level 0 (Details)
        const recentEvents = await db.events
            .filter((node) => node.level === 0)
            .toReversed()
            .limit(limit)
            .toArray();

        // 2. Get latest Level 1 (Macro Context)
        const latestMacro = await db.events
            .filter((node) => node.level === 1)
            .toReversed()
            .first();

        const nodes: EventNode[] = [...recentEvents];
        if (latestMacro) {
            nodes.unshift(latestMacro);
        }

        // 3. Format entries
        const entries = nodes.map((node) => node.summary);

        return { entries, nodes };
    }
}

export const retriever = new Retriever();
