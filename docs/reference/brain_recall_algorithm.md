# BrainRecallCache (BrainCell) Algorithm — Reference Document

> **Status:** REMOVED FROM HOT PATH (Phase 1.5)
>
> This algorithm is no longer executed during RAG retrieval. The file
> `src/modules/rag/retrieval/BrainRecallCache.ts` is kept intact for future
> review and possible re-integration.

---

## Overview

BrainRecallCache is a biologically-inspired memory decay and reinforcement
system. It sits between the retrieval layer (Vector + Keyword + Rerank) and the
injection layer. Instead of returning the top-K results directly, it maintains a
"short-term memory" pool that decays over rounds and reinforces items that are
recalled repeatedly.

---

## Core Concepts

### 1. Memory Slot

Each candidate that enters the cache becomes a `MemorySlot`:

| Field                     | Meaning                                  |
| ------------------------- | ---------------------------------------- |
| `id`                      | Event / Entity UUID                      |
| `label`                   | Human-readable name                      |
| `category`                | `"event"` or `"entity"`                  |
| `embeddingStrength`       | Base strength from vector/keyword score  |
| `rerankStrength`          | Strength from reranker (or heuristic)    |
| `finalScore`              | Sigmoid-normalized composite score (0–1) |
| `firstRound`              | Round when the slot was created          |
| `lastRound`               | Most recent round the slot was recalled  |
| `recallCount`             | Total times recalled                     |
| `consecutiveWorkingCount` | Streak of being in Working Memory        |
| `tier`                    | `"working"` or `"shortTerm"`             |

### 2. Round-Based Lifecycle

`nextRound()` is called at the start of every user turn.

```
Round N:
  1. Decay Bomb (optional)
  2. Reinforce recalled slots
  3. Decay non-recalled slots
  4. Add new candidates
  5. Evict bottom scorers (short-term limit)
  6. Select Working Memory
```

### 3. Decay Bomb

Triggered when the user switches context (overlap ratio drops below
`contextSwitchThreshold`). All existing strengths are multiplied by a decay
factor (e.g. 0.5 for rerank, 0.8 for embedding), effectively resetting old
memories when the conversation topic changes.

### 4. Reinforce

When a slot is recalled again:

```
gain = min(reinforceFactor * (1 - currentRerankStrength), maxDamping)
slot.rerankStrength += gain
```

This is a **bounded positive feedback loop** — popular memories get stronger,
but `maxDamping` prevents runaway growth.

### 5. Decay

When a slot is NOT recalled:

```
slot.embeddingStrength -= decayRate * 0.5
slot.rerankStrength     -= decayRate
```

Unpopular memories gradually fade.

### 6. Final Score (Sigmoid)

```
effective = max(clampedRerank, embeddingStrength * 0.8)
z = (effective - bias) / sigmoidTemperature
finalScore = 1 / (1 + exp(-z))
```

The sigmoid squashes the raw strength into a smooth 0–1 distribution.

### 7. Working Memory Selection

After decay/reinforcement, the cache selects the top items to actually inject
into the prompt:

1. **Newcomer Boost** — first-round items get a temporary `+newcomerBoost`
2. **Boredom Penalty** — items with `consecutiveWorkingCount > boredomThreshold`
   get a temporary `-boredomPenalty * (count - threshold)`
3. **Category Quotas** — events and entities have separate `eventWorkingLimit`
   and `entityWorkingLimit` pools (prevents one category from crowding out the
   other)
4. **Backfill** — if quotas don't fill the total `workingLimit`, the next best
   items from either category are added

---

## Integration Pattern (Historical)

```ts
// In RetrievalWorkflow.ts (old)
steps: [
    new KeywordRetrieveStep(),
    new VectorRetrieveStep(),
    new RerankMergeStep(),
    new BrainRecallStep(), // <-- removed in Phase 1.5
    new RecordRecallLogStep(),
];

// BrainRecallStep.execute() did:
brainRecallCache.setConfig(brainConfig);
brainRecallCache.nextRound();
const brainResults = brainRecallCache.process(candidates);
// rewrite candidate scores and produce recalledEntities
```

`MacroService.refreshEngramCache()` also used to read the cache snapshot to
auto-populate `{{engramSummaries}}` macros.

---

## Why It Was Removed

1. **Dead code in hot path** — The cache is never populated if the step is
   skipped, yet `Retriever.agenticSearch()` and `MacroService` still tried to
   read it, creating unreachable fallback branches.
2. **Complexity vs. payoff** — The algorithm adds significant statefulness
   (round tracking, decay, reinforcement) for a feature that was always disabled
   by default (`brainRecall.enabled: false`).
3. **Prompt budget pressure** — Working memory limits add another hard cap on
   already-scarce prompt space.

---

## How to Re-Enable

1. Restore `BrainRecallStep` to `RetrievalWorkflow.ts` steps array.
2. Restore `brainRecallCache` reads in `MacroService.refreshEngramCache()` and
   `refreshCacheWithNodes()`.
3. Restore `brainRecallCache` calls in `Retriever.agenticSearch()`.
4. Re-enable the `brainRecall` toggle in the recall config UI.

---

## Files Preserved

- `src/modules/rag/retrieval/BrainRecallCache.ts` — full implementation
- `src/modules/workflow/steps/rag/BrainRecallStep.ts` — workflow step wrapper
