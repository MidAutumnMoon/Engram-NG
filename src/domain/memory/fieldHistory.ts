/**
 * fieldHistory - 状态字段历史的纯函数操作
 *
 * 这一层是 episode-as-source-of-truth 重构的核心数据结构操作。
 * 所有函数都是纯函数（无 I/O、无副作用、不依赖 Dexie/Zustand/LLM），
 * 因此可以被 deno test 直接覆盖。SaveEntity / 读路径只是薄包装。
 *
 * 区间语义：半开区间 [from_index, to_index)，与 Graphiti 的 [valid_at, invalid_at) 一致。
 * - resolveAt(from_index) 返回该区间的新值
 * - resolveAt(to_index) 返回下一段的值（边界归属下一段）
 * - to_index = null 表示至今有效
 *
 * 不变量（由 validateHistory 校验）：
 * 1. 数组按 from_index 升序
 * 2. 相邻区间允许 gap（prev.to_index < next.from_index），禁止 overlap
 *    —— gap 表示「该消息区间内无记录状态」，resolveAt 返回 undefined
 * 3. 至多一个 open interval（to_index === null），且只能是最后一段
 */

import type { ValueInterval } from "@/data/types/graph.ts";

/**
 * 追加一段新区间。副作用：
 * - 把上一段 open interval（to_index===null）的 to_index 设为 newInterval.from_index
 * - 校验合并后的历史满足不变量
 *
 * 返回新数组（不就地修改）。
 */
export function appendInterval(
    history: ValueInterval[] | undefined,
    newInterval: Omit<ValueInterval, "to_index"> & { to_index?: number | null },
): ValueInterval[] {
    const base = history ? [...history] : [];
    const normalized: ValueInterval = {
        value: newInterval.value,
        from_index: newInterval.from_index,
        to_index: newInterval.to_index ?? null,
        episode_id: newInterval.episode_id,
    };

    // 关闭上一段 open interval
    if (base.length > 0) {
        const last = base[base.length - 1];
        if (last.to_index === null) {
            base[base.length - 1] = {
                ...last,
                to_index: normalized.from_index,
            };
        } else {
            // 上一段已关闭；要求新区间必须紧接其后或更晚——这里允许更晚但报 gap 风险
            // 交给 validateHistory 在最终校验阶段判定
        }
    }

    base.push(normalized);
    validateHistory(base);
    return base;
}

/**
 * 在指定消息索引处解析字段取值（as-of 查询）。
 * 半开区间：resolveAt(from) -> 新值；resolveAt(to) -> 下一段值。
 * 目标索引早于第一段区间时返回 undefined（该字段尚未有状态）。
 */
export function resolveAt(
    history: ValueInterval[] | undefined,
    targetIndex: number,
): unknown | undefined {
    if (!history || history.length === 0) return undefined;

    for (const interval of history) {
        const from = interval.from_index;
        const to = interval.to_index;
        if (targetIndex < from) return undefined;
        if (to === null || targetIndex < to) {
            return interval.value;
        }
        // targetIndex >= to：归属下一段，继续循环
    }
    // 所有区间都已结束且最后一段 to_index 非 null——理论上不应发生（应由 null 兜底）
    return undefined;
}

/**
 * 返回当前取值（最近一段 open interval 的 value）。
 * 若所有区间均已关闭（to_index !== null，数据损坏或实体已「死亡」），返回 undefined。
 * 语义与 resolveAt(history, MAX_SAFE_INTEGER) 等价，但无需遍历。
 */
export function currentValue(
    history: ValueInterval[] | undefined,
): unknown | undefined {
    if (!history || history.length === 0) return undefined;
    const last = history[history.length - 1];
    return last.to_index === null ? last.value : undefined;
}

/**
 * 显式校验历史满足不变量。违反时抛错——尽早暴露数据腐败。
 */
export function validateHistory(
    history: ValueInterval[] | undefined,
): void {
    if (!history || history.length === 0) return;

    let openCount = 0;
    for (let i = 0; i < history.length; i++) {
        const cur = history[i];

        if (cur.to_index !== null && cur.to_index <= cur.from_index) {
            throw new Error(
                `Invalid interval at index ${i}: to_index (${cur.to_index}) must be > from_index (${cur.from_index})`,
            );
        }

        if (cur.to_index === null) {
            openCount++;
            if (openCount > 1) {
                throw new Error(
                    `Invalid history: multiple open intervals (to_index===null) at index ${i}`,
                );
            }
            if (i !== history.length - 1) {
                throw new Error(
                    `Invalid history: open interval not at the tail (index ${i})`,
                );
            }
        }

        if (i > 0) {
            const prev = history[i - 1];
            if (prev.to_index === null) {
                // 已经在 openCount 检查里捕获
                throw new Error(
                    `Invalid history: open interval followed by another at index ${i}`,
                );
            }
            // 允许 gap（prev.to_index < cur.from_index），仅禁止 overlap
            if (prev.to_index > cur.from_index) {
                throw new Error(
                    `Invalid history: overlap between index ${
                        i - 1
                    } (to=${prev.to_index}) and index ${i} (from=${cur.from_index})`,
                );
            }
        }
    }
}

/**
 * 从旧 profile 回填 field_history（迁移 + 新实体 seed 共用）。
 * 对每个命中 stateFields 的字段，生成一段 synthetic 区间：
 * { value: profile[field], from_index, to_index: null, episode_id }
 *
 * - 迁移用：from_index=0, episode_id=null（旧数据无溯源）
 * - 新实体 seed：from_index=该实体首次出现的消息索引, episode_id=创建它的 pass
 *
 * 字段值为 undefined/缺失时跳过该字段。
 */
export function backfillFromProfile(
    profile: Record<string, unknown> | undefined | null,
    stateFields: readonly string[],
    from_index: number = 0,
    episode_id: string | null = null,
): Record<string, ValueInterval[]> {
    const out: Record<string, ValueInterval[]> = {};
    if (!profile) return out;

    for (const field of stateFields) {
        if (
            field in profile &&
            profile[field] !== undefined &&
            profile[field] !== null
        ) {
            out[field] = [{
                value: profile[field],
                from_index,
                to_index: null,
                episode_id,
            }];
        }
    }
    return out;
}
