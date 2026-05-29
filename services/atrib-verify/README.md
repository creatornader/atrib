# @atrib/verify-mcp

MCP server exposing the `atrib-verify` cognitive primitive. It verifies counterparty handoff evidence before a receiving agent signs follow-up work that cites those records through `informed_by`.

The package is read-only. It accepts caller-supplied evidence, returns accepted and rejected hashes, and leaves the follow-up signing step to `atrib-emit` or normal wrapped tool calls.

## Install

```bash
npm install @atrib/verify-mcp
```

## Tool surface

Host-specific tool names vary. The MCP tool itself is named `atrib-verify`:

```ts
mcp__atrib-verify__atrib-verify({
  packet?: unknown,
  records?: unknown[],
  claims?: unknown[],
  required_record_hashes?: string[],
  trusted_creator_keys?: string[],
  allowed_context_ids?: string[],
  require_body?: boolean,
  require_body_commitment?: boolean,
  require_log_inclusion?: boolean,
  log_public_key_b64?: string,
  max_age_ms?: number,
  now_ms?: number,
})
```

## Evidence

`packet`, `records`, and `claims` accept the same evidence shapes as `@atrib/verify`:

- [D062](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d062-local-mirror-sidecar--two-tier-private-local--public-canonical-persistence) local mirror envelopes: `{ record, proof?, _local?: { content?, args?, result? } }`
- Private continuation packets: `{ required_record_hashes, records, trusted_creator_keys?, allowed_context_ids? }`
- Bare records for signature-only checks, when body or proof checks are not required

The response returns accepted hashes plus compact per-claim evidence:

```json
{
  "primitive": "atrib-verify",
  "all_accepted": true,
  "accepted_record_hashes": ["sha256:..."],
  "accepted": [
    {
      "record_hash": "sha256:...",
      "accepted": true,
      "signature_ok": true,
      "signer_trusted": true,
      "context_allowed": true,
      "body": {
        "args_hash_present": true,
        "args_hash_ok": true,
        "result_hash_present": false,
        "result_hash_ok": null
      }
    }
  ],
  "rejected": []
}
```

## Behaviors

- **Read-only**: never signs records, submits to the log, or mutates the local mirror.
- **Caller-supplied evidence**: does not fetch from the public log or retrieve archive bodies.
- **Verifier-backed**: delegates signature, trust, body-commitment, inclusion, freshness, and context checks to `@atrib/verify`.
- **Handoff-oriented**: accepted hashes are the values the receiving agent can cite through `informed_by` when it signs follow-up work.
- **Explicit rejection**: failed claims stay visible in `rejected` instead of disappearing from the response.

## Wire-up

Run it through `npx` from an MCP host:

```json
{
  "mcpServers": {
    "atrib-verify": {
      "command": "npx",
      "args": ["-y", "@atrib/verify-mcp"]
    }
  }
}
```

Or install it globally. The package exposes the `atrib-verify` binary:

```bash
npm install -g @atrib/verify-mcp
atrib-verify
```

## Local Development

From a checkout of the atrib monorepo:

```bash
pnpm --filter @atrib/verify-mcp build
pnpm --filter @atrib/verify-mcp test
pnpm --filter @atrib/verify-mcp start
```

For local MCP host testing without npm:

```json
{
  "mcpServers": {
    "atrib-verify": {
      "command": "node",
      "args": ["/absolute/path/to/atrib/services/atrib-verify/dist/main.js"]
    }
  }
}
```

## Relationship to @atrib/verify

`@atrib/verify-mcp` depends on `@atrib/verify` for verifier semantics. The MCP package owns the agent-facing schema, stdio transport, and compact response shape.

## Status

Public package for cognitive primitive #7. It depends on `@atrib/verify` for verifier semantics and keeps the MCP surface read-only.

## License

Apache-2.0.
