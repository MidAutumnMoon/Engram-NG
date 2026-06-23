/**
 * RAG Configuration Schemas
 *
 * Schemas with `.default()` replace the old interface + DEFAULT_* constant pair.
 * `AgenticRecall` is an LLM-output DTO.
 */

import { z } from "zod";

// Shared retry config (used by VectorConfig and RerankConfig)
const retryConfigSchema = z.object({
    maxAttempts: z.number().int().positive(),
    retryDelay: z.number().int().nonnegative(),
});

// ==================== Vector Config ====================

export const vectorConfigSchema = z.object({
    /** 向量源 */
    source: z.enum([
        "transformers", // 本地 transformers
        "openai", // OpenAI Embeddings API
        "ollama", // Ollama
        "vllm", // VLLM
        "cohere", // Cohere
        "jina", // Jina AI
        "voyage", // Voyage AI
        "custom", // 自定义 (OpenAI 兼容)
    ]).default("transformers"),
    /** API 端点（部分源需要） */
    apiUrl: z.string().optional(),
    /** API Key（部分源需要） */
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
    /** 混合评分权重 (0-1, 0=纯向量, 1=纯Rerank) */
    hybridAlpha: z.number().min(0).max(1).default(0.5),
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

    /** 策略 3: 是否使用 LLM 预处理 (Query 增强/剧情编排) */
    usePreprocessing: z.boolean().default(false),

    /** 策略 4: 是否使用 Agentic RAG (LLM 裁判式召回) */
    useAgenticRAG: z.boolean().default(false),

    /** 策略 5: 是否使用关键词召回 (0 消耗模式) */
    useKeywordRecall: z.boolean().default(true),

    /** 关键词召回细分：是否检索实体 (默认 true) */
    enableEntityKeyword: z.boolean().default(true),

    /** 关键词召回细分：是否检索事件 (默认 true) */
    enableEventKeyword: z.boolean().default(true),

    /**
     * P1 Fix: 关键词召回硬上限 (Hard TopK)
     * - 防止 KeywordRetrieveStep 候选爆炸
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

/** Agentic RAG 召回条目 (LLM 输出 DTO) */
export const agenticRecallSchema = z.object({
    /** 事件短 UUID (如 evt_a1b2c3d4) */
    id: z.string(),
    /** LLM 赋予的重要性评分 (0.0 - 1.0) */
    score: z.number().min(0).max(1),
    /** 召回理由 */
    reason: z.string(),
});

export type AgenticRecall = z.infer<typeof agenticRecallSchema>;

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
