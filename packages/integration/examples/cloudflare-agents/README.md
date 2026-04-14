# Atrib + Cloudflare Agents

This example shows how to add Atrib attribution to a Cloudflare-deployed application using the [`agents`](https://www.npmjs.com/package/agents) package. Cloudflare exposes two distinct MCP integration surfaces, and Atrib has a different (one-line) integration story for each.

| Surface                                | What it does                                                                                         | Atrib integration                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`McpAgent`** (server-side)           | Builds an MCP server that runs as a Durable Object on Cloudflare. You define tools on `this.server`. | One-line `atrib(this.server, options)` from `@atrib/mcp`. Same primitive that works for Claude Agent SDK Case A.                                                                      |
| **`Agent.addMcpServer`** (client-side) | Your Agent connects out to one or more upstream MCP servers via HTTP.                                | One-line `attributeCloudflareAgentMcp(this, { interceptor })` from `@atrib/agent`. Wraps each connection's underlying `Client` so subsequent tool calls flow through the interceptor. |

Both integrations are zero-deploy: no extra Worker, no proxy hop, no architectural change to your app.

---

## Why this works without a Cloudflare-specific package

`McpAgent` exposes `this.server` as a real `McpServer` from `@modelcontextprotocol/sdk` — the same class Atrib's existing middleware wraps. When `McpAgent.serve()` routes a request to your Durable Object, the underlying call lands at `McpServer.server.setRequestHandler(CallToolRequestSchema, ...)`, which is exactly the chokepoint our middleware monkey-patches.

`Agent.addMcpServer` uses an internal `MCPClientManager` whose `callTool({ serverId, name, arguments })` method delegates straight to `mcpConnections[serverId].client.callTool(...)` (verified at `agents@0.9.0` `dist/client-BwgM3cRz.js:1444`). The `client` field is publicly exposed on `MCPClientConnection`, so we can wrap it in place after `addMcpServer` runs and every subsequent tool call goes through Atrib's interceptor.

See `DECISIONS.md` D022 for the full architectural rationale.

---

## Surface 1 — `McpAgent` (you're building an MCP server on Cloudflare)

Your Worker exposes tools that other agents can call. Add Atrib in **one line** inside `init()`.

```ts
// src/index.ts
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { atrib } from '@atrib/mcp'
import { z } from 'zod'

interface Env {
  ATRIB_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT: string
}

export class WeatherMcp extends McpAgent<Env> {
  server = new McpServer({ name: 'weather', version: '1.0.0' })

  async init() {
    this.server.registerTool(
      'get_temperature',
      {
        description: 'Get the current temperature for a location',
        inputSchema: {
          latitude: z.number(),
          longitude: z.number(),
        },
      },
      async ({ latitude, longitude }) => {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&temperature_unit=fahrenheit`,
        )
        const data = (await r.json()) as { current: { temperature_2m: number } }
        return {
          content: [{ type: 'text', text: `Temperature: ${data.current.temperature_2m}°F` }],
        }
      },
    )

    // ★ ATRIB: one line to attribute every tool call ★
    // this.server is a real McpServer from @modelcontextprotocol/sdk.
    // atrib() patches its dispatch path; every successful tools/call emits
    // a signed attribution record to ATRIB_LOG_ENDPOINT.
    atrib(this.server, {
      creatorKey: this.env.ATRIB_PRIVATE_KEY,
      serverUrl: 'https://your-worker.workers.dev/mcp',
      logEndpoint: this.env.ATRIB_LOG_ENDPOINT,
    })
  }
}

// Export as a Worker handler
export default WeatherMcp.serve('/mcp', { binding: 'WeatherMcp' })
```

**`wrangler.toml` snippet:**

```toml
name = "atrib-weather-mcp"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[durable_objects]
bindings = [{ name = "WeatherMcp", class_name = "WeatherMcp" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["WeatherMcp"]

[vars]
# Set in Cloudflare dashboard or via `wrangler secret put`:
# ATRIB_PRIVATE_KEY
# ATRIB_LOG_ENDPOINT
```

That's the entire integration. Each Durable Object instance (one per session) calls `atrib()` once during `init()`, and every successful `tools/call` going through that DO emits a signed attribution record.

### Order of operations

`atrib()` can be called **before** or **after** `registerTool()` calls:

- **Before** (canonical wrap-then-register pattern): `atrib()` patches `setRequestHandler` for tools/call, then `registerTool` later installs the dispatcher through the patched method.
- **After** (retroactive wrap, also supported): `registerTool` installs the dispatcher first, then `atrib()` reaches into the underlying server's `_requestHandlers` map and rewrites the dispatcher in place.

Both work — see `packages/mcp/src/middleware.ts:258` for the retroactive-wrap implementation that was added in commit `c450672`. The example above puts `atrib()` after the tool registrations because it reads more naturally in `init()`, but you can swap the order without changing behavior.

---

## Surface 2 — `Agent` connecting out to upstream MCP servers

Your Worker is a chat agent (or similar) that connects to one or more upstream MCP servers and calls their tools. Add Atrib by calling `attributeCloudflareAgentMcp(this, { interceptor })` once after your `addMcpServer` calls.

```ts
// src/index.ts
import { Agent, type Connection } from 'agents'
import { atrib, attributeCloudflareAgentMcp } from '@atrib/agent'

interface Env {
  ATRIB_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT: string
}

export class WeatherChatAgent extends Agent<Env> {
  // Construct the Atrib interceptor once per agent instance.
  // The interceptor handles session lifecycle, policy negotiation, W3C
  // trace context propagation, and transaction detection.
  interceptor = atrib({
    creatorKey: this.env.ATRIB_PRIVATE_KEY,
    merchantDomain: 'https://your-merchant.example.com',
    serverUrls: ['https://weather-mcp.example.com'],
    logEndpoint: this.env.ATRIB_LOG_ENDPOINT,
  })

  async onStart() {
    // 1. Register your upstream MCP servers as you normally would.
    await this.addMcpServer('weather', 'https://weather-mcp.example.com/mcp', {
      transport: { type: 'streamable-http' },
    })

    // 2. ★ ATRIB: one line to wrap every connected MCP client ★
    // After this call, every tool invoked via this.mcp.getAITools() goes
    // through the interceptor's onBeforeToolCall / onAfterToolResponse
    // lifecycle. The wrap is idempotent — safe to call again if you add
    // more servers later.
    const wrappedCount = attributeCloudflareAgentMcp(this, {
      interceptor: this.interceptor,
    })
    console.log(`atrib: wrapped ${wrappedCount} MCP connections`)
  }

  async onConnect(_conn: Connection) {
    // If you call addMcpServer in connection handlers (per-user MCP servers,
    // OAuth-completing-late, etc.), call attributeCloudflareAgentMcp again.
    // The wrap is idempotent — already-wrapped clients are skipped.
    attributeCloudflareAgentMcp(this, { interceptor: this.interceptor })
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return new Response('chat agent', { status: 200 })
  },
}
```

### How the integration works

When the Cloudflare Agent's tool dispatcher (e.g. via `streamText({ tools: this.mcp.getAITools() })` from the AI SDK) invokes a tool, the call path is:

```
ai SDK execute callback
  → MCPClientManager.callTool({ serverId, name, arguments })
    → mcpConnections[serverId].client.callTool(...)   ← wrapped by Atrib
      → Atrib interceptor.onBeforeToolCall(name, _meta)
        → forward to original Client.callTool
          → upstream MCP server (HTTP/SSE)
      ← Atrib interceptor.onAfterToolResponse(name, result, _meta)
```

The key insight is that `attributeCloudflareAgentMcp` replaces the `client` field on each `MCPClientConnection` in place. `MCPClientManager.callTool` reads `mcpConnections[serverId].client` at invocation time, so subsequent calls automatically use the wrapped version.

### What if I need to support a stdio upstream from a Cloudflare Agent?

You can't — Cloudflare Workers don't support child processes, so `StdioClientTransport` from the MCP SDK doesn't work in the Worker runtime. Your upstream MCP server must be HTTP-accessible (`streamable-http` or the deprecated `sse` transport).

If your upstream is stdio-only, you have two options:

1. **Run the stdio MCP server elsewhere** (a long-lived process, container, etc.) and put a Streamable HTTP front-end in front of it. The Cloudflare Agent then connects to the HTTP front-end.
2. **Use `createAtribProxy()` on a non-Worker runtime** (Node.js process that you control) that proxies a stdio upstream out as Streamable HTTP. The Cloudflare Agent connects to that proxy URL. This is the same primitive shipped in commit `73094a9` for Claude Agent SDK Case B — see `packages/integration/examples/claude-agent-sdk/case-b-third-party-mcp.ts`.

---

## Environment variables

Both surfaces assume:

- **`ATRIB_PRIVATE_KEY`** — base64url-encoded 32-byte Ed25519 seed. Set via `wrangler secret put ATRIB_PRIVATE_KEY`. In production, store the matching public key on the merchant verification side.
- **`ATRIB_LOG_ENDPOINT`** — URL of your Atrib Merkle log submission endpoint. Optional in development; submission queue silently buffers when unset (per spec §5.8 degradation contract).

If `ATRIB_PRIVATE_KEY` is omitted, Atrib operates in pass-through mode with a console warning. No records are emitted, but tool calls (and the Cloudflare DO lifecycle) still work normally.

---

## What you should observe

After deploying either example:

- **Surface 1 (McpAgent)**: every successful `tools/call` to your Worker emits a signed Atrib record. Records share a `context_id` per MCP session and chain via `chain_root` references. Each Durable Object instance (per-session) constructs its own submission queue — that's per the spec's session model.
- **Surface 2 (Agent)**: every tool call your Agent makes to an upstream MCP server emits a signed Atrib record on the agent side. The upstream's response is unchanged from the agent's perspective. If the upstream is also Atrib-instrumented (using `@atrib/mcp`), you'll get records from both sides forming a verifiable chain.

If you don't see records, check:

1. `creatorKey` is set and is a valid 32-byte base64url string
2. `serverUrl` is set on the server side (it's required for unambiguous content_id derivation)
3. `merchantDomain` and `serverUrls` are set on the agent side (they drive policy negotiation in `onBeforeToolCall`)
4. `logEndpoint` is reachable from the Worker runtime (Cloudflare's outbound fetch is allowed by default but check any firewall rules)
