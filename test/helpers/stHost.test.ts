/**
 * Smoke test for the stHost injector.
 *
 * Verifies the core design assumption: after injecting a fake
 * `window.SillyTavern`, the real `@/sillytavern` host layer
 * (getSTContext / getCurrentChatId / ...) reads from it — no module mocking
 * required. This guards both the helper itself and the invariant that the
 * host layer only depends on globals.
 */
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
    getCurrentChatId,
    getCurrentCharacter,
} from "@/sillytavern/context.ts";
import { installFakeHost, getFakeContext } from "./stHost.ts";

let cleanup: (() => void) | null = null;
afterEach(() => {
    cleanup?.();
    cleanup = null;
});

describe("installFakeHost", () => {
    it("exposes the injected chatId to the real host layer", () => {
        cleanup = installFakeHost({ chatId: "chat-42" });
        expect(getCurrentChatId()).toBe("chat-42");
    });

    it("returns a placeholder name when characterId defaults to -1", () => {
        cleanup = installFakeHost();
        const c = getCurrentCharacter();
        expect(c.id).toBe("-1");
        expect(c.name).toBe("Char");
    });

    it("passes overridden ctx fields through to getFakeContext", () => {
        cleanup = installFakeHost({ name1: "Alice" });
        expect(getFakeContext().name1).toBe("Alice");
    });

    it("throws when installed twice without cleanup", () => {
        cleanup = installFakeHost();
        expect(() => installFakeHost()).toThrow();
    });
});
