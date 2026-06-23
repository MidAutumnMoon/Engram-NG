export * from "./adapter.ts";
export * from "./crud.ts";
export * from "./engram.ts";
export * from "./metrics.ts";
export * from "./scanner.ts";
export * from "./slot.ts";
export * from "./types.ts";

// Facade Implementation moved here
import { getSTContext } from "@/sillytavern/context.ts";
import { getTavernHelper } from "./adapter.ts";
import {
    createEntry,
    deleteEntries,
    deleteEntry,
    deleteWorldbook,
    findEntryByKey,
    getEntries,
    getWorldbookNames,
    updateEntry,
} from "./crud.ts";
import { WorldbookEngramService } from "./engram.ts";
import { WorldbookMetricsService } from "./metrics.ts";
import { WorldbookScannerService } from "./scanner.ts";
import type {
    CreateWorldInfoEntryParams,
    WorldInfoEntry,
    WorldInfoTokenStats,
} from "./types.ts";

/**
 * WorldInfoService (Facade)
 *
 * 聚合各个分散模块的功能，提供统一的静态方法访问接口
 * 保持与旧版 WorldInfoService 兼容
 */
export class WorldInfoService {
    // =========================================================================
    // Metrics 代理 (metrics.ts)
    // =========================================================================

    static countTokens(text: string): Promise<number> {
        return WorldbookMetricsService.countTokens(text);
    }

    static countTokensBatch(texts: string[]): Promise<number[]> {
        return WorldbookMetricsService.countTokensBatch(texts);
    }

    static getWorldbookTokenStats(
        worldbookName: string,
    ): Promise<WorldInfoTokenStats> {
        return WorldbookMetricsService.getWorldbookTokenStats(worldbookName);
    }

    static isNativeTokenCountAvailable(): Promise<boolean> {
        return WorldbookMetricsService.isNativeTokenCountAvailable();
    }

    // =========================================================================
    // CRUD 代理 (crud.ts)
    // =========================================================================

    static getEntries(worldbookName: string): Promise<WorldInfoEntry[]> {
        return getEntries(worldbookName);
    }

    static getWorldbookNames(): Promise<string[]> {
        return getWorldbookNames();
    }

    static deleteWorldbook(worldbookName: string): Promise<boolean> {
        return deleteWorldbook(worldbookName);
    }

    static createEntry(
        worldbookName: string,
        params: CreateWorldInfoEntryParams,
    ): Promise<boolean> {
        return createEntry(worldbookName, params);
    }

    static updateEntry(
        worldbookName: string,
        uid: number,
        updates: Partial<WorldInfoEntry>,
    ): Promise<boolean> {
        return updateEntry(worldbookName, uid, updates);
    }

    static deleteEntry(
        worldbookName: string,
        uid: number,
    ): Promise<boolean> {
        return deleteEntry(worldbookName, uid);
    }

    static deleteEntries(
        worldbookName: string,
        uids: number[],
    ): Promise<boolean> {
        return deleteEntries(worldbookName, uids);
    }

    static findEntryByKey(
        worldbookName: string,
        key: string,
    ): Promise<WorldInfoEntry | null> {
        return findEntryByKey(worldbookName, key);
    }

    // =========================================================================
    // Scanner 代理 (scanner.ts)
    // =========================================================================

    static getActivatedWorldInfo(
        chatMessages?: string[],
        options?: { floorRange?: [number, number] },
    ): Promise<string> {
        return WorldbookScannerService.getActivatedWorldInfo(
            chatMessages,
            options,
        );
    }

    static scanWorldbook(
        worldbookName: string,
        contextText: string,
        options?: { forceInclude?: boolean },
    ): Promise<string> {
        return WorldbookScannerService.scanWorldbook(
            worldbookName,
            contextText,
            options,
        );
    }

    static getScopes() {
        return WorldbookEngramService.getScopes();
    }

    /**
     * 聚合世界书结构（用于 UI 展示等）
     */
    static async getWorldbookStructure() {
        const helper = getTavernHelper();
        if (!helper) return {};

        const allWorldbooks = helper.getWorldbookNames?.() || [];
        let charWorldbooks: string[] = [];
        if (helper.getCharWorldbookNames) {
            // V1.4.6 Fix: 只有在已选择角色时才尝试获取角色世界书，防止酒馆在首页报错
            const stContext = getSTContext();
            const hasCharacter = stContext.characterId !== undefined &&
                stContext.characterId !== -1;

            if (hasCharacter) {
                const charBooks = helper.getCharWorldbookNames("current");
                if (charBooks) {
                    charWorldbooks = [
                        ...(charBooks.additional || []),
                        charBooks.primary,
                    ].filter(Boolean) as string[];
                }
            }
        }
        const targetBooks = [...new Set([...allWorldbooks, ...charWorldbooks])]
            .toSorted();

        const structure: Record<string, any[]> = {};

        for (const book of targetBooks) {
            try {
                const entries = await getEntries(book);
                structure[book] = entries.map((e) => ({
                    comment: e.comment || "",
                    constant: e.constant,
                    content: e.content?.substring(0, 50) + "...",
                    keys: e.keys,
                    name: e.name,
                    uid: e.uid,
                }));
            } catch {
                structure[book] = [];
            }
        }
        return structure;
    }

    // =========================================================================
    // Engram 业务逻辑代理 (engram.ts)
    // =========================================================================

    static findExistingWorldbook(): string | null {
        return WorldbookEngramService.findExistingWorldbook();
    }

    static getOrCreateWorldbook(): Promise<string | null> {
        return WorldbookEngramService.getOrCreateWorldbook();
    }

    static getChatWorldbook(): Promise<string | null> {
        return WorldbookEngramService.getOrCreateWorldbook();
    }
}
