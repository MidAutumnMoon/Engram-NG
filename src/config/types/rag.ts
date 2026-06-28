/**
 * RAG Configuration Schemas
 *
 * Schemas with `.default()` replace the old interface + DEFAULT_* constant pair.
 */

import { z } from "zod";

// Shared retry config (used by VectorConfig and RerankConfig)
const retryConfigSchema = z.object({
    maxAttempts: z.number().int().positive(),
    retryDelay: z.number().int().nonnegative(),
});

// ==================== Vector Config ====================

/**
 * 向量源。Engram 仅实际使用 OpenAI 兼容嵌入协议：
 * - `custom`：自定义 OpenAI 兼容端点（用户填写 URL/Key/Model）。
 * - `openai`：OpenAI 官方端点（预设默认值，仅需 Key/Model）。
 *
 * 历史上还曾列出 transformers/ollama/vllm/jina/voyage 等源，但本地
 * transformers 从无实现，其余源实际只走 OpenAI 兼容协议，故已统一移除。
 * schema 用 .catch 把旧存的任意值收敛为 "custom"，避免 Zod 解析抛错。
 */
export const vectorConfigSchema = z.object({
    source: z.enum(["custom", "openai"]).default("custom").catch("custom"),
    /** API 端点（custom 必填；openai 留空走官方默认） */
    apiUrl: z.string().optional(),
    /** API Key */
    apiKey: z.string().optional(),
    /** 模型名称 */
    model: z.string().optional(),
    /** 向量维度 */
    dimensions: z.number().int().positive().optional(),
    /** 自动添加 URL 后缀 (默认 true) */
    autoSuffix: z.boolean().optional(),
    /** API 调用重试配置 */
    retryConfig: retryConfigSchema.optional(),
});

export type VectorConfig = z.infer<typeof vectorConfigSchema>;
export type VectorSource = VectorConfig["source"];

// ==================== Rerank Config ====================

export const rerankConfigSchema = z.object({
    /** 是否启用 */
    enabled: z.boolean().default(false),
    /** API 端点 */
    url: z.string().default(""),
    /** API Key */
    apiKey: z.string().default(""),
    /** 模型名称 */
    model: z.string().default(""),
    /** 返回的结果数量 */
    topN: z.number().int().positive().default(5),
    /** 自动添加 URL 后缀 (默认 true) */
    autoSuffix: z.boolean().optional(),
    /** API 调用重试配置 */
    retryConfig: retryConfigSchema.optional(),
});

export type RerankConfig = z.infer<typeof rerankConfigSchema>;

// ==================== Recall Config ====================

export const recallConfigSchema = z.object({
    /** 是否启用 RAG 召回系统 (总开关) */
    enabled: z.boolean().default(true),

    /** 策略 1: 是否使用 Embedding 语义检索 */
    useEmbedding: z.boolean().default(true),

    /** 策略 2: 是否使用 Rerank 重排序 */
    useRerank: z.boolean().default(false),

    /** 策略 5: 是否使用关键词召回 (0 消耗模式) */
    useKeywordRecall: z.boolean().default(true),

    /** 关键词召回细分：是否检索实体 (默认 true) */
    enableEntityKeyword: z.boolean().default(true),

    /** 关键词召回细分：是否检索事件 (默认 true) */
    enableEventKeyword: z.boolean().default(true),

    /**
     * P1 Fix: 关键词召回硬上限 (Hard TopK)
     * - 防止关键词召回候选爆炸
     */
    keywordTopK: z.object({
        /** 关键词命中的事件上限 */
        events: z.number().int().positive(),
        /** 关键词命中的实体上限 */
        entities: z.number().int().positive(),
    }).default({ events: 50, entities: 30 }),

    /** Embedding 详细配置 */
    embedding: z.object({
        topK: z.number().int().positive(),
        minScoreThreshold: z.number(),
    }).default({ topK: 50, minScoreThreshold: 0.35 }),
});

export type RecallConfig = z.infer<typeof recallConfigSchema>;

/**
 * 召回预览项——供 RecallDecisionModal 审阅检索结果。
 * 历史上复用 AgenticRecall（LLM 钦定召回 DTO）；Agentic RAG 退役后，
 * 混合/向量检索的预览结果仍需一个统一的「带分数+来源说明」的展示契约，故保留同形类型。
 * 概念备份见 dev-docs/AgenticRAG-concept.md。
 */
export interface RecallPreviewItem {
    /** 事件 ID */
    id: string;
    /** 命中来源说明（如 "Rerank 优化命中" / "向量检索 (TopK) 命中"） */
    reason: string;
    /** 相关性分数 (0-1) */
    score: number;
}

// ==================== Embedding Config ====================

export const embeddingConfigSchema = z.object({
    /** 是否启用嵌入 */
    enabled: z.boolean().default(false),
    /** 触发器类型 */
    trigger: z.enum(["with_trim", "standalone", "manual"]).default("with_trim"),
    /** 并发数 (1-20) */
    concurrency: z.number().int().min(1).max(20).default(5),
    /** 保留最近 N 条不嵌入 (与 Trim.keepRecentCount 共享) */
    keepRecentCount: z.number().int().nonnegative().default(3),
});

export type EmbeddingConfig = z.infer<typeof embeddingConfigSchema>;
export type EmbeddingTriggerType = EmbeddingConfig["trigger"];

// ==================== Derived defaults ====================

export const DEFAULT_VECTOR_CONFIG: VectorConfig = vectorConfigSchema.parse({});
export const DEFAULT_RERANK_CONFIG: RerankConfig = rerankConfigSchema.parse({});
export const DEFAULT_RECALL_CONFIG: RecallConfig = recallConfigSchema.parse({});
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = embeddingConfigSchema
    .parse({});
