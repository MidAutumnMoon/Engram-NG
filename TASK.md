# Engram Refactoring Plan

> Strip bloat, then apply lightweight decoupling to the survivors.
> Do not add abstractions for code that is about to be deleted.

---

## Phase 1: Scope Reduction (Delete / Demote)

### 1.1 Delete Docs View & Content ✅ Done

**Rationale:** In-app MDX documentation is overkill. Use README / GitHub wiki.

- [x] Delete `src/ui/views/docs/`
- [x] Delete `src/docs/` (registry + MDX files)
- [x] Remove `docs` route from `src/App.tsx`
- [x] Remove `docs` from `NAV_ITEMS` in `src/constants/navigation.ts`
- [x] Removed `DocAdapter` from `src/modules/search/` (build fix — depended on deleted `@/docs`)
- [x] Removed `@mdx-js/rollup` and `remark-gfm` dependencies from `deno.jsonc` / `vite.config.ts`

### 1.2 Delete Input Preprocessor

**Rationale:** Runs a full LLM call before every user message. Extremely slow, extremely niche.

- [x] Delete `src/modules/preprocessing/` (Preprocessor.ts, types.ts, index.ts)
- [x] Delete `src/modules/workflow/definitions/PreprocessWorkflow.ts`
- [x] **High-risk edit:** In `src/modules/rag/injection/Injector.ts`, remove the preprocessing branch inside `handleGenerationAfterCommands`. The method currently checks `preprocessResult`, `preprocessConfig.enabled`, and calls `preprocessor.process()`. Strip all of that; `userInput` should flow directly to recall/injection.
- [x] Remove `preprocessing` toggle from Dashboard `FEATURE_CONFIG` in `src/ui/views/dashboard/index.tsx`
- [x] Remove the entire "预处理修订模式" section from `src/ui/views/settings/tabs/FeaturesTab.tsx`
- [x] Keep `ExtractTags`, `CleanRegex`, `ParseJson`, `TextProcessor`, `RegexProcessor` — they are reused by other workflows.

### 1.3 Delete Batch Processor & Engine

**Rationale:** History backfill and text import are nice-to-have onboarding features, but they add `BatchProcessor`, `BatchEngine`, `HistoryTask`, `ImportTextTask`, and a full UI panel.

- [ ] Delete `src/modules/batch/` (entire directory)
- [ ] Delete `src/ui/views/processing/BatchProcessingPanel.tsx`
- [ ] Remove `batch` tab from `ProcessingView.tsx` and its `MAIN_TABS` / `TAB_INFO`

### 1.4 Delete Global Search & QuickPanel

**Rationale:** Command palette inside a SillyTavern extension panel is over-engineered. Theme management and glass effects are also non-essential.

- [ ] Delete `src/ui/panels/QuickPanel.tsx`
- [ ] Delete `src/ui/components/overlay/CommandPalette.tsx`
- [ ] Delete `src/modules/search/` (SearchService.ts + adapters/)
- [ ] Delete `src/state/uiStore.ts` — it only tracks QuickPanel / CommandPalette visibility
- [ ] Delete `src/ui/services/ThemeManager.ts`
- [ ] Delete `src/ui/views/settings/components/ThemeSelector.tsx`
- [ ] Delete `src/ui/views/settings/tabs/AppearanceTab.tsx` — it only contains ThemeSelector and Glass Settings
- [ ] In `src/ui/views/settings/index.tsx`, remove the `AppearanceTab` tab; keep only `FeaturesTab` and `DataTab`
- [ ] In `src/ui/overlay/GlobalOverlay.tsx`, remove `QuickPanel` and `useUiStore` imports; keep only `ReviewContainer`
- [ ] Remove `initQuickPanelButton` call from `src/integrations/tavern/bootstrap.ts`
- [ ] Remove `ThemeManager.init()` from `src/integrations/tavern/bootstrap.ts`
- [ ] Remove glass settings from `EngramSettings` in `src/config/settings.ts`
- [ ] Remove `preprocessingConfig` and `glassSettings` from `ConfigState` in `src/state/configStore.ts`, and remove the corresponding `debouncedSave` lines
- [ ] Delete `src/ui/styles/themes/` directory (or keep a single default CSS file if the build requires it)

### 1.5 Remove BrainRecallStep from Active Retrieval Workflow

**Rationale:** BrainRecallCache is kept for future review, but it is not used. Do not run dead code in the hot path.

- [ ] Remove `BrainRecallStep` from `src/modules/workflow/definitions/RetrievalWorkflow.ts` steps array
- [ ] Keep `src/modules/rag/retrieval/BrainRecallCache.ts` and `BrainRecallStep.ts` files intact for later review
- [ ] In `MacroService`, remove the `brainRecallCache` dynamic-import fallback paths from `refreshEngramCache()` and `refreshCacheWithNodes()`. Since the cache is never populated now, these paths are unreachable.

### 1.6 Demote SyncService to Reference-Only

**Rationale:** User wants it left for reference, but it must stop poisoning the data layer.

- [ ] In `src/data/db.ts`: remove `syncService` import, remove `isImportingState` check, remove `scheduleUpload()` call inside `updateLastModified()`. `updateLastModified()` should only write `lastModified` to meta.
- [ ] In `src/data/cleanup/CharacterCleanup.ts`: remove `syncService` imports and `syncService.purge()` calls.
- [ ] In `src/integrations/tavern/bootstrap.ts`: ensure no SyncService wiring exists.
- [ ] In `src/ui/views/settings/tabs/DataTab.tsx`: remove `<SyncSection />` usage. Keep the component file if desired, but it should not be mounted.
- [ ] Add a top-of-file comment to `src/data/sync/SyncService.ts`:
  ```ts
  // REFERENCE ONLY — This module is not actively wired.
  // Re-enable by restoring imports in db.ts and CharacterCleanup.ts.
  ```

### 1.7 Strip Dashboard Telemetry & Vanity Metrics

**Rationale:** `statistics` (activeDays, totalTokens, totalLlmCalls, etc.) adds state complexity for gamification that is not core to memory.

- [ ] Delete `src/ui/views/dashboard/components/AchievementsPanel.tsx`
- [ ] Remove `globalStats` and `brainStats` usage from `src/ui/views/dashboard/index.tsx`
- [ ] Remove `statistics` field from `EngramSettings` interface in `src/config/settings.ts`
- [ ] Remove `incrementStatistic` method from `SettingsManager`
- [ ] Grep for `incrementStatistic` across `src/` and remove all call sites.
- [ ] In `src/ui/hooks/useDashboardData.ts`:
  - Delete `fetchGlobalStats`
  - Delete `fetchBrainStats`
  - Delete `toggleFeature` preprocessing branch
  - Simplify `fetchFeatureStatus` to exclude preprocessing
  - Return only system health + memory counts

---

## Phase 2: Survivor Cleanup (Lightweight Decoupling)

After Phase 1 the import graph is smaller. Fix the remaining violations with **arguments and return values**, not new abstraction layers.

### 2.1 Fix Logger → UI Type Dependency

- [ ] Move `RecallLogEntry`, `RecallResultItem`, `RecallStats` from `src/ui/views/dev-log/types.ts` to `src/logger/types.ts`.
- [ ] Update imports in `RecallLogger.ts` and `dev-log/types.ts`.

### 2.2 Stop `modules/` from Reaching into `state/memoryStore.ts`

**Rule:** `useMemoryStore.getState()` must not be called inside `modules/`.

- [ ] `Summarizer.ts`: pass `chatId` and `db` as arguments; do not read store state.
- [ ] `EntityExtractor.ts`: pass `chatId` and `db` as arguments.
- [ ] `EventTrimmer.ts`: pass `chatId` and `db` as arguments.
- [ ] Workflow steps (`SaveEvent.ts`, `ApplyTrim.ts`, `KeywordRetrieveStep.ts`): receive `chatId` via `JobContext`, fetch `db` via `getDbForChat(chatId)` inside the step if needed.
- [ ] `MacroService` / `chatHistory.ts`: if they need memory data, accept it as parameters from the caller.

### 2.3 Stop `modules/` from Calling `notificationService`

**Rule:** Business logic returns results; the UI/integration layer decides whether to toast.

- [ ] `Summarizer.ts`: remove `notificationService.*` calls. Return `SummaryResult` with a `status` field.
- [ ] `EntityExtractor.ts`: remove toast calls. Return `EntityBuildResult`.
- [ ] `SaveEvent.ts`, `ApplyTrim.ts`: remove any direct `notificationService` calls.
- [ ] `CharacterCleanup.ts`: remove toast calls. Return `{ deleted: number }`.

### 2.4 Stop Deep `SettingsManager` Imports in Modules

**Rule:** `SettingsManager.get()` must not be called inside `modules/` or `data/`.

- [ ] In `bootstrap.ts`, load all required configs once:
  ```ts
  const summarizerConfig = SettingsManager.getSummarizerSettings();
  const entityConfig = SettingsManager.get("apiSettings")?.entityExtractConfig;
  const recallConfig = SettingsManager.get("apiSettings")?.recallConfig;
  // ...
  ```
- [ ] Pass these plain objects into service constructors or workflow context.
- [ ] Remove `SettingsManager` imports from `Summarizer.ts`, `EntityExtractor.ts`, `EventTrimmer.ts`, `VectorRetrieveStep.ts`, `KeywordRetrieveStep.ts`, `ApplyTrim.ts`.
- [ ] Keep `SettingsManager` only in:
  - `bootstrap.ts` (read initial state)
  - `configStore.ts` / UI hooks (persist changes)
  - Integration adapters (if they must read ST extension settings)

### 2.5 Remove `EventBus.UI_NAVIGATE_REQUEST`

**Rule:** UI navigation is a UI concern. Use a direct mechanism.

- [ ] Remove `UI_NAVIGATE_REQUEST` from `EngramEventType` in `src/events/index.ts`.
- [ ] In `App.tsx`, replace `EventBus.on("UI_NAVIGATE_REQUEST", ...)` with the existing `window.addEventListener("engram:navigate", ...)` only.
- [ ] **Note:** No emitters of `UI_NAVIGATE_REQUEST` were found in `src/`; if any exist in `vendor/` or tests, they are outside this scope.

### 2.6 Isolate `data/` → `integrations/tavern/` Imports

**Rule:** The data layer should not know about the host UI.

- [ ] `ChatManager.ts`: currently imports `getCurrentChatId` and `getCurrentCharacter`. Refactor so callers pass `chatId` and `character` as arguments. `ChatManager` becomes a stateless helper.
- [ ] `CharacterCleanup.ts`: imports `getSTContext`, `callPopup`, `WorldInfoService`. Move the popup/confirmation logic into the integration layer (e.g., a small adapter in `src/integrations/tavern/`), and pass the resulting `confirmed: boolean` into `CharacterCleanup`.

---

## Phase 3: Import Rule Enforcement

### 3.1 Document Layer Rules

Add to `AGENTS.md` (or create `ARCHITECTURE.md`):

```
Allowed import directions:
  ui/          → state/, modules/, core/
  state/       → data/, config/, core/
  modules/     → data/, config/, core/
  data/        → core/ ONLY
  integrations/→ core/ ONLY
  config/      → core/ ONLY
```

### 3.2 (Optional) CI Guard Script

```bash
#!/bin/sh
# Run in CI or pre-commit
fail=0
grep -r "from \"@/ui/\"" src/modules/ && fail=1
grep -r "from \"@/state/\"" src/modules/ && fail=1
grep -r "from \"@/integrations/\"" src/modules/ && fail=1
grep -r "from \"@/modules/\"" src/data/ && fail=1
grep -r "from \"@/ui/\"" src/data/ && fail=1
exit $fail
```

---

## Verification Checklist

After each phase, run:

- [ ] `deno task build` passes without errors.
- [ ] Confirm no orphaned imports in `src`
- [ ] Update TASK.md

---

## Suggested Order

1. **Phase 1.1 – 1.4** (Deletes) — mechanical, reduces file count immediately.
2. **Phase 1.5 – 1.7** (Demotes & strips) — removes active dependencies on kept-for-reference code.
3. **Phase 2.1** (Logger types) — trivial.
4. **Phase 2.2** (memoryStore isolation) — medium, repetitive.
5. **Phase 2.3** (notificationService removal) — medium, repetitive.
6. **Phase 2.4** (SettingsManager isolation) — requires understanding config flow.
7. **Phase 2.5 – 2.6** (EventBus cleanup, data layer isolation) — smaller, focused.
8. **Phase 3** (Documentation + guard) — final guardrail.

---

## Kept-for-Refactor Items (do not delete)

| Item | Status | Notes |
|---|---|---|
| Dev Log view | Keep | Refactor types per 2.1 |
| BrainRecallCache | Keep (inactive) | Step removed from workflow, file stays |
| UserReview step | Keep | Used by SummaryWorkflow and EntityWorkflow |
| CharacterCleanup | Keep | Refactor per 2.6 |
| API Presets view | Keep | Large, refactor separately when touched |
| SyncService | Reference-only | File stays, all active wiring removed |
