/**
 * Unified Ingestion Configuration Schema.
 *
 * Replaces the split `summarizerConfigSchema` + `entityExtractConfigSchema`.
 * One ingestion pass drives both summary + entity phases with a shared trigger,
 * cursor, preview, and cadence. Per-phase specifics live under `summary`/`entity`.
 *
 * Migration: old settings carry `summarizerConfig` (root) + `apiSettings.entityExtractConfig`
 * (nested). `settings.ts` maps both into `apiSettings.ingestionConfig` on read.
 */

import { z } from "zod";

// ==================== Summary-phase sub-config ====================

export const ingestionSummarySchema = z.object({
    /** 是否启用总结阶段（主开关在 base.enabled；这里允许单独关掉 summary） */
    enabled: z.boolean().default(true),
    /** 是否自动隐藏已总结的楼层 */
    autoHide: z.boolean().default(false),
});
export type IngestionSummaryConfig = z.infer<typeof ingestionSummarySchema>;

// ==================== Entity-phase sub-config ====================

export const ingestionEntitySchema = z.object({
    /** 是否启用实体阶段 */
    enabled: z.boolean().default(false),
    /** 是否启用自动归档 (当总数超过上限时) */
    autoArchive: z.boolean().default(true),
    /** 实体数量上限 */
    archiveLimit: z.number().int().positive().default(50),
    /**
     * 状态字段列表——这些字段的变更会被历史化（追加 ValueInterval 而非覆盖），
     * 并在变更时向 timeline 发射一个 state-change 事件。
     */
    stateFields: z.array(z.string()).default([
        "state",
        "status",
        "location",
        "mood",
    ]),
    /**
     * state-change 事件发射阈值（significance_score）。
     * 只有达到此阈值的状态变更才发射事件。
     */
    stateChangeEmitThreshold: z.number().min(0).max(1).default(0.6),
});
export type IngestionEntityConfig = z.infer<typeof ingestionEntitySchema>;

// ==================== Unified ingestion config ====================

export const ingestionConfigSchema = z.object({
    /** 主开关：整个摄取 pass（summary+entity）的总闸 */
    enabled: z.boolean().default(true),
    /** 楼层间隔：每 N 楼触发一次摄取（summary 与 entity 共享） */
    floorInterval: z.number().int().positive().default(25),
    /** 是否启用预览确认（summary 与 entity 共享） */
    previewEnabled: z.boolean().default(true),
    /** 保留最近 N 层作为缓冲（不参与本轮摄取） */
    bufferSize: z.number().int().nonnegative().default(10),
    /** 总结阶段配置 */
    summary: ingestionSummarySchema.prefault({}),
    /** 实体阶段配置 */
    entity: ingestionEntitySchema.prefault({}),
});

export type IngestionConfig = z.infer<typeof ingestionConfigSchema>;

export const DEFAULT_INGESTION_CONFIG: IngestionConfig =
    ingestionConfigSchema.parse({});

/**
 * 把旧的 split 配置（summarizerConfig + entityExtractConfig）映射为统一的
 * ingestionConfig。用于 settings 读路径的迁移兜底。
 *
 * 旧字段语义映射：
 * - summarizerConfig.enabled            → base.enabled（主开关语义）
 * - summarizerConfig.floorInterval      → base.floorInterval
 * - summarizerConfig.previewEnabled     → base.previewEnabled
 * - summarizerConfig.bufferSize         → base.bufferSize
 * - summarizerConfig.autoHide           → summary.autoHide
 * - entityExtractConfig.enabled         → entity.enabled
 * - entityExtractConfig.autoArchive     → entity.autoArchive
 * - entityExtractConfig.archiveLimit    → entity.archiveLimit
 * - entityExtractConfig.stateFields     → entity.stateFields
 * - entityExtractConfig.stateChangeEmitThreshold → entity.stateChangeEmitThreshold
 *
 * 幂等：若 ingestionConfig 已有完整字段（已迁移），原样返回。
 */
export function migrateToIngestionConfig(
    oldSummary: Record<string, any> | null | undefined,
    oldEntity: Record<string, any> | null | undefined,
    existing?: Record<string, any> | null,
): IngestionConfig {
    // 若已迁移（ingestionConfig 存在且非空），parse 填默认后返回
    if (existing && Object.keys(existing).length > 0) {
        return ingestionConfigSchema.parse(existing);
    }

    const merged: Record<string, any> = {};

    // base fields — prefer old summarizerConfig values, fall back to schema defaults
    if (oldSummary) {
        if (oldSummary.enabled !== undefined) {
            merged.enabled = oldSummary.enabled;
        }
        if (oldSummary.floorInterval !== undefined) {
            merged.floorInterval = oldSummary.floorInterval;
        }
        if (oldSummary.previewEnabled !== undefined) {
            merged.previewEnabled = oldSummary.previewEnabled;
        }
        if (oldSummary.bufferSize !== undefined) {
            merged.bufferSize = oldSummary.bufferSize;
        }
        merged.summary = {
            enabled: oldSummary.enabled !== false,
            autoHide: oldSummary.autoHide ?? false,
        };
    }

    if (oldEntity) {
        merged.entity = {
            enabled: oldEntity.enabled ?? false,
            autoArchive: oldEntity.autoArchive ?? true,
            archiveLimit: oldEntity.archiveLimit ?? 50,
            stateFields: oldEntity.stateFields ??
                ["state", "status", "location", "mood"],
            stateChangeEmitThreshold: oldEntity.stateChangeEmitThreshold ??
                0.6,
        };
    }

    return ingestionConfigSchema.parse(merged);
}
