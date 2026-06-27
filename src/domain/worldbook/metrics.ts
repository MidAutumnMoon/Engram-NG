import { Logger } from "@/logger/Logger.ts";
import { LogModule } from "@/logger/LogModule.ts";
import { getSTContext } from "@/sillytavern/context.ts";

/**
 * 计算文本的 Token 数量
 *
 * 通过 SillyTavern 宿主层获取 token 计数；失败时回退到字符估算 (≈4 字符/token)。
 */
export async function countTokens(text: string): Promise<number> {
    try {
        const ctx = getSTContext();
        if (typeof ctx.getTokenCountAsync === "function") {
            return await ctx.getTokenCountAsync(text);
        }
    } catch {
        // fall through to estimate
    }
    Logger.warn(LogModule.WORLDBOOK, "无法使用酒馆 Token 计数，使用估算");
    return Math.ceil(text.length / 4);
}
