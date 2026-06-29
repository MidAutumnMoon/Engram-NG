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
import { getSTContext } from "@/sillytavern/context.ts";
import { safeStringify } from "@/utils/safeStringify.ts";

import { type LLMPreset, llmPresetSchema } from "@/config/types/llm.ts";
import { regexRuleSchema } from "@/config/types/data_processing.ts";
import {
    entityExtractConfigSchema,
    summarizerConfigSchema,
    trimConfigSchema,
} from "@/config/types/memory.ts";
import {
    DEFAULT_INGESTION_CONFIG,
    ingestionConfigSchema,
    migrateToIngestionConfig,
} from "@/config/types/ingestion.ts";
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
    DEFAULT_WORLDBOOK_CONFIG,
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
    /** 世界书配置 */
    worldbookConfig: worldbookConfigSchema.prefault({}),
    /** 精简配置（可选，二层总结） */
    trimConfig: trimConfigSchema.optional(),
    /** V0.7: 嵌入配置 */
    embeddingConfig: embeddingConfigSchema.optional(),
    /** V0.8.5: 召回配置 */
    recallConfig: recallConfigSchema.optional(),
    /** V0.9: 实体提取配置 (deprecated — 见 ingestionConfig；迁移期保留兜底) */
    entityExtractConfig: entityExtractConfigSchema.optional(),
    /**
     * 统一摄取配置 (summary + entity 共享触发/游标/预览/间隔)。
     * 取代 summarizerConfig (root) + entityExtractConfig (nested)。
     * 迁移期：getSettings() 在缺省时从旧字段回填。
     */
    ingestionConfig: ingestionConfigSchema.prefault({}),
    /** V1.1.0: 世界书配置方案 */
    worldbookProfiles: z.array(worldbookConfigProfileSchema).optional(),
});

export type EngramAPISettings = z.infer<typeof engramApiSettingsSchema>;

// ============================================================================
// EngramSettings — root schema (the shape SillyTavern persists to disk)
// ============================================================================

const engramSettingsSchema = z.object({
    lastOpenedTab: z.string().default("dashboard"),
    summarizerConfig: summarizerConfigSchema.prefault({}),
    globalPreviewEnabled: z.boolean().default(true),
    regexRules: z.array(regexRuleSchema).default([]),
    apiSettings: engramApiSettingsSchema.nullable().default(null),
    linkedDeletion: z.object({
        enabled: z.boolean().default(true),
        deleteIndexedDB: z.boolean().default(false),
        showConfirmation: z.boolean().default(true),
    }).prefault({}),
});

export type EngramSettings = z.infer<typeof engramSettingsSchema>;

// ============================================================================
// Factory functions
// ============================================================================

export function createDefaultLLMPreset(name: string = "默认预设"): LLMPreset {
    return llmPresetSchema.parse({ name });
}

export function getDefaultAPISettings(): EngramAPISettings {
    return {
        llmPresets: [createDefaultLLMPreset()],
        selectedPresetId: null,
        vectorConfig: { ...DEFAULT_VECTOR_CONFIG },
        rerankConfig: { ...DEFAULT_RERANK_CONFIG },
        worldbookConfig: { ...DEFAULT_WORLDBOOK_CONFIG },
        recallConfig: { ...DEFAULT_RECALL_CONFIG },
        ingestionConfig: { ...DEFAULT_INGESTION_CONFIG },
        worldbookProfiles: [],
    };
}

// ============================================================================
// Settings access — validates via schema on every read; writes to ST storage
// ============================================================================

const EXTENSION_NAME = "engram";

/**
 * 迁移兜底：若 ingestionConfig 仍是 schema 默认值，但从旧字段
 * (root summarizerConfig + nested entityExtractConfig) 能映射出非默认值，
 * 则用映射结果覆盖。这样新代码读 ingestionConfig 时，旧存档自动升级。
 *
 * 仅当 ingestionConfig 明显未迁移（floorInterval 仍是默认 25 且 enabled 仍是
 * 默认 true，而旧字段携带了用户自定义值）时触发。迁移一次后持久化，
 * 后续不再触发。
 */
function migrateIngestionConfig(parsed: EngramSettings): EngramSettings {
    if (!parsed.apiSettings) return parsed;
    const api = parsed.apiSettings;

    const oldSummary = parsed.summarizerConfig;
    const oldEntity = api.entityExtractConfig;
    const currentIngestion = api.ingestionConfig;

    // 检测是否已迁移过：若 ingestionConfig 非空对象且至少有一个非默认值，视为已迁移。
    // schema 的 prefault({}) 总会填默认，所以用「用户是否改过 floorInterval」作为信号。
    const looksMigrated = currentIngestion &&
        (currentIngestion.floorInterval !== 25 ||
            currentIngestion.enabled !== true ||
            (oldSummary && oldSummary.floorInterval === undefined));

    if (looksMigrated) return parsed;

    // 仅当旧字段确实存在且携带值时才映射；否则保持 schema 默认。
    const hasOldSummary = oldSummary &&
        Object.keys(oldSummary).some((k) =>
            oldSummary[k as keyof typeof oldSummary] !== undefined
        );
    const hasOldEntity = oldEntity &&
        Object.keys(oldEntity).some((k) => (oldEntity as any)[k] !== undefined);

    if (!hasOldSummary && !hasOldEntity) return parsed;

    const migrated = migrateToIngestionConfig(
        oldSummary as Record<string, any> | null,
        oldEntity as Record<string, any> | null,
        null, // 强制重新映射，不用 existing
    );

    return {
        ...parsed,
        apiSettings: { ...api, ingestionConfig: migrated },
    };
}

/**
 * 获取扩展设置对象 (schema-validated, defaults filled)
 *
 * `initSettings()` must be called at startup to ensure ST storage exists.
 * Subsequent calls return a fresh parsed copy — callers should use `setSetting()`
 * for writes, never mutate the returned object.
 */
export function getSettings(): EngramSettings {
    const raw = getSTContext().extensionSettings?.[EXTENSION_NAME];
    const parsed = engramSettingsSchema.parse(raw ?? {});
    return migrateIngestionConfig(parsed);
}

/**
 * 初始化设置（在扩展加载时调用）
 *
 * Validates ST storage against the schema, fills missing fields with
 * defaults, and persists the result. Also runs the ingestionConfig migration
 * so new code can read the unified config immediately.
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
    const parsed = migrateIngestionConfig(
        engramSettingsSchema.parse(raw ?? {}),
    );
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
        `Set ${String(key)} = ${safeStringify(value, 0)}`,
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
        Logger.debug(
            LogModule.SETTINGS,
            "Saved via context.saveSettingsDebounced",
        );
    } else {
        Logger.warn(LogModule.SETTINGS, "saveSettingsDebounced not available");
    }
}
