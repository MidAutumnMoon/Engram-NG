# Entity ↔ Summary Sync Problem

## The Problem

Engram maintains two independent memory stores with different mutation semantics:

- **Entity** (`EntityNode`): mutable current-state. `knight.state: "wounded"` gets *overwritten* to `"healed"`.
- **Summary/Event** (`EventNode`): append-only log. "knight stabbed" stays forever; "knight healed" is *appended*.

Two separate pipelines drive them on independent timers with independent chat-range windows:

- **SummaryWorkflow**: `FetchContext → BuildPrompt(summary) → Llm → SaveEvent` — writes `EventNode`s only.
- **EntityWorkflow**: `FetchContext → FetchExistingEntities → BuildPrompt(entity_extraction) → Llm → SaveEntity` — writes `EntityNode`s only, via JSON-Patch on existing `profile`.

Worse: the entity extractor reads to the latest message, but the summarizer does not (it's windowed with a buffer). So at any moment T:

- entity state reflects ground truth up to message N (latest)
- timeline reflects ground truth up to message M (M < N)
- raw chat covers [M, N]

The model is asked to reconcile "entity says healed / timeline says stabbed" using the [M, N] chat window. That works *sometimes* — the "might" problem.

## The Structural Diagnosis

This is not a timing bug. The two stores are **structurally incapable of being in sync** because there is no shared coordinate between them.

Key facts from `src/data/types/graph.ts`:

- `EventNode.structured_kv.role: string[]` and `.location: string[]` are **bare strings**, not entity references.
- `EntityNode.profile` is open JSON with **no provenance** — no `last_changed_by_event`, no history.
- Zero links between the two tables in either direction.
- The only shared axis is `source_range` (message indices), and neither side reads the other's.
- When `SaveEntity` applies a patch flipping `knight.state: wounded → healed`, it records the diff for the UI diff-log but **discards it** — the establishing event is never linked, and the old "wounded" value is just overwritten.

So: entity store is a mutable current-state projection with no history; event store is an append-only log with no entity links. In CQRS/event-sourcing terms, this is the **dual-write anti-pattern** — two projections of the same underlying reality, updated by independent pipelines.

The "2D" framing (entity = state axis, summary = time axis) is correct and matches both cognitive science and leading production systems. The split isn't the problem — **the missing link between the two dimensions** is.

## Prior Art: Graphiti / Zep

The closest production analog. Same dual-store design, framed in cognitive-science terms: **episodic memory** (events) vs **semantic memory** (entities/facts). Paper: [arXiv:2501.13956](https://arxiv.org/html/2501.13956) ("Zep: A Temporal Knowledge Graph Architecture for Agent Memory").

Three things make *their* split work where Engram's doesn't:

1. **Episodic edges.** Every entity/fact traces back to the episode that produced it (`G_e ⊆ N_e × N_s`). This is the link Engram is missing entirely. When "knight: healed" is asserted, Graphiti records *which episode asserted it*.

2. **Bi-temporal validity on facts, not node mutation.** Facts live as edges with `(t_valid, t_invalid)`. "knight wounded" doesn't get overwritten by "knight healed" — the old edge gets `t_invalid` set, a new edge with `t_valid` is created. Full history "wounded during [ep10–ep25], healed at ep26" is queryable. Engram just does `profile.state = "healed"` and the wound is gone.

3. **Incremental resolution, not batched.** Entities are extracted from each new episode and resolved against existing nodes immediately — no separate timer, no window drift.

**Core insight that maps to this problem:** the episode is the source of truth; entity state is a materialized view with provenance and validity. Engram currently maintains both as independent primaries.

What is *not* portable: Neo4j + bi-temporal indexing + bidirectional graph traversal is overkill for a single-conversation browser extension on Dexie/IndexedDB. The *principles* (provenance, validity intervals, derived state) are portable with small schema changes.

## Plan (phased by cost)

### Phase 1 — Provenance links (schema-only, no pipeline change)

Cheapest fix for the structural gap; prerequisite for everything else.

- `EventNode`: add `entity_refs?: string[]` (resolved entity IDs mentioned/affected by this event).
- `EntityNode`: add `state_provenance?: { field: string; event_id: string; valid_from_index: number; valid_to_index?: number }[]`.

Both fields optional → backward compatible. Partial population still unlocks Phase 2.

**Open question to resolve:** can the existing two LLM call prompts cheaply populate these fields as part of their current output (i.e. Phase 1 = "schema + prompt tweak"), or does it need a separate resolution pass? Determines whether Phase 1 is small or medium.

### Phase 2 — Injection-time reconciliation (the "might → reliably" fix)

With provenance, injection becomes sync-aware instead of "dump both and hope." At `FetchContext` time:

1. Compute the **summarized frontier** (max `source_range.end_index` across non-archived events) — where the timeline's authority ends.
2. For each entity state field, check `state_provenance.valid_from_index`:
   - `<= summarized frontier`: timeline should contain this state's establishing event. Consistent — inject normally.
   - `> summarized frontier`: **entity is ahead of the timeline.** Inject the establishing event (or its `summary` text) as a `<recent_state_change>` block, *or* annotate the entity block with "(as of msg N, not yet in timeline)".

Turns "model might pick it up from context" into "model is explicitly told." No new LLM calls, no pipeline merge — just smarter injection using data that would already be extracted.

The "knight healed" case: entity says healed, provenance points to event from msg 26, timeline only covers through msg 20 → inject the healing event as a recent change note. Model sees `<character_state>knight: healed</character_state>` AND `<recent_change>at [tavern], knight's wounds were healed (msg 26)</recent_change>` instead of a contradictory timeline saying "stabbed."

### Phase 3 — Derive entity state from events (the principled fix, optional)

Stop having the entity extractor write state directly. State changes emit events; entity state becomes a fold over events up to a point. "Event sourcing lite" — what Graphiti effectively does.

Practical version: when `SaveEntity` applies a patch that changes a state-like field (heuristic: `profile.state`, `profile.status`, configurable "state fields" list), it *also* writes a minimal `EventNode` with `level: 0`, same `source_range`, `entity_refs` pointing at the entity, and the change as the `summary`. Timeline *cannot* lag entities — the state change is itself a timeline entry.

Cost: more events (need salience filtering — don't want "knight sat down" as an event). Already have `significance_score` and `level` for this; only state changes above a threshold emit. Likely merges entity+state-change into a single LLM call's output rather than two calls, which *saves* tokens vs the current two-call setup.

### What not to do

- **Don't merge entity extraction and summarization into one LLM call naively.** Different optimal prompt structures, different cadences (entities fine-grained, summaries coarse). Merging doubles the merged call's token cost and loses independent execution. Graphiti extracts entities per-episode but generates community summaries in a separate batched pass — same principle. Keep them split; add the *links*.
- **Don't add a graph DB.** Bidirectional traversal is overkill for single-conversation memory. Provenance arrays + IndexedDB indexes suffice for "which events mention this entity" and "which entity did this event affect."

## Read (cost estimate & recommendation)

Phase 1 + Phase 2 is ~a day of work and fixes the practical symptom. Phase 3 is the principled fix but is a larger refactor; only worth it if entity extractor and summarizer are observed fighting each other in practice.

Suggested next step: resolve the Phase 1 open question (can existing prompts populate the provenance fields cheaply?) by reading `BuildPrompt` for both categories and the prompt templates. That determines the actual scope of Phase 1.

## Key Code Locations

- Schema: `src/data/types/graph.ts` — `EventNode`, `EntityNode`, `ScopeState`
- Summarizer pipeline: `src/domain/memory/Summarizer.ts`, `src/domain/workflow/definitions/SummaryWorkflow.ts`
- Entity pipeline: `src/domain/memory/EntityExtractor.ts`, `src/domain/workflow/definitions/EntityWorkflow.ts`
- Event persistence: `src/domain/workflow/steps/persistence/SaveEvent.ts`
- Entity persistence (patch application): `src/domain/workflow/steps/persistence/SaveEntity.ts`
- Injection point for Phase 2: `src/domain/workflow/steps/context/FetchContext.ts`
- Entity/event slices (store queries): `src/state/memory/slices/entitySlice.ts`, `src/state/memory/slices/eventSlice.ts`

## References

- Zep paper — [arXiv:2501.13956](https://arxiv.org/html/2501.13956) — "Zep: A Temporal Knowledge Graph Architecture for Agent Memory"
- Graphiti (open-source engine) — [github.com/getzep/graphiti](https://github.com/getzep/graphiti)
- Neo4j writeup — [neo4j.com/blog/developer/graphiti-knowledge-graph-memory](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
- Emergentmind topic summary — [emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture](https://www.emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture)
