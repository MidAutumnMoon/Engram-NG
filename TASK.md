# Structural Cleanup — TASK.md

## Diagnosis

The codebase has a **bidirectional circular dependency** between `modules/` (domain logic) and `sillytavern/` (host layer). Each imports from the other. Neither is "below" the other, so every refactor risks touching both.

Naming note: throughout this doc, the target name for the domain-logic directory is `domain/` (renamed from `modules/`).

Specific tangles:

1. **`sillytavern/` is two layers sharing one directory** — thin host wrappers (`context.ts`, `chat/Message.ts`, `prompt/ejsProcessor.ts`) live alongside full domain features (`prompt/macros.ts` 540L, `worldbook/` 8 files ~2,500L, `ReviewBridge.ts`).
2. **Entry point is a fragile procedural script** — `src/index.ts` (160L) manually wires 10+ services with ordering dependencies and try/catch blocks. No lifecycle abstraction.
3. **`modules/` is a junk-drawer name** — contains three unrelated subsystems (memory, rag, workflow).
4. **Workflow steps are coupled to the host** — all 14 step files in `modules/workflow/steps/` import from `@/sillytavern/` directly instead of receiving host services as parameters.

---

## Plan

### Phase 1 — Relocate: put things where they belong

No dependency direction changes. Just move files so the existing tangle is honest about itself.

#### 1a. Move `sillytavern/worldbook/` → `domain/worldbook/`

It's domain logic (world book entry management, metrics, scanning) that happens to call ST's world book API. The domain already imports from ST anyway — this just stops pretending worldbook is a host concern.

- `sillytavern/worldbook/adapter.ts`
- `sillytavern/worldbook/crud.ts`
- `sillytavern/worldbook/engram.ts`
- `sillytavern/worldbook/index.ts`
- `sillytavern/worldbook/metrics.ts`
- `sillytavern/worldbook/scanner.ts`
- `sillytavern/worldbook/slot.ts`
- `sillytavern/worldbook/types.ts`

Update all `@/sillytavern/worldbook/` imports to `@/domain/worldbook/`.

#### 1b. Move `sillytavern/prompt/macros.ts` → `domain/macros/`

540-line domain feature. Not a thin ST wrapper.

#### 1c. Move `sillytavern/ReviewBridge.ts` → `domain/review/`

Domain service for review workflow. Not a host wrapper.

#### 1d. Move `data/cleanup/CharacterCleanup.ts` → `domain/cleanup/`

Domain logic (reacts to character deletion by cleaning up DB). Not a data layer concern.

#### 1e. Rename `modules/` → `domain/`

`modules/` is meaningless. `domain/` signals "all business logic lives here, zero host imports." Self-enforcing when adding new files.

(Chose `domain/` over `core/` because `core/` is ambiguous — could mean "infrastructure everything depends on" — and would risk becoming a junk drawer again. DDD baggage with `domain/` is acceptable since the team isn't using strict DDD patterns.)

---

### Phase 2 — Entry point: condense, don't abstract

No new class or lifecycle framework. The composition root stays procedural; just shrink the noise.

#### 2a. Add a `tryInit` helper

```ts
async function tryInit(name: string, fn: () => Promise<void> | void): Promise<boolean> {
    try { await fn(); return true; }
    catch (e) { Logger.warn(name, "init failed", { error: String(e) }); return false; }
}
```

Single file, 5 lines, no new abstraction. Registered nowhere.

#### 2b. Rewrite `src/index.ts` to use it

Drops from ~160 lines to ~30. The 10 try/catch blocks become one-liners.

---

### Phase 3 — Decouple: break the circular dependency

#### 3a. Inject host services into workflow steps via `JobContext`

Currently:
```ts
// FetchContext.ts
import { getSTContext, MacroService } from "@/sillytavern";
```

Target:
```ts
// FetchContext.ts — receives host services from context
context.host.getSTContext();
context.host.macroService;
```

Workflow steps become pure and testable. The `WorkflowEngine` or workflow definition injects the host adapter.

#### 3b. Resolve `sillytavern/chat/chatHistory.ts` → `@/domain/` import

`chatHistory.ts` imports `regexProcessor` from `domain/workflow/steps/`. This is the only `sillytavern/` → `domain/` import. Options:
- Accept regex processor as a parameter
- Move the chat-history-cleaning logic into a workflow step

---

## Open Questions

- [ ] Phase 1 then Phase 2 then Phase 3? Or Phase 1+2 together (low-risk) then Phase 3 separately (touches workflow internals)?
