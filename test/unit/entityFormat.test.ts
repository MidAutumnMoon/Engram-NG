/**
 * entityFormat 单元测试
 *
 * 纯函数模块。覆盖：
 * - formatEntityYaml：状态字段 as-of 解析、回退 profile、半开边界
 * - formatEntityStateBlocks：按类型分组、XML 标签
 * - formatArchivedEntityBlock：归档提醒块
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
    formatArchivedEntityBlock,
    formatEntityStateBlocks,
    formatEntityYaml,
} from "@/domain/memory/entityFormat.ts";
import { EntityType, type EntityNode } from "@/data/types/graph.ts";

function mkEntity(over: Partial<EntityNode>): EntityNode {
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

describe("formatEntityYaml — as-of resolution", () => {
    it("resolves a tracked state field to its as-of interval value", () => {
        const e = mkEntity({
            name: "Seraphina",
            type: EntityType.Character,
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: 10,
                        episode_id: "ep1",
                    },
                    {
                        value: "魔力耗尽",
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep2",
                    },
                ],
            },
            profile: { status: "魔力耗尽", identity: "森林守护者" },
        });
        // as-of msg 5 (during [1,10)): returns "警觉"
        const out5 = formatEntityYaml(e, 5);
        expect(out5).toContain("status: 警觉");
        expect(out5).not.toContain("魔力耗尽");
        // identity (non-tracked) always from profile
        expect(out5).toContain("identity: 森林守护者");

        // as-of msg 10 (half-open: belongs to next segment): returns "魔力耗尽"
        const out10 = formatEntityYaml(e, 10);
        expect(out10).toContain("status: 魔力耗尽");
    });

    it("falls back to profile snapshot when field_history is empty", () => {
        const e = mkEntity({
            name: "knight",
            tracked_fields: [],
            field_history: {},
            profile: { status: "wounded", identity: "a knight" },
        });
        const out = formatEntityYaml(e, 999);
        expect(out).toContain("status: wounded");
        expect(out).toContain("identity: a knight");
    });

    it("falls back to profile when target is in a gap", () => {
        // gap: [0,10) then [20,null). At index 15, resolveAt returns undefined → profile fallback.
        const e = mkEntity({
            name: "knight",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "wounded",
                        from_index: 0,
                        to_index: 10,
                        episode_id: "ep1",
                    },
                    {
                        value: "healed",
                        from_index: 20,
                        to_index: null,
                        episode_id: "ep2",
                    },
                ],
            },
            profile: { status: "healed" },
        });
        const out = formatEntityYaml(e, 15);
        // gap → undefined → profile fallback ("healed")
        expect(out).toContain("status: healed");
    });

    it("renders array-valued state fields as YAML block sequence", () => {
        const e = mkEntity({
            name: "Shirako",
            tracked_fields: ["equipment"],
            field_history: {
                equipment: [
                    {
                        value: ["匕首", "旧剑"],
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { equipment: ["匕首", "旧剑"] },
        });
        const out = formatEntityYaml(e, 5);
        expect(out).toContain("equipment:");
        expect(out).toContain("- 匕首");
        expect(out).toContain("- 旧剑");
    });

    it("includes the entity name on the first line", () => {
        const e = mkEntity({ name: "Eldoria森林", profile: { identity: "魔法森林" } });
        const out = formatEntityYaml(e, 0);
        expect(out.startsWith("Eldoria森林\n")).toBe(true);
    });
});

describe("formatEntityStateBlocks — grouping", () => {
    it("groups entities into typed XML tags", () => {
        const char = mkEntity({
            name: "Seraphina",
            type: EntityType.Character,
            profile: { identity: "守护者" },
        });
        const loc = mkEntity({
            name: "木屋",
            type: EntityType.Location,
            profile: { features: ["温暖"] },
        });
        const out = formatEntityStateBlocks([char, loc], 0);
        expect(out).toContain("<character_state>");
        expect(out).toContain("Seraphina");
        expect(out).toContain("<scene_state>");
        expect(out).toContain("木屋");
        expect(out).toContain("</character_state>");
        expect(out).toContain("</scene_state>");
    });

    it("returns empty string for no entities", () => {
        expect(formatEntityStateBlocks([], 0)).toBe("");
    });

    it("routes unknown types to entity_state tag", () => {
        const e = mkEntity({
            name: "怪东西",
            type: "weird" as EntityType,
            profile: {},
        });
        const out = formatEntityStateBlocks([e], 0);
        expect(out).toContain("<entity_state>");
    });
});

describe("formatArchivedEntityBlock", () => {
    it("renders a minimal identity block for archived entities", () => {
        const archived = [
            mkEntity({
                name: "旧敌",
                profile: { identity: "已死的反派", description: "重要伏笔" },
            }),
        ];
        const out = formatArchivedEntityBlock(archived);
        expect(out).toContain("<archived_entities>");
        expect(out).toContain("旧敌:");
        expect(out).toContain("identity: 已死的反派");
        expect(out).toContain("description: 重要伏笔");
        expect(out).toContain("</archived_entities>");
    });

    it("returns empty string for no archived entities", () => {
        expect(formatArchivedEntityBlock([])).toBe("");
    });
});
