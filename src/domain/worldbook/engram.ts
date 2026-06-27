import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import {
    getCurrentCharacterData,
    getTavernHelper,
} from "@/sillytavern/context.ts";

/** Engram 使用的唯一全局世界书名称。 */
export const ENGRAM_GLOBAL_WORLDBOOK = "[Engram] Global";

/**
 * 获取当前角色绑定的世界书 (primary + additional)。
 *
 * V1.4.6 Fix: 只有在已选择角色时才尝试获取角色世界书，防止酒馆在首页报错。
 * 本函数是「当前角色世界书」的唯一来源，避免 getScopes / getWorldbookStructure 各写一份。
 */
export function getCurrentCharWorldbooks(): string[] {
    const helper = getTavernHelper();
    if (!helper?.getCharWorldbookNames) return [];

    const hasCharacter = getCurrentCharacterData() !== null;
    if (!hasCharacter) return [];

    const charBooks = helper.getCharWorldbookNames("current");
    if (!charBooks) return [];
    return [
        ...(charBooks.additional || []),
        charBooks.primary,
    ].filter(Boolean) as string[];
}

/**
 * WorldbookEngramService - Engram 特定的业务逻辑
 * (绑定、摘要获取、分隔符等)
 */
export class WorldbookEngramService {
    static findExistingWorldbook(): string | null {
        try {
            const helper = getTavernHelper();
            if (!helper?.getGlobalWorldbookNames) {
                return null;
            }

            const globalBooks = helper.getGlobalWorldbookNames();
            if (globalBooks.includes(ENGRAM_GLOBAL_WORLDBOOK)) {
                return ENGRAM_GLOBAL_WORLDBOOK;
            }
            return null;
        } catch {
            return null;
        }
    }

    static async getOrCreateWorldbook(): Promise<string | null> {
        try {
            const existing = this.findExistingWorldbook();
            if (existing) {
                return existing;
            }

            const helper = getTavernHelper();
            if (!helper) {
                Logger.warn(LogModule.WORLDBOOK, "TavernHelper 不可用");
                return null;
            }

            // 先检查是否已经存在该名字的实体世界书
            const allInstalled = helper.getWorldbookNames?.() || [];
            if (!allInstalled.includes(ENGRAM_GLOBAL_WORLDBOOK)) {
                Logger.debug(
                    LogModule.WORLDBOOK,
                    "创建新全局世界书",
                    ENGRAM_GLOBAL_WORLDBOOK,
                );
                if (helper.createWorldbook) {
                    await helper.createWorldbook(ENGRAM_GLOBAL_WORLDBOOK);
                } else {
                    return null;
                }
            }

            // 绑定到全局
            if (
                helper.getGlobalWorldbookNames && helper.rebindGlobalWorldbooks
            ) {
                const currentGlobal = helper.getGlobalWorldbookNames();
                if (!currentGlobal.includes(ENGRAM_GLOBAL_WORLDBOOK)) {
                    currentGlobal.push(ENGRAM_GLOBAL_WORLDBOOK);
                    await helper.rebindGlobalWorldbooks(currentGlobal);
                    Logger.info(LogModule.WORLDBOOK, "世界书已绑定到全局配置", {
                        worldbook: ENGRAM_GLOBAL_WORLDBOOK,
                    });
                }
            }

            return ENGRAM_GLOBAL_WORLDBOOK;
        } catch (error) {
            Logger.error(
                LogModule.WORLDBOOK,
                `获取/创建全局世界书 '${ENGRAM_GLOBAL_WORLDBOOK}' 失败`,
                error,
            );
            return null;
        }
    }

    /**
     * 获取世界书的作用域分类 (全局/角色/所有)
     */
    static getScopes(): {
        global: string[];
        chat: string[];
        installed: string[];
    } {
        const helper = getTavernHelper();
        const global = helper?.getGlobalWorldbookNames?.() || [];
        const installed = helper?.getWorldbookNames?.() || [];
        const chat = getCurrentCharWorldbooks();

        return { chat, global, installed };
    }
}
