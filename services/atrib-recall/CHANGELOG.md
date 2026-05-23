# @atrib/recall

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
