/**
 * safeStringify unit tests
 *
 * Pure function, no ST dependency — covers the circular-reference and BigInt
 * tolerance paths. Also serves as the deno test baseline: confirms the `@/`
 * alias, @std/expect, and @std/testing/bdd all work under the new infra.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { safeStringify } from "@/utils/safeStringify.ts";

describe("safeStringify", () => {
    it("serializes plain objects with default 2-space indent", () => {
        const out = safeStringify({ a: 1, b: "x" });
        expect(out).toBe(JSON.stringify({ a: 1, b: "x" }, null, 2));
    });

    it("replaces circular references with [Circular]", () => {
        const obj: Record<string, unknown> = { name: "root" };
        obj.self = obj;

        const out = safeStringify(obj);
        const parsed = JSON.parse(out);

        expect(parsed.name).toBe("root");
        expect(parsed.self).toBe("[Circular]");
    });

    it("supports a custom indent", () => {
        const out = safeStringify({ a: 1 }, 0);
        expect(out).toBe('{"a":1}');
    });

    it("returns a degraded string instead of throwing on non-serializable values", () => {
        // BigInt is natively rejected by JSON.stringify
        const out = safeStringify({ n: 1n });
        expect(out).toContain("无法序列化");
    });
});
