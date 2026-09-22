# `@atrib/agent`

**Client-side middleware for atrib's verifiable action layer. Outbound MCP tool calls carry atrib/W3C context, consume upstream signed records, record local gap nodes, and emit signed fallback transaction records when commerce closes. Works with major MCP framework surfaces. Sits above every major agent payment protocol so commerce-closing evidence can join the same trace.**

`@atrib/agent` is the client-side half of the [atrib protocol](https://github.com/creatornader/atrib/blob/main/atrib-spec.md). It keeps outbound MCP calls in the atrib session lifecycle: context goes out, upstream atrib tokens come back in, unsigned hops become local gap nodes, and transaction-shaped responses can produce signed agent-side fallback records. That makes agent work easier to coordinate across calls, handoffs, and later verification. Ordinary `tool_call` records are signed at the tool boundary by `@atrib/mcp`, `@atrib/mcp-wrap`, or an instrumented upstream server.

You set up one `atrib()` interceptor, plug it into your framework's adapter, and every outbound `tools/call` from that point on carries W3C trace context, an atrib chain token, and the full atrib session lifecycle. When a payment or commerce flow completes through a supported protocol surface, the interceptor can consume an upstream atrib record or emit an agent-side fallback `transaction` record. When commerce never closes the chain, the substrate still serves recall, audit, and cross-agent provenance.

Two coverage surfaces define what you get:

Boundary: this package covers framework middleware and client-side call flow.
Full host runtime integrations are a separate adapter family. Runtimes such as
Claude Code, Codex, OpenClaw, Hermes, Cursor, Goose, and hosted agent systems
own sessions, native tool hooks, approvals, subagents, checkpoints, telemetry,
and run logs. Those integrations compose `@atrib/mcp-wrap`, host-specific proof
code, `@atrib/openinference`, `@atrib/runtime-log`, `@atrib/verify`, and
hook-class producers instead of turning `@atrib/agent` into the harness layer.

## Install

```bash
pnpm add @atrib/agent
```

Verify a local build with `pnpm --filter @atrib/agent test`.

## Coverage Matrix 1: MCP Framework Adapters

| Framework                                  | Package                          | Adapter helper                                                                                                                                                   | Integration shape                                                                                 | Status     |
| ------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------- |
| **Raw `@modelcontextprotocol/sdk` Client** | `@modelcontextprotocol/sdk`      | `wrapMcpClient(client, interceptor, { serverUrl? })`                                                                                                             | Proxy-based wrapper, returns new client                                                           | ✅ Shipped |
| **Claude Agent SDK**                       | `@anthropic-ai/claude-agent-sdk` | **Case A (in-process tools):** zero code. the SDK's `createSdkMcpServer` returns a real `McpServer` that `@atrib/mcp` wraps directly                             | Reuses `@atrib/mcp`'s `atrib()` middleware on the server side                                     | ✅ Shipped |
|                                            |                                  | **Case B (third-party servers):** `createAtribProxy({ upstream, interceptor })` from `@atrib/mcp`. in-process surrogate `McpServer` that forwards to an upstream | Proxy McpServer between SDK and upstream transport                                                | ✅ Shipped |
| **Cloudflare Agents**                      | `agents`                         | `attributeCloudflareAgentMcp(agent, { interceptor, serverUrls })`                                                                                                | Walks `agent.mcp.mcpConnections`, replaces `.client` via `wrapMcpClient`                          | ✅ Shipped |
| **Vercel AI SDK MCP**                      | `@ai-sdk/mcp`                    | `attributeVercelAiSdkMcp(mcpClient, { interceptor, serverUrl })`                                                                                                 | Monkey-patches `mcpClient.request()` (custom JSON-RPC, not SDK Client)                            | ✅ Shipped |
| **LangChain JS MCP adapters**              | `@langchain/mcp-adapters`        | **High-level:** `attributeLangchainMcp(multiClient, { interceptor, serverUrls })`                                                                                | Walks `multiClient.config.mcpServers`, monkey-patches `callTool` + `fork` on each internal Client | ✅ Shipped |
|                                            |                                  | **Low-level:** `wrapMcpClient(rawClient, interceptor)` passed to `loadMcpTools(name, wrapped)`                                                                   | Reuses raw-SDK wrapper path                                                                       | ✅ Shipped |
| **OpenAI Agents SDK**                      | `@openai/agents`                 | _(planned. custom transport architecture, not `@modelcontextprotocol/sdk`)_                                                                                      | Planned: subclass `MCPServerSSE` / `MCPServerStdio` / `MCPServerStreamableHttp`                   | ⏳ Planned |
| **Mastra**                                 | `@mastra/mcp`                    | _(planned. receipt proof covers `MCPClient` + `MCPServer` over stdio)_                                                                                           | Adapter pending                                                                                   | 🧪 Proof   |

**The pattern across every row is identical:** one `atrib()` interceptor object, one adapter helper call, zero changes to your existing tool invocation code. The name of the helper varies because each host framework exposes a structurally different integration surface, but the `ToolCallInterceptor` type, the options shape, and the observable behavior are uniform.

## Coverage Matrix 2: Payment-related completion detection

`@atrib/agent` sits **above** payment, commerce, and agent-to-agent protocol
surfaces. It does not implement payments, move money, or enforce transactions;
it detects completion evidence in the response flow and writes a fallback
transaction record when no upstream atrib token already closed the chain. **You
do not choose a payment protocol at install time**; the six payment-related
detection cases (ACP, UCP, x402, MPP, AP2, a2a-x402) run simultaneously and
fire on whichever one your tool responses happen to carry. This is runtime
observation support, not a payment client, facilitator, PSP, wallet, or
protocol-wide usage measurement surface. The fallback record carries an agent
`signers[]` entry over the atrib transaction bytes. Counterparty signatures and
payment-receipt evidence are verifier inputs when the protocol supplies them;
[D052](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records)-aware
verifiers still flag records that do not meet the required cross-attestation
bar.

All detection logic lives in `packages/agent/src/transaction.ts` and runs
against unit tests for each detector case's published upstream shape.

| Protocol                             | Sponsor / origin                                           | Detection signal                                                                                                              | Spec reference                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **ACP**. Agentic Commerce Protocol   | Stripe / OpenAI; `github.com/agentic-commerce-protocol`    | `status === "completed"` + embedded `order` on `/checkout_sessions/{id}/complete`; terminal webhook fallback requires Order `status: "completed"` plus non-empty `id` | [Payments profile §2.1](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#21-acp-agentic-commerce-protocol)                  |
| **UCP**. Universal Commerce Protocol | `github.com/universal-commerce-protocol/ucp`               | Same shape as ACP + top-level `ucp.version` envelope                                                                          | [Payments profile §2.2](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#22-ucp-universal-commerce-protocol)                |
| **x402**                             | x402 Foundation. `github.com/x402-foundation/x402`        | HTTP `PAYMENT-RESPONSE` header (v2) or legacy `X-PAYMENT-RESPONSE` (v1) on the 200 response                                   | [Payments profile §2.3](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#23-x402)                                           |
| **MPP**. Machine Payments Protocol   | Tempo Labs / Stripe; IETF `draft-ryan-httpauth-payment-01` | HTTP `Payment-Receipt` header or MCP `result._meta["org.paymentauth/receipt"]` with a successful receipt                         | [Payments profile §2.4](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#24-mpp-machine-payments-protocol)                  |
| **AP2**. Agentic Payment Protocol    | Google; `github.com/google-agentic-commerce/AP2`           | Successful AP2 `PaymentReceipt` or `CheckoutReceipt`; mandate-only payloads are excluded                                      | [Payments profile §2.5](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#25-ap2-and-a2a-x402)                               |
| **a2a-x402**                         | Google. `github.com/google-agentic-commerce/a2a-x402`      | A2A task `status.message.metadata["x402.payment.status"] === "payment-completed"` + `receipts[].success === true`             | [Payments profile §2.5](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#25-ap2-and-a2a-x402)                               |

**The linking mechanism is the same across all six detection cases:** the
session `context_id` (16-byte anchor, equal to the W3C OTel trace-id by default)
travels with the outbound request via `X-atrib-Context` when the protocol does
not expose a free-form metadata field, or via `params._meta.atrib` for an MCP
transport. When the receiving side sees the completion signal, atrib writes a
transaction record with that `context_id`; the attribution graph can then
reconstruct the chain from contributing tool calls to the transaction.

**You do not install a separate package for each detector case.** ACP, UCP,
x402, MPP, AP2, and a2a-x402 detection all ship in `@atrib/agent` and
`@atrib/mcp` by default. Adding a new completion signal means adding and
testing a detector in `transaction.ts`; it does not add payment execution to
atrib.

### What each detector actually looks for on the wire

Payment detection now has its own import path:

```typescript
import { detectTransaction } from '@atrib/agent/payments'
```

The root export remains during the deprecation cycle. Pass
`detectTransaction: [customDetector]` to `atrib()` when a host needs a
caller-owned detector order. An empty array disables payment classification
and leaves ordinary tool-call attribution on.

These are the exact shapes the production `detectTransaction()` function in [`packages/agent/src/transaction.ts`](https://github.com/creatornader/atrib/blob/main/packages/agent/src/transaction.ts) matches against. Every shape below is covered by a unit test against a real spec fixture in [`packages/agent/test/fixtures/`](https://github.com/creatornader/atrib/blob/main/packages/agent/test/fixtures/), and the verifier question "what does atrib actually detect" has a one-paragraph answer per detection case.

#### ACP: Stripe / OpenAI Agentic Commerce Protocol

Detected on the success response of `POST /checkout_sessions/{id}/complete`. Required fields: top-level `status: "completed"` plus an `order` object with a string `id`. The optional `order.permalink_url` becomes the `checkoutUrl` for Path 2 `content_id` derivation per spec [§5.4.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#545-transaction-detection).

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

ACP `order_create` and `order_update` webhooks are lifecycle notifications.
The detector only accepts a terminal full Order with `status: "completed"` and
a non-empty `id`; created, shipped, refunded, and incomplete webhook payloads
do not emit transactions.

#### UCP: Universal Commerce Protocol

The current released UCP snapshot is [v2026-08-25](https://github.com/Universal-Commerce-Protocol/ucp/releases/tag/v2026-08-25). A synchronous checkout completion is `status: "completed"` with an `order.id` string plus a top-level `ucp` envelope with a `version` string. The current envelope also carries capability and payment-handler maps. The envelope is the structural distinguisher between ACP and UCP; an asynchronous `complete_in_progress` response has no order and is not detected as a completed transaction.

```json
{
  "ucp": {
    "version": "2026-08-25",
    "capabilities": { "dev.ucp.shopping.checkout": [{ "version": "2026-08-25" }] },
    "payment_handlers": { "dev.ucp.common.payment": [{ "version": "2026-08-25", "id": "handler_1" }] }
  },
  "id": "checkout_session_abc123",
  "status": "completed",
  "order": { "id": "ord_xyz789", "permalink_url": "https://..." }
}
```

#### x402: x402 Foundation

Detected entirely from an HTTP **response header**, not the body. The v2 header is `PAYMENT-RESPONSE` (per [x402 Foundation](https://github.com/x402-foundation/x402)); the v1 legacy header `X-PAYMENT-RESPONSE` is also accepted. Header name lookup is case-insensitive per RFC 7230.

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlfQ==
```

The header value is base64-encoded JSON `{success, transaction, network, payer, requirements}` but `detectTransaction()` only checks for the header's _presence_; the surrounding `wrapMcpClient` / framework adapter is responsible for capturing response headers and passing them to the detector.

#### MPP: IETF draft `draft-ryan-httpauth-payment-01`

Also header-based, but a **different** header from x402 (the two were conflated in earlier drafts of this code; see [`DECISIONS.md` D016](https://github.com/creatornader/atrib/blob/main/DECISIONS.md)). MPP uses `Payment-Receipt` per [§5.3 of the current IETF draft](https://datatracker.ietf.org/doc/draft-ryan-httpauth-payment/). Both headers may not co-exist on a real response, but if they do, x402 wins (deterministic precedence documented in the test suite).

```http
HTTP/1.1 200 OK
Payment-Receipt: eyJzdGF0dXMiOiJzdWNjZXNzIn0
```

MPP's published JSON-RPC/MCP transport also places a native receipt at
`result._meta["org.paymentauth/receipt"]`. The detector requires
`status: "success"`, non-empty `method` and `challengeId`, and an RFC 3339
`timestamp`; `reference` is optional on this transport. This is declared
structural evidence, not universal settlement verification.

#### AP2: Google Agentic Payment Protocol (v0.2)

Detected from successful AP2 receipts. Current AP2 uses Checkout and Payment Mandates for authorization, then returns signed Checkout Receipts and Payment Receipts when a verifier accepts or rejects the mandate. atrib treats the successful receipt as the transaction close signal.

AP2 receipt JWT signatures remain verifier evidence. They are not counted as transaction `signers[]` unless an AP2 participant also signs the atrib transaction record bytes. See [D098](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d098-ap2-receipts-stay-external-evidence-for-cross-attestation).

Decoded receipt objects are detected when they carry `status: "Success"` and the required AP2 fields. Signed receipt JWTs are detected in AP2 sample result envelopes when the envelope has `status: "success"` plus `payment_receipt` or `checkout_receipt`.

For Path 2 fallback transaction records, AP2 and a2a-x402 detection return a
protocol-specific `contentId` when stable receipt identity fields are visible.
Decoded Payment Receipts take priority, then compact payment receipt JWT
hashes, decoded Checkout Receipts, and compact checkout receipt JWT hashes.
Mandate-only payloads never enter this identity ladder. If no receipt identity
is present, middleware falls back to the MCP server URL plus `"checkout"`.

```json
{
  "status": "success",
  "order_id": "order_123",
  "checkout_receipt": "eyJhbGciOiJFUzI1NiJ9.eyJzdGF0dXMiOiJTdWNjZXNzIn0.signature"
}
```

Mandate-only payloads are not detected, including `vct: "mandate.payment.1"` and `vct: "mandate.checkout.1"`. Mandates authorize a future action; they do not prove the verifier accepted it.

Verifier-side AP2 / Verifiable Intent checks live in `@atrib/verify`, not this detector. Use `verifyAp2ViEvidence()` for decoded receipts or `verifyAp2ViEvidenceAsync()` for compact signed receipt JWTs when a merchant or auditor needs to validate AP2 receipt references, VI SD-JWT signatures, `sd_hash` links, disclosure digests, delegated agent keys, and checkout/payment binding after detection.

The older AP2 v0.1 DataPart shape remains recognized as authorization evidence,
but it is not a transaction signal:

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

`IntentMandate` and `CartMandate` are still not detected; they are upstream funnel events, not transaction events.

#### a2a-x402: Google A2A/x402 extension

Detected from an A2A `task` whose `status.message.metadata` contains
`"x402.payment.status": "payment-completed"` **and** at least one entry in
`"x402.payment.receipts"` with `success: true`. A `payment-completed` status
with no successful receipt does NOT detect. The emitted protocol is
`'a2a-x402'`, not AP2. When a successful receipt exposes a transaction id,
Path 2 uses that receipt identity; otherwise it uses the generic server URL
fallback.

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

#### Custom detector compatibility

The default detector does not infer completion from a tool name. A caller may
pass a custom detector through `detectTransaction: [customDetector]` and use
`protocol: 'heuristic'` for a host-owned observation, but that path is outside
the six published completion cases and retains the weaker-signal warning.

---

## Quick start: one interceptor, any framework

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

That's the interceptor. Now plug it into whichever framework you use.
`@atrib/agent` types against each host framework structurally and does not
depend on any of them, so install the framework package you use
(`@modelcontextprotocol/sdk`, `@ai-sdk/mcp`, `agents`, `@langchain/mcp-adapters`,
or `@anthropic-ai/claude-agent-sdk`) alongside `@atrib/agent`.

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

### Claude Agent SDK: Case A (in-process tools, zero atrib code on this side)

```ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { atrib as wrapServer } from '@atrib/mcp'  // note: server-side package
import { z } from 'zod' // ships with the Claude Agent SDK

const sdkServer = createSdkMcpServer({
  name: 'my-tools',
  tools: [tool('search', 'Search the web', { q: z.string() }, async ({ q }) => ({ ... }))],
})
wrapServer(sdkServer.instance, { creatorKey: process.env.ATRIB_PRIVATE_KEY! })

// Pass sdkServer to the Claude Agent SDK as a normal `{ type: 'sdk', ... }` config.
// Attribution flows at the server side; the interceptor on this side is not needed.
```

### Claude Agent SDK: Case B (third-party MCP servers via proxy)

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

**In every case:** same interceptor, one adapter call, identical behavior. The differences between adapters are forced by differences between host frameworks; not invented by atrib.

---

## What you get

Once the adapter is wired in, every successful `tools/call` from your agent:

1. **Carries W3C trace context** (`traceparent`, `tracestate`, `baggage`) in `params._meta`, so downstream servers can correlate calls with your OTel traces.
2. **Carries an attribution chain token** in `params._meta.atrib`, a ~87-char base64url token identifying the prior call in the chain ([§1.5.2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#152-http-transport-tracestate)).
3. **Emits a signed attribution record** to the submission queue asynchronously, zero blocking on the hot path ([§5.3.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#535-log-submission)).
4. **Updates session state** with the response's own `_meta.atrib` token, so the next call chains correctly from the current response.
5. **Detects transaction events** in the response via the `transaction.ts` detector, across all six payment-related completion cases in coverage matrix 2. When a transaction is detected, a transaction record is emitted linking the session `context_id` to the transaction.
6. **Fails silent**: if any internal atrib step (signing, submission, interceptor logic) throws, the error is caught, logged with the `atrib:` prefix, and the tool call proceeds normally per spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract).

---

## Runnable examples

- [`claude-agent-sdk/`](https://github.com/creatornader/atrib/tree/main/packages/integration/examples/claude-agent-sdk). Case A (in-process tools) and Case B (proxy) side-by-side
- [`cloudflare-agents/`](https://github.com/creatornader/atrib/tree/main/packages/integration/examples/cloudflare-agents); `McpAgent` server-side and `Agent` client-side surfaces
- [`vercel-ai-sdk/`](https://github.com/creatornader/atrib/tree/main/packages/integration/examples/vercel-ai-sdk); `createMCPClient` with AI Gateway model routing
- [`langchain-js/`](https://github.com/creatornader/atrib/tree/main/packages/integration/examples/langchain-js); `MultiServerMCPClient` and the low-level `loadMcpTools` path

Each example directory contains a `README.md` with framework-specific rationale and a runnable `integration.ts` snippet.

---

## Failure model (spec [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract))

The entire atrib integration is wrapped in defensive error handling at every adapter boundary. If any of the following fails, the original tool call continues normally and an `atrib:`-prefixed warning is logged:

- `onBeforeToolCall` throws → forward the request with original `_meta` (no injection)
- `onAfterToolResponse` throws → return the result to the caller anyway
- Signing throws → skip the record for that call
- Submission network error → the submission queue retries with exponential backoff; final failure drops the record silently
- `creatorKey` missing → pass-through mode with one console warning per process

**atrib failures never affect the primary tool call or agent response.** This is invariant #1 in `CLAUDE.md` and is enforced by unit tests in each adapter's test file.

---

## Spec references

| Spec section                                                                                            | What it defines                                              |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [§1.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#13-canonical-serialization)        | JCS canonical serialization of records                       |
| [§1.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#14-signing-and-verification)       | Ed25519 signing and verification                             |
| [§1.5](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#15-context-propagation)            | Context propagation via `params._meta` and W3C trace context |
| [§1.7](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#17-transaction-event-hooks)        | Transaction event boundary; payment-related hooks live in the [payments profile §2](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#2-transaction-detection-hooks) per [D147](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core) |
| [§2](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2-merkle-log-protocol)               | Merkle log protocol (Tessera-backed, tlog-tiles spec)        |
| [§3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#3-graph-query-interface)             | Graph query interface (fact layer only)                      |
| [Payments profile §4](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#4-policy-document-format)       | Policy format (merchant-side value distribution; relocated from [spec §4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#4-attribution-policy-format) per [D147](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core)) |
| [§5.3](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#53-atribmcp-mcp-server-middleware) | Agent-side middleware behavior                               |
| [§5.4](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#54-atribagent-agent-middleware)    | Agent middleware; the Path 1 / Path 2 detection contract lives in the [payments profile §3](https://github.com/creatornader/atrib/blob/main/docs/payments-profile.md#3-sdk-transaction-detection) per [D147](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d147-payments-profile-spin-out-from-protocol-core) |
| [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract)           | Degradation contract; silent failure never breaks the host   |

The full protocol spec is at [`atrib-spec.md`](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).

---

> **A note on documentation links.** The atrib protocol repository is currently private (in-progress public preparation). Links in this README to the spec and sister packages (`atrib-spec.md`, `packages/agent/README.md`, etc.) point at `github.com/creatornader/atrib/blob/main/...` URLs that will resolve once the repository goes public. Until then, see [`atrib.dev`](https://atrib.dev) for the protocol overview.

## Part of atrib

atrib is an open protocol for verifiable agent actions. Every action becomes a signed, chain-linked record that anyone can verify against a public Merkle log, with no operator to trust. This package is one entrypoint. See the [full package family](https://github.com/creatornader/atrib#packages) and the [protocol spec](https://github.com/creatornader/atrib/blob/main/atrib-spec.md).
