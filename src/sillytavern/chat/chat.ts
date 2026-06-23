import { Logger } from "@/logger/Logger.ts";

const MODULE = "TavernChat";

/**
 * 隐藏指定范围的消息
 * @param start 起始楼层
 * @param end 结束楼层
 */
export async function hideMessageRange(
    start: number,
    end: number,
): Promise<void> {
    try {
        const command = `/hide ${start}-${end}`;

        // 优先使用官方扩展支持的斜杠指令触发器（高兼容性）
        if (typeof window.TavernHelper?.triggerSlash === "function") {
            window.TavernHelper.triggerSlash(command);
            Logger.debug(MODULE, `Slash command execution: ${command}`);
        } else {
            // 降级：如果不可用，尝试兼容之前的做法
            Logger.warn(
                MODULE,
                "TavernHelper.triggerSlash is unavailable. Executing fallback hiding.",
            );
            const importPath = "/scripts/chats.js";
            const chatsModule = await import(/* @vite-ignore */ importPath);
            if (
                chatsModule &&
                typeof chatsModule.hideChatMessageRange === "function"
            ) {
                await chatsModule.hideChatMessageRange(start, end, false);
            }
        }

        // 统一在执行隐藏后尝试强制保存聊天状态，避免刷新后隐藏失效（SillyTavern 的常见坑）
        setTimeout(async () => {
            try {
                await SillyTavern.saveChat();
                Logger.debug(
                    MODULE,
                    `Chat explicitly saved after hiding range: ${start}-${end}`,
                );
            } catch (error) {
                Logger.warn(
                    MODULE,
                    "Failed to explicitly save chat after hiding.",
                    error,
                );
            }
        }, 800);
    } catch (error) {
        Logger.error(MODULE, "Failed to hide messages:", error);
    }
}
