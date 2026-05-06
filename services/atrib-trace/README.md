# @atrib/trace

MCP server exposing the `trace` tool — walks a record's `informed_by` chain backward to surface the reasoning chain that led to it.

Closes the consumer-side cognitive-loop primitive: recall returns raw records; trace returns the causal chain, so an agent asking "why did I do X?" can see "X was informed by Y, which was informed by Z" without manually walking `informed_by` hash-by-hash.

## Tool

```
mcp__atrib-trace__trace({
  record_hash: "sha256:<64-hex>",  // start
  depth?: number,                   // hop cap (default 3, max 10)
  max_nodes?: number,               // safety cap (default 200, max 500)
  compact?: boolean                 // omit signature/content_id bytes (default true)
})
→ {
  start_hash, direction: "backward",
  depth_requested, depth_reached,
  visited: [
    {
      depth, record_hash, parent_hashes, source,
      event_type, context_id, creator_key, timestamp,
      next_informed_by, next_resolved, next_dangling,
      sidecar_summary?: { tool_name?, topics?, what?, importance?, producer? }
    }
  ],
  dangling: string[],
  truncated_by_depth, truncated_by_cap,
  warnings
}
```

## Reads

Every `*.jsonl` mirror under `~/.atrib/records/` (override via `ATRIB_RECORDS_DIR`). Tolerates both producer envelope shapes:

- Bare `AtribRecord` per line (legacy / wrapper convention pre-sidecar)
- `{ record, _local?, written_at }` envelope (current shape)

When the envelope carries an optional `_local` sidecar (per the local-mirror sidecar pattern shipped in `@atrib/mcp` v0.2.x), trace surfaces a compact `sidecar_summary` per record: `tool_name`, `topics`, first ~200 chars of `what`/`summary`, and `importance` for annotations. Without the sidecar (legacy entries), the per-record output still includes the cryptographic evidence (event_type, hashes, creator_key, timestamp) — just without the semantic context.

## Behaviors

- **Cycle-safe**: every record visited at most once, even with multiple parents referencing it.
- **Cap-safe**: hits `max_nodes` → returns partial result with `truncated_by_cap: true`.
- **Depth-safe**: hits `depth` → returns partial result with `truncated_by_depth: true`.
- **Dangling-aware**: `informed_by` entries pointing at records not in the local mirror surface in `dangling` and do NOT advance the walk.
- **Local-only (v1)**: reads only the local mirror. v2 will fall back to `log.atrib.dev/v1/lookup/<hash>` for hashes not in the local mirror.
- **Backward-only (v1)**: walks `informed_by` upstream. Forward-walk (records that reference THIS one) is a v2 concern via the graph service.

## Wire-up

Add to your MCP host config (e.g. `~/.claude.json` `mcpServers`):

```json
{
  "atrib-trace": {
    "command": "node",
    "args": ["/path/to/atrib-trace/dist/main.js"]
  }
}
```

Or run as a one-off subprocess via `pnpm --filter @atrib/trace start`.

## Status

Initial scaffold (v0.1.0). 8 tests covering: empty-mirror, single-record, one-hop walk, multi-hop chain, depth truncation, diamond fan-in, dangling references, max_nodes cap. Full workspace tests green.

The companion consumer-side primitive `atrib-summarize` (synthesizes narrative across N records) is the next ship.
