# atrib

Signed receipts for every MCP tool call. Ed25519 signatures, JCS canonicalization, RFC 6962 Merkle proofs. One line of code to integrate.

## The problem

When an AI agent calls a tool and that leads to a purchase, nobody can prove which tools contributed. There's no receipt, no chain of custody, no way for the tool creator to get paid for their part. The platform sees everything; the creators see nothing.

## What atrib does

atrib adds a signed attribution record to every MCP tool call. The record travels with the call, gets appended to a Merkle log, and forms an independently verifiable chain from tool call to transaction.

- Each record is signed by the creator's Ed25519 key and JCS-canonicalized
- A Merkle log stores commitments (hashes, not content) with RFC 6962 inclusion proofs
- Five edge types connect tool calls into an attribution graph
- Policies let creators and merchants define what contributions are worth
- A pure-function calculation maps graph + policy to value distribution

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

> 672 tests across all packages. Public packages are not yet published to npm. The production log service is at [`services/log-node/`](services/log-node/).

**Not yet implemented:** Graph Query API (spec §3.4), Tile Read API (spec §2.5), Witnessing (spec §2.9, deferred to v2).

## Key generation

```bash
node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
```

Store the output as `ATRIB_PRIVATE_KEY`. The public key is derived at runtime.

## Specification

[`atrib-spec.md`](./atrib-spec.md) covers:

- **§0:** Foundations
- **§1:** Attribution record format, signing, propagation, payment protocol hooks
- **§2:** Merkle log protocol (C2SP tlog-tiles, proofs, witnessing)
- **§3:** Graph query interface (five edge types)
- **§4:** Policy format, negotiation, calculation algorithm
- **§5:** SDK contract, automation, degradation guarantees

## Design principles

1. **Provenance travels with the artifact.** Embedded at creation, not inferred later.
2. **Accountability without content exposure.** The log stores hashes, not content.
3. **Settlement is separate from attribution.** The protocol records what happened. It does not move money.
4. **No central arbiter of value.** Trust from math and open spec, not from trusting atrib.
5. **The protocol is open. The product is commercial.** Spec, signing libraries, calculation algorithm, and log software are open. Anyone can self-host. atrib operates a hosted service as a commercial product built on the open protocol.

## More

- [Architecture and trust model](ARCHITECTURE.md)
- [Prior art and standards map](PRIOR-ART.md)
- [Decision log](DECISIONS.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache 2.0
