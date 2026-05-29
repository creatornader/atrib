# @atrib/verify-mcp

MCP server exposing the `atrib-verify` cognitive primitive. It verifies counterparty handoff evidence before a receiving agent signs follow-up work that cites those records through `informed_by`.

`atrib-verify` is read-only. It does not fetch from the public log, retrieve archive bodies, or sign a follow-up record. The receiving agent supplies the evidence packet, inspects the result, and then uses `atrib-emit` or normal wrapped tool calls to continue with `informed_by` set to the accepted hashes.

## Install

```bash
npm install @atrib/verify-mcp
```

Or run it through `npx` from an MCP host:

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

If installed globally, the package exposes the `atrib-verify` binary:

```bash
npm install -g @atrib/verify-mcp
atrib-verify
```

## Tool

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

## Status

Public package for cognitive primitive #7. It depends on `@atrib/verify` for verifier semantics and keeps the MCP surface read-only.

## License

Apache-2.0.
