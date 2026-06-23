/**
 * LogModule - 日志模块枚举
 *
 * V0.9.10: 统一模块命名，按业务域划分
 * 格式: `域/功能` 或 `域`
 *
 * 这是日志模块名的**唯一真源**。所有 Logger.* 调用都应使用本枚举成员，
 * 而非裸字符串。新增成员时，ui/views/dev-log/moduleMeta.ts 中的
 * MODULE_META 必须同步补全（TS 会通过 Record<LogModule, ...> 的完整性检查
 * 强制执行）。
 */

export enum LogModule {
    // ===== Core =====
    SYSTEM = "System",
    EVENTS = "System/Events",
    LOGGER = "Logger",

    // ===== SillyTavern Bridge =====
    STBRIDGE = "STBridge",
    TAVERN = "Tavern",
    TAVERN_CHAT = "TavernChat",
    TAVERN_UI = "TavernUI",
    TAVERN_CONTEXT = "TavernContext",
    TAVERN_EVENTS = "TavernEventBus",
    CHAT_HISTORY = "ChatHistoryHelper",
    EJS_PROCESSOR = "EjsProcessor",
    MACRO_SERVICE = "MacroService",
    WORLDBOOK = "Worldbook",

    // ===== LLM =====
    LLM = "LLM",
    LLM_ADAPTER = "LLMAdapter",
    MODEL_SERVICE = "ModelService",

    // ===== Settings & Theme =====
    SETTINGS = "SettingsManager",
    THEME = "ThemeManager",

    // ===== Memory Management =====
    MEMORY_SUMMARY = "Memory/Summary",
    MEMORY_ENTITY = "Memory/Entity",
    MEMORY_TRIM = "Memory/Trim",
    SUMMARIZER = "Summarizer",
    ENTITY_BUILDER = "EntityBuilder",
    ENTITY_SCANNER = "EntityScanner",

    // ===== RAG =====
    RAG_EMBED = "RAG/Embed",
    RAG_RETRIEVE = "RAG/Retrieve",
    RAG_RERANK = "RAG/Rerank",
    RAG_INJECT = "RAG/Inject",
    RAG_CACHE = "RAG/Cache",
    INJECTOR = "Injector",
    BRAIN_RECALL_CACHE = "BrainRecallCache",

    // ===== Preprocess =====
    PREPROCESS = "Preprocess",

    // ===== Batch Processing =====
    BATCH = "Batch",
    BATCH_ENGINE = "BatchEngine",

    // ===== Workflow Steps =====
    WF_FETCH_CONTEXT = "FetchContext",
    WF_FETCH_EVENTS_TO_TRIM = "FetchEventsToTrim",
    WF_BUILD_PROMPT = "BuildPrompt",
    WF_LLM_REQUEST = "LlmRequest",
    WF_PARSE_JSON = "ParseJson",
    WF_CLEAN_REGEX = "CleanRegex",
    WF_REGEX_PROCESSOR = "RegexProcessor",
    WF_KEYWORD_RETRIEVE = "KeywordRetrieveStep",
    WF_USER_REVIEW = "UserReview",
    WF_APPLY_TRIM = "ApplyTrim",
    WF_SAVE_ENTITY = "SaveEntity",
    WF_SAVE_EVENT = "SaveEvent",

    // ===== UI =====
    DASHBOARD = "UI/Dashboard",
    DEV_LOG = "DevLog",
    NOTIFICATION = "Notification",
    QUICK_PANEL = "QuickPanel",

    // ===== Data Layer =====
    DATA_SYNC = "Data/Sync",
    DATA_CLEANUP = "Data/Cleanup",
    DATA_DB = "Data/DB",
    DATABASE = "Database",
    CHAT_MANAGER = "ChatManager",
}

/**
 * 获取所有模块名（供 UI 过滤器使用）
 */
export const ALL_MODULES = Object.values(LogModule);
