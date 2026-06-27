/**
 * Memory Configuration Schemas
 *
 * Each schema bakes in its defaults via `.default()`, so `schema.parse({})`
 * produces a fully-populated object and `schema.parse(stored)` applies defaults
 * for any missing fields. This replaces the old interface + DEFAULT_* constant
 * pair (single source of truth, no drift).
 */

import { z } from "zod";

// ==================== Trim Config ====================

export const trimConfigSchema = z.object({
    /** 是否启用精简 */
    enabled: z.boolean().default(false),
    /** 触发器类型 */
    trigger: z.enum(["token", "count"]).default("token"),
    /** Token 上限（trigger='token' 时使用） */
    tokenLimit: z.number().int().positive().default(4096),
    /** 总结次数上限（trigger='count' 时使用） */
    countLimit: z.number().int().positive().default(5),
    /** 保留最近 N 条不合并 */
    keepRecentCount: z.number().int().nonnegative().default(3),
    /** 是否保留原始条目（禁用而非删除） */
    preserveOriginal: z.boolean().default(false),
    /** 是否启用预览确认 */
    previewEnabled: z.boolean().default(true),
});

export type TrimConfig = z.infer<typeof trimConfigSchema>;
export type TrimTriggerType = TrimConfig["trigger"];

// ==================== Entity Extract Config ====================

export const entityExtractConfigSchema = z.object({
    /** 是否启用自动提取 */
    enabled: z.boolean().default(false),
    /** 触发器类型 */
    trigger: z.enum(["floor", "manual"]).default("floor"),
    /** 楼层间隔 (每 N 楼触发一次，默认 15) */
    floorInterval: z.number().int().positive().default(15),
    /** 保留最近 N 条对话不处理 */
    keepRecentCount: z.number().int().nonnegative().default(5),
    /** 是否启用自动归档 (当总数超过上限时) */
    autoArchive: z.boolean().default(true),
    /** 实体数量上限 (默认 50) */
    archiveLimit: z.number().int().positive().default(50),
    /** 是否启用预览确认 */
    previewEnabled: z.boolean().default(true),
    /**
     * 状态字段列表——这些字段的变更会被历史化（追加 ValueInterval 而非覆盖），
     * 并在变更时向 timeline 发射一个 state-change 事件。
     * 默认覆盖常见的 RP 状态字段。
     */
    stateFields: z.array(z.string()).default([
        "state",
        "status",
        "location",
        "mood",
    ]),
    /**
     * state-change 事件发射阈值（significance_score）。
     * 只有达到此阈值的状态变更才发射事件，避免 "knight sat down" 之类的噪声进入 timeline。
     */
    stateChangeEmitThreshold: z.number().min(0).max(1).default(0.6),
});

export type EntityExtractConfig = z.infer<typeof entityExtractConfigSchema>;
export type EntityTriggerType = EntityExtractConfig["trigger"];

// ==================== Global Regex Config ====================

export const globalRegexConfigSchema = z.object({
    /** 是否启用酒馆原生 Regex (SillyTavern) */
    enableNativeRegex: z.boolean().default(true),
});

export type GlobalRegexConfig = z.infer<typeof globalRegexConfigSchema>;

// ==================== Summarizer Config ====================

export const triggerModeSchema = z.enum(["auto", "manual"]);
export type TriggerMode = z.infer<typeof triggerModeSchema>;

export const worldbookBindModeSchema = z.enum(["chat", "character"]);
export type WorldbookBindMode = z.infer<typeof worldbookBindModeSchema>;

export const summarizerConfigSchema = z.object({
    /** 是否启用自动总结 */
    enabled: z.boolean().default(true),
    /** 触发模式：自动/手动 */
    triggerMode: triggerModeSchema.default("auto"),
    /** 楼层间隔：每 N 楼触发一次 */
    floorInterval: z.number().int().positive().default(25),
    /** 世界书绑定模式 */
    worldbookMode: worldbookBindModeSchema.default("chat"),
    /** 是否启用预览 */
    previewEnabled: z.boolean().default(true),
    /** 使用的 LLM 预设 ID（null 表示使用默认） */
    llmPresetId: z.string().nullable().default(null),
    /** 保留末尾不处理的楼层数（缓冲） */
    bufferSize: z.number().int().positive().default(10),
    /** 是否自动隐藏已总结的楼层 */
    autoHide: z.boolean().default(false),
});

export type SummarizerConfig = z.infer<typeof summarizerConfigSchema>;

export const DEFAULT_SUMMARIZER_CONFIG: SummarizerConfig =
    summarizerConfigSchema.parse({});

// ==================== Derived defaults ====================
//
// Each DEFAULT_* is just `schema.parse({})` — kept as named exports for the
// `stored ?? DEFAULT_X` fallback pattern. Callers that always parse should
// call the schema directly. Phase 4 will remove these where redundant.

export const DEFAULT_TRIM_CONFIG: TrimConfig = trimConfigSchema.parse({});
export const DEFAULT_ENTITY_CONFIG: EntityExtractConfig =
    entityExtractConfigSchema.parse({});
export const DEFAULT_REGEX_CONFIG: GlobalRegexConfig = globalRegexConfigSchema
    .parse({});
