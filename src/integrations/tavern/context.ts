/**
 * TavernContext - SillyTavern 上下文获取模块
 *
 * 统一的上下文获取入口，消除各模块重复定义。
 * 负责从 window.SillyTavern 对象中安全地提取状态。
 */

import { Logger } from "@/core/logger/index.ts";

const MODULE = "TavernContext";

/**
 * SillyTavern getContext() 的返回类型。
 * 类型由 vendor/SillyTavern 的声明驱动，通过 global.d.ts 暴露。
 */
export type TavernContext = ReturnType<typeof window.SillyTavern.getContext>;

/**
 * SillyTavern 原始聊天消息类型（context.chat 数组元素）。
 */
export type TavernChatMessage = TavernContext["chat"][number];

/**
 * 获取 SillyTavern 上下文
 * @returns ST 上下文对象，或 null（如果不可用）
 */
export function getSTContext(): TavernContext | null {
    try {
        const ctx = globalThis.SillyTavern?.getContext?.();
        return ctx || null;
    } catch (error) {
        Logger.warn(MODULE, "无法获取 ST 上下文", error);
        return null;
    }
}

/**
 * 获取当前聊天记录
 */
export function getCurrentChat(): TavernChatMessage[] {
    const ctx = getSTContext();
    return ctx?.chat || [];
}

/**
 * 获取当前聊天 ID
 */
export function getCurrentChatId(): string | null {
    const ctx = getSTContext();
    return ctx?.chatId || null;
}

/**
 * 获取当前角色信息
 */
export function getCurrentCharacter(): { name: string; id: number } | null {
    const ctx = getSTContext();
    if (!ctx) return null;
    return {
        id: ctx.characterId,
        name: ctx.name2,
    };
}

/**
 * 获取当前模型名称 (尝试从全局变量获取)
 */
export function getCurrentModel(): string | undefined {
    try {
        return window.selected_model || undefined;
    } catch {
        return undefined;
    }
}

/**
 * 检查 ST 上下文是否可用
 */
export function isSTAvailable(): boolean {
    return getSTContext() !== null;
}

/**
 * 获取请求头 (包含 CSRF Token)
 */
export function getRequestHeaders(
    options?: { omitContentType?: boolean },
): Record<string, string> {
    const ctx = getSTContext();
    if (ctx?.getRequestHeaders) {
        return ctx.getRequestHeaders(options);
    }
    // Fallback: 如果拿不到 context，至少返回 Content-Type
    return { "Content-Type": "application/json" };
}
