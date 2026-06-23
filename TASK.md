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

- [ ] **1a. `memory.ts`** — `TrimConfig`, `EntityExtractConfig`, `GlobalRegexConfig`. Delete `DEFAULT_TRIM_CONFIG` from `defaults.ts` (its defaults move into the schema).
- [ ] **1b. `rag.ts`** — `VectorConfig`, `RerankConfig`, `RecallConfig`, `EmbeddingConfig`, `BrainRecallConfig` (the last is reference-only but typed here). Delete the matching `DEFAULT_*` constants. Keep `AgenticRecall` as a schema too — it's an LLM-output DTO.
- [ ] **1c. `llm.ts`** — `LLMPreset`, `CustomAPIConfig`, `SamplingParameters`, `ContextSettings`. Fold `createDefaultLLMPreset` into `llmPreset.parse({ name })`.
- [ ] **1d. `prompt.ts`** — `PromptTemplate`, `CustomMacro`, `WorldbookConfig`, `WorldbookConfigProfile`. Fold `createPromptTemplate` into `promptTemplate.parse({ name, category, ... })`. Keep `PromptTemplateSingleExport` / `PromptTemplateExport` as schemas — import/export DTOs benefit from validation.
- [ ] **1e. `data_processing.ts`** — `RegexRule`, `PreprocessingConfig`. `REGEX_SCOPE_OPTIONS` and `DEFAULT_REGEX_RULES` stay as constants (UI metadata / seed data, not validation); they just reference `z.infer<typeof regexScope>` instead of a hand-written union.

After each file: `deno task build`. `z.infer` errors will surface every consumer that depended on the old shape.

### Phase 2 — Collapse `defaults.ts`

Once Phase 1 is done, `defaults.ts` is mostly empty.

- [ ] **2a.** Move `EngramAPISettings` schema + `getDefaultAPISettings` (now `engramApiSettings.parse({})`) into `settings.ts`. This kills the `config → integrations/llm/PromptLoader` layer violation — `getBuiltInPromptTemplates` / `getBuiltInTemplateById` / `getBuiltInTemplateByCategory` move with it or get inlined into their callers.
- [ ] **2b.** Delete `defaults.ts` as a barrel. Its re-exports either disappear (types now come from their schema files directly) or move to `settings.ts`.

### Phase 3 — Rewrite `SettingsManager` around the root schema

- [ ] **3a.** Define `engramSettingsSchema` in `settings.ts` — composition of all the per-domain schemas from Phase 1 plus the top-level scalars (`theme`, `hasSeenWelcome`, `linkedDeletion`, `syncConfig`, etc.). Every field has `.default()`.
- [ ] **3b.** `getSettings()` becomes `engramSettingsSchema.parse(stored)`. One line. Validation + migration + defaults all handled. Delete `initSettings`'s hand-rolled merge loop.
- [ ] **3c.** Strip `getSummarizerSettings` / `setSummarizerSettings` / `getRegexRules`. Callers read typed fields directly off the parsed settings object.
- [ ] **3d.** Decide on `summarizerConfig` / `trimmerConfig` — these are `Partial<any>` escape hatches. Either type them properly via schemas or delete them if unused.
- [ ] **3e.** Optionally de-class `SettingsManager` → bare functions (`getSettings`, `get`, `set`). No instance state; the class is ceremony. Match the pattern set by `LinkedCleanup.ts`.

### Phase 4 — Clean up call sites

- [ ] **4a.** Grep for `{ ...DEFAULT_X, ...stored }` spreads — these should all be deletable now that the schema applies defaults.
- [ ] **4b.** Grep for `SettingsManager.get("...")` returning `any` — replace with typed reads off `getSettings()`.
- [ ] **4c.** Grep for `as any` / `Partial<any>` in config consumers — most should be removable.

## Non-goals

- Don't convert UI dropdown metadata (`REGEX_SCOPE_OPTIONS`, `PROMPT_CATEGORIES`) to schemas — they're display constants, not validation.
- Don't touch `state/configStore.ts` beyond what's needed to compile. Its reactive subscription model is orthogonal to how defaults are defined.
- Don't fix `test/` — broken post-fork per `AGENTS.md`.

## Decisions

- **Use regular Zod 4** (`import { z } from "zod"`), not Zod Mini. `vite.config.ts` sets `codeSplitting: false`, so Mini's tree-shaking benefit doesn't apply. `.default()` chaining (the core of this migration) reads cleanly on regular Zod and awkwardly on Mini. `SaveEntity.ts` already uses regular Zod — stay consistent.

## Open questions

- [ ] `summarizerConfig` / `trimmerConfig` — type them or delete them? Grep for readers first.
