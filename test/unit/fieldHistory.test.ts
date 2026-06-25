/**
 * fieldHistory 单元测试
 *
 * 纯函数模块，无 ST/Dexie/LLM 依赖。覆盖：
 * - 半开区间 [from, to) 边界归属
 * - appendInterval 关闭上一段 open interval
 * - 不变量校验（gap/overlap/multiple-open）
 * - 从 profile 回填
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
    appendInterval,
    backfillFromProfile,
    currentValue,
    endLastInterval,
    resolveAt,
    validateHistory,
} from "@/domain/memory/fieldHistory.ts";
import type { ValueInterval } from "@/data/types/graph.ts";

describe("appendInterval", () => {
    it("creates a new history from empty", () => {
        const h = appendInterval(undefined, {
            from_index: 0,
            value: "wounded",
            episode_id: "ep1",
        });
        expect(h).toHaveLength(1);
        expect(h[0]).toEqual({
            value: "wounded",
            from_index: 0,
            to_index: null,
            episode_id: "ep1",
        });
    });

    it("closes the previous open interval at the new from_index", () => {
        const h0 = appendInterval(undefined, {
            from_index: 10,
            value: "wounded",
            episode_id: "ep1",
        });
        const h1 = appendInterval(h0, {
            from_index: 26,
            value: "healed",
            episode_id: "ep2",
        });
        expect(h1).toHaveLength(2);
        expect(h1[0].to_index).toBe(26);
        expect(h1[1].to_index).toBe(null);
    });

    it("does not alter a previous already-closed interval", () => {
        const closed: ValueInterval[] = [{
            value: "a",
            from_index: 0,
            to_index: 10,
            episode_id: "ep0",
        }];
        const h = appendInterval(closed, {
            from_index: 20,
            value: "b",
            episode_id: "ep1",
        });
        expect(h[0].to_index).toBe(10); // untouched
        expect(h[1].from_index).toBe(20);
    });
});

describe("resolveAt — half-open [from, to)", () => {
    const history: ValueInterval[] = [
        { value: "wounded", from_index: 10, to_index: 26, episode_id: "ep1" },
        { value: "healed", from_index: 26, to_index: null, episode_id: "ep2" },
    ];

    it("returns undefined before the first interval begins", () => {
        expect(resolveAt(history, 5)).toBeUndefined();
        expect(resolveAt(history, 9)).toBeUndefined();
    });

    it("returns the new value exactly at from_index", () => {
        expect(resolveAt(history, 10)).toBe("wounded");
        expect(resolveAt(history, 26)).toBe("healed");
    });

    it("returns the old value at to_index - 1 (boundary belongs to next segment)", () => {
        expect(resolveAt(history, 25)).toBe("wounded");
    });

    it("returns the next value at to_index (half-open boundary)", () => {
        expect(resolveAt(history, 26)).toBe("healed");
    });

    it("returns current value at any point past the last from_index", () => {
        expect(resolveAt(history, 100)).toBe("healed");
    });

    it("returns undefined for empty history", () => {
        expect(resolveAt(undefined, 10)).toBeUndefined();
        expect(resolveAt([], 10)).toBeUndefined();
    });

    it("returns undefined during a gap between intervals", () => {
        const gapped: ValueInterval[] = [
            { value: "a", from_index: 0, to_index: 10, episode_id: "ep1" },
            { value: "b", from_index: 20, to_index: null, episode_id: "ep2" },
        ];
        expect(resolveAt(gapped, 10)).toBeUndefined(); // half-open: [0,10) ends at 10
        expect(resolveAt(gapped, 15)).toBeUndefined(); // inside the gap
        expect(resolveAt(gapped, 19)).toBeUndefined();
    });
});

describe("currentValue", () => {
    it("returns the value of the last interval regardless of to_index", () => {
        const open: ValueInterval[] = [
            { value: "x", from_index: 0, to_index: null, episode_id: "ep1" },
        ];
        expect(currentValue(open)).toBe("x");

        const closed: ValueInterval[] = [
            { value: "x", from_index: 0, to_index: 5, episode_id: "ep1" },
            { value: "y", from_index: 5, to_index: 10, episode_id: "ep2" },
        ];
        expect(currentValue(closed)).toBe("y");
    });

    it("returns undefined for empty history", () => {
        expect(currentValue(undefined)).toBeUndefined();
        expect(currentValue([])).toBeUndefined();
    });
});

describe("endLastInterval", () => {
    it("closes an open last interval at the given index", () => {
        const h: ValueInterval[] = [
            { value: "a", from_index: 0, to_index: null, episode_id: "ep1" },
        ];
        const out = endLastInterval(h, 30);
        expect(out[0].to_index).toBe(30);
    });

    it("leaves an already-closed tail unchanged", () => {
        const h: ValueInterval[] = [
            { value: "a", from_index: 0, to_index: 10, episode_id: "ep1" },
        ];
        const out = endLastInterval(h, 30);
        expect(out[0].to_index).toBe(10);
    });

    it("returns empty/undefined as-is", () => {
        expect(endLastInterval(undefined, 5)).toEqual([]);
        expect(endLastInterval([], 5)).toEqual([]);
    });
});

describe("validateHistory", () => {
    it("passes for a valid history", () => {
        expect(() =>
            validateHistory([
                {
                    value: "a",
                    from_index: 0,
                    to_index: 10,
                    episode_id: "ep1",
                },
                {
                    value: "b",
                    from_index: 10,
                    to_index: null,
                    episode_id: "ep2",
                },
            ])
        ).not.toThrow();
    });

    it("allows a gap between intervals (unrecorded period)", () => {
        // gap = the field had no recorded state during [10,20); resolveAt(15) -> undefined
        expect(() =>
            validateHistory([
                {
                    value: "a",
                    from_index: 0,
                    to_index: 10,
                    episode_id: "ep1",
                },
                {
                    value: "b",
                    from_index: 20,
                    to_index: null,
                    episode_id: "ep2",
                },
            ])
        ).not.toThrow();
    });

    it("throws on overlap between intervals", () => {
        expect(() =>
            validateHistory([
                {
                    value: "a",
                    from_index: 0,
                    to_index: 15,
                    episode_id: "ep1",
                },
                {
                    value: "b",
                    from_index: 10,
                    to_index: null,
                    episode_id: "ep2",
                },
            ])
        ).toThrow();
    });

    it("throws when multiple open intervals exist", () => {
        expect(() =>
            validateHistory([
                {
                    value: "a",
                    from_index: 0,
                    to_index: null,
                    episode_id: "ep1",
                },
                {
                    value: "b",
                    from_index: 10,
                    to_index: null,
                    episode_id: "ep2",
                },
            ])
        ).toThrow();
    });

    it("throws when to_index <= from_index", () => {
        expect(() =>
            validateHistory([{
                value: "a",
                from_index: 10,
                to_index: 10,
                episode_id: "ep1",
            }])
        ).toThrow();
        expect(() =>
            validateHistory([{
                value: "a",
                from_index: 10,
                to_index: 5,
                episode_id: "ep1",
            }])
        ).toThrow();
    });
});

describe("backfillFromProfile", () => {
    it("produces one synthetic open interval per present state field", () => {
        const out = backfillFromProfile(
            { state: "wounded", status: "alive", name: "knight" },
            ["state", "status"],
        );
        expect(out.state).toEqual([{
            value: "wounded",
            from_index: 0,
            to_index: null,
            episode_id: null,
        }]);
        expect(out.status).toEqual([{
            value: "alive",
            from_index: 0,
            to_index: null,
            episode_id: null,
        }]);
        // non-state fields not included
        expect("name" in out).toBe(false);
    });

    it("skips state fields that are absent or nullish", () => {
        const out = backfillFromProfile(
            { state: undefined, status: null, mood: "calm" },
            ["state", "status", "mood"],
        );
        expect("state" in out).toBe(false);
        expect("status" in out).toBe(false);
        expect(out.mood).toHaveLength(1);
    });

    it("returns empty object for empty/missing profile", () => {
        expect(backfillFromProfile(undefined, ["state"])).toEqual({});
        expect(backfillFromProfile({}, ["state"])).toEqual({});
    });
});
