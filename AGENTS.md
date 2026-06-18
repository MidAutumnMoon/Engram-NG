# AGENTS.md

## What This Is

A SillyTavern third-party extension. Graph RAG memory system — extracts entities/events from chat, stores them in IndexedDB, summarizes arcs, and re-injects relevant memories into the prompt so characters stay coherent over long conversations. Built with Deno + Vite + React 19 + TypeScript. Ships as a bundled extension per `manifest.json`; the `dist/` payload lives only on the `release` branch and is built by CI. The source branch does not track `dist/`.

This file intentionally omits directory layouts, entry-point paths, and module-to-concern mappings. Those drift faster than the docs can be updated. Explore the tree with the tools available when you need that detail.

## Rules

- Use `deno task <name>` for all scripts. There is no `package.json` — tasks live in `deno.jsonc`.
- When editing TS/TSX, match existing style: 4-space indent, double quotes, trailing commas, semicolons.
- Use the `@/` alias for everything under `src/`.
- This is a fork mid-refactor. Version strings and license fields are known-stale. Don't "fix" them unless asked.
- Do not read files in `dist/` — it's generated build output and is gitignored on the source branch. Run `deno task build` to (re)generate it locally.
- Take care when reading `vendor/` or grepping for texts — third-party source may contain very large files. Check size first and avoid grepping without guards.
- New or edited imports must be non-sloppy: include the explicit file extension (`.ts` / `.tsx`), or `/index.ts` for barrels. Existing sloppy imports across the codebase will be cleaned up incrementally — don't mass-rewrite them, but don't add new ones.
- All SillyTavern API access goes through the `@/sillytavern` host layer — don't call ST globals directly from modules or UI.
- Prefer a single source of truth for each kind of data. Don't shadow the existing source with module-local caches that drift out of sync.
- Don't duplicate logic across layers. If the same query, default-config merge, or range calculation shows up in two places, one of them is wrong eventually. When fixing a bug, grep for siblings — the same query elsewhere probably has the same bug.
- DRY means "consolidate when you see duplication", not "add an abstraction layer". Before extracting a shared helper or wrapping a lower-level API behind a facade, check whether direct call sites already serve the same callers. Wrapping for tidiness alone tends to grow back the coupling that was just removed.

## Current Status

- The `test/` suite is **broken post-fork**. Many tests reference deleted modules (Batch engine, Input Preprocessor, etc.) and stale paths (`@/core/...`). They have not been updated to match the refactor. Do not treat `deno task test` failures as regressions you caused, and don't "fix" the tests unless the task is explicitly about tests.
- `deno task build` is the source of truth for "does this compile". Run it after structural changes.

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
