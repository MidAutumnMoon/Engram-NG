import { chatManager } from "@/data/ChatManager.ts";
import {
    type ChatDatabase,
    deleteDatabase,
    getDbForChat,
    tryGetDbForChat,
} from "@/data/db.ts";
import type { EventNode } from "@/data/types/graph.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { getCurrentChatId } from "@/sillytavern/index.ts";
import type { StateCreator } from "zustand";

export interface CoreState {
    currentChatId: string | null;
    /**
     * 统一摄取游标（summary + entity 共享）。
     * 由 getProcessedFloor() 解析，含旧字段兜底。
     */
    lastProcessedFloor: number;
    isProcessing: boolean;
    recentEvents: EventNode[];

    // Actions
    initChat: () => Promise<ChatDatabase | null>;
    setLastProcessedFloor: (floor: number) => Promise<void>;
    setProcessing: (isProcessing: boolean) => void;
    reset: () => void;
    clearChatDatabase: () => Promise<void>;
    deleteChatDatabase: () => Promise<void>;

    // V0.6 Compat
    resolveScope: (
        chatId: string,
        characterName?: string,
    ) => Promise<{ id: number }>;
    currentScope: { id: number } | null;
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
                currentScope: { id: 1 },
                lastProcessedFloor: getProcessedFloor(state),
                recentEvents: [],
            });
        }

        return getDbForChat(chatId);
    },

    isProcessing: false,

    lastProcessedFloor: 0,

    recentEvents: [],

    reset: () =>
        set({
            currentChatId: null,
            currentScope: null,
            lastProcessedFloor: 0,
            isProcessing: false,
            recentEvents: [],
        }),

    resolveScope: async (chatId, _characterName) => {
        set({ currentChatId: chatId, currentScope: { id: 1 } });
        const state = await chatManager.getState();
        set({ lastProcessedFloor: getProcessedFloor(state) });
        return { id: 1 };
    },

    setLastProcessedFloor: async (floor) => {
        await chatManager.updateState({ last_processed_floor: floor });
        set({ lastProcessedFloor: floor });
    },

    setProcessing: (isProcessing) => set({ isProcessing }),
});
