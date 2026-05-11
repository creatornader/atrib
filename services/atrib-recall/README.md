# `@atrib/recall`

MCP server for atrib. Lets agents query their own provable past from the local signed-record mirror with per-record signature verification.

The consumer-side counterpart to `@atrib/emit`: emit produces signed records, recall reads them back and exposes them to the agent through five MCP tools. Each returned record carries a `signature_verified` boolean so a poorly-written agent treats tampered records as such.

## Tool surface

Five MCP tools cover the cognitive surface of the local mirror.

### `recall_my_attribution_history`

The base filter-rank-page tool over the local mirror.

```typescript
mcp__atrib-recall__recall_my_attribution_history({
  // All optional
  context_id?: string,           // 32-hex. Filter to records signed under this trace.
  event_type?: 'tool_call' | 'transaction' | 'annotation' | 'revision',
                                 // Filter to a single event kind. Short-form names are normalized
                                 // to the URI form.
  content_id?: string,           // sha256:... exact match on §1.2.2 content_id.
  tool_name?: string,            // §8.2 disclosed tool name; records without disclosure excluded.
  args_hash?: string,            // sha256:... §8.3 args_hash exact match.
  limit?: number,                // Default 25, max 200.
  offset?: number,               // For pagination. Note pagination_caveat in the response.
  compact?: boolean,             // Default true - omits signature/content_id/chain_root/spec_version
                                 // fields. Set false for full record bytes (re-verification).
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

Returns `{ total, returned, filtered_out_by_verification, record_files, record_file, log_origin, pagination_caveat, records }`. Each record carries `annotations` (when annotation records point at it) and `superseded_by` (when revision records point at it).

### Sibling tools

- `mcp__atrib-recall__recall_walk({ from_record_hash, edge_types?, depth? })` - walks the local derived graph from `from_record_hash` up to `depth` hops (default 3), returning each reachable record_hash + weighted distance. Edge types: CHAIN_PRECEDES (weight 1), INFORMED_BY (weight 1), ANNOTATES (weight 2), REVISES (weight 2). SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, and PROVENANCE_OF are deferred to subsequent releases.

- `mcp__atrib-recall__recall_annotations({ record_hash })` - returns the aggregated annotation summary (max_importance, union of topics, latest summary) for the target record. Returns `annotations: null` when no annotation points at the record.

- `mcp__atrib-recall__recall_revisions({ record_hash })` - returns the forward revision chain for the target record. Each entry's revises field points at the prior entry; the chain follows the first-by-timestamp revision at each step. Sibling fan-out (parallel revisions of the same target) requires calling `recall_my_attribution_history` with event_type=revision and inspecting `content.revises` manually.

- `mcp__atrib-recall__recall_by_content({ query, k? })` - BM25 free-form retrieval over each record's annotation summary + topic_tags, then reranked by Park et al. weighted-sum scoring (recency + importance + relevance). Default k=10, max 50. Records with no annotation contribute no relevance signal (will only surface via the recency + importance fallback). Layer 2 (sqlite-vec sidecar, separate ship) extends with embedding similarity over the same indexed text.

### Tunable weights

The Park et al. ranking weights and recency time constant are environment-tunable for per-axis sensitivity studies:

| Env var | Default | Role |
|---|---|---|
| `ATRIB_RECALL_ALPHA` | 0.3 | Recency component weight |
| `ATRIB_RECALL_BETA` | 0.3 | Importance component weight |
| `ATRIB_RECALL_GAMMA` | 0.4 | Relevance (BM25) component weight |
| `ATRIB_RECALL_TAU_DAYS` | 7 | Exponential-decay time constant for recency |

The implementation does not enforce that alpha + beta + gamma sum to 1.0; the operator-facing defaults do.

## Trust scope

Signature verification is local-only. A passing `signature_verified` proves the record was signed by the named `creator_key`; it does NOT prove the record was committed to log.atrib.dev. To confirm log inclusion, fetch the inclusion proof from the log API.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `ATRIB_RECORD_FILE` | optional | Path to a single signed-record jsonl mirror to read. When set, overrides directory scanning. Back-compat with pre-0.4.0 callers that pinned a specific producer's mirror. No default. |
| `ATRIB_MIRROR_DIR` | optional | Directory to scan; recall reads every `*.jsonl` inside. Default: `~/.atrib/records/` (the spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions) well-known per-agent mirror namespace). When unset, this is the path used. |
| `ATRIB_LOG_ORIGIN` | optional | Origin used in human-readable response messages. Default: `log.atrib.dev` |

**Mirror discovery priority** (per spec [§5.9](../../atrib-spec.md#59-local-mirror-conventions)): if `ATRIB_RECORD_FILE` is set, recall reads that single file. Otherwise recall scans `ATRIB_MIRROR_DIR` and merges every `*.jsonl` inside. The directory-scan default unifies recall across producers without recall having to know per-producer naming conventions; any producer that follows the spec convention just shows up.

## Installation in an MCP host

```jsonc
{
  "mcpServers": {
    "atrib-recall": {
      "command": "node",
      "args": ["/abs/path/to/atrib/services/atrib-recall/dist/index.js"],
      "env": {}
    }
  }
}
```

Or run via `npx`:

```jsonc
{
  "mcpServers": {
    "atrib-recall": {
      "command": "npx",
      "args": ["-y", "@atrib/recall"]
    }
  }
}
```

## What this does NOT do

- **No log-inclusion verification.** Local signature verification ≠ log commitment proof. Use the log API for inclusion proofs.
- **No graph derivation.** Returns records, not the [§3.2.4](../../atrib-spec.md#324-edge-derivation-rules) graph. For that, use `@atrib/trace` (causal chain) or query graph-node directly.
- **No write surface.** Read-only. Use `@atrib/emit` to sign new records.
