import { create } from "zustand";
import type { CoreState } from "./memory/slices/coreSlice.ts";
import { createCoreSlice } from "./memory/slices/coreSlice.ts";
import type { EntityState } from "./memory/slices/entitySlice.ts";
import { createEntitySlice } from "./memory/slices/entitySlice.ts";
import type { EventState } from "./memory/slices/eventSlice.ts";
import { createEventSlice } from "./memory/slices/eventSlice.ts";

// 导出所有可能用到的类型
export * from "./memory/slices/coreSlice.ts";
export * from "./memory/slices/entitySlice.ts";
export * from "./memory/slices/eventSlice.ts";

// 合并后的整体 State
export type MemoryState = CoreState & EntityState & EventState;

/**
 * Memory Store
 * 经 V0.9.15 重构：拆分为多个独立切片 (Slice Pattern) 以降低耦合和文件体积
 */
export const useMemoryStore = create<MemoryState>()((...a) => ({
    ...createCoreSlice(...a),
    ...createEntitySlice(...a),
    ...createEventSlice(...a),
}));
