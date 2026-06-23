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
}

/**
 * 模块元数据表
 *
 * `Record<LogModule, ModuleMeta>` 的关键作用：
 * - 新增 LogModule 时，TS 会强制要求补全此表
 * - 删除 LogModule 时，此处的引用会立即报错
 * - 杜绝模块名与图标的漂移
 */
export const MODULE_META: Record<LogModule, ModuleMeta> = {
    // ===== 系统核心 =====
    [LogModule.SYSTEM]: { icon: Terminal },
    [LogModule.EVENTS]: { icon: GitBranch },
    [LogModule.LOGGER]: { icon: FileText },

    // ===== 集成层 =====
    [LogModule.STBRIDGE]: { icon: LinkIcon },
    [LogModule.TAVERN]: { icon: Server },
    [LogModule.TAVERN_CHAT]: { icon: MessageSquare },
    [LogModule.TAVERN_UI]: { icon: PanelTop },
    [LogModule.TAVERN_CONTEXT]: { icon: Server },
    [LogModule.TAVERN_EVENTS]: { icon: GitBranch },
    [LogModule.CHAT_HISTORY]: { icon: MessageSquare },
    [LogModule.EJS_PROCESSOR]: { icon: FileCode },
    [LogModule.MACRO_SERVICE]: { icon: FileCode },
    [LogModule.WORLDBOOK]: { icon: FileText },

    // ===== LLM =====
    [LogModule.LLM]: { icon: CloudCog },
    [LogModule.LLM_ADAPTER]: { icon: Cloud },
    [LogModule.MODEL_SERVICE]: { icon: Sparkles },

    // ===== 配置与设置 =====
    [LogModule.SETTINGS]: { icon: Settings },
    [LogModule.THEME]: { icon: Palette },

    // ===== 记忆管理 =====
    [LogModule.MEMORY_SUMMARY]: { icon: Brain },
    [LogModule.MEMORY_ENTITY]: { icon: Brain },
    [LogModule.MEMORY_TRIM]: { icon: Brain },
    [LogModule.SUMMARIZER]: { icon: Brain },
    [LogModule.ENTITY_BUILDER]: { icon: Brain },
    [LogModule.ENTITY_SCANNER]: { icon: Search },

    // ===== RAG =====
    [LogModule.RAG_EMBED]: { icon: Search },
    [LogModule.RAG_RETRIEVE]: { icon: Search },
    [LogModule.RAG_RERANK]: { icon: Filter },
    [LogModule.RAG_INJECT]: { icon: Send },
    [LogModule.INJECTOR]: { icon: Send },

    // ===== 预处理 =====
    [LogModule.PREPROCESS]: { icon: Cpu },

    // ===== 批处理 =====
    [LogModule.BATCH]: { icon: Zap },
    [LogModule.BATCH_ENGINE]: { icon: Zap },

    // ===== Workflow Steps =====
    [LogModule.WF_FETCH_CONTEXT]: { icon: Workflow },
    [LogModule.WF_FETCH_EXISTING_ENTITIES]: { icon: Workflow },
    [LogModule.WF_FETCH_EVENTS_TO_TRIM]: { icon: Workflow },
    [LogModule.WF_BUILD_PROMPT]: { icon: Workflow },
    [LogModule.WF_LLM_REQUEST]: { icon: CloudCog },
    [LogModule.WF_PARSE_JSON]: { icon: FileCode },
    [LogModule.WF_CLEAN_REGEX]: { icon: Filter },
    [LogModule.WF_REGEX_PROCESSOR]: { icon: Filter },
    [LogModule.WF_KEYWORD_RETRIEVE]: { icon: Tag },
    [LogModule.WF_USER_REVIEW]: { icon: MessageSquare },
    [LogModule.WF_APPLY_TRIM]: { icon: Workflow },
    [LogModule.WF_EXTRACT_TAGS]: { icon: Tag },
    [LogModule.WF_FORMAT_TRIM_INPUT]: { icon: Workflow },
    [LogModule.WF_SAVE_ENTITY]: { icon: Save },
    [LogModule.WF_SAVE_EVENT]: { icon: Save },

    // ===== UI =====
    [LogModule.DASHBOARD]: { icon: PanelTop },
    [LogModule.DEV_LOG]: { icon: FileText },
    [LogModule.NOTIFICATION]: { icon: MessageSquare },
    [LogModule.QUICK_PANEL]: { icon: PanelTop },

    // ===== 数据层 =====
    [LogModule.DATA_SYNC]: { icon: Database },
    [LogModule.DATA_CLEANUP]: { icon: Trash2 },
    [LogModule.DATA_DB]: { icon: Database },
    [LogModule.DATABASE]: { icon: Database },
    [LogModule.CHAT_MANAGER]: { icon: MessageSquare },
};

/**
 * 按模块名查询元数据。
 */
export function getModuleMeta(module: LogModule): ModuleMeta {
    return MODULE_META[module];
}
