# @atrib/revise

MCP server for the `atrib-revise` tool, atrib's cognitive primitive #3 per [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface).

## What it does

Supersedes a prior position with a stated reason. Produces a signed `revision` event ([spec §1.2.9](../../atrib-spec.md#129-revises), [D059](../../DECISIONS.md#d059-promote-revision-to-atrib-normative-event_type-byte-0x06)) that adds a REVISES edge to the target record in the graph layer.

Distinct from `annotate` (which adds metadata while leaving the prior intact): revision asserts the prior is no longer held. The prior record stays in the graph (records are immutable per spec §1.6), and the revision adds a graph node that supersedes it.

## Tool surface

One tool: `atrib-revise`. Narrow Zod schema requires the revision-specific fields per spec:

| Field | Required | Description |
|---|---|---|
| `revises` | yes | `sha256:<64-hex>` record_hash this revision supersedes |
| `prior_position` | yes | One-line summary of the position being superseded |
| `new_position` | yes | One-line summary of the new position replacing the prior |
| `reason` | yes | Why the revision happened (new evidence, contradicting record, model update, corrected reasoning, etc.) |
| `topics` | no | Up to 16 lowercase-hyphenated tags |
| `context_id` | no | 32-hex; defaults to `process.env.ATRIB_CONTEXT_ID` per [D078](../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default) |
| `informed_by` | no | Array of `sha256:<64-hex>` references |

## Relationship to `@atrib/emit`

Per [D079](../../DECISIONS.md#d079-the-six-core-cognitive-primitives--atribs-agent-facing-surface)'s package layering, `@atrib/revise` depends on `@atrib/emit`'s exported `handleEmit` and `resolveKey` helpers. The agent-facing tool is monomorphic (one purpose, narrow schema) but the underlying signing + chain composition + JSONL mirror writing is the canonical pipeline shared with `@atrib/emit`. A verifier MUST NOT distinguish revision records signed via this tool from those signed via `@atrib/emit`'s polymorphic surface.

When `@atrib/emit`'s pipeline evolves (chain composition fixes, env-honoring, future cross-attestation), `@atrib/revise` inherits the change automatically.

## Running

```bash
# Via the bin entry (stdio MCP host)
atrib-revise

# In an MCP host config (e.g. Claude Code)
{
  "mcpServers": {
    "atrib-revise": {
      "command": "atrib-revise"
    }
  }
}
```

Env vars (inherited from `@atrib/emit`):

- `ATRIB_PRIVATE_KEY` / `ATRIB_KEY_FILE` / macOS Keychain (`atrib-creator-<ATRIB_AGENT>` or `atrib-creator`) / `ATRIB_OP_REFERENCE`, key resolution chain
- `ATRIB_MIRROR_FILE`, JSONL mirror destination
- `ATRIB_LOG_ENDPOINT`, log.atrib.dev override
- `ATRIB_CONTEXT_ID`, default context_id per [D078](../../DECISIONS.md#d078-mcp-servers-honor-atrib_context_id-env-as-context_id-default)

## License

Apache-2.0.
