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

### 1.2 Delete Input Preprocessor ✅ Done

**Rationale:** Runs a full LLM call before every user message. Extremely slow, extremely niche.

- [x] Delete `src/modules/preprocessing/` (Preprocessor.ts, types.ts, index.ts)
- [x] Delete `src/modules/workflow/definitions/PreprocessWorkflow.ts`
- [x] **High-risk edit:** In `src/modules/rag/injection/Injector.ts`, remove the preprocessing branch inside `handleGenerationAfterCommands`. The method currently checks `preprocessResult`, `preprocessConfig.enabled`, and calls `preprocessor.process()`. Strip all of that; `userInput` should flow directly to recall/injection.
- [x] Remove `preprocessing` toggle from Dashboard `FEATURE_CONFIG` in `src/ui/views/dashboard/index.tsx`
- [x] Remove the entire "预处理修订模式" section from `src/ui/views/settings/tabs/FeaturesTab.tsx`
- [x] Keep `ExtractTags`, `CleanRegex`, `ParseJson`, `TextProcessor`, `RegexProcessor` — they are reused by other workflows.

### 1.3 Delete Batch Processor & Engine ✅ Done

**Rationale:** History backfill and text import are nice-to-have onboarding features, but they add `BatchProcessor`, `BatchEngine`, `HistoryTask`, `ImportTextTask`, and a full UI panel.

- [x] Delete `src/modules/batch/` (entire directory)
- [x] Delete `src/ui/views/processing/BatchProcessingPanel.tsx`
- [x] Remove `batch` tab from `ProcessingView.tsx` and its `MAIN_TABS` / `TAB_INFO`
- [x] Delete `src/ui/hooks/useWorkflow.ts` (only consumed by BatchProcessingPanel)

### 1.4 Delete Global Search, Command Palette, Theme Manager ✅ Done

**Rationale:** Command palette inside a SillyTavern extension panel is over-engineered. Theme management and glass effects are also non-essential. QuickPanel is kept for its navigation utility, but its preprocessing tab is stripped.

- [x] Keep `src/ui/panels/QuickPanel.tsx` — remove the "preprocess" tab and all preprocessing-related state/logic (templateId selection, preprocessingConfig sync, etc.). Keep only the "navigate" quick links.
- [x] Delete `src/ui/components/overlay/CommandPalette.tsx`
- [x] Delete `src/modules/search/` (SearchService.ts + adapters/)
- [x] Simplify `src/state/uiStore.ts` — remove `commandPaletteOpen` and related actions. Keep `quickPanelOpen` since QuickPanel is retained.
- [x] Delete `src/ui/services/ThemeManager.ts`
- [x] Delete `src/ui/views/settings/components/ThemeSelector.tsx`
- [x] Delete `src/ui/views/settings/tabs/AppearanceTab.tsx` — it only contains ThemeSelector and Glass Settings
- [x] In `src/ui/views/settings/index.tsx`, remove the `AppearanceTab` tab; keep only `FeaturesTab` and `DataTab`
- [x] In `src/ui/overlay/GlobalOverlay.tsx`, remove `CommandPalette` and `useUiStore` imports if no longer needed; keep `QuickPanel` and `ReviewContainer`
- [x] Keep `initQuickPanelButton` in `src/integrations/tavern/bootstrap.ts` (QuickPanel stays)
- [x] Remove `ThemeManager.init()` from `src/integrations/tavern/bootstrap.ts`
- [x] Remove glass settings from `EngramSettings` in `src/config/settings.ts`
- [x] Remove `preprocessingConfig` and `glassSettings` from `ConfigState` in `src/state/configStore.ts`, and remove the corresponding `debouncedSave` lines
- [x] Delete `src/ui/styles/themes/` directory (did not exist)
- [x] Delete `src/state/themeStore.ts` and `src/state/index.ts` (depended on ThemeManager)
- [x] Remove `CommandPalette` from `src/ui/shell/Header.tsx` and `src/ui/shell/MainLayout.tsx`

### 1.5 Remove BrainRecallStep from Active Retrieval Workflow ✅ Done

**Rationale:** BrainRecallCache is kept for future review, but it is not used. Do not run dead code in the hot path.

- [x] Remove `BrainRecallStep` from `src/modules/workflow/definitions/RetrievalWorkflow.ts` steps array
- [x] Keep `src/modules/rag/retrieval/BrainRecallCache.ts` and `BrainRecallStep.ts` files intact for later review
- [x] In `MacroService`, remove the `brainRecallCache` dynamic-import fallback paths from `refreshEngramCache()` and `refreshCacheWithNodes()`. Since the cache is never populated now, these paths are unreachable.
- [x] Remove `brainRecallCache` usage from `Retriever.agenticSearch()`
- [x] Remove `brainRecallCache` usage from `useDashboardData.ts` (`fetchBrainStats`)
- [x] Remove `brainRecallCache` usage from `useMemoryStream.ts`
- [x] Backed up algorithm to `docs/reference/brain_recall_algorithm.md`
- [x] Remove `brainRecall` field from `RecallConfig` type and `DEFAULT_RECALL_CONFIG`
- [x] Remove brainRecall config section from `RecallConfigForm.tsx`
- [x] Remove `BrainRecallStats` / `brainStats` from dev-log types and `RecallLog.tsx`
- [x] Remove `BrainStats` / `ContextStats` from `useDashboardData.ts` and Dashboard UI

### 1.6 Demote SyncService to Reference-Only ✅ Done

**Rationale:** User wants it left for reference, but it must stop poisoning the data layer.

- [x] In `src/data/db.ts`: remove `syncService` import, remove `isImportingState` check, remove `scheduleUpload()` call inside `updateLastModified()`. `updateLastModified()` should only write `lastModified` to meta.
- [x] In `src/data/cleanup/CharacterCleanup.ts`: remove `syncService` imports and `syncService.purge()` calls.
- [x] In `src/integrations/tavern/bootstrap.ts`: ensure no SyncService wiring exists.
- [x] In `src/ui/views/settings/tabs/DataTab.tsx`: remove `<SyncSection />` usage. Keep the component file if desired, but it should not be mounted.
- [x] Add a top-of-file comment to `src/data/sync/SyncService.ts`:
  ```ts
  // REFERENCE ONLY — This module is not actively wired.
  // Re-enable by restoring imports in db.ts and CharacterCleanup.ts.
  ```

### 1.7 Strip Dashboard Gamification, Keep Core Telemetry ✅ Done

**Rationale:** The 4 stat cards (Token 消耗总计 / LLM 引擎调用 / 系统记忆构建 / RAG 上下文召回) are useful operational metrics. The gamification wrapper (badges, active-days tracking, "全局统计与成就" framing) is bloat.

- [x] In `src/config/settings.ts`:
  - Remove `firstUseAt` and `activeDays` from `EngramSettings["statistics"]` and `defaultSettings.statistics`
  - Keep: `totalTokens`, `totalLlmCalls`, `totalEvents`, `totalEntities`, `totalRagInjections`
  - In `incrementStatistic`: remove `firstUseAt` init and `activeDays` tracking. Keep numeric increment logic. All existing call sites use kept keys, so no call sites need removal.
- [x] Rename `src/ui/views/dashboard/components/AchievementsPanel.tsx` → `StatsPanel.tsx`
  - Remove the `<Trophy>` title "全局统计与成就"
  - Remove the entire "使用周期与活跃度" progress bar section (uses `firstUseAt` + `activeDays`)
  - Remove all achievement badge blocks (百日陪伴 / 忠实用户 / 活跃初见 / 千万 Token / 百万 Token / 十万 Token / 万卷藏书 / 千思之录 / 神经漫游者 / 记忆编织者 / 初窥门径)
  - Keep the 4 stat cards exactly as-is
  - Update export name and component name to `StatsPanel`
- [x] In `src/ui/views/dashboard/index.tsx`:
  - Replace `<AchievementsPanel stats={globalStats} />` with `<StatsPanel stats={globalStats} />`
  - Update import path accordingly
- [x] In `src/ui/hooks/useDashboardData.ts`:
  - Remove `fetchBrainStats` (already gone from 1.5)
  - Simplify the default `globalStats` state to drop `firstUseAt` / `activeDays`
  - Keep `fetchGlobalStats` (still reads the 5 counters)
  - Delete `toggleFeature` preprocessing branch (already gone from 1.2)
  - Simplify `fetchFeatureStatus` to exclude preprocessing (already gone from 1.2)

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
