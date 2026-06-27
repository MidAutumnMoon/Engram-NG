import { chatManager } from "@/data/ChatManager.ts";
import {
    type ChatDatabase,
    deleteDatabase,
    getDbForChat,
    tryGetDbForChat,
} from "@/data/db.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { getCurrentChatId } from "@/sillytavern/context.ts";
import type { StateCreator } from "zustand";

export interface CoreState {
    currentChatId: string | null;
    /**
     * 统一摄取游标（summary + entity 共享）。
     * 由 getProcessedFloor() 解析，含旧字段兜底。
     */
    lastProcessedFloor: number;
    recentEvents: EventNode[];

    // Actions
    initChat: () => Promise<ChatDatabase | null>;
    setLastProcessedFloor: (floor: number) => Promise<void>;
    reset: () => void;
    clearChatDatabase: () => Promise<void>;
    deleteChatDatabase: () => Promise<void>;
}

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

export const createCoreSlice: StateCreator<any, [], [], CoreState> = (
    set,
    get,
) => ({
    clearChatDatabase: async () => {
        let db = getCurrentDb();
        if (!db) {
            // Try to initialize it if missing
            db = await get().initChat();
            if (!db) {
                console.warn("[MemoryStore] No database available to clear");
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
                recentEvents: [],
            });
            console.info("[MemoryStore] Database cleared successfully");
        } catch (e) {
            console.error("[MemoryStore] Failed to clear database:", e);
            throw e;
        }
    },
    currentChatId: null,
    currentScope: null,
    deleteChatDatabase: async () => {
        const chatId = get().currentChatId || getCurrentChatId();
        if (!chatId) {
            throw new Error("未连接到聊天，无法删除");
        }

        try {
            await deleteDatabase(chatId);
            get().reset();
            console.info("[MemoryStore] Database deleted successfully");
        } catch (e) {
            console.error("[MemoryStore] Failed to delete database:", e);
            throw e;
        }
    },
    initChat: async () => {
        const chatId = getCurrentChatId();
        if (!chatId) {
            console.warn("[MemoryStore] No chat_id available");
            return null;
        }

        if (chatId !== get().currentChatId) {
            console.debug(`[MemoryStore] Switching to chat: ${chatId}`);
            const state = await chatManager.getState();
            set({
                currentChatId: chatId,
                lastProcessedFloor: getProcessedFloor(state),
                recentEvents: [],
            });
        }

        return getDbForChat(chatId);
    },

    lastProcessedFloor: 0,

    recentEvents: [],

    reset: () =>
        set({
            currentChatId: null,
            lastProcessedFloor: 0,
            recentEvents: [],
        }),

    setLastProcessedFloor: async (floor) => {
        await chatManager.updateState({ last_processed_floor: floor });
        set({ lastProcessedFloor: floor });
    },
});
