export type TavernContext = ReturnType<typeof window.SillyTavern.getContext>;

export type TavernChatMessage = TavernContext["chat"][number];
export type TavernCharacter = TavernContext["characters"][number];

export function getSTContext(): TavernContext {
    return window.SillyTavern.getContext();
}

export function getCurrentChatId(): string | null {
    return getSTContext().chatId || null;
}

/**
 * Get the currently selected character's data, or null if none is selected.
 *
 * `characterId` is a stringified integer; per SillyTavern's `this_chid`
 * convention, negative values (e.g. "-1") mean no character is selected.
 */
export function getCurrentCharacterData(): TavernCharacter | null {
    const ctx = getSTContext();
    const id = Number(ctx.characterId);
    if (!ctx.characters || id < 0) return null;
    return ctx.characters[id] ?? null;
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
 *
 * N.B. In manifest.json we declare the dependency on JS-Slash-Runner,
 * do drop the null check. However, whether this assertion holds depends on
 * SillyTavern always loads JS-Slash-Runner before our script, and
 * SillyTavern is infamous for having unexpected bugs...but most of the time
 * this assertion holds ok.
 */
export type TavernHelper = typeof window.TavernHelper;

export function getTavernHelper(): TavernHelper {
    return window.TavernHelper;
}
