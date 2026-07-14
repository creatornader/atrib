# Cloudflare x402 Path B reference proof

This packet shows the beta-independent path for atrib and Cloudflare x402:
a Cloudflare Agent prepares a paid MCP call, an Action Gate policy allows the
paid retry, the local x402 v2 flow returns a `PAYMENT-RESPONSE`, and
`@atrib/agent` emits the agent-side Path B transaction record when the merchant
does not provide an atrib token.

The packet separates three layers:

- Open protocol surface: 402 challenge, `PAYMENT-SIGNATURE` retry, and
  `PAYMENT-RESPONSE` settlement response.
- Cloudflare surface: Agents SDK `paidTool`, `withX402`, `withX402Client`, and
  the base-sepolia test path.
- atrib surface: Action Gate decision and outcome records, Path B transaction
  emission, hash-only paid lifecycle facts, context propagation, and
  counterparty attestation over the same transaction bytes.

The source example is
`packages/integration/examples/cloudflare-agents/x402-path-b-reference/`.

The runnable proof uses open x402 v2 shapes and does not call Cloudflare
Monetization Gateway beta APIs. Once Cloudflare exposes Gateway route, rule,
payment attempt, settlement, and export fields, the same verifier path can
ingest them.

## Files

- `verifier-output.json`: proof output from
  `pnpm --filter @atrib/integration cloudflare-x402-path-b-reference`.
- `redaction-manifest.json`: payment and wallet data kept out of the public
  artifact.

## Verify

```bash
pnpm --filter @atrib/integration cloudflare-x402-path-b-reference
pnpm --filter @atrib/integration test -- cloudflare-x402-path-b-reference
```
