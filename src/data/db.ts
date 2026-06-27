/**
 * Engram Database (Dexie.js)
 *
 * V0.6 Multi-Database Architecture: each chat_id gets its own isolated
 * IndexedDB database. This module owns three concerns:
 *   1. Dexie schema (`ChatDatabase` class)
 *   2. Instance factory + cache (`getDbForChat`, `tryGetDbForChat`, ...)
 *   3. Lifecycle admin (`deleteDatabase`, `listAllChatIds`, `getDatabaseStats`)
 *
 * Phase 2.2 routes more traffic through here — services previously went via
 * `state/memoryStore.ts` now call `db.events.toArray()` etc. directly.
 *
 * See file-bottom for deferred refactor options.
 */

import type { Table } from "dexie";
import Dexie from "dexie";
import type { EntityNode, EventNode } from "./types/graph.ts";

/** 迁移用的 ScopeState 结构形状（避免把整份 ScopeState 类型耦合进 db.ts） */
interface ScopeStateLike {
    last_summarized_floor?: number;
    last_extracted_floor?: number;
    last_processed_floor?: number;
    [key: string]: unknown;
}

/**
 * 每个聊天的元数据存储
 */
export interface ChatMeta {
    key: string;
    value: unknown;
}

import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";

/**
 * ChatDatabase - 单个聊天的数据库类
 */
export class ChatDatabase extends Dexie {
    events!: Table<EventNode, string>;
    entities!: Table<EntityNode, string>;
    meta!: Table<ChatMeta, string>;

    private chatId: string;

    constructor(chatId: string) {
        // 数据库名格式: Engram_{chatId}
        super(`Engram_${chatId}`);
        this.chatId = chatId;

        // V0.9.4: Schema 升级 - entities 表添加 *aliases
        // V1.5.0: Schema 升级 - 添加 is_archived, is_embedded 索引支持 Dashboard 高效统计
        this.version(3).stores({
            // Events: 核心记忆单元
            events:
                "id, timestamp, significance_score, level, is_archived, is_embedded",
            // Entities: 图谱实体 (添加 is_archived 索引)
            entities: "id, type, name, *aliases, is_archived",
            // Meta: 状态存储 (lastSummarizedFloor 等)
            meta: "key",
        });

        // V2.0.0: Schema 升级 - episode-as-source-of-truth 重构
        // schema string 不变（新字段 field_history/episode_id 是非索引 JSON），
        // 仅需一个 upgrade 钩子把 v3 实体的 profile 状态字段回填到 field_history。
        // 事件侧的 entity_refs/episode_id 由新写入时补充，旧事件保持 undefined（读路径容错）。
        this.version(4).stores({
            events:
                "id, timestamp, significance_score, level, is_archived, is_embedded",
            entities: "id, type, name, *aliases, is_archived",
            meta: "key",
        }).upgrade(async (tx) => {
            const { migrateEntityV3toV4 } = await import(
                "./migrations/v4.ts"
            );
            await tx.table("entities").toCollection().modify((entity) => {
                Object.assign(entity, migrateEntityV3toV4(entity));
            });
        });

        // V2.1.0: 统一摄取游标 —— 把 last_summarized_floor / last_extracted_floor
        // 合并为 last_processed_floor。schema string 不变（新字段是非索引 JSON），
        // 仅 reconcile meta 表里的 scope_state 行。旧字段保留作兜底。
        this.version(5).stores({
            events:
                "id, timestamp, significance_score, level, is_archived, is_embedded",
            entities: "id, type, name, *aliases, is_archived",
            meta: "key",
        }).upgrade(async (tx) => {
            const { reconcileCursors } = await import(
                "./migrations/v5.ts"
            );
            const stateRow = await tx.table("meta").get("scope_state");
            if (stateRow?.value) {
                const reconciled = reconcileCursors(
                    stateRow.value as ScopeStateLike,
                );
                await tx.table("meta").put({
                    key: "scope_state",
                    value: reconciled,
                });
            }
        });

        // 注册数据变动监听钩子
        const handleChange = () => this.updateLastModified();

        this.events.hook("creating", handleChange);
        this.entities.hook("updating", handleChange);
        this.events.hook("deleting", handleChange);

        this.entities.hook("creating", handleChange);
        this.entities.hook("updating", handleChange);
        this.entities.hook("deleting", handleChange);
    }

    private lastUpdateTimer: any = null;

    // NOTE: 这套 debounce + `Dexie.ignoreTransaction` + `setTimeout` 机制存在的
    // 唯一目的是为 `GlobalDatabaseList.tsx` 的「按更新时间排序」UI 提供
    // `lastModified` 字段。如果未来替换该 UI（例如改用
    // `indexedDB.databases()` 原生 mtime），整个钩子链路与 `meta.lastModified`
    // 都可以删除。Phase 1.6 删除 SyncService 后，`meta.lastModified` 已不再
    // 有其他消费者。
    /**
     * 更新最后修改时间
     * V0.9.11: 增强导入期间的保护
     * V1.4.6: 优化为防抖宏任务，避免 P0/P1 合规性问题
     */
    private updateLastModified() {
        // 如果已经有一个在排队了，直接跳过 (500ms 窗口防抖)
        if (this.lastUpdateTimer) return;

        this.lastUpdateTimer = setTimeout(() => {
            this.lastUpdateTimer = null;

            // 使用 ignoreTransaction 显式脱离当前潜在的 Hooks 事务
            // 防止在只读或特定表的事务中试图写入 meta 表导致 DEXIE 报错喵~
            Dexie.ignoreTransaction(async () => {
                try {
                    await this.meta.put({
                        key: "lastModified",
                        value: Date.now(),
                    });
                } catch (error) {
                    Logger.error(
                        LogModule.DATABASE,
                        `异步更新 lastModified 失败 (chat: '${this.chatId}')`,
                        error,
                    );
                }
            });
        }, 500);
    }
}

// ======================== 实例工厂与缓存 ========================

/** 数据库实例缓存 */
const dbCache = new Map<string, ChatDatabase>();

/**
 * 获取某个聊天的数据库实例（带缓存）
 */
export function getDbForChat(chatId: string): ChatDatabase {
    if (!chatId) {
        throw new Error("[Engram DB] chatId is required");
    }

    if (!dbCache.has(chatId)) {
        Logger.debug(
            LogModule.DATABASE,
            `Creating database for chat: ${chatId}`,
        );
        dbCache.set(chatId, new ChatDatabase(chatId));
    }
    return dbCache.get(chatId)!;
}

/**
 * 关闭并移除缓存的数据库
 */
function closeDb(chatId: string): void {
    const db = dbCache.get(chatId);
    if (db) {
        db.close();
        dbCache.delete(chatId);
        Logger.debug(LogModule.DATABASE, `Closed database for chat: ${chatId}`);
    }
}

/**
 * 检查某个聊天的数据库是否存在（不会自动创建）
 */
export function hasDbForChat(chatId: string): boolean {
    return dbCache.has(chatId);
}

/**
 * 获取数据库实例（如果存在），不自动创建
 */
export function tryGetDbForChat(chatId: string): ChatDatabase | null {
    return dbCache.get(chatId) || null;
}

/**
 * 删除整个聊天的数据库
 */
export async function deleteDatabase(chatId: string): Promise<void> {
    closeDb(chatId);
    await Dexie.delete(`Engram_${chatId}`);
    Logger.info(LogModule.DATABASE, `Deleted database for chat: ${chatId}`);
}

/**
 * 获取所有 Engram 数据库的 chatId 列表
 */
export async function listAllChatIds(): Promise<string[]> {
    const allDbs = await Dexie.getDatabaseNames();
    return allDbs
        .filter((name) => name.startsWith("Engram_"))
        .map((name) => name.replace("Engram_", ""));
}

export interface DatabaseStats {
    chatId: string;
    lastUpdateTime: number;
}

/**
 * 获取单个数据库的统计信息（仅包含基础信息）
 */
export async function getDatabaseStats(chatId: string): Promise<DatabaseStats> {
    try {
        // 使用单独的实例，查询完毕后迅速关闭
        const tempDb = new ChatDatabase(chatId);
        if (!await Dexie.exists(tempDb.name)) {
            tempDb.close();
            return { chatId, lastUpdateTime: 0 };
        }

        // 快速读取 meta 设置
        const lastModifiedMeta = await tempDb.meta.get("lastModified");
        tempDb.close();

        return {
            chatId,
            lastUpdateTime: lastModifiedMeta
                ? Number(lastModifiedMeta.value)
                : 0,
        };
    } catch (error) {
        Logger.error(
            LogModule.DATABASE,
            `Failed to get stats for chat ${chatId}`,
            error,
        );
        return { chatId, lastUpdateTime: 0 };
    }
}

// ======================== 未来重构参考 ========================
//
// 以下选项已被评估并主动推迟；记录在此供后人参考。
//
// B. 拆分为 db/schema.ts + db/factory.ts + db/admin.ts
//    优点：职责更清晰。缺点：当前文件不到 200 行，拆分会增加导航成本。
//    待文件超过 ~400 行或职责进一步膨胀再考虑。
//
// C. 引入 Repository 模式包装 Dexie
//    不推荐。`state/memory/slices/` 已扮演这个角色（eventSlice.ts 提供
//    `getEventsToMerge`、`countEventTokens` 等意图化方法）。Phase 2.2 step B
//    正在消除这层间接性——services 直接调用 `db.events.toArray()`。再加
//    Repository 会重新引入刚拆除的层。
//
// D. 用类型化字段替换 `meta` 的 KV bag
//    当前 `meta` 表用 `{key, value}` 存 `lastModified`、`STATE_KEY`、
//    `CHARACTER_KEY`。能工作但丢失了类型安全。需要 schema 迁移，目前不值得；
//    如未来要加更多 chat 级状态字段再考虑。
