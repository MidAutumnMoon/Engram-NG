/**
 * v4 迁移纯函数测试
 *
 * 覆盖 migrateEntityV3toV4：
 * - profile 命中 stateFields -> 生成 synthetic open interval
 * - profile 未命中 -> field_history = {}（空对象）
 * - 保留所有其他字段
 * - 已有 field_history -> 幂等，不重写
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { migrateEntityV3toV4 } from "@/data/migrations/v4.ts";
import { type EntityNode, EntityType } from "@/data/types/graph.ts";

function mkV3(over: Partial<EntityNode>): EntityNode {
    return {
        aliases: [],
        description: "",
        id: "e1",
        last_updated_at: 0,
        name: "knight",
        profile: {},
        type: EntityType.Character,
        ...over,
    };
}

describe("migrateEntityV3toV4", () => {
    it("backfills field_history from profile state fields", () => {
        const v3 = mkV3({
            profile: { state: "wounded", status: "alive", name: "knight" },
        });
        const out = migrateEntityV3toV4(v3);
        expect(out.field_history?.state).toEqual([{
            value: "wounded",
            from_index: 0,
            to_index: null,
            episode_id: null,
        }]);
        expect(out.field_history?.status).toEqual([{
            value: "alive",
            from_index: 0,
            to_index: null,
            episode_id: null,
        }]);
        // non-state field not included
        expect("name" in (out.field_history ?? {})).toBe(false);
    });

    it("produces empty field_history object when profile has no state fields", () => {
        const v3 = mkV3({ profile: { identity: "a knight", tags: ["brave"] } });
        const out = migrateEntityV3toV4(v3);
        expect(out.field_history).toEqual({});
    });

    it("preserves all other entity fields", () => {
        const v3 = mkV3({
            aliases: ["warrior"],
            description: "knight\nprofile yaml",
            embedding: [1, 2, 3],
            id: "ent_abc",
            is_locked: true,
            layout_x: 10,
            layout_y: 20,
            name: "knight",
            profile: { state: "wounded" },
            type: EntityType.Character,
        });
        const out = migrateEntityV3toV4(v3);
        expect(out.id).toBe("ent_abc");
        expect(out.name).toBe("knight");
        expect(out.aliases).toEqual(["warrior"]);
        expect(out.description).toBe("knight\nprofile yaml");
        expect(out.embedding).toEqual([1, 2, 3]);
        expect(out.is_locked).toBe(true);
        expect(out.layout_x).toBe(10);
        expect(out.layout_y).toBe(20);
        expect(out.type).toBe(EntityType.Character);
        expect(out.profile).toEqual({ state: "wounded" });
    });

    it("respects a custom stateFields list", () => {
        const v3 = mkV3({
            profile: { state: "wounded", aura: "dark", mood: "calm" },
        });
        const out = migrateEntityV3toV4(v3, ["aura"]);
        expect(out.field_history?.aura).toEqual([{
            value: "dark",
            from_index: 0,
            to_index: null,
            episode_id: null,
        }]);
        // state / mood not in the custom list -> not backfilled
        expect("state" in (out.field_history ?? {})).toBe(false);
        expect("mood" in (out.field_history ?? {})).toBe(false);
    });

    it("is idempotent when field_history already exists", () => {
        const existing = mkV3({
            field_history: {
                state: [
                    {
                        value: "wounded",
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { state: "wounded" },
        });
        const out = migrateEntityV3toV4(existing);
        // existing history preserved, not overwritten with a synthetic [0,null) interval
        expect(out.field_history?.state).toEqual([{
            value: "wounded",
            from_index: 10,
            to_index: null,
            episode_id: "ep1",
        }]);
    });

    it("does not mutate the input entity", () => {
        const v3 = mkV3({ profile: { state: "wounded" } });
        const snapshot = JSON.parse(JSON.stringify(v3));
        migrateEntityV3toV4(v3);
        expect(v3).toEqual(snapshot);
    });
});
