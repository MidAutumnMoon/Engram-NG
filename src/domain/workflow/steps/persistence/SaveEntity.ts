import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { RobustJsonParser } from "@/utils/JsonParser.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import { EntityType } from "@/data/types/graph.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { appendInterval, backfillFromProfile, currentValue } from "@/domain/memory/fieldHistory.ts";
import * as jsonpatch from "fast-json-patch";
import * as yaml from "js-yaml";
import { z } from "zod";
import type { JobContext } from "../../core/JobContext.ts";
import type { IStep } from "../../core/Step.ts";

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

export class SaveEntity implements IStep {
    name = "SaveEntity";
    private config: { dryRun?: boolean };

    // V1.2.7: 支持构造函数配置 dryRun，用于预览模式
    constructor(config?: { dryRun?: boolean }) {
        this.config = config || {};
    }

    async execute(context: JobContext): Promise<void> {
        const store = useMemoryStore.getState();
        const existingEntities =
            (context.input._rawExistingEntities as EntityNode[]) ||
            await store.getAllEntities();

        let sourceContent = context.parsedData;

        // Handle UserReview modifications
        if (typeof context.output === "string") {
            sourceContent = RobustJsonParser.parse(context.output);
            if (!sourceContent) {
                throw new Error(
                    `SaveEntity: Failed to re-parse user modified content - JSON 解析失败，请检查格式`,
                );
            }
        } else if (context.output && typeof context.output === "object") {
            sourceContent = context.output;
        }

        if (!sourceContent) return;

        const newEntities: EntityNode[] = [];
        const updatedEntities: EntityNode[] = [];
        // V1.2.7: 优先使用构造函数配置，其次是 context.config
        const isDryRun = this.config.dryRun ?? context.config.dryRun === true;

        // 状态字段历史化配置：从 EntityExtractConfig 读取，默认覆盖常见 RP 状态字段。
        // 这些字段的变更走 interval-append 而非覆盖，并向 timeline 发射 state-change 事件。
        const stateFields =
            (context.config.stateFields as string[] | undefined) ??
                ["state", "status", "location", "mood"];
        const stateChangeEmitThreshold =
            (context.config.stateChangeEmitThreshold as number | undefined) ??
                0.6;

        // V1.3.1: 检查是否为已处理的数据 (来自 DryRun + UserReview)
        const processedResult = ProcessedResultSchema.safeParse(sourceContent);
        const hasProcessedData = processedResult.success &&
            ((processedResult.data.newEntities?.length ?? 0) > 0 ||
                (processedResult.data.updatedEntities?.length ?? 0) > 0);

        if (hasProcessedData) {
            Logger.debug(
                LogModule.WF_SAVE_ENTITY,
                "Detected processed data structure, bypassing extraction logic",
            );
            await this.saveProcessedEntities(
                processedResult.data,
                store,
                isDryRun,
                newEntities,
                updatedEntities,
                context,
                stateFields,
                stateChangeEmitThreshold,
            );
        } else {
            // 尝试解析为统一 Patch 格式
            const unifiedResult = UnifiedPatchSchema.safeParse(sourceContent);

            if (
                unifiedResult.success &&
                this.isUnifiedFormat(unifiedResult.data.patches)
            ) {
                // V1.3 统一格式
                await this.processUnifiedPatches(
                    unifiedResult.data.patches,
                    existingEntities,
                    store,
                    isDryRun,
                    newEntities,
                    updatedEntities,
                    context,
                    stateFields,
                    stateChangeEmitThreshold,
                );
            } else {
                // 向后兼容 Legacy 格式
                const legacyResult = LegacySchema.safeParse(sourceContent);
                if (legacyResult.success) {
                    await this.processLegacyFormat(
                        legacyResult.data,
                        existingEntities,
                        store,
                        isDryRun,
                        newEntities,
                        updatedEntities,
                        context,
                        stateFields,
                        stateChangeEmitThreshold,
                    );
                } else {
                    // 如果既不是 Processed，也不是 Patch，也不是 Legacy，那可能是个空对象或者格式错乱
                    // 但如果是空对象 (UserReview return empty entities)，legacyResult.success 会是 true (fields optional)
                    // 所以只有完全无法解析的才会到这里
                    throw new Error(
                        `SaveEntity: Zod Validation Failed - 无法解析为统一或旧版格式`,
                    );
                }
            }
        }

        context.output = { newEntities, updatedEntities };
        Logger.info(
            LogModule.WF_SAVE_ENTITY,
            `完成: 新增 ${newEntities.length}, 更新 ${updatedEntities.length} (DryRun: ${isDryRun})`,
        );
    }

    /** V1.3.1: 直接保存已处理的实体 (来自 UserReview) */
    private async saveProcessedEntities(
        data: z.infer<typeof ProcessedResultSchema>,
        store: ReturnType<typeof useMemoryStore.getState>,
        isDryRun: boolean,
        outNewEntities: EntityNode[],
        outUpdatedEntities: EntityNode[],
        context: JobContext,
        stateFields: string[],
        stateChangeEmitThreshold: number,
    ): Promise<void> {
        // range[1] (window end) — 与 applyMergePatches 和 SaveEvent 一致，
        // 让 field_history 的 from_index 与事件的 source_range.end_index 对齐。
        const fromIndex = context.input.range?.[1] ?? 0;
        const episodeId = context.input.episode_id ?? null;

        // 保存新实体
        if (data.newEntities) {
            for (const entity of data.newEntities) {
                if (!isDryRun) {
                    const { id: _id, ...entityData } = entity;
                    // 为新实体 seed field_history（与 createNewEntity 一致）
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
                } else {
                    outNewEntities.push(entity);
                }
            }
        }

        // 保存更新实体
        if (data.updatedEntities) {
            // 需要 existing entities 来对比状态字段变更并保留 field_history
            const existingEntities =
                (context.input._rawExistingEntities as EntityNode[]) ||
                await store.getAllEntities();
            const existingMap = new Map(existingEntities.map((e) => [e.id, e]));

            for (const entity of data.updatedEntities) {
                if (!isDryRun) {
                    if (entity.id && !entity.id.startsWith("temp-")) {
                        const existing = existingMap.get(entity.id);
                        // 优先用 entity 上携带的 tracked_fields（UserReview 可能修改），
                        // 回退到 existing 的声明，再回退到全局 stateFields
                        const trackedFields =
                            (Array.isArray(entity.tracked_fields) &&
                                entity.tracked_fields.length > 0)
                                ? entity.tracked_fields
                                : (Array.isArray(existing?.tracked_fields) &&
                                        existing.tracked_fields.length > 0)
                                ? existing!.tracked_fields!
                                : stateFields;

                        // 对比状态字段变更，追加 interval + 发射 state_change 事件
                        let fieldHistory = existing?.field_history ?? {};
                        const emittedChanges: {
                            field: string;
                            from: unknown;
                            to: unknown;
                        }[] = [];
                        const newProfile = entity.profile || {};
                        const oldProfile = existing?.profile ?? {};

                        // 深拷贝 field_history 以免修改 existing
                        fieldHistory = JSON.parse(JSON.stringify(fieldHistory));

                        for (const field of trackedFields) {
                            if (field in newProfile) {
                                const oldVal = currentValue(
                                    fieldHistory[field],
                                );
                                const newVal = newProfile[field];
                                // 值变化才追加 interval（避免无变更时产生冗余区间）
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

                        const description = this.profileToYaml(
                            entity.name,
                            entity.type || "unknown",
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

                        // 发射 state_change 事件到 timeline
                        if (emittedChanges.length > 0) {
                            await this.emitStateChangeEvents(
                                entity as EntityNode,
                                emittedChanges,
                                context,
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
                } else {
                    outUpdatedEntities.push(entity);
                }
            }
        }
    }

    /** 检测是否为统一格式 (patches 数组包含 path 字段) */
    private isUnifiedFormat(patches: any[]): boolean {
        return patches.length > 0 &&
            patches.every((p) =>
                typeof p.path === "string" && p.path.startsWith("/entities/")
            );
    }

    /** V1.3: 处理统一 JSON Patch 格式 */
    private async processUnifiedPatches(
        patches: z.infer<typeof PatchOpSchema>[],
        existingEntities: EntityNode[],
        store: ReturnType<typeof useMemoryStore.getState>,
        isDryRun: boolean,
        newEntities: EntityNode[],
        updatedEntities: EntityNode[],
        context: JobContext,
        stateFields: string[],
        stateChangeEmitThreshold: number,
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
            let existing = this.resolveEntityIdentity(
                entityName,
                existingEntities,
            );

            const addRootPatch = entityPatches.find((p) =>
                p.op === "add" && p.path === `/entities/${entityName}`
            );

            if (addRootPatch) {
                // 如果发现新实体声明，但名字发生冲突
                const conflict = existingEntities.find((e) =>
                    e.name.toLowerCase() === entityName.toLowerCase() ||
                    e.aliases?.some((a) =>
                        a.toLowerCase() === entityName.toLowerCase()
                    )
                );

                if (!conflict) {
                    await this.createNewEntity(
                        entityName,
                        addRootPatch.value,
                        store,
                        isDryRun,
                        newEntities,
                        context,
                    );
                    continue;
                } else {
                    existing = conflict;
                    Logger.debug(
                        LogModule.WF_SAVE_ENTITY,
                        `🔭 Duplicate entity detected for "${entityName}", redirecting to merge mode.`,
                    );
                    this.convertRootAddToPatches(
                        entityName,
                        addRootPatch.value,
                        entityPatches,
                    );
                }
            }

            if (existing) {
                await this.applyMergePatches(
                    entityName,
                    existing,
                    entityPatches,
                    store,
                    isDryRun,
                    updatedEntities,
                    context,
                    stateFields,
                    stateChangeEmitThreshold,
                );
            }
        }
    }

    /** 消除别名歧义匹配 */
    private resolveEntityIdentity(
        entityName: string,
        existingEntities: EntityNode[],
    ): EntityNode | undefined {
        // 1. 精确匹配名称优先
        const exactMatch = existingEntities.find((e) => e.name === entityName);
        if (exactMatch) return exactMatch;

        // 2. 别名匹配（可能冲突）
        const aliasMatches = existingEntities.filter((e) =>
            e.aliases?.includes(entityName)
        );
        if (aliasMatches.length === 1) {
            return aliasMatches[0];
        } else if (aliasMatches.length > 1) {
            Logger.warn(
                LogModule.WF_SAVE_ENTITY,
                `⚠️ Alias conflict detected for "${entityName}". Multiple entities share this alias. Falling back to first match to avoid crash, but data overwrite may occur.`,
                { matches: aliasMatches.map((e) => e.name) },
            );
            return aliasMatches[0];
        }
        return undefined;
    }

    private async createNewEntity(
        entityName: string,
        value: any,
        store: ReturnType<typeof useMemoryStore.getState>,
        isDryRun: boolean,
        newEntities: EntityNode[],
        context: JobContext,
    ) {
        // tracked_fields：由 prompt 声明的可变状态字段。只保留 profile 中实际存在的键。
        const declaredTracked = Array.isArray(value?.tracked_fields)
            ? (value.tracked_fields as string[])
            : [];
        const profile = value?.profile || {};
        const trackedFields = declaredTracked.filter((f) =>
            f in profile && profile[f] !== undefined && profile[f] !== null
        );

        // 首次创建即 seed field_history：与 v4 迁移用同一份 backfill 逻辑，
        // 让新实体从诞生起就有一段 [from_index, null) 区间，不依赖后续 update 才出现。
        // range[1] (window end) — 与 applyMergePatches 和 SaveEvent 一致。
        const fromIndex = context.input.range?.[1] ?? 0;
        const episodeId = context.input.episode_id ?? null;
        const fieldHistory = backfillFromProfile(
            profile,
            trackedFields,
            fromIndex,
            episodeId,
        );

        const entity: any = {
            aliases: value?.aliases || [],
            description: this.profileToYaml(
                entityName,
                value?.type || "unknown",
                profile,
            ),
            episode_refs: episodeId ? [episodeId] : undefined,
            field_history: fieldHistory,
            name: entityName,
            profile,
            tracked_fields: trackedFields,
            type: (value?.type as EntityType) || EntityType.Unknown,
        };

        if (!isDryRun) {
            const saved = await store.saveEntity(entity);
            newEntities.push(saved);
        } else {
            entity.id = `temp-${Date.now()}`;
            newEntities.push(entity);
        }
    }

    private convertRootAddToPatches(
        entityName: string,
        value: any,
        entityPatches: any[],
    ) {
        if (value && typeof value === "object") {
            if (value.profile) {
                // 分解为逐字段 replace，而非整体 profile add。
                // 逐字段 op 让 partitionStateOps 能识别状态字段并路由到 appendInterval；
                // 整体 add 会让路径变成 /profile，extractStateField 返回 "profile"（非 tracked），
                // 状态字段变更会绕过 field_history——这是 field_history 始终只有 1 条记录的根因。
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

    private async applyMergePatches(
        entityName: string,
        existing: EntityNode,
        entityPatches: any[],
        store: ReturnType<typeof useMemoryStore.getState>,
        isDryRun: boolean,
        updatedEntities: EntityNode[],
        context: JobContext,
        stateFields: string[],
        stateChangeEmitThreshold: number,
    ) {
        try {
            // P1 Fix: 使用 structuredClone 替代昂贵的 JSON 序列化
            const targetDoc = structuredClone(existing) as any;
            targetDoc._original = structuredClone(existing);

            const relativeOps = this.buildRelativePatches(
                entityName,
                entityPatches,
                targetDoc,
            );

            // 分流：状态字段 op 走 interval-append，其余走原有 jsonpatch 覆盖路径。
            // 状态字段历史化是 episode-as-source-of-truth 的核心：旧值不丢，timeline 可回溯。
            // 优先用该实体声明的 tracked_fields（prompt 在创建时声明，最准确），
            // 回退到全局 stateFields 配置（兼容旧实体/未声明的情况）。
            const effectiveTrackedFields =
                (Array.isArray(existing.tracked_fields) &&
                        existing.tracked_fields.length > 0)
                    ? existing.tracked_fields
                    : stateFields;
            const { stateOps, regularOps } = partitionStateOps(
                relativeOps,
                effectiveTrackedFields,
            );

            // 先应用状态字段（interval-append + profile 同步写）
            const emittedChanges: {
                field: string;
                from: unknown;
                to: unknown;
            }[] = [];
            if (stateOps.length > 0) {
                if (!targetDoc.field_history) targetDoc.field_history = {};
                const fromIndex = context.input.range?.[1] ?? 0;
                const episodeId = context.input.episode_id ?? null;
                for (const op of stateOps) {
                    const field = extractStateField(op.path);
                    if (!field) continue;
                    const oldValue = currentValue(
                        targetDoc.field_history[field],
                    );
                    // appendInterval 同时关闭上一段 open interval
                    targetDoc.field_history[field] = appendInterval(
                        targetDoc.field_history[field],
                        {
                            from_index: fromIndex,
                            value: op.value,
                            episode_id: episodeId,
                        },
                    );
                    // 把新值同步写入 targetDoc.profile——这不是「并行写」持久化
                    // （非 dryRun 路径不写 profile 状态字段），而是让 dryRun 产出的
                    // targetDoc 快照携带最新状态值，供 UserReview 显示和后续
                    // saveProcessedEntities 对比。saveProcessedEntities 会用这个
                    // profile 值与 existing.field_history 对比来决定是否追加 interval。
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

            // 再应用普通字段（覆盖语义，不变）
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
                if (!isDryRun) {
                    const description = this.profileToYaml(
                        targetDoc.name,
                        targetDoc.type,
                        targetDoc.profile || {},
                    );
                    await store.updateEntity(existing.id, {
                        aliases: targetDoc.aliases,
                        // episode_refs 追加本次 pass
                        episode_refs: appendEpisodeRef(
                            targetDoc.episode_refs,
                            context.input.episode_id,
                        ),
                        field_history: targetDoc.field_history,
                        description,
                        name: targetDoc.name,
                        profile: targetDoc.profile,
                        type: targetDoc.type,
                    });
                    updatedEntities.push(targetDoc);

                    // 状态变更发射事件：把状态变化写进 timeline（第二个 timeline feeder）。
                    // 只有达到阈值的状态变更才发射，避免 "knight sat down" 之类的噪声。
                    // 这让 timeline 不再落后于实体状态——状态变化本身就是 timeline 条目。
                    if (emittedChanges.length > 0) {
                        await this.emitStateChangeEvents(
                            targetDoc,
                            emittedChanges,
                            context,
                            stateChangeEmitThreshold,
                        );
                    }
                } else {
                    // DryRun: 为 EntityReview 构建 _diff（供 UI 渲染变更预览）。
                    // 状态字段 diff 带 from/to；普通字段用 jsonpatch 取旧值。
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
                    targetDoc.description = this.profileToYaml(
                        targetDoc.name,
                        targetDoc.type,
                        targetDoc.profile || {},
                    );
                    targetDoc._diff = diffs;
                    updatedEntities.push(targetDoc);
                }
            }
        } catch (error) {
            Logger.warn(
                LogModule.WF_SAVE_ENTITY,
                `Patch failed for ${entityName}`,
                error,
            );
        }
    }

    /**
     * 把达到阈值的状态变更作为 minimal EventNode 写入 timeline。
     * 这些事件 level=0、带 entity_refs、source_range 与本 pass 一致，
     * 是 episode-as-source-of-truth 的「状态变化即 timeline 条目」实现。
     */
    private async emitStateChangeEvents(
        entity: EntityNode,
        changes: { field: string; from: unknown; to: unknown }[],
        context: JobContext,
        threshold: number,
    ): Promise<void> {
        const store = useMemoryStore.getState();
        const range = context.input.range || [0, 0];
        const episodeId = context.input.episode_id ?? null;

        for (const change of changes) {
            // threshold <= 0 = 用户关掉了状态变更发射
            if (threshold <= 0) continue;
            const fromStr = formatStateValue(change.from);
            const toStr = formatStateValue(change.to);
            if (fromStr === toStr) continue; // 无实质变化

            const summary =
                `${entity.name} ${change.field}: ${fromStr} → ${toStr}`;
            try {
                await store.saveEvent({
                    episode_id: episodeId,
                    entity_refs: [entity.id],
                    is_archived: false,
                    is_embedded: false,
                    level: 0,
                    // 状态变更事件始终有意义（模型判定该字段确实变了），
                    // significance_score 与 threshold 解耦：threshold 只管是否发射，
                    // score 固定为 0.7——高于普通事件但低于关键剧情节点。
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

    private buildRelativePatches(
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
                    const foundPaths = this.findUniquePath(
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

    /** 向后兼容: 处理旧版 entities + patches 格式 */
    private async processLegacyFormat(
        data: z.infer<typeof LegacySchema>,
        existingEntities: EntityNode[],
        store: ReturnType<typeof useMemoryStore.getState>,
        isDryRun: boolean,
        newEntities: EntityNode[],
        updatedEntities: EntityNode[],
        context: JobContext,
        stateFields: string[],
        stateChangeEmitThreshold: number,
    ): Promise<void> {
        // 1. Process New Entities
        if (data.entities) {
            for (const extracted of data.entities) {
                const exists = existingEntities.find((e) =>
                    e.name === extracted.name ||
                    e.aliases?.includes(extracted.name)
                );
                if (exists) continue;

                const entity: any = {
                    aliases: extracted.aliases || [],
                    description: this.profileToYaml(
                        extracted.name,
                        extracted.type,
                        extracted.profile || {},
                    ),
                    name: extracted.name,
                    profile: extracted.profile || {},
                    type: (extracted.type as EntityType) || EntityType.Unknown,
                };

                if (!isDryRun) {
                    const saved = await store.saveEntity(entity);
                    newEntities.push(saved);
                } else {
                    entity.id = `temp-${Date.now()}`;
                    newEntities.push(entity);
                }
            }
        }

        // 2. Process Patches
        // Legacy ops 用裸路径（无 /entities/{name} 前缀），转换成统一前缀后复用 applyMergePatches，
        // 这样状态字段也能走 interval-append + state-change 发射。
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

                // 裸路径 -> /entities/{name}{path}
                const prefixedOps = patch.ops.map((op: any) => ({
                    ...op,
                    path: `/entities/${
                        encodeURIComponent(patch.name)
                    }${op.path}`,
                }));

                await this.applyMergePatches(
                    patch.name,
                    target,
                    prefixedOps,
                    store,
                    isDryRun,
                    updatedEntities,
                    context,
                    stateFields,
                    stateChangeEmitThreshold,
                );
            }
        }
    }

    private profileToYaml(name: string, type: string, profile: any): string {
        try {
            const entityObj = { profile };
            const yamlContent = yaml.dump(entityObj, {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
                sortKeys: false,
            });
            return `${name}\n${yamlContent.trim()}`;
        } catch (error) {
            Logger.warn(LogModule.WF_SAVE_ENTITY, "YAML Dump failed", error);
            return `${name} (${type})\n${JSON.stringify(profile, null, 2)}`;
        }
    }

    /**
     * V1.6: Universal Smart Pointer (Deep Search)
     * Recursively search for a key in the object structure.
     * Returns the relative path (slash-separated) to the key if found uniquely.
     */
    private findUniquePath(
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

            // Recurse (avoid arrays for now? or search inside arrays too? Entity structure is mostly objects)
            // But strict recursion on objects only
            if (
                obj[key] && typeof obj[key] === "object" &&
                !Array.isArray(obj[key])
            ) {
                results = results.concat(
                    this.findUniquePath(obj[key], targetKey, newPath),
                );
            }
        }

        return results;
    }
}

// ============================================================================
// Module-level helpers for state-field history routing
// ============================================================================

/**
 * 把一组 relative ops 分流为状态字段 ops 与普通 ops。
 * 状态字段 = 路径末段命中 stateFields 的 replace/add op（profile/<field> 形态）。
 * 状态字段 op 走 interval-append（历史化），其余走原 jsonpatch 覆盖路径。
 */
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

/**
 * 从一个相对 JSON pointer 提取状态字段名。
 * 匹配 /profile/<field> 或 /<field>（顶层）形态。返回字段名或 undefined。
 */
function extractStateField(path: string): string | undefined {
    // 形如 /profile/state 或 /state
    const m = path.match(/^\/(?:profile\/)?([^/]+)$/);
    return m ? m[1] : undefined;
}

/**
 * 追加一个 episode_id 到 episode_refs，去重。
 */
function appendEpisodeRef(
    refs: string[] | undefined,
    episodeId: string | undefined,
): string[] | undefined {
    if (!episodeId) return refs;
    const set = new Set([...(refs ?? []), episodeId]);
    return [...set];
}

/**
 * 把状态字段值格式化为可读字符串（用于 state-change 事件 summary）。
 */
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
