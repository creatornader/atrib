# Add verifiable records to stateless MCP calls

An atrib MCP server is a request-shaped proof service, not a
conversation-shaped process. A complete request carries its own protocol
version, client capabilities, attribution context, trace context, and write
retry identity. The server can restart between calls without requiring the
client to repair a transport session.

This model lets an existing tool call gain a signed result receipt without
moving the agent loop into a new runtime:

1. The client sends an ordinary MCP tool request with
   `dev.atrib/attribution` in request metadata.
2. The server runs the tool and signs the selected action facts.
3. The result carries the tool content plus a machine-readable receipt.
4. Any verifier can check the attached record locally with the creator's
   Ed25519 public key.

The signed record is durable application state. Stateless transport means the
server does not depend on a prior connection, initialize exchange, or session
header. It does not mean the action has no history.

## Run the proofs

From this repository:

```bash
# build atribd and its workspace dependency closure
pnpm --filter '@atrib/daemon...' build

# atribd through the stable MCP 2026-07-28 client
pnpm --filter @atrib/daemon test -- -t \
  "negotiates and lists tools with the stable v2 client"

# atrib's TypeScript client through an independent Python server
pnpm --filter @atrib/sdk test -- independent-mcp-server.test.ts

# the standard-library Python client request and receipt path
python -m pip install -e 'python[dev]'
python -m pytest python/tests/test_mcp_client.py

# any upstream MCP server through the wrapper boundary
pnpm --filter @atrib/mcp-wrap smoke:filesystem
```

The independent server imports no atrib package and no MCP package. The test
verifies discovery, request negotiation, the propagation token, record hash,
creator key, context id, chain root, and Ed25519 signature. The wrapper smoke
starts a real filesystem MCP server and checks that its normal result still
arrives with a signed mirror record.

The language-neutral request, receipt, degradation, and negative fixtures live
under
[`spec/conformance/mcp-extension/`](../spec/conformance/mcp-extension/).
The extension contract and a standalone server are in
[`docs/extensions/dev.atrib-attribution/`](extensions/dev.atrib-attribution/).

## Native server path

Use the native path when you own the MCP server. Advertise
`dev.atrib/attribution` in `server/discover`, read its request metadata on each
call, and emit a receipt only when that request negotiated the extension.
[`@atrib/mcp`](../packages/mcp/README.md) supplies the signing middleware and
receipt helpers.

The request must be complete at the boundary:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "charge_card",
    "arguments": { "invoice_id": "inv-7" }
  },
  "_meta": {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": {
      "name": "billing-agent",
      "version": "1.0.0"
    },
    "io.modelcontextprotocol/clientCapabilities": {
      "extensions": {
        "dev.atrib/attribution": {
          "version": "0.1",
          "accept": ["token", "record"]
        }
      }
    },
    "dev.atrib/attribution": {
      "context_id": "0123456789abcdef0123456789abcdef"
    },
    "dev.atrib/idempotencyKey": "invoice7"
  }
}
```

The exact wire schema is defined by the
[`dev.atrib/attribution` v0.1 document](extensions/dev.atrib-attribution/v0.1.md).
Use a stable action-bound idempotency key when retrying a write after a timeout
or disconnect. Reusing a key with changed arguments is an error.

## Existing server path

Use [`@atrib/mcp-wrap`](../packages/mcp-wrap/README.md) when you do not own the
upstream server. Point the host at `atrib-wrap` instead of the upstream binary.
The agent loop and tool schema stay unchanged. The wrapper exposes a native
MCP 2026-07-28 boundary, signs request and outcome commitments, and can talk to
an older upstream MCP implementation behind that boundary.

The outer boundary can therefore be native v2 while the wrapped dependency
remains a compatibility component. Operational reports must keep those two
facts separate.

## Client SDK path

Use [`@atrib/sdk`](../packages/sdk/README.md) or the
[`atrib` Python SDK](../python/README.md) for daemon-backed `attest` and
`recall`. Both clients send the full stateless metadata envelope by default,
negotiate attribution receipts, expose the observed transport facts, and use
the same write idempotency model.

Application code that owns a non-MCP execution boundary can use the TypeScript
SDK's `action()` helper. It signs a request, executes the existing function,
then signs a linked success or failure outcome. It does not replace or own the
agent loop.

## Integration map

| Existing system | Integration point                                                                             | Runnable proof                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Tool gateway    | Native `dev.atrib/attribution` server capability or an `@atrib/mcp-wrap` outer boundary       | `pnpm --filter @atrib/mcp-wrap smoke:filesystem`                                                                                   |
| Agent framework | `@atrib/agent` callback middleware, `@atrib/openinference` span intake, or MCP middleware     | The framework examples cataloged in the [root README](../README.md#examples-and-proofs)                                            |
| Cloud agent     | The same request metadata and receipt contract over a hosted Streamable HTTP endpoint         | [`packages/integration/examples/cloudflare-agents/`](../packages/integration/examples/cloudflare-agents/)                          |
| Commerce system | Signed tool request and outcome plus payment or authorization evidence selected by the host   | [`docs/payments-profile.md`](payments-profile.md) and the x402/AP2 examples in the [root README](../README.md#examples-and-proofs) |
| Audit system    | Store or forward the receipt, then verify the record and any disclosed evidence independently | `pnpm --filter @atrib/sdk test -- independent-mcp-server.test.ts`                                                                  |

## What the receipt proves

A valid receipt proves that the holder of the named creator key signed the
attached record bytes and that the record commits to the disclosed action
facts. A log inclusion proof can also prove that the commitment was accepted at
a particular log position.

The receipt alone does not prove that a tool result is true, that a side effect
occurred, that the signer was authorized, or that a real-world counterparty
agreed. Those claims need the relevant host, authorization, tool-side,
counterparty, or transparency-log evidence. atrib keeps those evidence checks
separate so a valid signature cannot be mistaken for independent truth.

## Operations

- Retry reads as complete new requests.
- Retry writes with the same complete arguments and idempotency key.
- Treat an indeterminate write as unresolved until the same key returns a
  completed result.
- Cache `tools/list` only for its advertised `ttlMs` and `cacheScope`.
- Diagnose protocol version, request metadata, routing headers, result metadata,
  and daemon health. Do not repair a removed transport session.
- Keep signing keys, mirrors, idempotency state, and authorization policy
  isolated by operator profile.

The detailed daemon evidence packet and restart procedure are in the
[`atribd` runbook](../services/atribd/README.md#request-diagnosis).
