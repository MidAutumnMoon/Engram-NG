/**
 * Prompt / Worldbook Configuration Schemas
 */

import { z } from "zod";

// ==================== Prompt Category ====================

export const promptCategorySchema = z.enum([
    "summary", // 剧情摘要 (V0.5 统一为 JSON 输出)
    "trim", // 精简/修剪
    "entity_extraction", // V0.9: 实体提取
    "entity_resolve", // 实体解析（episode-as-source-of-truth：合并重复实体）
]);
export type PromptCategory = z.infer<typeof promptCategorySchema>;

export const PROMPT_CATEGORIES: {
    value: PromptCategory;
    label: string;
    description: string;
}[] = [
    {
        description: "将对话转为结构化 JSON 事件",
        label: "剧情摘要",
        value: "summary",
    },
    {
        description: "合并、压缩旧的事件记录",
        label: "精简/修剪",
        value: "trim",
    },
    {
        description: "从事件中提取角色、地点、物品等实体",
        label: "实体提取",
        value: "entity_extraction",
    },
    {
        description: "判断新实体是否与现有实体重复并合并",
        label: "实体解析",
        value: "entity_resolve",
    },
];

// ==================== Prompt Template ====================

export const promptTemplateSchema = z.object({
    id: z.string().default(
        () =>
            `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ),
    name: z.string(),
    category: promptCategorySchema,
    systemPrompt: z.string().default(""),
    userPromptTemplate: z.string().default(""),
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
});

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

// ==================== Export DTOs ====================

// 导出时排除: id, createdAt, updatedAt
const promptTemplateExportShape = {
    name: z.string(),
    category: promptCategorySchema,
    systemPrompt: z.string(),
    userPromptTemplate: z.string(),
};

export const promptTemplateSingleExportSchema = z.object(
    promptTemplateExportShape,
);
export type PromptTemplateSingleExport = z.infer<
    typeof promptTemplateSingleExportSchema
>;

export const promptTemplateExportSchema = z.object({
    version: z.string(),
    exportedAt: z.number(),
    templates: z.array(promptTemplateSingleExportSchema),
});
export type PromptTemplateExport = z.infer<typeof promptTemplateExportSchema>;

// ==================== Worldbook Config ====================

export const worldbookConfigSchema = z.object({
    enabled: z.boolean().default(true),
    includeGlobal: z.boolean().default(true),
    disabledWorldbooks: z.array(z.string()).default(["engram"]),
    disabledEntries: z.record(z.string(), z.array(z.number().int())).optional(),
});

export type WorldbookConfig = z.infer<typeof worldbookConfigSchema>;

// ==================== Worldbook Config Profile ====================

export const worldbookConfigProfileSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(), // For future LLM routing
    mode: z.enum(["inherit_global", "custom"]),
    selectedWorldbooks: z.array(z.string()).default([]), // Whitelist of worldbook names
    createdAt: z.number().default(() => Date.now()),
    updatedAt: z.number().default(() => Date.now()),
});

export type WorldbookConfigProfile = z.infer<
    typeof worldbookConfigProfileSchema
>;

// ==================== Derived defaults ====================

export const DEFAULT_WORLDBOOK_CONFIG: WorldbookConfig = worldbookConfigSchema
    .parse({});
