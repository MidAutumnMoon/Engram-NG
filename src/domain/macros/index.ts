import { getSetting } from "@/config/settings.ts";
import type { CustomMacro } from "@/config/types/prompt.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getCurrentCharacterData, getSTContext } from "@/sillytavern/index.ts";
import { WorldInfoService } from "@/domain/worldbook/index.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { ChatHistoryHelper } from "@/sillytavern/chat/chatHistory.ts";
import { regexProcessor } from "@/domain/regex/index.ts";
import { processEjs } from "@/sillytavern/prompt/ejsProcessor.ts";

/**
 * 宏模块
 * 注册 Engram 宏到酒馆并缓存其值，供提示词模板使用
 */
let isInitialized = false;

// --- 缓存 ---
let cachedSummaries = "";
let cachedWorldbookContext = "";
let cachedCharDescription = "";
let cachedArchivedSummaries = "";
let cachedUserPersona = "";
const cachedCustomMacros = new Map<string, string>();
let cachedEntityStates = "";
let cachedAgenticIndex = "";
let cachedPureActiveEvents = "";

// --- 内置宏规格表 ---
// 单一来源：注册和启动日志都读这张表，避免注册名与日志名重复维护
const BUILTIN_MACROS: ReadonlyArray<{
    name: string;
    get: () => string;
}> = [
    { name: "engramSummaries", get: () => cachedSummaries },
    { name: "worldbookContext", get: () => cachedWorldbookContext },
    { name: "chatHistory", get: () => getChatHistory() },
    { name: "context", get: () => cachedCharDescription },
    { name: "engramArchivedSummaries", get: () => cachedArchivedSummaries },
    {
        name: "userPersona",
        get: () => {
            // 实时优先：人设切换频繁，优先读取酒馆原生变量
            const liveDescription = getSTContext().powerUserSettings
                ?.persona_description;
            return typeof liveDescription === "string"
                ? liveDescription
                : cachedUserPersona;
        },
    },
    { name: "engramEntityStates", get: () => cachedEntityStates },
    { name: "engramIndex", get: () => cachedAgenticIndex },
    { name: "engramActiveEvents", get: () => cachedPureActiveEvents },
];

/**
 * 初始化并注册所有 Engram 宏
 */
export async function initMacros(): Promise<void> {
    if (isInitialized) return;

    try {
        const context = getSTContext();

        // --- 注册内置宏 ---
        for (const { name, get } of BUILTIN_MACROS) {
            registerMacro(name, get);
        }

        isInitialized = true;
        Logger.success(LogModule.MACROS, "全局宏已注册", {
            macros: BUILTIN_MACROS.map((m) => `{{${m.name}}}`),
        });

        // 初始化缓存
        await refreshCache();

        // 监听聊天切换事件，刷新缓存
        const { eventSource } = context;
        if (eventSource) {
            eventSource.on("chat_id_changed", () => {
                Logger.info(LogModule.MACROS, "聊天切换，清理旧缓存");
                clearCache();
                refreshCache().catch((error) =>
                    Logger.warn(LogModule.MACROS, "刷新缓存失败", error)
                );
            });

            // V1.0.1: 监听设置更新（通常包含人设描述变更）
            eventSource.on("settings_updated", () => {
                refreshCache().catch((error) =>
                    Logger.warn(
                        LogModule.MACROS,
                        "设置更新后刷新缓存失败",
                        error,
                    )
                );
            });
        }
    } catch (error) {
        Logger.error(LogModule.MACROS, "初始化失败", error);
    }
}

/**
 * 清理所有缓存 (防止跨角色/对话泄露)
 */
export function clearCache(): void {
    cachedSummaries = "";
    cachedWorldbookContext = "";
    cachedCharDescription = "";
    cachedArchivedSummaries = "";
    cachedUserPersona = "";
    cachedCustomMacros.clear();
    cachedEntityStates = "";
    cachedAgenticIndex = "";
    cachedPureActiveEvents = "";
}

/**
 * 获取缓存的事件摘要
 */
export function getSummaries(): string {
    return cachedSummaries;
}

/**
 * 获取缓存的实体状态
 */
export function getEntityStates(): string {
    return cachedEntityStates;
}

/**
 * 刷新所有缓存 (包括耗时的世界书扫描)
 * @param recalledIds 可选，RAG 召回的事件 ID 列表
 * @param target_index 可选，实体状态 as-of 解析的消息索引（用于 flashback 查询）。
 *   缺省 = 最新（latest）。Injector 在召回命中过去事件时传入该事件的 end_index，
 *   使 {{engramEntityStates}} 渲染为「那个叙事时刻」的状态快照。
 */
export async function refreshCache(
    recalledIds?: string[],
    target_index?: number,
): Promise<void> {
    await Promise.all([
        refreshEngramCache(recalledIds, target_index),
        refreshWorldbookCache(),
    ]);

    // 刷新用户设定 (轻量)
    refreshUserPersona();
    // 刷新自定义宏 (轻量)
    refreshCustomMacros();
}

/**
 * 仅刷新 Engram 相关的 DB 缓存 (快速)
 * 用于 Pipeline 结束后的快速更新，避免触发全量世界书扫描
 */
export async function refreshEngramCache(
    recalledIds?: string[],
    target_index?: number,
): Promise<void> {
    try {
        const store = useMemoryStore.getState();

        // 1. 刷新事件摘要（带召回 ID）
        cachedSummaries = await store.getEventSummaries(recalledIds);

        // 2. 刷新归档摘要
        await refreshArchivedSummaries();

        // 3. V1.0.0: 刷新实体状态（target_index 透传给 as-of 解析）
        cachedEntityStates = await store.getEntityStates(
            undefined,
            target_index,
        );

        // 4. Agentic RAG: 刷新目录索引和纯蓝灯事件
        cachedAgenticIndex = await store.getAgenticIndex();
        cachedPureActiveEvents = await store.getPureActiveEvents();

        Logger.debug(LogModule.MACROS, "Engram DB 缓存已刷新", {
            recalledCount: recalledIds?.length ?? 0,
            summariesLength: cachedSummaries.length,
        });
    } catch (error) {
        Logger.warn(LogModule.MACROS, "刷新 Engram DB 缓存失败", error);
    }
}

/**
 * 仅刷新世界书上下文 (耗时操作)
 * 涉及全量历史扫描，仅在初始化或明确需要时调用
 */
export async function refreshWorldbookCache(): Promise<void> {
    try {
        // 刷新世界书上下文 (支持 EJS)
        const rawContext = await WorldInfoService.getActivatedWorldInfo();
        const sanitized = await processEjs([rawContext]);
        cachedWorldbookContext = sanitized[0] || "";

        // 刷新角色描述
        refreshCharDescription();

        Logger.debug(LogModule.MACROS, "世界书上下文已刷新", {
            worldbookLength: cachedWorldbookContext.length,
        });
    } catch (error) {
        Logger.debug(LogModule.MACROS, "获取世界书内容失败", error);
        cachedWorldbookContext = "";
    }
}

/**
 * 获取对话历史的代理
 */
export function getChatHistory(floorRange?: [number, number]): string {
    return ChatHistoryHelper.getChatHistory(
        floorRange,
        (t) => regexProcessor.process(t, "both"),
    );
}

/**
 * 获取当前对话消息总数
 */
export function getCurrentMessageCount(): number {
    return ChatHistoryHelper.getCurrentMessageCount();
}

/**
 * 刷新角色描述缓存
 */
function refreshCharDescription(): void {
    try {
        cachedCharDescription = getCurrentCharacterData()?.description ?? "";
    } catch (error) {
        Logger.debug(LogModule.MACROS, "刷新角色描述失败", error);
    }
}

/**
 * V0.9.2: 刷新归档摘要缓存
 * 仅返回 is_archived=true 的事件摘要
 */
async function refreshArchivedSummaries(): Promise<void> {
    try {
        const store = useMemoryStore.getState();
        cachedArchivedSummaries = await store.getArchivedEventSummaries();
        Logger.debug(LogModule.MACROS, "归档摘要缓存已刷新", {
            length: cachedArchivedSummaries.length,
        });
    } catch (error) {
        Logger.warn(LogModule.MACROS, "刷新归档摘要失败", error);
        cachedArchivedSummaries = "";
    }
}

function refreshUserPersona(): void {
    try {
        const powerUser = getSTContext().powerUserSettings;
        cachedUserPersona = powerUser?.persona_description || "";
        Logger.debug(LogModule.MACROS, "用户设定缓存已刷新", {
            length: cachedUserPersona.length,
        });
    } catch (error) {
        Logger.debug(LogModule.MACROS, "刷新用户设定失败", error);
        cachedUserPersona = "";
    }
}

/**
 * V0.9.2: 刷新并注册自定义宏
 * 从 apiSettings.customMacros 读取用户定义的宏
 */
function refreshCustomMacros(): void {
    try {
        const context = getSTContext();
        if (!context.registerMacro) {
            Logger.debug(
                LogModule.MACROS,
                "酒馆 registerMacro 不可用，跳过自定义宏注册",
            );
            return;
        }

        // 从 apiSettings 读取自定义宏
        const apiSettings = getSetting("apiSettings");
        const customMacros: CustomMacro[] = apiSettings?.customMacros || [];

        // 清空之前的缓存
        cachedCustomMacros.clear();

        // 注册每个启用的自定义宏
        for (const macro of customMacros) {
            if (!macro.enabled || !macro.name) continue;

            // 缓存内容
            cachedCustomMacros.set(macro.name, macro.content);

            // 动态注册到酒馆（使用闭包捕获宏名）
            const macroName = macro.name;
            registerMacro(
                macroName,
                () => cachedCustomMacros.get(macroName) ?? "",
            );
        }

        Logger.debug(LogModule.MACROS, "自定义宏已刷新", {
            count: cachedCustomMacros.size,
            names: [...cachedCustomMacros.keys()],
        });
    } catch (error) {
        Logger.warn(LogModule.MACROS, "刷新自定义宏失败", error);
    }
}

/**
 * V1.2.8: 统一宏注册接口，兼容新旧 API
 * @param name 宏名称
 * @param handler 宏处理函数
 */
function registerMacro(
    name: string,
    handler: () => string,
): void {
    const context = getSTContext();

    // 兼容性修复: 强制使用旧版 registerMacro API
    // 新版 context.macros.register API 在某些 ST 版本中可能存在参数兼容问题导致 filter undefined 错误
    // TODO: eventually move to context.macros.register new API
    if (context.registerMacro) {
        context.registerMacro(name, handler);
    } else {
        Logger.warn(
            LogModule.MACROS,
            `无法注册宏 ${name}: 没有可用的 registerMacro API`,
        );
    }
}
