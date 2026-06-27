import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext } from "@/sillytavern/context.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { ChatHistoryHelper } from "@/sillytavern/chat/chatHistory.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";

/**
 * 宏模块
 * 注册 Engram 宏到酒馆并缓存其值，供提示词模板使用
 */
let isInitialized = false;

// --- 缓存 ---
let cachedSummaries = "";
let cachedEntityStates = "";

// --- 内置宏规格表 ---
// 单一来源：注册和启动日志都读这张表，避免注册名与日志名重复维护
const BUILTIN_MACROS: ReadonlyArray<{
    name: string;
    get: () => string;
}> = [
    { name: "engramSummaries", get: () => cachedSummaries },
    { name: "engramEntityStates", get: () => cachedEntityStates },
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
        await refreshEngramCache();

        // 监听聊天切换事件，刷新缓存
        const { eventSource } = context;
        if (eventSource) {
            eventSource.on("chat_id_changed", () => {
                Logger.info(LogModule.MACROS, "聊天切换，清理旧缓存");
                clearCache();
                refreshEngramCache().catch((error) =>
                    Logger.warn(LogModule.MACROS, "刷新缓存失败", error)
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
    cachedEntityStates = "";
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
 * 刷新 Engram DB 缓存 (事件摘要 + 实体状态)。
 * @param recalledIds 可选，RAG 召回的事件 ID 列表
 * @param target_index 可选，实体状态 as-of 解析的消息索引（用于 flashback 查询）。
 *   缺省 = 最新（latest）。Injector 在召回命中过去事件时传入该事件的 end_index，
 *   使 {{engramEntityStates}} 渲染为「那个叙事时刻」的状态快照。
 */
export async function refreshEngramCache(
    recalledIds?: string[],
    target_index?: number,
): Promise<void> {
    try {
        const store = useMemoryStore.getState();

        // 1. 刷新事件摘要（带召回 ID）
        cachedSummaries = await store.getEventSummaries(recalledIds);

        // 2. 刷新实体状态（target_index 透传给 as-of 解析）
        cachedEntityStates = await store.getEntityStates(
            undefined,
            target_index,
        );

        Logger.debug(LogModule.MACROS, "Engram DB 缓存已刷新", {
            recalledCount: recalledIds?.length ?? 0,
            summariesLength: cachedSummaries.length,
        });
    } catch (error) {
        Logger.warn(LogModule.MACROS, "刷新 Engram DB 缓存失败", error);
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
