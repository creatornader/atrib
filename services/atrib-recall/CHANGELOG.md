# @atrib/recall

## 0.12.10

### Patch Changes

- 5ee04c5: Accept all atrib normative event type filters on recall tools.

  The MCP schema now accepts `observation`, `annotation`, `revision`,
  `directory_anchor`, `tool_call`, and `transaction`, plus full event type URIs.
  `recall_my_attribution_history` and `recall_orphans` share one local schema
  and normalize through `@atrib/mcp` before matching signed URI-form records.
  This fixes the stale schema that rejected observation filters before the
  handler ran, and updates the atrib skill doc so agents stop learning the old
  two-type limitation.

- Updated dependencies [5ee04c5]
  - @atrib/mcp@0.17.1

## 0.12.9

### Patch Changes

- Updated dependencies [80310e7]
  - @atrib/mcp@0.17.0

## 0.12.8

### Patch Changes

- Updated dependencies [f790fa0]
  - @atrib/mcp@0.16.1

## 0.12.7

### Patch Changes

- Updated dependencies [114248a]
  - @atrib/mcp@0.16.0

## 0.12.6

### Patch Changes

- Updated dependencies [c2ea30d]
  - @atrib/mcp@0.15.1

## 0.12.5

### Patch Changes

- 92352be: Add explicit npm author, homepage, and keyword metadata to the cognitive MCP packages.

## 0.12.4

### Patch Changes

- 8ad7158: Add OpenInference sidecar content for cognitive recall.

  `@atrib/openinference` now mirrors span payloads as local-only sidecar content for recall, trace, and summarize while signed records stay canonical. `@atrib/mcp` exposes shared sidecar normalization helpers, and the read primitives consume normalized wrapper and OpenInference content. The OpenInference processors now resolve custom chain roots against the actual signed `context_id`, including spans that use `session.id`.

  OpenInference args/result commitments now hash verifier-compatible JCS material: JSON strings are parsed before hashing, while non-JSON strings are hashed as JCS string values. This lets `@atrib/verify` replay `args_hash` and `result_hash` from supplied body material. Integration coverage now includes a dual-export OTLP smoke, body-commitment replay, richer recall queries over OpenInference sidecars, and a negative guard that generic OTel parent-child nesting does not create `informed_by`.

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0

## 0.12.3

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
  - @atrib/mcp@0.14.0

## 0.12.2

### Patch Changes

- Updated dependencies [24c4331]
  - @atrib/mcp@0.13.0

## 0.12.1

### Patch Changes

- Updated dependencies [ee37209]
  - @atrib/mcp@0.12.0

## Unreleased

### Patch Changes

- `recall_session_chain` now surfaces signed causal/tool fields (`informed_by`, `tool_name`, `args_hash`, `result_hash`) on each entry and accepts `include_content: true` to return the [D062](../../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror body as `local_content` plus `local_producer`. This lets mediated-recall harnesses provide the next agent with the record chain and the local outcome context without falling back to ad hoc transcript text.
- Read-primitive instrumentation now extracts only actual `record_hash` fields from MCP results. This prevents `args_hash`, `result_hash`, and other `sha256:` commitments from being miscounted as recalled record hashes.

## 0.12.0

### Minor Changes

- 4185989: Post-[D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) audit pass: closes parity gaps in the read-primitive surface so all read tools handle the per-event_type content shapes consistently, and adds four new traversal primitives that round out the surface.

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

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1

## 0.11.0

### Minor Changes

- b263d91: [D086](./DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) extends the BM25 indexable corpus from `annotation summary + topics only` to `per-event_type record content + annotation summary + topics`. Lifts the per-event_type extraction to `@atrib/mcp` as a normative protocol-level contract so producers and consumers round-trip via the same shape definition.

  **New in `@atrib/mcp`:** `extractIndexableText(eventTypeUri, content, opts?)` dispatcher + per-event_type type definitions (`ObservationContent`, `AnnotationContent`, `RevisionContent`, `ToolCallContent`, `TransactionContent`, `DirectoryAnchorContent`) + per-event_type extractors. Generic recursive string-walk fallback for extension URIs (depth ≤ 4, field cap 2KB via `DEFAULT_FIELD_CAP`). All additive; no removals.

  **Changed in `@atrib/recall`:** `recall_by_content` and `rank_by='relevance'` BM25 corpus now indexes record-content tokens for ALL records (not just annotated ones). Empirical impact on the 2026-05-24 operator mirror: 84.6% of records produce non-zero indexable tokens, up from near-0% pre-ship. `ATRIB_RECALL_NOISE_FLOOR` default raised from 0.15 → 0.6 to track the corpus shift (the prior floor became a no-op against the content-extended corpus; new floor sits between the recent+annotated-only baseline ~0.55 and the empirical real-query minimum ~0.70). BM25 contribution clamped to `[0, 1]` at the parkScore site to honor the documented Park-component bound (raw BM25 was unbounded, accidentally fine when the corpus was sparse).

  **Behavior change visible to callers:** queries that previously returned empty (no annotation in corpus) now may return records. Token weight in agent context windows scales with the existing `limit` parameter (default 10, unchanged from [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale)). Callers relying on the 0.15 floor to NOT trip suppression will see more `quality:below_threshold` responses; the env var still overrides for callers that want to retain prior behavior.

  **Extension URIs:** non-normative event_type URIs fall back to the generic walker by default. Producers SHOULD adopt one of the recognizable normative-shape field names (`what`, `why_noted`, `summary`, `description`, `topics`) so the walker picks them up naturally, OR call `atrib-annotate` on important records to lift them via the curator path. The full extension-URI handling rationale is in the linked ADR.

  Empirical calibration evidence: `services/atrib-recall/scripts/calibration-sweep-d086.mjs` (real vs nonsense query distributions against the 2026-05-24 mirror). Final calibration deferred to the gold-standard eval sweep queued in [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale).

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.10.0

### Minor Changes

- 9b3e2d6: [D085](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale) calibration defaults: change `recall_my_attribution_history` default `limit` from 25 to 10 to match field convergence (Haystack, AutoGen, mem0, Letta all default `top_k=10`). Reduces default token weight in agent context windows by ~60% per recall call. Existing callers passing explicit `limit=N` are unaffected. Schema description updated. Source comments at `services/atrib-recall/src/index.ts` lines ~78-110 now cite survey anchors per calibration (`ALPHA=0.3` matches CrewAI's `recency_weight=0.3`; `TAU_DAYS=7` produces ~4.85-day half-life inside the field range and near Park et al.'s ~5.75-day empirical anchor). The novel-in-field `NOISE_FLOOR=0.15` empty-return behavior is now flagged as a deliberate atrib protocol innovation rather than implicit convention. See [D085 in DECISIONS.md](./DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale) for the survey citations and the empirical-validation path (a queued gold-standard sweep).

## 0.9.0

### Minor Changes

- 679d787: Audit-pass-1 follow-up to 0.8.0 legibility patch. Extends `display_summary`, `display_producer`, `age` from `recall_my_attribution_history` to the sibling tools `recall_by_content` and `recall_walk` so agents get consistent legibility across the recall surface (previously sibling tools still returned opaque-ish responses). Adds defensive handling in `formatAge` to return `"unknown"` for non-finite timestamps instead of throwing `RangeError`. Inline comments lock in the producer-vs-signer distinction (do not repurpose `display_producer` for AKD lookups; add `display_signer` as a separate field instead) and the derivation of the `ATRIB_RECALL_NOISE_FLOOR=0.15` default (`alpha * 0.5`). No behavior change for callers; all additions are backward-compatible.

## 0.8.0

### Minor Changes

- 898ccda: Layer 1 v2 legibility patch: every record in the compact response now carries `display_summary` (annotation summary if present, else per-event_type synthesis from record fields and `_local.content`), `display_producer` (friendly producer label from `_local.producer` sidecar, else `key:<8hex>` fallback), and `age` (relative time string like `5m ago` / `3d ago`). New anti-noise threshold via `ATRIB_RECALL_NOISE_FLOOR` env (default 0.15): when `rank_by="relevance"` returns a top Park score below the floor, recall returns empty records plus a `quality: "below_threshold"` signal rather than low-confidence top-K. Both changes are additive and backward-compatible. Addresses the legibility dimension that prior Layer 1 work (substrate-signal ranking) did not cover: agents previously had to dereference opaque hashes to figure out what each surfaced record was about.

## 0.7.0

### Minor Changes

- 847852f: Surface 6 of the 4th-pillar substrate-instrumentation broadening: log every
  read-primitive invocation (recall family / trace / summarize) to
  `~/.atrib/state/read-primitives/calls.jsonl` so the unified loop-closure
  analyzer can correlate PreToolUse surfacing → read calls → cognitive writes.

  `@atrib/mcp` exports two new helpers:
  - `logReadPrimitiveCall(primitive, args, handler, extractHashes)` — wraps
    any read-primitive MCP handler. On call completion (success OR error)
    it appends one jsonl line with `{invoked_at, session_id, primitive,
query_shape, result_count, elapsed_ms, sample_result_hashes[], errored}`.
    Silent-failure contract per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract): instrumentation never affects the
    primary tool path; the handler's result (or thrown error) propagates
    unchanged. `ATRIB_READ_PRIMITIVES_LOG` overrides the default path.
  - `extractRecordHashesFromMcpResult(result)` — default extractor that
    deep-walks an MCP tool response for `sha256:<64-hex>` references and
    dedupes. Most callers can pass it directly; specialized servers can
    supply a tighter extractor when they know a stricter path.

  All three read-primitive servers (`atrib-recall` — 5 sibling tools,
  `atrib-trace`, `atrib-summarize`) wrap their handlers via these helpers.
  The signed-record bytes, response shapes, and tool schemas are unchanged.

  `@atrib/recall`'s compact-mode response now ALWAYS includes `record_hash`.
  Without it, the analyzer (and any caller that wants to chain `recall_walk`
  / `recall_annotations` / `recall_revisions` / `trace` from a result) had to
  fall back on verbose mode just to obtain the primary key. Compact response
  becomes ~70 bytes larger per record; the schema gain is worth it.

  Subsequent surfaces (7: SessionStart instrumentation; 8: structured cli-spawn
  log; 9: unified analyzer) live in the operator's hook layer (not on npm)
  and consume the same jsonl shape this surface produces.

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0

## 0.6.4

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.6.3

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.6.2

### Patch Changes

- ec688d0: Harness session-id discovery for cognitive-primitive MCP servers
  ([D083](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)).

  Extends [D078](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)'s
  `ATRIB_CONTEXT_ID` env-var default with a second fallback layer: when
  `ATRIB_CONTEXT_ID` is unset or invalid, derive a deterministic 32-hex
  context_id from a registered harness env var (e.g. `CLAUDE_CODE_SESSION_ID`).

  `@atrib/mcp` now exports `resolveEnvContextId()` and the
  `KNOWN_HARNESS_DISCOVERIES` registry. The four cognitive-primitive MCP
  servers (`@atrib/emit`, `@atrib/recall`, `@atrib/trace`, `@atrib/summarize`)
  consume the helper as their env-default resolution point. `@atrib/annotate`
  and `@atrib/revise` inherit the behavior transparently via `handleEmit`
  delegation. No spec change; signed records are byte-identical.

  Closes the steady-state orphan-singleton-chain class for Claude Code MCP
  children. Adding a new harness is a one-entry edit to
  `KNOWN_HARNESS_DISCOVERIES`.

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0

## 0.6.1

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0

## 0.6.0

### Minor Changes

- e559812: Honor `ATRIB_CONTEXT_ID` environment variable as the default `context_id` for the four MCP servers when the caller omits the argument. See [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) for the contract. Inspect-style harnesses ([P018](../DECISIONS.md#p018-adopt-inspect-ai-as-the-track-b-harness-baseline)) can now thread a per-run [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) `context_id` into spawned MCP subprocesses via the env block, eliminating the silent no-op that previously broke per-arm context isolation in Pattern 1 v2. Backward-compatible: explicit caller args always win; invalid env values are ignored. Per-server: `@atrib/trace` gains a new optional `context_id` tool input that scopes the walk (out-of-scope upstream records surface as dangling).

## 0.5.0

### Minor Changes

- 634e514: `recall_my_attribution_history` gains three orthogonal filter arguments: `content_id` (exact match on the [§1.2.2](../atrib-spec.md#122-content_id-derivation) content_id), `tool_name` (exact match on the [§8.2](../atrib-spec.md#82-opaque-name-posture) disclosed tool name), and `args_hash` (exact match on the [§8.3](../atrib-spec.md#83-salted-commitment-posture) args_hash commitment). All three are optional and AND-combined with the existing `context_id` and `event_type` filters. Added to address the API gap surfaced by Track B Pattern 1 hook design: agents instrumenting pre-action verification need to query "have I called this tool on this target before?" without pulling the entire mirror and filtering client-side. content_id alone groups by (server, tool); tool_name groups by disclosed name across servers; args_hash groups by canonical-args replay. Backward-compatible (additive); existing callers unaffected. Compact-mode response now also includes `tool_name` when the underlying record has it disclosed, so a caller filtering by tool_name sees the value back in the response.
- cb8411e: Layer 1 of the recall semantic surface lands functional. The existing `recall_my_attribution_history` tool gains seven new optional parameters, all enforced end-to-end:
  - `min_importance`: minimum annotation-derived importance threshold. Records with no annotation are excluded.
  - `topic_tags`: OR-match against annotation topic_tags.
  - `include_revised`: default false keeps revised records visible with `superseded_by` populated; true hides them.
  - `min_signers`: distinct-signer count filter. Transaction records carry `signers[]`; non-transaction records have count 1.
  - `rank_by`: result ordering. `'timestamp'` (default, newest first), `'relevance'` (Park et al. weighted-sum scoring: recency + annotation-derived importance + BM25 relevance against `rank_anchor`), or `'causal_distance'` (BFS shortest path from `rank_anchor` over the local derived graph).
  - `rank_anchor`: anchor for non-timestamp `rank_by` modes. Record_hash for `causal_distance`; free-form text query for `relevance`.
  - `toc`: when true, returns the ~40-80-token-per-entry table-of-contents shape (record_hash, tool_name, summary, importance, topic_tags, timestamp, superseded_by) suitable for SessionStart auto-injected scaffolds.

  Every returned record gains two new fields when applicable: `annotations` (max_importance + topics + latest summary, aggregated across all [D058](../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) annotations pointing at the record) and `superseded_by` ([D059](../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06) revision hashes superseding the record).

  Four new MCP tools join the surface, all functional:
  - `recall_walk`: BFS over the local derived graph from a starting record_hash. Layer 1 covers four edge types: CHAIN_PRECEDES (weight 1), INFORMED_BY (weight 1), ANNOTATES (weight 2), REVISES (weight 2). SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, and PROVENANCE_OF are deferred to subsequent releases.
  - `recall_annotations`: aggregated annotation summary lookup for a target record_hash.
  - `recall_revisions`: forward revision-chain walk for a target record_hash.
  - `recall_by_content`: BM25 free-form retrieval over each record's annotation summary + topic_tags, reranked by Park et al. weighted-sum scoring. Layer 2 (sqlite-vec sidecar, separate ship) will extend with embedding similarity.

  Park et al. 2023 ranking weights and recency time constant are environment-tunable for per-axis sensitivity studies (`ATRIB_RECALL_ALPHA` / `BETA` / `GAMMA` / `TAU_DAYS`).

  Event_type filter accepts `annotation` and `revision` in addition to the existing `tool_call` and `transaction` short forms; URI form is also accepted.

  Backward-compatible additive surface. All pre-0.5.0 calls produce identical responses under the new code path. The base `RecallResult` shape gains optional `annotations` + `superseded_by` per record (omitted when no annotation/revision points at the record).

## 0.3.2

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.3.1

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.3.0

### Minor Changes

- 895f406: Default mirror discovery is now directory-scan, not single-file. Envelope shape parsed alongside bare records.

  Two latent bugs compounded into recall being blind to ~97% of an agent's own history:
  - The default `ATRIB_RECORD_FILE` pointed at one specific producer's mirror (`mcp-wrap-claude-code.jsonl`). When that producer goes silent, recall returns stale results. The wrapper had been silently dormant since 2026-05-05; current production records land in `atrib-emit-claude-code.jsonl` via the Layer-2 hooks.
  - Even pointing recall at the emit mirror would have returned zero records because the parser required `spec_version` at the top level. emit writes the [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) envelope shape `{record, proof, _local}` where `spec_version` is nested under `.record`.

  New design:
  - Default: scan `ATRIB_MIRROR_DIR` (defaults `~/.atrib/records/`) and load every `*.jsonl`. The directory IS the contract per spec [§5.9](../atrib-spec.md#59-local-mirror-conventions).
  - Back-compat: if `ATRIB_RECORD_FILE` is set, use only that file.
  - Parser handles both bare records and [D062](../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) envelopes; nested record extraction matches the wrapper-side `normalizeMirrorLine`.
  - Result includes `record_files` array; legacy `record_file` kept as deprecated single-string for back-compat with existing callers.

  Three new exports: `loadRecordsFromDir(dir)`, `discoverRecords(recordFile?)`, plus the existing `loadRecords(path)` extended with envelope parsing. 17 prior tests still pass; 10 new tests added covering envelope parsing, dir-scan, mixed shapes, back-compat priority, ignored non-jsonl files.

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.2.1

### Patch Changes

- 2204434: Documentation refresh, package READMEs now reflect the post-rename names and the spec-aligned mirror filename convention.

  `@atrib/recall` ships its first README (the package was previously internal and never had a public README).

  `@atrib/emit`, `@atrib/trace`, `@atrib/summarize` README headers + body refs updated from the prior `@atrib/atrib-*` form to the `@atrib/<noun>` namespace pattern.

  `@atrib/emit` README also genericizes a 1Password example that previously referenced a specific item title.

  CHANGELOGs gain a callout explaining the version-skew between local-only workspace bumps and the first npm publish (e.g. `@atrib/emit` 0.4.0 was the first npm publish even though 0.2.0 + 0.3.0 entries appear in the changelog from the workspace-private period).

  No code changes, purely docs + metadata for npmjs.com surface accuracy.

> **Pre-0.2.0 versions exist in this changelog but were never published to npm.**
> The package moved from a workspace-private location and flipped public on 2026-05-05; the prior 0.1.0 bump was internal. The first npm-published version is 0.2.0.

## 0.2.0

### Minor Changes

- c35127f: Publish the 4 cognitive-primitive MCP servers to npm.

  These were previously workspace-private (developers ran them from source). They now ship as installable npm packages so any agent runtime can pull them in directly.

  `@atrib/emit`, producer-side: agents sign explicit observations, annotations, and revisions beyond what middleware auto-signs.

  `@atrib/recall`, consumer-side: agents query their own provable past from the local signed-record mirror with per-record signature verification. Defaults to `~/.atrib/records/mcp-wrap-claude-code.jsonl`; override via `ATRIB_RECORD_FILE` env.

  `@atrib/trace`, consumer-side: walks `informed_by` chains backward from a record_hash to surface the reasoning chain that produced it.

  `@atrib/summarize`, consumer-side: synthesizes a narrative across N records via an OpenAI-compatible LLM so agents read context, not raw record bytes.

  Naming convention rationale: package names dropped the redundant `@atrib/atrib-` prefix in favor of `@atrib/<noun>` (per the `@atrib/<noun>` namespace pattern already used by `@atrib/mcp`, `@atrib/agent`, `@atrib/verify`, etc). Binary names retained the `atrib-<noun>` form to preserve operator hook-script compatibility, package rename only, no binary rename.

  Also adopted: the local mirror filename convention `<wrapper-name>-<agent>.jsonl` per spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions) with the default wrapper name `mcp-wrap`. `@atrib/recall`'s default mirror path picks up this convention; existing wrappers using a different `name` config value should override `ATRIB_RECORD_FILE` accordingly.
