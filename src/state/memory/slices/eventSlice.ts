import { generateShortUUID } from "@/utils/shortUUID.ts";
import type { EventNode } from "@/data/types/graph.ts";
import type { StateCreator } from "zustand";
import { getCurrentDb, tryGetCurrentDb } from "./coreSlice.ts";

export interface EventState {
    saveEvent: (
        event: Omit<EventNode, "id" | "timestamp"> & { timestamp?: number },
    ) => Promise<EventNode>;
    getEventSummaries: (recalledIds?: string[]) => Promise<string>;

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

    getEventSummaries: async (recalledIds?: string[]) => {
        const db = tryGetCurrentDb();
        if (!db) return "";

        try {
            const events = await db.events.toArray();
            if (events.length === 0) return "";

            const recalledSet = recalledIds ? new Set(recalledIds) : null;
            const targetEvents = events.filter((e) => {
                if (e.level >= 1) return true;
                if (!e.is_archived) return true;
                if (e.is_archived && recalledSet?.has(e.id)) return true;
                return false;
            });

            targetEvents.sort((a, b) => a.timestamp - b.timestamp);

            const lines: string[] = [];
            let hasParent = false;

            for (const node of targetEvents) {
                if (node.level >= 1) {
                    lines.push(node.summary);
                    hasParent = true;
                } else if (node.is_archived) {
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
