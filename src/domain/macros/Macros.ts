import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext } from "@/sillytavern/context.ts";
import { useMemoryStore } from "@/state/memoryStore.ts";
import { ChatHistoryHelper } from "@/sillytavern/chat/chatHistory.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";

/**
 * 读取提取游标（last_processed_floor）作为记忆前沿。
 *
 * 不变量：注入读路径的「current」必须等于提取写路径的「last_processed_floor」。
 * 二者是同一个点——提取 pass 把状态区间 stamp 在 range[1]，并把游标推进到 range[1]，
 * 所以注入时 as-of 该游标就是「最新已提取状态」。
 *
 * 历史上 refreshEngramCache 用 MAX_SAFE_INTEGER 当默认 target，靠 open interval
 * 恰好落在游标处来「蒙对」。这里改为显式读取游标，把不变量从隐式约定变成显式读取。
 */
async function resolveFrontier(): Promise<number> {
    const state = await chatManager.getState();
    return getProcessedFloor(state);
}

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
 * 构造实体状态块的 as-of 标签文本（narrative-time，模型可读词汇）。
 *
 * 用剧情锚点（time_anchor / event title）而非内部词汇（floor / episode id）——
 * 这些字段已烧录在 summary 行里，模型本来就在读它们。
 *
 * - flashback（target_index 非空）：标注「这是记忆召回的过去时刻的状态快照」
 * - 前沿（target_index 缺省）：标注「截至最近一次记忆摄取」，并提示之后的对话可能已推进
 * - 无锚点信息（anchor == null）：返回空串，不渲染标签
 */
function buildAsOfLabel(
    anchor: { time_anchor: string; event: string } | null,
    isFlashback: boolean,
): string {
    if (!anchor) return "";
    const moment = anchor.time_anchor || "未知时刻";
    if (isFlashback) {
        const title = anchor.event || "过去事件";
        return `# 以下为记忆召回「${title}」（剧情时刻：${moment}）时的状态快照。这是对过去时刻的回溯，而非当前局面。`;
    }
    return `# 角色/场景状态截至最近一次记忆摄取（剧情时刻：${moment}）。之后的故事可能已推进局面，以最新对话为准。`;
}

/**
 * 刷新 Engram DB 缓存 (事件摘要 + 实体状态)。
 * @param recalledIds 可选，RAG 召回的事件 ID 列表
 * @param target_index 可选，实体状态 as-of 解析的消息索引。
 *   缺省 = 提取前沿（last_processed_floor）——与提取 pass stamp 状态区间用的 range[1] 对齐。
 *   flashback 路径会传入召回事件的 end_index，使 {{engramEntityStates}} 渲染为
 *   「那个叙事时刻」的状态快照；其余场景一律 as-of 前沿。
 */
export async function refreshEngramCache(
    recalledIds?: string[],
    target_index?: number,
): Promise<void> {
    try {
        const store = useMemoryStore.getState();

        // 1. 刷新事件摘要（带召回 ID）
        cachedSummaries = await store.getEventSummaries(recalledIds);

        // 2. 解析 as-of 标签锚点（与 summary 共享剧情时钟）。
        // target_index 是否显式传入 = 是否 flashback 路径（Injector 的信号）。
        const isFlashback = target_index !== undefined;
        const anchor = await store.getSummaryAnchor(recalledIds);
        const asOfLabel = buildAsOfLabel(anchor, isFlashback);

        // 3. 刷新实体状态。
        // target_index 缺省时显式读取提取前沿，而不是依赖 getEntityStates 内部
        // 的 MAX_SAFE_INTEGER 兜底——把「current = last_processed_floor」
        // 这个不变量从隐式约定变成显式读取。
        const resolvedTarget = target_index ?? await resolveFrontier();
        cachedEntityStates = await store.getEntityStates(
            undefined,
            resolvedTarget,
            asOfLabel,
        );

        Logger.debug(LogModule.MACROS, "Engram DB 缓存已刷新", {
            recalledCount: recalledIds?.length ?? 0,
            summariesLength: cachedSummaries.length,
            targetIndex: resolvedTarget,
            isFlashback,
            hasAsOfLabel: asOfLabel.length > 0,
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
