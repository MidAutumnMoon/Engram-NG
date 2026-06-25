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

// ==================== Custom Macro ====================

export const customMacroSchema = z.object({
    /** 唯一标识 */
    id: z.string(),
    /** 宏名称（不含花括号，如 "用户画像"） */
    name: z.string(),
    /** 宏内容 */
    content: z.string(),
    /** 是否启用 */
    enabled: z.boolean(),
    /** 创建时间 */
    createdAt: z.number(),
});

export type CustomMacro = z.infer<typeof customMacroSchema>;

// ==================== Prompt Template ====================

const injectionModeSchema = z.enum(["replace", "append", "prepend"]);

export const promptTemplateSchema = z.object({
    /** 唯一标识 */
    id: z.string().default(
        () =>
            `template_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ),
    /** 模板名称 */
    name: z.string(),
    /** 模板分类 */
    category: promptCategorySchema,
    /** 是否启用（每个分类可以有多个模板，但只有一个启用的会被使用） */
    enabled: z.boolean().default(false),
    /** 是否为内置模板（内置模板不可删除） */
    isBuiltIn: z.boolean().default(false),
    /** 绑定的 LLM 预设 ID，null 表示使用默认预设 */
    boundPresetId: z.string().nullable().default(null),
    /** V1.2.8: 直接绑定的额外世界书列表（导出时会被排除） */
    extraWorldbooks: z.array(z.string()).optional(),
    /** 系统提示词 */
    systemPrompt: z.string().default(""),
    /** 用户提示词模板，支持变量 {{chatHistory}}, {{context}} 等 */
    userPromptTemplate: z.string().default(""),
    /** 注入模式: 'replace'=覆盖用户输入, 'append'=追加到用户输入之后, 'prepend'=添加到用户输入之前 */
    injectionMode: injectionModeSchema.optional(),
    /** 创建时间 */
    createdAt: z.number().default(() => Date.now()),
    /** 更新时间 */
    updatedAt: z.number().default(() => Date.now()),
});

export type PromptTemplate = z.infer<typeof promptTemplateSchema>;

// ==================== Export DTOs ====================

// 导出时排除: id, isBuiltIn, enabled, createdAt, updatedAt, extraWorldbooks
const promptTemplateExportShape = {
    name: z.string(),
    category: promptCategorySchema,
    boundPresetId: z.string().nullable(),
    systemPrompt: z.string(),
    userPromptTemplate: z.string(),
    injectionMode: injectionModeSchema.optional(),
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
    // V1.2.8: 导出时排除 extraWorldbooks（可能包含私人信息）
    templates: z.array(promptTemplateSingleExportSchema),
});
export type PromptTemplateExport = z.infer<typeof promptTemplateExportSchema>;

// ==================== Worldbook Config ====================

export const worldbookConfigSchema = z.object({
    /** 是否启用世界书 */
    enabled: z.boolean().default(true),
    /** 是否包含全局世界书（相当于全选/全不选） */
    includeGlobal: z.boolean().default(true),
    /** 全局世界书黑名单（被禁用的世界书名称列表） */
    disabledWorldbooks: z.array(z.string()).default(["engram"]),
    /** 全局条目黑名单 (V1.3 替代弃用的 state.ts) */
    disabledEntries: z.record(z.string(), z.array(z.number().int())).optional(),
    /** 是否启用 EJS 模板 (ST-Prompt-Template 兼容) */
    enableEJS: z.boolean().default(true),
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
