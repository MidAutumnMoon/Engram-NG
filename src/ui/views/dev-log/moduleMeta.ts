import {
    Cloud,
    CloudCog,
    Database,
    FileCode,
    FileText,
    Filter,
    Link as LinkIcon,
    type LucideIcon,
    MessageSquare,
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

    // ===== 集成层 =====
    [LogModule.STBRIDGE]: { icon: LinkIcon },
    [LogModule.TAVERN]: { icon: Server },
    [LogModule.TAVERN_CHAT]: { icon: MessageSquare },
    [LogModule.TAVERN_UI]: { icon: PanelTop },
    [LogModule.CHAT_HISTORY]: { icon: MessageSquare },
    [LogModule.EJS_PROCESSOR]: { icon: FileCode },
    [LogModule.MACROS]: { icon: FileCode },
    [LogModule.WORLDBOOK]: { icon: FileText },

    // ===== LLM =====
    [LogModule.LLM]: { icon: CloudCog },
    [LogModule.LLM_ADAPTER]: { icon: Cloud },
    [LogModule.MODEL_SERVICE]: { icon: Sparkles },

    // ===== 配置与设置 =====
    [LogModule.SETTINGS]: { icon: Settings },

    // ===== 记忆管理 =====
    [LogModule.MEMORY_ENTITY]: { icon: Search },
    [LogModule.MEMORY_TRIM]: { icon: Search },
    [LogModule.ENTITY_SCANNER]: { icon: Search },

    // ===== RAG =====
    [LogModule.RAG_EMBED]: { icon: Search },
    [LogModule.RAG_RETRIEVE]: { icon: Search },
    [LogModule.RAG_RERANK]: { icon: Filter },
    [LogModule.RAG_INJECT]: { icon: Send },

    // ===== Workflow Steps =====
    [LogModule.WF_FETCH_CONTEXT]: { icon: Workflow },
    [LogModule.WF_FETCH_EVENTS_TO_TRIM]: { icon: Workflow },
    [LogModule.WF_BUILD_PROMPT]: { icon: Workflow },
    [LogModule.WF_LLM_REQUEST]: { icon: CloudCog },
    [LogModule.WF_PARSE_JSON]: { icon: FileCode },
    [LogModule.WF_REGEX_PROCESSOR]: { icon: Filter },
    [LogModule.WF_KEYWORD_RETRIEVE]: { icon: Tag },
    [LogModule.WF_USER_REVIEW]: { icon: MessageSquare },
    [LogModule.WF_APPLY_TRIM]: { icon: Workflow },
    [LogModule.WF_FORMAT_TRIM_INPUT]: { icon: Workflow },
    [LogModule.WF_SAVE_ENTITY]: { icon: Save },
    [LogModule.WF_SAVE_EVENT]: { icon: Save },

    // ===== UI =====
    [LogModule.DASHBOARD]: { icon: PanelTop },
    [LogModule.NOTIFICATION]: { icon: MessageSquare },

    // ===== 数据层 =====
    [LogModule.DATA_CLEANUP]: { icon: Trash2 },
    [LogModule.DATABASE]: { icon: Database },
    [LogModule.CHAT_MANAGER]: { icon: MessageSquare },
};

/**
 * 按模块名查询元数据。
 */
export function getModuleMeta(module: LogModule): ModuleMeta {
    return MODULE_META[module];
}
