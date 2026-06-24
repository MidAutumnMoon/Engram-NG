export type TavernContext = ReturnType<typeof window.SillyTavern.getContext>;

export type TavernChatMessage = TavernContext["chat"][number];

export function getSTContext(): TavernContext {
    return window.SillyTavern.getContext();
}

export function getCurrentChatId(): string | null {
    return getSTContext().chatId || null;
}

export function getCurrentCharacter(): { name: string; id: string } {
    const ctx = getSTContext();
    return {
        id: ctx.characterId,
        name: ctx.name2,
    };
}

export type Unsubscribe = () => void;

export function onTavernEvent(
    event: string,
    cb: (...args: unknown[]) => void,
): Unsubscribe {
    const src = getSTContext().eventSource;
    src.on(event, cb);
    return () => src.removeListener(event, cb);
}

export function getRequestHeaders(): Record<string, string> {
    return getSTContext().getRequestHeaders();
}

/**
 * TavernHelper (JS-Slash-Runner host global). Thin wrapper — the return type is
 * derived directly from the vendor Window declaration so it can't drift.
 */
export type TavernHelper = typeof window.TavernHelper;

export function getTavernHelper(): TavernHelper | null {
    try {
        return window.TavernHelper || null;
    } catch {
        return null;
    }
}
