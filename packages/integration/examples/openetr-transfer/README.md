# OpenETR transfer proof

This example wraps an OpenETR-shaped MCP fixture with `@atrib/mcp-wrap`.
It signs `openetr_issue -> openetr_transfer_initiate ->
openetr_transfer_accept -> openetr_query_state` while keeping object digest,
party keys, relay URL, event ids, and document labels hash-only.

The default run uses `openetr-fixture-mcp.ts`, not a live OpenETR relay. The
fixture follows OpenETR's current event family: `31415` for origin and `31416`
for control-transfer actions. It also models the transfer-accept `p` tag
ambiguity called out in the crosswalk, so the policy artifact escalates before
recognized title transfer.

Run the local fixture proof:

```bash
pnpm --filter @atrib/integration openetr-transfer-packet
```

Write the proof artifacts:

```bash
ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration openetr-transfer-packet
```

The checked artifact lands in `proof-packets/openetr-transfer/`.

Run the source-backed local-relay proof:

```bash
OPENETR_SOURCE_DIR=/path/to/trbouma/openetr \
  ATRIB_PACKET_WRITE_ARTIFACTS=1 \
  pnpm --filter @atrib/integration openetr-transfer-source-packet
```

That path imports the pinned OpenETR Python implementation, publishes origin,
transfer-initiate, and transfer-accept events to a local WebSocket Nostr relay,
queries state through OpenETR's query service, and writes a sanitized
`source-run-output.json`.

## Proof boundary

This is a fixture proof. It proves:

- `@atrib/mcp-wrap` signs each OpenETR-shaped tool call.
- The signed records verify.
- The proof packet keeps raw OpenETR payload material private.
- The source-backed mode can bind the packet to real OpenETR Python issue,
  transfer, accept, and query code at commit `c97eb84f5790ff041ad14a1c30df0f71ceb8d3d9`.
- The signed control-record policy decision refuses to treat the accept event
  as recognized title transfer without public relay, title-transfer authority,
  legal-title-transfer, or MLETR evidence.

It does not prove public OpenETR event availability, legal title transfer,
MLETR compliance, or title-transfer authority recognition.

## Live upstream path

A live proof should wait for a pinned OpenETR state-transition fixture or stable
adapter command. The live proof should capture OpenETR event ids, relay query
output, and attestor or title-transfer authority evidence as archive material,
then submit narrow atrib records only after the whole flow verifies.
