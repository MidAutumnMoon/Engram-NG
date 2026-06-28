import { generateShortUUID } from "@/utils/shortUUID.ts";
import type { EventNode } from "@/data/types/graph.ts";
import type { StateCreator } from "zustand";
import { getCurrentDb, tryGetCurrentDb } from "./coreSlice.ts";

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

export const createEventSlice: StateCreator<any, [], [], EventState> = (
    set,
    _get,
) => ({
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

        set((state: any) => ({
            recentEvents: [...state.recentEvents, event].slice(-10),
        }));

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
            console.error(
                "[MemoryStore] Failed to get event summaries:",
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
            console.error(
                "[MemoryStore] Failed to get summary anchor:",
                error,
            );
            return null;
        }
    },

    getRecalledEvents: async (recalledIds: string[]) => {
        if (recalledIds.length === 0) return [];
        const db = tryGetCurrentDb();
        if (!db) return [];
        try {
            return await db.events.where("id").anyOf(recalledIds).toArray();
        } catch (error) {
            console.error(
                "[MemoryStore] Failed to get recalled events:",
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
            console.error(
                "[MemoryStore] Failed to get timeline event ids:",
                error,
            );
            return new Set<string>();
        }
    },

    archiveEvents: async (eventIds: string[]) => {
        if (eventIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.events.where("id").anyOf(eventIds).modify({
                is_archived: true,
            });
            console.log(`[MemoryStore] Archived ${eventIds.length} events`);
        } catch (error) {
            console.error("[MemoryStore] Failed to archive events:", error);
        }
    },

    markEventsAsEmbedded: async (eventIds: string[]) => {
        if (eventIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;
        try {
            await db.events.where("id").anyOf(eventIds).modify({
                is_embedded: true,
            });
            console.log(
                `[MemoryStore] Marked ${eventIds.length} events as embedded`,
            );
        } catch (error) {
            console.error(
                "[MemoryStore] Failed to mark events as embedded:",
                error,
            );
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
            console.error(
                "[MemoryStore] Failed to get events to merge:",
                error,
            );
            return [];
        }
    },

    deleteEvents: async (eventIds: string[]) => {
        if (eventIds.length === 0) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            await db.events.bulkDelete(eventIds);
            console.log(`[MemoryStore] Deleted ${eventIds.length} events`);
        } catch (error) {
            console.error("[MemoryStore] Failed to delete events:", error);
            throw error;
        }
    },

    deleteEventsByEpisode: async (episodeId: string) => {
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
            console.log(
                `[MemoryStore] Deleted ${ids.length} events for episode ${episodeId}`,
            );
            return ids.length;
        } catch (error) {
            console.error(
                "[MemoryStore] Failed to delete events by episode:",
                error,
            );
            return 0;
        }
    },

    updateEvent: async (eventId: string, updates: Partial<EventNode>) => {
        if (!eventId) return;
        const db = getCurrentDb();
        if (!db) return;

        try {
            const { id: _id, timestamp: _ts, ...safeUpdates } = updates as any;
            await db.events.update(eventId, safeUpdates);
            console.log(`[MemoryStore] Updated event: ${eventId}`, safeUpdates);
        } catch (error) {
            console.error("[MemoryStore] Failed to update event:", error);
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
                    const { id: _id, timestamp: _ts, ...safeUpdates } =
                        updates as any;
                    await db.events.update(id, safeUpdates);
                }
            });
            console.log(
                `[MemoryStore] Batch updated ${updatesList.length} events`,
            );
        } catch (error) {
            console.error(
                "[MemoryStore] Failed to batch update events:",
                error,
            );
            throw error;
        }
    },

    toggleEventLock: async (eventId: string) => {
        if (!eventId) return false;
        const db = getCurrentDb();
        if (!db) return false;

        try {
            const existing = await db.events.get(eventId);
            if (!existing) return false;

            const newLockState = !existing.is_locked;
            await db.events.update(eventId, { is_locked: newLockState });
            console.log(
                `[MemoryStore] Toggled event lock: ${eventId} -> ${newLockState}`,
            );
            return newLockState;
        } catch (error) {
            console.error("[MemoryStore] Failed to toggle event lock:", error);
            return false;
        }
    },

    getAllEvents: async () => {
        const db = getCurrentDb();
        if (!db) return [];

        try {
            return await db.events.orderBy("timestamp").toArray();
        } catch (error) {
            console.error("[MemoryStore] Failed to get all events:", error);
            return [];
        }
    },
});
