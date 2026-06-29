import { getTavernHelper } from "@/sillytavern/context.ts";
import { getEntries } from "./crud.ts";
import { getCurrentCharWorldbooks, WorldbookEngramService } from "./engram.ts";
import { WorldbookScannerService } from "./scanner.ts";

/**
 * WorldInfoService — 聚合各个分散模块的功能，提供统一的静态方法访问接口。
 *
 * 仅保留有外部消费者的方法。CRUD 原语请直接从对应模块 (crud.ts) 导入
 */
export class WorldInfoService {
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
        const charWorldbooks = getCurrentCharWorldbooks();
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
}
