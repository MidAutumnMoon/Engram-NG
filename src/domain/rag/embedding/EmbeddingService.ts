/**
 * Embedding pipeline — module-level functions.
 *
 * Supports concurrent batched embedding of EventNode text via configurable
 * vector APIs. Functions are pure with respect to instance state: callers
 * pass the {@link VectorConfig} explicitly each call (no configure-then-use
 * ritual), and long batches accept an optional {@link CancelSignal} so the
 * caller can bail out mid-run.
 */

import type { VectorConfig } from "@/config/types/rag.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getDbForChat, tryGetDbForChat } from "@/data/db.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { generateEmbedding } from "@/integrations/embedding/EmbeddingClient.ts";
import { getCurrentChatId } from "@/sillytavern/context.ts";
import { type CancelSignal, isCancelled } from "@/utils/cancel.ts";

// ==================== 类型定义 ====================

/** 嵌入请求 */
interface EmbedRequest {
    id: string;
    text: string;
}

/** 嵌入结果 */
interface EmbedResult {
    id: string;
    embedding: number[];
    error?: string;
}

/** 嵌入进度回调 */
type EmbedProgressCallback = (
    current: number,
    total: number,
    errors: number,
) => void;

/** Batch operations share this options bag. */
interface EmbedOpts {
    concurrency?: number;
    onProgress?: EmbedProgressCallback;
    signal?: CancelSignal;
}

// ==================== 常量 ====================

/** 默认并发数 */
const DEFAULT_CONCURRENCY = 5;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 20;

/** Normalize a raw concurrency value into [1, 20], defaulting to 5. */
function resolveConcurrency(n?: number): number {
    const val = typeof n === "number" && !isNaN(n) ? n : DEFAULT_CONCURRENCY;
    return Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, val));
}

/** Filter events to those whose source_range falls within `[start, end]`. */
function filterByRange(
    events: EventNode[],
    range?: { start?: number; end?: number },
): EventNode[] {
    if (!range) return events;
    return events.filter((e) => {
        const { start_index, end_index } = e.source_range;
        if (range.start !== undefined && start_index < range.start) {
            return false;
        }
        if (range.end !== undefined && end_index > range.end) {
            return false;
        }
        return true;
    });
}

// ==================== 核心嵌入 ====================

/** 生成单个文本的嵌入向量。config 由调用方显式传入。 */
export async function embed(
    text: string,
    config: VectorConfig,
): Promise<number[]> {
    const results = await embedBatch([{ id: "single", text }], config);
    if (results[0].error) {
        throw new Error(results[0].error);
    }
    return results[0].embedding;
}

/**
 * 批量生成嵌入 (支持并发控制)。
 *
 * `config` 是必填参数 —— 原先的 "config not set" 运行时错误由此被编译期保证。
 * `opts.signal` 在批与批之间被检查；置位后尽快返回（已派发的那一批仍会跑完）。
 */
export async function embedBatch(
    requests: EmbedRequest[],
    config: VectorConfig,
    opts: EmbedOpts = {},
): Promise<EmbedResult[]> {
    const concurrency = resolveConcurrency(opts.concurrency);
    const results: EmbedResult[] = Array.from({ length: requests.length });
    let completed = 0;
    let errors = 0;

    // 并发处理
    const worker = async (index: number) => {
        if (index >= requests.length || isCancelled(opts.signal)) return;

        const req = requests[index];
        try {
            const embedding = await generateEmbedding(req.text, config);
            results[index] = { embedding, id: req.id };
        } catch (error: any) {
            errors++;
            results[index] = {
                id: req.id,
                embedding: [],
                error: error.message,
            };
            Logger.warn(LogModule.RAG_EMBED, `嵌入失败: ${req.id}`, {
                error: error.message,
            });
        } finally {
            completed++;
            opts.onProgress?.(completed, requests.length, errors);
        }
    };

    // 分批并发
    for (let i = 0; i < requests.length; i += concurrency) {
        if (isCancelled(opts.signal)) break;
        const batch = Array.from(
            { length: Math.min(concurrency, requests.length - i) },
            (_, j) => worker(i + j),
        );
        await Promise.all(batch);
    }

    return results;
}

// ==================== EventNode 批量嵌入 ====================

/**
 * 为未嵌入的 EventNode 生成嵌入。
 * @returns 成功/失败计数
 */
export async function embedUnprocessedEvents(
    config: VectorConfig,
    opts: EmbedOpts & { range?: { start?: number; end?: number } } = {},
): Promise<{ success: number; failed: number }> {
    const chatId = getCurrentChatId();
    if (!chatId) {
        throw new Error("No current chat");
    }

    const db = getDbForChat(chatId);

    // 获取未嵌入的事件 (V1.2.2: 仅处理 Level 0 事件，大纲节点不进行向量化)
    let events = await db.events
        .filter((e) => e.level === 0 && !e.is_embedded && !e.embedding)
        .toArray();

    events = filterByRange(events, opts.range);

    if (events.length === 0) {
        return { failed: 0, success: 0 };
    }

    Logger.info(LogModule.RAG_EMBED, `开始嵌入 ${events.length} 个事件`);

    const requests: EmbedRequest[] = events.map((e) => ({
        id: e.id,
        text: e.summary,
    }));

    const results = await embedBatch(requests, config, opts);

    let success = 0;
    let failed = 0;
    for (const result of results) {
        if (!result || result.error || result.embedding.length === 0) {
            failed++;
            continue;
        }
        await db.events.update(result.id, {
            embedding: result.embedding,
            is_embedded: true,
        });
        success++;
    }

    Logger.info(
        LogModule.RAG_EMBED,
        `嵌入完成: ${success} 成功, ${failed} 失败`,
    );
    return { failed, success };
}

/** 为指定的 EventNode 列表生成嵌入。 */
export async function embedEvents(
    events: EventNode[],
    config: VectorConfig,
    opts: EmbedOpts = {},
): Promise<{ success: number; failed: number }> {
    if (events.length === 0) {
        return { failed: 0, success: 0 };
    }

    const chatId = getCurrentChatId();
    if (!chatId) throw new Error("No current chat");
    const db = getDbForChat(chatId);

    const requests: EmbedRequest[] = events.map((e) => ({
        id: e.id,
        text: e.summary,
    }));

    const results = await embedBatch(requests, config, opts);

    let success = 0;
    let failed = 0;
    for (const result of results) {
        if (!result || result.error || result.embedding.length === 0) {
            failed++;
            continue;
        }
        await db.events.update(result.id, {
            embedding: result.embedding,
            is_embedded: true,
        });
        success++;
    }

    return { failed, success };
}

/**
 * 重新嵌入所有事件 (模型切换后使用)。
 * 先清空范围内事件的嵌入标记，再走 {@link embedEvents}。
 */
export async function reembedAllEvents(
    config: VectorConfig,
    opts: EmbedOpts & { range?: { start?: number; end?: number } } = {},
): Promise<{ success: number; failed: number }> {
    const chatId = getCurrentChatId();
    if (!chatId) {
        throw new Error("No current chat");
    }

    const db = getDbForChat(chatId);

    // 获取所有事件 (V1.2.2: 仅处理 Level 0 事件)
    let events = await db.events.filter((e) => e.level === 0).toArray();
    events = filterByRange(events, opts.range);

    if (events.length === 0) {
        return { failed: 0, success: 0 };
    }

    Logger.info(LogModule.RAG_EMBED, `重新嵌入 ${events.length} 个事件`);

    // 清空选定范围内现有嵌入标记
    for (const event of events) {
        await db.events.update(event.id, {
            embedding: undefined,
            is_embedded: false,
        });
    }

    return embedEvents(events, config, opts);
}

// ==================== 工具方法 (纯函数) ====================

/** 计算向量范数平方 (L2)。返回平方和，调用方自行 sqrt 以保持灵活性。 */
export function computeNorm(vec: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
        sum += vec[i] * vec[i];
    }
    return sum;
}

/**
 * 计算余弦相似度。
 * 支持传入预计算的范数平方以避免重复计算。
 */
export function cosineSimilarity(
    vecA: number[],
    vecB: number[],
    normSqA?: number,
    normSqB?: number,
): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dot = 0;
    let nA = normSqA ?? 0;
    let nB = normSqB ?? 0;

    const calcA = normSqA === undefined;
    const calcB = normSqB === undefined;

    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        if (calcA) nA += vecA[i] * vecA[i];
        if (calcB) nB += vecB[i] * vecB[i];
    }

    const denom = Math.sqrt(nA) * Math.sqrt(nB);
    return denom === 0 ? 0 : dot / denom;
}

/** 获取当前聊天的嵌入统计信息。 */
export async function getEmbeddingStats(): Promise<{
    total: number;
    embedded: number;
    pending: number;
}> {
    const chatId = getCurrentChatId();
    if (!chatId) {
        return { embedded: 0, pending: 0, total: 0 };
    }

    const db = tryGetDbForChat(chatId);
    if (!db) {
        return { embedded: 0, pending: 0, total: 0 };
    }

    const events = await db.events.toArray();
    const embedded = events.filter((e) => e.is_embedded).length;

    return {
        embedded,
        pending: events.length - embedded,
        total: events.length,
    };
}
