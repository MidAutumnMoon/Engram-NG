/**
 * Dexie v3 → v4 迁移集成测试（唯一的集成测试）
 *
 * 这是整个测试套件里唯一一次真实 Dexie 往返。fake-indexeddb 提供等价 IndexedDB，
 * 让我们验证：打开 v3 数据库写入一个旧实体 → 重开为 v4 → upgrade 钩子跑过 →
 * 读出的实体已 backfill field_history。
 *
 * 纯函数测试（migrations/v4.test.ts）覆盖迁移逻辑本身；本测试只验证 schema 钩子
 * 真的被触发、Dexie 表结构不报错。一个错误的 schema 声明会让这里红——这是它的价值。
 */
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

// Dexie MUST come from the helper (it ensures fake-indexeddb is imported first).
import { closeTestDb, Dexie, openTestDb } from "../helpers/db.ts";
import type { EntityNode } from "@/data/types/graph.ts";
import { EntityType } from "@/data/types/graph.ts";

const CHAT_ID = "migration-test";

afterEach(async () => {
    await closeTestDb(CHAT_ID);
});

describe("Dexie v4 migration", () => {
    it("backfills field_history on existing entities when upgrading to v4", async () => {
        // 1. 直接在 v3 schema 下写入一个旧实体（绕过 ChatDatabase，模拟历史数据）
        //    使用原生 Dexie，按 v3 形状建库写入
        const dbName = `Engram_${CHAT_ID}`;
        const v3 = new Dexie(dbName);
        v3.version(3).stores({
            events:
                "id, timestamp, significance_score, level, is_archived, is_embedded",
            entities: "id, type, name, *aliases, is_archived",
            meta: "key",
        });
        const legacyEntity: EntityNode = {
            aliases: ["warrior"],
            description: "knight\nidentity: a knight",
            id: "ent_legacy",
            last_updated_at: 1000,
            name: "knight",
            profile: { state: "wounded", identity: "a knight" },
            type: EntityType.Character,
        };
        await v3.entities.add(legacyEntity);
        v3.close();

        // 2. 用 ChatDatabase（v4）重新打开——触发 upgrade 钩子
        const db = await openTestDb(CHAT_ID);
        // 强制一次 table 访问以确保 Dexie 完成懒打开与升级
        const all = await db.entities.toArray();

        // 3. 验证 field_history 已 backfill
        const migrated = all.find((e) => e.id === "ent_legacy");
        expect(migrated).toBeDefined();
        expect(migrated!.field_history?.state).toEqual([{
            value: "wounded",
            from_index: 0,
            to_index: null,
            episode_id: null,
        }]);
        // 其他字段保留
        expect(migrated!.name).toBe("knight");
        expect(migrated!.aliases).toEqual(["warrior"]);
        expect(migrated!.profile.state).toBe("wounded");
    });

    it("opens a fresh v4 database without error when no prior data exists", async () => {
        const db = await openTestDb(CHAT_ID);
        // 写入一个新 v4 实体（含 field_history）应能正常往返
        const fresh: EntityNode = {
            aliases: [],
            description: "",
            field_history: {
                state: [
                    {
                        value: "healed",
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            id: "ent_fresh",
            last_updated_at: 2000,
            name: "mage",
            profile: { state: "healed" },
            type: EntityType.Character,
        };
        await db.entities.put(fresh);
        const read = await db.entities.get("ent_fresh");
        expect(read?.field_history?.state).toEqual([{
            value: "healed",
            from_index: 10,
            to_index: null,
            episode_id: "ep1",
        }]);
    });
});
