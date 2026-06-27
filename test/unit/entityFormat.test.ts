/**
 * entityFormat 单元测试
 *
 * 纯函数模块。覆盖：
 * - getEntityDisplaySnapshot：合并状态字段（as-of）与非状态字段（profile）
 * - formatEntityYaml / formatEntityDescription：name + YAML 渲染
 * - formatEntityStateBlocks：按类型分组、XML 标签
 * - formatArchivedEntityBlock：归档提醒块
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
    formatArchivedEntityBlock,
    formatEntityDescription,
    formatEntityStateBlocks,
    formatEntityYaml,
    getEntityDisplaySnapshot,
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

describe("getEntityDisplaySnapshot", () => {
    it("merges non-state profile fields with state fields resolved as-of latest", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status", "magic_reserve"],
            field_history: {
                status: [
                    { value: "警觉", from_index: 1, to_index: null, episode_id: "ep1" },
                ],
                magic_reserve: [
                    { value: "低", from_index: 1, to_index: null, episode_id: "ep1" },
                ],
            },
            // profile 不再含状态字段（移除并行写后）；仅保留非状态字段
            profile: { identity: "守护者", description: "森林守护者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        // 非状态字段来自 profile
        expect(snap.identity).toBe("守护者");
        expect(snap.description).toBe("森林守护者");
        // 状态字段从 field_history 解析（即使 profile 中没有）
        expect(snap.status).toBe("警觉");
        expect(snap.magic_reserve).toBe("低");
    });

    it("resolves a state field as-of a past target_index (half-open boundary)", () => {
        const e = mkEntity({
            name: "knight",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    { value: "wounded", from_index: 0, to_index: 10, episode_id: "ep1" },
                    { value: "healed", from_index: 10, to_index: null, episode_id: "ep2" },
                ],
            },
            profile: { identity: "a knight" },
        });
        // as-of msg 5: wounded
        expect(getEntityDisplaySnapshot(e, 5).status).toBe("wounded");
        // as-of msg 10 (half-open: 归属下一段): healed
        expect(getEntityDisplaySnapshot(e, 10).status).toBe("healed");
        // as-of latest: healed
        expect(getEntityDisplaySnapshot(e).status).toBe("healed");
    });

    it("falls back to profile when field_history has a gap at the target", () => {
        const e = mkEntity({
            name: "knight",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    { value: "wounded", from_index: 0, to_index: 10, episode_id: "ep1" },
                    { value: "healed", from_index: 20, to_index: null, episode_id: "ep2" },
                ],
            },
            // 迁移期数据：profile 仍带旧值；gap 时回退到此
            profile: { status: "healed", identity: "knight" },
        });
        // gap at msg 15: resolveAt 返回 undefined → 回退 profile
        expect(getEntityDisplaySnapshot(e, 15).status).toBe("healed");
    });

    it("falls back to profile when tracked field has no history (migration-period entity)", () => {
        const e = mkEntity({
            name: "old",
            tracked_fields: ["status"],
            field_history: {},
            profile: { status: "legacy-value", identity: "x" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap.status).toBe("legacy-value");
        expect(snap.identity).toBe("x");
    });

    it("preserves array-valued state fields", () => {
        const e = mkEntity({
            name: "Shirako",
            tracked_fields: ["equipment"],
            field_history: {
                equipment: [
                    { value: ["匕首", "剑"], from_index: 1, to_index: null, episode_id: "ep1" },
                ],
            },
            profile: { identity: "旅者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap.equipment).toEqual(["匕首", "剑"]);
        expect(snap.identity).toBe("旅者");
    });

    it("returns a plain profile copy when no tracked_fields are declared", () => {
        const e = mkEntity({
            name: "loc",
            tracked_fields: [],
            field_history: {},
            profile: { features: ["dark"], description: "a cave" },
        });
        expect(getEntityDisplaySnapshot(e)).toEqual({
            features: ["dark"],
            description: "a cave",
        });
    });
});

describe("formatEntityYaml", () => {
    it("resolves tracked state field to its as-of interval value", () => {
        const e = mkEntity({
            name: "Seraphina",
            type: EntityType.Character,
            tracked_fields: ["status"],
            field_history: {
                status: [
                    { value: "警觉", from_index: 1, to_index: 10, episode_id: "ep1" },
                    { value: "魔力耗尽", from_index: 10, to_index: null, episode_id: "ep2" },
                ],
            },
            profile: { status: "魔力耗尽", identity: "森林守护者" },
        });
        // as-of msg 5 (within [1,10)): 警觉
        const out5 = formatEntityYaml(e, 5);
        expect(out5).toContain("status: 警觉");
        expect(out5).not.toContain("魔力耗尽");
        // 非状态字段恒取 profile
        expect(out5).toContain("identity: 森林守护者");
        // as-of msg 10 (half-open): 魔力耗尽
        expect(formatEntityYaml(e, 10)).toContain("status: 魔力耗尽");
    });

    it("falls back to profile when target is in a gap", () => {
        const e = mkEntity({
            name: "knight",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    { value: "wounded", from_index: 0, to_index: 10, episode_id: "ep1" },
                    { value: "healed", from_index: 20, to_index: null, episode_id: "ep2" },
                ],
            },
            profile: { status: "healed" },
        });
        // gap at 15 → undefined → profile fallback
        expect(formatEntityYaml(e, 15)).toContain("status: healed");
    });

    it("renders array-valued state fields as a YAML block sequence", () => {
        const e = mkEntity({
            name: "Shirako",
            tracked_fields: ["equipment"],
            field_history: {
                equipment: [
                    { value: ["匕首", "旧剑"], from_index: 1, to_index: null, episode_id: "ep1" },
                ],
            },
            profile: { equipment: ["匕首", "旧剑"] },
        });
        const out = formatEntityYaml(e, 5);
        expect(out).toContain("equipment:");
        expect(out).toContain("- 匕首");
        expect(out).toContain("- 旧剑");
    });

    it("puts the entity name on the first line", () => {
        const e = mkEntity({
            name: "Eldoria森林",
            profile: { identity: "魔法森林" },
        });
        expect(formatEntityYaml(e, 0).startsWith("Eldoria森林\n")).toBe(true);
    });
});

describe("formatEntityDescription", () => {
    it("renders name + YAML of the latest display snapshot", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    { value: "警觉", from_index: 1, to_index: null, episode_id: "ep1" },
                ],
            },
            profile: { identity: "守护者" },
        });
        const out = formatEntityDescription(e);
        expect(out.startsWith("Seraphina\n")).toBe(true);
        expect(out).toContain("identity: 守护者");
        expect(out).toContain("status: 警觉");
    });

    it("serializes array-valued snapshot fields as YAML sequences", () => {
        const e = mkEntity({
            name: "Shirako",
            tracked_fields: ["equipment"],
            field_history: {
                equipment: [
                    { value: ["匕首", "旧剑"], from_index: 1, to_index: null, episode_id: "ep1" },
                ],
            },
            profile: { identity: "旅者" },
        });
        const out = formatEntityDescription(e);
        expect(out).toContain("identity: 旅者");
        expect(out).toContain("equipment:");
        expect(out).toContain("- 匕首");
        expect(out).toContain("- 旧剑");
    });
});

describe("formatEntityStateBlocks", () => {
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

    it("routes unknown types to the entity_state tag", () => {
        const e = mkEntity({
            name: "怪东西",
            type: "weird" as EntityType,
            profile: {},
        });
        expect(formatEntityStateBlocks([e], 0)).toContain("<entity_state>");
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
