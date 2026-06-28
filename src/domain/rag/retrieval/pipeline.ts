/**
 * Retrieval pipeline — typed stage functions for keyword + vector recall and
 * rerank/merge. Each stage is a plain function with typed inputs and outputs;
 * stages communicate via explicit return values instead of a stringly-typed
 * context bag, so the contract between them is compile-checked.
 *
 * Behaviour:
 * - Keyword: composite scan text (history + intent + LLM queries), scans ALL
 *   events + ALL entities (no is_archived gate — that's trim's flag, not a
 *   recall-eligibility signal), per-stream TopK, relation multi-hop (attenuation 0.8).
 * - Vector: embedding similarity, bounded TopK insert, char-safe truncation,
 *   preset-driven retry on 429 / rate-limit / timeout / network.
 * - Rerank/Merge: dedup-by-id, hard-limit, rerank-with-fallback.
 *
 * Eligibility vs dedup: retrieval returns *candidates*; the injection layer
 * decides what to render and dedups against the current/timeline blocks.
 *
 * Entity recall is *resurrected* here: the keyword stage returns the multi-hop
 * entity results as shaped `RecalledEntity[]`, so the "已唤醒实体" panel and
 * recall log actually populate.
 *
 * Fusion formula lives in `Scorer`: `max(embedding, keyword) + rerank`.
 *
 * Config source of truth: every stage takes a fully-resolved `RecallConfig` and
 * trusts it — no stage re-reads global settings. The caller (`Retriever`) owns
 * the single `getSetting("apiSettings").recallConfig` resolution.
 */

import type { RecallConfig } from "@/config/types/rag.ts";
import { getSetting } from "@/config/settings.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { tryGetDbForChat } from "@/data/db.ts";
import { getCurrentChatId } from "@/sillytavern/context.ts";
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
import type { EntityNode, EventNode } from "@/data/types/graph.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Entity surfaced by keyword recall. Shaped to match the fields the recall UI
 * already reads (RecallLog): `id` (key), `name` (label),
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
    /** Enhanced scan text (history-augmented, pre-merged by the caller). */
    scanQuery?: string;
    /** LLM-suggested expert terms (boost). */
    unifiedQueries?: string[];
}

export interface KeywordRetrieveResult {
    /** Keyword-hit events as ScoredEvent (keywordScore = KEYWORD_HIT_SCORE). */
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
// Tuning constants
// ============================================================================

/** Score assigned to keyword-hit events. High base so they survive rerank/trim. */
const KEYWORD_HIT_SCORE = 0.8;
/** Score assigned to directly-matched entities (first hop). */
const DIRECT_ENTITY_SCORE = 0.9;
/** Second-hop score attenuation: hopScore = seedScore × this. */
const HOP_ATTENUATION = 0.8;
/** Default entity TopK when config.keywordTopK.entities is unset. */
const DEFAULT_ENTITY_TOPK = 30;
/** Default vector TopK when config.embedding.topK is unset. */
const DEFAULT_VECTOR_TOPK = 20;
/** Default vector similarity threshold when config.embedding.minScoreThreshold is unset. */
const DEFAULT_VECTOR_THRESHOLD = 0.3;
/** Char cap for the vector query when falling back to raw user input. */
const QUERY_MAX_CHARS_FALLBACK = 300;
/** Char cap for the vector query when a preprocessed query is available. */
const QUERY_MAX_CHARS_PREPROCESSED = 500;

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
 * Relation multi-hop expansion: from each seed entity, walk its declared
 * relations (`profile.relations`, keyed by target entity name — see
 * `entity_extraction.yaml`) one hop out, scoring each reached entity by the
 * seed score attenuated by `HOP_ATTENUATION`. Higher scores win.
 *
 * @returns id -> accumulated score, including the seeds themselves.
 */
function expandMultiHop(
    seeds: EntityNode[],
    aliasIndex: Map<string, EntityNode>,
): Map<string, number> {
    const scores = new Map<string, number>();

    // 第一跳：直接命中的种子实体。
    for (const entity of seeds) {
        scores.set(entity.id, DIRECT_ENTITY_SCORE);
    }

    // 第二跳：沿声明的关系外扩，分数衰减。
    for (const seedEntity of seeds) {
        const relations = seedEntity.profile?.relations as
            | Record<string, unknown>
            | undefined;
        if (!relations) continue;

        const seedScore = scores.get(seedEntity.id) || 0;
        const hopScore = seedScore * HOP_ATTENUATION;

        for (const targetName of Object.keys(relations)) {
            const targetEntity = aliasIndex.get(targetName.toLowerCase());
            if (!targetEntity) continue;

            const currentScore = scores.get(targetEntity.id) || 0;
            if (hopScore > currentScore) {
                scores.set(targetEntity.id, hopScore);
                Logger.debug(
                    LogModule.RAG_INJECT,
                    `[多跳联想] 由 ${seedEntity.name} 联想到了 ${targetEntity.name} (${
                        hopScore.toFixed(2)
                    })`,
                );
            }
        }
    }

    return scores;
}

// ============================================================================
// Stage 1: keyword retrieve
// ============================================================================

export async function keywordRetrieve(
    input: KeywordRetrieveInput,
    config: RecallConfig,
): Promise<KeywordRetrieveResult> {
    const startTime = Date.now();

    const { query, scanQuery, unifiedQueries } = input;

    // V1.4.15: 综合扫描方案 - 始终包含基础上下文，叠加 LLM 查询词
    const scanParts: string[] = [];
    if (scanQuery) scanParts.push(scanQuery);
    if (query) scanParts.push(query);
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

    const eventTopK = effectiveEventTopK(config);
    const entityTopK = config.keywordTopK?.entities ?? DEFAULT_ENTITY_TOPK;

    // 一次性拉取实体并构建查找索引：id -> 节点、(name|alias 小写) -> 节点。
    // 复用给命中过滤、多跳联想和最终的 RecalledEntity 整形。
    const allEntities = await db.entities.toArray();
    const entityById = new Map<string, EntityNode>(
        allEntities.map((e) => [e.id, e]),
    );
    const entityByName = new Map<string, EntityNode>();
    for (const e of allEntities) {
        entityByName.set(e.name.toLowerCase(), e);
        for (const alias of e.aliases ?? []) {
            entityByName.set(alias.toLowerCase(), e);
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
    let hitEntities: EntityNode[] = [];
    const hitEvents: EventNode[] = [];

    if (config.enableEntityKeyword !== false) {
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

    // --- 事件扫描：扫描所有事件（不再按 is_archived 过滤）。
    // is_archived 是 trim/budget 的标志，不是召回资格——所有事件都可被关键词命中。
    // 去重（避免与 timeline 重复）由注入层显式处理，不在检索层做。
    // Recency 由下游 flashback 阈值处理，扫描只产出候选。
    if (
        config.useKeywordRecall !== false &&
        config.enableEventKeyword !== false
    ) {
        const scannedCount = { matched: 0, total: 0 };
        await db.events.toCollection().each((event) => {
            scannedCount.total += 1;

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
            scannedTotal: scannedCount.total,
        });
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
        keywordScore: KEYWORD_HIT_SCORE,
        node: event,
    }));

    // --- 实体关系多跳 (Relation Multi-Hop)，输出为 RecalledEntity ---
    const entityScoreMap = expandMultiHop(hitEntities, entityByName);

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
// Stage 2: vector retrieve
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

    const threshold = config.embedding?.minScoreThreshold ??
        DEFAULT_VECTOR_THRESHOLD;
    const topK = config.embedding?.topK || DEFAULT_VECTOR_TOPK;

    // V1.4.1 Fix: 在嵌入前配置 Embedding 服务，防止 "config not set" 错误。
    // vectorConfig 不在 RecallConfig 内 (它在 apiSettings 顶层)，这里必须读全局。
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
    const maxLength = isFallbackFromChat
        ? QUERY_MAX_CHARS_FALLBACK
        : QUERY_MAX_CHARS_PREPROCESSED;
    const rawChars = [...rawQuery];
    const searchQuery = rawChars.length > maxLength
        ? rawChars.slice(0, maxLength).join("") + "..."
        : rawQuery;

    if (rawChars.length > maxLength) {
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

    await db.events.toCollection().each((event) => {
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
// Stage 3: merge + rerank
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
        const existing = candidateMap.get(candidate.id);
        if (existing) {
            // 如果已存在（被关键词命中），补充 embeddingScore
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
    const limitedById = new Map(limitedCandidates.map((c) => [c.id, c]));

    // 在重试机制介入前，预先设置好降级候选列表，以防多次尝试彻底失败后继续使用空结果。
    // limitedById 被 scoreAndSort 与 mergeResults 共用——后者会就地写入 rerankScore。
    let finalCandidates = scoreAndSort([...limitedById.values()]);
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
                limitedById,
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
