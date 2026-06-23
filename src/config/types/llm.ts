/**
 * LLM Configuration Schemas
 */

import { z } from "zod";

// ==================== API Source ====================

export const apiSourceSchema = z.enum([
    "openai",
    "anthropic",
    "ollama",
    "vllm",
    "azure",
    "custom",
]);
export type APISource = z.infer<typeof apiSourceSchema>;

// ==================== Custom API Config ====================

export const customApiConfigSchema = z.object({
    /** API 端点 URL */
    apiUrl: z.string(),
    /** API Key */
    apiKey: z.string(),
    /** 模型名称 */
    model: z.string(),
    /** API 类型/协议 */
    apiSource: apiSourceSchema,
});

export type CustomAPIConfig = z.infer<typeof customApiConfigSchema>;

// ==================== Sampling Parameters ====================

export const samplingParametersSchema = z.object({
    /** 温度 (0-2) */
    temperature: z.number().default(1.0),
    /** Top-P 采样 (0-1) */
    topP: z.number().default(0.98),
    /** Top-K 采样 (建议默认 60，用于截断极低概率标记) */
    topK: z.number().int().optional(),
    /** 最大输出 tokens */
    maxTokens: z.number().int().positive().default(60000),
    /** 频率惩罚 (-2 到 2) */
    frequencyPenalty: z.number().default(0),
    /** 存在惩罚 (-2 到 2) */
    presencePenalty: z.number().default(0),
    /** 上下文 Token 上限 (可选，用于控制大模型的 max_context) */
    maxContext: z.number().int().positive().default(150000),
});

export type SamplingParameters = z.infer<typeof samplingParametersSchema>;

// ==================== Context Settings ====================

export const contextSettingsSchema = z.object({
    /** 使用多少条聊天历史 (-1 表示全部) */
    maxChatHistory: z.number().int().nonnegative().default(10),
});

export type ContextSettings = z.infer<typeof contextSettingsSchema>;

// ==================== LLM Preset ====================

export const llmPresetSchema = z.object({
    /** 唯一标识 */
    id: z.string().default(() => `preset_${Date.now()}`),
    /** 预设名称 */
    name: z.string().default("默认预设"),
    /** 配置源：使用酒馆当前配置、酒馆的 connection_profile 或自定义 */
    source: z.enum(["tavern", "tavern_profile", "custom"]).default("tavern"),
    /** 选择的酒馆 connection_profile ID（仅当 source === 'tavern_profile' 时有效） */
    tavernProfileId: z.string().optional(),
    /** 自定义 API 配置（仅当 source === 'custom' 时有效） */
    custom: customApiConfigSchema.optional(),
    /** 在 source: 'tavern' 时用于临时覆盖大模型名称，若为空则不覆盖 */
    modelOverride: z.string().optional(),
    /** 是否开启流式传输 (兼容强制要求 stream 选项的端点) */
    stream: z.boolean().optional(),
    /** 模型采样参数 */
    parameters: samplingParametersSchema.prefault({}),
    /** 上下文设置 */
    context: contextSettingsSchema.prefault({}),
    /** 是否为默认预设 */
    isDefault: z.boolean().default(true),
    /** 创建时间 */
    createdAt: z.number().default(() => Date.now()),
    /** 更新时间 */
    updatedAt: z.number().default(() => Date.now()),
    /** API 调用重试配置 */
    retryConfig: z.object({
        maxAttempts: z.number().int().positive(),
        retryDelay: z.number().int().nonnegative(),
    }).optional(),
});

export type LLMPreset = z.infer<typeof llmPresetSchema>;
