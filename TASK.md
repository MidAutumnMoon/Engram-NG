# Episode as Source of Truth — Memory Overhaul

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
- When `SaveEntity` applies a patch flipping `knight.state: wounded → healed`, it records the diff for the UI diff-log but **discards it** — the establishing event is never linked, and the old "wounded" value is just overwritten (`store.updateEntity` → `db.entities.put`).

So: entity store is a mutable current-state projection with no history; event store is an append-only log with no entity links. In CQRS/event-sourcing terms, this is the **dual-write anti-pattern** — two projections of the same underlying reality, updated by independent pipelines.

## The Model: Episode as Source of Truth

The clean fix is to make explicit what is currently implicit and overloaded. Three concepts current Engram conflates into "the summarizer's output":

- **Episode** — *a window of chat processed in one pass.* The provenance unit; the **source of truth**. It is the *input*, addressable by `source_range` and re-fetchable from ST's `context.chat` while those messages live. Episodes are not stored as a separate table — the chat is the canonical store; an episode is identified by its window + a pass id.
- **Summarization** — *one consumer of an episode.* A derivation: episode window → narrative `EventNode`(s). Produces "what happened in this arc."
- **Extraction** — *the other consumer of an episode.* Derivation: episode window → entity patches + state-change events.

Both hang off the same episode, but they are different passes over (usually) different windows. **The episode is the source of truth; entity state and narrative events are both materialized views of it.**

```
            chat messages [a..b]  ← the EPISODE (input, addressable by source_range)
                    │
        ┌───────────┴───────────┐
   summarize pass              extract pass        ← two consumers, two episode_ids
   (episode S5)                (episode E42)
        │                           │
        ▼                           ▼
  narrative EventNodes      entity patches
  ("the tavern brawl")     + state-change EventNodes
   level 0                   ("knight: wounded→healed")
        │                           │
        └───────────┬───────────────┘
                    ▼
              events table  ← one heterogeneous timeline
              (trimmer compresses both → level 1)
```

### Why summarization survives

Graphiti has no summarizer — just entities + facts + raw episodes. Why keep one? Because RP memory needs **arc-level narrative coherence** that neither raw messages nor entity states provide:

- Entity state history tells you `knight: wounded (msg 10–25) → healed (msg 26+)` — *what's true*.
- The summarizer tells you *"at the tavern, a brawl broke out and the knight was stabbed"* — *what happened*.

Summarization's position is **the narrative-compression derivation**. It is not the episode; it consumes one. It stays, but is demoted from "the timeline" to "a feed into a shared timeline."

### The two-coordinate rule (do not mix these up)

| Coordinate | What it links | Granularity |
|---|---|---|
| `episode_id` | A derived record → the pass that made it | Per-pass, **within** a layer |
| message index (`source_range`, `valid_from_index`) | Records across layers → the same narrative moment | Per-message, **across** layers |

`episode_id` answers *"which processing run produced this?"* — useful for citation/debugging, but it does **not** join the summarizer and entity layers (different passes, different windows). You cannot join a summary event to an entity patch via episode_id.

**Message index is what joins them.** "The knight's healing (entity patch, `valid_from` msg 26) and the tavern-brawl summary (event, `source_range` 20–30) overlap at msg 26–30" — that's the cross-layer link. Message index, not episode_id, is the load-bearing clock.

### Message-index, not wall-clock

Graphiti uses bi-temporal datetimes (`t_valid`/`t_invalid`). That's the wrong clock for RP — in-world time is fictional, and the paper's date-extraction prompts ("June 23, 1912") don't fit a fantasy arc where "太阳历1023年" lives in `structured_kv.time_anchor` as free text. Engram already has a monotonic real clock: **message index**. Every state-bearing fact on an entity gets `valid_from_index` / `valid_to_index`, and retrieval answers **as-of a narrative point**. This is the capability that drove Graphiti's temporal-reasoning gains on LongMemEval, and it's *more* useful for RP (flashbacks, "remember when", arc consistency) than for the enterprise chat the paper targets.

### The key change: summarization stops being the *sole* timeline producer

This is what actually fixes the disease. Today the timeline is populated **only** by the summarizer, which lags because of its buffer, so entity state (msg N) outruns the timeline (msg M < N). In the new architecture the timeline has **two** feeders:

1. Summarizer → narrative events (laggy, coarse, arc-level)
2. Entity extractor → state-change events (immediate, fine-grained, ride along on the same pass that patches the entity)

The state-change events are written at the same `source_range` as the entity patch, in the same pass. **The timeline can never lag entity state for the things that matter** — every state change is a timeline entry the moment it's known. The summarizer's lag becomes irrelevant for state consistency; it only affects narrative-detail richness, which is acceptable. This is why the old "injection-time reconciliation" phase (below) is largely unnecessary: you don't reconcile two stores at injection time when one is now a strict superset timeline.

## Prior Art: Graphiti / Zep

Closest production analog. Same dual-store design, framed in cognitive-science terms: **episodic memory** (events) vs **semantic memory** (entities/facts). Paper: [arXiv:2501.13956](https://arxiv.org/html/2501.13956) ("Zep: A Temporal Knowledge Graph Architecture for Agent Memory").

Three things make *their* split work where Engram's doesn't:

1. **Episodic edges.** Every entity/fact traces back to the episode that produced it. When "knight: healed" is asserted, Graphiti records *which episode asserted it*. This is the link Engram is missing entirely — adapted here as the episode-as-source-of-truth model plus `episode_id` provenance.
2. **Bi-temporal validity on facts, not node mutation.** Facts live with `(valid_from, valid_to)`. "knight wounded" doesn't get overwritten by "knight healed" — the old fact's `valid_to` is set, a new fact with `valid_from` is created. Full history "wounded during [msg10–msg25], healed at msg26" is queryable. Adapted to message-index instead of datetimes.
3. **Incremental resolution, not batched.** Entities are extracted from each new episode and resolved against existing nodes immediately — no separate timer, no window drift.

What is **not** portable: Neo4j + bi-temporal datetime indexing + label-propagation community detection + bidirectional graph traversal. Overkill for a single-conversation browser extension on Dexie/IndexedDB. The *principles* (episode primacy, provenance, validity intervals, resolution) port with small schema changes. See "What not to port" below.

## Plan

The architecture is sound; the disease is missing links and overwrite semantics, not bad structure. So this is mostly additive — small remove list, a focused rewrite of the mutation surface, a few new pieces.

### REMOVE

| Item | Why |
|---|---|
| `_diff` dry-run machinery in `SaveEntity` (`:424-444`, `:620-637`) | UI artifact of the overwrite model. Once state is versioned, diffs fall out of interval history for free. |
| `BrainRecallStep` reference comment + orphaned `dev-docs/BrainRecall/` + the `useAgenticRAG` flag with no producer | Already dead; delete or formalize, don't leave both. |
| Duplicated query logic between `eventSlice.getEventsToMerge` and the inline copy in `EventTrimmer` | `db.ts:225` notes this is unfinished; consolidate while touching the area. |

### REWRITE — the mutation surface (the actual work)

1. **`src/data/types/graph.ts` (schema, the foundation).**
   - `EventNode`: add `entity_refs?: string[]` (resolved entity IDs this event mentions/establishes) and `episode_id?: string`.
   - `EntityNode`: add `field_history?: Record<string, ValueInterval[]>` (state-bearing fields, versioned by message-index interval) and `episode_refs?: string[]`.
   - `profile` stays as the **current-state projection** but becomes *derived* from `field_history`, not the source of truth. At rest it holds the last interval's value (backward compat: entities with no `field_history` read `profile` directly).
   ```ts
   interface ValueInterval {
       value: unknown;
       from_index: number;       // message index
       to_index: number | null;  // null = current
       episode_id: string;
   }
   ```

2. **`src/data/db.ts` (v3 → v4).** No new tables — the fields are non-indexed JSON on existing tables, so the schema string barely changes. The v4 upgrade backfills: any entity with `profile.state`/`profile.status` and no `field_history` gets a synthetic `{value, from_index: 0, to_index: null, episode_id: null}`; old events get `episode_id: null`. One-time pass; a wrong migration silently corrupts every existing chat, so it gets an isolated test (see ADD).

3. **`src/domain/workflow/steps/persistence/SaveEntity.ts` (the core rewrite).** Today it applies `fast-json-patch` ops and calls `store.updateEntity` → `db.entities.put` (overwrite). Change to:
   - For each patch op touching a **state field** (configurable list, default `["state","status","location","mood"]`), instead of `replace`, **append a `ValueInterval`** to `field_history[field]` and set the previous interval's `to_index`.
   - Stamp every mutation with the current `episode_id` (threaded via `JobContext`).
   - When emitting a state change, **also write a minimal `EventNode`** (`level: 0`, same `source_range`, `entity_refs: [id]`, `summary` = the change). Gate on `significance_score` (already exists) so "knight sat down" doesn't become an event. This is the second timeline feeder that closes the lag.
   - Replace string-only `resolveEntityIdentity` (`:297`) with embedding-based resolution (see ADD #2). On merge, **merge `field_history`** (append the loser's intervals, mark them ended at merge point).
   - Legacy/unified patch formats (`:29-44`) stay as input parsing — only the *apply* path changes.

4. **`src/state/memory/slices/entitySlice.ts` (read path).** `getEntityStates` (`:106`) currently dumps `e.description`. Change to resolve state fields **as-of a target message index** carried by the retrieval query. Default = latest message index (unchanged behavior); the flashback case is a later phase. `updateEntity` (`:285`) stays as the low-level write, but `SaveEntity` stops calling it for state fields (those go through interval-append).

### ADD

1. **Episode-id plumbing.** Orchestrators `Summarizer.ts` and `EntityExtractor.ts` generate a UUID at run start and thread it through `JobContext`. `SaveEvent`/`SaveEntity` read it and stamp records. No new file — a field on the existing `JobContext`. This is the episodic edge in adapted form: provenance by shared UUID, not a traversable edge table.

2. **Embedding-based entity resolution step** — the prerequisite TASK.md previously omitted. New `src/domain/workflow/steps/extraction/ResolveEntitiesStep.ts`, inserted into `EntityWorkflow` between extraction and save. Mirrors Graphiti's two-stage resolution (`graphiti.md:122-130`): cosine candidates from `entity.embedding` (already exists, `graph.ts:170`) → one cheap LLM "is_duplicate?" call. This is what makes `field_history` actually meaningful — without it two knight nodes drift and no interval model saves you.

3. **Narrative-index target on retrieval queries.** The retrieval query carries a `target_index` so as-of resolution works. Phase 1: default only (`target_index = currentMax`). Flashback queries (target = a referenced event's `source_range.end_index`) need intent detection and are a later phase — the data model supports them; don't build the detection yet.

4. **`test/migrations/v4.test.ts`** — isolated migration test that doesn't depend on the broken post-fork suite.

### Dependency order

```
ADD #1 (episode_id plumbing) ──┐
                               ├──► schema rewrite (REWRITE 1) ──► db v4 (REWRITE 2)
ADD #2 (resolution step) ──────┤                                        │
                               └──► SaveEntity rewrite (REWRITE 3) ◄───┘
                                                                          │
                                    state-change emit (in REWRITE 3) ◄───┤
                                                                          │
                              retrieval index param (ADD #3) ◄───────────┘
                                                                          │
                                    entitySlice read path (REWRITE 4)
```

**ADD #1 + #2 + schema + SaveEntity rewrite + db v4** is the irreducible core — that's the system. ADD #3 and REWRITE 4 make the new data actually surface. Everything else (UI for interval history, flashback queries, trimmer dedup) is polish.

### Phase mapping (vs the old plan)

The earlier phased plan is superseded by the episode-as-source-of-truth model:

- **Old Phase 1 (provenance links)** → now **REWRITE 1 + ADD #1**, and the open question ("can existing prompts cheaply populate provenance?") is **resolved: no** — it needs episode-id threading, not a prompt tweak.
- **Old Phase 2 (injection-time reconciliation)** → **largely unnecessary**. State-change emission (in REWRITE 3) makes the timeline a superset of entity state, so there's nothing to reconcile at injection time. Retain only as a fallback annotation if extraction is ever skipped.
- **Old Phase 3 (derive entity state from events)** → folded into **REWRITE 3** (`field_history` interval-append + state-change emit), and it's cheaper than the old estimate: a state-change event is one extra JSON field on the *existing* entity-extraction call, not a second call.

## What not to do / what not to port

- **Don't add a graph DB.** IndexedDB isn't a graph engine, but Engram already does graph traversal on it correctly: `KeywordRetrieveStep.ts:96-255` is a 2-hop BFS that loads the vertex set once (`db.entities.toArray()`), builds an adjacency `Map`, and joins in memory. That's the load-then-join pattern, and it works because of scale — `archiveLimit` defaults to 50 active entities, one DB per chat; a long RP chat reaches a few hundred nodes. `toArray()` over a few hundred records is sub-millisecond; the LLM calls that produce them are seconds. The bright line: **if you ever write `db.edges.where(...)` per hop or an N+1 `db.get(neighbor)` loop, you've crossed it.** As long as the pattern is "load once, join in memory," Dexie is fine up to ~10k nodes/chat — three orders above where RP chats live.
- **Don't add communities.** Label-propagation community detection is pure overhead for single-conversation memory. Graphiti needs it because Zep is multi-tenant/multi-session; Engram has one chat per DB. Don't carry the weight.
- **Don't port wall-clock bi-temporal datetimes.** Message-index instead — see "Message-index, not wall-clock."
- **Don't keep edges as a traversable `edges` table.** Edges denormalized inside the node (as `profile.relations` does today) load for free with the node. The one real existing problem is referential: `EntityRelation.target` is a name string, not an ID (`graph.ts:107`) — rename/merge a node and every relation pointing at it dangles. ADD #2 (resolution with stable IDs) addresses this.
- **Don't merge entity extraction and summarization into one LLM call naively.** Different optimal prompt structures, different cadences (entities fine-grained, summaries coarse). Graphiti extracts per-episode but generates community summaries in a separate batched pass — same principle. Keep them split; add the *links*.

## Cost / next step

Irreducible core (ADD #1+#2 + schema + SaveEntity rewrite + db v4): ~3-4 days — this is the redesign. ADD #3 + REWRITE 4 (surface the new data): ~1-2 days. Migration test + dedup cleanup: ~half day.

Suggested next step: do the schema + db v4 migration first so the migration shape is visible before the SaveEntity rewrite lands on top of it.

## Key Code Locations

- Schema: `src/data/types/graph.ts` — `EventNode`, `EntityNode`, `ScopeState`
- DB + migration: `src/data/db.ts` (`version(3)` at `:48` → bump to v4)
- Orchestrators (episode-id generation): `src/domain/memory/Summarizer.ts`, `src/domain/memory/EntityExtractor.ts`
- Event persistence: `src/domain/workflow/steps/persistence/SaveEvent.ts`
- Entity persistence (patch application — the core rewrite): `src/domain/workflow/steps/persistence/SaveEntity.ts`
- Injection point: `src/domain/rag/injection/Injector.ts`
- Retrieval workflow: `src/domain/workflow/definitions/RetrievalWorkflow.ts`, `src/domain/workflow/steps/rag/KeywordRetrieveStep.ts`
- Read path: `src/state/memory/slices/entitySlice.ts` (`getEntityStates` `:106`, `updateEntity` `:285`), `src/state/memory/slices/eventSlice.ts`
- Macros (assembly): `src/domain/macros/index.ts`

## References

- Zep paper — [arXiv:2501.13956](https://arxiv.org/html/2501.13956) — "Zep: A Temporal Knowledge Graph Architecture for Agent Memory"
- Graphiti (open-source engine) — [github.com/getzep/graphiti](https://github.com/getzep/graphiti)
- Neo4j writeup — [neo4j.com/blog/developer/graphiti-knowledge-graph-memory](https://neo4j.com/blog/developer/graphiti-knowledge-graph-memory/)
- Emergentmind topic summary — [emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture](https://www.emergentmind.com/topics/zep-a-temporal-knowledge-graph-architecture)
