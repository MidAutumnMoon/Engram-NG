import { getSettings } from "@/config/settings.ts";
import { getSTContext, getTavernHelper } from "@/sillytavern/context.ts";
import {
    checkWorldInfo,
    getSortedEntries,
    type StWorldInfoEntry,
} from "@/sillytavern/worldInfo.ts";
import { getEntries } from "./crud.ts";
import type { WorldInfoEntry } from "./types.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";

/**
 * 获取常驻激活的世界书条目（蓝灯）
 * fallback：当 ST 原生扫描接口不可用时使用
 */
async function getConstantWorldInfo(): Promise<string> {
    const entries = await getSortedEntries();
    if (!entries) return "";

    const constantEntries = entries.filter((e) =>
        e.constant === true && e.disable !== true && e.content
    );
    if (constantEntries.length === 0) return "";

    Logger.debug(
        LogModule.WORLDBOOK,
        `回退获取 ${constantEntries.length} 个常驻条目`,
    );
    return constantEntries.map((e) => e.content).join("\n\n");
}

/**
 * 加载过滤所需的所有状态配置
 * @private
 */
function loadFilteringState() {
    const helper = getTavernHelper();
    const globalWorldbooks = helper?.getGlobalWorldbookNames?.() || [];

    const settings = getSettings();
    const config = settings.apiSettings?.worldbookConfig;
    const disabledGlobalBooks = config?.disabledWorldbooks || [];

    // 条目级黑名单 (取代了老版本的角色独占状态存储)
    const disabledEntries: Record<string, number[]> = config?.disabledEntries ||
        {};

    return {
        config,
        disabledEntries,
        disabledGlobalBooks,
        globalWorldbooks,
    };
}

/**
 * 过滤器实际读取的条目字段子集。同时容纳 crud.ts 的 `WorldInfoEntry`（Engram 自建、
 * 含 `enabled`）与 ST 原生 `StWorldInfoEntry`（含 `disable`）——两者都带 `world`/`uid`。
 */
interface FilterableEntry {
    world?: string;
    uid?: number;
    extra?: { engram?: boolean } & Record<string, unknown>;
}

/**
 * 判断单个条目是否应该被包含
 * @private
 */
function shouldIncludeEntry(
    entry: FilterableEntry,
    disabledGlobalBooks: string[],
    disabledEntries: Record<string, number[]>,
): boolean {
    // (1) Engram 自身的注入占位条目：不拼入 worldbookContext，
    //     防止与内置提示词里的相同宏撞车。
    if (entry.extra?.engram === true) return false;

    const world = entry.world;
    if (!world) return true;

    // (2) 全局禁用列表：该书被整体禁用则排除其所有条目
    if (disabledGlobalBooks.includes(world)) return false;

    // (3) 条目级黑名单：uid 在禁用列表中则排除
    const bookDisabledList = disabledEntries[world];
    if (
        bookDisabledList && entry.uid != null &&
        bookDisabledList.includes(entry.uid)
    ) {
        return false;
    }

    return true;
}

/**
 * WorldbookScannerService - 负责世界书的扫描与过滤逻辑
 */
export class WorldbookScannerService {
    /**
     * V1.1.0: 扫描指定世界书（白名单模式）
     * @param worldbookName 世界书名称
     * @param contextText 扫描上下文
     * @param options 扫描选项 (V1.2.10: forceInclude 用于强制扫描绑定的世界书，忽略全局禁用)
     */
    static async scanWorldbook(
        worldbookName: string,
        contextText: string,
        options?: { forceInclude?: boolean },
    ): Promise<string> {
        const entries = await getEntries(worldbookName);
        if (entries.length === 0) return "";

        const filterState = loadFilteringState();
        let { disabledGlobalBooks, disabledEntries } = filterState;

        // 全局禁用检查：强制包含时临时豁免该书，但保留条目级黑名单效力
        const isDisabled = disabledGlobalBooks.includes(worldbookName);
        if (isDisabled && !options?.forceInclude) {
            Logger.debug(
                LogModule.WORLDBOOK,
                `世界书 [${worldbookName}] 全局已禁用`,
            );
            return "";
        }
        if (options?.forceInclude) {
            disabledGlobalBooks = disabledGlobalBooks.filter((name) =>
                name !== worldbookName
            );
        }

        const activeEntries: WorldInfoEntry[] = [];
        const lowerContext = contextText.toLowerCase();

        for (const entry of entries) {
            // 0. 黑名单/全局禁用过滤
            if (
                !shouldIncludeEntry(entry, disabledGlobalBooks, disabledEntries)
            ) {
                continue;
            }

            // 1. 必须启用
            if (!entry.enabled) continue;

            // 2. 常驻条目直接激活
            if (entry.constant) {
                activeEntries.push(entry);
                continue;
            }

            // 3. 关键词匹配 (ST 逻辑: OR — 命中任一 key 即激活)
            if (entry.keys && entry.keys.length > 0) {
                const matched = entry.keys.some((key) =>
                    key &&
                    lowerContext.includes(key.toLowerCase())
                );
                if (matched) activeEntries.push(entry);
            }
        }

        if (activeEntries.length > 0) {
            Logger.debug(
                LogModule.WORLDBOOK,
                `扫描白名单世界书 [${worldbookName}]`,
                {
                    matched: activeEntries.length,
                    matchedEntries: activeEntries.map((e) => e.name),
                    total: entries.length,
                },
            );
            // 按 order 排序
            activeEntries.sort((a, b) => a.order - b.order);
            return activeEntries.map((e) => e.content).join("\n\n");
        }

        Logger.debug(
            LogModule.WORLDBOOK,
            `扫描白名单世界书 [${worldbookName}] - 无匹配条目`,
            {
                total: entries.length,
                reason: "No keys matched or no constant entries",
            },
        );
        return "";
    }

    /**
     * 获取所有激活的世界书条目内容（用于总结）
     * 使用酒馆原生 checkWorldInfo 进行扫描，获取所有激活的条目
     */
    static async getActivatedWorldInfo(
        chatMessages?: string[],
        options?: { floorRange?: [number, number] },
    ): Promise<string> {
        try {
            const DEFAULT_SCAN_LIMIT = 4;
            const context = getSTContext();
            let messages = chatMessages;

            if (options?.floorRange) {
                const [startFloor, endFloor] = options.floorRange;
                if (context.chat && Array.isArray(context.chat)) {
                    const rangeChat = context.chat.slice(
                        startFloor - 1,
                        endFloor,
                    );
                    messages = rangeChat.map((m: { mes?: string }) =>
                        m.mes || ""
                    ).toReversed();
                    Logger.debug(LogModule.WORLDBOOK, "使用楼层范围扫描", {
                        floorRange: options.floorRange,
                        messageCount: messages.length,
                    });
                }
            } else if (!messages || messages.length === 0) {
                if (context?.chat && Array.isArray(context.chat)) {
                    const recentChat = context.chat.slice(-DEFAULT_SCAN_LIMIT);
                    messages = recentChat.map((m: { mes?: string }) =>
                        m.mes || ""
                    ).toReversed();
                    Logger.debug(
                        LogModule.WORLDBOOK,
                        "使用默认最近消息扫描",
                        {
                            messageCount: messages.length,
                            scanLimit: DEFAULT_SCAN_LIMIT,
                        },
                    );
                }
            }

            if (!messages || messages.length === 0) {
                Logger.warn(LogModule.WORLDBOOK, "无聊天消息，回退到常驻条目");
                return getConstantWorldInfo();
            }

            // 调用扫描逻辑
            const avgTokensPerMessage = 500;
            const maxContextScan = Math.max(
                10_000,
                messages.length * avgTokensPerMessage,
            );

            const result = await checkWorldInfo(
                messages,
                maxContextScan,
                true,
                { trigger: "normal" },
            );

            if (!result) {
                Logger.warn(
                    LogModule.WORLDBOOK,
                    "checkWorldInfo 不可用，回退到常驻条目",
                );
                return getConstantWorldInfo();
            }

            const entries = [...result.allActivatedEntries.values()];

            Logger.info(
                LogModule.WORLDBOOK,
                `扫描完成，共激活 ${entries.length} 个条目`,
            );

            const { disabledGlobalBooks, disabledEntries } =
                loadFilteringState();
            const filteredEntries = entries.filter((entry) =>
                shouldIncludeEntry(
                    entry,
                    disabledGlobalBooks,
                    disabledEntries,
                )
            );

            Logger.info(LogModule.WORLDBOOK, "筛选结果", {
                filteredOut: entries.length - filteredEntries.length,
                kept: filteredEntries.length,
                total: entries.length,
            });

            filteredEntries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

            return filteredEntries
                .map((e) => e.content)
                .filter(Boolean)
                .join("\n\n");
        } catch (error) {
            Logger.error(LogModule.WORLDBOOK, "获取激活世界书失败", error);
            return getConstantWorldInfo();
        }
    }
}
