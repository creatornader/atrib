# `@atrib/recall`

MCP server for atrib. Lets agents query their own provable past from the local signed-record mirror with per-record signature verification.

The consumer-side counterpart to `@atrib/emit`: emit produces signed records, recall reads them back and exposes them to the agent through five MCP tools. Each returned record carries a `signature_verified` boolean so a poorly-written agent treats tampered records as such.

## Tool surface

The primary tool, fully implemented:

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

  // Layer 1 (additive, stub-accepted in current ship; full enforcement in
  // an upcoming release). When supplied, the schema validates the value and
  // the response includes a `layer_1_warnings` array listing each
  // stub-accepted param so callers can detect the pre-impl state without
  // reading source. Behavior is otherwise identical to the same call with
  // these params omitted.
  min_importance?: 'critical' | 'high' | 'medium' | 'low' | 'noise',
  topic_tags?: string[],
  include_revised?: boolean,
  min_signers?: number,
  rank_by?: 'timestamp' | 'relevance' | 'causal_distance',
  rank_anchor?: string,
  toc?: boolean,
})
```

Returns a `RecallResult` with `total`, `returned`, `filtered_out_by_verification`, `record_file`, `log_origin`, `pagination_caveat`, `records` (compact or full per the flag), and (when any Layer 1 param is supplied) `layer_1_warnings`.

Four additional MCP tools are registered as stubs (return a "Layer 1 in progress" notice; full handlers ship in an upcoming release). Their schemas are stable; downstream callers can wire against them now:

- `mcp__atrib-recall__recall_walk({ from_record_hash, edge_types?, depth? })` - BFS over the [§3.2.4](../../atrib-spec.md#324-edge-derivation-rules) derived graph.
- `mcp__atrib-recall__recall_annotations({ record_hash })` - return all [D058](../../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05) annotation records pointing at the given record.
- `mcp__atrib-recall__recall_revisions({ record_hash })` - return the [D059](../../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06) revision chain for the given record.
- `mcp__atrib-recall__recall_by_content({ query, k? })` - free-form text search; BM25 over summary + topics in current ship; sqlite-vec embedding similarity in a future Layer 2 ship.

## Trust scope

Signature verification is local-only. A passing `signature_verified` proves the record was signed by the named `creator_key`; it does NOT prove the record was committed to log.atrib.dev. To confirm log inclusion, fetch the inclusion proof from the log API.

## Configuration

| Env var | Required | Purpose |
|---|---|---|
| `ATRIB_RECORD_FILE` | optional | Path to the signed-record jsonl mirror to read. Default: `~/.atrib/records/mcp-wrap-claude-code.jsonl` |
| `ATRIB_LOG_ORIGIN` | optional | Origin used in human-readable response messages. Default: `log.atrib.dev` |

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
