/**
 * Logger 模块导出
 */

export { Logger } from "./Logger.ts";

export { LogLevel, LogLevelConfig } from "./types.ts";
export type {
    LogEntry,
    RecallLogEntry,
    RecallResultItem,
    RecallStats,
} from "./types.ts";

// V0.9.10: 模块命名规范
export { ALL_MODULES, LogModule } from "./LogModule.ts";

// 模块元数据（图标、所属域）—— UI 层用
export {
    DEFAULT_MODULE_META,
    getModuleMeta,
    MODULE_META,
    type ModuleMeta,
} from "./moduleMeta.ts";
