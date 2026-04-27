# atrib

**Verifiable agent actions.** Every tool call becomes signed context for the next.

atrib is the substrate behind agents that reason from a past they can prove. Every MCP tool call gets an Ed25519-signed record at the moment of action, committed to a public Merkle log, chained into the next call, independently verifiable by anyone. The agent gains a provable history; downstream consumers (merchants, auditors, other agents) gain a verifiable trail. One line of code to integrate.

## What this enables

The substrate is the load-bearing piece. The four uses below are downstream consequences, ordered by how directly each depends on the substrate's core property: signed-at-the-moment, verifiable-thereafter.

- **Provable cognition.** An agent reads its own prior records and reasons from them. Each record is a signed claim that re-verifies locally; the agent's continuity of self survives platform changes, model changes, and harness changes because the cryptography is independent of all of them. This is the dogfood thesis: agents that reason from a past they can prove.
- **Independent audit.** Any third party can verify what an agent did, in what order, with what causal structure. No trust in the agent operator, the platform, or any intermediary required. Compliance-coded products (audit trail, SOC 2, AI governance tooling) approximate this without the substrate; the substrate does it correctly.
- **Cross-agent provenance.** Tool calls chain forward through W3C trace context. Agents that hand off work to other agents carry verifiable causality across the handoff. The chain is the trust.
- **Settlement when commerce closes a chain.** A side effect of the substrate: the same signed record set is what a settlement document is computed from. The §4.6 algorithm runs deterministically; any merchant or auditor can recompute and verify. This is real attribution-economy infrastructure, and it follows from the substrate rather than being its purpose.

## Substrate vs harness

atrib is the substrate. Consuming it well (surfacing an agent's history at session start, exposing recall tools the agent can call, persisting signed records locally for replay) is the job of an agent harness or runtime. atrib does not prescribe a harness. The substrate is independently useful to any harness (Claude Code, Cursor, custom agent products, in-house agent runtimes) that wants to give its agent the contextual awareness verifiable history makes possible.

## How it works

- Each record is signed by the actor's Ed25519 key and JCS-canonicalized
- A Merkle log stores commitments (hashes, not content) with RFC 6962 inclusion proofs and C2SP-canonical signed-note checkpoints
- Five edge types connect actions into a graph (chain, session, parallel, convergence, cross-session)
- A pure-function calculation maps graph + policy to value distribution when commerce closes
- A public-key directory (§6) resolves opaque keys to identity claims; rotation and revocation are normative (§1.9)

No custom cryptography. No content exposure. No trust required.

## Framework support

| Framework | Adapter | Status |
| --- | --- | --- |
| **Raw `@modelcontextprotocol/sdk`** | `wrapMcpClient(client, interceptor, { serverUrl? })` | ✅ Shipped |
| **Claude Agent SDK** (in-process, Case A) | Wrap `McpServer` with `atrib()` directly | ✅ Shipped |
| **Claude Agent SDK** (third-party, Case B) | `createAtribProxy({ upstream, interceptor })` | ✅ Shipped |
| **Cloudflare Agents** | `attributeCloudflareAgentMcp(agent, { interceptor, serverUrls })` | ✅ Shipped |
| **Vercel AI SDK MCP** | `attributeVercelAiSdkMcp(mcpClient, { interceptor, serverUrl })` | ✅ Shipped |
| **LangChain JS MCP** | `attributeLangchainMcp(multiClient, { interceptor, serverUrls })` | ✅ Shipped |
| OpenAI Agents SDK | Planned (different transport architecture) | ⏳ |
| Mastra | Planned (needs source verification) | ⏳ |

Side-by-side quick-starts for each framework: [`packages/agent/README.md`](packages/agent/README.md).

## Payment protocol detection

atrib detects transaction events from all six simultaneously. It does not move money or enforce transactions.

| Protocol | Sponsor | Detection signal | Spec ref |
| --- | --- | --- | --- |
| **ACP** | Stripe / OpenAI | `status === "completed"` + embedded `order` | §1.7.1 |
| **UCP** | Google / Shopify | Same as ACP + `ucp.version` envelope | §1.7.2 |
| **x402** | Coinbase | `PAYMENT-RESPONSE` HTTP header | §1.7.3 |
| **MPP** | Tempo Labs / Stripe | `Payment-Receipt` HTTP header | §1.7.4 |
| **AP2** | Google | A2A DataPart with `PaymentMandate` | §1.7.5 |
| **a2a-x402** | Google | A2A task metadata `payment-completed` | §1.7.5 |

## Quick start

### Server side (tool creator)

```typescript
import { atrib } from '@atrib/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const server = atrib(new McpServer({ name: 'my-tool', version: '1.0.0' }), {
  creatorKey: process.env.ATRIB_PRIVATE_KEY,
  serverUrl: 'https://my-tool.example.com',
})
```

One line. Every successful tool call emits a signed attribution record, propagates W3C trace context, and submits to the log asynchronously.

### Agent side (framework adapter)

`@atrib/agent` exports one interceptor plus a helper per framework. Setup is the same across all of them:

| Example | Path |
| --- | --- |
| Vercel AI SDK + AI Gateway | [`packages/integration/examples/vercel-ai-sdk/`](packages/integration/examples/vercel-ai-sdk/) |
| Claude Agent SDK (Case A + Case B) | [`packages/integration/examples/claude-agent-sdk/`](packages/integration/examples/claude-agent-sdk/) |
| Cloudflare Agents | [`packages/integration/examples/cloudflare-agents/`](packages/integration/examples/cloudflare-agents/) |
| LangChain JS | [`packages/integration/examples/langchain-js/`](packages/integration/examples/langchain-js/) |
| End-to-end demo | [`packages/integration/examples/end-to-end/`](packages/integration/examples/end-to-end/) |

### Merchant side (verification)

```typescript
import { AtribVerifier } from '@atrib/verify'

const verifier = new AtribVerifier({
  merchantKey: process.env.ATRIB_MERCHANT_KEY,
})

const result = await verifier.verify(recommendationDoc)
// { valid: true, signatureOk: true, calcMatch: true, distribution: {...} }
```

Verification re-runs the §4.6 calculation locally and compares the result. No trust in any intermediary.

## Try the demo

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

Runs a fake merchant, a fake agent, and a real Merkle log in a single process. The signatures, chain hashes, and transaction detection are production code. Only the surrounding environment is stubbed.

## Packages

| Package | What it does |
| --- | --- |
| [`@atrib/mcp`](packages/mcp/README.md) | Server middleware. Wraps an MCP server, emits signed records. |
| [`@atrib/agent`](packages/agent/README.md) | Agent middleware. Interceptor + framework adapters. |
| [`@atrib/verify`](packages/verify/README.md) | Merchant verification. Re-runs the calculation locally. |
| [`@atrib/log-dev`](packages/log-dev/README.md) | Dev-only in-memory log stub. Not for production. |
| [`@atrib/integration`](packages/integration/README.md) | Cross-package tests + runnable examples. |

> 898 tests across all packages (897 passing, 1 documented skip). Public packages are not yet published to npm. The production log service is at [`services/log-node/`](services/log-node/) (deployed at `https://log.atrib.dev/v1`); the graph query service is at [`services/graph-node/`](services/graph-node/) (deployed at `https://graph.atrib.dev/v1`). A reproducible end-to-end verifier with 13 gate assertions across 8 named categories (tree integrity, format conformance, checkpoint signature, pubkey-publication agreement, signer scope, attribution, record signature replay, chain integrity) ships at `services/log-node/scripts/verify-loop.mjs` and runs daily in CI against the deployed log.

**Implemented and deployed:** Record signing (§1), transparency log (§2) with persistent storage and C2SP-canonical signed-note checkpoints (D031), graph query interface (§3) with §3.2.4 derivation, calculation algorithm (§4.6) with deterministic distribution and §4.7 settlement document signing, opt-in autoChain for hosts that don't propagate atrib's outbound token (D033 sequencing).

**Spec-defined but not implemented:** Witnessing (§2.9, D032; first implementation deferred until a non-operator verifier exists). Key rotation and revocation (§1.9, D033; implementation in an upcoming implementation phase). Public-key directory (§6, D034; same AKD-based, unblinded mode for atrib and a VRF-blinded mode available for downstream consumers requiring privacy-preserving lookup).

## Key generation

```bash
node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
```

Store the output as `ATRIB_PRIVATE_KEY`. The public key is derived at runtime.

## Specification

[`atrib-spec.md`](./atrib-spec.md) covers:

- **§0:** Foundations
- **§1:** Attribution record format, signing, propagation, payment protocol hooks
- **§1.9:** Key rotation and revocation (D033)
- **§2:** Merkle log protocol (C2SP tlog-tiles, proofs, witnessing)
- **§3:** Graph query interface (five edge types)
- **§4:** Policy format, negotiation, calculation algorithm
- **§5:** SDK contract, automation, degradation guarantees
- **§6:** Public-key directory (AKD-based; D034)

## Design principles

1. **Provenance travels with the artifact.** Embedded at creation, not inferred later.
2. **Accountability without content exposure.** The log stores hashes, not content.
3. **Settlement is separate from attribution.** The protocol records what happened. It does not move money.
4. **No central arbiter of value.** Trust from math and open spec, not from trusting atrib.
5. **The protocol is open. The product is commercial.** Spec, signing libraries, calculation algorithm, and log software are open. Anyone can self-host. atrib operates a hosted service as a commercial product built on the open protocol.

## More

- [Policy templates and guide](policies/README.md)
- [Architecture and trust model](ARCHITECTURE.md)
- [Prior art and standards map](PRIOR-ART.md)
- [Decision log](DECISIONS.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache 2.0
