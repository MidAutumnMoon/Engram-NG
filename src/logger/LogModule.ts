/**
 * LogModule - 日志模块枚举
 *
 * 统一模块命名，按业务域划分。格式: `域/功能` 或 `域`
 *
 * 这是日志模块名的**唯一真源**。`Logger.*` 签名为 `module: LogModule`，
 * 编译器会拒绝裸字符串。新增成员时，ui/views/dev-log/moduleMeta.ts 中的
 * MODULE_META 必须同步补全（TS 会通过 Record<LogModule, ...> 的完整性检查
 * 强制执行）。
 *
 * V2.3: 移除 19 个无日志调用的死成员 + 去重（INJECTOR→RAG_INJECT,
 * WF_CLEAN_REGEX→WF_REGEX_PROCESSOR, MEMORY_SUMMARY/SUMMARIZER 已无调用）。
 */

export enum LogModule {
    // ===== Core =====
    SYSTEM = "System",

    // ===== SillyTavern Bridge =====
    STBRIDGE = "STBridge",
    TAVERN = "Tavern",
    TAVERN_CHAT = "TavernChat",
    TAVERN_UI = "TavernUI",
    CHAT_HISTORY = "ChatHistory",
    EJS_PROCESSOR = "EjsProcessor",
    MACROS = "Macros",
    WORLDBOOK = "Worldbook",

    // ===== LLM =====
    LLM = "LLM",
    LLM_ADAPTER = "LLMAdapter",
    MODEL_SERVICE = "ModelService",

    // ===== Settings =====
    SETTINGS = "Settings",

    // ===== Memory Management =====
    MEMORY_ENTITY = "Memory/Entity",
    MEMORY_TRIM = "Memory/Trim",
    MEMORY_STORE = "Memory/Store",
    ENTITY_SCANNER = "EntityScanner",

    // ===== RAG =====
    RAG_EMBED = "RAG/Embed",
    RAG_RETRIEVE = "RAG/Retrieve",
    RAG_RERANK = "RAG/Rerank",
    RAG_INJECT = "RAG/Inject",

    // ===== Workflow Steps =====
    WF_FETCH_CONTEXT = "FetchContext",
    WF_FETCH_EVENTS_TO_TRIM = "FetchEventsToTrim",
    WF_BUILD_PROMPT = "BuildPrompt",
    WF_LLM_REQUEST = "LlmRequest",
    WF_PARSE_JSON = "ParseJson",
    WF_REGEX_PROCESSOR = "RegexProcessor",
    WF_KEYWORD_RETRIEVE = "KeywordRetrieveStep",
    WF_USER_REVIEW = "UserReview",
    WF_APPLY_TRIM = "ApplyTrim",
    WF_FORMAT_TRIM_INPUT = "FormatTrimInput",
    WF_SAVE_ENTITY = "SaveEntity",
    WF_SAVE_EVENT = "SaveEvent",

    // ===== UI =====
    DASHBOARD = "UI/Dashboard",
    MEMORY_STREAM = "UI/MemoryStream",
    NOTIFICATION = "Notification",

    // ===== Data Layer =====
    DATA_CLEANUP = "Data/Cleanup",
    DATABASE = "Database",
    CHAT_MANAGER = "ChatManager",
}

/**
 * 获取所有模块名（供 UI 过滤器使用）
 */
export const ALL_MODULES = Object.values(LogModule);
