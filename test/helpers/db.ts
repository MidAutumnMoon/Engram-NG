/**
 * fake-indexeddb 测试夹具
 *
 * Deno 原生测试无浏览器 IndexedDB；用 fake-indexeddb 注入一个等价的实现，
 * 让 ChatDatabase 能像生产那样 db.entities.put / toArray。
 *
 * 用法：
 *   import { openTestDb, closeTestDb } from "@/../test/helpers/db.ts";
 *   const db = await openTestDb("test-chat");
 *   await db.entities.put(...);
 *   await closeTestDb("test-chat");
 *
 * 每个 chatId 独立数据库，互不串扰；closeTestDb 删除实例并清理底层数据库。
 */
// IMPORTANT: fake-indexeddb MUST be imported before dexie.
// ESM evaluates deps in source order; dexie captures `globalThis.indexedDB` at
// module-eval time into its internal deps table. If dexie evaluates before this
// side-effecting import runs, `Dexie.delete` / `db.open()` fail with
// `_deps.indexedDB` undefined. Test files must import this helper (or the
// re-exported Dexie below) before any direct dexie import.
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { ChatDatabase } from "@/data/db.ts";

// Re-export so tests don't import dexie directly (which would bypass this ordering).
export { Dexie };

/** 已打开的测试数据库实例缓存（chatId -> ChatDatabase） */
const openDbs = new Map<string, ChatDatabase>();

/**
 * 打开（创建）一个测试用 ChatDatabase。
 * fake-indexeddb 的数据库随进程存活；同 chatId 重复打开会复用缓存实例。
 */
export async function openTestDb(chatId: string): Promise<ChatDatabase> {
    const existing = openDbs.get(chatId);
    if (existing) return existing;

    const db = new ChatDatabase(chatId);
    // 触发 schema 初始化 + 升级钩子（Dexie 懒打开，首次 table 访问才执行）
    await db.open();
    openDbs.set(chatId, db);
    return db;
}

/**
 * 关闭并删除一个测试数据库。每个测试结束都应调用，避免跨用例残留。
 */
export async function closeTestDb(chatId: string): Promise<void> {
    const db = openDbs.get(chatId);
    if (db) {
        db.close();
        openDbs.delete(chatId);
    }
    await Dexie.delete(`Engram_${chatId}`);
}

/**
 * 关闭并删除所有已打开的测试数据库——用于全局 teardown。
 */
export async function closeAllTestDbs(): Promise<void> {
    const ids = [...openDbs.keys()];
    for (const id of ids) {
        await closeTestDb(id);
    }
}
