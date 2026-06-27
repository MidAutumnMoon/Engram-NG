/**
 * entityFormat 单元测试
 *
 * 纯函数模块。覆盖：
 * - getEntityDisplaySnapshot：合并状态字段（as-of）与非状态字段（profile）
 * - formatEntityYaml：状态字段 as-of 解析、回退 profile、半开边界
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

describe("getEntityDisplaySnapshot", () => {
    it("merges non-state profile fields with resolved state fields", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            // profile 不再含 status（已移除 parallel write）；只含非状态字段
            profile: { identity: "守护者", description: "森林精灵" },
        });
        const snap = getEntityDisplaySnapshot(e);
        // 非状态字段来自 profile
        expect(snap.identity).toBe("守护者");
        expect(snap.description).toBe("森林精灵");
        // 状态字段从 field_history 解析
        expect(snap.status).toBe("警觉");
    });

    it("resolves state field as-of target_index", () => {
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
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep2",
                    },
                ],
            },
            profile: { identity: "a knight" },
        });
        // as-of msg 5: wounded
        expect(getEntityDisplaySnapshot(e, 5).status).toBe("wounded");
        // as-of msg 10 (half-open): healed
        expect(getEntityDisplaySnapshot(e, 10).status).toBe("healed");
    });

    it("falls back to profile when field_history resolves to undefined (gap)", () => {
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
            // 旧 profile 仍有 status（迁移期数据）；gap 时回退到它
            profile: { status: "healed", identity: "knight" },
        });
        // as-of msg 15 (gap): resolveAt 返回 undefined → 回退 profile
        expect(getEntityDisplaySnapshot(e, 15).status).toBe("healed");
    });

    it("returns profile as-is when entity has no tracked_fields", () => {
        const e = mkEntity({
            name: "loc",
            profile: { identity: "森林", features: ["密"] },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap).toEqual({ identity: "森林", features: ["密"] });
    });

    it("handles array-valued state fields", () => {
        const e = mkEntity({
            name: "Shirako",
            tracked_fields: ["equipment"],
            field_history: {
                equipment: [
                    {
                        value: ["匕首", "剑"],
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { identity: "旅者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap.equipment).toEqual(["匕首", "剑"]);
        expect(snap.identity).toBe("旅者");
    });
});

describe("formatEntityDescription", () => {
    it("renders name + YAML snapshot with resolved state fields", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { identity: "守护者" },
        });
        const out = formatEntityDescription(e);
        expect(out.startsWith("Seraphina\n")).toBe(true);
        expect(out).toContain("identity: 守护者");
        expect(out).toContain("status: 警觉");
    });
});

describe("getEntityDisplaySnapshot", () => {
    it("merges non-state profile fields with resolved state fields", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            // profile no longer carries state after the parallel-write removal;
            // identity/description still come from profile
            profile: { identity: "守护者", description: "森林守护" },
        });
        const snap = getEntityDisplaySnapshot(e);
        // non-state field from profile
        expect(snap.identity).toBe("守护者");
        expect(snap.description).toBe("森林守护");
        // state field resolved from field_history (as-of latest)
        expect(snap.status).toBe("警觉");
    });

    it("resolves state field at a past target_index", () => {
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
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep2",
                    },
                ],
            },
            profile: { identity: "a knight" },
        });
        // as-of msg 5 -> wounded
        expect(getEntityDisplaySnapshot(e, 5).status).toBe("wounded");
        // as-of msg 10 (half-open: belongs to next) -> healed
        expect(getEntityDisplaySnapshot(e, 10).status).toBe("healed");
        // as-of latest -> healed
        expect(getEntityDisplaySnapshot(e).status).toBe("healed");
    });

    it("falls back to profile when field_history is missing for a tracked field", () => {
        // migration-period entity: tracked_fields declared but field_history empty/absent
        const e = mkEntity({
            name: "old",
            tracked_fields: ["status"],
            field_history: {},
            profile: { status: "legacy-value", identity: "x" },
        });
        const snap = getEntityDisplaySnapshot(e);
        // no history to resolve -> profile value preserved as fallback
        expect(snap.status).toBe("legacy-value");
        expect(snap.identity).toBe("x");
    });

    it("falls back to profile when target is in a gap", () => {
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
        // gap at 15 -> resolveAt undefined -> profile fallback
        expect(getEntityDisplaySnapshot(e, 15).status).toBe("healed");
    });

    it("preserves array-valued state fields", () => {
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
            profile: { identity: "旅者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(Array.isArray(snap.equipment)).toBe(true);
        expect(snap.equipment).toEqual(["匕首", "旧剑"]);
    });

    it("returns profile-only snapshot for entities with no tracked_fields", () => {
        const e = mkEntity({
            name: "plain",
            tracked_fields: [],
            profile: { identity: "普通实体", note: "无状态" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap).toEqual({ identity: "普通实体", note: "无状态" });
    });
});

describe("formatEntityDescription", () => {
    it("renders name on first line + YAML of merged snapshot", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { identity: "守护者" },
        });
        const out = formatEntityDescription(e);
        expect(out.startsWith("Seraphina\n")).toBe(true);
        expect(out).toContain("identity: 守护者");
        expect(out).toContain("status: 警觉");
    });
});

describe("getEntityDisplaySnapshot", () => {
    it("merges non-state profile fields with resolved state fields", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status", "magic_reserve"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
                magic_reserve: [
                    {
                        value: "低",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            // profile 中状态字段可能已不存在（移除并行写后）；非状态字段保留
            profile: { identity: "守护者", description: "森林守护者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        // 非状态字段来自 profile
        expect(snap.identity).toBe("守护者");
        expect(snap.description).toBe("森林守护者");
        // 状态字段从 field_history 解析（即便 profile 中没有）
        expect(snap.status).toBe("警觉");
        expect(snap.magic_reserve).toBe("低");
    });

    it("resolves state fields as-of target_index (past value)", () => {
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
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep2",
                    },
                ],
            },
            profile: { identity: "a knight" },
        });
        // as-of msg 5: wounded (first interval)
        expect(getEntityDisplaySnapshot(e, 5).status).toBe("wounded");
        // as-of latest: healed
        expect(getEntityDisplaySnapshot(e).status).toBe("healed");
        // as-of msg 10: half-open → belongs to second segment → healed
        expect(getEntityDisplaySnapshot(e, 10).status).toBe("healed");
    });

    it("falls back to profile when field_history resolves to undefined (gap)", () => {
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
            // profile 仍带状态值（迁移期/创建时遗留）——gap 时回退到此
            profile: { status: "healed", identity: "knight" },
        });
        // gap at msg 15: resolveAt returns undefined → profile fallback
        expect(getEntityDisplaySnapshot(e, 15).status).toBe("healed");
    });

    it("returns plain profile copy when no tracked_fields declared", () => {
        const e = mkEntity({
            name: "loc",
            profile: { identity: "森林", features: ["树"] },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap).toEqual({ identity: "森林", features: ["树"] });
    });

    it("handles array-valued state fields from field_history", () => {
        const e = mkEntity({
            name: "Shirako",
            tracked_fields: ["equipment"],
            field_history: {
                equipment: [
                    {
                        value: ["匕首", "剑"],
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { identity: "旅者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap.equipment).toEqual(["匕首", "剑"]);
        expect(snap.identity).toBe("旅者");
    });
});

describe("formatEntityDescription", () => {
    it("renders name + YAML of the display snapshot", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            profile: { identity: "守护者" },
        });
        const desc = formatEntityDescription(e);
        expect(desc.startsWith("Seraphina\n")).toBe(true);
        expect(desc).toContain("identity: 守护者");
        expect(desc).toContain("status: 警觉");
    });
});

describe("getEntityDisplaySnapshot", () => {
    it("merges non-state profile fields with resolved state fields", () => {
        const e = mkEntity({
            name: "Seraphina",
            tracked_fields: ["status", "magic_reserve"],
            field_history: {
                status: [
                    {
                        value: "警觉",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
                magic_reserve: [
                    {
                        value: "低",
                        from_index: 1,
                        to_index: null,
                        episode_id: "ep1",
                    },
                ],
            },
            // profile no longer carries state fields (parallel write removed)
            profile: { identity: "守护者", description: "森林守护者" },
        });
        const snap = getEntityDisplaySnapshot(e);
        // non-state fields from profile
        expect(snap.identity).toBe("守护者");
        expect(snap.description).toBe("森林守护者");
        // state fields resolved from field_history
        expect(snap.status).toBe("警觉");
        expect(snap.magic_reserve).toBe("低");
    });

    it("resolves as-of a past index, not just latest", () => {
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
                        from_index: 10,
                        to_index: null,
                        episode_id: "ep2",
                    },
                ],
            },
            profile: { identity: "a knight" },
        });
        // as-of msg 5: wounded
        const past = getEntityDisplaySnapshot(e, 5);
        expect(past.status).toBe("wounded");
        // as-of latest (default): healed
        const latest = getEntityDisplaySnapshot(e);
        expect(latest.status).toBe("healed");
    });

    it("falls back to profile when field_history has a gap at target", () => {
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
            // profile still has the old value (gap fallback target)
            profile: { status: "wounded", identity: "knight" },
        });
        // gap at 15 → resolveAt returns undefined → profile fallback
        const snap = getEntityDisplaySnapshot(e, 15);
        expect(snap.status).toBe("wounded");
    });

    it("returns profile as-is when entity has no tracked_fields", () => {
        const e = mkEntity({
            name: "loc",
            tracked_fields: [],
            field_history: {},
            profile: { features: ["dark"], description: "a cave" },
        });
        const snap = getEntityDisplaySnapshot(e);
        expect(snap).toEqual({ features: ["dark"], description: "a cave" });
    });

    it("formatEntityDescription renders the snapshot as YAML", () => {
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
            profile: { identity: "旅者" },
        });
        const desc = formatEntityDescription(e);
        expect(desc.startsWith("Shirako\n")).toBe(true);
        expect(desc).toContain("identity: 旅者");
        expect(desc).toContain("equipment:");
        expect(desc).toContain("- 匕首");
        expect(desc).toContain("- 旧剑");
    });
});
