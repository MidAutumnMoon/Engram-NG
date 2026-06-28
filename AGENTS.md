# AGENTS.md

## What This Is

A SillyTavern third-party extension. Graph RAG memory system — extracts entities/events from chat, stores them in IndexedDB, summarizes arcs, and re-injects relevant memories into the prompt so characters stay coherent over long conversations. Built with Deno + Vite + React 19 + TypeScript. Ships as a bundled extension per `manifest.json`; the `dist/` payload lives only on the `release` branch and is built by CI. The source branch does not track `dist/`.

This file intentionally omits directory layouts, entry-point paths, and module-to-concern mappings. Those drift faster than the docs can be updated. Explore the tree with the tools available when you need that detail.

## Rules

- Use `deno task <name>` for all scripts.
- When editing TS/TSX, match existing style: 4-space indent, double quotes, trailing commas, semicolons.
- Use the `@/` alias for everything under `src/`.
- Do not read files in `dist/` — it's generated build output and is gitignored on the source branch. Run `deno task build` to (re)generate it locally.
- Take care when reading `vendor/` or grepping for texts — third-party source may contain very large files. Check size first and avoid grepping without guards.
- Imports must be non-sloppy: include the explicit file extension (`.ts` / `.tsx`). Prefer avoiding `index.ts` barrelling.
- Dynamic imports do not reduce bundle size: `vite.config.ts` sets `build.rollupOptions.output.codeSplitting: false`, so everything is emitted as a single `index.js`. Only use dynamic imports to break circular dependencies or defer module evaluation; prefer static imports otherwise.
- All SillyTavern API access goes through the `@/sillytavern` host layer — don't call ST globals directly from modules or UI.
- Prefer a single source of truth for each kind of data. Don't shadow the existing source with module-local caches that drift out of sync.
- Don't duplicate logic across layers. If the same query, default-config merge, or range calculation shows up in two places, one of them is wrong eventually. When fixing a bug, grep for siblings — the same query elsewhere probably has the same bug.
- DRY targets things that must stay in sync — same data, same algorithm, same business rule. Repetition that merely shares a syntactic shape (a conditional className, a layout pattern, a common button style) is coincidence, not duplication; factoring it out invents coupling where none existed. Test: if one copy changed independently of the others and that is *not* a bug, leave it inline.
- "Consolidate when you see duplication" means merge shared *logic*, not wrap a lower-level API behind a facade. Before extracting a helper, check whether the direct call sites already serve the same callers. A helper used at 2 sites, each a one-line call, is net-negative — the import and indirection cost more than the duplication. Wrapping for tidiness alone tends to grow back the coupling that was just removed.

## Current Status

- `deno task build` bundles the app (Vite strips types without checking). For real type-checking that matches the LSP, run `deno task typecheck` (= `deno check` on the entry point). Always run `deno task typecheck`, never `deno check` on individual files — root `global.d.ts` (window.toastr/SillyTavern etc.) is only pulled into the graph via the entry point, so single-file checks report phantom "does not exist on type 'Window'" errors.
- The agent `grep` tool is **unreliable** currently (tracked: zed#59677). Few failure modes:
  - Parallel calls with overlapping regexes can swap/corrupt each other's results — including across different regexes, not just identical ones. **Run grep calls sequentially, never in parallel**, unless correctness doesn't matter.
  - `include_pattern` of the form `<dir>/**/*.ext` (e.g. `src/**/*.ts`) silently returns no matches. Use `**/*.ext` (no directory prefix) or a full literal path instead.
  - When a grep returns "No matches" and that's surprising, don't trust it — retry with a different pattern form, or cross-check with `find_path` / `deno task build` before concluding the symbol is absent.

For the time being, apply the workaround or shell out to `grep` or `rg` which you are more confident in (take extra care when escaping).

## Dev Loop

SillyTavern URL: <http://127.0.0.1:8000>. If you cannot access it, then it means User forgot to launch SillyTavern. Tell them about that.

SillyTavern loads the extension from `dist/index.js` (per `manifest.json`), not from a dev server. Source changes don't take effect until `dist/` is rebuilt and the browser is refreshed.

After editing files under `src/`:
1. Run `deno task build` (~2s).
2. Refresh the browser via Playwright MCP (`browser_navigate` to the ST URL, or `browser_evaluate` with `location.reload()`).

Do this automatically after UI-affecting changes — don't wait to be asked. Batch the build: if making multiple edits, build once after all edits are done.

## Look Things Up

- When unsure about a library, tool, or API, use web search or Context7 before guessing.
- Prefer Context7 for library docs — it pulls real examples and up-to-date signatures. React 19, Vite 8, Vitest 4, Zod 4, Dexie 4, Zustand 5 are all recent majors with breaking changes; don't assume v2-era APIs.
- Don't hallucinate option names, function signatures, or CLI flags. Look it up.

## Complex Tasks

- Break large tasks into sub-tasks. Tackle them in parallel with sub-agents when they don't depend on each other.
- Give each sub-agent full context — it won't see your conversation history.
- Keep sub-tasks scoped to one concern. If two sub-agents might edit the same file, don't run them in parallel.

## Communication

- Be short. Say the thing, stop.
- Don't repeat what I already said or what's already in context.
- Don't pad with disclaimers, summaries, or "hope that helps" type closings.
- If something is wrong, say what's wrong and how to fix it. Don't hedge.
