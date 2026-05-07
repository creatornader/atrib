# `@atrib/recall`

MCP server for atrib. Lets agents query their own provable past from the local signed-record mirror with per-record signature verification.

The consumer-side counterpart to `@atrib/emit`: emit produces signed records, recall reads them back and exposes them to the agent through one tool, `recall_my_attribution_history`. Each returned record carries a `signature_verified` boolean so a poorly-written agent treats tampered records as such.

## Tool surface

```typescript
mcp__atrib-recall__recall_my_attribution_history({
  // All optional
  context_id?: string,           // 32-hex. Filter to records signed under this trace.
  event_type?: 'tool_call' | 'transaction',  // Filter to a single event kind.
                                              // Short-form names are normalized to the URI form.
  limit?: number,                // Default 25, max 200.
  offset?: number,               // For pagination. Note pagination_caveat in the response.
  compact?: boolean,             // Default true — omits signature/content_id/chain_root/spec_version
                                 // fields. Set false for full record bytes (re-verification).
  include_unverified?: boolean,  // Default false — drops records whose signature didn't verify.
                                 // Set true ONLY when consuming the verbose mode AND explicitly
                                 // checking signature_verified per record.
})
```

Returns a `RecallResult` with `total`, `returned`, `filtered_out_by_verification`, `record_file`, `log_origin`, `pagination_caveat`, and `records` (compact or full per the flag).

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
