# Atrib

Value provenance infrastructure for the agent economy.

Atrib makes the economic relationships between AI agents, tools, content creators, and merchants verifiable without surveillance. It is the missing infrastructure layer between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP).

## The problem

The agent economy is generating real commerce with zero verified attribution infrastructure. When an AI agent recommends a product and a user buys it, no existing system can answer: which tools, content, and agent decisions influenced that purchase? Attribution is invisible. Value pools at the platform layer.

Advertising exists because there is no native provenance infrastructure on the internet. Atrib is that infrastructure.

## What Atrib does

Atrib records the structural relationships in agent sessions — which tool calls happened, in what order, in what context — without recording the content of those interactions. When a transaction completes, the attribution chain is already there: signed, tamper-evident, and verifiable by any party.

- **Attribution records** travel with every MCP tool call, signed by the creator
- **A Merkle log** provides global verifiability without exposing content
- **An attribution graph** connects tool calls to transaction outcomes
- **Attribution policies** let creators and merchants express what contributions are worth
- **Settlement recommendations** map the graph to value distribution under agreed policies

The protocol records facts. What those facts are worth is a policy judgment made by the parties involved, not by Atrib.

## Packages

| Package | Purpose | Install |
|---------|---------|---------|
| `@atrib/mcp` | MCP server middleware — wraps an MCP server, emits signed attribution records automatically | `npm install @atrib/mcp` |
| `@atrib/agent` | Agent middleware — wraps an MCP client, propagates attribution context, detects transactions | `npm install @atrib/agent` |
| `@atrib/verify` | Merchant verification — independently verifies settlement recommendations | `npm install @atrib/verify` |

## Quick start

### MCP server (creator)

```typescript
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY
})
```

One line. Everything else is automatic. Every successful tool call emits a signed attribution record. No further code needed.

### Agent (consumer)

```typescript
import { atrib } from '@atrib/agent'

const agent = atrib(existingAgentOrMcpClient, {
  creatorKey: process.env.ATRIB_PRIVATE_KEY,
  merchantDomain: 'https://merchant.example.com'
})
```

One line. The middleware propagates attribution context on every tool call, negotiates policies at session start, and detects transactions automatically.

### Merchant (verifier)

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY
})

const result = await verifier.verify(recommendationDoc)
// { valid: true, signatureOk: true, calcMatch: true, distribution: {...} }
```

## Key generation

```
npx @atrib/cli keygen
```

Generates an Ed25519 keypair. Store `ATRIB_PRIVATE_KEY` in your environment. The public key is derived at runtime.

## Specification

The complete protocol specification is in [`atrib-spec.md`](./atrib-spec.md). It covers:

- **Section 0** — Foundations (principles, thesis)
- **Section 1** — Attribution Record Format (data model, signing, propagation)
- **Section 2** — Merkle Log Protocol (C2SP tlog-tiles, commitments, proofs)
- **Section 3** — Graph Query Interface (five edge types, deterministic derivation)
- **Section 4** — Attribution Policy Format (weights, negotiation, calculation algorithm)
- **Section 5** — SDK Specification (middleware contract, automation triggers, degradation contract)

## Design principles

1. **Provenance travels with the artifact.** Embedded at creation time, not inferred later.
2. **Accountability without content exposure.** The log stores hashes, not content.
3. **Settlement is separate from attribution.** The protocol records what happened. It does not move money.
4. **No central arbiter of value.** Trust from math and open spec, not from trusting Atrib Inc.
5. **The protocol is a public good; the product is not.** Spec and libraries are open. The queryable graph and analytics are commercial.

## Prior art

Atrib builds on and differentiates from: C2PA (provenance without closed loop), ProRata (attribution with ads), Story Protocol (provenance on blockchain), OpenTelemetry (observability without attribution semantics), LangSmith/Langfuse (agent tracing without economic attribution). See [`atrib-current-art-map.html`](./atrib-current-art-map.html) for the full competitive landscape.

## License

Apache 2.0
