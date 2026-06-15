# A2A handoff evidence proof

This example targets the official `@a2a-js/sdk` JSON-RPC path. It starts an
in-process A2A specialist agent, signs the agent's `AgentCard`, sends it a
delegated task, receives an A2A `DataPart` carrying an atrib handoff packet,
verifies that packet with `@atrib/verify`, and only then signs the receiving
agent's follow-up record with `informed_by`.

## Run it

```bash
pnpm --filter @atrib/integration a2a-handoff-proof
```

The script starts an in-process dev log and prints a JSON proof summary.

## What it proves

- The proof uses the official `@a2a-js/sdk@0.3.13` `AgentCard`, client,
  JSON-RPC transport, request handler, task store, and `AgentExecutor` surface.
- The `AgentCard` carries one `AgentCardSignature` with a JWS protected header
  (`alg: EdDSA`, `typ: JOSE`, and `kid`) over the JCS-canonical card payload
  with `signatures` omitted, then the proof verifies that signature before
  reporting success.
- The remote A2A agent returns a structured `DataPart`, not a prose-only blob.
- The `DataPart` carries an atrib handoff packet with the signed remote record,
  private body material, and log inclusion proof.
- The receiving agent verifies signer, context, body commitment, freshness, and
  log inclusion before it signs its own follow-up.
- The follow-up record resolves the remote record through `informed_by`.
- Public atrib records stay hash-only. The private task phrase appears only in
  packet-local body material.

## What it does not prove yet

This is an in-process JSON-RPC proof, not a deployed A2A server, a samples repo
PR, an A2A TCK run, a public JWKS deployment, or a trust-signal registry. It
closes the first signed-AgentCard plus handoff proof gate for future public
claims. A public writeup should still refresh the SDK route and choose a narrow
technical scope before citing this example.
