# @atrib/summarize

MCP server exposing the `summarize` tool for atrib's verifiable action layer. It synthesizes a narrative across N records using an OpenAI-compatible LLM.

Closes the consumer-side cognitive-loop primitive companion to `atrib-trace`: trace returns the declared-relationship path; summarize returns the synthesized meaning across the selected records. Both read the same local mirror including the optional `_local` sidecar.

## Install

```bash
pnpm add @atrib/summarize
```

Verify a local build with `pnpm --filter @atrib/summarize test`.

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

| Env var                       | Default                               |
| ----------------------------- | ------------------------------------- |
| `ATRIB_SUMMARIZE_API_KEY`     | fallback to provider env/cache        |
| `ATRIB_SUMMARIZE_BASE_URL`    | `https://integrate.api.nvidia.com/v1` |
| `ATRIB_SUMMARIZE_MODEL`       | `qwen/qwen3.5-397b-a17b`              |
| `ATRIB_SUMMARIZE_MAX_TOKENS`  | `4000`                                |
| `ATRIB_SUMMARIZE_TEMPERATURE` | `0.3`                                 |
| `ATRIB_SUMMARIZE_TIMEOUT_MS`  | `120000`                              |

Provider env/cache fallback:

| Provider URL contains      | Env var              | Cache file                            |
| -------------------------- | -------------------- | ------------------------------------- |
| `integrate.api.nvidia.com` | `NVIDIA_API_KEY`     | `~/.atrib/secrets/nvidia-api-key`     |
| `api.cerebras.ai`          | `CEREBRAS_API_KEY`   | `~/.atrib/secrets/cerebras-api-key`   |
| `cloudflare.com`           | `CLOUDFLARE_API_KEY` | `~/.atrib/secrets/cloudflare-api-key` |

Without an API key, the tool returns a warnings-only response per the [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) graceful-degradation contract.

## Reads

Same as `@atrib/trace`: every `*.jsonl` mirror under `~/.atrib/records/` (override via `ATRIB_RECORDS_DIR`). Tolerates both legacy bare-record and current envelope shapes.

Summarize reads `_local.content` first, then derives the same content shape from legacy wrapper or OpenInference sidecar fields when needed. OpenInference content can add span kind/name, tool/agent/model, prompt identifiers and templates, input/output, usage, cost, score, metadata, and topics to the synthesis prompt. Those fields stay local sidecar payload per [D108](../../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload); they are not promoted to signed protocol fields.

When a record lacks usable local content (legacy entry), the prompt includes a marker telling the LLM the input is impoverished, only event_type + cryptographic metadata is available, so the synthesis can be honest about gaps. The output reports `records_with_sidecar` and `records_without_sidecar` counts so callers know how rich the input was.

## Behaviors

- **Selection**: `record_hashes` ∪ records-with-matching-`context_id`, deduplicated.
- **Capping**: chronological-ascending sort, then take `max_records`. Skipped count surfaced.
- **Honest input flagging**: a per-record line in the prompt marks records lacking semantic content; the system prompt instructs the LLM not to invent semantics.
- **Network access only on LLM call**: storage reads are local, but the selected record content is sent to the configured LLM endpoint (NVIDIA NIM by default) to produce the narrative. This is the one read primitive that sends mirror content off-machine. Point `ATRIB_SUMMARIZE_BASE_URL` at a self-hosted or local model to keep record content on-machine. Tests use the same FORBIDDEN_HOSTS guard as the rest of the workspace to prevent fixture leakage.
- **No retry on LLM failure**: surfaces the error in `warnings` and returns null narrative. Caller decides whether to retry with smaller `max_records` or different model.
- **Instrumented (per [D084](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) Surface 6)**: every call writes a per-invocation jsonl entry to `~/.atrib/state/read-primitives/calls.jsonl` for the unified loop-closure analyzer. Includes `elapsed_ms` covering the full LLM round-trip plus `errored: true` on LLM failure paths. Silent-failure per [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract); instrumentation never blocks the summarize response. `ATRIB_READ_PRIMITIVES_LOG` overrides the default path for tests.

## Wire-up

Add to your MCP host config:

```json
{
  "atrib-summarize": {
    "command": "npx",
    "args": ["-y", "@atrib/summarize"],
    "env": {
      "ATRIB_SUMMARIZE_MODEL": "qwen/qwen3.5-397b-a17b"
    }
  }
}
```

From a monorepo checkout, use `"command": "node"` with
`"args": ["/path/to/atrib-summarize/dist/main.js"]` instead. The API key can
live in the host env or in the cache file above. Do not write secret values
into shared MCP config.

## Relationship to the attest/recall rename ([D164](../../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse))

`summarize` has no successor shape in the `recall` verb. `recall` returns
verified material; the caller synthesizes. `@atrib/summarize` stays
mounted through the alias window. When the window closes, the npm package
is deprecated without a replacement pointer.

## Status

Published and maintained. Unit tests cover record selection (by hash, by context, unioned, missing-skip) and the degradation paths (no inputs, no API key). An integration test against a real LLM is gated behind `ATRIB_SUMMARIZE_API_KEY` and not run in CI.

The companion `atrib-trace` is the structural primitive; together they close the consumer side of the cognitive loop.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
