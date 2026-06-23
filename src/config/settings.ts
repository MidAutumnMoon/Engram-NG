/**
 * Engram settings — schema, factory functions, and persistence API.
 *
 * The Zod schemas (`engramApiSettingsSchema`, `engramSettingsSchema`) are the
 * single source of truth for both the type and the defaults. `getSettings()`
 * validates and fills defaults on every read via `schema.parse(stored)`.
 */

import { z } from "zod";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext } from "@/sillytavern/index.ts";
import { PromptLoader } from "@/integrations/llm/PromptLoader.ts";

import { type LLMPreset, llmPresetSchema } from "@/config/types/llm.ts";
import { regexRuleSchema } from "@/config/types/data_processing.ts";
import {
    DEFAULT_REGEX_CONFIG,
    entityExtractConfigSchema,
    globalRegexConfigSchema,
    summarizerConfigSchema,
    trimConfigSchema,
} from "@/config/types/memory.ts";
import {
    DEFAULT_RECALL_CONFIG,
    DEFAULT_RERANK_CONFIG,
    DEFAULT_VECTOR_CONFIG,
    embeddingConfigSchema,
    recallConfigSchema,
    rerankConfigSchema,
    vectorConfigSchema,
} from "@/config/types/rag.ts";
import {
    type CustomMacro,
    customMacroSchema,
    DEFAULT_WORLDBOOK_CONFIG,
    type PromptCategory,
    type PromptTemplate,
    promptTemplateSchema,
    worldbookConfigProfileSchema,
    worldbookConfigSchema,
} from "@/config/types/prompt.ts";

// ============================================================================
// EngramAPISettings — composed schema (lives inside EngramSettings.apiSettings)
// ============================================================================

const engramApiSettingsSchema = z.object({
    /** LLM 预设列表 */
    llmPresets: z.array(llmPresetSchema).default([]),
    /** 当前选中的 LLM 预设 ID（作为默认预设） */
    selectedPresetId: z.string().nullable().default(null),
    /** 向量化配置 */
    vectorConfig: vectorConfigSchema.prefault({}),
    /** Rerank 配置 */
    rerankConfig: rerankConfigSchema.prefault({}),
    /** 提示词模板列表 */
    promptTemplates: z.array(promptTemplateSchema).default([]),
    /** 世界书配置 */
    worldbookConfig: worldbookConfigSchema.prefault({}),
    /** 正则配置 (V0.8) */
    regexConfig: globalRegexConfigSchema.prefault({}),
    /** 精简配置（可选，二层总结） */
    trimConfig: trimConfigSchema.optional(),
    /** V0.7: 嵌入配置 */
    embeddingConfig: embeddingConfigSchema.optional(),
    /** V0.8.5: 召回配置 */
    recallConfig: recallConfigSchema.optional(),
    /** V0.9: 实体提取配置 */
    entityExtractConfig: entityExtractConfigSchema.optional(),
    /** V0.9.2: 自定义宏 */
    customMacros: z.array(customMacroSchema).optional(),
    /** V1.1.0: 世界书配置方案 */
    worldbookProfiles: z.array(worldbookConfigProfileSchema).optional(),
});

export type EngramAPISettings = z.infer<typeof engramApiSettingsSchema>;

// ============================================================================
// EngramSettings — root schema (the shape SillyTavern persists to disk)
// ============================================================================

const engramSettingsSchema = z.object({
    theme: z.string().default("odysseia"),
    presets: z.record(z.string(), z.unknown()).default({}),
    templates: z.record(z.string(), z.unknown()).default({}),
    promptTemplates: z.array(promptTemplateSchema).default([]),
    hasSeenWelcome: z.boolean().default(false),
    lastOpenedTab: z.string().default("dashboard"),
    summarizerConfig: summarizerConfigSchema.prefault({}),
    globalPreviewEnabled: z.boolean().default(true),
    regexRules: z.array(regexRuleSchema).default([]),
    apiSettings: engramApiSettingsSchema.nullable().default(null),
    linkedDeletion: z.object({
        enabled: z.boolean().default(true),
        deleteWorldbook: z.boolean().default(true),
        deleteChatWorldbook: z.boolean().default(false),
        deleteIndexedDB: z.boolean().default(false),
        showConfirmation: z.boolean().default(true),
    }).prefault({}),
    syncConfig: z.object({
        enabled: z.boolean().default(false),
        autoSync: z.boolean().default(true),
    }).prefault({}),
});

export type EngramSettings = z.infer<typeof engramSettingsSchema>;

// ============================================================================
// Factory functions
// ============================================================================

const DEFAULT_CUSTOM_MACROS: CustomMacro[] = [
    {
        id: "custom_user_profile",
        name: "用户画像",
        content: "",
        enabled: true,
        createdAt: Date.now(),
    },
];

export function createDefaultLLMPreset(name: string = "默认预设"): LLMPreset {
    return llmPresetSchema.parse({ name });
}

export function createPromptTemplate(
    name: string,
    category: PromptCategory,
    options:
        & Partial<
            Omit<
                PromptTemplate,
                "name" | "category" | "createdAt" | "updatedAt"
            >
        >
        & { id?: string } = {},
): PromptTemplate {
    return promptTemplateSchema.parse({ name, category, ...options });
}

export function getDefaultAPISettings(): EngramAPISettings {
    return {
        llmPresets: [createDefaultLLMPreset()],
        selectedPresetId: null,
        vectorConfig: { ...DEFAULT_VECTOR_CONFIG },
        rerankConfig: { ...DEFAULT_RERANK_CONFIG },
        promptTemplates: PromptLoader.getBuiltInTemplates(),
        worldbookConfig: { ...DEFAULT_WORLDBOOK_CONFIG },
        regexConfig: { ...DEFAULT_REGEX_CONFIG },
        recallConfig: { ...DEFAULT_RECALL_CONFIG },
        customMacros: [...DEFAULT_CUSTOM_MACROS],
        worldbookProfiles: [],
    };
}

// ============================================================================
// Settings access — validates via schema on every read; writes to ST storage
// ============================================================================

const EXTENSION_NAME = "engram";

/**
 * 获取扩展设置对象 (schema-validated, defaults filled)
 *
 * `initSettings()` must be called at startup to ensure ST storage exists.
 * Subsequent calls return a fresh parsed copy — callers should use `setSetting()`
 * for writes, never mutate the returned object.
 */
export function getSettings(): EngramSettings {
    const raw = getSTContext().extensionSettings?.[EXTENSION_NAME];
    return engramSettingsSchema.parse(raw ?? {});
}

/**
 * 初始化设置（在扩展加载时调用）
 *
 * Validates ST storage against the schema, fills missing fields with
 * defaults, and persists the result.
 */
export function initSettings(): void {
    const context = getSTContext();
    if (!context.extensionSettings) {
        Logger.warn(
            LogModule.SETTINGS,
            "Cannot init: context.extensionSettings not available",
        );
        return;
    }
    const raw = context.extensionSettings[EXTENSION_NAME];
    const parsed = engramSettingsSchema.parse(raw ?? {});
    context.extensionSettings[EXTENSION_NAME] = parsed;
    save();
    Logger.debug(LogModule.SETTINGS, "Settings initialized and validated");
}

/**
 * Get a specific setting value (typed, defaults guaranteed by schema).
 */
export function getSetting<K extends keyof EngramSettings>(
    key: K,
): EngramSettings[K] {
    return getSettings()[key];
}

/**
 * Save a specific setting value.
 * Mutates ST's stored object in place, then triggers a debounced save.
 */
export function setSetting<K extends keyof EngramSettings>(
    key: K,
    value: EngramSettings[K],
): void {
    const context = getSTContext();
    if (!context.extensionSettings) {
        Logger.warn(
            LogModule.SETTINGS,
            "Cannot set: context.extensionSettings not available",
        );
        return;
    }

    let settings = context.extensionSettings[EXTENSION_NAME];
    if (!settings) {
        settings = engramSettingsSchema.parse({});
        context.extensionSettings[EXTENSION_NAME] = settings;
    }

    settings[key] = value;
    Logger.debug(
        LogModule.SETTINGS,
        `Set ${String(key)} = ${JSON.stringify(value)}`,
    );
    save();
}

/**
 * 保存设置到服务器
 */
function save(): void {
    const context = getSTContext();
    if (context.saveSettingsDebounced) {
        context.saveSettingsDebounced();
        Logger.debug(LogModule.SETTINGS, "Saved via context.saveSettingsDebounced");
    } else {
        Logger.warn(LogModule.SETTINGS, "saveSettingsDebounced not available");
    }
}
