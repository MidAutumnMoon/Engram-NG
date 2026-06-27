# AgenticSearch — Future Reintroduction Guide

> This folder contains the **reference copy** of the old `agenticSearch` path on
> `Retriever`. It was removed from `src/` because its only live caller (the
> production Injector path) was deleted earlier in the refactoring; the manual-test
> confirm flow in `RecallPanel.tsx` was the last consumer, and that has been
> simplified to reuse the standard retrieval result.

---

## What Agentic RAG was

A **third retrieval entry point** alongside keyword + vector. Instead of the
pipeline computing relevance, an upstream LLM ("judge") emits a list of
`AgenticRecall` decisions:

```ts
interface AgenticRecall {
    id: string;        // event short UUID, e.g. "evt_a1b2c3d4"
    score: number;     // LLM-assigned importance (0.0 - 1.0)
    reason: string;    // why the LLM picked it
}
```

`agenticSearch` then:

1. `db.events.bulkGet(ids)` — fetch the LLM-chosen events directly.
2. Build `ScoredEvent[]` with the LLM score on both tracks
   (`embeddingScore = rerankScore = score`) so downstream consumers see a
   consistent shape.
3. Run a **keyword entity scan** for entity recall only (events are already
   chosen; entities still need keyword surface so the "已唤醒实体" panel
   populates). The LLM's `reason` strings are fed as `unifiedQueries`.
4. Record a recall-log entry tagged `mode: "agentic"` (or `"hybrid"` in the
   manual-preview variant).
5. Return `{ candidates, entries, nodes, recalledEntities }`.

The intent was "skip the semantic-match stages; the LLM already knows which
events matter." It trades pipeline cost for one extra LLM call upstream.

---

## Why it was removed

1. **The production caller was deleted.** The Injector used to run a
   preprocessor that produced `AgenticRecall[]`; that preprocessor was removed
   earlier in the refactoring. The Injector now calls `retriever.search()`
   unconditionally.
2. **Only the manual-test confirm flow remained.** `RecallPanel.tsx` called
   `agenticSearch(newRecalls, { isManualTest: true, mode })` purely to
   re-assemble results after the user edited the preview modal's recall list.
   That is not a recall operation — it is a "fetch these IDs and assemble"
   operation, and it has been simplified to reuse the standard result.
3. **It shared ~30% code shape with `runRetrieval`** (recall-log recording,
   `getRecentContext`, `keywordRetrieve`-for-entities) but the core
   (`bulkGet` + LLM-score shaping) was unrelated. Living next to the hot path
   it read as a sibling retrieval strategy when it was really a different
   concern gated behind a feature that no longer existed.

---

## Reintroduction checklist

If Agentic RAG is wanted again:

### 1. Decide where the `AgenticRecall[]` comes from

The original design assumed a preprocessor step. Options:
- A dedicated LLM call in the Injector (before `retriever.search`).
- A lightweight heuristic over the user message + recent context.
- A separate prompt template under `config/types/prompt.ts`.

The retrieval layer should **not** own this — it should accept `AgenticRecall[]`
as input, same as before.

### 2. Resurrect the method

Restore `agenticSearch` from `AgenticSearch.ts` (this folder). It depends on:
- `tryGetDbForChat`, `getCurrentChatId` — unchanged.
- `keywordRetrieve` — unchanged signature; still used for entity-only recall.
- `useRecallLogStore` — the log DTO (`RecallResultItem`) is in-memory only,
  so the `mode: "agentic"` tag can be re-added without migration.
- `RecallConfig` — unchanged.

### 3. Give it a real home

Consider extracting it into its own module (`AgenticRetriever.ts` or
`retrieval/agentic.ts`) rather than re-inlining into `Retriever.ts`. It is a
different entry point, not a branch of `search()`. The standard retrieval
pipeline (`keywordRetrieve` / `vectorRetrieve` / `mergeAndRerank`) is shared
infrastructure; agentic is a caller of the keyword stage, not a peer stage.

### 4. Re-add the recall-log `mode` value

`recallLog.ts`'s `RecallLogEntry.mode` union is `"embedding" | "hybrid" | "agentic"`.
The `"agentic"` value is currently unused but still in the type — re-adding the
caller is enough; no schema change needed. The RecallLog UI already branches on
`entry.mode === "agentic"`.

### 5. Wire a UI surface

The `RecallPanel` preview button had an `isAgenticMode` branch. If the preview
flow is wanted again, restore that branch; otherwise the production path
(Injector → `agenticSearch`) is enough.

---

## Files in this folder

| File | Description |
|------|-------------|
| `AgenticSearch.ts` | Last known source snapshot of `agenticSearch` + its `AgenticRecall` dependency. |

---

## Snapshot provenance

Captured from `src/domain/rag/retrieval/Retriever.ts` immediately before
removal. Imports use the `@/` alias as they did in source; types
(`EventNode`, `RecalledEntity`, `ScoredEvent`, `AgenticRecall`, `RecallConfig`)
resolve to their current locations.
