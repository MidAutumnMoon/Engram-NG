/**
 * Custom Hooks 导出
 */

// Hooks from UseApiPresets are extracted and distributed

export { useDashboardData } from "./useDashboardData.ts";
export type {
    DashboardData,
    FeatureStatus,
    MemoryStats,
    SystemHealth,
} from "./useDashboardData.ts";

// V0.9.9 New Hooks
export { useLLMPresets } from "./useLLMPresets.ts";
export type { UseLLMPresetsReturn } from "./useLLMPresets.ts";

export { useWorldInfo } from "./useWorldInfo.ts";
export type { UseWorldInfoReturn } from "./useWorldInfo.ts";

export { useRegexRules } from "./useRegexRules.ts";
export type { UseRegexRulesReturn } from "./useRegexRules.ts";

export { useConfig } from "./useConfig.ts";
export type { UseConfigReturn } from "./useConfig.ts";
