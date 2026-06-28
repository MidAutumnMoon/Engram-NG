import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getTavernHelper } from "@/sillytavern/context.ts";
import type {
    CreateWorldInfoEntryParams,
    WorldInfoEntry,
    WorldInfoPosition,
} from "./types.ts";

/**
 * 获取世界书的所有条目
 * @param worldbookName 世界书名称
 */
export async function getEntries(
    worldbookName: string,
): Promise<WorldInfoEntry[]> {
    const helper = getTavernHelper();
    if (!helper?.getWorldbook) {
        Logger.warn(LogModule.WORLDBOOK, "TavernHelper 不可用");
        return [];
    }

    try {
        const entries = await helper.getWorldbook(worldbookName);
        if (!Array.isArray(entries)) return [];
        // 转换 TavernHelper 的 WorldbookEntry 结构
        return (entries as unknown[]).map((e: unknown) => {
            const entry = e as Record<string, unknown>;
            const strategy = entry.strategy as
                | Record<string, unknown>
                | undefined;
            const position = entry.position as
                | Record<string, unknown>
                | undefined;
            const recursion = entry.recursion as
                | Record<string, boolean>
                | undefined;

            // 从 strategy.keys 提取关键词（可能是字符串或正则）
            const keys: string[] = [];
            if (strategy?.keys && Array.isArray(strategy.keys)) {
                for (const k of strategy.keys) {
                    if (typeof k === "string") {
                        keys.push(k);
                    } else if (k && typeof k === "object" && "source" in k) {
                        // RegExp 对象
                        keys.push((k as RegExp).source);
                    }
                }
            }

            return {
                uid: entry.uid as number ?? 0,
                name: entry.name as string ?? "",
                world: worldbookName, // Inject worldbook name for filtering context
                content: entry.content as string ?? "",
                enabled: typeof entry.enabled === "boolean"
                    ? entry.enabled
                    : (entry.disable !== true),
                constant: strategy?.type === "constant" ||
                    (entry.constant as boolean) === true,
                keys,
                position: (position?.type as WorldInfoPosition) ||
                    "before_character_definition",
                depth: position?.depth as number ?? 0,
                order: position?.order as number ?? 100,
                recursion: recursion
                    ? {
                        prevent_incoming: recursion.prevent_incoming,
                        prevent_outgoing: recursion.prevent_outgoing,
                    }
                    : undefined,
                comment: entry.comment as string ?? "",
                extra: entry.extra as Record<string, any> || undefined,
            };
        });
    } catch (error) {
        Logger.error(
            LogModule.WORLDBOOK,
            `获取世界书 '${worldbookName}' 的条目失败`,
            error,
        );
        return [];
    }
}

/**
 * 获取所有世界书名称
 */
export async function getWorldbookNames(): Promise<string[]> {
    const helper = getTavernHelper();
    try {
        if (helper?.getWorldbookNames) {
            return helper.getWorldbookNames();
        }
        return [];
    } catch (error) {
        Logger.error(LogModule.WORLDBOOK, "获取世界书列表失败", error);
        return [];
    }
}

/**
 * 创建新的世界书条目
 * @param worldbookName 世界书名称
 * @param params 条目参数
 */
export async function createEntry(
    worldbookName: string,
    params: CreateWorldInfoEntryParams,
): Promise<boolean> {
    try {
        const helper = getTavernHelper();
        if (!helper?.createWorldbookEntries) {
            Logger.error(
                LogModule.WORLDBOOK,
                "TavernHelper.createWorldbookEntries 不可用",
            );
            return false;
        }

        // 构建条目数据，格式与 the_world 插件一致
        const entryData = {
            name: params.name,
            content: params.content,
            comment: params.name, // 用作备注
            disable: !(params.enabled ?? true), // TavernHelper 使用 disable 字段
            strategy: {
                keys: params.keys || [],
                type: (params.constant ? "constant" : "selective") as
                    | "constant"
                    | "selective"
                    | "vectorized",
            },
            position: {
                depth: params.depth ?? 4,
                order: params.order ?? 100,
                type: params.position || "before_character_definition",
            },
            recursion: params.recursion,
            // 添加 Engram 身份标识
            extra: {
                engram: true,
            },
        };

        Logger.debug(LogModule.WORLDBOOK, "创建条目", {
            contentLength: params.content.length,
            name: params.name,
            worldbook: worldbookName,
        });

        await helper.createWorldbookEntries(worldbookName, [entryData]);

        Logger.info(LogModule.WORLDBOOK, "条目已保存到世界书", worldbookName);
        return true;
    } catch (error) {
        Logger.error(
            LogModule.WORLDBOOK,
            `在世界书 '${worldbookName}' 创建条目 '${params.name}' 失败`,
            error,
        );
        return false;
    }
}

/**
 * 根据 Key 或名称查找条目
 * @param worldbookName 世界书名称
 * @param key 关键词
 */
export async function findEntryByKey(
    worldbookName: string,
    key: string,
): Promise<WorldInfoEntry | null> {
    const entries = await getEntries(worldbookName);
    // 先按 keys 数组查找
    let found = entries.find((e) => e.keys.includes(key));
    // 如果没找到，尝试按名称查找（兼容旧逻辑）
    if (!found) {
        found = entries.find((e) =>
            e.name === key ||
            (key === "__ENGRAM_STATE__" && e.name === "Engram System State")
        );
    }
    return found || null;
}
