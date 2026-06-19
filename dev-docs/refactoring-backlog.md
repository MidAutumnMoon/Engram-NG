# Refactoring Backlog

Unfinished decoupling work, moved out of `TASK.md` to keep the active plan focused.
Pick these up when the topology refactor (see `TASK.md`) is complete.

## Phase 2: Survivor Cleanup (Lightweight Decoupling)

Fix the remaining violations with **arguments and return values**, not new abstraction layers.

### 2.2 + 2.4 — Merged Pass: `memoryStore` and `SettingsManager` Isolation

**Done together, not sequenced.** Both concerns share the same files (`Summarizer.ts`, `EntityExtractor.ts`, `EventTrimmer.ts`, `ApplyTrim.ts`) and the same lifecycle moment. 2.2 establishes what `setChatContext()` looks like; 2.4 establishes what `init(config)` looks like — a single pass gets both right.

#### Rules

- **2.2 rule:** `useMemoryStore.getState()` must not be called inside `modules/`.
- **2.4 rule:** `SettingsManager.get()` must not be called inside `modules/` or `data/`.

#### Architectural call

After this, `state/memoryStore.ts` becomes a UI-only convenience wrapper. `modules/` and `data/` talk to Dexie directly via `getDbForChat(chatId)` / `tryGetDbForChat(chatId)`. Don't preserve the store as an intermediary — that re-introduces the coupling this phase removes.

#### Singleton lifecycle contract

`summarizerService`, `entityBuilder`, `eventTrimmer` are module-level singletons. Config and chat context change at different cadences, so they get separate entry points:

```ts
// Called once at startup (and when user edits settings).
// Replaces constructor-time SettingsManager reads.
service.init(config: ServiceConfig): void

// Called at startup and on every CHAT_CHANGED.
// Replaces useMemoryStore.getState() reads.
service.setChatContext({ chatId: string, db: ChatDatabase }): void
```

`bootstrap.ts` owns both calls: it reads `SettingsManager` once to build the config objects, resolves the current chat to build the context, and dispatches. On `CHAT_CHANGED` it calls only `setChatContext()` on each service.

#### Step ordering

Natural stopping points exist after each step — the app should build and run at each.

- [x] **A. Design `init()` + `setChatContext()` contract.** ✅ Done — see contract above.
- [x] **B. `EventTrimmer.ts`** — smallest service, good test case. ✅ Done. Removed both `useMemoryStore` (static + dynamic import in `getStatus`) and `SettingsManager.getSummarizerSettings()` in `getStoredConfig()`. Takes `db` and `trimConfig` from the resolved context. Also wired bootstrap (step E preview for EventTrimmer only). Notes:
  - `getEventsToMerge` / `countEventTokens` inlined as private methods (faithful copy from `eventSlice.ts`). The store versions still exist — other consumers (workflow steps in step D) haven't been migrated yet.
  - `WorldInfoService` import surfaced (was hidden inside the store). This is a pre-existing `modules/ → integrations/` coupling — Phase 2.7 / 3.1 will address.
  - `notificationService` stays (step 2.3 scope, not step B).
- [ ] **C. `Summarizer.ts` + `EntityExtractor.ts`** — larger, have start/stop, cross-reference each other (Summarizer → `entityBuilder.extractByRange`, Summarizer → `eventTrimmer.trim`). Remove `SettingsManager.get()` in constructor + `triggerSummary`, `SettingsManager.set()` in `updateConfig`, and `useMemoryStore.getState()` in `setLastSummarizedFloor`. `setLastSummarizedFloor` writes directly to `chatManager` / `db`.
- [ ] **D. Workflow steps.** Per-step; each step resolves what it needs from `JobContext`:
  - `SaveEvent.ts`, `FetchExistingEntities.ts`, `FetchEventsToTrim.ts`, `SaveEntity.ts` — pure 2.2: `useMemoryStore.getState()` → `getDbForChat(context.chatId)`.
  - `VectorRetrieveStep.ts`, `KeywordRetrieveStep.ts` — pure 2.4: `SettingsManager.get("apiSettings")` → read from `context.config` (set at workflow construction).
  - `ApplyTrim.ts` — both: remove `useMemoryStore`, `SettingsManager`, and `notificationService.*` (the last is 2.3 scope but cheap to do here since the file is open).
- [ ] **E. `bootstrap.ts` wiring.** Load all configs once (see snippet below), resolve chat on startup, subscribe to `CHAT_CHANGED`, dispatch `init()` + `setChatContext()` to each service. Inject `recallConfig` / `vectorConfig` into `createRetrievalWorkflow({ recallConfig, vectorConfig })`.
- [ ] **F. (Deferrable) UI hooks write-side.** Today `service.updateConfig()` internally calls `SettingsManager.set()`. The consistent pattern is: UI hooks own persistence (`SettingsManager.set` / `configStore`), `service.updateConfig()` becomes in-memory only. This ripples into `useSummarizerConfig.ts`, `useDashboardData.ts`, `EntityConfigPanel.tsx`. **Can stop at E** and defer this — it's a clean boundary.

#### bootstrap.ts config snippet (for step E)

```ts
const summarizerConfig = SettingsManager.getSummarizerSettings();
const entityConfig = SettingsManager.get("apiSettings")?.entityExtractConfig;
const recallConfig = SettingsManager.get("apiSettings")?.recallConfig;
const vectorConfig = SettingsManager.get("apiSettings")?.vectorConfig;
// ...
```

#### After this pass, `SettingsManager` lives only in:

- `bootstrap.ts` (read initial state, dispatch to services)
- `configStore.ts` / UI hooks (persist changes)
- Integration adapters (if they must read ST extension settings)

#### Other consumers

- [ ] `MacroService` / `chatHistory.ts`: if they need memory data, accept it as parameters from the caller (2.2). `chatHistory.ts` already reads `SettingsManager` and `useMemoryStore` — fold into step C or D.

### 2.3 Stop `modules/` from Calling `notificationService`

**Rule:** Business logic returns results; the UI/integration layer decides whether to toast.

- [ ] `Summarizer.ts`: remove `notificationService.*` calls. Return `SummaryResult` with a `status` field.
- [ ] `EntityExtractor.ts`: remove toast calls. Return `EntityBuildResult`.
- [ ] `SaveEvent.ts`, `ApplyTrim.ts`: remove any direct `notificationService` calls.
- [ ] `CharacterCleanup.ts`: remove toast calls. Return `{ deleted: number }`.

> Note: `NotificationService.navigate` (the one `UI_NAVIGATE_REQUEST` emitter) was removed as part of the topology refactor's Phase T4. The items above are the remaining `modules/ → notificationService` couplings.

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

## Phase 3: Import Rule Enforcement

### 3.1 Document Layer Rules

Add to `AGENTS.md` (or create `ARCHITECTURE.md`).

The real top-level peers under `src/` are: `ui/`, `state/`, `modules/`, `data/`, `integrations/`, `config/`, `logger/`, `utils/`, `events/`, `constants/`. Below, "primitives" means `logger/ + utils/ + events/ + constants/`.

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
- `bootstrap.ts` is the composition root: allowed to import everything. Other files under `integrations/` should still prefer importing through barrels, not reach across layers arbitrarily.
- `state/ → integrations/` is currently violated (see 2.7). Resolve before enabling the 3.2 guard.

### 3.2 (Optional) CI Guard

The hand-rolled grep script below only covers a subset of the 3.1 rules and will rot quickly. **Prefer [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) or knip** (knip is already a dev-dep in `deno.jsonc`) with a rule file derived from the 3.1 table.

If a stop-gap grep is still wanted:

```bash
#!/bin/sh
# Stop-gap only — prefer dependency-cruiser / knip. Run in CI or pre-commit.
fail=0
grep -rnE "from \"@/(ui|state|integrations)/" src/modules/ && fail=1
grep -rnE "from \"@/(ui|state|config|integrations|modules)/" src/data/ && fail=1
grep -rnE "from \"@/(integrations|modules)/" src/state/ && fail=1
exit $fail
```

## Known Pre-existing Issues (not caused by any refactor)

Don't fix these as a side-effect of other work; call them out in review instead:
- `src/modules/rag/retrieval/Retriever.ts`: references undefined `RecallCandidate` and `recallConfig`; calls `.toReversed()` on a Dexie `Collection` (method does not exist on that type).
- `src/modules/memory/Summarizer.ts`: uses `chat_metadata` where the ST context type is `chatMetadata`.
- Many sloppy imports across `src/` (imports without `.ts` suffix). Don't mass-rewrite; only fix lines you touch.

## Kept-for-Refactor Items (do not delete)

| Item | Status | Notes |
|---|---|---|
| Dev Log view | Keep | Types refactored (Phase 2.1 done) |
| BrainRecallCache | Keep (inactive) | Step removed from workflow, file stays |
| UserReview step | Keep | Used by SummaryWorkflow and EntityWorkflow |
| CharacterCleanup | Keep | Refactor per 2.6 |
| API Presets view | Keep | Large, refactor separately when touched |
| SyncService | Reference-only | File stays, all active wiring removed |
