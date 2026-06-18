# AGENTS.md

## What This Is

A SillyTavern third-party extension. Graph RAG memory system — extracts entities/events from chat, stores them in IndexedDB, summarizes arcs, and re-injects relevant memories into the prompt so characters stay coherent over long conversations. Built with Deno + Vite + React 19 + TypeScript. Ships as a bundled extension per `manifest.json`; the `dist/` payload lives only on the `release` branch (built by `.github/workflows/release.yml`); the `master` (source) branch does **not** track `dist/`, so the minified blob never pollutes search or agent context.

## Rules

- Use `deno task <name>` for all scripts. There is no `package.json` — tasks live in `deno.jsonc`.
- When editing TS/TSX, match existing style: 4-space indent, double quotes, trailing commas, semicolons.
- Use the `@/` alias for everything under `src/`.
- This is a fork mid-refactor. Version strings and license fields are known-stale. Don't "fix" them unless asked.
- Do not read files in `dist/` — it's generated build output, and on the `master` branch it is gitignored (untracked). Run `deno task build` to (re)generate it locally.
- Take care when reading `vendor/` or grepping for texts — third-party source may contain very large files. Check size first and avoid grepping without guards.
- New or edited imports must be non-sloppy: include the explicit file extension (`.ts` / `.tsx`), or `/index.ts` for barrels. Write `import { Logger } from "@/core/logger/index.ts"`, not `from "@/core/logger"`. Existing sloppy imports across the codebase will be cleaned up incrementally — don't mass-rewrite them, but don't add new ones.

## How to Work Here

- Entry point: `src/index.tsx`. `src/App.tsx` is the UI shell with tab routing.
- All SillyTavern API access goes through `src/integrations/tavern/` — don't call ST globals directly from modules or UI. LLM and embedding calls live under `src/integrations/`. SillyTavern's own source is vendored at `vendor/SillyTavern/` for reference.
- The memory/RAG pipeline is in `src/modules/`. Storage (Dexie/IndexedDB) in `src/data/`. State (Zustand) in `src/state/`. UI in `src/ui/`. Core infra in `src/core/`. Config and constants in `src/config/` and `src/constants/`. Tests in `test/` (Vitest, node env). Architecture docs (Chinese) in `docs/architecture/` — read these before large structural changes.

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
