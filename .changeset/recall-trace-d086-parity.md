---
'@atrib/recall': minor
'@atrib/trace': minor
---

Post-[D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) audit pass: closes parity gaps in the read-primitive surface so all read tools handle the per-event_type content shapes consistently, and adds four new traversal primitives that round out the surface.

**`@atrib/recall` parity fixes:**

- `recall_by_content` tool description now reflects the per-event_type indexable text shipped in [D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) (observation `what + why_noted + topics`; tool_call `tool_name + args + result`; annotation `summary + topics`; revision `prior_position + new_position + reason + topics`; transaction counterparty + memo; directory_anchor tree_root; extension URIs via generic walk). The pre-ship wording said "BM25 over annotation summary + topics" which was inaccurate after the corpus extension shipped.
- `recall_my_attribution_history` gains an optional `creator_key` filter. The tool's name said "my attribution history" but the local mirror may hold records signed by other creators (multi-agent flows, transactions with counterparty signatures, etc.). Pre-fix there was no way to filter to one creator. Default behavior unchanged when the filter is omitted.
- `recall_revisions` now returns per-revision content (`new_position`, `reason`, `importance`) inline on each chain entry, alongside the existing `record_hash` and `timestamp`, plus a new `sibling_hashes` field listing other revisions targeting the same record (sibling fan-out, common in multi-agent flows). Pre-fix the tool returned a bare `string[]` of revision hashes, forcing the agent to make N follow-up recall calls per chain to read text and providing no way to discover sibling branches. The shape is now `{ record_hash, timestamp?, new_position?, reason?, importance?, sibling_hashes? }[]`. Breaking change for any caller that consumed the previous string-array shape.

**`@atrib/recall` new traversal primitives:**

- `recall_session_chain({ context_id?, limit? })` — returns all records in a context_id, ordered chronologically (the natural CHAIN_PRECEDES traversal for one session). Doable before via `recall_my_attribution_history` + manual sort; now a one-call primitive matching how agents naturally ask "what happened in this session?"
- `recall_orphans({ context_id?, event_type?, creator_key?, limit? })` — records that nothing else cites via `informed_by` (loose ends). Useful for the agent to discover dropped balls ("I noted X but never built on it"). Was impossible without iterating the whole mirror yourself.
- `recall_by_signer({ min_records? })` — aggregate the mirror by `creator_key`, returns distinct creators + per-creator record count + earliest/latest timestamp. Useful when the mirror is multi-signer and the agent wants to discover who else's records are in scope.

**`@atrib/trace` fixes + new primitive:**

- `summarizeSidecar`'s primary-text extraction now surfaces revision content. Pre-fix it read `content.what` (observation) with fallback to `content.summary` (annotation), missing revision's normative `new_position` field — so trace walks that landed on a revision returned a `sidecar_summary` with no human-readable text. Priority order is now: observation `what` → revision `new_position` → annotation `summary` (legacy fallback).
- `trace_forward` — dual of the existing `trace` tool. Walks `informed_by` FORWARD from a record (records that cited THIS one) instead of backward (records THIS one cited). Same input schema, same response shape, just opposite direction. Answers "I made decision X, what did I do because of it?" — completing the bidirectional walk surface.
- New exported helper `buildReverseInformedByIndex(index)` — used internally by `traceForward`; exposed for callers running multiple forward walks against the same mirror.

All changes are gap-fills surfaced by the post-ship architectural sweep of the read-primitive surface. The breaking change in `recall_revisions` is the cost of bringing it to parity with `recall_annotations` (which already returned aggregated content rather than bare hashes).

Full new test coverage: `@atrib/recall` 174→177 tests (new wire tests for session_chain, orphans, by_signer, sibling_hashes, creator_key filter, per-revision content); `@atrib/trace` 16→29 tests (new per-direction coverage of traceForward + buildReverseInformedByIndex + summarizeSidecar normative fields per [D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content)).
