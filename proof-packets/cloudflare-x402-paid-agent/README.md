# Cloudflare x402 Paid Agent Proof

This packet shows how atrib frames a paid MCP or API request behind Cloudflare:
the agent asks an Action Gate policy before the paid call, the allowed action
runs, the outcome cites the decision, and a hash-only x402 lifecycle record ties
the 402 challenge, paid retry, verification, settlement, and origin response to
the same proof.

The source example is
`packages/integration/examples/cloudflare-agents/paid-x402-action-gate/`.

This is a local fixture over the Cloudflare Workers and Agents integration shape
that exists today. It does not call Cloudflare Monetization Gateway beta APIs.
When Gateway exposes lifecycle ids, logs, webhooks, or signed exports, those
facts should replace the fixture source while preserving the same proof shape.

## Files

- `verifier-output.json`: deterministic proof output from
  `pnpm --filter @atrib/integration cloudflare-x402-paid-agent-proof`.
- `redaction-manifest.json`: what was intentionally kept out of the public
  artifact.

## Verify

```bash
pnpm --filter @atrib/integration cloudflare-x402-paid-agent-proof
pnpm --filter @atrib/integration test -- cloudflare-x402-paid-agent-proof
```
