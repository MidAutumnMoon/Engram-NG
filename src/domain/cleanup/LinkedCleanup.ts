/**
 * LinkedCleanup — 联动清理
 *
 * 监听 SillyTavern 的角色删除 / 聊天删除事件，同步清理 Engram
 * 关联的 IndexedDB 分片数据库。
 *
 * 注意：Engram 现在使用单一共享全局世界书 `[Engram] Global`，
 * 不再为每个角色/聊天创建独立世界书，因此本模块只负责清理数据库。
 *
 * 分层：
 *   - 事件处理 (onCharacterDeleted / onChatDeleted) 负责读取设置、
 *     汇总结果并触发 UI 反馈 (notify)。
 *   - 纯工作函数 (findRelatedDatabases) 不发通知、不读设置，可独立测试。
 */

import { getSettings } from "@/config/settings.ts";
import { deleteDatabase, hasDbForChat, listAllChatIds } from "@/data/db.ts";
import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { callPopup, getSTContext } from "@/sillytavern/index.ts";
import { notify } from "@/sillytavern/notify.ts";

type CharacterDeletedPayload = Parameters<
    ListenerType[typeof tavern_events.CHARACTER_DELETED]
>[0];

let alreadyInitialized = false;

/** Wire SillyTavern character/chat deletion events. Idempotent. */
export function initLinkedCleanup(): void {
    if (alreadyInitialized) return;

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

    alreadyInitialized = true;
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

    if (!settings.deleteIndexedDB) return;

    const matchedChatIds = await findRelatedDatabases(characterName);
    if (matchedChatIds.length === 0) return;

    if (
        settings.showConfirmation &&
        !(await confirmCharacterCleanup(characterName, matchedChatIds))
    ) {
        Logger.info(LogModule.DATA_CLEANUP, "user cancelled cleanup");
        return;
    }

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

async function onChatDeleted(chatId: string): Promise<void> {
    const settings = getSettings().linkedDeletion;
    if (!settings?.enabled) return;

    Logger.debug(LogModule.DATA_CLEANUP, "chat deleted", { chatId });

    // IndexedDB shard 是按 chat 隔离的，启用联动删除就清理，不影响其他聊天。
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
}

// ===== Pure workers (no settings reads, no notify) =====

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

// ===== Confirmation popup =====

async function confirmCharacterCleanup(
    name: string,
    chatIds: string[],
): Promise<boolean> {
    const html = `
        <div style="font-size: 0.9em;">
            <h3>🧹 Engram 联动深度清理</h3>
            <p>检测到角色 <b>${name}</b> 已被删除。</p>
            ${renderDbList(chatIds)}
            <p>确定要一并彻底清理这些数据吗？</p>
        </div>
    `;
    return Boolean(await callPopup(html, "confirm"));
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
