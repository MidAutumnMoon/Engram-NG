# Engram Task

## UI Topology + Hierarchy Refactor

`engram:navigate` (a `window` `CustomEvent`) and `EventBus.UI_NAVIGATE_REQUEST` are two side-channels carrying one concept ("switch active tab"), both feeding the same `handleNavigate` in `src/App.tsx`. `QuickPanel` even wraps its dispatch in `setTimeout(0)` to win a mount race.

Root cause: Engram renders **two sibling React roots** on `document.body` — `GlobalOverlay` (eager) and `App` (lazy). Once siblings, they can't share state, so any cross-root signal is forced to escape React's tree. The filesystem hides this: `App.tsx` sits at `src/` root and looks like the entry, but is a lazy leaf reached only through `createRoot` buried in `sillytavern/ui/ui.tsx`.

**Fix:** merge to one React root and regroup so the filesystem reflects the design. The navigation side-channels stop being needed.

### Target tree

```
src/
├── bootstrap.ts                        (rewired)
├── sillytavern/ui/
│   ├── buttons.ts                      (DOM injection — was part of ui.tsx)
│   └── mount.ts                        (single createRoot — was part of ui.tsx)
└── ui/root/
    ├── EngramRoot.tsx                  (always-mounted: Review + Quick + lazy Panel)
    └── PanelRoot.tsx                   (was App.tsx: MainLayout + view switching)
```

### Phases

**T1 — Expand `uiStore`** (additive, non-breaking)

`src/state/uiStore.ts`:
- State: `panelOpen: boolean`, `activeTab: string`.
- Actions: `openPanel()`, `closePanel()`, `togglePanel()`, `navigate(path)` (also persists via `SettingsManager.set("lastOpenedTab", ...)`).
- `activeTab` initializes to `"dashboard"`. A one-time `hydrateFromSettings()` is called from bootstrap after `SettingsManager.initSettings()` to load the persisted tab. This avoids a load-order coupling: without it, reading `SettingsManager` at store creation would make the `uiStore` module unsafe to import before bootstrap runs `initSettings()`.

- [x] Add the above to `useUiStore`.

**T2 — Create new root files** (not wired yet, non-breaking)

- [x] `src/ui/root/PanelRoot.tsx`: relocate `src/App.tsx` contents. **Keep `export default`** (`React.lazy` requires it). Drop `useState(activeTab)` and the entire 30-line `useEffect` (both subscriptions, both `engram:navigate` listeners). Read `activeTab` from `useUiStore`. `PanelRoot` itself takes no props (it's the root), but still passes `closePanel` from the store down to `MainLayout` as its `onClose` prop — `Header.tsx:45` calls that prop directly on click, and Risk #4 forbids touching `MainLayout`/`Header`.
- [x] `src/ui/root/EngramRoot.tsx`: new. Always renders `<ReviewContainer/>` and `<QuickPanel/>`. Conditionally renders `{panelOpen && <Suspense fallback={null}><LazyPanel/></Suspense>}` where `LazyPanel = React.lazy(() => import("@/ui/root/PanelRoot.tsx"))`. The lazy boundary only defers *module evaluation* (view modules don't run until first open) — `vite.config.ts` sets `codeSplitting: false`, so there's no separate chunk.

**T3 — Split the host layer**

- [ ] `src/sillytavern/ui/buttons.ts`: extract `createTopBarButton`, `initQuickPanelButton`, `removeQuickPanelButton`, `handleQuickPanelClick`. Drawer click → `togglePanel()`; send-form click → `openQuickPanel()` (unchanged).
- [ ] `src/sillytavern/ui/mount.ts`: new `mountEngram()` — single `createRoot(...).render(<EngramRoot/>)` on `#engram-root`. Delete `globalRoot`, `panelVisible`, `panelElement`, `reactRoot`, `openMainPanel`, `closeMainPanel`, `createMainPanel`, `mountGlobalOverlay`, `toggleMainPanel`.
- [ ] Delete `src/sillytavern/ui/ui.tsx`.

**T4 — Rewire callers**

- [ ] `src/bootstrap.ts`: import from `buttons.ts` + `mount.ts`. Replace `await mountGlobalOverlay()` with `await mountEngram()`. Call `useUiStore.getState().hydrateFromSettings()` after `SettingsManager.initSettings()`.
- [ ] `src/ui/panels/QuickPanel.tsx`: replace the dynamic-import-and-`dispatchEvent` dance with `useUiStore.getState().navigate(path); openPanel(); onClose()`. Delete the `setTimeout(0)` and the `engram:navigate` dispatch.
- [ ] `src/ui/services/NotificationService.ts` (`navigate` method, ~line 192): replace `EventBus.emit({ type: "UI_NAVIGATE_REQUEST", ... })` with `useUiStore.getState().navigate(path)`.

**T5 — Cleanup**

- [ ] Delete `src/App.tsx`.
- [ ] Delete `src/ui/overlay/GlobalOverlay.tsx` and the now-empty `src/ui/overlay/` directory.
- [ ] Remove `"UI_NAVIGATE_REQUEST"` from `EngramEventType` in `src/events/index.ts`.
- [ ] Grep-verify zero remaining references to: `engram:navigate`, `UI_NAVIGATE_REQUEST`, `mountGlobalOverlay`, `toggleMainPanel`, `openMainPanel`, `closeMainPanel`, `createMainPanel`, `GlobalOverlay`, `from "@/App"`.

**T6 — Validate**

- [ ] `deno task build` passes (source of truth per `AGENTS.md`).
- [ ] Tests are known-broken post-fork — not run.

### Risks

1. **Lazy boundary integrity.** `PanelRoot` must be the *only* thing behind `React.lazy`, or the view modules get evaluated at bootstrap (when `EngramRoot` renders). Direct `@/ui/views` imports in `src/ui/panels/**/*.tsx` are already confirmed clean (zero matches). Only *transitive* imports through `ReviewContainer`/`QuickPanel` need a quick check before merging.
2. **Dead DOM in old `createMainPanel`** (`src/sillytavern/ui/ui.tsx:255–295`). Imperatively builds a header + content skeleton, then `createRoot(panel).render(<App/>)` renders into the same node — `MainLayout` renders its own header over the imperative one. Likely dead code or latent bug. Confirm by deletion + successful build.
3. **Scope discipline.** Do *not* touch `MainLayout`, `Sidebar`, `Header`, or any view. The shell below the root is fine. Only the layer above `App` and the two cross-root callers change.

---

Older decoupling work (Phases 2.2/2.4, 2.3, 2.6, 2.7, Phase 3) and known pre-existing issues live in [`dev-docs/refactoring-backlog.md`](./dev-docs/refactoring-backlog.md).
