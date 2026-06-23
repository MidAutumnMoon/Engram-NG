import {
    Brain,
    Cloud,
    CloudCog,
    Cpu,
    Database,
    FileCode,
    FileText,
    Filter,
    GitBranch,
    Inbox,
    Layers,
    Link as LinkIcon,
    type LucideIcon,
    MessageSquare,
    Palette,
    PanelTop,
    Save,
    Search,
    Send,
    Server,
    Settings,
    Sparkles,
    Tag,
    Terminal,
    Trash2,
    Workflow,
    Zap,
} from "lucide-react";
import { LogModule } from "@/logger/LogModule.ts";

export interface ModuleMeta {
    icon: LucideIcon;
    /** Domain (for grouping, filtering, and UI filtering) */
    domain: string;
}

/**
 * 模块元数据表
 *
 * `Record<LogModule, ModuleMeta>` 的关键作用：
 * - 新增 LogModule 时，TS 会强制要求补全此表
 * - 删除 LogModule 时，此处的引用会立即报错
 * - 杜绝模块名与图标/分组的字符串漂移
 */
export const MODULE_META: Record<LogModule, ModuleMeta> = {
    // ===== 系统核心 =====
    [LogModule.SYSTEM]: { icon: Terminal, domain: "System" },
    [LogModule.EVENTS]: { icon: GitBranch, domain: "System" },
    [LogModule.LOGGER]: { icon: FileText, domain: "System" },

    // ===== 集成层 =====
    [LogModule.STBRIDGE]: { icon: LinkIcon, domain: "Integration" },
    [LogModule.TAVERN]: { icon: Server, domain: "Integration" },
    [LogModule.TAVERN_CHAT]: { icon: MessageSquare, domain: "Integration" },
    [LogModule.TAVERN_UI]: { icon: PanelTop, domain: "Integration" },
    [LogModule.TAVERN_CONTEXT]: { icon: Server, domain: "Integration" },
    [LogModule.TAVERN_EVENTS]: { icon: GitBranch, domain: "Integration" },
    [LogModule.CHAT_HISTORY]: { icon: MessageSquare, domain: "Integration" },
    [LogModule.EJS_PROCESSOR]: { icon: FileCode, domain: "Integration" },
    [LogModule.MACRO_SERVICE]: { icon: FileCode, domain: "Integration" },
    [LogModule.WORLDBOOK]: { icon: FileText, domain: "Integration" },

    // ===== LLM =====
    [LogModule.LLM]: { icon: CloudCog, domain: "LLM" },
    [LogModule.LLM_ADAPTER]: { icon: Cloud, domain: "LLM" },
    [LogModule.MODEL_SERVICE]: { icon: Sparkles, domain: "LLM" },

    // ===== 配置与设置 =====
    [LogModule.SETTINGS]: { icon: Settings, domain: "Settings" },
    [LogModule.THEME]: { icon: Palette, domain: "Settings" },

    // ===== 记忆管理 =====
    [LogModule.MEMORY_SUMMARY]: { icon: Brain, domain: "Memory" },
    [LogModule.MEMORY_ENTITY]: { icon: Brain, domain: "Memory" },
    [LogModule.MEMORY_TRIM]: { icon: Brain, domain: "Memory" },
    [LogModule.SUMMARIZER]: { icon: Brain, domain: "Memory" },
    [LogModule.ENTITY_BUILDER]: { icon: Brain, domain: "Memory" },
    [LogModule.ENTITY_SCANNER]: { icon: Search, domain: "Memory" },

    // ===== RAG =====
    [LogModule.RAG_EMBED]: { icon: Search, domain: "RAG" },
    [LogModule.RAG_RETRIEVE]: { icon: Search, domain: "RAG" },
    [LogModule.RAG_RERANK]: { icon: Filter, domain: "RAG" },
    [LogModule.RAG_INJECT]: { icon: Send, domain: "RAG" },
    [LogModule.RAG_CACHE]: { icon: Inbox, domain: "RAG" },
    [LogModule.INJECTOR]: { icon: Send, domain: "RAG" },
    [LogModule.BRAIN_RECALL_CACHE]: { icon: Inbox, domain: "RAG" },

    // ===== 预处理 =====
    [LogModule.PREPROCESS]: { icon: Cpu, domain: "Preprocess" },

    // ===== 批处理 =====
    [LogModule.BATCH]: { icon: Zap, domain: "Batch" },
    [LogModule.BATCH_ENGINE]: { icon: Zap, domain: "Batch" },

    // ===== Workflow Steps =====
    [LogModule.WF_FETCH_CONTEXT]: { icon: Workflow, domain: "Workflow" },
    [LogModule.WF_FETCH_EVENTS_TO_TRIM]: {
        icon: Workflow,
        domain: "Workflow",
    },
    [LogModule.WF_BUILD_PROMPT]: { icon: Workflow, domain: "Workflow" },
    [LogModule.WF_LLM_REQUEST]: { icon: CloudCog, domain: "Workflow" },
    [LogModule.WF_PARSE_JSON]: { icon: FileCode, domain: "Workflow" },
    [LogModule.WF_CLEAN_REGEX]: { icon: Filter, domain: "Workflow" },
    [LogModule.WF_REGEX_PROCESSOR]: { icon: Filter, domain: "Workflow" },
    [LogModule.WF_KEYWORD_RETRIEVE]: { icon: Tag, domain: "Workflow" },
    [LogModule.WF_USER_REVIEW]: { icon: MessageSquare, domain: "Workflow" },
    [LogModule.WF_APPLY_TRIM]: { icon: Workflow, domain: "Workflow" },
    [LogModule.WF_SAVE_ENTITY]: { icon: Save, domain: "Workflow" },
    [LogModule.WF_SAVE_EVENT]: { icon: Save, domain: "Workflow" },

    // ===== UI =====
    [LogModule.DASHBOARD]: { icon: PanelTop, domain: "UI" },
    [LogModule.DEV_LOG]: { icon: FileText, domain: "UI" },
    [LogModule.NOTIFICATION]: { icon: MessageSquare, domain: "UI" },
    [LogModule.QUICK_PANEL]: { icon: PanelTop, domain: "UI" },

    // ===== 数据层 =====
    [LogModule.DATA_SYNC]: { icon: Database, domain: "Data" },
    [LogModule.DATA_CLEANUP]: { icon: Trash2, domain: "Data" },
    [LogModule.DATA_DB]: { icon: Database, domain: "Data" },
    [LogModule.DATABASE]: { icon: Database, domain: "Data" },
    [LogModule.CHAT_MANAGER]: { icon: MessageSquare, domain: "Data" },
};

/**
 * 默认元数据（当模块名不在 MODULE_META 中——例如遗留的字符串调用——时使用）
 */
export const DEFAULT_MODULE_META: ModuleMeta = {
    domain: "Unknown",
    icon: Layers,
};

/**
 * 按模块名查询元数据。
 *
 * 入参为 `string` 而非 `LogModule`，因为 `LogEntry.module` 当前仍是 string
 * 类型——遗留调用未迁移完毕。返回默认元数据作为兜底。
 */
export function getModuleMeta(module: string): ModuleMeta {
    return (MODULE_META as Record<string, ModuleMeta>)[module] ??
        DEFAULT_MODULE_META;
}
