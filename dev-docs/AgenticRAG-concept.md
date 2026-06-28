# Agentic RAG (concept backup)

> Status: **removed**. This doc preserves the concept and rationale so it can be
> revisited once the retrieval/injection refactoring settles. The consumer-side
> code snapshot (`agenticSearch` fetch-by-ID logic) lived at
> `dev-docs/AgenticSearch/` before this doc replaced it; that snapshot is in git
> history if ever needed. The **producer** side (the LLM judge prompt that
> emitted `AgenticRecall[]`) was never captured in the repo — that is the gap
> to fill if reviving.

## The concept

Agentic RAG was a third retrieval strategy alongside keyword and vector recall.
Instead of the retrieval pipeline computing relevance, an **upstream LLM
"judge"** — already holding conversational context — directly named the event
IDs it deemed relevant, each with a score and a natural-language reason. The
retrieval layer then `bulkGet`-ed those IDs and shaped them into the standard
`ScoredEvent[]` result, **skipping keyword surface matching, embedding
similarity, and reranking entirely**. The trade: one extra LLM call upstream in
exchange for skipping the whole retrieval pipeline's compute.

In short: relocate the *relevance decision* out of the retrieval pipeline and
into an LLM, turning retrieval into a fetch-and-shape step rather than a search.

## The three strategies contrasted

| Strategy | Where the relevance decision lives | Cost |
|---|---|---|
| Keyword | Regex/alias surface match against scan text | 0 tokens |
| Vector | Embedding similarity (+ optional rerank) | embedding + rerank tokens |
| Agentic | An LLM that already saw the conversation | one LLM call |

Keyword and vector both *search* the events table for candidates. Agentic
*fetches* pre-decided IDs. The difference is not just an optimization — it's a
different locus of judgment.

## The human-in-the-loop UX

A review modal (`RecallDecisionModal`) let the user veto, re-score, or
supplement the LLM's picks. Each pick carried the LLM's stated `reason`, shown
beneath the event summary, so the user could see *why* the LLM chose it before
accepting or rejecting. The user could also manually add events the LLM missed,
with their own score. This was a human-in-the-loop veto/refinement layer over
the LLM judge — a reusable pattern independent of the agentic producer.

## The data contract

```ts
interface AgenticRecall {
    id: string;       // event short UUID (e.g. evt_a1b2c3d4)
    score: number;    // LLM-assigned relevance, 0.0-1.0
    reason: string;   // LLM's natural-language justification
}
```

This is the LLM-output DTO. The retrieval consumer duplicated `score` onto both
`embeddingScore` and `rerankScore` of the shaped `ScoredEvent` so downstream
consumers saw a consistent shape.

## Why it was removed

1. **The producer was deleted.** The production caller — an Injector
   preprocessor that produced `AgenticRecall[]` from the conversation — was
   removed during an early refactor. The Injector now calls `retriever.search()`
   unconditionally.
2. **Only a manual-test shell remained.** The `useAgenticRAG` config flag and
   the `RecallDecisionModal` UI survived, but with no producer, the agentic
   path in the test panel just warned "preprocessor removed" and returned.
3. **The test flow that *did* use the modal was repurposed.** The hybrid/vector
   preview test fabricated `AgenticRecall[]` from `retriever.search()` candidates
   (`pseudoRecalls`) so the review modal had something to render — making the
   modal a generic "review retrieved candidates" surface wearing an agentic
   name. The agentic concept was retired, but the modal's data contract
   survived under the `AgenticRecall` type.

The concept was retired rather than maintained as a strategy with no producer.

## What survived the removal

- **`RecallDecisionModal`** — kept as the hybrid-preview result-review surface,
  retyped to `RecallPreviewItem` (same shape as `AgenticRecall`, neutral name).
- **The review-modal UX pattern** — veto/re-score/supplement retrieved
  candidates — is reusable for any recall strategy, not just agentic.
- **The `"agentic"` recall-log mode** was removed from the union (no producer).
  Reintroducing agentic would re-add it.

## Reintroduction notes

If reviving:

1. **The producer must live upstream of retrieval.** The retrieval layer should
   *accept* `AgenticRecall[]` (or equivalent) as input, not produce it. The
   original design had an Injector preprocessor emit the decisions; that's the
   right locus — an LLM that already has the conversation.
2. **The LLM judge prompt is the missing piece.** It was never captured in the
   repo. Designing it is the real work of revival — it must output stable event
   IDs (so `bulkGet` resolves them), calibrated scores, and honest reasons.
3. **The consumer is cheap to rebuild.** Fetch-by-ID + shape-as-ScoredEvent +
   entity-only keyword fallback is ~50 lines. The git history at
   `dev-docs/AgenticSearch/AgenticSearch.ts` has a reference implementation.
4. **Don't couple the review modal to the agentic type.** The
   `RecallPreviewItem` retype (done during removal) is the right shape for any
   "review retrieved candidates with scores + reasons" surface. A revived
   agentic producer would feed `RecallPreviewItem[]` to the existing modal
   without needing its own type.

## Pointers

- Consumer-side reference implementation: git history, `dev-docs/AgenticSearch/AgenticSearch.ts` (deleted in the same commit that added this doc).
- Review modal: `src/ui/overlays/review/RecallDecisionModal.tsx` (retyped to `RecallPreviewItem`).
- Hybrid-preview bridge that reused the modal: `src/ui/views/processing/RecallPanel.tsx` `pseudoRecalls`.
- Config flag that was removed: `RecallConfig.useAgenticRAG` (was in `src/config/types/rag.ts`).
