import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext } from "@/sillytavern/context.ts";
import { type SummaryAnchor, useMemoryStore } from "@/state/memoryStore.ts";
import {
    getChatHistory as getChatHistoryHelper,
    getCurrentMessageCount as getCurrentMessageCountHelper,
} from "@/sillytavern/chat/chatHistory.ts";
import { regexProcessor } from "@/domain/regex/RegexProcessor.ts";
import { chatManager } from "@/data/ChatManager.ts";
import { getProcessedFloor } from "@/data/types/graph.ts";
import { formatRecalledSection } from "@/domain/memory/entityFormat.ts";

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
 * Additive recall 的「召回锚点」——flashback 路径的显式信号。
 *
 * - `target_index`：召回事件 end_index，实体状态按此 as-of 解析。
 * - `anchor`：召回事件的剧情锚点（Injector 从 topNode.structured_kv 直接构造），
 *   用于渲染 flashback 标签。
 *
 * 显式结构而非「target_index 是否非空」推断——避免 saveEntities 的 range?.[1]
 * 误判为 flashback。
 */
export interface FlashbackAnchor {
    target_index: number;
    anchor: SummaryAnchor;
}

/**
 * refreshEngramCache 的选项——单一 options 对象，消除位置参数歧义。
 *
 * - `recalledIds`：RAG 召回的**事件** ID（供 recalled 段渲染事件）。
 * - `recalledEntityIds`：RAG 召回的**实体** ID（供 recalled 段渲染实体状态）。
 *   注意与 recalledIds 区分——二者是不同 ID 空间，曾混用导致死数据 bug。
 * - `frontierOverride`：显式覆盖前沿（saveEntities 用——cursor 未推进时
 *   resolveFrontier 会读到旧值，漏掉刚写入的区间）。
 * - `flashbackAnchor`：flashback 信号（Injector 在召回命中过去事件时传入）。
 *   存在 → 触发 additive recall：当前状态块照常渲染，另加一个 recalled 段。
 */
export interface RefreshEngramCacheOptions {
    recalledIds?: string[];
    recalledEntityIds?: string[];
    frontierOverride?: number;
    flashbackAnchor?: FlashbackAnchor;
}

/**
 * 刷新 Engram DB 缓存 (事件摘要 + 实体状态)。
 *
 * Additive recall 语义：
 * - 当前状态块始终 as-of 前沿（或 frontierOverride），带前沿标签，**不被召回替换**。
 * - 仅当 flashbackAnchor 存在时，额外渲染一个 `<recalled_context>` 段：
 *   召回实体的 as-of 状态 + 召回事件，带 flashback 标签。
 * - 召回事件不再回灌进 `<summary>` timeline（timeline 只剩未归档 + level≥1）。
 *
 * Dedup（避免与 timeline/当前块重复）：
 * - 事件：recalledIds 先扣除已在 timeline 的 ID（getTimelineEventIds），再取回渲染。
 * - 实体：getEntityStates 的 case-A 只渲染「归档且被召回」的实体——非归档实体已在
 *   当前块渲染过。dedup 规则在 entitySlice 内，此处只负责传 entity IDs。
 */
export async function refreshEngramCache(
    opts: RefreshEngramCacheOptions = {},
): Promise<void> {
    const {
        recalledIds,
        recalledEntityIds,
        frontierOverride,
        flashbackAnchor,
    } = opts;
    try {
        const store = useMemoryStore.getState();

        // 1. Timeline 摘要——召回事件不再回灌（它们只出现在 recalled 段）
        cachedSummaries = await store.getEventSummaries();

        // 2. 当前状态块——as-of 前沿（或显式 override），带前沿标签
        const frontierAnchor = await store.getSummaryAnchor();
        const frontierLabel = buildAsOfLabel(frontierAnchor, false);
        const frontier = frontierOverride ?? flashbackAnchor?.target_index ??
            await resolveFrontier();
        cachedEntityStates = await store.getEntityStates(
            undefined,
            frontier,
            frontierLabel,
        );

        // 3. Additive recalled 段——仅 flashback 时渲染。
        // 实体用 recalledEntityIds（实体 ID 空间），事件用 recalledIds（事件 ID 空间）。
        // 事件先 dedup：扣除已在 timeline 的 ID，避免重复渲染。
        if (flashbackAnchor) {
            const recalledLabel = buildAsOfLabel(
                flashbackAnchor.anchor,
                true,
            );
            const recalledStates = recalledEntityIds &&
                    recalledEntityIds.length > 0
                ? await store.getEntityStates(
                    recalledEntityIds,
                    flashbackAnchor.target_index,
                    recalledLabel,
                )
                : "";
            let recalledEvents: Awaited<
                ReturnType<typeof store.getRecalledEvents>
            > = [];
            if (recalledIds && recalledIds.length > 0) {
                // Dedup against timeline: 已在 <summary> 渲染的事件不进 recalled 段。
                const timelineIds = await store.getTimelineEventIds();
                const dedupedIds = recalledIds.filter((id) =>
                    !timelineIds.has(id)
                );
                if (dedupedIds.length > 0) {
                    recalledEvents = await store.getRecalledEvents(
                        dedupedIds,
                    );
                }
            }
            const section = formatRecalledSection(
                recalledStates,
                recalledEvents,
            );
            if (section) {
                cachedEntityStates = cachedEntityStates
                    ? `${cachedEntityStates}\n\n${section}`
                    : section;
            }
        }

        Logger.debug(LogModule.MACROS, "Engram DB 缓存已刷新", {
            recalledEventCount: recalledIds?.length ?? 0,
            recalledEntityCount: recalledEntityIds?.length ?? 0,
            summariesLength: cachedSummaries.length,
            frontier,
            isFlashback: flashbackAnchor != null,
            hasFrontierLabel: frontierLabel.length > 0,
        });
    } catch (error) {
        Logger.warn(LogModule.MACROS, "刷新 Engram DB 缓存失败", error);
    }
}

/**
 * 获取对话历史的代理
 */
export function getChatHistory(floorRange: [number, number]): string {
    return getChatHistoryHelper(
        floorRange,
        (t) => regexProcessor.process(t, "both"),
    );
}

/**
 * 获取当前对话消息总数
 */
export function getCurrentMessageCount(): number {
    return getCurrentMessageCountHelper();
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
