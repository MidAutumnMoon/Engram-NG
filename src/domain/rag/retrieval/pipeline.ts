/**
 * Retrieval pipeline — the direct, typed successor to the old
 * `domain/workflow` step classes (`KeywordRetrieveStep` / `VectorRetrieveStep`
 * / `RerankMergeStep` / `RecordRecallLogStep`).
 *
 * Each stage is a plain function with typed inputs and typed outputs. Stages
 * communicate via explicit return values instead of a stringly-typed
 * `context.data` bag, so the contract between them is compile-checked. This
 * mirrors the convention already established by `domain/memory/pipelines`.
 *
 * Behaviour preserved from the step classes:
 * - Keyword: composite scan text (history + intent + LLM queries), entity +
 *   archived-event guards, per-stream TopK, relation multi-hop (attenuation 0.8).
 * - Vector: embedding similarity, bounded TopK insert, char-safe truncation,
 *   preset-driven retry on 429 / rate-limit / timeout / network.
 * - Rerank/Merge: dedup-by-id, hard-limit, rerank-with-fallback.
 *
 * Entity recall is *resurrected* here: the keyword stage returns the multi-hop
 * entity results as shaped `RecalledEntity[]` (previously computed then
 * discarded as the dead `context.data.keywordEntityIds`), so the "已唤醒实体"
 * panel and recall log actually populate.
 *
 * Fusion formula lives in `Scorer`: `max(embedding, keyword) + rerank`.
 */

import { getSetting } from "@/config/settings.ts";
import type { RecallConfig } from "@/config/types/rag.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { tryGetDbForChat } from "@/data/db.ts";
import { getCurrentChatId } from "@/sillytavern/index.ts";
import { matchEvent, scanEntities } from "@/domain/memory/EntityScanner.ts";
import { embeddingService } from "@/domain/rag/embedding/EmbeddingService.ts";
import {
    mergeResults,
    scoreAndSort,
    type ScoredEvent,
} from "@/domain/rag/retrieval/Scorer.ts";
import { rerankService } from "@/domain/rag/retrieval/Reranker.ts";
import {
    type RetryConfig,
    retryWithBackoff,
} from "@/domain/memory/pipelines/shared.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Entity surfaced by keyword recall. Shaped to match the fields the recall UI
 * already reads (RecallDecisionModal / RecallLog): `id` (key), `name` (label),
 * `description` (tooltip), `_recallWeight` (score badge), `type` (subtype).
 */
export interface RecalledEntity {
    id: string;
    name: string;
    description?: string;
    type?: string;
    /** Multi-hop score (0-1, first-hop ~0.9, second-hop attenuated by 0.8). */
    _recallWeight: number;
}

export interface KeywordRetrieveInput {
    /** Intent track — the current user message. */
    query?: string;
    /** Enhanced scan text (history-augmented). Falls back to chatHistory tail. */
    scanQuery?: string;
    /** LLM-suggested expert terms (boost). */
    unifiedQueries?: string[];
}

export interface KeywordRetrieveResult {
    /** Keyword-hit events as ScoredEvent (keywordScore 0.8). */
    events: ScoredEvent[];
    /** Keyword + multi-hop entities, shaped for recall display/injection. */
    entities: RecalledEntity[];
    /** Wall-clock ms spent in keyword retrieval. */
    retrieveTime: number;
}

export interface VectorRetrieveInput {
    /** Intent track — used when no unifiedQueries are supplied. */
    query?: string;
    /** Preprocessor queries; [0] is preferred over `query` when present. */
    unifiedQueries?: string[];
}

export interface VectorRetrieveResult {
    candidates: ScoredEvent[];
    retrieveTime: number;
}

export interface MergeAndRerankInput {
    /** Intent track for the rerank query. */
    query?: string;
    /** Preprocessor queries; [0] preferred for the rerank query. */
    unifiedQueries?: string[];
}

export interface MergeAndRerankResult {
    candidates: ScoredEvent[];
    /** Original merged count before the hard-limit slice. */
    originalCandidateCount: number;
    /** Whether rerank actually ran. */
    reranked: boolean;
    rerankTime: number;
}

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Effective event TopK cap. Keyword recall and merge share this hard-limit so
 * a keyword candidate explosion can't leak past merge. Keyword's own cap is
 * explicit; otherwise fall back to the embedding TopK, then a sane default.
 */
function effectiveEventTopK(config: RecallConfig): number {
    return config.keywordTopK?.events ?? config.embedding?.topK ?? 50;
}

/**
 * Preset-driven retry config for an external model call (vector / rerank).
 * Both sources retry on the same transient-error signal; "network" matches
 * either "network" or "network error".
 */
function getRetryConfig(source: "vector" | "rerank"): RetryConfig {
    const customConfig = source === "vector"
        ? getSetting("apiSettings")?.vectorConfig?.retryConfig
        : getSetting("apiSettings")?.rerankConfig?.retryConfig;

    return {
        backoff: "exponential",
        delay: customConfig?.retryDelay ?? 2000,
        maxAttempts: customConfig?.maxAttempts ?? 3,
        retryIf: (error: unknown) => {
            const msg = error instanceof Error
                ? error.message.toLowerCase()
                : String(error).toLowerCase();
            return msg.includes("429") ||
                msg.includes("rate limit") ||
                msg.includes("timeout") ||
                msg.includes("network") ||
                msg.includes("failed to fetch");
        },
    };
}

/**
 * Cheap existence check: is there at least one archived event? Used to skip
 * the event-scan pass entirely when there's nothing to match. Returns true on
 * error (fail-open) so a flaky index doesn't silently disable event recall.
 */
async function hasAnyArchivedEvents(db: any): Promise<boolean> {
    try {
        const indexed: any = (db.events as any).where?.("is_archived").equals(
            1,
        );
        if (indexed) {
            const count = await indexed.limit(1).count();
            return count > 0;
        }
        // Fallback for environments without the boolean index (DataError).
        const count = await db.events.toCollection().filter((e: any) =>
            Boolean(e.is_archived)
        ).limit(1).count();
        return count > 0;
    } catch (error) {
        Logger.warn(
            LogModule.WF_KEYWORD_RETRIEVE,
            "无法检查归档事件状态，默认尝试扫描",
            error,
        );
        return true;
    }
}

// ============================================================================
// Stage 1: keyword retrieve (port of KeywordRetrieveStep)
// ============================================================================

export async function keywordRetrieve(
    input: KeywordRetrieveInput,
    config: RecallConfig,
): Promise<KeywordRetrieveResult> {
    const startTime = Date.now();

    const { query, scanQuery, unifiedQueries } = input;

    // V1.4.15: 综合扫描方案 - 始终包含基础上下文，叠加 LLM 查询词
    const scanParts: string[] = [];

    // 1. 基础历史背景 (由调用方在 scanQuery 中预合并)
    if (scanQuery) {
        scanParts.push(scanQuery);
    }

    // 2. 当前意图和原文
    if (query) scanParts.push(query);

    // 3. LLM 建议的专家词 (增益)
    if (unifiedQueries && unifiedQueries.length > 0) {
        scanParts.push(...unifiedQueries);
    }

    // 去重合并
    const textToScan = [...new Set(scanParts.filter(Boolean))].join("\n\n");

    const empty: KeywordRetrieveResult = {
        entities: [],
        events: [],
        retrieveTime: Date.now() - startTime,
    };

    if (!textToScan) {
        Logger.debug(
            LogModule.RAG_INJECT,
            "没有提供扫描上下文，跳过关键词检索",
        );
        return empty;
    }

    const chatId = getCurrentChatId();
    if (!chatId) return empty;

    const db = tryGetDbForChat(chatId);
    if (!db) return empty;

    const apiSettings = getSetting("apiSettings");
    const recallConfig = apiSettings?.recallConfig ?? config;

    const eventTopK = effectiveEventTopK(recallConfig);
    const entityTopK = recallConfig.keywordTopK?.entities ?? 30;

    // 一次性拉取实体并构建查找索引：id -> 节点、(name|alias 小写) -> 节点。
    // 复用给命中过滤、多跳联想和最终的 RecalledEntity 整形。
    const allEntities = await db.entities.toArray();
    const entityById = new Map<string, any>(allEntities.map((e) => [e.id, e]));
    const entityByName = new Map<string, any>();
    for (const e of allEntities) {
        entityByName.set(e.name.toLowerCase(), e);
        if (Array.isArray(e.aliases)) {
            for (const alias of e.aliases) {
                entityByName.set(alias.toLowerCase(), e);
            }
        }
    }

    Logger.debug(
        LogModule.RAG_INJECT,
        `准备扫描。实体索引总量: ${allEntities.length}`,
    );

    Logger.debug(
        LogModule.RAG_INJECT,
        `扫描文本预览: ${textToScan.slice(0, 50)}...`,
    );

    // --- 实体扫描 (P0 Fix: 即使无事件也执行) ---
    let hitEntities: any[] = [];
    const hitEvents: any[] = [];

    if (recallConfig.enableEntityKeyword !== false) {
        const matchedIndex = scanEntities(textToScan, allEntities)
            .slice(0, entityTopK);

        if (matchedIndex.length > 0) {
            const matchedIds = new Set(matchedIndex.map((e) => e.id));
            hitEntities = allEntities.filter((e) => matchedIds.has(e.id));

            Logger.debug(
                LogModule.RAG_INJECT,
                `命中了 ${hitEntities.length} 个实体(TopK=${entityTopK}): ${
                    hitEntities.map((e) => e.name).join(", ")
                }`,
            );
        }
    } else {
        Logger.debug(LogModule.RAG_INJECT, "实体关键词扫描已禁用");
    }

    // --- 事件扫描：仅在配置开启且有归档事件时进行 (P0 Fix: 守卫下沉) ---
    if (
        recallConfig.useKeywordRecall !== false &&
        recallConfig.enableEventKeyword !== false
    ) {
        if (await hasAnyArchivedEvents(db)) {
            const scannedCount = { archived: 0, matched: 0, total: 0 };
            await db.events.toCollection().each((event: any) => {
                scannedCount.total += 1;

                if (!event.is_archived) {
                    return;
                }

                scannedCount.archived += 1;

                if (!matchEvent(textToScan, event)) {
                    return;
                }

                scannedCount.matched += 1;

                if (hitEvents.length < eventTopK) {
                    hitEvents.push(event);
                }
            });

            Logger.debug(LogModule.RAG_INJECT, "事件关键词扫描完成", {
                eventTopK,
                kept: hitEvents.length,
                matched: scannedCount.matched,
                scannedArchived: scannedCount.archived,
                scannedTotal: scannedCount.total,
            });
        } else {
            Logger.info(
                LogModule.RAG_INJECT,
                "事件关键词扫描跳过：当前无归档事件",
            );
        }
    } else {
        Logger.debug(
            LogModule.RAG_INJECT,
            "事件关键词扫描已禁用或主开关关闭",
        );
    }

    // --- 将命中的事件转化为 ScoredEvent 格式，赋予高初始权重 ---
    const events: ScoredEvent[] = hitEvents.map((event) => ({
        id: event.id,
        summary: event.summary,
        // 关键词命中的基础分较高，确保在后续 Rerank 或截断时能占优
        keywordScore: 0.8,
        node: event,
    }));

    // --- 实体关系多跳 (Relation Multi-Hop)，输出为 RecalledEntity ---
    const entityScoreMap = new Map<string, number>(); // id -> score

    // 初始命中实体 (第一跳)
    for (const entity of hitEntities) {
        entityScoreMap.set(entity.id, 0.9); // 直接命中最高分
    }

    // 关系多跳 (第二跳)，衰减系数 0.8
    const hopAttenuation = 0.8;

    for (const seedEntity of hitEntities) {
        const relations = seedEntity.profile?.relations as
            | Record<string, any>
            | undefined;
        if (!relations) continue;

        const seedScore = entityScoreMap.get(seedEntity.id) || 0;
        const hopScore = seedScore * hopAttenuation;

        // 遍历声明的所有关联网
        for (const targetName of Object.keys(relations)) {
            const targetEntity = entityByName.get(targetName.toLowerCase());

            if (targetEntity) {
                const currentScore = entityScoreMap.get(targetEntity.id) || 0;
                if (hopScore > currentScore) {
                    entityScoreMap.set(targetEntity.id, hopScore);
                    Logger.debug(
                        LogModule.RAG_INJECT,
                        `[多跳联想] 由 ${seedEntity.name} 联想到了 ${targetEntity.name} (${
                            hopScore.toFixed(2)
                        })`,
                    );
                }
            }
        }
    }

    // 把 entity id + score 映射回实体节点，整形为 RecalledEntity。
    const entities: RecalledEntity[] = [...entityScoreMap.entries()]
        .map(([id, score]) => {
            const node = entityById.get(id);
            if (!node) return null;
            return {
                id: node.id,
                name: node.name,
                description: node.description,
                type: node.type,
                _recallWeight: score,
            } satisfies RecalledEntity;
        })
        .filter((e): e is RecalledEntity => e !== null)
        .toSorted((a, b) => b._recallWeight - a._recallWeight);

    const retrieveTime = Date.now() - startTime;
    Logger.debug(
        LogModule.RAG_INJECT,
        `关键词扫描完成，耗时 ${retrieveTime}ms。命中实体: ${hitEntities.length} 个，命中事件: ${hitEvents.length} 个`,
    );

    return { events, entities, retrieveTime };
}

// ============================================================================
// Stage 2: vector retrieve (port of VectorRetrieveStep)
// ============================================================================

export async function vectorRetrieve(
    input: VectorRetrieveInput,
    config: RecallConfig,
): Promise<VectorRetrieveResult> {
    const startTime = Date.now();

    // 如果未启用向量检索，则跳过 (但不清空 keyword 结果)
    if (!config.useEmbedding || !config.enabled) {
        Logger.debug(
            LogModule.RAG_INJECT,
            "向量检索未开启，跳过 vectorRetrieve",
        );
        return { candidates: [], retrieveTime: 0 };
    }

    const chatId = getCurrentChatId();
    if (!chatId) return { candidates: [], retrieveTime: 0 };

    const db = tryGetDbForChat(chatId);
    if (!db) return { candidates: [], retrieveTime: 0 };

    const threshold = config.embedding?.minScoreThreshold ?? 0.3;
    const topK = config.embedding?.topK || 20;

    // V1.4.1 Fix: 在嵌入前配置 Embedding 服务，防止 "config not set" 错误
    const vectorConfig = getSetting("apiSettings")?.vectorConfig;
    if (!vectorConfig) {
        Logger.warn(
            LogModule.RAG_RETRIEVE,
            "vectorRetrieve: 向量配置缺失，跳过向量检索",
        );
        return { candidates: [], retrieveTime: 0 };
    }
    embeddingService.setConfig(vectorConfig);

    // V1.0.3: 优先使用 unifiedQueries 第一条，否则使用 userInput
    const { query, unifiedQueries } = input;
    const isFallbackFromChat = !unifiedQueries ||
        unifiedQueries.length === 0;
    const rawQuery = !isFallbackFromChat ? unifiedQueries![0] : (query || "");

    // P2 Fix: 使用字符级安全的截断方式，防止 Emoji/多字节字符截断损坏
    const maxLength = isFallbackFromChat ? 300 : 500;
    const searchQuery = [...rawQuery].length > maxLength
        ? [...rawQuery].slice(0, maxLength).join("") + "..."
        : rawQuery;

    if ([...rawQuery].length > maxLength) {
        Logger.debug(
            LogModule.RAG_RETRIEVE,
            `vectorRetrieve: 查询过长，已裁剪至 ${maxLength} 字符`,
            {
                isFallback: isFallbackFromChat,
                originalLength: rawQuery.length,
            },
        );
    }

    // Generate query embedding, with preset-driven retry (replaces the engine).
    let queryVector: number[];
    try {
        queryVector = await retryWithBackoff(
            () => embeddingService.embed(searchQuery),
            getRetryConfig("vector"),
        );
    } catch (error: any) {
        Logger.warn(LogModule.RAG_RETRIEVE, "生成查询向量失败", {
            error: error.message,
        });
        throw error;
    }

    // 计算相似度并维护一个有界的 TopK 候选集。
    // 未满 topK 时直接入列；满后只有超过当前最低分才替换尾元素，最后统一排序。
    // Dexie 的 .each 仍会遍历全表，这里优化的是排序成本，而非内存占用。
    const candidates: ScoredEvent[] = [];
    let scannedEvents = 0;
    let embeddedEvents = 0;
    let matchedEvents = 0;

    await db.events.toCollection().each((event: any) => {
        scannedEvents += 1;

        if (!event.embedding || event.embedding.length === 0) {
            return;
        }

        embeddedEvents += 1;

        const similarity = embeddingService.cosineSimilarity(
            queryVector,
            event.embedding,
        );
        if (similarity < threshold) {
            return;
        }

        matchedEvents += 1;
        const candidate: ScoredEvent = {
            embeddingScore: similarity,
            id: event.id,
            node: event,
            summary: event.summary,
        };

        if (candidates.length < topK) {
            candidates.push(candidate);
            return;
        }

        // 满了：只在比当前最低分更高时替换尾元素。
        const tailScore = candidates.at(-1)?.embeddingScore || 0;
        if (similarity > tailScore) {
            candidates[candidates.length - 1] = candidate;
        }
    });

    // 单次排序定稿，避免在遍历中反复 sort。
    candidates.sort((a, b) =>
        (b.embeddingScore || 0) - (a.embeddingScore || 0)
    );

    const retrieveTime = Date.now() - startTime;

    Logger.debug(LogModule.RAG_INJECT, "向量检索完成", {
        candidateCount: candidates.length,
        embeddedEvents,
        matchedEvents,
        scannedEvents,
        threshold,
        topK,
    });

    return { candidates, retrieveTime };
}

// ============================================================================
// Stage 3: merge + rerank (port of RerankMergeStep)
// ============================================================================

export async function mergeAndRerank(
    keywordEvents: ScoredEvent[],
    vectorCandidates: ScoredEvent[],
    config: RecallConfig,
    input: MergeAndRerankInput,
): Promise<MergeAndRerankResult> {
    const startTime = Date.now();

    // 1. 合并向量检索和关键词检索的候选 (按 ID 去重，保留最高分)
    const candidateMap = new Map<string, ScoredEvent>();

    // 优先加载关键词候选
    for (const candidate of keywordEvents) {
        candidateMap.set(candidate.id, candidate);
    }

    // 合并向量候选，记录 embeddingScore
    for (const candidate of vectorCandidates) {
        if (candidateMap.has(candidate.id)) {
            // 如果已存在（被关键词命中），补充 embeddingScore
            const existing = candidateMap.get(candidate.id)!;
            existing.embeddingScore = candidate.embeddingScore;
        } else {
            candidateMap.set(candidate.id, candidate);
        }
    }

    const candidates = [...candidateMap.values()];

    if (candidates.length === 0) {
        Logger.info(
            LogModule.RAG_INJECT,
            "没有合并候选，跳过 mergeAndRerank",
        );
        return {
            candidates: [],
            originalCandidateCount: 0,
            rerankTime: 0,
            reranked: false,
        };
    }

    // P1 Fix: 二次 hard-limit，避免 KeywordRetrieve 的候选爆炸穿透到后续
    const hardLimit = effectiveEventTopK(config);
    const limitedCandidates = candidates.slice(0, Math.max(1, hardLimit));

    // 在重试机制介入前，预先设置好降级候选列表，以防多次尝试彻底失败后继续使用空结果
    let finalCandidates = scoreAndSort(limitedCandidates);
    let rerankTime = 0;
    let reranked = false;

    // 2. Rerank 重排序 (如果启用且服务可用)
    if (config.useRerank && rerankService.isEnabled()) {
        const rerankStart = Date.now();
        const { query, unifiedQueries } = input;
        const rerankQuery = unifiedQueries?.[0] || query || "";
        const documents = limitedCandidates.map((c) => c.summary);

        try {
            const rerankResults = await retryWithBackoff(
                () => rerankService.rerank(rerankQuery, documents),
                getRetryConfig("rerank"),
            );
            rerankTime = Date.now() - rerankStart;

            finalCandidates = mergeResults(
                new Map(limitedCandidates.map((c) => [c.id, c])),
                rerankResults,
                limitedCandidates,
            );
            reranked = true;
        } catch (error: any) {
            Logger.warn(
                LogModule.RAG_RETRIEVE,
                "Rerank 失败，使用 fallback 排序结果",
                { error: error.message },
            );
            // finalCandidates 已在重试前预置为 scoreAndSort 的降级结果
        }
    }

    Logger.debug(
        LogModule.RAG_INJECT,
        `Rerank/Merge 完成，最终事件候选: ${finalCandidates.length} 个`,
        {
            keyword: keywordEvents.length,
            vector: vectorCandidates.length,
            reranked,
        },
    );

    return {
        candidates: finalCandidates,
        originalCandidateCount: candidates.length,
        rerankTime,
        reranked,
    };
}
