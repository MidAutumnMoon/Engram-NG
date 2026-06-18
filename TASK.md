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
- **Orphan test files** now import deleted modules and fail at load time. None are regressions — `test/` has not been updated post-fork:
  - `test/integration/batch-engine.test.ts`, `batch-history.test.ts`, `import-text.test.ts` → deleted Batch modules (1.3).
  - `test/integration/workflow-precision.test.ts` → `@/core/events/ReviewBridge` (stale path).
  - `test/unit/json-parser.test.ts` → `@/core/utils/JsonParser` (actual path is `@/utils/JsonParser`).
  - `test/integration/retrieval-workflow.test.ts` → still asserts `BrainRecallStep` in `stepsExecuted`; fails because 1.5 removed it.
  Defer until a dedicated test-cleanup pass, or delete the files if not worth reviving.
- **Orphan types** kept for compatibility: `PreprocessingConfig` / `DEFAULT_PREPROCESSING_CONFIG` in `src/config/types/data_processing.ts` (after 1.2), and the `syncConfig` field on `EngramSettings` (after 1.6). Either mark as reserved or delete in a follow-up.

---

## Phase 2: Survivor Cleanup (Lightweight Decoupling)

After Phase 1 the import graph is smaller. Fix the remaining violations with **arguments and return values**, not new abstraction layers.

### 2.1 Fix Logger → UI Type Dependency ✅ Done

- [x] Moved `RecallLogEntry`, `RecallResultItem`, `RecallStats` from `src/ui/views/dev-log/types.ts` to `src/logger/types.ts`.
- [x] Re-exported the three types from `src/logger/index.ts`.
- [x] Updated `RecallLogger.ts` to import from `./types.ts` (logger → ui violation eliminated).
- [x] Updated `RecallLog.tsx` to import from `@/logger/index.ts`.
- [x] Deleted `src/ui/views/dev-log/types.ts` — after the move its only remaining contents were the dead `RecallLogStore` interface and `DEFAULT_RECALL_LOG_STORE` const (unused leftovers from the V0.9.13 RecallLogger facade refactor; zero external references).

### 2.2 Stop `modules/` from Reaching into `state/memoryStore.ts`

**Rule:** `useMemoryStore.getState()` must not be called inside `modules/`.

**Architectural call:** after this, `state/memoryStore.ts` becomes a UI-only convenience wrapper. `modules/` and `data/` talk to Dexie directly via `getDbForChat(chatId)` / `tryGetDbForChat(chatId)`. Don't preserve the store as an intermediary — that re-introduces the coupling this phase removes.

**Singleton lifecycle pattern:** `summarizerService`, `entityBuilder`, `eventTrimmer` are module-level singletons. Don't thread `chatId` / `db` through every method call. Instead:
- Each singleton gains an `init({ chatId, db })` (or equivalent) method.
- `bootstrap.ts` resolves the current chat on startup and on `CHAT_CHANGED`, then calls `init()` on each service.
- Methods read state from the resolved handle, not from `useMemoryStore.getState()`.

- [ ] `Summarizer.ts`: remove `useMemoryStore` import; replace the `setLastSummarizedFloor` store call with a direct `chatManager`/`db` write.
- [ ] `EntityExtractor.ts`: remove `useMemoryStore` import; `saveRawEntities`, `checkAndArchiveEntities`, `getStatus` take `db` (or use the resolved handle).
- [ ] `EventTrimmer.ts`: remove `useMemoryStore` import (both static and the dynamic `import("@/state/memoryStore")` inside `getStatus`); use `db` directly.
- [ ] Workflow steps (`SaveEvent.ts`, `ApplyTrim.ts`, `FetchExistingEntities.ts`, `FetchEventsToTrim.ts`, `SaveEntity.ts`): receive `chatId` via `JobContext`, fetch `db` via `getDbForChat(chatId)` inside the step.
- [ ] `MacroService` / `chatHistory.ts`: if they need memory data, accept it as parameters from the caller.

### 2.3 Stop `modules/` from Calling `notificationService`

**Rule:** Business logic returns results; the UI/integration layer decides whether to toast.

- [ ] `Summarizer.ts`: remove `notificationService.*` calls. Return `SummaryResult` with a `status` field.
- [ ] `EntityExtractor.ts`: remove toast calls. Return `EntityBuildResult`.
- [ ] `SaveEvent.ts`, `ApplyTrim.ts`: remove any direct `notificationService` calls.
- [ ] `CharacterCleanup.ts`: remove toast calls. Return `{ deleted: number }`.

### 2.4 Stop Deep `SettingsManager` Imports in Modules

**Rule:** `SettingsManager.get()` must not be called inside `modules/` or `data/`.

**Pattern:** same singleton-lifecycle approach as 2.2 — `bootstrap.ts` reads each config once and calls `service.init(cfg)`. For workflow steps that need per-run config (`VectorRetrieveStep`, `KeywordRetrieveStep`, `ApplyTrim`), put the config object into `JobContext.config` at workflow construction time; the step reads `context.config`, not `SettingsManager`.

- [ ] In `bootstrap.ts`, load all required configs once:
  ```ts
  const summarizerConfig = SettingsManager.getSummarizerSettings();
  const entityConfig = SettingsManager.get("apiSettings")?.entityExtractConfig;
  const recallConfig = SettingsManager.get("apiSettings")?.recallConfig;
  const vectorConfig = SettingsManager.get("apiSettings")?.vectorConfig;
  // ...
  ```
- [ ] Pass these plain objects into `service.init(cfg)` calls and into workflow builders (e.g. `createRetrievalWorkflow({ recallConfig, vectorConfig })`).
- [ ] Remove `SettingsManager` imports from `Summarizer.ts`, `EntityExtractor.ts`, `EventTrimmer.ts`, `VectorRetrieveStep.ts`, `KeywordRetrieveStep.ts`, `ApplyTrim.ts`.
- [ ] Note: `EventTrimmer.getStoredConfig()` currently calls `SettingsManager.getSummarizerSettings()?.trimConfig` on every `getEffectiveConfig()` — this becomes the injected `trimConfig`.
- [ ] Keep `SettingsManager` only in:
  - `bootstrap.ts` (read initial state, dispatch to services)
  - `configStore.ts` / UI hooks (persist changes)
  - Integration adapters (if they must read ST extension settings)

### 2.5 Remove `EventBus.UI_NAVIGATE_REQUEST`

**Rule:** UI navigation is a UI concern. Use a direct mechanism.

- [ ] Rewrite `NotificationService.navigate(path)` in `src/ui/services/NotificationService.ts` to dispatch a window event instead of emitting on the bus:
  ```ts
  window.dispatchEvent(new CustomEvent("engram:navigate", { detail: path }));
  ```
  This is the sole existing emitter — the earlier draft's "no emitters found" note was wrong.
- [ ] Remove `UI_NAVIGATE_REQUEST` from `EngramEventType` in `src/events/index.ts`.
- [ ] In `App.tsx`, drop the `EventBus.on("UI_NAVIGATE_REQUEST", ...)` subscription; keep only the existing `window.addEventListener("engram:navigate", ...)`.

### 2.6 Isolate `data/` → `integrations/tavern/` Imports

**Rule:** The data layer should not know about the host UI.

- [ ] `ChatManager.ts`: currently imports `getCurrentChatId` and `getCurrentCharacter`. Refactor so callers pass `chatId` and `character` as arguments. `ChatManager` becomes a stateless helper.
- [ ] `CharacterCleanup.ts` — **this is a focused task of its own**, not a bullet. The file is 440+ lines with 6 `notificationService.*` call sites, `callPopup`, `SettingsManager` reads, and `WorldInfoService` usage. Plan:
  1. Move popup/confirmation logic into a small adapter in `src/integrations/tavern/` that returns `{ confirmed: boolean }`.
  2. Replace `notificationService.*` calls with return values (`{ deleted: number, failed: string[] }`); callers (in the integration layer) decide whether to toast.
  3. Inject `WorldInfoService` and the linked-deletion config via constructor or method args; remove `SettingsManager` import.
  4. After this, `CharacterCleanup.ts` should import only from `@/data`, `@/logger`, and `@/utils`.

### 2.7 Stop `state/` from Reaching into `integrations/tavern/`

**Context:** the Phase 3 import rules (below) forbid `state/ → integrations/`, but two slices currently violate this and the original plan didn't budget work for them:
- `src/state/memory/slices/coreSlice.ts` imports `getCurrentChatId`.
- `src/state/memory/slices/eventSlice.ts` imports `WorldInfoService`.

Either complete this task **or** relax the 3.1 rule to allow `state/ → integrations/`. Don't ship 3.1 with the rule stricter than reality.

- [ ] `coreSlice.ts`: have callers (bootstrap, ui) pass `chatId` in; remove `getCurrentChatId` import.
- [ ] `eventSlice.ts`: inject `WorldInfoService` (or a thin interface) via the store's initializer; remove direct import.

---

## Phase 3: Import Rule Enforcement

### 3.1 Document Layer Rules

Add to `AGENTS.md` (or create `ARCHITECTURE.md`).

The earlier draft of this table referenced a `core/` layer that **does not exist** in this repo. The real top-level peers under `src/` are: `ui/`, `state/`, `modules/`, `data/`, `integrations/`, `config/`, `logger/`, `utils/`, `events/`, `constants/`. Below, "primitives" means `logger/ + utils/ + events/ + constants/`.

```
Allowed import directions (target state):
  ui/            → anything (user-facing shell)
  integrations/  → anything (host bridge; bootstrap.ts is the composition root)
  state/         → data/, config/, primitives   (NOT integrations/, NOT modules/ — see 2.7)
  modules/       → data/, config/, primitives   (NOT state/, NOT integrations/, NOT ui/)
  data/          → primitives                   (NOT config/, NOT state/, NOT modules/, NOT integrations/)
  config/        → primitives
```

Notes:
- `integrations/tavern/bootstrap.ts` is the composition root: allowed to import everything. Other files under `integrations/` should still prefer importing through barrels, not reach across layers arbitrarily.
- `state/ → integrations/` is currently violated (see 2.7). Resolve before enabling the 3.2 guard.

### 3.2 (Optional) CI Guard

The hand-rolled grep script below only covers a subset of the 3.1 rules (it misses `state/ → integrations/`, `data/ → state/`, `data/ → config/`, etc.) and will rot quickly. **Prefer [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) or knip** (knip is already a dev-dep in `deno.jsonc`) with a rule file derived from the 3.1 table.

If a stop-gap grep is still wanted:

```bash
#!/bin/sh
# Stop-gap only — prefer dependency-cruiser / knip. Run in CI or pre-commit.
fail=0
grep -rnE "from "@/(ui|state|integrations)/" src/modules/ && fail=1
grep -rnE "from "@/(ui|state|config|integrations|modules)/" src/data/ && fail=1
grep -rnE "from "@/(integrations|modules)/" src/state/ && fail=1
exit $fail
```

---

## Verification Checklist

After each phase, run:

- [ ] `deno task build` passes without errors.
- [ ] Confirm no orphaned imports in `src`.
- [ ] `deno task test` — expected to still have pre-existing failures from the Phase 1 orphan test files (see Side effects). Any **new** failure caused by your refactor is a regression; the pre-existing list is not.
- [ ] Update TASK.md.

## Known Pre-existing Issues (not caused by this refactor)

Don't fix these as a side-effect of Phase 2 work; call them out in review instead:
- `src/modules/rag/retrieval/Retriever.ts`: references undefined `RecallCandidate` and `recallConfig`; calls `.toReversed()` on a Dexie `Collection` (method does not exist on that type).
- `src/modules/memory/Summarizer.ts`: uses `chat_metadata` where the ST context type is `chatMetadata`.
- Many sloppy imports across `src/` (imports without `.ts` suffix). Don't mass-rewrite; only fix lines you touch.

---

## Suggested Order

1. **Phase 1.1 – 1.4** (Deletes) — mechanical, reduces file count immediately. ✅ Done.
2. **Phase 1.5 – 1.7** (Demotes & strips) — removes active dependencies on kept-for-reference code. ✅ Done.
3. **Phase 2.1** (Logger types) — trivial, good warm-up.
4. **Phase 2.4** (SettingsManager isolation) — establishes the `service.init(cfg)` pattern that 2.2 also uses. Do this **before** 2.2.
5. **Phase 2.2** (memoryStore isolation) — medium, repetitive; builds on 2.4's pattern.
6. **Phase 2.3** (notificationService removal) — medium, repetitive.
7. **Phase 2.5 – 2.6** (EventBus cleanup, data layer isolation) — 2.6 is a focused task of its own.
8. **Phase 2.7** (state/ → integrations/ cleanup) — required before 3.2's guard can be enabled.
9. **Phase 3** (Documentation + guard) — final guardrail.

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
