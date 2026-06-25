/**
 * Fake SillyTavern host injector for tests.
 *
 * Deno's native test runner has no module-level mock (vitest's vi.mock is
 * hoisted), but every ST access in Engram goes through the `@/sillytavern`
 * host layer (`getSTContext()` etc.), which only reads `window.SillyTavern`
 * and other globals. So we substitute "inject a fake host object" for module
 * mocking — the cleaner pattern regardless of runner.
 *
 * Typical usage:
 *   import { installFakeHost } from "@/../test/helpers/stHost.ts";
 *   afterEach(() => restoreGlobalThis()) // or use the returned cleanup
 *
 *   installFakeHost({ chatId: "test-chat" });
 *
 * The `ctx` argument is a `Partial<TavernContext>`: override only the fields
 * the test cares about; everything else gets sane defaults from this file.
 * Production code still sees the strongly-typed `TavernContext`; we relax at
 * the boundary via `unknown` so tests don't have to fill the entire vendored
 * type.
 */
import type { TavernContext } from "@/sillytavern/context.ts";

/**
 * Optional projection of `TavernContext`. Tests override only what they need.
 */
export type FakeTavernContext = Partial<TavernContext>;

interface FakeHostGlobals {
    SillyTavern?: {
        getContext: () => unknown;
        lib?: unknown;
    };
    eventSource?: EventTarget;
    toastr?: unknown;
    TavernHelper?: unknown;
    Mvu?: unknown;
    EjsTemplate?: unknown;
}

/**
 * Snapshot of the installed fake host, used by `restoreGlobalThis`.
 */
let snapshot: { window: FakeHostGlobals; ownKeys: Set<string | number | symbol> } | null = null;

/**
 * Install a fake SillyTavern host onto `globalThis.window`.
 *
 * @param ctx fields to override on the value returned by `getContext()`
 * @returns a cleanup function; call it to uninstall the fake host
 */
export function installFakeHost(ctx: FakeTavernContext = {}): () => void {
    if (snapshot) {
        throw new Error(
            "installFakeHost called twice without cleanup — call the returned cleanup first",
        );
    }

    const baseContext: Record<string, unknown> = {
        chatId: "test-chat",
        chat: [],
        characters: [],
        characterId: "-1",
        name1: "User",
        name2: "Char",
        eventSource: new EventTarget(),
        getRequestHeaders: () => ({ "Content-Type": "application/json" }),
        extensionSettings: {},
        powerUserSettings: {},
        ...ctx,
    };

    const eventSource = (ctx.eventSource as EventTarget | undefined) ??
        (baseContext.eventSource as EventTarget);

    const prevWindow = globalThis.window as unknown as FakeHostGlobals | undefined;
    const ownKeys = new Set<string | number | symbol>();

    // Record keys that did not previously exist (under `test`, `window` usually
    // already exists; we keep it here).
    for (const key of Object.keys(prevWindow ?? {})) ownKeys.delete(key);

    const fakeWindow: FakeHostGlobals = {
        ...prevWindow,
        SillyTavern: {
            getContext: () => baseContext,
            lib: undefined,
        },
        eventSource,
        toastr: { info: () => {}, success: () => {}, warning: () => {}, error: () => {} },
        TavernHelper: undefined,
        Mvu: undefined,
        EjsTemplate: undefined,
    };

    // deno-lint-ignore no-explicit-any
    (globalThis as any).window = fakeWindow;

    snapshot = { window: prevWindow ?? {}, ownKeys };

    return () => {
        if (!snapshot) return;
        // deno-lint-ignore no-explicit-any
        (globalThis as any).window = prevWindow;
        snapshot = null;
    };
}

/**
 * Get an installed fake context (for asserting on read-path behavior).
 * Throws if nothing is installed, so we never silently read undefined.
 */
export function getFakeContext(): Record<string, unknown> {
    if (!snapshot) {
        throw new Error("getFakeContext called before installFakeHost");
    }
    // deno-lint-ignore no-explicit-any
    const w = globalThis.window as any;
    return w.SillyTavern.getContext() as Record<string, unknown>;
}
