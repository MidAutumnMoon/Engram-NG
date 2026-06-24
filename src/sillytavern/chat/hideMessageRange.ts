import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";

export async function hideMessageRange(
    start: number,
    end: number,
): Promise<void> {
    const { SillyTavern } = window;
    try {
        const result = await SillyTavern.executeSlashCommandsWithOptions(
            `/hide ${start}-${end}`,
        );

        if (result.isAborted || result.isError) {
            Logger.warn(LogModule.TAVERN_CHAT, "Hide command did not execute", {
                abortReason: result.abortReason,
                errorMessage: result.errorMessage,
                isAborted: result.isAborted,
                isError: result.isError,
            });
            return;
        }

        Logger.debug(
            LogModule.TAVERN_CHAT,
            `Slash command executed: /hide ${start}-${end}`,
        );

        // 统一在执行隐藏后尝试强制保存聊天状态，避免刷新后隐藏失效（SillyTavern 的常见坑）
        setTimeout(async () => {
            try {
                await SillyTavern.saveChat();
                Logger.debug(
                    LogModule.TAVERN_CHAT,
                    `Chat explicitly saved after hiding range: ${start}-${end}`,
                );
            } catch (error) {
                Logger.warn(
                    LogModule.TAVERN_CHAT,
                    "Failed to explicitly save chat after hiding.",
                    error,
                );
            }
        }, 800);
    } catch (error) {
        Logger.error(
            LogModule.TAVERN_CHAT,
            `Failed to hide messages ${start}-${end}`,
            error,
        );
    }
}
