/**
 * Entity persistence for the extraction pipeline — split into a pure
 * "compute preview" phase and an I/O "apply" phase.
 *
 * `computeEntityPreview` parses + resolves + builds a human-readable preview
 * (EntityNode-shaped with `_diff`/`_original`/`temp-` ids). No DB writes, no
 * event emission — structurally cannot cause side effects.
 *
 * `applyEntityChanges` persists a ProcessedResult-shaped object (the preview,
 * possibly user-edited) to the DB, emits state-change events, and refreshes
 * the macro cache. It re-derives field_history/episode_refs/description from
 * the (possibly edited) profiles — it does NOT trust the preview's computed
 * fields, since the user may have edited them.
 *
 * This split replaces the former `dryRun: boolean` flag that threaded through
 * the whole function. Correctness ("no side effects in preview") is now
 * structural: the compute phase physically contains no `store.*` calls.
 */

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import { EntityType } from "@/data/types/graph.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import {
    appendInterval,
    backfillFromProfile,
    currentValue,
} from "@/domain/memory/fieldHistory.ts";
import { profileToYaml } from "@/domain/memory/entityFormat.ts";
import { stringCandidates } from "@/domain/memory/entityResolve.ts";
import { refreshEngramCache } from "@/domain/macros/Macros.ts";
import * as jsonpatch from "fast-json-patch";
import { z } from "zod";

// V1.3: 统一 JSON Patch 格式
// 新实体: { op: "add", path: "/entities/{name}", value: {...} }
// 更新:   { op: "replace/add/remove", path: "/entities/{name}/profile/{key}", value: ... }

const PatchOpSchema = z.object({
    from: z.string().optional(),
    op: z.enum(["add", "replace", "remove", "copy", "move", "test"]),
    path: z.string(),
    value: z.any().optional(),
});

const UnifiedPatchSchema = z.object({
    patches: z.array(PatchOpSchema),
});

// 向后兼容的 Legacy Schema
const LegacyEntitySchema = z.object({
    aliases: z.array(z.string()).optional(),
    name: z.string(),
    profile: z.record(z.string(), z.unknown()).optional(),
    type: z.string(),
});

const LegacyPatchSchema = z.object({
    name: z.string(),
    ops: z.array(z.any()),
});

const LegacySchema = z.object({
    entities: z.array(LegacyEntitySchema).optional(),
    patches: z.array(LegacyPatchSchema).optional(),
});

const ProcessedResultSchema = z.object({
    newEntities: z.array(z.any()).optional(),
    updatedEntities: z.array(z.any()).optional(),
});

// ============================================================================
// Shared types & constants
// ============================================================================

interface SaveContext {
    range?: [number, number];
    episodeId: string | null;
}

type Store = ReturnType<typeof useMemoryStore.getState>;

const DEFAULT_STATE_FIELDS = ["state", "status", "location", "mood"];
const DEFAULT_STATE_CHANGE_THRESHOLD = 0.6;

/** Preview/apply result: new + updated entity nodes. */
export interface EntityChanges {
    newEntities: EntityNode[];
    updatedEntities: EntityNode[];
}

// ============================================================================
// computeEntityPreview — pure-ish: build a preview with no side effects.
// ============================================================================

export interface ComputeEntityInput {
    /** Raw parsed source content (UnifiedPatch / Legacy / ProcessedResult). */
    sourceContent: any;
    /** Existing entities (pre-fetched by the caller). REQUIRED. */
    existingEntities: EntityNode[];
    range?: [number, number];
    episodeId?: string | null;
    stateFields?: string[];
    stateChangeEmitThreshold?: number;
}

/**
 * Compute an entity extraction preview without writing to the DB or emitting
 * events. Handles three input formats; the UnifiedPatch/Legacy paths build
 * `_diff`/`_original`/`temp-` ids for the review UI.
 *
 * The returned `EntityChanges` is a human-readable preview, NOT a machine
 * plan — `applyEntityChanges` re-derives field_history/episode_refs from the
 * (possibly edited) profiles, so the preview's computed fields are advisory.
 */
export async function computeEntityPreview(
    input: ComputeEntityInput,
): Promise<EntityChanges> {
    const existingEntities = input.existingEntities;

    let sourceContent = input.sourceContent;

    // Handle UserReview string re-parse
    if (typeof sourceContent === "string") {
        sourceContent = RobustJsonParser.parse(sourceContent);
        if (!sourceContent) {
            throw new Error(
                `computeEntityPreview: Failed to re-parse user modified content - JSON 解析失败，请检查格式`,
            );
        }
    }

    if (!sourceContent) {
        return { newEntities: [], updatedEntities: [] };
    }

    const newEntities: EntityNode[] = [];
    const updatedEntities: EntityNode[] = [];
    const stateFields = input.stateFields ?? DEFAULT_STATE_FIELDS;
    // stateChangeEmitThreshold intentionally not consumed here — the preview
    // builds no timeline events. Kept on the input type for API symmetry with
    // applyEntityChanges; apply is where it's used.

    const ctx: SaveContext = {
        episodeId: input.episodeId ?? null,
        range: input.range,
    };

    // V1.3.1: Processed data (from DryRun + UserReview) — pass-through.
    const processedResult = ProcessedResultSchema.safeParse(sourceContent);
    const hasProcessedData = processedResult.success &&
        ((processedResult.data.newEntities?.length ?? 0) > 0 ||
            (processedResult.data.updatedEntities?.length ?? 0) > 0);

    if (hasProcessedData) {
        Logger.debug(
            LogModule.WF_SAVE_ENTITY,
            "Detected processed data structure, bypassing extraction logic",
        );
        previewProcessedEntities(
            processedResult.data,
            newEntities,
            updatedEntities,
        );
    } else {
        const unifiedResult = UnifiedPatchSchema.safeParse(sourceContent);
        if (
            unifiedResult.success &&
            isUnifiedFormat(unifiedResult.data.patches)
        ) {
            await previewUnifiedPatches(
                unifiedResult.data.patches,
                existingEntities,
                newEntities,
                updatedEntities,
                ctx,
                stateFields,
            );
        } else {
            const legacyResult = LegacySchema.safeParse(sourceContent);
            if (legacyResult.success) {
                await previewLegacyFormat(
                    legacyResult.data,
                    existingEntities,
                    newEntities,
                    updatedEntities,
                    ctx,
                    stateFields,
                );
            } else {
                throw new Error(
                    `computeEntityPreview: Zod Validation Failed - 无法解析为统一或旧版格式`,
                );
            }
        }
    }

    Logger.info(
        LogModule.WF_SAVE_ENTITY,
        `Preview computed: 新增 ${newEntities.length}, 更新 ${updatedEntities.length}`,
    );

    return { newEntities, updatedEntities };
}

// ============================================================================
// applyEntityChanges — I/O: persist a ProcessedResult to the DB.
// ============================================================================

export interface ApplyEntityInput {
    /** ProcessedResult-shaped object (the preview, possibly user-edited). */
    sourceContent: { newEntities?: any[]; updatedEntities?: any[] } | string;
    /** Existing entities; falls back to store.getAllEntities() if absent. */
    existingEntities?: EntityNode[];
    range?: [number, number];
    episodeId?: string | null;
    stateFields?: string[];
    stateChangeEmitThreshold?: number;
}

/**
 * Persist a ProcessedResult-shaped entity set to the DB. Re-derives
 * field_history/episode_refs/description from the (possibly edited) profiles
 * — does NOT trust the preview's computed fields. Emits state-change events
 * for tracked-field mutations and refreshes the macro cache afterward.
 *
 * Only the ProcessedResult format is supported here; the UnifiedPatch/Legacy
 * formats live entirely in `computeEntityPreview` (verified: every real-save
 * call site passes a ProcessedResult-shaped object).
 */
export async function applyEntityChanges(
    input: ApplyEntityInput,
): Promise<EntityChanges> {
    const store = useMemoryStore.getState();
    const existingEntities = input.existingEntities ??
        await store.getAllEntities();

    let sourceContent: any = input.sourceContent;
    if (typeof sourceContent === "string") {
        sourceContent = RobustJsonParser.parse(sourceContent);
        if (!sourceContent) {
            throw new Error(
                `applyEntityChanges: Failed to re-parse user modified content - JSON 解析失败，请检查格式`,
            );
        }
    }

    const data = ProcessedResultSchema.safeParse(sourceContent);
    if (!data.success) {
        throw new Error(
            `applyEntityChanges: sourceContent is not ProcessedResult-shaped`,
        );
    }

    const newEntities: EntityNode[] = [];
    const updatedEntities: EntityNode[] = [];
    const stateFields = input.stateFields ?? DEFAULT_STATE_FIELDS;
    const stateChangeEmitThreshold = input.stateChangeEmitThreshold ??
        DEFAULT_STATE_CHANGE_THRESHOLD;

    const ctx: SaveContext = {
        episodeId: input.episodeId ?? null,
        range: input.range,
    };

    persistProcessedEntities(
        data.data,
        existingEntities,
        store,
        newEntities,
        updatedEntities,
        ctx,
        stateFields,
        stateChangeEmitThreshold,
    );

    Logger.info(
        LogModule.WF_SAVE_ENTITY,
        `Applied: 新增 ${newEntities.length}, 更新 ${updatedEntities.length}`,
    );

    // 刷新宏缓存，让 {{engramEntityStates}} 反映刚写入的实体。
    try {
        await refreshEngramCache();
    } catch (e) {
        Logger.warn(
            LogModule.WF_SAVE_ENTITY,
            "保存后刷新宏缓存失败（实体状态注入可能滞后）",
            e,
        );
    }

    return { newEntities, updatedEntities };
}

// ============================================================================
// PREVIEW path helpers (compute-only; no store/IO)
// ============================================================================

/**
 * ProcessedResult preview: pass-through. The input entities flow through
 * unchanged (the review UI edits them; apply re-derives fields on persist).
 */
function previewProcessedEntities(
    data: z.infer<typeof ProcessedResultSchema>,
    outNewEntities: EntityNode[],
    outUpdatedEntities: EntityNode[],
): void {
    if (data.newEntities) {
        for (const entity of data.newEntities) {
            outNewEntities.push(entity);
        }
    }
    if (data.updatedEntities) {
        for (const entity of data.updatedEntities) {
            outUpdatedEntities.push(entity);
        }
    }
}

async function previewUnifiedPatches(
    patches: z.infer<typeof PatchOpSchema>[],
    existingEntities: EntityNode[],
    newEntities: EntityNode[],
    updatedEntities: EntityNode[],
    ctx: SaveContext,
    stateFields: string[],
): Promise<void> {
    const patchesByEntity = new Map<
        string,
        z.infer<typeof PatchOpSchema>[]
    >();

    for (const patch of patches) {
        const match = patch.path.match(/^\/entities\/([^/]+)/);
        if (!match) continue;

        const entityName = decodeURIComponent(match[1]);
        if (!patchesByEntity.has(entityName)) {
            patchesByEntity.set(entityName, []);
        }
        patchesByEntity.get(entityName)!.push(patch);
    }

    for (const [entityName, entityPatches] of patchesByEntity) {
        let existing = resolveEntityIdentity(entityName, existingEntities);

        const addRootPatch = entityPatches.find((p) =>
            p.op === "add" && p.path === `/entities/${entityName}`
        );

        if (addRootPatch) {
            const conflict = existingEntities.find((e) =>
                e.name.toLowerCase() === entityName.toLowerCase() ||
                e.aliases?.some((a) =>
                    a.toLowerCase() === entityName.toLowerCase()
                )
            );

            if (!conflict) {
                previewNewEntity(
                    entityName,
                    addRootPatch.value,
                    newEntities,
                    ctx,
                );
                continue;
            } else {
                existing = conflict;
                Logger.debug(
                    LogModule.WF_SAVE_ENTITY,
                    `🔭 Duplicate entity detected for "${entityName}", redirecting to merge mode.`,
                );
                convertRootAddToPatches(
                    entityName,
                    addRootPatch.value,
                    entityPatches,
                );
            }
        }

        if (existing) {
            previewMergePatches(
                entityName,
                existing,
                entityPatches,
                updatedEntities,
                ctx,
                stateFields,
            );
        }
    }
}

/** Build a preview of a new entity (temp id, no DB write). */
function previewNewEntity(
    entityName: string,
    value: any,
    newEntities: EntityNode[],
    ctx: SaveContext,
): void {
    const declaredTracked = Array.isArray(value?.tracked_fields)
        ? (value.tracked_fields as string[])
        : [];
    const profile = value?.profile || {};
    const trackedFields = declaredTracked.filter((f) =>
        f in profile && profile[f] !== undefined && profile[f] !== null
    );

    const fromIndex = ctx.range?.[1] ?? 0;
    const episodeId = ctx.episodeId;
    const fieldHistory = backfillFromProfile(
        profile,
        trackedFields,
        fromIndex,
        episodeId,
    );

    const entity: any = {
        aliases: value?.aliases || [],
        description: profileToYaml(entityName, profile),
        episode_refs: episodeId ? [episodeId] : undefined,
        field_history: fieldHistory,
        name: entityName,
        profile,
        tracked_fields: trackedFields,
        type: (value?.type as EntityType) || EntityType.Unknown,
    };
    entity.id = `temp-${Date.now()}`;
    newEntities.push(entity);
}

/**
 * Build a preview of an entity merge: clone existing, apply state-op + regular
 * patches in-memory, attach `_diff`/`_original`. No DB write, no event emission.
 */
function previewMergePatches(
    entityName: string,
    existing: EntityNode,
    entityPatches: any[],
    updatedEntities: EntityNode[],
    ctx: SaveContext,
    stateFields: string[],
): void {
    try {
        const targetDoc = structuredClone(existing) as any;
        targetDoc._original = structuredClone(existing);

        const relativeOps = buildRelativePatches(
            entityName,
            entityPatches,
            targetDoc,
        );

        const effectiveTrackedFields =
            (Array.isArray(existing.tracked_fields) &&
                    existing.tracked_fields.length > 0)
                ? existing.tracked_fields
                : stateFields;
        const { stateOps, regularOps } = partitionStateOps(
            relativeOps,
            effectiveTrackedFields,
        );

        const emittedChanges: {
            field: string;
            from: unknown;
            to: unknown;
        }[] = [];
        if (stateOps.length > 0) {
            if (!targetDoc.field_history) targetDoc.field_history = {};
            const fromIndex = ctx.range?.[1] ?? 0;
            const episodeId = ctx.episodeId;
            for (const op of stateOps) {
                const field = extractStateField(op.path);
                if (!field) continue;
                const oldValue = currentValue(
                    targetDoc.field_history[field],
                );
                targetDoc.field_history[field] = appendInterval(
                    targetDoc.field_history[field],
                    {
                        from_index: fromIndex,
                        value: op.value,
                        episode_id: episodeId,
                    },
                );
                if (targetDoc.profile) {
                    targetDoc.profile[field] = op.value;
                }
                emittedChanges.push({
                    field,
                    from: oldValue,
                    to: op.value,
                });
            }
        }

        if (regularOps.length > 0) {
            Logger.debug(
                LogModule.WF_SAVE_ENTITY,
                `Applying ${regularOps.length} patches to ${entityName}`,
                { ops: regularOps },
            );
            jsonpatch.applyPatch(
                targetDoc,
                regularOps as jsonpatch.Operation[],
            );
        }

        const hasAnyChange = stateOps.length > 0 || regularOps.length > 0;
        if (hasAnyChange) {
            const diffs = [
                ...stateOps.map((op) => {
                    const field = extractStateField(op.path);
                    const change = emittedChanges.find((c) =>
                        c.field === field
                    );
                    return {
                        op: op.op,
                        path: op.path,
                        oldValue: change?.from,
                        value: op.value,
                    };
                }),
                ...regularOps.map((op) => {
                    let oldValue;
                    try {
                        if (op.op === "replace" || op.op === "remove") {
                            oldValue = jsonpatch.getValueByPointer(
                                existing,
                                op.path,
                            );
                        }
                    } catch { /* Ignore */ }
                    return { ...op, oldValue };
                }),
            ];
            targetDoc.description = profileToYaml(
                targetDoc.name,
                targetDoc.profile || {},
            );
            targetDoc._diff = diffs;
            updatedEntities.push(targetDoc);
        }
    } catch (error) {
        Logger.warn(
            LogModule.WF_SAVE_ENTITY,
            `Patch failed for ${entityName}`,
            error,
        );
    }
}

async function previewLegacyFormat(
    data: z.infer<typeof LegacySchema>,
    existingEntities: EntityNode[],
    newEntities: EntityNode[],
    updatedEntities: EntityNode[],
    ctx: SaveContext,
    stateFields: string[],
): Promise<void> {
    if (data.entities) {
        for (const extracted of data.entities) {
            const exists = existingEntities.find((e) =>
                e.name === extracted.name ||
                e.aliases?.includes(extracted.name)
            );
            if (exists) continue;

            const entity: any = {
                aliases: extracted.aliases || [],
                description: profileToYaml(
                    extracted.name,
                    extracted.profile || {},
                ),
                name: extracted.name,
                profile: extracted.profile || {},
                type: (extracted.type as EntityType) || EntityType.Unknown,
            };
            entity.id = `temp-${Date.now()}`;
            newEntities.push(entity);
        }
    }

    if (data.patches) {
        for (const patch of data.patches) {
            if (!patch.name) {
                Logger.warn(
                    LogModule.WF_SAVE_ENTITY,
                    "Skipping legacy patch due to missing name field",
                    { patch },
                );
                continue;
            }
            const target = existingEntities.find((e) =>
                e.name === patch.name || e.id === patch.name
            );
            if (!target) continue;

            const prefixedOps = patch.ops.map((op: any) => ({
                ...op,
                path: `/entities/${
                    encodeURIComponent(patch.name)
                }${op.path}`,
            }));

            previewMergePatches(
                patch.name,
                target,
                prefixedOps,
                updatedEntities,
                ctx,
                stateFields,
            );
        }
    }
}

// ============================================================================
// APPLY path helper (I/O; ProcessedResult real-save only)
// ============================================================================

/**
 * Persist a ProcessedResult to the DB. Re-derives field_history/episode_refs/
 * description from the (possibly edited) profiles — does NOT trust any
 * `_diff`/`_original`/`field_history` the preview computed, since the user
 * may have edited the profile in EntityReview.
 */
async function persistProcessedEntities(
    data: z.infer<typeof ProcessedResultSchema>,
    existingEntitiesInitial: EntityNode[],
    store: Store,
    outNewEntities: EntityNode[],
    outUpdatedEntities: EntityNode[],
    ctx: SaveContext,
    stateFields: string[],
    stateChangeEmitThreshold: number,
): Promise<void> {
    const fromIndex = ctx.range?.[1] ?? 0;
    const episodeId = ctx.episodeId;

    if (data.newEntities) {
        for (const entity of data.newEntities) {
            const { id: _id, ...entityData } = entity;
            const declaredTracked = Array.isArray(
                    (entityData as any).tracked_fields,
                )
                ? (entityData as any).tracked_fields as string[]
                : [];
            const profile = entityData.profile || {};
            const trackedFields = declaredTracked.filter((f) =>
                f in profile &&
                profile[f] !== undefined &&
                profile[f] !== null
            );
            const fieldHistory = backfillFromProfile(
                profile,
                trackedFields,
                fromIndex,
                episodeId,
            );
            const saved = await store.saveEntity({
                ...entityData,
                episode_refs: episodeId ? [episodeId] : undefined,
                field_history: fieldHistory,
                tracked_fields: trackedFields,
            } as any);
            outNewEntities.push(saved);
        }
    }

    if (data.updatedEntities) {
        const existingEntities = existingEntitiesInitial;
        const existingMap = new Map(existingEntities.map((e) => [e.id, e]));

        for (const entity of data.updatedEntities) {
            if (entity.id && !entity.id.startsWith("temp-")) {
                const existing = existingMap.get(entity.id);
                const trackedFields =
                    (Array.isArray(entity.tracked_fields) &&
                            entity.tracked_fields.length > 0)
                        ? entity.tracked_fields
                        : (Array.isArray(existing?.tracked_fields) &&
                                existing!.tracked_fields!.length > 0)
                        ? existing!.tracked_fields!
                        : stateFields;

                let fieldHistory = existing?.field_history ?? {};
                const emittedChanges: {
                    field: string;
                    from: unknown;
                    to: unknown;
                }[] = [];
                const newProfile = entity.profile || {};

                fieldHistory = JSON.parse(JSON.stringify(fieldHistory));

                for (const field of trackedFields) {
                    if (field in newProfile) {
                        const oldVal = currentValue(
                            fieldHistory[field],
                        );
                        const newVal = newProfile[field];
                        if (
                            JSON.stringify(oldVal) !==
                                JSON.stringify(newVal)
                        ) {
                            fieldHistory[field] = appendInterval(
                                fieldHistory[field],
                                {
                                    from_index: fromIndex,
                                    value: newVal,
                                    episode_id: episodeId,
                                },
                            );
                            emittedChanges.push({
                                field,
                                from: oldVal,
                                to: newVal,
                            });
                        }
                    }
                }

                const description = profileToYaml(
                    entity.name,
                    newProfile,
                );
                await store.updateEntity(entity.id, {
                    aliases: entity.aliases,
                    description,
                    episode_refs: appendEpisodeRef(
                        existing?.episode_refs,
                        episodeId,
                    ),
                    field_history: fieldHistory,
                    name: entity.name,
                    profile: newProfile,
                    tracked_fields: trackedFields,
                    type: entity.type,
                });
                outUpdatedEntities.push(entity);

                if (emittedChanges.length > 0) {
                    await emitStateChangeEvents(
                        entity as EntityNode,
                        emittedChanges,
                        ctx,
                        stateChangeEmitThreshold,
                    );
                }
            } else {
                Logger.warn(
                    LogModule.WF_SAVE_ENTITY,
                    "Skipping update for entity without valid ID",
                    entity,
                );
            }
        }
    }
}

// ============================================================================
// state-change event emission (timeline feeder; apply-only)
// ============================================================================

async function emitStateChangeEvents(
    entity: EntityNode,
    changes: { field: string; from: unknown; to: unknown }[],
    ctx: SaveContext,
    threshold: number,
): Promise<void> {
    const store = useMemoryStore.getState();
    const range = ctx.range || [0, 0];
    const episodeId = ctx.episodeId;

    for (const change of changes) {
        if (threshold <= 0) continue;
        const fromStr = formatStateValue(change.from);
        const toStr = formatStateValue(change.to);
        if (fromStr === toStr) continue;

        const summary = `${entity.name} ${change.field}: ${fromStr} → ${toStr}`;
        try {
            await store.saveEvent({
                episode_id: episodeId,
                entity_refs: [entity.id],
                is_archived: false,
                is_embedded: false,
                level: 0,
                significance_score: 0.7,
                source_range: {
                    end_index: range[1],
                    start_index: range[0],
                },
                structured_kv: {
                    causality: "state_change",
                    event: `${change.field}_change`,
                    location: [],
                    logic: [],
                    role: [entity.name],
                    time_anchor: "",
                },
                summary,
            });
            Logger.debug(
                LogModule.WF_SAVE_ENTITY,
                `[state-change] emitted timeline event: ${summary}`,
            );
        } catch (e) {
            Logger.warn(
                LogModule.WF_SAVE_ENTITY,
                `[state-change] failed to emit for ${entity.name}.${change.field}`,
                e,
            );
        }
    }
}

// ============================================================================
// Pure helpers (shared by preview paths)
// ============================================================================

function isUnifiedFormat(patches: any[]): boolean {
    return patches.length > 0 &&
        patches.every((p) =>
            typeof p.path === "string" && p.path.startsWith("/entities/")
        );
}

function convertRootAddToPatches(
    entityName: string,
    value: any,
    entityPatches: any[],
) {
    if (value && typeof value === "object") {
        if (value.profile) {
            for (const [key, val] of Object.entries(value.profile)) {
                entityPatches.push({
                    op: "replace",
                    path: `/entities/${entityName}/profile/${key}`,
                    value: val,
                });
            }
        }
        if (value.tracked_fields) {
            entityPatches.push({
                op: "replace",
                path: `/entities/${entityName}/tracked_fields`,
                value: value.tracked_fields,
            });
        }
        if (value.type) {
            entityPatches.push({
                op: "replace",
                path: `/entities/${entityName}/type`,
                value: value.type,
            });
        }
        if (value.aliases) {
            entityPatches.push({
                op: "add",
                path: `/entities/${entityName}/aliases`,
                value: value.aliases,
            });
        }
    }
}

function resolveEntityIdentity(
    entityName: string,
    existingEntities: EntityNode[],
): EntityNode | undefined {
    const { exact, ambiguous } = stringCandidates(entityName, existingEntities);
    if (exact) return exact;
    if (ambiguous.length === 1) return ambiguous[0];
    if (ambiguous.length > 1) {
        Logger.warn(
            LogModule.WF_SAVE_ENTITY,
            `⚠️ Alias conflict for "${entityName}". ResolveEntitiesStep 未消歧，取第一个避免崩溃（可能覆写）。`,
            { matches: ambiguous.map((e) => e.name) },
        );
        return ambiguous[0];
    }
    return undefined;
}

function buildRelativePatches(
    entityName: string,
    entityPatches: any[],
    targetDoc: any,
): any[] {
    const relativeOps = [];
    for (const p of entityPatches) {
        const isRoot = p.path === `/entities/${entityName}`;
        if (isRoot && p.op === "add") continue;

        if (isRoot && (p.op === "replace" || p.op === "test")) {
            if (p.value && typeof p.value === "object") {
                const val = p.value as any;
                if (val.profile) {
                    relativeOps.push({
                        op: p.op,
                        path: "/profile",
                        value: val.profile,
                    });
                }
                if (val.type) {
                    relativeOps.push({
                        op: p.op,
                        path: "/type",
                        value: val.type,
                    });
                }
                if (val.aliases) {
                    relativeOps.push({
                        op: p.op,
                        path: "/aliases",
                        value: val.aliases,
                    });
                }
            }
            continue;
        }

        if (!isRoot) {
            let relPath = p.path.replace(`/entities/${entityName}`, "");
            const parts = relPath.split("/").filter(Boolean);
            const GENERIC_KEYS = new Set([
                "profile",
                "type",
                "description",
                "desc",
                "value",
                "name",
                "id",
                "status",
                "features",
                "traits",
            ]);

            let anchorKey = "";
            let anchorIndex = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
                if (!GENERIC_KEYS.has(parts[i])) {
                    anchorKey = parts[i];
                    anchorIndex = i;
                    break;
                }
            }

            if (anchorKey) {
                const searchRoot = targetDoc.profile || {};
                const foundPaths = findUniquePath(
                    searchRoot,
                    anchorKey,
                    "/profile",
                );
                if (foundPaths.length === 1) {
                    const realAnchorPath = foundPaths[0];
                    const suffix = parts.slice(anchorIndex + 1).join("/");
                    const newPath = suffix
                        ? `${realAnchorPath}/${suffix}`
                        : realAnchorPath;
                    if (newPath !== relPath) {
                        Logger.debug(
                            LogModule.WF_SAVE_ENTITY,
                            `🔭 Smart Pointer Redirect: ${relPath} -> ${newPath}`,
                        );
                        relPath = newPath;
                    }
                }
            }
            relativeOps.push({ ...p, path: relPath });
        }
    }
    return relativeOps;
}

function partitionStateOps(
    ops: any[],
    stateFields: string[],
): { stateOps: any[]; regularOps: any[] } {
    const fieldSet = new Set(stateFields);
    const stateOps: any[] = [];
    const regularOps: any[] = [];
    for (const op of ops) {
        const field = extractStateField(op.path);
        const isStateFieldMutation = field &&
            fieldSet.has(field) &&
            (op.op === "replace" || op.op === "add");
        if (isStateFieldMutation) {
            stateOps.push(op);
        } else {
            regularOps.push(op);
        }
    }
    return { stateOps, regularOps };
}

function extractStateField(path: string): string | undefined {
    const m = path.match(/^\/(?:profile\/)?([^/]+)$/);
    return m ? m[1] : undefined;
}

function appendEpisodeRef(
    refs: string[] | undefined,
    episodeId: string | null,
): string[] | undefined {
    if (!episodeId) return refs;
    const set = new Set([...(refs ?? []), episodeId]);
    return [...set];
}

function formatStateValue(v: unknown): string {
    if (v === undefined || v === null) return "∅";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
}

/**
 * V1.6: Universal Smart Pointer (Deep Search)
 * Recursively search for a key in the object structure.
 */
function findUniquePath(
    obj: any,
    targetKey: string,
    currentPath: string = "",
): string[] {
    let results: string[] = [];

    if (!obj || typeof obj !== "object") return [];

    for (const key of Object.keys(obj)) {
        const newPath = currentPath ? `${currentPath}/${key}` : key;

        if (key === targetKey) {
            results.push(newPath);
        }

        if (
            obj[key] && typeof obj[key] === "object" &&
            !Array.isArray(obj[key])
        ) {
            results = results.concat(
                findUniquePath(obj[key], targetKey, newPath),
            );
        }
    }

    return results;
}
