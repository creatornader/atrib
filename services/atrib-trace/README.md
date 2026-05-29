# @atrib/trace

MCP server exposing the `trace` tool, walks a record's `informed_by` chain backward to surface the reasoning chain that led to it.

Closes the consumer-side cognitive-loop primitive: recall returns raw records; trace returns the causal chain, so an agent asking "why did I do X?" can see "X was informed by Y, which was informed by Z" without manually walking `informed_by` hash-by-hash.

## Tools

Two bidirectional walk tools share the same input + response shape; only the walk direction differs:

```
mcp__atrib-trace__trace({          // BACKWARD — what informed this?
  record_hash: "sha256:<64-hex>",  // start
  depth?: number,                   // hop cap (0=start only, default 3, max 10)
  max_nodes?: number,               // safety cap (default 200, max 500)
  compact?: boolean,                // omit signature/content_id bytes (default true)
  include_content?: boolean         // include D062 local_content (default false)
})

mcp__atrib-trace__trace_forward({  // FORWARD — what was informed by this?
  record_hash, depth?, max_nodes?, compact?, include_content? // same schema
})

→ {
  start_hash, direction: "backward" | "forward",
  depth_requested, depth_reached,
  visited: [
    {
      depth, record_hash, parent_hashes, source,
      event_type, context_id, creator_key, timestamp,
      next_informed_by, next_resolved, next_dangling,
      informed_by?, tool_name?, args_hash?, result_hash?,
      sidecar_summary?: {
        tool_name?, topics?, what?, importance?, producer?,
        span_kind?, span_name?, model_name?, prompt_version?
      },
      local_content?, local_producer? // only when include_content=true
    }
  ],
  dangling: string[],
  truncated_by_depth, truncated_by_cap,
  warnings
}
```

- `trace` walks `informed_by` BACKWARD (toward causal ancestors). Answers "what informed this record?"
- `trace_forward` walks `informed_by` FORWARD (records that cited this one). Answers "I made decision X, what did I do because of it?" The dual of `trace`. Same input schema, same response shape.
- For forward walks, `next_informed_by` carries the CHILDREN visited at the next hop (records citing this one) rather than this record's own informed_by — field name kept for shape-compat with `trace`.

## Reads

Every `*.jsonl` mirror under `~/.atrib/records/` (override via `ATRIB_RECORDS_DIR`) or one explicit mirror file via `ATRIB_RECORD_FILE`. Tolerates both producer envelope shapes:

- Bare `AtribRecord` per line (legacy / wrapper convention pre-sidecar)
- `{ record, _local?, written_at }` envelope (current shape)

When the envelope carries an optional `_local` sidecar (per the local-mirror sidecar pattern shipped in `@atrib/mcp` v0.2.x), trace surfaces a compact `sidecar_summary` per record: `tool_name`, `topics`, first ~200 chars of `what`/`summary`, `importance` for annotations, and OpenInference fields such as `span_kind`, `span_name`, `model_name`, and `prompt_version` when present. Trace reads `_local.content` first, then derives the same content shape from legacy wrapper or OpenInference sidecar fields when needed. When `include_content=true`, trace also returns the full [D062](../../DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror body as `local_content` plus `local_producer`; this is intended for harness-mediated causal replay where the agent needs rich expected/actual outcome context. Without the sidecar (legacy entries), the per-record output still includes the cryptographic evidence (event_type, hashes, creator_key, timestamp), just without semantic context.

## Behaviors

- **Cycle-safe**: every record visited at most once, even with multiple parents referencing it.
- **Cap-safe**: hits `max_nodes` → returns partial result with `truncated_by_cap: true`.
- **Depth-safe**: hits `depth` → returns partial result with `truncated_by_depth: true`.
- **Dangling-aware**: `informed_by` entries pointing at records not in the local mirror surface in `dangling` and do NOT advance the walk.
- **Local-only**: reads only the local mirror. A future ship will fall back to `log.atrib.dev/v1/lookup/<hash>` for hashes not in the local mirror.
- **Bidirectional**: `trace` walks `informed_by` backward; `trace_forward` walks forward via a reverse index built per call from the same mirror (O(N) build, O(out-degree) per hop).
- **Instrumented (per [D084](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) Surface 6)**: every call writes a per-invocation jsonl entry to `~/.atrib/state/read-primitives/calls.jsonl` for the unified loop-closure analyzer. Instrumentation samples only `record_hash` fields, not `args_hash`, `result_hash`, or hashes embedded in `local_content`. Silent-failure per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract); instrumentation never blocks the trace result. `ATRIB_READ_PRIMITIVES_LOG` overrides the default path for tests.

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
