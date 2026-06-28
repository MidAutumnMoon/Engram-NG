// Bundles JS-Slash-Runner's ambient @types/function/*.d.ts into a single
// isolated module at src/types/vendor/jsr-function.d.ts.
//
// Why: upstream index.d.ts is an ambient script (no imports/exports) whose
// siblings are reachable only through bare `typeof` references. A single
// triple-slash reference can't pull those siblings in, and without scoping every
// declared function would leak as a bare global. This script concatenates the
// siblings into a module body, `export`s every top-level declaration so consumers
// can `import type { RolePrompt, GenerateRawConfig, ... }` from it, and wraps
// index.d.ts's Window augmentation in `declare global`, so only
// `window.TavernHelper` escapes as a true global — the named types stay
// module-scoped and importable on demand.
//
// Run via `deno task gen:types`. The vendor dir is treated as read-only; output
// is committed to the source tree. Regenerate after bumping the JS-Slash-Runner
// vendor submodule.

const projectRoot = import.meta.dirname! + "/..";
const srcDir = projectRoot + "/vendor/JS-Slash-Runner/@types/function/";
const iframeDir = projectRoot + "/vendor/JS-Slash-Runner/@types/iframe/";
const outDir = projectRoot + "/src/types/vendor/";
const outPath = outDir + "jsr-function.d.ts";

// All .d.ts files except index.d.ts (handled separately, wrapped in global) and
// our own output filename (guards against stale self-inclusion after a rename).
const files = Array.from(Deno.readDirSync(srcDir))
    .filter((f) =>
        f.name.endsWith(".d.ts") &&
        !["index.d.ts", "jsr-function.d.ts"].includes(f.name)
    )
    .map((f) => f.name)
    .sort();

// iframe/*.d.ts are ambient scripts that cross-reference function/ types (e.g.
// `VariableOption`). Bundling them into this module — wrapped in `declare global`
// — lets those cross-refs resolve in-module, while keeping the globals Engram
// consumes (`Mvu`, `EjsTemplate`, `SillyTavern`, `tavern_events`, `ListenerType`,
// `eventOn`, …) ambient. Mirrors the index.d.ts Window-augmentation approach.
const iframeFiles = Array.from(Deno.readDirSync(iframeDir))
    .filter((f) => f.name.endsWith(".d.ts"))
    .map((f) => f.name)
    .sort();

// Split triple-slash reference directives from the body. Pure: returns both
// parts instead of mutating an accumulator, so assembly order can't drop refs.
const splitRefs = (content: string): { refs: string; body: string } => {
    let refs = "";
    let body = "";
    for (const line of content.split("\n")) {
        if (line.trim().startsWith("/// <reference")) {
            refs += line + "\n";
        } else {
            body += line + "\n";
        }
    }
    return { refs, body };
};

// Prefix `export` onto every top-level declaration so the bundled types are
// importable (`import type { RolePrompt } from "@/types/vendor/jsr-function"`).
// Vendor source declares everything ambient (`type X`, `declare function f`,
// etc.) with no `export`; as a module those would be unreachable. Function
// overloads (multiple `declare function f` lines) merge fine when each is
// `export declare function f`. Only top-level lines are touched — anything
// indented or inside a block body is left alone.
const EXPORT_DECL_RE =
    /^(type |interface |declare function |declare const |declare class )/;
const exportDecls = (body: string): string =>
    body
        .split("\n")
        .map((line) => EXPORT_DECL_RE.test(line) ? `export ${line}` : line)
        .join("\n");

// Inside `declare global { ... }` the context is already ambient, so the
// `declare` modifier on `const`/`function`/`namespace` is illegal (TS1038).
// Strip it. `type`/`interface` carry no `declare` modifier and pass through.
const STRIP_DECLARE_RE = /^declare (const|function|namespace) /;
const stripDeclare = (body: string): string =>
    body
        .split("\n")
        .map((line) =>
            STRIP_DECLARE_RE.test(line) ? line.replace("declare ", "") : line
        )
        .join("\n");

let refsAll = "";
let bodyAll = "";

for (const file of files) {
    const { refs, body } = splitRefs(Deno.readTextFileSync(srcDir + file));
    refsAll += refs;
    bodyAll += `\n// --- ${file} ---\n` + exportDecls(body) + "\n";
}

// iframe/*.d.ts — concatenate, strip `declare` modifiers, wrap in a single
// `declare global` block so the cross-refs to function/ types (VariableOption)
// resolve in-module while the globals Engram consumes stay ambient.
let iframeBody = "";
for (const file of iframeFiles) {
    const { refs, body } = splitRefs(
        Deno.readTextFileSync(iframeDir + file),
    );
    refsAll += refs;
    iframeBody += `\n// --- iframe/${file} ---\n` + stripDeclare(body) + "\n";
}

// index.d.ts declares `interface Window { TavernHelper: {...} }`; wrap it in
// `declare global` so the module augmentation actually lands on the global
// Window rather than being scoped to this module's local namespace.
const indexParts = splitRefs(Deno.readTextFileSync(srcDir + "index.d.ts"));
refsAll += indexParts.refs;

let finalContent =
    "// Auto-generated by `deno task gen:types`. Do not edit by hand.\n" +
    "// Source: vendor/JS-Slash-Runner/@types/function/\n" +
    "// Regenerate after bumping the JS-Slash-Runner vendor submodule.\n\n";

// All triple-slash directives must sit above any top-level statements.
finalContent += refsAll;
// `export {}` turns the combined file into an isolated module, scoping every
// ambient declaration inside it (only `declare global` leaks out).
finalContent += "\nexport {};\n\n";
// Vendor's `registerVariableSchema` references `z.ZodType` but never imports
// Zod; supply the missing import so the type resolves. Zod is a real dep.
finalContent += 'import type * as z from "zod";\n\n';
finalContent += bodyAll;
finalContent += "\n// --- index.d.ts ---\n";
finalContent += "declare global {\n" + indexParts.body + "}\n";
// iframe types as a second `declare global` block (TS allows multiple per module).
finalContent += "\n// --- iframe types (wrapped in declare global) ---\n";
finalContent += "declare global {\n" + iframeBody + "}\n";

Deno.mkdirSync(outDir, { recursive: true });
Deno.writeTextFileSync(outPath, finalContent);
console.log(`Successfully bundled types to ${outPath}`);
