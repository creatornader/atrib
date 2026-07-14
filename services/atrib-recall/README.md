# `@atrib/recall`

MCP server for atrib's verifiable action layer. Lets agents query their own provable past from the local signed-record mirror with per-record signature verification.

The consumer-side counterpart to `@atrib/attest`: attest produces signed records, recall reads them back and exposes them to the agent. Each returned record carries a `signature_verified` boolean so a poorly-written agent treats tampered records as such.

## The `recall` verb and the absorb (attest/recall rename, [D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse))

`@atrib/recall` now exposes a `recall` tool that absorbs the eight legacy
`recall_*` tools under a `shape` argument, absorbs `trace`/`trace_forward`
as `shape: "walk"` with a `direction`, and absorbs `atrib-verify` as a
`verification` parameter. Results are JSON-identical to the legacy tools:
this is the read-equivalence conformance family in
[`spec/conformance/attest-recall/`](../../spec/conformance/attest-recall/).

| `shape` | Legacy tool | Notes |
| --- | --- | --- |
| `history` | `recall_my_attribution_history` | base filter-rank-page query |
| `walk` | `recall_walk` | when `direction` omitted or `"backward"`; also absorbs `trace` |
| `walk` + `direction: "forward"` | `trace_forward` | forward walk over the same graph |
| `content` | `recall_by_content` | BM25 free-form retrieval |
| `chain` | `recall_session_chain` | ordered chronological session walk |
| `annotations` | `recall_annotations` | aggregated annotation summary for a target |
| `revisions` | `recall_revisions` | forward revision chain for a target |
| `orphans` | `recall_orphans` | records not cited by any other record |
| `by_signer` | `recall_by_signer` | per-creator aggregation |

The `verification` parameter absorbs `atrib-verify`: pass the same
`packet`/`records`/`claims` evidence shapes as `@atrib/verify` and the
`recall` result carries a verification block instead of a separate tool
call. `@atrib/verify` (the verifier library) is an OPTIONAL peer
dependency, lazily imported. When it is absent, `verification` returns a
typed `{ status: "verifier_unavailable" }` block and the read still
succeeds; the degradation is explicit and typed, not a silent drop.

`createAtribRecallServer` now mounts the full twelve-tool read union:
`recall` plus the eight `recall_*` tools plus `trace`, `trace_forward`,
and `atrib-verify`. All twelve tool names stay mounted as permanent
aliases during the alias window.

## Install

```bash
pnpm add @atrib/recall
```

Verify a local build with `pnpm --filter @atrib/recall test`.

## Tool surface

The eight legacy `recall_*` tools below cover the cognitive surface of the
local mirror. They stay mounted as permanent aliases; see the absorb
section above for the `recall` verb that unifies them under one tool.

### `recall_my_attribution_history`

The base filter-rank-page tool over the local mirror.

```typescript
mcp__atrib-recall__recall_my_attribution_history({
  // All optional
  context_id?: string,           // 32-hex. Filter to records signed under this trace.
  context_scope?: 'all' | 'env', // Default 'all'. Set 'env' to apply the D078/D083
                                 // env-derived current context when context_id is omitted.
  creator_key?: string,          // Ed25519 public key, base64url. Filter to records signed by this
                                 // specific creator. The tool's name says "my history" but the local
                                 // mirror may hold records from other signers (multi-agent flows,
                                 // transactions with counterparty signatures, etc.); use this filter
                                 // to scope strictly to your own past.
  event_type?: 'tool_call' | 'transaction' | 'observation' | 'annotation' | 'revision' | 'directory_anchor' | string,
                                 // Filter to a single event kind. Short-form names are normalized
                                 // to the URI form. Full event_type URIs are also accepted.
  content_id?: string,           // sha256:... exact match on §1.2.2 content_id.
  tool_name?: string,            // §8.2 disclosed tool name; records without disclosure excluded.
  args_hash?: string,            // sha256:... §8.3 args_hash exact match.
  limit?: number,                // Default 10, max 200. (D085: matches field convention.)
  offset?: number,               // For pagination. Note pagination_caveat in the response.
  compact?: boolean,             // Default true - omits signature/content_id/chain_root/spec_version
                                 // fields. `record_hash` is always included (so callers can chain
                                 // recall_walk / recall_annotations / recall_revisions / trace
                                 // from any result). Set false for full record bytes
                                 // (re-verification).
  include_unverified?: boolean,  // Default false - drops records whose signature didn't verify.
                                 // Set true ONLY when consuming the verbose mode AND explicitly
                                 // checking signature_verified per record.

  // Annotation- and revision-driven filters. Records with no incident
  // annotation are excluded when min_importance or topic_tags is set;
  // records that have a revision pointing at them surface superseded_by
  // by default and are hidden when include_revised=true.
  min_importance?: 'critical' | 'high' | 'medium' | 'low' | 'noise',
  topic_tags?: string[],         // OR-match against annotation topic_tags.
  include_revised?: boolean,     // True hides records superseded by a D059 revision.
  min_signers?: number,          // Distinct-signer threshold; 1 for non-transaction records.

  // Ranking.
  rank_by?: 'timestamp' | 'relevance' | 'causal_distance',
                                 // 'timestamp' (default): newest first.
                                 // 'relevance': Park et al. weighted-sum scoring (recency +
                                 //   annotation-derived importance + BM25 against rank_anchor).
                                 // 'causal_distance': BFS shortest-path from rank_anchor over
                                 //   the local derived graph (CHAIN_PRECEDES, INFORMED_BY,
                                 //   ANNOTATES, REVISES).
  rank_anchor?: string,          // record_hash for causal_distance, free-form query for relevance.

  // Response shape.
  toc?: boolean,                 // Default false. True returns the ~40-80-token-per-entry
                                 // table-of-contents shape (record_hash, tool_name, summary,
                                 // importance, topic_tags, timestamp, superseded_by) suitable
                                 // for SessionStart auto-injected scaffolds.
})
```

Omitting `context_id` searches cross-context history by default. This keeps topic, importance, creator, event type, and tool-name recall useful as memory lookups across sessions. Harnesses that need the old [D078](../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) / [D083](../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers) env-derived current-context behavior should pass `context_scope: 'env'`. An explicit `context_id` always wins over `context_scope`.

Returns `{ total, returned, filtered_out_by_verification, record_files, record_file, log_origin, pagination_caveat, records }`. Each record carries `record_hash` (always, per [D084](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement), so the result is chainable into other primitives without a verbose-mode round-trip), `annotations` (when annotation records point at it), and `superseded_by` (when revision records point at it).

Every call to this tool (and every sibling tool below) writes a per-call jsonl entry to `~/.atrib/state/read-primitives/calls.jsonl` for the unified loop-closure analyzer per [D084](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement). Silent-failure per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract); the tool response is unaffected by instrumentation failures. The `ATRIB_READ_PRIMITIVES_LOG` env var overrides the default path for tests.

### Sibling tools

- `mcp__atrib-recall__recall_walk({ from_record_hash, edge_types?, depth? })` - walks the local derived graph from `from_record_hash` up to `depth` hops (default 3), returning each reachable record_hash + weighted distance. Edge types: CHAIN_PRECEDES (weight 1), INFORMED_BY (weight 1), ANNOTATES (weight 2), REVISES (weight 2). SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, and PROVENANCE_OF are deferred to subsequent releases.

- `mcp__atrib-recall__recall_annotations({ record_hash })` - returns the aggregated annotation summary (max_importance, union of topics, latest summary) for the target record. Returns `annotations: null` when no annotation points at the record.

- `mcp__atrib-recall__recall_revisions({ record_hash })` - returns the forward revision chain for the target record. Each chain entry carries `record_hash`, `timestamp`, and the [D086](../../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content)-normative content fields (`new_position`, `reason`, `importance`) when present, so the agent can read the chain inline without follow-up `recall` calls per revision. The chain follows the first-by-timestamp revision at each step; when more than one revision targets the same record (sibling fan-out, common in multi-agent flows), the other branch heads are listed on that step's entry as `sibling_hashes`, so the agent can recursively call `recall_revisions` on a sibling to traverse a parallel branch instead of having to manually enumerate revisions via `recall_my_attribution_history`.

- `mcp__atrib-recall__recall_by_content({ query, k?, max_records?, evidence_mode? })` - BM25 free-form retrieval over the newest `max_records` records' indexable text + annotation summary + topic_tags when present, then reranked by Park et al. weighted-sum scoring (recency + importance + relevance). Default k=10, max 50. Default `max_records` is `ATRIB_RECALL_CONTENT_MAX_RECORDS` or 5000. The default `evidence_mode: "bounded"` keeps casual searches fast by tail-loading that newest-first window instead of loading the whole mirror. The response includes `runtime`, `evidence_mode`, `evidence_status`, `fallback_required`, `total_records`, `searched_records`, `candidate_records`, `truncated_corpus`, and `coverage`; `total_records` is `null` when recall served a partial tail-loaded snapshot instead of a full mirror snapshot. `runtime` names the loaded `@atrib/recall` package version plus the coverage and content-index contract versions, so a stale MCP process is detectable from the result. `coverage` carries a version, strategy, local-mirror high-water mark, mirror file count, searched record count, and `coverage.index` status so callers can tell whether a result came from a bounded newest-first window, a complete scan that rebuilt the durable sidecar, a durable-index hit, or an explicit disabled/write-failed fallback. Per [D086](../../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) and [D118](../../DECISIONS.md#d118-primary-trace-path-is-a-presentation-rule-over-trace-and-chain), "indexable text" is per-event_type record content from the [D062](../../DECISIONS.md#d062-local-mirror-sidecar-two-tier-private-local--public-canonical-persistence) sidecar (observation: `what + why_noted + intent + rationale + topics`; tool_call: `tool_name + args excerpt + result excerpt`; annotation: `summary + topics`; revision: `prior_position + new_position + reason + topics`; transaction: counterparty + memo + protocol fields; directory_anchor: `tree_root + epoch_id`). Extension URIs fall back to a generic recursive string-walk (depth <= 4, field cap 2KB). OpenInference local sidecars add recall tokens for span kind/name, tool/agent/model, prompt identifiers and templates, inputs/outputs, usage, cost, score, and metadata when those fields are mirrored locally per [D108](../../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload). BM25 contribution is clamped to [0, 1] in the parkScore site so the documented Park-component bound is honored. A future embedding sidecar can add semantic similarity over the same indexed text.

For critical-path audits, use `evidence_mode: "require_complete"`. That mode loads the full mirror and searches every loaded record. If a caller also sets `max_records` below `total_records`, the tool returns no results with `evidence_status: "incomplete"`, `fallback_required: true`, `truncated_corpus: true`, and the `search_cap` / `total_records` mismatch. Do not treat that as an empty search result. The deterministic fallback is to rerun without `max_records` for full loaded-mirror coverage, or to run a caller-owned partition plan and treat each partition as its own explicit coverage claim.

Complete-mode recall uses a durable content-token sidecar when it can. The sidecar is keyed to the current local mirror fingerprint and stores the BM25 token corpus plus display metadata for `recall_by_content`. A sidecar is accepted only when its stored mirror signature and high-water mark match the current mirror stats. If the sidecar is absent or stale, `require_complete` rebuilds it from the full local mirror and still returns complete evidence. If the sidecar is disabled with `ATRIB_RECALL_CONTENT_INDEX=0`, or if writing the sidecar fails, recall falls back to the loaded-mirror path and reports that status in `coverage.index`.

In wrapped MCP hosts, the recall tool call and its JSON response are signed as a `tool_call` record. That means an incomplete critical-path recall is not a quiet warning in transcript prose; the signed result carries `fallback_required: true`. Agents should emit an observation naming the incomplete recall status and the fallback they chose before continuing.

- `mcp__atrib-recall__recall_session_chain({ context_id?, limit?, include_content? })` - returns all records in a context_id, ordered chronologically (oldest-first). The natural traversal of the CHAIN_PRECEDES topology for a single session/trace. Each entry carries `record_hash`, `event_type`, `timestamp`, `display_summary`, `display_producer`, `age`, plus signed causal/tool fields when present (`informed_by`, `tool_name`, `args_hash`, `result_hash`). When `include_content` is true, each entry also includes the [D062](../../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror body as `local_content` and the local producer label as `local_producer`. Defaults false to keep the session chain cheap. When `context_id` is omitted, falls back to `resolveEnvContextId` (the same precedence as the other tools: `ATRIB_CONTEXT_ID` env, then a [D083](../../DECISIONS.md#d083-harness-session-id-discovery-extends-d078-for-cognitive-primitive-mcp-servers)-registered harness env like `CLAUDE_CODE_SESSION_ID`).

- `mcp__atrib-recall__recall_orphans({ context_id?, event_type?, creator_key?, limit? })` - returns records that are NOT cited by any other record via `informed_by` (loose ends: decisions or observations the agent made but never followed up on). Optionally scoped to one context_id, one event_type, or one creator_key. Newest-first ordering. Useful for the agent to discover dropped balls (e.g. "I noted X but never built on it").

- `mcp__atrib-recall__recall_by_signer({ min_records? })` - aggregates the local mirror by `creator_key`. Returns distinct creators present + per-creator record count + earliest/latest timestamp. Pure aggregation; no records returned directly. Use `recall_my_attribution_history` with the `creator_key` filter to drill into one creator's records. Useful when the mirror is multi-signer.

### Tunable weights

The Park et al. ranking weights and recency time constant are environment-tunable for per-axis sensitivity studies:

| Env var                            | Default          | Role                                                              |
| ---------------------------------- | ---------------- | ----------------------------------------------------------------- |
| `ATRIB_RECALL_ALPHA`               | 0.3              | Recency component weight                                          |
| `ATRIB_RECALL_BETA`                | 0.3              | Importance component weight                                       |
| `ATRIB_RECALL_GAMMA`               | 0.4              | Relevance (BM25) component weight                                 |
| `ATRIB_RECALL_TAU_DAYS`            | 7                | Exponential-decay time constant for recency                       |
| `ATRIB_RECALL_NOISE_FLOOR`         | 0.6              | Anti-noise threshold for `rank_by=relevance` (see below)          |
| `ATRIB_RECALL_CONTENT_MAX_RECORDS` | 5000             | Newest-first corpus size for bounded `recall_by_content` searches |
| `ATRIB_RECALL_CONTENT_INDEX`       | enabled          | Set to `0` to disable the durable content-token sidecar           |
| `ATRIB_RECALL_CONTENT_INDEX_DIR`   | `~/.atrib/cache` | Directory for mirror-keyed content index files                    |
| `ATRIB_RECALL_CONTENT_INDEX_FILE`  | unset            | Exact content index file path, mainly for tests                   |

The implementation does not enforce that alpha + beta + gamma sum to 1.0; the operator-facing defaults do. See [D085](../../DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale) for the survey-grounded rationale: `ALPHA=0.3` matches CrewAI's `recency_weight=0.3` (the only normalized-weights peer in a 2026-05-23 OSS survey); `TAU_DAYS=7` produces a ~4.85-day half-life inside the field range and close to Park et al.'s ~5.75-day empirical anchor.

### Legibility fields (added in 0.8.0)

Compact recall responses carry three derived fields per record so the agent can scan results without dereferencing opaque hashes:

| Field              | Source                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `display_summary`  | Annotation summary if present, else per-event_type synthesis from record fields + `_local.content` (tool_call: `call <tool_name>(<args>)`; observation: first 80 chars of `what`; transaction: `<amount> to <merchant> via <protocol>`; annotation: `annotates <hash>: [<importance>] <summary>`; revision: `revises <hash>: <new_position>`; directory_anchor: `directory anchor <root>`; extension URI: tail). Capped at 120 chars. |
| `display_producer` | `_local.producer` sidecar label (e.g. `atrib-emit-cli`, `claude-hooks-builtin-2b`). Falls back to `key:<8hex>` of the creator key. Answers **which local code signed the record**, not which human or organization. The complementary `display_signer` field (AKD-backed identity claim) is planned as a separate field; repurposing `display_producer` for AKD lookups would conflate two distinct trust signals.                    |
| `age`              | Relative time string (`just now`, `5m ago`, `3h ago`, `3d ago`, ISO date for older than 30 days). Returns `"unknown"` for non-finite timestamps.                                                                                                                                                                                                                                                                                      |

`recall_by_content` and `recall_walk` carry the same fields starting in the 0.8.0 audit-pass-1 follow-up.

### Local content normalization

Recall treats `_local.content` as the preferred semantic payload. If older mirror entries only have wrapper fields (`toolName`, `args`, `result`) or OpenInference callback fields (`source`, `spanKind`, `spanName`, `input`, `output`, `agentName`, `model_name`), recall derives the same content shape through `@atrib/mcp` before scoring or formatting. That keeps legacy mirrors readable without promoting prompts, outputs, usage, cost, or scores into signed protocol fields.

### Anti-noise threshold for `rank_by=relevance`

When `rank_by=relevance` produces a top Park score below `ATRIB_RECALL_NOISE_FLOOR` (default 0.6), recall returns empty records plus a `quality: "below_threshold"` signal and the observed `top_score`. The default sits above the recent-plus-annotated baseline from the [D086](../../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) calibration and below the observed real-query minimum. Below that, results are effectively noise. Set the env var to 0 to disable. Threshold applies only to relevance ranking; timestamp + causal_distance modes are unaffected.

**Novel in field.** The 2026-05-23 survey of comparable systems (Park et al., MemGPT/Letta, A-MEM, MemoryBank, Mem0, LangChain, LlamaIndex, CrewAI, Haystack, AutoGen) found no published or OSS implementation that returns "empty + quality:below_threshold" rather than top-K. The field convention is "always return something, let the agent decide it's noise." atrib's inversion is a deliberate protocol choice (lower hallucination risk from low-confidence context). See [D085](../../DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale) for the full survey and [D086](../../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content) for the 0.6 recalibration.

## Trust scope

Signature verification is local-only. A passing `signature_verified` proves the record was signed by the named `creator_key`; it does NOT prove the record was committed to log.atrib.dev. To confirm log inclusion, fetch the inclusion proof from the log API.

## Configuration

| Env var             | Required | Purpose                                                                                                                                                                                                                                                                     |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIB_RECORD_FILE` | optional | Path to a single signed-record jsonl mirror to read. When set, overrides directory scanning. Back-compat with pre-0.4.0 callers that pinned a specific producer's mirror. No default.                                                                                       |
| `ATRIB_MIRROR_DIR`  | optional | Directory to scan; recall reads every `*.jsonl` inside. Default: `~/.atrib/records/` (the spec [§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions) well-known per-agent mirror namespace). When unset, this is the path used. |
| `ATRIB_LOG_ORIGIN`  | optional | Origin used in human-readable response messages. Default: `log.atrib.dev`                                                                                                                                                                                                   |

**Mirror discovery priority** (per spec [§5.9](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#59-local-mirror-conventions)): if `ATRIB_RECORD_FILE` is set, recall reads that single file. Otherwise recall scans `ATRIB_MIRROR_DIR` and merges every `*.jsonl` inside. The directory-scan default unifies recall across producers without recall having to know per-producer naming conventions; any producer that follows the spec convention just shows up.

## Installation in an MCP host

```jsonc
{
  "mcpServers": {
    "atrib-recall": {
      "command": "node",
      "args": ["/abs/path/to/atrib/services/atrib-recall/dist/index.js"],
      "env": {},
    },
  },
}
```

Or run via `npx`:

```jsonc
{
  "mcpServers": {
    "atrib-recall": {
      "command": "npx",
      "args": ["-y", "@atrib/recall"],
    },
  },
}
```

## What this does NOT do

- **No log-inclusion verification.** Local signature verification ≠ log commitment proof. Use the log API for inclusion proofs.
- **No graph derivation.** Returns records, not the [§3.2.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#324-edge-derivation-rules) graph. For declared-relationship walks, use `recall` with `shape: "walk"` (the legacy `trace`/`trace_forward` tool names still work); for graph projections, query graph-node directly.
- **No write surface.** Read-only. Use `@atrib/attest` to sign new records.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
