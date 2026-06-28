/**
 * computeFlashbackTarget 单元测试
 *
 * 纯函数——覆盖 flashback 锚点判定。
 * 基准是 frontier（last_processed_floor），不是 chat.length。
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { computeFlashbackTarget } from "@/domain/rag/injection/flashback.ts";

describe("computeFlashbackTarget", () => {
    it("anchors when the top event is well beyond the min-distance threshold", () => {
        // frontier=100, minDistance=10 → 锚定边界为 msg 90 及更早
        expect(computeFlashbackTarget(50, 100)).toBe(50);
        expect(computeFlashbackTarget(89, 100)).toBe(89);
    });

    it("returns undefined for a recent event within the threshold", () => {
        // msg 95 距前沿 100 仅 5 条 < 10 → 不锚定（普通「当前状态」查询）
        expect(computeFlashbackTarget(95, 100)).toBeUndefined();
        // 恰好命中前沿本身 → 当然不锚定
        expect(computeFlashbackTarget(100, 100)).toBeUndefined();
    });

    it("treats the boundary as anchoring (half-open: <=)", () => {
        // topEndIndex == frontier - minDistance → 锚定（边界归属锚定）
        expect(computeFlashbackTarget(90, 100)).toBe(90);
    });

    it("returns undefined when topEndIndex is null/undefined", () => {
        expect(computeFlashbackTarget(undefined, 100)).toBeUndefined();
    });

    it("honors a custom minDistance", () => {
        // 更严格的阈值：minDistance=20 → 边界降到 msg 80
        expect(computeFlashbackTarget(85, 100, 20)).toBeUndefined();
        expect(computeFlashbackTarget(80, 100, 20)).toBe(80);
    });

    it("works against frontier=0 (fresh chat, no extraction yet)", () => {
        // 没跑过提取时 frontier=0；任何 end_index 都不会锚定
        expect(computeFlashbackTarget(5, 0)).toBeUndefined();
        expect(computeFlashbackTarget(0, 0)).toBeUndefined();
    });
});
