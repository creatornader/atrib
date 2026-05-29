# @atrib/trace

## 0.5.3

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
  - @atrib/mcp@0.14.0

## 0.5.2

### Patch Changes

- Updated dependencies [24c4331]
  - @atrib/mcp@0.13.0

## 0.5.1

### Patch Changes

- Updated dependencies [ee37209]
  - @atrib/mcp@0.12.0

## Unreleased

### Patch Changes

- `trace` and `trace_forward` now accept `include_content: true`, returning [D062](../../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) `local_content` and `local_producer` on compact visited records while also surfacing signed causal/tool fields (`informed_by`, `tool_name`, `args_hash`, `result_hash`). This supports harness-mediated causal replay where an agent needs the rich local diagnostic body without losing the `informed_by` traversal shape.
- `trace` and `trace_forward` now accept `depth: 0` to return only the start record. This makes diagnostic-only and implementation-only ablations possible without bypassing the trace primitive.
- `ATRIB_RECORD_FILE` is now honored as an explicit single-mirror override, matching `@atrib/recall`'s experiment harness path. `ATRIB_RECORDS_DIR` remains the directory override for multi-file mirrors.
- Read-primitive instrumentation now samples only actual `record_hash` fields, preventing `args_hash`, `result_hash`, and local-content hashes from being counted as traced records.

## 0.5.0

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

## 0.4.1

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.4.0

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

## 0.3.4

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.3.3

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.3.2

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

## 0.3.1

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0

## 0.3.0

### Minor Changes

- e559812: Honor `ATRIB_CONTEXT_ID` environment variable as the default `context_id` for the four MCP servers when the caller omits the argument. See [D078](../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) for the contract. Inspect-style harnesses ([P018](../DECISIONS.md#p018-adopt-inspect-ai-as-the-track-b-harness-baseline)) can now thread a per-run [D072](../DECISIONS.md#d072-orphan-handling--synthesize-fresh-never-inherit-from-mirror-tail) `context_id` into spawned MCP subprocesses via the env block, eliminating the silent no-op that previously broke per-arm context isolation in Pattern 1 v2. Backward-compatible: explicit caller args always win; invalid env values are ignored. Per-server: `@atrib/trace` gains a new optional `context_id` tool input that scopes the walk (out-of-scope upstream records surface as dangling).

## 0.2.5

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.2.4

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.2.3

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
> The package was renamed from `@atrib/atrib-trace` to `@atrib/trace` and flipped public on 2026-05-05; prior bumps were workspace-private. The first npm-published version is 0.2.0.

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

## 0.1.2

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.1.1

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0
