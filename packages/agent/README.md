# `@atrib/agent`

**Attribution for agent-side tool calls. Works with every major MCP framework. Sits above every major agent payment protocol.**

`@atrib/agent` is the client-side half of the [atrib value provenance protocol](../../atrib-spec.md). It turns the MCP tool calls flowing out of your agent into signed, chainable attribution records — so the creators, tools, and data sources that contributed to an outcome can be identified and paid without any centralized intermediary seeing what happened inside the call.

You set up one `atrib()` interceptor, plug it into your framework's adapter, and every outbound `tools/call` from that point on carries W3C trace context, an attribution chain token, and the full atrib session lifecycle. When a payment completes — through any of the supported commerce protocols — a transaction record closes the chain and links contributions to the purchase.

Two coverage surfaces define what you get:

## Coverage Matrix 1 — MCP Framework Adapters

| Framework                                  | Package                          | Adapter helper                                                                                                                                                    | Integration shape                                                                                 | Status      |
| ------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| **Raw `@modelcontextprotocol/sdk` Client** | `@modelcontextprotocol/sdk`      | `wrapMcpClient(client, interceptor, { serverUrl? })`                                                                                                              | Proxy-based wrapper, returns new client                                                           | ✅ Shipped  |
| **Claude Agent SDK**                       | `@anthropic-ai/claude-agent-sdk` | **Case A (in-process tools):** zero code — the SDK's `createSdkMcpServer` returns a real `McpServer` that `@atrib/mcp` wraps directly                             | Reuses `@atrib/mcp`'s `atrib()` middleware on the server side                                     | ✅ Shipped  |
|                                            |                                  | **Case B (third-party servers):** `createAtribProxy({ upstream, interceptor })` from `@atrib/mcp` — in-process surrogate `McpServer` that forwards to an upstream | Proxy McpServer between SDK and upstream transport                                                | ✅ Shipped  |
| **Cloudflare Agents**                      | `agents`                         | `attributeCloudflareAgentMcp(agent, { interceptor, serverUrls })`                                                                                                 | Walks `agent.mcp.mcpConnections`, replaces `.client` via `wrapMcpClient`                          | ✅ Shipped  |
| **Vercel AI SDK MCP**                      | `@ai-sdk/mcp`                    | `attributeVercelAiSdkMcp(mcpClient, { interceptor, serverUrl })`                                                                                                  | Monkey-patches `mcpClient.request()` (custom JSON-RPC, not SDK Client)                            | ✅ Shipped  |
| **LangChain JS MCP adapters**              | `@langchain/mcp-adapters`        | **High-level:** `attributeLangchainMcp(multiClient, { interceptor, serverUrls })`                                                                                 | Walks `multiClient.config.mcpServers`, monkey-patches `callTool` + `fork` on each internal Client | ✅ Shipped  |
|                                            |                                  | **Low-level:** `wrapMcpClient(rawClient, interceptor)` passed to `loadMcpTools(name, wrapped)`                                                                    | Reuses raw-SDK wrapper path                                                                       | ✅ Shipped  |
| **OpenAI Agents SDK**                      | `@openai/agents`                 | _(deferred — custom transport architecture, not `@modelcontextprotocol/sdk`)_                                                                                     | Planned: subclass `MCPServerSSE` / `MCPServerStdio` / `MCPServerStreamableHttp`                   | ⏳ Deferred |
| **Mastra**                                 | `@mastra/mcp`                    | _(deferred — smaller footprint, needs source verification)_                                                                                                       | —                                                                                                 | ⏳ Deferred |

**The pattern across every row is identical:** one `atrib()` interceptor object, one adapter helper call, zero changes to your existing tool invocation code. The name of the helper varies because each host framework exposes a structurally different integration surface — but the `ToolCallInterceptor` type, the options shape, and the observable behavior are uniform.

## Coverage Matrix 2 — Agent Payment Protocols

`@atrib/agent` sits **above** every major agent payment protocol. It does not implement payments, move money, or enforce transactions — it detects transaction events in the response flow of whichever payment protocol your agent is using, and writes a signed transaction record that closes the attribution chain. **You do not choose a payment protocol at install time**; the detection logic for all five runs simultaneously and fires on whichever one your tool responses happen to carry.

All detection logic lives in `packages/agent/src/transaction.ts` and runs against unit tests for each protocol's published spec.

| Protocol                              | Sponsor / origin                                            | Detection signal                                                                                                              | Spec reference                       |
| ------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **ACP** — Agentic Commerce Protocol   | Stripe / OpenAI — `github.com/agentic-commerce-protocol`    | `status === "completed"` + embedded `order` on `/checkout_sessions/{id}/complete`, or `order_create` / `order_update` webhook | §1.7.1                               |
| **UCP** — Universal Commerce Protocol | `github.com/universal-commerce-protocol/ucp`                | Same shape as ACP + top-level `ucp.version` envelope                                                                          | §1.7.2                               |
| **x402**                              | Coinbase — `github.com/coinbase/x402`                       | HTTP `PAYMENT-RESPONSE` header (v2) or legacy `X-PAYMENT-RESPONSE` (v1) on the 200 response                                   | §1.7.3                               |
| **MPP** — Machine Payments Protocol   | Tempo Labs / Stripe — IETF `draft-ryan-httpauth-payment-01` | HTTP `Payment-Receipt` header on 200 success response                                                                         | §1.7.4                               |
| **AP2** — Agent Payments Protocol     | Google — `github.com/google-agentic-commerce/ap2`           | A2A Message with DataPart containing `ap2.mandates.PaymentMandate`                                                            | §1.7.5                               |
| **a2a-x402**                          | Google — `github.com/google-agentic-commerce/a2a-x402`      | A2A task `status.message.metadata["x402.payment.status"] === "payment-completed"` + `receipts[].success === true`             | §1.7.5 (reported as AP2 crypto path) |

**The linking mechanism is the same across all six:** the session `context_id` (16-byte anchor, equal to the W3C OTel trace-id by default) travels with the outbound payment request — via `X-atrib-Context` HTTP header for protocols that don't expose a free-form metadata field, or via `params._meta.atrib` for any payment protocol running over MCP transport. When the merchant's side sees the payment-completed signal, atrib writes a transaction record with that `context_id`, and the attribution graph can reconstruct the full chain from contributing tool calls → transaction → settlement.

**You do not install a separate package for each protocol.** ACP, UCP, x402, MPP, AP2 and a2a-x402 detection all ship in `@atrib/agent` and `@atrib/mcp` by default. Adding a new payment protocol happens by adding a detector in `transaction.ts`, not by asking users to install anything.

### What each detector actually looks for on the wire

These are the exact shapes the production `detectTransaction()` function in [`packages/agent/src/transaction.ts`](src/transaction.ts) matches against. Every shape below is covered by a unit test against a real spec fixture in [`packages/agent/test/fixtures/`](test/fixtures/) — the customer-facing question "what does atrib actually detect" has a one-paragraph answer per protocol.

#### ACP — Stripe / OpenAI Agentic Commerce Protocol

Detected on the success response of `POST /checkout_sessions/{id}/complete`. Required fields: top-level `status: "completed"` plus an `order` object with a string `id`. The optional `order.permalink_url` becomes the `checkoutUrl` for Path 2 `content_id` derivation per spec §5.4.5.

```json
{
  "id": "checkout_session_abc123",
  "status": "completed",
  "order": {
    "id": "ord_xyz789",
    "permalink_url": "https://merchant.example.com/orders/ord_xyz789"
  }
}
```

The `order_create` and `order_update` webhook event shapes are also detected (`type: "order_create"` plus a `data` object containing the order fields).

#### UCP — Universal Commerce Protocol

Identical to ACP **plus** a top-level `ucp` envelope with a `version` string. The envelope is the only structural distinguisher between ACP and UCP — without it the same shape is reported as ACP.

```json
{
  "ucp": { "version": "1.0", "capabilities": [] },
  "id": "checkout_session_abc123",
  "status": "completed",
  "order": { "id": "ord_xyz789", "permalink_url": "https://..." }
}
```

#### x402 — Coinbase

Detected entirely from an HTTP **response header**, not the body. The v2 header is `PAYMENT-RESPONSE` (per [github.com/coinbase/x402](https://github.com/coinbase/x402)); the v1 legacy header `X-PAYMENT-RESPONSE` is also accepted. Header name lookup is case-insensitive per RFC 7230.

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlfQ==
```

The header value is base64-encoded JSON `{success, transaction, network, payer, requirements}` but `detectTransaction()` only checks for the header's _presence_ — the surrounding `wrapMcpClient` / framework adapter is responsible for capturing response headers and passing them to the detector.

#### MPP — IETF draft `draft-ryan-httpauth-payment-01`

Also header-based, but a **different** header from x402 (the two were conflated in earlier drafts of this code — see [`DECISIONS.md` D016](../../DECISIONS.md)). MPP uses `Payment-Receipt` per §5.3 of the IETF draft. Both headers may not co-exist on a real response, but if they do, x402 wins (deterministic precedence documented in the test suite).

```http
HTTP/1.1 200 OK
Payment-Receipt: eyJzdGF0dXMiOiJzdWNjZXNzIn0
```

#### AP2 — Google Agent Payments Protocol (v0.1)

Detected from an A2A `Message` containing a `DataPart` whose `data` object has the literal key `"ap2.mandates.PaymentMandate"`. AP2 v0.1 does **not** use W3C Verifiable Credentials despite earlier drafts assuming it would (a legacy VC fallback is kept for research forks).

```json
{
  "messageId": "b5951b1a-8d5b-4ad3-a06f-92bf74e76589",
  "contextId": "sample-payment-context",
  "role": "user",
  "parts": [
    {
      "kind": "data",
      "data": {
        "ap2.mandates.PaymentMandate": {
          "payment_details": { "payment_request_id": "order_shoes_123", "...": "..." }
        }
      }
    }
  ]
}
```

`IntentMandate` and `CartMandate` are **not** detected — they are upstream funnel events, not transaction events. Only `PaymentMandate` closes the chain.

#### a2a-x402 — Google AP2 crypto path

Detected from an A2A `task` whose `status.message.metadata` contains `"x402.payment.status": "payment-completed"` **and** at least one entry in `"x402.payment.receipts"` with `success: true`. A `payment-completed` status with no successful receipt does NOT detect (a failed receipt is not a transaction). Reported as `protocol: 'AP2'` because a2a-x402 is the AP2 crypto path, not a separate protocol.

```json
{
  "kind": "task",
  "status": {
    "message": {
      "metadata": {
        "x402.payment.status": "payment-completed",
        "x402.payment.receipts": [{ "success": true, "transaction": "0xabc...", "network": "base" }]
      }
    }
  }
}
```

#### Heuristic fallback (last resort)

If none of the above match, the detector falls back to checking the **tool name** against a set of common keywords: `create_order`, `complete_checkout`, `process_payment`, `place_order`, `purchase`, `checkout`. A match returns `protocol: 'heuristic'` and is included in the chain, but it's a weaker signal than any of the protocol-specific detectors above. Use this only when no payment protocol is in play and you want the chain to still close on a domain-specific tool name.

---

## Quick start — one interceptor, any framework

Every adapter wiring looks the same:

```ts
import { atrib } from '@atrib/agent'

const interceptor = atrib({
  // 32-byte Ed25519 seed in base64url. Generate with:
  //   node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,

  // Your merchant identity (used for Path 1 transaction detection per §5.4.5).
  merchantDomain: 'https://merchant.example.com',

  // Canonical URLs of MCP servers this agent will call (drives policy negotiation).
  serverUrls: ['https://search.example.com', 'https://shop.example.com'],

  // Optional: where to submit signed records. Omit in development.
  logEndpoint: process.env.ATRIB_LOG_ENDPOINT,
})
```

That's the interceptor. Now plug it into whichever framework you use:

### Raw `@modelcontextprotocol/sdk`

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { wrapMcpClient } from '@atrib/agent'

const raw = new Client({ name: 'my-agent', version: '1.0.0' }, { capabilities: {} })
await raw.connect(transport)
const client = wrapMcpClient(raw, interceptor, {
  serverUrl: 'https://my-tool.example.com',
})
// Use `client` anywhere the raw Client would have been used.
```

### Claude Agent SDK — Case A (in-process tools, zero atrib code on this side)

```ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { atrib as wrapServer } from '@atrib/mcp'  // note: server-side package

const sdkServer = createSdkMcpServer({
  name: 'my-tools',
  tools: [tool('search', 'Search the web', { q: z.string() }, async ({ q }) => ({ ... }))],
})
wrapServer(sdkServer.instance, { creatorKey: process.env.ATRIB_PRIVATE_KEY! })

// Pass sdkServer to the Claude Agent SDK as a normal `{ type: 'sdk', ... }` config.
// Attribution flows at the server side; the interceptor on this side is not needed.
```

### Claude Agent SDK — Case B (third-party MCP servers via proxy)

```ts
import { createAtribProxy } from '@atrib/mcp'

const proxy = await createAtribProxy({
  upstream: { type: 'http', url: 'https://my-tool.example.com/mcp' },
  interceptor,
})

// Pass `proxy.mcpServer` to the Claude Agent SDK as `{ type: 'sdk', instance: proxy.mcpServer, ... }`.
```

### Cloudflare Agents

```ts
import { Agent } from 'agents'
import { attributeCloudflareAgentMcp } from '@atrib/agent'

class MyAgent extends Agent {
  async onRequest() {
    await this.mcp.addMcpServer('search', 'https://search.example.com/mcp')
    attributeCloudflareAgentMcp(this, {
      interceptor,
      serverUrls: { search: 'https://search.example.com' },
    })
    // ... call MCP tools as normal
  }
}
```

### Vercel AI SDK

```ts
import { createMCPClient } from '@ai-sdk/mcp'
import { streamText } from 'ai'
import { attributeVercelAiSdkMcp } from '@atrib/agent'

const mcpClient = await createMCPClient({
  transport: { type: 'http', url: 'https://my-tool.example.com/mcp' },
})
attributeVercelAiSdkMcp(mcpClient, {
  interceptor,
  serverUrl: 'https://my-tool.example.com',
})

const tools = await mcpClient.tools()
const result = await streamText({ model: 'openai/gpt-5.4', tools, prompt: '...' })
```

### LangChain JS

```ts
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { attributeLangchainMcp } from '@atrib/agent'

const multi = new MultiServerMCPClient({
  mcpServers: { search: { transport: 'http', url: 'https://search.example.com/mcp' } },
})
await multi.initializeConnections()
await attributeLangchainMcp(multi, {
  interceptor,
  serverUrls: { search: 'https://search.example.com' },
})

const tools = await multi.getTools()
// ... pass `tools` to your LangChain agent as normal
```

**In every case:** same interceptor, one adapter call, identical behavior. The differences between adapters are forced by differences between host frameworks — not invented by atrib.

---

## What you get

Once the adapter is wired in, every successful `tools/call` from your agent:

1. **Carries W3C trace context** (`traceparent`, `tracestate`, `baggage`) in `params._meta`, so downstream servers can correlate calls with your OTel traces.
2. **Carries an attribution chain token** in `params._meta.atrib` — a ~87-char base64url token identifying the prior call in the chain (§1.5.2).
3. **Emits a signed attribution record** to the submission queue asynchronously — zero blocking on the hot path (§5.3.5).
4. **Updates session state** with the response's own `_meta.atrib` token, so the next call chains correctly from the current response.
5. **Detects transaction events** in the response via the `transaction.ts` detector, across all six payment protocols in coverage matrix 2. When a transaction is detected, a transaction record is emitted linking the session `context_id` to the transaction.
6. **Fails silent** — if any atrib step (signing, submission, interceptor logic) throws, the error is caught, logged with the `atrib:` prefix, and the tool call proceeds normally per spec §5.8.

---

## Runnable examples

- [`claude-agent-sdk/`](../../integration/examples/claude-agent-sdk/) — Case A (in-process tools) and Case B (proxy) side-by-side
- [`cloudflare-agents/`](../../integration/examples/cloudflare-agents/) — `McpAgent` server-side and `Agent` client-side surfaces
- [`vercel-ai-sdk/`](../../integration/examples/vercel-ai-sdk/) — `createMCPClient` with AI Gateway model routing
- [`langchain-js/`](../../integration/examples/langchain-js/) — `MultiServerMCPClient` and the low-level `loadMcpTools` path

Each example directory contains a `README.md` with framework-specific rationale and a runnable `integration.ts` snippet.

---

## Failure model (spec §5.8)

The entire atrib integration is wrapped in defensive error handling at every adapter boundary. If any of the following fails, the original tool call continues normally and an `atrib:`-prefixed warning is logged:

- `onBeforeToolCall` throws → forward the request with original `_meta` (no injection)
- `onAfterToolResponse` throws → return the result to the caller anyway
- Signing throws → skip the record for that call
- Submission network error → the submission queue retries with exponential backoff; final failure drops the record silently
- `creatorKey` missing → pass-through mode with one console warning per process

**atrib failures never affect the primary tool call or agent response.** This is invariant #1 in `CLAUDE.md` and is enforced by unit tests in each adapter's test file.

---

## Spec references

| Spec section | What it defines                                              |
| ------------ | ------------------------------------------------------------ |
| §1.3         | JCS canonical serialization of records                       |
| §1.4         | Ed25519 signing and verification                             |
| §1.5         | Context propagation via `params._meta` and W3C trace context |
| §1.7         | Transaction event hooks for all 6 payment protocols          |
| §2           | Merkle log protocol (Tessera-backed, tlog-tiles spec)        |
| §3           | Graph query interface (fact layer only)                      |
| §4           | Policy format (merchant-side value distribution)             |
| §5.3         | Agent-side middleware behavior                               |
| §5.4         | Path 1 / Path 2 transaction detection                        |
| §5.8         | Degradation contract — silent failure never breaks the host  |

The full protocol spec is at [`atrib-spec.md`](../../atrib-spec.md).
