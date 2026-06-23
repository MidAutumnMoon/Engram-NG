# Config → Zod Migration — TASK.md

## Diagnosis

`src/config` has three concerns crammed together. Only one is genuinely a mess.

1. **Type definitions (`config/types/*.ts`) — mostly fine.** Six pure type modules co-located by domain. The smell: `defaults.ts` is simultaneously a re-export barrel, the home of `EngramAPISettings`, all the `DEFAULT_*` constants, factory functions, *and* imports `@/integrations/llm/PromptLoader`. That's a layer violation — config depends on integrations.

2. **`SettingsManager` — over-engineered and leaky.** This is where the real complexity lives:
   - `getSettings()` lies about its type. Returns `EngramSettings` but the actual return is `context.extensionSettings.engram` — an untyped blob ST persists across versions and upgrades. No validation. A field-shape change silently produces `undefined` and crashes far from the cause.
   - `initSettings` reimplements (badly) what a schema-parse does. Its "ensure all fields exist" loop is a shallow merge — nested defaults aren't handled, which is why callers like `EventTrimmer.init` redo `{ ...DEFAULT_TRIM_CONFIG, ...storedTrim }` themselves. Merge logic is duplicated at every nested-config call site.
   - Typed accessors are half-and-half. `getSummarizerSettings` / `getRegexRules` exist; `getTrimConfig` / `getRecallConfig` don't. Callers fall back to `SettingsManager.get("trimConfig")` which returns `any`.
   - `summarizerConfig: Partial<any>` and `trimmerConfig: Partial<any>` are escape hatches that became permanent untyped global state.
   - `SettingsManager` is a class with no instance state — a namespace in disguise.

3. **The mirroring tax.** Every shape is defined twice: once as a TS interface in `types/*.ts`, once as a hand-written `DEFAULT_*` constant in `defaults.ts`. They drift. Field added to interface → forgot to update default → runtime hole.

## Plan

Migrate config types to Zod schemas with `.default(...)`. This collapses interface + default into one source of truth, centralizes migration/validation at the ST boundary, and deletes the manual merge code.

Zod v4 is already in `deno.jsonc` (`zod@^4.3.5`) and already used in `SaveEntity.ts`.

### Phase 1 — Convert type files one domain at a time

Each `config/types/*.ts` file: replace `interface X { ... }` + sibling `DEFAULT_X` constant with one `z.object({ ... })` schema using `.default()` on every field. Export `type X = z.infer<typeof xSchema>` for ergonomics.

Order (smallest / best-understood first):

- [x] **1a. `memory.ts`** — `TrimConfig`, `EntityExtractConfig`, `GlobalRegexConfig`. Defaults moved into schemas; `DEFAULT_*` constants in `defaults.ts` now derive via `schema.parse({})`.
- [x] **1b. `rag.ts`** — `VectorConfig`, `RerankConfig`, `RecallConfig`, `EmbeddingConfig`, `BrainRecallConfig`, `AgenticRecall`. All `DEFAULT_*` constants now derive from schemas.
- [x] **1c. `llm.ts`** — `LLMPreset`, `CustomAPIConfig`, `SamplingParameters`, `ContextSettings`. `createDefaultLLMPreset` folded into `llmPresetSchema.parse({ name })`.
- [x] **1d. `prompt.ts`** — `PromptTemplate`, `CustomMacro`, `WorldbookConfig`, `WorldbookConfigProfile`. `createPromptTemplate` folded into `promptTemplateSchema.parse(...)`. Export DTOs are schemas.
- [x] **1e. `data_processing.ts`** — `RegexRule`, `PreprocessingConfig`. Seed data (`DEFAULT_REGEX_RULES`) and UI metadata (`REGEX_SCOPE_OPTIONS`) stay as constants referencing `z.infer` types.

After each file: `deno task build`. `z.infer` errors will surface every consumer that depended on the old shape.

### Phase 2 — Collapse `defaults.ts`

Once Phase 1 is done, `defaults.ts` is mostly empty.

- [x] **2a.** Moved `EngramAPISettings` + `getDefaultAPISettings` + factories (`createDefaultLLMPreset`, `createPromptTemplate`) into `settings.ts`. Inlined the three `getBuiltIn*` wrappers into `PromptLoader` (`getById`, `getByCategory`) — truly kills the `config → integrations/llm/PromptLoader` layer violation. Co-located every `DEFAULT_*` constant next to its schema in `types/{memory,rag,prompt}.ts`.
- [x] **2b.** Deleted `defaults.ts` entirely. All 14 callers updated to import types/constants from their schema files and factories from `settings.ts`.

### Phase 3 — Rewrite `SettingsManager` around the root schema

- [x] **3a.** Defined `engramApiSettingsSchema` and `engramSettingsSchema` in `settings.ts` — compositions of all per-domain schemas. Every field has `.default()` or `.prefault({})` (Zod v4 requires `.prefault()` for nested objects whose output type has required fields). `EngramAPISettings` and `EngramSettings` are now `z.infer` types, not hand-written interfaces.
- [x] **3b.** `getSettings()` → `engramSettingsSchema.parse(raw ?? {})`. `initSettings()` → parse + persist. Deleted the 30-line hand-rolled merge loop and `defaultSettings` constant.
- [x] **3c.** Stripped `getSummarizerSettings`, `setSummarizerSettings`, `getRegexRules`. Updated callers: `index.ts` reads `get("apiSettings")?.trimConfig`; `useSummarizerConfig.ts` reads/writes `trimConfig` via `apiSettings` instead of the old `summarizerConfig` hack.
- [x] **3d.** Deleted dead `trimmerConfig` field. Typed `summarizerConfig` properly: moved `SummarizerConfig` schema to `config/types/memory.ts`; `domain/memory/types.ts` re-exports.
- [ ] **3e.** (Optional) De-class `SettingsManager` → bare functions. Low priority — class works fine as a namespace.

### Phase 4 — Clean up call sites

- [x] **4a.** Replaced all `{ ...DEFAULT_X, ...stored }` spreads with `schema.parse(stored ?? {})`. Files: `EventTrimmer.ts` (3 sites), `EntityExtractor.ts`, `Summarizer.ts`, `index.ts`, `useSummarizerConfig.ts`. Deleted unused `DEFAULT_*` imports from all five files.
- [x] **4b.** No `as any` casts remain on `SettingsManager.get()` reads — `summarizerConfig` cast in `Summarizer.ts` deleted. All reads now get typed return values from `z.infer`.
- [x] **4c.** Removed 4 `} as any)` casts on `SettingsManager.set("apiSettings", ...)` calls (`useDashboardData.ts` ×3, `useLLMPresets.ts` ×1). Fixed root cause in `useLLMPresets.ts`: `|| {}` → `?? getDefaultAPISettings()` to ensure complete shape.

## Non-goals

- Don't convert UI dropdown metadata (`REGEX_SCOPE_OPTIONS`, `PROMPT_CATEGORIES`) to schemas — they're display constants, not validation.
- Don't touch `state/configStore.ts` beyond what's needed to compile. Its reactive subscription model is orthogonal to how defaults are defined.
- Don't fix `test/` — broken post-fork per `AGENTS.md`.

## Decisions

- **Use regular Zod 4** (`import { z } from "zod"`), not Zod Mini. `vite.config.ts` sets `codeSplitting: false`, so Mini's tree-shaking benefit doesn't apply. `.default()` chaining (the core of this migration) reads cleanly on regular Zod and awkwardly on Mini. `SaveEntity.ts` already uses regular Zod — stay consistent.

## Open questions

- [x] ~~`summarizerConfig` / `trimmerConfig` — type them or delete them?~~ Resolved in Phase 3d: `trimmerConfig` deleted (dead); `summarizerConfig` typed via schema moved to `config/types/memory.ts`.
