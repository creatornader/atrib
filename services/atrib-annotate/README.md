# @atrib/annotate

MCP server for the `atrib-annotate` tool — atrib's cognitive primitive #2 per [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface).

## What it does

Marks a past record's importance and meaning without superseding it. Produces a signed `annotation` event ([spec §1.2.4](../../atrib-spec.md#124-event_type-values) byte `0x05`, [D058](../../DECISIONS.md#d058-promote-annotation-to-atrib-normative-event_type-byte-0x05)) that adds an ANNOTATES edge to the target record in the graph layer.

Distinct from `revise` (which supersedes a prior position): annotation leaves the target intact and adds metadata; revision asserts the prior is no longer held.

## Tool surface

One tool: `atrib-annotate`. Narrow Zod schema requires the annotation-specific fields per spec:

| Field | Required | Description |
|---|---|---|
| `annotates` | yes | `sha256:<64-hex>` record_hash this annotation describes |
| `importance` | yes | `critical` \| `high` \| `medium` \| `low` \| `noise` |
| `summary` | yes | One-line gist (≤ 2048 chars) |
| `topics` | no | Up to 16 lowercase-hyphenated tags |
| `context_id` | no | 32-hex; defaults to `process.env.ATRIB_CONTEXT_ID` per [D078](../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) |
| `informed_by` | no | Array of `sha256:<64-hex>` references |

## Relationship to `@atrib/emit`

Per [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s package layering, `@atrib/annotate` depends on `@atrib/emit`'s exported `handleEmit` and `resolveKey` helpers. The agent-facing tool is monomorphic (one purpose, narrow schema) but the underlying signing + chain composition + JSONL mirror writing is the canonical pipeline shared with `@atrib/emit`. A verifier MUST NOT distinguish annotation records signed via this tool from those signed via `@atrib/emit`'s polymorphic surface.

When `@atrib/emit`'s pipeline evolves (chain composition fixes, env-honoring, future cross-attestation), `@atrib/annotate` inherits the change automatically.

## Running

```bash
# Via the bin entry (stdio MCP host)
atrib-annotate

# In an MCP host config (e.g. Claude Code)
{
  "mcpServers": {
    "atrib-annotate": {
      "command": "atrib-annotate"
    }
  }
}
```

Env vars (inherited from `@atrib/emit`):

- `ATRIB_PRIVATE_KEY` / `ATRIB_KEY_FILE` / macOS Keychain (`atrib-creator-<ATRIB_AGENT>` or `atrib-creator`) / `ATRIB_OP_REFERENCE` — key resolution chain
- `ATRIB_MIRROR_FILE` — JSONL mirror destination
- `ATRIB_LOG_ENDPOINT` — log.atrib.dev override
- `ATRIB_CONTEXT_ID` — default context_id per [D078](../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)

## License

Apache-2.0.
