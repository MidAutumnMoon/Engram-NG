/**
 * Data Processing Configuration Schemas
 *
 * `REGEX_SCOPE_OPTIONS` and `DEFAULT_REGEX_RULES` are UI metadata / seed data
 * (not validation defaults), so they stay as constants — they just reference
 * `z.infer` types instead of hand-written unions.
 */

import { z } from "zod";

// ==================== Regular Expression Rules ====================

export const regexScopeSchema = z.enum(["input", "output", "both"]);
export type RegexScope = z.infer<typeof regexScopeSchema>;

export const regexRuleSchema = z.object({
    /** 唯一 ID */
    id: z.string(),
    /** 规则名称 */
    name: z.string(),
    /** 正则表达式 */
    pattern: z.string(),
    /** 替换文本 */
    replacement: z.string(),
    /** 是否启用 */
    enabled: z.boolean(),
    /** 正则标志 (g, i, m, s) */
    flags: z.string(),
    /** 作用域：input=清洗发给LLM的内容，output=清洗LLM返回的内容，both=两者都应用 */
    scope: regexScopeSchema,
    /** 描述 */
    description: z.string().optional(),
});

export type RegexRule = z.infer<typeof regexRuleSchema>;

/** 作用域选项 (UI 常量) */
export const REGEX_SCOPE_OPTIONS: {
    value: RegexScope;
    label: string;
    description: string;
}[] = [
    { description: "清洗发给 LLM 的聊天内容", label: "输入", value: "input" },
    {
        description: "清洗 LLM 返回的内容（预览/写入前）",
        label: "输出",
        value: "output",
    },
    { description: "输入和输出都应用", label: "两者", value: "both" },
];

/** 默认正则规则 (seed data) */
export const DEFAULT_REGEX_RULES: RegexRule[] = [
    {
        description:
            "移除 LLM 输出中的 <think>...</think> 或 <thinking>...</thinking> 思考过程",
        enabled: true,
        flags: "gi",
        id: "remove-think",
        name: "移除思维链",
        pattern:
            "<(think|thinking)(?:\\s+[^>]*)?>[\\s\\S]*?<\\/(think|thinking)\\s*>",
        replacement: "",
        scope: "both",
    },
    {
        description:
            "移除无开头标签的思维链，如直接以 </think> 或 </thinking> 结尾的内容",
        enabled: true,
        flags: "gi",
        id: "remove-headless-think",
        name: "移除无头思维链",
        pattern: "[\\s\\S]*?<\\/(think|thinking)\\s*>",
        replacement: "",
        scope: "both",
    },
    {
        description:
            "移除 LLM 输出中可能出现的 <disclaimer> 免责声明，主要用于反截断和内容清洗",
        enabled: true,
        flags: "gi",
        id: "remove-disclaimer",
        name: "移除解析声明 (Disclaimer)",
        pattern: "<disclaimer(?:\\s+[^>]*)?>[\\s\\S]*?<\\/disclaimer\\s*>",
        replacement: "",
        scope: "both",
    },
    {
        description: "移除 MVU 更新变量标签，避免污染提示词",
        enabled: true,
        flags: "gi",
        id: "remove-update-variable",
        name: "移除 UpdateVariable",
        pattern:
            "<UpdateVariable(?:\\s+[^>]*)?>[\\s\\S]*?<\\/UpdateVariable\\s*>",
        replacement: "",
        scope: "both",
    },
    {
        description: "移除变量脚本在消息末尾添加的占位符标签",
        enabled: true,
        flags: "gi",
        id: "remove-status-placeholder",
        name: "移除 StatusPlaceHolder",
        pattern: "<StatusPlaceHolderImpl(?:\\s+[^>]*)?\\s*\\/>",
        replacement: "",
        scope: "both",
    },
];

// ==================== Preprocessing Configuration ====================

export const preprocessingConfigSchema = z.object({
    /** 是否启用 */
    enabled: z.boolean().default(false),
    /** 当前使用的提示词模板 ID */
    templateId: z.string().default("query_enhance"),
    /** 是否自动触发 (每次发送消息) */
    autoTrigger: z.boolean().default(true),
    /** 是否开启预览修订 (V0.8.6+) */
    preview: z.boolean().default(true),
});

export type PreprocessingConfig = z.infer<typeof preprocessingConfigSchema>;

/** 默认预处理配置 */
export const DEFAULT_PREPROCESSING_CONFIG: PreprocessingConfig =
    preprocessingConfigSchema.parse({});
