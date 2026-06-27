/**
 * v5 迁移：把 summary / entity 两个独立游标合并为统一摄取游标。
 *
 * 这是「统一摄取 pass」重构的 schema 升级。纯函数——给定一个 ScopeState-shaped
 * 对象，返回补齐 last_processed_floor 的新对象，不动旧字段（保留兜底用）。
 *
 * 规则：last_processed_floor = max(last_summarized_floor, last_extracted_floor)。
 * - 用 max 而非 min：避免重新总结/提取已覆盖的楼层（会产生重复事件/实体）。
 * - summary 游标是 chat-history 切片的真相源（chatHistory.ts），不能回退；
 *   entity 游标通常滞后（entity 从 summary 游标重算范围）。max 取更靠前的进度，
 *   既不丢已总结内容，也不重提已提取范围。
 *
 * 幂等：若 last_processed_floor 已有正值，原样返回。
 *
 * 接受结构子类型而非完整 ScopeState，避免把 db.ts 的迁移逻辑耦合进 graph.ts 的类型。
 */

type CursorState = {
    last_summarized_floor?: number;
    last_extracted_floor?: number;
    last_processed_floor?: number;
    [key: string]: unknown;
};

export function reconcileCursors<T extends CursorState>(state: T): T {
    // 幂等：已迁移则不动
    if ((state.last_processed_floor ?? 0) > 0) {
        return state;
    }

    const summarized = state.last_summarized_floor || 0;
    const extracted = state.last_extracted_floor || 0;
    const reconciled = Math.max(summarized, extracted);

    return {
        ...state,
        last_processed_floor: reconciled,
    };
}
