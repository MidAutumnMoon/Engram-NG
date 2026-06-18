# Engram Refactoring Plan

> Strip bloat, then apply lightweight decoupling to the survivors.
> Do not add abstractions for code that is about to be deleted.

---

## Phase 1: Scope Reduction (Delete / Demote) ✅ Done

Goal: strip non-core features so the remaining code fits in a single mental model.

| # | Feature | Fate | Rationale |
|---|---------|------|-----------|
| 1.1 | Docs view + MDX pipeline | Deleted | README / wiki is enough for docs. |
| 1.2 | Input Preprocessor | Deleted | Full LLM call before every user message — too slow, too niche. |
| 1.3 | Batch Processor & Engine | Deleted | History backfill / text import are nice-to-have onboarding; not worth the module count. |
| 1.4 | Global Search, Command Palette, Theme Manager | Deleted | Over-engineered for a ST extension panel. QuickPanel navigation kept; theme switched to fixed `claudeDarkTheme` colors in `variables.css`. |
| 1.5 | BrainRecallStep | Removed from workflow | `BrainRecallCache.ts` kept for future review, but step is dead code in the hot path. |
| 1.6 | SyncService | Demoted to reference | Moved to `dev-docs/SyncService/` with reintroduction guide. All active wiring in `db.ts`, `CharacterCleanup.ts`, `bootstrap.ts`, `DataTab.tsx` removed. |
| 1.7 | Telemetry / "Statistics" | Deleted entirely | Counters (`totalTokens`, `totalLlmCalls`, etc.) were stored in ST extension settings JSON, triggering `saveSettingsDebounced()` on every LLM call. Misleading (don't reset with DB wipe) and duplicated live stats from IndexedDB. Dashboard now shows only current-state metrics. |

**Side effects:**
- `src/ui/styles/variables.css` colors switched to `claudeDarkTheme` (fixed fallback since ThemeManager was removed).
- `EngramSettings` interface slimmed: removed `statistics`, `preprocessingConfig`, `glassSettings`.
- `SettingsManager` no longer has `incrementStatistic`.

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
