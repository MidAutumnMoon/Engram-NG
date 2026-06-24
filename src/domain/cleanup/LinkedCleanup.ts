/**
 * LinkedCleanup — 联动清理
 *
 * 监听 SillyTavern 的角色删除 / 聊天删除事件，同步清理 Engram
 * 关联数据 (IndexedDB shards + Engram 世界书)。
 *
 * 分层：
 *   - 事件处理 (onCharacterDeleted / onChatDeleted) 负责读取设置、
 *     汇总结果并触发 UI 反馈 (notify)。
 *   - 纯工作函数 (findEngramWorldbooks / deleteWorldbooks /
 *     findRelatedDatabases) 不发通知、不读设置，可独立测试。
 */

import { getSettings } from "@/config/settings.ts";
import { deleteDatabase, hasDbForChat, listAllChatIds } from "@/data/db.ts";
import { WorldInfoService } from "@/domain/worldbook/index.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { callPopup, getSTContext } from "@/sillytavern/index.ts";
import { notify } from "@/sillytavern/notify.ts";

/** SillyTavern CHARACTER_DELETED 事件载荷 (仅取需要的字段)。 */
interface CharacterDeletedPayload {
    id?: string;
    character?: { name?: string; data?: { name?: string } };
}

let isInitialized = false;

/** Wire SillyTavern character/chat deletion events. Idempotent. */
export function initLinkedCleanup(): void {
    if (isInitialized) return;

    const context = getSTContext();
    context.eventSource.on(
        context.eventTypes.CHARACTER_DELETED,
        (data: CharacterDeletedPayload) => {
            void onCharacterDeleted(data).catch((e) =>
                Logger.error(
                    LogModule.DATA_CLEANUP,
                    "character cleanup failed",
                    e,
                )
            );
        },
    );
    context.eventSource.on(
        context.eventTypes.CHAT_DELETED,
        (chatId: string) => {
            void onChatDeleted(chatId).catch((e) =>
                Logger.error(
                    LogModule.DATA_CLEANUP,
                    "chat cleanup failed",
                    e,
                )
            );
        },
    );

    isInitialized = true;
    Logger.debug(LogModule.DATA_CLEANUP, "cleanup listeners registered");
}

// ===== Event handlers (boundary: settings + notify live here) =====

async function onCharacterDeleted(
    data: CharacterDeletedPayload,
): Promise<void> {
    const settings = getSettings().linkedDeletion;
    if (!settings?.enabled) return;

    const characterName = data.character?.name ?? data.character?.data?.name;
    if (!characterName) {
        Logger.warn(
            LogModule.DATA_CLEANUP,
            "deleted character payload missing name",
        );
        return;
    }

    Logger.debug(LogModule.DATA_CLEANUP, "character deleted", {
        characterName,
    });

    const matchedChatIds = settings.deleteIndexedDB
        ? await findRelatedDatabases(characterName)
        : [];
    const booksToDelete = settings.deleteWorldbook
        ? await findEngramWorldbooks(characterName)
        : [];

    if (matchedChatIds.length === 0 && booksToDelete.length === 0) return;

    if (
        settings.showConfirmation &&
        !(await confirmCharacterCleanup(
            characterName,
            booksToDelete,
            matchedChatIds,
        ))
    ) {
        Logger.info(LogModule.DATA_CLEANUP, "user cancelled cleanup");
        return;
    }

    if (booksToDelete.length > 0) {
        const { deleted, failed } = await deleteWorldbooks(booksToDelete);
        if (deleted > 0) {
            notify("success", `已清理 ${deleted} 个关联记忆库`, "Engram");
        }
        if (failed.length > 0) {
            notify(
                "warning",
                `部分记忆库删除失败: ${failed.join(", ")}`,
                "Engram",
            );
        }
    }

    if (matchedChatIds.length > 0) {
        let deleted = 0;
        for (const id of matchedChatIds) {
            try {
                await deleteDatabase(id);
                deleted++;
            } catch (e) {
                Logger.error(
                    LogModule.DATA_CLEANUP,
                    `failed to delete db: ${id}`,
                    e,
                );
            }
        }
        if (deleted > 0) {
            notify("success", `已清理 ${deleted} 个关联聊天数据`, "Engram");
        }
    }
}

async function onChatDeleted(chatId: string): Promise<void> {
    const settings = getSettings().linkedDeletion;
    if (!settings?.enabled) return;

    Logger.debug(LogModule.DATA_CLEANUP, "chat deleted", { chatId });

    // 1. IndexedDB shard 是按 chat 隔离的，启用联动删除就清理，不影响其他聊天。
    if (hasDbForChat(chatId)) {
        try {
            await deleteDatabase(chatId);
            Logger.info(LogModule.DATA_CLEANUP, `deleted db: ${chatId}`);
            notify("info", "已清理关联的 Engram 数据库", "Engram");
        } catch (e) {
            Logger.error(
                LogModule.DATA_CLEANUP,
                `failed to delete db: ${chatId}`,
                e,
            );
        }
    }

    // 2. 可选的世界书清理 (默认关闭 — 共享世界书场景下有误删风险)。
    if (!settings.deleteChatWorldbook) return;

    const characterName = extractCharacterNameFromChatId(chatId);
    if (!characterName) {
        Logger.debug(
            LogModule.DATA_CLEANUP,
            "could not parse character name from chatId",
        );
        return;
    }

    const books = await findEngramWorldbooks(characterName);
    if (books.length === 0) return;

    if (
        settings.showConfirmation &&
        !(await confirmChatCleanup(characterName, books))
    ) {
        Logger.info(
            LogModule.DATA_CLEANUP,
            "user cancelled chat worldbook cleanup",
        );
        return;
    }

    const { deleted, failed } = await deleteWorldbooks(books);
    if (deleted > 0) {
        notify("success", `已清理 ${deleted} 个关联记忆库`, "Engram");
    }
    if (failed.length > 0) {
        notify("warning", `部分记忆库删除失败: ${failed.join(", ")}`, "Engram");
    }
}

// ===== Pure workers (no settings reads, no notify) =====

/** 查找该角色名下 Engram 管理的世界书 (按命名约定)。 */
async function findEngramWorldbooks(characterName: string): Promise<string[]> {
    const candidates = [`[Engram] ${characterName}`, `Engram_${characterName}`];
    const allBooks = new Set(await WorldInfoService.getWorldbookNames());
    return candidates.filter((name) => allBooks.has(name));
}

/** 批量删除世界书，返回逐项结果。 */
async function deleteWorldbooks(
    names: string[],
): Promise<{ deleted: number; failed: string[] }> {
    let deleted = 0;
    const failed: string[] = [];
    for (const name of names) {
        try {
            if (await WorldInfoService.deleteWorldbook(name)) {
                deleted++;
            } else {
                failed.push(name);
            }
        } catch (e) {
            Logger.error(
                LogModule.DATA_CLEANUP,
                `failed to delete worldbook: ${name}`,
                e,
            );
            failed.push(name);
        }
    }
    return { deleted, failed };
}

/** 启发式扫描：按 chat-id 前缀匹配该角色的数据库分片。 */
async function findRelatedDatabases(
    characterName: string,
): Promise<string[]> {
    try {
        const allIds = await listAllChatIds();
        const escaped = characterName.replaceAll(
            /[.*+?^${}()|[\]\\]/g,
            String.raw`\$&`,
        );
        const prefix = new RegExp(`^${escaped}(\\s|-|_|$)`, "i");
        return allIds.filter((id) => prefix.test(id));
    } catch (e) {
        Logger.error(
            LogModule.DATA_CLEANUP,
            `scan related dbs failed for character '${characterName}'`,
            e,
        );
        return [];
    }
}

// ===== Confirmation popups =====

async function confirmCharacterCleanup(
    name: string,
    books: string[],
    chatIds: string[],
): Promise<boolean> {
    const html = `
        <div style="font-size: 0.9em;">
            <h3>🧹 Engram 联动深度清理</h3>
            <p>检测到角色 <b>${name}</b> 已被删除。</p>
            ${books.length > 0 ? renderBookList(books) : ""}
            ${chatIds.length > 0 ? renderDbList(chatIds) : ""}
            <p>确定要一并彻底清理这些数据吗？</p>
        </div>
    `;
    return Boolean(await callPopup(html, "confirm"));
}

async function confirmChatCleanup(
    name: string,
    books: string[],
): Promise<boolean> {
    const html = `
        <div style="font-size: 0.9em;">
            <h3>🧹 Engram 联动清理</h3>
            <p>检测到聊天 <b>${name}</b> 已被删除。</p>
            <p>发现以下关联的 Engram 记忆库：</p>
            ${renderBookList(books)}
            <p>是否一并删除？</p>
            <small style="opacity: 0.7;">这将永久删除这些记忆库及其包含的所有摘要。</small>
        </div>
    `;
    return Boolean(await callPopup(html, "confirm"));
}

function renderBookList(books: string[]): string {
    return `
        <p>发现以下关联的 <b>记忆库 (Worldbook)</b>：</p>
        <ul style="max-height: 80px; overflow-y: auto; background: var(--black50a); padding: 5px; border-radius: 4px; list-style: none; margin: 5px 0;">
            ${
        books.map((name) =>
            `<li style="padding: 2px 0; color: var(--yellow);">• ${name}</li>`
        ).join("")
    }
        </ul>
    `;
}

function renderDbList(chatIds: string[]): string {
    const visible = chatIds.slice(0, 5);
    const overflow = chatIds.length - visible.length;
    return `
        <p>发现 <b>${chatIds.length}</b> 个关联的 <b>聊天记录数据库</b>：</p>
        <ul style="max-height: 80px; overflow-y: auto; background: var(--black50a); padding: 5px; border-radius: 4px; list-style: none; margin: 5px 0;">
            ${
        visible.map((id) => `<li style="padding: 2px 0;">• ${id}</li>`).join("")
    }
            ${
        overflow > 0
            ? `<li style="opacity: 0.5;">... 以及其他 ${overflow} 个聊天</li>`
            : ""
    }
        </ul>
        <p style="color: var(--red); font-weight: bold;">⚠️ 这将同时物理删除云端同步文件 (如果存在)！</p>
    `;
}

/** 从 ST chat-id 反解角色名 (e.g. "CharName - 2024-1-1@12h30m")。 */
function extractCharacterNameFromChatId(chatId: string): string | null {
    if (!chatId) return null;
    const m = chatId.match(/^(.+?)[\s_-]+\d{4}/);
    return m ? m[1].trim() : null;
}
