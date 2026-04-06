# Atrib + Vercel AI SDK (`@ai-sdk/mcp`)

This example shows how to add Atrib attribution to a Vercel AI SDK application that uses MCP tools via `createMCPClient` from `@ai-sdk/mcp`.

The integration is **one extra line**: `attributeVercelAiSdkMcp(mcpClient, { interceptor })` after `createMCPClient(...)` resolves. The helper patches the client's `request` method so every outbound `tools/call` flows through Atrib's interceptor lifecycle (W3C trace context propagation, attribution token chaining, transaction detection per spec §5.4).

---

## Why this needs its own helper (not `wrapMcpClient`)

The `@ai-sdk/mcp` MCPClient is **not** a `@modelcontextprotocol/sdk` Client. It has its own JSON-RPC implementation with two structural differences that make `wrapMcpClient` (the helper that works for raw `@modelcontextprotocol/sdk` clients) inapplicable:

| `@modelcontextprotocol/sdk` Client | `@ai-sdk/mcp` MCPClient |
|---|---|
| `callTool({ name, arguments, _meta })` | `callTool({ name, args, options })` |
| Accepts `_meta` field on the request | Does NOT accept `_meta` — it's stripped before the JSON-RPC request is built |
| `client.callTool()` is the public surface | `client.tools()` returns an AI-SDK ToolSet whose `execute()` calls `client.callTool()` internally |

Because the `_meta` field is stripped at the AI SDK MCPClient layer, wrapping at the AI SDK execute callback level loses Atrib's outbound metadata. The right integration point is the **`request()` method** — the JSON-RPC bottleneck through which every MCP call flows on its way to the transport. Patching here lets Atrib inject `_meta` into outbound `tools/call` and read raw `_meta` from the response before AI-SDK-specific transformations like `extractStructuredContent` strip it.

This is symmetrical to how `@atrib/mcp` patches `setRequestHandler` on the server side: same pattern, opposite end of the wire. Full architectural rationale is in [`DECISIONS.md`](../../../../DECISIONS.md) D023.

---

## Usage

```ts
import { createMCPClient } from '@ai-sdk/mcp'
import { streamText } from 'ai'
import { atrib, attributeVercelAiSdkMcp } from '@atrib/agent'

// 1. Construct the Atrib interceptor (once per agent process / request).
//    Handles session lifecycle, policy negotiation, W3C trace context
//    propagation, and Path 1/2 transaction detection.
const interceptor = atrib({
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,
  merchantDomain: 'https://merchant.example.com',
  serverUrls: ['https://my-tool.example.com'],
  logEndpoint: process.env.ATRIB_LOG_ENDPOINT,
})

// 2. Create the @ai-sdk/mcp MCPClient as you normally would.
const mcpClient = await createMCPClient({
  transport: {
    type: 'http',
    url: 'https://my-tool.example.com/mcp',
  },
})

// 3. ★ ATRIB ★ — patch the client's request method.
//    Idempotent — safe to call multiple times.
//    Order: can be called BEFORE or AFTER mcpClient.tools() because the
//    AI SDK builds tool execute() callbacks that read client.request at
//    INVOCATION time, not at build time.
attributeVercelAiSdkMcp(mcpClient, {
  interceptor,
  serverUrl: 'https://my-tool.example.com',
})

// 4. Build the AI SDK ToolSet and use it as you normally would.
const tools = await mcpClient.tools()

// Recommended: route the model call through the Vercel AI Gateway by passing
// a provider/model string. AI SDK v6 detects this shape and automatically
// routes through the Gateway, which gives you OIDC auth (no provider API
// key needed), automatic provider failover, cost tracking, and unified
// observability. See the section below for the direct-provider alternative.
const result = await streamText({
  model: 'openai/gpt-5.4',
  tools,
  prompt: 'What can you do?',
  onFinish: async () => {
    await mcpClient.close()
    await interceptor.flush()
  },
})

for await (const chunk of result.textStream) {
  process.stdout.write(chunk)
}
```

That's the entire integration. Every successful tool call going through the AI SDK emits a signed Atrib record. Tool inputs and outputs are unchanged from the AI SDK's perspective.

### Model routing through the AI Gateway

The example above passes `model: 'openai/gpt-5.4'` as a string. In AI SDK v6 this `provider/model` shape automatically routes through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), which is the recommended pattern. Benefits:

- **OIDC auth** — pull credentials with `vercel env pull`; no provider keys to manage in your environment
- **Automatic provider failover** — if one model is down, the gateway falls back transparently
- **Cost tracking and observability** — unified usage metrics across all model calls
- **Zero data retention** by default

If you want to be explicit about routing through the Gateway (e.g. for clarity in code review, or to attach gateway-specific options), use the `gateway()` helper from `@ai-sdk/gateway`:

```ts
import { gateway } from '@ai-sdk/gateway'

const result = await streamText({
  model: gateway('openai/gpt-5.4'),  // explicit gateway form, same routing as the string form
  tools,
  prompt: 'What can you do?',
})
```

Both forms route through the Gateway and use OIDC auth — no provider API keys required. **Atrib's behavior is identical in both forms** — the attribution interceptor patches `mcpClient.request`, which sits below the model layer, so every MCP `tools/call` flowing out of the AI SDK gets attributed the same way regardless of which Gateway form you use.

---

## Multiple MCP servers

If your app connects to several MCP servers, call `attributeVercelAiSdkMcp` on each client. The helper is idempotent — calling it twice on the same client is a no-op — so it's safe to call defensively if you're not sure whether a client has been patched already.

```ts
const stdioClient = await createMCPClient({ transport: stdioTransport })
const httpClient = await createMCPClient({ transport: { type: 'http', url: '...' } })
const sseClient = await createMCPClient({ transport: { type: 'sse', url: '...' } })

attributeVercelAiSdkMcp(stdioClient, { interceptor, serverUrl: 'https://stdio-tool.example' })
attributeVercelAiSdkMcp(httpClient, { interceptor, serverUrl: 'https://http-tool.example' })
attributeVercelAiSdkMcp(sseClient, { interceptor, serverUrl: 'https://sse-tool.example' })

const tools = {
  ...(await stdioClient.tools()),
  ...(await httpClient.tools()),
  ...(await sseClient.tools()),
}
```

The Atrib interceptor is shared across all clients (it's the agent's identity, not per-server), but the `serverUrl` option distinguishes them in the resulting attribution records.

---

## Environment variables

- **`ATRIB_PRIVATE_KEY`** — base64url-encoded 32-byte Ed25519 seed. Generate one for development with:
  ```bash
  node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
  ```
- **`ATRIB_LOG_ENDPOINT`** — URL of your Atrib Merkle log submission endpoint. Optional in development; the submission queue silently buffers when unset.

If `ATRIB_PRIVATE_KEY` is omitted, Atrib operates in pass-through mode with a console warning. No records are emitted, but the AI SDK keeps working.

---

## What you should observe

After running with `ATRIB_LOG_ENDPOINT` pointed at your log:

- Every successful `tools/call` from the AI SDK emits a signed Atrib record
- Records share a `context_id` per agent session and chain via `chain_root` references
- Failed tool calls (`isError: true` from the upstream) emit no record per spec §5.3.3
- Internal atrib failures (network, signing, interceptor errors) never reach the AI SDK's tool dispatch — they're caught and logged with the `atrib:` console prefix per §5.8

If you don't see records, check:

1. `creatorKey` is set and is a valid 32-byte base64url string
2. `merchantDomain` and `serverUrls` are set on the interceptor (they drive policy negotiation in `onBeforeToolCall`)
3. `serverUrl` is set on the per-client `attributeVercelAiSdkMcp` call (otherwise content_id values for transactions will be less specific)
4. `logEndpoint` is reachable from where the SDK runs

---

## What about `experimental_createMCPClient`?

The legacy `experimental_createMCPClient` from older versions of the `ai` package (re-exported from `@ai-sdk/mcp` for backward compatibility) returns a structurally compatible MCPClient. The helper accepts both — `attributeVercelAiSdkMcp` only depends on the public `request()` method shape, which has been stable across the experimental → stable transition.

```ts
import { experimental_createMCPClient } from 'ai'  // legacy
// or:
import { createMCPClient } from '@ai-sdk/mcp'      // current

// Either way:
const mcpClient = await createMCPClient({ transport: ... })
attributeVercelAiSdkMcp(mcpClient, { interceptor })
```
