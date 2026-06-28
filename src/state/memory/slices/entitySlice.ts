import { generateShortUUID } from "@/utils/shortUUID.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import type { StateCreator } from "zustand";
import {
    formatArchivedEntityBlock,
    formatEntityStateBlocks,
} from "@/domain/memory/entityFormat.ts";
import { getCurrentDb, tryGetCurrentDb } from "./coreSlice.ts";

export interface EntityState {
    // V0.9 实体相关
    getAllEntities: () => Promise<EntityNode[]>;
    saveEntity: (
        entity: Omit<EntityNode, "id" | "last_updated_at">,
    ) => Promise<EntityNode>;
    saveEntities: (
        entities: Omit<EntityNode, "id" | "last_updated_at">[],
    ) => Promise<EntityNode[]>;
    updateEntity: (
        entityId: string,
        updates: Partial<EntityNode>,
    ) => Promise<void>;
    updateEntities: (
        updates: { id: string; updates: Partial<EntityNode> }[],
    ) => Promise<void>;
    deleteEntity: (entityId: string) => Promise<void>;
    deleteEntities: (entityIds: string[]) => Promise<void>;
    archiveEntities: (entityIds: string[]) => Promise<void>;
    toggleEntityLock: (entityId: string) => Promise<boolean>;
    getEntityStates: (
        ids?: string[],
        target_index?: number,
        asOfLabel?: string,
    ) => Promise<string>;
}

export const createEntitySlice: StateCreator<any, [], [], EntityState> = (
    _set,
    _get,
) => ({
    archiveEntities: async (entityIds: string[]) => {
        if (entityIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.entities.where("id").anyOf(entityIds).modify({
                is_archived: true,
            });
            console.log(`[MemoryStore] Archived ${entityIds.length} entities`);
        } catch (e) {
            console.error("[MemoryStore] Failed to archive entities:", e);
        }
    },

    deleteEntities: async (entityIds: string[]) => {
        if (entityIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.entities.bulkDelete(entityIds);
            console.log(`[MemoryStore] Deleted ${entityIds.length} entities`);
        } catch (e) {
            console.error("[MemoryStore] Failed to delete entities:", e);
            throw e;
        }
    },

    deleteEntity: async (entityId) => {
        if (!entityId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.entities.bulkDelete([entityId]);
            console.log(`[MemoryStore] Deleted entity: ${entityId}`);
        } catch (e) {
            console.error("[MemoryStore] Failed to delete entity:", e);
            throw e;
        }
    },

    getAllEntities: async () => {
        const db = getCurrentDb();
        if (!db) return [];

        try {
            return await db.entities.toArray();
        } catch (e) {
            console.error("[MemoryStore] Failed to get all entities:", e);
            return [];
        }
    },

    getEntityStates: async (
        ids?: string[],
        target_index?: number,
        asOfLabel?: string,
    ) => {
        const db = tryGetCurrentDb();
        if (!db) return "";

        try {
            // target_index 缺省 = 最新（取一个足够大的索引，resolveAt 会落到最后一段 open interval）
            const at = target_index ?? Number.MAX_SAFE_INTEGER;

            let fullEntities: EntityNode[] = [];
            let summaryEntities: EntityNode[] = [];

            const all = await db.entities.toArray();

            if (ids && ids.length > 0) {
                // 情况 A: 有召回 ID 列表
                // 详细展示：活跃实体 + 被召回的归档实体
                // 简略展示：未被召回的归档实体
                fullEntities = all.filter((e) =>
                    !e.is_archived || ids.includes(e.id)
                );
                summaryEntities = all.filter((e) =>
                    e.is_archived && !ids.includes(e.id)
                );
            } else {
                // 情况 B: 无召回 ID 列表
                // 详细展示：所有活跃实体
                // 简略展示：所有归档实体
                fullEntities = all.filter((e) => !e.is_archived);
                summaryEntities = all.filter((e) => e.is_archived);
            }

            if (fullEntities.length === 0 && summaryEntities.length === 0) {
                return "";
            }

            // 状态字段从 field_history as-of 解析（field_history 为真相）；
            // 其余字段从 profile 读取。归档实体不解析（仅恒定标识）。
            // asOfLabel 仅标注在状态块（共享一个前沿/召回锚点）；归档提醒块已有自描述。
            const sections: string[] = [];
            const stateBlocks = formatEntityStateBlocks(
                fullEntities,
                at,
                asOfLabel,
            );
            if (stateBlocks) sections.push(stateBlocks);

            const archivedBlock = formatArchivedEntityBlock(summaryEntities);
            if (archivedBlock) sections.push(archivedBlock);

            return sections.join("\n\n");
        } catch (e) {
            console.error("[MemoryStore] Failed to get entity states:", e);
            return "";
        }
    },

    saveEntities: async (entitiesData) => {
        const db = getCurrentDb();
        if (!db) throw new Error("[MemoryStore] No current chat");
        if (entitiesData.length === 0) return [];

        const entities: EntityNode[] = entitiesData.map((data) => ({
            ...data,
            id: generateShortUUID("ent_"),
            last_updated_at: Date.now(),
            aliases: data.aliases || [],
            profile: data.profile || {},
        }));

        await db.entities.bulkAdd(entities);
        console.log(`[MemoryStore] Bulk saved ${entities.length} entities`);
        return entities;
    },

    saveEntity: async (entityData) => {
        const db = getCurrentDb();
        if (!db) throw new Error("[MemoryStore] No current chat");

        const entity: EntityNode = {
            ...entityData,
            id: generateShortUUID("ent_"),
            last_updated_at: Date.now(),
            aliases: entityData.aliases || [],
            profile: entityData.profile || {},
        };

        await db.entities.add(entity);
        console.log(`[MemoryStore] Saved entity: ${entity.name}`);
        return entity;
    },

    toggleEntityLock: async (entityId: string) => {
        if (!entityId) return false;
        const db = getCurrentDb();
        if (!db) return false;

        try {
            const existing = await db.entities.get(entityId);
            if (!existing) return false;

            const newLockState = !existing.is_locked;
            await db.entities.update(entityId, { is_locked: newLockState });
            console.log(
                `[MemoryStore] Toggled entity lock: ${entityId} -> ${newLockState}`,
            );
            return newLockState;
        } catch (e) {
            console.error("[MemoryStore] Failed to toggle entity lock:", e);
            return false;
        }
    },

    updateEntities: async (updatesList) => {
        if (updatesList.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.transaction("rw", db.entities, async () => {
                const now = Date.now();
                for (const { id, updates } of updatesList) {
                    const { id: _id, ...safeUpdates } = updates as any;
                    const existing = await db.entities.get(id);
                    if (existing) {
                        await db.entities.put({
                            ...existing,
                            ...safeUpdates,
                            last_updated_at: now,
                        });
                    }
                }
            });
            console.log(
                `[MemoryStore] Batch updated ${updatesList.length} entities`,
            );
        } catch (e) {
            console.error("[MemoryStore] Failed to batch update entities:", e);
            throw e;
        }
    },

    updateEntity: async (entityId, updates) => {
        if (!entityId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            const { id: _id, ...safeUpdates } = updates as any;

            const existing = await db.entities.get(entityId);
            if (!existing) {
                console.warn(
                    `[MemoryStore] Entity not found for update: ${entityId}`,
                );
                return;
            }

            const merged = {
                ...existing,
                ...safeUpdates,
                last_updated_at: Date.now(),
            };

            await db.entities.put(merged);
            console.log(`[MemoryStore] Put completed for entity: ${entityId}`);
        } catch (e) {
            console.error("[MemoryStore] Failed to update entity:", e);
            throw e;
        }
    },
});
