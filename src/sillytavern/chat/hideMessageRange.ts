import { Logger } from "@/logger/Logger.ts";

const MODULE = "TavernChat";

export async function hideMessageRange(
    start: number,
    end: number,
): Promise<void> {
    try {
        const result = await SillyTavern.executeSlashCommandsWithOptions(
            `/hide ${start}-${end}`,
        );

        if (result.isAborted || result.isError) {
            Logger.warn(MODULE, "Hide command did not execute", {
                abortReason: result.abortReason,
                errorMessage: result.errorMessage,
                isAborted: result.isAborted,
                isError: result.isError,
            });
            return;
        }

        Logger.debug(MODULE, `Slash command executed: /hide ${start}-${end}`);

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
