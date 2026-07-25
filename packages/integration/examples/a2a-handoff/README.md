# A2A handoff evidence proof

This example targets the official `@a2a-js/sdk` JSON-RPC path. It starts an
in-process A2A specialist agent, signs the agent's `AgentCard`, sends it a
delegated task, receives an A2A v1 data-valued `Part` carrying an atrib handoff packet,
verifies that packet with `@atrib/verify`, and only then signs the receiving
agent's follow-up record with `informed_by`.

## Run it

```bash
pnpm --filter @atrib/integration a2a-handoff-proof
```

The script starts an in-process dev log and prints a JSON proof summary.

## What it proves

- The proof uses the official `@a2a-js/sdk@1.0.0` `AgentCard`, client,
  JSON-RPC transport, request handler, task store, and `AgentExecutor` surface.
- The v1 `AgentCard` declares `supportedInterfaces`, capability extensions,
  skill media modes and security requirements, security schemes, and signatures.
  The proof uses the SDK's JWS signing and verification helpers with an EdDSA
  protected header (`alg`, `typ`, and `kid`) over the JCS-canonical payload.
- The JSON-RPC bridge supplies an explicit `ServerCallContext` and preserves a
  blocking send through `returnImmediately: false`.
- The remote A2A agent returns a structured data-valued `Part`, not a prose-only blob.
- The data-valued `Part` carries an atrib handoff packet with the signed remote record,
  private body material, and log inclusion proof.
- The receiving agent verifies signer, context, body commitment, freshness, and
  log inclusion before it signs its own follow-up.
- The follow-up record resolves the remote record through `informed_by`.
- Public atrib records stay hash-only. The private task phrase appears only in
  packet-local body material.

## What it does not prove yet

This is an in-process JSON-RPC proof, not a deployed A2A server, a samples repo
PR, an A2A TCK run, a public JWKS deployment, or a trust-signal registry. It
closes the first signed-AgentCard plus handoff proof gate for public technical
claims. Rerun the SDK proof before citing this example as current evidence.
