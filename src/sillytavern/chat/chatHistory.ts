import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext, getTavernHelper } from "@/sillytavern/context.ts";

/**
 * Read a 1-based inclusive floor range from the ST chat as joined text.
 *
 * ST native regex (via TavernHelper / JS-Slash-Runner) is applied first, then
 * the optional `cleaner` (Engram's own RegexProcessor). Messages are joined
 * with a double newline.
 *
 * @param range `[start, end]` — 1-based inclusive; floor 1 = index 0.
 * @param cleaner Optional Engram-side regex pass over each message.
 */
export function getChatHistory(
    range: [number, number],
    cleaner?: (text: string) => string,
): string {
    try {
        const chat = getSTContext().chat;
        if (!chat || !Array.isArray(chat)) {
            Logger.warn(
                LogModule.CHAT_HISTORY,
                "Context chat is empty or invalid",
            );
            return "";
        }

        const [start, end] = range;
        const messages = chat.slice(Math.max(0, start - 1), end);
        if (messages.length === 0) return "";

        return messages.map((message) => {
            let content = message.mes;

            // Pass 1: native regex
            try {
                content = getTavernHelper()
                    .formatAsTavernRegexedString(
                        content,
                        "ai_output",
                        "prompt",
                    );
            } catch (error) {
                Logger.warn(
                    LogModule.CHAT_HISTORY,
                    `酒馆原生正则替换失败`,
                    { message, error },
                );
            }

            // Pass 2: Engram regex cleaning
            if (cleaner) content = cleaner(content);

            return content;
        }).join("\n\n");
    } catch (error) {
        Logger.warn(LogModule.CHAT_HISTORY, "获取对话历史失败", error);
        return "";
    }
}

/** Current chat message count (0 if the context is unavailable). */
export function getCurrentMessageCount(): number {
    try {
        const chat = getSTContext().chat;
        return chat && Array.isArray(chat) ? chat.length : 0;
    } catch {
        return 0;
    }
}
