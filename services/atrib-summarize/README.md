# @atrib/summarize

MCP server exposing the `summarize` tool — synthesizes a narrative across N records using an OpenAI-compatible LLM.

Closes the consumer-side cognitive-loop primitive companion to `atrib-trace`: trace returns the causal chain (structural); summarize returns the synthesized meaning across the chain (semantic). Both read the same local mirror including the optional `_local` sidecar.

## Tool

```
mcp__atrib-summarize__summarize({
  context_id?: string,        // 32-hex trace; summarize all records in it
  record_hashes?: string[],   // explicit list; unioned with context_id
  focus?: string,             // optional steering for the synthesis
  max_records?: number,       // cap on records fed to LLM (default 50, max 200)
  model?: string              // override model from env
})
→ {
  narrative: string | null,
  cited_record_hashes: string[],
  records_summarized: number,
  records_skipped: number,           // beyond max_records
  records_with_sidecar: number,      // had semantic content
  records_without_sidecar: number,   // legacy bare records, impoverished input
  model_used: string | null,
  warnings: string[]
}
```

## LLM provider

OpenAI-compatible HTTP. Defaults to NVIDIA NIM with `qwen/qwen3.5-397b-a17b`. Override via env or per-call `model` input:

| Env var | Default |
|---|---|
| `ATRIB_SUMMARIZE_API_KEY` | (fallback to `NVIDIA_API_KEY` then `NVIDIA_NIM_API_KEY`) |
| `ATRIB_SUMMARIZE_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| `ATRIB_SUMMARIZE_MODEL` | `qwen/qwen3.5-397b-a17b` |
| `ATRIB_SUMMARIZE_MAX_TOKENS` | `4000` |
| `ATRIB_SUMMARIZE_TEMPERATURE` | `0.3` |
| `ATRIB_SUMMARIZE_TIMEOUT_MS` | `120000` |

Without an API key, the tool returns a warnings-only response per the §5.8 graceful-degradation contract.

## Reads

Same as `@atrib/trace`: every `*.jsonl` mirror under `~/.atrib/records/` (override via `ATRIB_RECORDS_DIR`). Tolerates both legacy bare-record and current envelope shapes.

When a record lacks a `_local` sidecar (legacy entry), the prompt includes a marker telling the LLM the input is impoverished — only event_type + cryptographic metadata is available — so the synthesis can be honest about gaps. The output reports `records_with_sidecar` and `records_without_sidecar` counts so callers know how rich the input was.

## Behaviors

- **Selection**: `record_hashes` ∪ records-with-matching-`context_id`, deduplicated.
- **Capping**: chronological-ascending sort, then take `max_records`. Skipped count surfaced.
- **Honest input flagging**: a per-record line in the prompt marks records lacking semantic content; the system prompt instructs the LLM not to invent semantics.
- **Network access only on LLM call**: storage reads are local. Tests use the same FORBIDDEN_HOSTS guard as the rest of the workspace to prevent fixture leakage.
- **No retry on LLM failure**: surfaces the error in `warnings` and returns null narrative. Caller decides whether to retry with smaller `max_records` or different model.

## Wire-up

Add to your MCP host config:

```json
{
  "atrib-summarize": {
    "command": "node",
    "args": ["/path/to/atrib-summarize/dist/main.js"],
    "env": {
      "NVIDIA_API_KEY": "..."
    }
  }
}
```

## Status

Initial scaffold (v0.1.0). 6 unit tests covering record selection (by hash, by context, unioned, missing-skip) + degradation paths (no inputs, no API key). Integration test against a real LLM is gated behind `ATRIB_SUMMARIZE_API_KEY` and not run in CI.

The companion `atrib-trace` is the structural primitive; together they close the consumer side of the cognitive loop.
