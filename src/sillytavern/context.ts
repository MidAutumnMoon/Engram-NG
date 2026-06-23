/**
 * TavernContext - SillyTavern 上下文获取模块
 *
 * 统一的上下文获取入口，消除各模块重复定义。
 * 负责从 window.SillyTavern 对象中安全地提取状态。
 */

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
 * 获取 SillyTavern 上下文。
 *
 * SillyTavern 在任何扩展脚本执行前已就绪（见 global.d.ts 的 Window 声明），
 * 故此函数不返回 null——调用方无需判空。扩展不在 ST 环境内运行时，
 * 整个 bundle 本就不会加载。
 */
export function getSTContext(): TavernContext {
    return window.SillyTavern.getContext();
}

/**
 * 获取当前聊天 ID
 */
export function getCurrentChatId(): string | null {
    return getSTContext().chatId || null;
}

/**
 * 获取当前角色信息
 */
export function getCurrentCharacter(): { name: string; id: string } {
    const ctx = getSTContext();
    return {
        id: ctx.characterId,
        name: ctx.name2,
    };
}

/** 取消订阅函数 */
export type Unsubscribe = () => void;

/**
 * 订阅 SillyTavern 事件。
 * 直接转发给 ST 的 eventSource；返回取消订阅函数。
 */
export function onTavernEvent(
    event: string,
    cb: (...args: unknown[]) => void,
): Unsubscribe {
    const src = getSTContext().eventSource;
    src.on(event, cb);
    return () => src.removeListener(event, cb);
}

/**
 * 获取请求头 (包含 CSRF Token)
 */
export function getRequestHeaders(): Record<string, string> {
    return getSTContext().getRequestHeaders();
}
