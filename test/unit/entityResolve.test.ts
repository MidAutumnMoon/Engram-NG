/**
 * entityResolve 单元测试
 *
 * 纯函数模块。覆盖：
 * - stringCandidates：精确名 > 别名；多别名歧义返回全部（修复旧的静默取第一）
 * - embeddingCandidates：余弦 top-K、确定性平局、无向量跳过
 * - cosineSimilarity 与 EmbeddingService 同算法（正交返回 0、自相似返回 1）
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
    cosineSimilarity,
    embeddingCandidates,
    stringCandidates,
} from "@/domain/memory/entityResolve.ts";
import { type EntityNode, EntityType } from "@/data/types/graph.ts";

function mkEntity(
    over: Partial<EntityNode> & Pick<EntityNode, "id" | "name">,
): EntityNode {
    return {
        aliases: [],
        description: "",
        last_updated_at: 0,
        profile: {},
        type: EntityType.Unknown,
        ...over,
    };
}

describe("stringCandidates", () => {
    it("returns exact when the primary name matches", () => {
        const e = mkEntity({ id: "a", name: "knight" });
        const out = stringCandidates("knight", [e]);
        expect(out.exact).toBe(e);
        expect(out.ambiguous).toEqual([]);
    });

    it("returns alias matches in ambiguous (even single — let caller re-verify via embedding)", () => {
        const e = mkEntity({
            id: "a",
            name: "sir galahad",
            aliases: ["knight"],
        });
        const out = stringCandidates("knight", [e]);
        expect(out.exact).toBeUndefined();
        expect(out.ambiguous).toEqual([e]);
    });

    it("returns ALL matches in ambiguous on multi-alias conflict (fixes silent-first-match bug)", () => {
        const e1 = mkEntity({
            id: "a",
            name: "sir lancelot",
            aliases: ["knight"],
        });
        const e2 = mkEntity({
            id: "b",
            name: "sir galahad",
            aliases: ["knight"],
        });
        const out = stringCandidates("knight", [e1, e2]);
        expect(out.exact).toBeUndefined();
        expect(out.ambiguous).toHaveLength(2);
        expect(out.ambiguous).toContain(e1);
        expect(out.ambiguous).toContain(e2);
    });

    it("exact primary name wins over alias matches", () => {
        const exact = mkEntity({ id: "a", name: "knight" });
        const aliased = mkEntity({
            id: "b",
            name: "sir x",
            aliases: ["knight"],
        });
        const out = stringCandidates("knight", [exact, aliased]);
        expect(out.exact).toBe(exact);
        expect(out.ambiguous).toEqual([]);
    });

    it("returns empty result for unknown / blank name", () => {
        const out = stringCandidates("ghost", [
            mkEntity({ id: "a", name: "knight" }),
        ]);
        expect(out.exact).toBeUndefined();
        expect(out.ambiguous).toEqual([]);

        const blank = stringCandidates("", [
            mkEntity({ id: "a", name: "knight" }),
        ]);
        expect(blank.ambiguous).toEqual([]);
    });
});

describe("cosineSimilarity", () => {
    it("returns 1 for an identical vector", () => {
        const v = [1, 2, 3];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
    });

    it("returns 0 for orthogonal vectors", () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });

    it("returns 0 for mismatched dimensions or zero vectors", () => {
        expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
        expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
        expect(cosineSimilarity([], [])).toBe(0);
    });
});

describe("embeddingCandidates", () => {
    it("returns top-K by descending similarity", () => {
        const query = [1, 0];
        const entities = [
            mkEntity({ id: "far", name: "far", embedding: [0, 1] }), // cos=0
            mkEntity({ id: "close", name: "close", embedding: [1, 0] }), // cos=1
            mkEntity({ id: "mid", name: "mid", embedding: [1, 1] }), // cos≈0.707
        ];
        const out = embeddingCandidates(query, entities, 2);
        expect(out.map((e) => e.id)).toEqual(["close", "mid"]);
    });

    it("skips entities without embeddings", () => {
        const query = [1, 0];
        const entities = [
            mkEntity({ id: "has", name: "has", embedding: [1, 0] }),
            mkEntity({ id: "none", name: "none" }),
        ];
        const out = embeddingCandidates(query, entities, 5);
        expect(out.map((e) => e.id)).toEqual(["has"]);
    });

    it("breaks ties deterministically by name then id", () => {
        const query = [1, 0];
        const entities = [
            mkEntity({ id: "z", name: "zeta", embedding: [1, 0] }),
            mkEntity({ id: "a", name: "alpha", embedding: [1, 0] }),
        ];
        const out = embeddingCandidates(query, entities, 2);
        // equal cosine=1 -> sorted by name asc: "alpha" before "zeta"
        expect(out.map((e) => e.id)).toEqual(["a", "z"]);
    });

    it("returns empty for empty query or k<=0", () => {
        const entities = [
            mkEntity({ id: "a", name: "a", embedding: [1, 0] }),
        ];
        expect(embeddingCandidates([], entities, 5)).toEqual([]);
        expect(embeddingCandidates([1], entities, 0)).toEqual([]);
    });
});
