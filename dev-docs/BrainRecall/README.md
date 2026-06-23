# BrainRecall — Reference Archive

> This folder contains the **reference copy** of the BrainRecall cache and its
> workflow step. They were moved out of `src/` because the feature is no longer
> on the retrieval hot path (`RetrievalWorkflow.ts`), and the dead modules were
> otherwise referenced by nothing else in `src/`.

---

## Why it was removed from the hot path

`BrainRecallStep` implemented a brain-inspired memory model: a short-term
memory pool, a working-memory window, reinforcement on re-recall, decay,
"decay bombs" on context switch, and a fill-first / capacity-based eviction
strategy. It sat between `RerankMergeStep` and `RecordRecallLogStep` in the
`RetrievalWorkflow`, re-scoring candidates with a Sigmoid-based `finalScore`
and managing entity/event working-memory quotas.

The step was removed from the workflow; `RetrievalWorkflow` now goes
`KeywordRetrieveStep → VectorRetrieveStep → RerankMergeStep → RecordRecallLogStep`.
The algorithm was preserved here for future review rather than deleted.

## Files in this folder

| File | Description |
|------|-------------|
| `BrainRecallCache.ts` | The cache class + `brainRecallCache` singleton. Last source snapshot from `src/domain/rag/retrieval/`. |
| `BrainRecallStep.ts` | The workflow step that drove the cache. Last source snapshot from `src/domain/workflow/steps/rag/`. |

These are **reference-only**. They are not part of the build (`dev-docs/` is
excluded from compilation), and their `@/`-aliased imports are intentionally
left dangling — they point at where the dependencies used to live.

## Reintroduction notes

If BrainRecall is revived:

1. **Home:** restore under the current RAG domain layout, e.g.
   `src/domain/rag/retrieval/BrainRecallCache.ts` and
   `src/domain/workflow/steps/rag/BrainRecallStep.ts`.
2. **Config:** the Zod schema lived in `src/config/types/rag.ts` as
   `brainRecallConfigSchema` / `BrainRecallConfig` / `DEFAULT_BRAIN_RECALL_CONFIG`.
   It was removed in a follow-up cleanup; restore it there and decide whether
   to re-wire it into `recallConfigSchema` (it was previously detached, not
   nested under `recallConfig`).
3. **Logging:** `LogModule.RAG_CACHE` and `LogModule.BRAIN_RECALL_CACHE`
   (in `src/logger/LogModule.ts`) and their `MODULE_META` entries in
   `ui/views/dev-log/moduleMeta.ts` were removed in the same follow-up;
   re-add both the enum members and the meta rows.
4. **Wiring:** re-insert `new BrainRecallStep()` into `createRetrievalWorkflow()`
   in `src/domain/workflow/definitions/RetrievalWorkflow.ts` (the insertion
   point is marked with a `REFERENCE:` comment).
5. **Tests:** the old lifecycle/workflow tests in `dev-docs/test/integration/`
   (`retrieval-lifecycle.test.ts`, `retrieval-workflow.test.ts`) reference
   `brainRecallCache` and `recallConfig.brainRecall`. They are broken post-fork
   and will need path/config fixes before they can validate a reintroduction.
