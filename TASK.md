# UI Hierarchy Refactor Tasks

> Reviewed: `src/ui/` — the folder taxonomy is mostly fine, but several abstraction layers create invisible coupling and bury simple logic deep in files that are hard to trace.
> Tackle these chunk by chunk. Do not attempt everything in one pass.

---

## 1. Kill the Portal Tab Pattern (`LayoutTabs` → `TabPills`)

**Problem:** `LayoutTabs` uses `createPortal` to teleport the tab bar into `#engram-header-extension` inside `MainLayout`. The DOM tree and React tree diverge, making debugging hard. Every view implicitly couples itself to `MainLayout`'s internal slot. The `actions` prop-blast (e.g. `MemoryStream` passing a 15-prop `ActionBar`) inflates view files.

**Files involved:**
- `src/ui/components/layout/LayoutTabs.tsx`
- `src/ui/components/layout/TabPills.tsx`
- `src/ui/shell/MainLayout.tsx`
- `src/ui/views/memory-stream/index.tsx`
- `src/ui/views/processing/ProcessingView.tsx`
- `src/ui/views/api-presets/APIPresetsView.tsx`
- `src/ui/views/settings/index.tsx`

**Options:**
- [ ] **Option A:** Render `TabPills` inline at the top of each view (it's already sticky via CSS). Remove `LayoutTabs` entirely.
- [ ] **Option B:** Make `MainLayout` accept an optional `headerSlot: ReactNode` prop so the relationship is explicit and type-safe.
- [ ] **Option C:** Keep portal but simplify — remove `LayoutTabs` wrapper and let views portal `TabPills` themselves if they really need it.

**Recommended:** Option A — delete `LayoutTabs.tsx`, render `TabPills` directly in views.

---

## 2. Break Up God Hooks

### 2.1 `useMemoryStream`
**Problem:** ~400+ lines owning data fetching, UI state, mobile detection, dirty tracking, modal state, and async ops all at once. `MemoryStream` becomes a thin wrapper that just destructures and passes props.

**Files involved:**
- `src/ui/views/memory-stream/hooks/useMemoryStream.ts`
- `src/ui/views/memory-stream/index.tsx`

**Tasks:**
- [ ] Extract `useMemoryData()` — fetch events/entities, filtering, grouping, sorting.
- [ ] Extract `useMemorySelection()` — selectedId, checkedIds, check/uncheck logic.
- [ ] Extract `useMemoryEditing()` — pendingChanges, pendingEntityChanges, dirty tracking, batch save.
- [ ] Move mobile resize listener out — reuse `useResponsive` from `src/ui/hooks/useResponsive.ts` instead of duplicating it inside the hook.
- [ ] Keep modal state (preview, import) in the component if it's only used there, or extract to a small `useMemoryModals()` if shared.

### 2.2 `useDashboardData`
**Problem:** Not as bloated as `useMemoryStream`, but mixes integration calls (MacroService, summarizerService, brainRecallCache) with UI polling logic.

**Files involved:**
- `src/ui/hooks/useDashboardData.ts`

**Tasks:**
- [ ] Consider splitting data sources into smaller hooks if any view only needs a subset (e.g. `useSystemHealth()`, `useMemoryStats()`).
- [ ] Or keep as-is if Dashboard is the only consumer — it's acceptable for now.

---

## 3. Shrink `APIPresetsView.tsx` (697-line monster)

**Problem:** Manually orchestrates 4 sub-tabs (model, prompt, regex, worldbook), each with editing state, nested subtabs, and mobile form visibility. Adding a new preset type means editing this one file.

**Files involved:**
- `src/ui/views/api-presets/APIPresetsView.tsx`

**Tasks:**
- [ ] Extract each preset domain into its own container hook or mini-store:
  - `useModelPresets()`
  - `usePromptPresets()`
  - `useRegexPresets()`
  - `useWorldbookPresets()`
- [ ] Let `APIPresetsView` only know which tab is active and render the correct sub-view.
- [ ] Move mobile form state (editingPreset, editingTemplate, etc.) down into the sub-views that actually need it.

---

## 4. Flatten View Internal Folder Proliferation

**Problem:** `memory-stream/` has `components/`, `hooks/`, `modals/`, `sections/`, `utils/` — 5 subdirectories for one screen. Deep nesting makes scanning harder.

**Affected views:**
- `src/ui/views/memory-stream/`
- `src/ui/views/api-presets/`
- `src/ui/views/settings/`
- `src/ui/views/processing/`
- `src/ui/views/dashboard/`

**Tasks:**
- [ ] Flatten `memory-stream/` into a single directory with descriptive file names:
  ```
  MemoryStream.tsx
  useMemoryStream.ts
  EventEditor.tsx
  EntityEditor.tsx
  ActionBar.tsx
  EventList.tsx
  EntityList.tsx
  ImportModal.tsx
  PreviewModal.tsx
  streamProcessors.ts
  ```
- [ ] Do the same for other views if they have deep nesting (e.g. `api-presets/models/`, `api-presets/prompts/`, etc.).
- [ ] Keep shared components in `src/ui/components/`; only flatten view-local files.

---

## 5. Move `services/` Out of `ui/`

**Problem:** `NotificationService.ts` wraps `window.toastr` (a global integration). `ThemeManager.ts` touches global state. Neither is a UI concern. They make the UI layer feel fatter than it is.

**Files involved:**
- `src/ui/services/NotificationService.ts`
- `src/ui/services/ThemeManager.ts`

**Tasks:**
- [ ] Move `NotificationService.ts` to `src/core/services/` or `src/integrations/tavern/` (it wraps a SillyTavern global).
- [ ] Move `ThemeManager.ts` to `src/core/` or `src/state/` depending on what it actually does.
- [ ] Update all imports across the codebase.
- [ ] Delete `src/ui/services/` directory once empty.

---

## 6. Fix or Remove `MasterDetailLayout`'s Dead Mobile Props

**Problem:** `MasterDetailLayout` accepts `mobileDetailOpen`, `onMobileDetailClose`, `mobileDetailTitle`, `mobileDetailActions`, but `MemoryStream` ignores them and manually returns `MobileFullscreenForm` at the top level.

**Files involved:**
- `src/ui/components/layout/MasterDetailLayout.tsx`
- `src/ui/views/memory-stream/index.tsx`

**Tasks:**
- [ ] Decide: either make `MemoryStream` actually use `MasterDetailLayout`'s mobile props, or remove those props from `MasterDetailLayout`.
- [ ] If removing, `MasterDetailLayout` becomes a simpler pure desktop split-pane component.
- [ ] If keeping, refactor `MemoryStream` so the mobile edit view is rendered through `MasterDetailLayout` instead of an early return.

---

## 7. Replace `FormComponents.tsx` Inline Styles

**Problem:** A 500-line file re-implementing `<input>`, `<select>`, `<textarea>` with manual `style={{ border, borderRadius, boxShadow, ... }}` objects, despite using Tailwind everywhere else.

**Files involved:**
- `src/ui/components/form/FormComponents.tsx`

**Tasks:**
- [ ] Audit where `FormComponents` are used.
- [ ] Replace with Tailwind classes or shadcn-style utility classes.
- [ ] If custom styling is truly needed, use a CSS variable layer or a Tailwind plugin instead of inline style objects.
- [ ] Consider deleting `FormComponents.tsx` entirely if it's only used in a few places and those can be inlined.

---

## 8. Audit `components/layout/` for Over-Abstraction

**Files involved:**
- `src/ui/components/layout/Divider.tsx` — one-line wrapper around `<hr>`
- `src/ui/components/layout/QuickLinks.tsx` — small but check if used in more than one view
- `src/ui/components/layout/MobileFullscreenForm.tsx` — used, but check if it can be simplified

**Tasks:**
- [ ] Evaluate if `Divider`, `QuickLinks`, etc. are pulling their weight or if they can be inlined.
- [ ] Keep `MasterDetailLayout` and `TabPills` as they are useful primitives.
- [ ] Delete anything that's just a styled wrapper with no behavior.

---

## 9. Misc Cleanup

- [ ] `src/ui/hooks/index.ts` barrel file — decide if you want to keep barrel files (project rule says explicit extensions, but `index.ts` barrels are allowed). If keeping, make sure it doesn't re-export from hooks that have been moved/deleted.
- [ ] `src/ui/components/feedback/index.ts` — same as above.
- [ ] `src/ui/styles/GlobalStyles.tsx` — currently only sets scrollbar styles and font. Consider moving scrollbar CSS to `main.css` and deleting this component.

---

## Suggested Order (Do Not Do All At Once)

1. **Start with #1** (kill portal tabs) — it's the most invisible coupling and touches many files.
2. **Then #5** (move services) — pure file moves, easy win.
3. **Then #4** (flatten view folders) — mechanical, improves scanability.
4. **Then #2** (break up god hooks) — requires understanding the data flow.
5. **Then #3** (shrink APIPresetsView) — similar to #2 but for a different view.
6. **Then #6, #7, #8** as needed.
