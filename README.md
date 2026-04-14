# atrib

Value provenance infrastructure for the agent economy.

atrib makes the economic relationships between AI agents, tools, content creators, and merchants verifiable without surveillance. It sits between identity (DIF/W3C) and payment rails (ACP/UCP/x402/MPP/AP2), a layer that doesn't exist yet.

## The problem

The agent economy is generating real commerce with zero verified attribution infrastructure. When an AI agent recommends a product and a user buys it, no existing system can answer: which tools, content, and agent decisions influenced that purchase? Attribution is invisible. Value pools at the platform layer.

Advertising exists because there is no native provenance infrastructure on the internet. atrib is that infrastructure.

## What atrib does

atrib records the structural relationships in agent sessions, which tool calls happened, in what order, in what context, without recording the content of those interactions. When a transaction completes, the attribution chain is already there: signed, tamper-evident, and verifiable by any party.

- Attribution records travel with every MCP tool call, signed by the creator (Ed25519, JCS-canonicalized)
- A Merkle log provides global verifiability without exposing content (C2SP tlog-tiles, Tessera-backed)
- An attribution graph connects tool calls to transaction outcomes via five deterministically-derived edge types
- Attribution policies let creators and merchants express what contributions are worth
- Settlement recommendations map the graph to value distribution under agreed policies

The protocol records facts. What those facts are worth is a policy judgment made by the parties involved, not by atrib.

## Two coverage surfaces

Two things determine whether atrib works for you: which MCP framework you use, and which payment protocol your merchants are on. One install covers both.

### MCP framework adapters

| Framework                                              | Adapter helper                                                                                                                 | Status                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| **Raw `@modelcontextprotocol/sdk` Client**             | `wrapMcpClient(client, interceptor, { serverUrl? })`                                                                           | ✅ Shipped                                        |
| **Claude Agent SDK** (in-process tools, Case A)        | Zero code, wrap the SDK's `McpServer` instance directly with `@atrib/mcp`'s `atrib()`                                         | ✅ Shipped                                        |
| **Claude Agent SDK** (third-party MCP servers, Case B) | `createAtribProxy({ upstream, interceptor })` from `@atrib/mcp`                                                                | ✅ Shipped                                        |
| **Cloudflare Agents**                                  | `attributeCloudflareAgentMcp(agent, { interceptor, serverUrls })`                                                              | ✅ Shipped                                        |
| **Vercel AI SDK MCP**                                  | `attributeVercelAiSdkMcp(mcpClient, { interceptor, serverUrl })`                                                               | ✅ Shipped                                        |
| **LangChain JS MCP adapters**                          | `attributeLangchainMcp(multiClient, { interceptor, serverUrls })` (high-level) or `wrapMcpClient` + `loadMcpTools` (low-level) | ✅ Shipped                                        |
| OpenAI Agents SDK                                      |,                                                                                                                              | ⏳ Planned, meaningfully different architecture  |
| Mastra                                                 |,                                                                                                                              | ⏳ Planned, smaller footprint                    |

The full adapter table with quick-start snippets for every framework is in [`packages/agent/README.md`](packages/agent/README.md).

### Agent payment protocols

atrib **detects** transaction events from any of these, it does not implement payments, move money, or enforce transactions. The detection logic for all six protocols ships in `@atrib/agent`'s `transaction.ts` and runs simultaneously; you do not choose a payment protocol at install time.

| Protocol     | Sponsor                                     | Detection signal                                                   | Spec ref |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------ | -------- |
| **ACP**      | Stripe / OpenAI (Agentic Commerce Protocol) | `status === "completed"` + embedded `order` on checkout completion | §1.7.1   |
| **UCP**      | Universal Commerce Protocol                 | Same as ACP + top-level `ucp.version` envelope                     | §1.7.2   |
| **x402**     | Coinbase                                    | HTTP `PAYMENT-RESPONSE` header on success response                 | §1.7.3   |
| **MPP**      | Tempo Labs / Stripe (IETF draft)            | HTTP `Payment-Receipt` header on success response                  | §1.7.4   |
| **AP2**      | Google (Agent Payments Protocol)            | A2A DataPart with `ap2.mandates.PaymentMandate`                    | §1.7.5   |
| **a2a-x402** | Google (AP2 crypto path)                    | A2A task `metadata["x402.payment.status"] === "payment-completed"` | §1.7.5   |

## Try it in one command

The `@atrib/integration` package has a runnable demo that wires together everything in a single process: a fake MCP merchant tool server, a fake AI agent, the production transaction-detection logic, and a dev-mode Merkle log. One command, one terminal.

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

Output (colorized in a real terminal):

```
[demo] starting dev log...
[demo] dev log running at http://127.0.0.1:55013
[log]  +tool_call   ctx=73df4367… chain=sha256:d5a8f8996… idx=0
[log]  +tool_call   ctx=73df4367… chain=sha256:7e5ae4b5b… idx=1
[log]  +transaction ctx=73df4367… chain=sha256:cda3d448c… idx=2
[demo] 3 records in the log (2 tool_call, 1 transaction)
```

The signed records, chain hashes, and transaction detection are all real production code paths. The fakes are the surrounding environment (hardcoded search results, stubbed x402 payment header), not the protocol. See [`packages/integration/examples/end-to-end/`](packages/integration/examples/end-to-end/) for the full walkthrough.

## Packages

| Package                                | Purpose                                                                                                                                 | Customer doc                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@atrib/mcp`                           | MCP server middleware, wraps an MCP server, emits signed attribution records automatically                                             | [`packages/mcp/README.md`](packages/mcp/README.md)                 |
| `@atrib/agent`                         | Agent middleware, interceptor + framework adapters for raw SDK, Claude Agent SDK, Cloudflare Agents, Vercel AI SDK, LangChain JS       | [`packages/agent/README.md`](packages/agent/README.md)             |
| `@atrib/verify`                        | Merchant verification, independently verifies settlement recommendations against the spec §4.6 calculation                             | [`packages/verify/README.md`](packages/verify/README.md)           |
| `@atrib/log-dev` _(private, dev only)_ | In-memory development Merkle log stub, implements spec §2.6 for local testing and the end-to-end demo. **Never deploy to production.** | [`packages/log-dev/README.md`](packages/log-dev/README.md)         |
| `@atrib/integration` _(private)_       | Cross-package end-to-end tests + the runnable framework examples                                                                        | [`packages/integration/README.md`](packages/integration/README.md) |

> **Status:** v1 SDK is feature-complete in this monorepo (481 tests across all packages, plus a shared spec §2.6.1 conformance corpus at [`spec/conformance/2.6.1/`](spec/conformance/2.6.1/)). Public packages (`@atrib/mcp`, `@atrib/agent`, `@atrib/verify`) are not yet published to npm. Use `pnpm install` at the workspace root and import via `workspace:*` until publication. A production Merkle log with real RFC 6962 proofs is at [`services/log-node/`](services/log-node/); the hosted service at `log.atrib.dev/v1` is not yet deployed.

## Quick start

### MCP server (creator side)

```typescript
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY,
  serverUrl: 'https://my-tool.example.com',
})
```

One line. Everything else is automatic: every successful tool call emits a signed attribution record, propagates W3C trace context, and submits to the configured log endpoint asynchronously.

### Agent (consumer side), pick your framework

`@atrib/agent` exports one interceptor (`atrib()`) plus an adapter helper per framework. The adapter name varies because each framework's surface varies, but `atrib()` setup is the same everywhere. See [`packages/agent/README.md`](packages/agent/README.md) for side-by-side quick-starts.

| Example                                                          | Path                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Vercel AI SDK + AI Gateway routing                               | [`packages/integration/examples/vercel-ai-sdk/`](packages/integration/examples/vercel-ai-sdk/)         |
| Claude Agent SDK (Case A in-process + Case B proxy)              | [`packages/integration/examples/claude-agent-sdk/`](packages/integration/examples/claude-agent-sdk/)   |
| Cloudflare Agents (server-side `McpAgent` + client-side `Agent`) | [`packages/integration/examples/cloudflare-agents/`](packages/integration/examples/cloudflare-agents/) |
| LangChain JS (`MultiServerMCPClient` and `loadMcpTools`)         | [`packages/integration/examples/langchain-js/`](packages/integration/examples/langchain-js/)           |
| End-to-end runnable demo (all moving parts in one process)       | [`packages/integration/examples/end-to-end/`](packages/integration/examples/end-to-end/)               |

### Merchant (verifier)

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY,
})

const result = await verifier.verify(recommendationDoc)
// { valid: true, signatureOk: true, calcMatch: true, distribution: {...} }
```

Verification runs the spec §4.6 calculation algorithm locally (a pure function of graph + policy) and compares the result against what the recommendation document claims. No trust in any intermediary required.

## Key generation

A v1 keypair is a base64url-encoded 32-byte Ed25519 seed (§5.6 of the spec). Until a dedicated CLI ships, generate one inline:

```bash
node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
```

Store the result as `ATRIB_PRIVATE_KEY` in your environment. The public key is derived at runtime, only the seed needs to be secured.

## Specification

The complete protocol specification is in [`atrib-spec.md`](./atrib-spec.md). It covers:

- **Section 0**, Foundations (principles, thesis)
- **Section 1**, Attribution Record Format (data model, signing, propagation, transaction event hooks for all 6 payment protocols)
- **Section 2**, Merkle Log Protocol (C2SP tlog-tiles, commitments, proofs, witnessing)
- **Section 3**, Graph Query Interface (five edge types, deterministic derivation)
- **Section 4**, Attribution Policy Format (weights, negotiation, calculation algorithm)
- **Section 5**, SDK Specification (middleware contract, automation triggers, degradation contract)

## Design principles

1. Provenance travels with the artifact. Embedded at creation time, not inferred later.
2. Accountability without content exposure. The log stores hashes, not content.
3. Settlement is separate from attribution. The protocol records what happened. It does not move money.
4. No central arbiter of value. Trust from math and open spec, not from trusting Atrib Inc.
5. The protocol is a public good; the product is not. Spec, signing libraries, and log infrastructure are open. The queryable graph and analytics are commercial.

## Architecture

How the protocol layers fit together, the trust model, and why the design is the way it is: [ARCHITECTURE.md](ARCHITECTURE.md).

## Prior art

atrib builds on and differentiates from: C2PA (provenance without closed loop), ProRata (attribution with ads), Story Protocol (provenance on blockchain), OpenTelemetry (observability without attribution semantics), LangSmith/Langfuse (agent tracing without economic attribution). See [PRIOR-ART.md](PRIOR-ART.md) for the full standards and protocols map.

## License

Apache 2.0
