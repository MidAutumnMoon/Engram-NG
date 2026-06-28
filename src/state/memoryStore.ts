import { chatManager } from "@/data/ChatManager.ts";
import {
    type ChatDatabase,
    deleteDatabase,
    getDbForChat,
    tryGetDbForChat,
} from "@/data/db.ts";
import type { EntityNode, EventNode } from "@/data/types/graph.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { getCurrentChatId } from "@/sillytavern/context.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { generateShortUUID } from "@/utils/shortUUID.ts";
import {
    formatArchivedEntityBlock,
    formatEntityStateBlocks,
} from "@/domain/memory/entityFormat.ts";
import { create } from "zustand";

/**
 * 获取当前聊天的数据库实例 (会自动创建)
 */
export function getCurrentDb(): ChatDatabase | null {
    const chatId = getCurrentChatId();
    if (!chatId) return null;
    return getDbForChat(chatId);
}

/**
 * 尝试获取当前聊天的数据库实例 (不会自动创建)
 */
export function tryGetCurrentDb(): ChatDatabase | null {
    const chatId = getCurrentChatId();
    if (!chatId) return null;
    return tryGetDbForChat(chatId);
}

/**
 * 注入路径的事件可见性过滤：timeline 只保留「仍在上下文里」的事件——
 * level≥1 的精简父事件 + 未归档的 level-0 细节事件。归档事件离开 timeline。
 *
 * 召回事件不再回灌进 timeline（additive recall：它们渲染到独立的 recalled 段）。
 */
function filterTimelineEvents(events: EventNode[]): EventNode[] {
    return events.filter((e) => {
        if (e.level >= 1) return true;
        if (!e.is_archived) return true;
        return false;
    });
}

export interface SummaryAnchor {
    time_anchor: string;
    event: string;
}

export interface CoreState {
    currentChatId: string | null;
    /**
     * 统一摄取游标（summary + entity 共享）。
     * 由 getProcessedFloor() 解析，含旧字段兜底。
     */
    lastProcessedFloor: number;

    // Actions
    initChat: () => Promise<ChatDatabase | null>;
    setLastProcessedFloor: (floor: number) => Promise<void>;
    reset: () => void;
    clearChatDatabase: () => Promise<void>;
    deleteChatDatabase: () => Promise<void>;
}

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

export interface EventState {
    saveEvent: (
        event: Omit<EventNode, "id" | "timestamp"> & { timestamp?: number },
    ) => Promise<EventNode>;
    /** 渲染 timeline 摘要块——仅含未归档 + level≥1 事件，召回事件不再回灌。 */
    getEventSummaries: () => Promise<string>;
    /**
     * 返回「前沿锚点」——时间戳最大事件的结构化锚点（=记忆覆盖到哪）。
     * 用于实体状态块的 as-of 标注。无事件或锚点缺失返回 null。
     *
     * flashback 锚点由 Injector 直接从 topNode.structured_kv 构造，不经此方法。
     */
    getSummaryAnchor: () => Promise<SummaryAnchor | null>;
    /**
     * 按 ID 取回召回事件原始节点（供 recalled 段渲染）。
     * 走主键索引；空数组返回空。
     */
    getRecalledEvents: (recalledIds: string[]) => Promise<EventNode[]>;
    /**
     * 返回 timeline 会渲染的事件 ID 集合（level≥1，或 level-0 !is_archived）。
     * 供注入层 dedup：recalled 事件若已在 timeline，则不再重复渲染到 recalled 段。
     * 过滤口径与 getEventSummaries / filterTimelineEvents 一致。
     */
    getTimelineEventIds: () => Promise<Set<string>>;

    getEventsToMerge: (keepRecentCount?: number) => Promise<EventNode[]>;
    deleteEvents: (eventIds: string[]) => Promise<void>;
    /**
     * 删除指定 episode 的所有事件（summary 事件 + state-change timeline 事件）。
     * episode_id 是非索引 JSON，故走 toArray().filter() 再 bulkDelete（与
     * getEventSummaries 等查询同口径）。返回删除条数。供「重新总结」重跑前清理旧产物用。
     */
    deleteEventsByEpisode: (episodeId: string) => Promise<number>;
    updateEvent: (
        eventId: string,
        updates: Partial<EventNode>,
    ) => Promise<void>;
    updateEvents: (
        updates: { id: string; updates: Partial<EventNode> }[],
    ) => Promise<void>;
    getAllEvents: () => Promise<EventNode[]>;
    archiveEvents: (eventIds: string[]) => Promise<void>;
    markEventsAsEmbedded: (eventIds: string[]) => Promise<void>;
    toggleEventLock: (eventId: string) => Promise<boolean>;
}

// 合并后的整体 State
export type MemoryState = CoreState & EntityState & EventState;

/**
 * Memory Store
 */
export const useMemoryStore = create<MemoryState>()((set, get) => ({
    // --- core state ---
    currentChatId: null,
    lastProcessedFloor: 0,

    initChat: async () => {
        const chatId = getCurrentChatId();
        if (!chatId) {
            Logger.warn(LogModule.MEMORY_STORE, "No chat_id available");
            return null;
        }

        if (chatId !== get().currentChatId) {
            Logger.debug(
                LogModule.MEMORY_STORE,
                `Switching to chat: ${chatId}`,
            );
            const state = await chatManager.getState();
            set({
                currentChatId: chatId,
                lastProcessedFloor: getProcessedFloor(state),
            });
        }

        return getDbForChat(chatId);
    },

    setLastProcessedFloor: async (floor) => {
        await chatManager.updateState({ last_processed_floor: floor });
        set({ lastProcessedFloor: floor });
    },

    reset: () =>
        set({
            currentChatId: null,
            lastProcessedFloor: 0,
        }),

    clearChatDatabase: async () => {
        let db = getCurrentDb();
        if (!db) {
            // Try to initialize it if missing
            db = await get().initChat();
            if (!db) {
                Logger.warn(
                    LogModule.MEMORY_STORE,
                    "No database available to clear",
                );
                return;
            }
        }

        try {
            await db.transaction(
                "rw",
                db.events,
                db.entities,
                db.meta,
                async () => {
                    await db.events.clear();
                    await db.entities.clear();
                    await db.meta.clear();
                },
            );
            set({
                lastProcessedFloor: 0,
            });
            Logger.success(LogModule.MEMORY_STORE, "Database cleared");
        } catch (e) {
            Logger.error(LogModule.MEMORY_STORE, "Failed to clear database", e);
            throw e;
        }
    },

    deleteChatDatabase: async () => {
        const chatId = get().currentChatId || getCurrentChatId();
        if (!chatId) {
            throw new Error("未连接到聊天，无法删除");
        }

        try {
            await deleteDatabase(chatId);
            get().reset();
            Logger.success(LogModule.MEMORY_STORE, "Database deleted");
        } catch (e) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to delete database",
                e,
            );
            throw e;
        }
    },

    // --- entity actions ---
    getAllEntities: async () => {
        const db = getCurrentDb();
        if (!db) return [];

        try {
            return await db.entities.toArray();
        } catch (e) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get all entities",
                e,
            );
            return [];
        }
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
        Logger.info(LogModule.MEMORY_STORE, `Saved entity: ${entity.name}`);
        return entity;
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
        Logger.info(
            LogModule.MEMORY_STORE,
            `Bulk saved ${entities.length} entities`,
        );
        return entities;
    },

    updateEntity: async (entityId, updates) => {
        if (!entityId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            const { id: _id, ...safeUpdates } = updates;

            const existing = await db.entities.get(entityId);
            if (!existing) {
                Logger.warn(
                    LogModule.MEMORY_STORE,
                    `Entity not found for update: ${entityId}`,
                );
                return;
            }

            const merged = {
                ...existing,
                ...safeUpdates,
                last_updated_at: Date.now(),
            };

            await db.entities.put(merged);
            Logger.info(
                LogModule.MEMORY_STORE,
                `Put completed for entity: ${entityId}`,
            );
        } catch (e) {
            Logger.error(LogModule.MEMORY_STORE, "Failed to update entity", e);
            throw e;
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
                    const { id: _id, ...safeUpdates } = updates;
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
            Logger.info(
                LogModule.MEMORY_STORE,
                `Batch updated ${updatesList.length} entities`,
            );
        } catch (e) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to batch update entities",
                e,
            );
            throw e;
        }
    },

    deleteEntity: async (entityId) => {
        if (!entityId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.entities.bulkDelete([entityId]);
            Logger.info(LogModule.MEMORY_STORE, `Deleted entity: ${entityId}`);
        } catch (e) {
            Logger.error(LogModule.MEMORY_STORE, "Failed to delete entity", e);
            throw e;
        }
    },

    deleteEntities: async (entityIds) => {
        if (entityIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.entities.bulkDelete(entityIds);
            Logger.info(
                LogModule.MEMORY_STORE,
                `Deleted ${entityIds.length} entities`,
            );
        } catch (e) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to delete entities",
                e,
            );
            throw e;
        }
    },

    archiveEntities: async (entityIds) => {
        if (entityIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.entities.where("id").anyOf(entityIds).modify({
                is_archived: true,
            });
            Logger.info(
                LogModule.MEMORY_STORE,
                `Archived ${entityIds.length} entities`,
            );
        } catch (e) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to archive entities",
                e,
            );
        }
    },

    toggleEntityLock: async (entityId) => {
        if (!entityId) return false;
        const db = getCurrentDb();
        if (!db) return false;

        try {
            const existing = await db.entities.get(entityId);
            if (!existing) return false;

            const newLockState = !existing.is_locked;
            await db.entities.update(entityId, { is_locked: newLockState });
            Logger.info(
                LogModule.MEMORY_STORE,
                `Toggled entity lock: ${entityId} -> ${newLockState}`,
            );
            return newLockState;
        } catch (e) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to toggle entity lock",
                e,
            );
            return false;
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
                // 情况 A: 召回路径（recalled 段渲染）。
                // 这里只渲染「归档且被召回」的实体——非归档实体已在当前状态块（情况 B）
                // 渲染过，重复出现在 recalled 段会造成重复。is_archived 在此读作
                // 「是否已在当前块」，是显式 dedup 规则，不是召回资格门槛。
                fullEntities = all.filter((e) =>
                    e.is_archived && ids.includes(e.id)
                );
                summaryEntities = all.filter((e) =>
                    e.is_archived && !ids.includes(e.id)
                );
            } else {
                // 情况 B: 当前状态路径（无召回 ID 列表）。
                // 详细展示：所有活跃实体；简略展示：所有归档实体。
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
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get entity states",
                e,
            );
            return "";
        }
    },

    // --- event actions ---
    saveEvent: async (eventData) => {
        const db = getCurrentDb();
        if (!db) throw new Error("[MemoryStore] No current chat");

        const event: EventNode = {
            ...eventData,
            id: generateShortUUID("evt_"),
            is_archived: eventData.is_archived ?? false,
            is_embedded: eventData.is_embedded ?? false,
            timestamp: eventData.timestamp ?? Date.now(),
        };

        await db.events.add(event);

        return event;
    },

    getEventSummaries: async () => {
        const db = tryGetCurrentDb();
        if (!db) return "";

        try {
            const events = await db.events.toArray();
            if (events.length === 0) return "";

            const targetEvents = filterTimelineEvents(events);
            targetEvents.sort((a, b) => a.timestamp - b.timestamp);

            const lines: string[] = [];
            let hasParent = false;

            for (const node of targetEvents) {
                if (node.level >= 1) {
                    lines.push(node.summary);
                    hasParent = true;
                } else if (node.is_archived) {
                    // 归档事件不再进 timeline（additive recall 后它们只出现在 recalled 段）；
                    // 此分支理论上不再触发，保留防御性。
                    if (hasParent) {
                        lines.push(`  ${node.summary}`);
                    } else {
                        lines.push(node.summary);
                    }
                } else {
                    lines.push(node.summary);
                }
            }

            if (lines.length === 0) return "";
            return `<summary>\n${lines.join("\n\n")}\n</summary>`;
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get event summaries",
                error,
            );
            return "";
        }
    },

    getSummaryAnchor: async () => {
        const db = tryGetCurrentDb();
        if (!db) return null;

        try {
            const events = await db.events.toArray();
            if (events.length === 0) return null;

            const visible = filterTimelineEvents(events);
            if (visible.length === 0) return null;

            // 前沿锚点：时间戳最大事件（=记忆覆盖到的最新剧情时刻）。
            const target = visible.reduce((a, b) =>
                a.timestamp > b.timestamp ? a : b
            );
            const time_anchor = target.structured_kv?.time_anchor ?? "";
            const event = target.structured_kv?.event ?? "";
            // 两者皆空 → 无锚点信息，不渲染标签
            if (!time_anchor && !event) return null;
            return { time_anchor, event };
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get summary anchor",
                error,
            );
            return null;
        }
    },

    getRecalledEvents: async (recalledIds) => {
        if (recalledIds.length === 0) return [];
        const db = tryGetCurrentDb();
        if (!db) return [];
        try {
            return await db.events.where("id").anyOf(recalledIds).toArray();
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get recalled events",
                error,
            );
            return [];
        }
    },

    getTimelineEventIds: async () => {
        const db = tryGetCurrentDb();
        if (!db) return new Set<string>();
        try {
            const events = await db.events.toArray();
            return new Set(
                filterTimelineEvents(events).map((e) => e.id),
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get timeline event ids",
                error,
            );
            return new Set<string>();
        }
    },

    getEventsToMerge: async (keepRecentCount = 3) => {
        const db = getCurrentDb();
        if (!db) return [];

        try {
            const events = await db.events.orderBy("timestamp").toArray();
            // V1.4.2: 增加 !e.is_locked 过滤点，锁定事件不参与精简合并
            const eligibleEvents = events.filter((e) =>
                e.level === 0 && !e.is_archived && !e.is_locked
            );

            if (eligibleEvents.length <= keepRecentCount) return [];
            return eligibleEvents.slice(
                0,
                eligibleEvents.length - keepRecentCount,
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get events to merge",
                error,
            );
            return [];
        }
    },

    deleteEvents: async (eventIds) => {
        if (eventIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.events.bulkDelete(eventIds);
            Logger.info(
                LogModule.MEMORY_STORE,
                `Deleted ${eventIds.length} events`,
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to delete events",
                error,
            );
            throw error;
        }
    },

    deleteEventsByEpisode: async (episodeId) => {
        if (!episodeId) return 0;
        const db = getCurrentDb();
        if (!db) return 0;
        try {
            const all = await db.events.toArray();
            const ids = all
                .filter((e) => e.episode_id === episodeId)
                .map((e) => e.id);
            if (ids.length === 0) return 0;
            await db.events.bulkDelete(ids);
            Logger.info(
                LogModule.MEMORY_STORE,
                `Deleted ${ids.length} events for episode ${episodeId}`,
            );
            return ids.length;
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to delete events by episode",
                error,
            );
            return 0;
        }
    },

    updateEvent: async (eventId, updates) => {
        if (!eventId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            const { id: _id, timestamp: _ts, ...safeUpdates } = updates;
            await db.events.update(eventId, safeUpdates);
            Logger.info(
                LogModule.MEMORY_STORE,
                `Updated event: ${eventId}`,
                safeUpdates,
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to update event",
                error,
            );
            throw error;
        }
    },

    updateEvents: async (updatesList) => {
        if (updatesList.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.transaction("rw", db.events, async () => {
                for (const { id, updates } of updatesList) {
                    const { id: _id, timestamp: _ts, ...safeUpdates } = updates;
                    await db.events.update(id, safeUpdates);
                }
            });
            Logger.info(
                LogModule.MEMORY_STORE,
                `Batch updated ${updatesList.length} events`,
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to batch update events",
                error,
            );
            throw error;
        }
    },

    getAllEvents: async () => {
        const db = getCurrentDb();
        if (!db) return [];

        try {
            return await db.events.orderBy("timestamp").toArray();
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to get all events",
                error,
            );
            return [];
        }
    },

    archiveEvents: async (eventIds) => {
        if (eventIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.events.where("id").anyOf(eventIds).modify({
                is_archived: true,
            });
            Logger.info(
                LogModule.MEMORY_STORE,
                `Archived ${eventIds.length} events`,
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to archive events",
                error,
            );
        }
    },

    markEventsAsEmbedded: async (eventIds) => {
        if (eventIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.events.where("id").anyOf(eventIds).modify({
                is_embedded: true,
            });
            Logger.info(
                LogModule.MEMORY_STORE,
                `Marked ${eventIds.length} events as embedded`,
            );
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to mark events as embedded",
                error,
            );
        }
    },

    toggleEventLock: async (eventId) => {
        if (!eventId) return false;
        const db = getCurrentDb();
        if (!db) return false;

        try {
            const existing = await db.events.get(eventId);
            if (!existing) return false;

            const newLockState = !existing.is_locked;
            await db.events.update(eventId, { is_locked: newLockState });
            Logger.info(
                LogModule.MEMORY_STORE,
                `Toggled event lock: ${eventId} -> ${newLockState}`,
            );
            return newLockState;
        } catch (error) {
            Logger.error(
                LogModule.MEMORY_STORE,
                "Failed to toggle event lock",
                error,
            );
            return false;
        }
    },
}));
