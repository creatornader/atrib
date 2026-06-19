# atrib + Cloudflare Agents

This example shows how to add atrib attribution to a Cloudflare-deployed application using the [`agents`](https://www.npmjs.com/package/agents) package. Cloudflare exposes two distinct MCP integration surfaces, and atrib has a different (one-line) integration story for each.

| Surface                                | What it does                                                                                         | atrib integration                                                                                                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`McpAgent`** (server-side)           | Builds an MCP server that runs as a Durable Object on Cloudflare. You define tools on `this.server`. | One-line `atrib(this.server, options)` from `@atrib/mcp/worker` in Workers. Same primitive as `@atrib/mcp` in Node-like hosts.                                                                                                                                          |
| **`Agent.addMcpServer`** (client-side) | Your Agent connects out to one or more upstream MCP servers via HTTP.                                | One-line `attributeCloudflareAgentMcp(this, { interceptor })` from `@atrib/agent`. Wraps each connection's underlying `Client` so calls carry atrib/W3C context, consume upstream tokens, record gap nodes, and emit fallback transaction records when commerce closes. |

Both integrations are zero-deploy: no extra Worker, no proxy hop, no architectural change to your app.

---

## Why this works without a Cloudflare-specific package

`McpAgent` exposes `this.server` as a real `McpServer` from `@modelcontextprotocol/sdk`; the same class atrib's existing middleware wraps. When `McpAgent.serve()` routes a request to your Durable Object, the underlying call lands at `McpServer.server.setRequestHandler(CallToolRequestSchema, ...)`, which is exactly the chokepoint our middleware monkey-patches.

In a Worker, import from `@atrib/mcp/worker`. The package root also exports Node-only helpers for stdio proxying, local mirror reads, and host-side instrumentation. The Worker subpath keeps those modules out of the Cloudflare bundle.

`Agent.addMcpServer` uses an internal `MCPClientManager` whose `callTool({ serverId, name, arguments })` method delegates straight to `mcpConnections[serverId].client.callTool(...)`. The `client` field is publicly exposed on `MCPClientConnection`, so we can wrap it in place after `addMcpServer` runs. Subsequent tool calls go through atrib's interceptor for context propagation, inbound attribution-token consumption, unsigned gap-node tracking, and agent-side fallback transaction emission when the response matches a known commerce close signal. The Cloudflare approval-trace example targets `agents@0.16.2` and `@cloudflare/codemode@0.4.1`.

See `DECISIONS.md` [D022](../../../../DECISIONS.md#d022-cloudflare-agents-adapter-mcpagent-server-side-is-zero-code-agent-client-side-uses-attributecloudflareagentmcp-not-createatribproxy) for the full architectural rationale.

---

## Surface 1: `McpAgent` (you're building an MCP server on Cloudflare)

Your Worker exposes tools that other agents can call. Add atrib in **one line** inside `init()`.

```ts
// src/index.ts
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { atrib } from '@atrib/mcp/worker'
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

Both work; see `packages/mcp/src/middleware.ts:258` for the retroactive-wrap implementation that was added in commit `c450672`. The example above puts `atrib()` after the tool registrations because it reads more naturally in `init()`, but you can swap the order without changing behavior.

### Live Worker proof

The runnable proof at [`live-worker-proof/`](live-worker-proof/) deploys a real Cloudflare `McpAgent` Durable Object, writes a diagnostic row into DO SQLite, recalls that row, captures signed atrib records in the DO, and verifies those records against `log.atrib.dev`.

Latest clean run:

```text
pnpm --filter @atrib/cloudflare-live-proof proof
worker_url: written to the ignored run artifact
context_id: e59be437e0bcf5391863b8464ba0cfb6
verified records:
  22832 sha256:99f88337e8905ada32a8f61037538cde1d49f3e5f6921001d61a8865bac26925 record_outcome
  22833 sha256:1667ce43254a940d7c22bab4d547337042c942c7b20ae396b569aa2c8b1f209e recall_outcomes
  22834 sha256:097e417b80a26361a3d9c537c19056b799c1ac49c53fecb69d3d997a7d6db0fa flush_atrib_queue
```

The proof runner verifies each listed record's hash, Ed25519 signature, and Merkle inclusion proof. The public `/v1/by-context/e59be437e0bcf5391863b8464ba0cfb6` query returned five total `tool_call` entries because `list_signed_records` and the final flush are also signed after the DO returns the first three records.

---

## Surface 2: `Agent` connecting out to upstream MCP servers

Your Worker is a chat agent (or similar) that connects to one or more upstream MCP servers and calls their tools. Add atrib by calling `attributeCloudflareAgentMcp(this, { interceptor })` once after your `addMcpServer` calls.

```ts
// src/index.ts
import { Agent, type Connection } from 'agents'
import { atrib, attributeCloudflareAgentMcp } from '@atrib/agent'

interface Env {
  ATRIB_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT: string
}

export class WeatherChatAgent extends Agent<Env> {
  // Construct the atrib interceptor once per agent instance.
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
    // lifecycle. Ordinary tool_call records come from the upstream MCP
    // server when it is wrapped with @atrib/mcp; this client-side wrapper
    // emits fallback transaction records when commerce closes.
    // The wrap is idempotent. Safe to call again if you add more servers later.
    const wrappedCount = attributeCloudflareAgentMcp(this, {
      interceptor: this.interceptor,
    })
    console.log(`atrib: wrapped ${wrappedCount} MCP connections`)
  }

  async onConnect(_conn: Connection) {
    // If you call addMcpServer in connection handlers (per-user MCP servers,
    // OAuth-completing-late, etc.), call attributeCloudflareAgentMcp again.
    // The wrap is idempotent; already-wrapped clients are skipped.
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
    → mcpConnections[serverId].client.callTool(...)   ← wrapped by atrib
      → atrib interceptor.onBeforeToolCall(name, _meta)
        → forward to original Client.callTool
          → upstream MCP server (HTTP/SSE)
      ← atrib interceptor.onAfterToolResponse(name, result, _meta)
```

The key insight is that `attributeCloudflareAgentMcp` replaces the `client` field on each `MCPClientConnection` in place. `MCPClientManager.callTool` reads `mcpConnections[serverId].client` at invocation time, so subsequent calls automatically use the wrapped version.

### Live client proof

The runnable proof at [`live-client-proof/`](live-client-proof/) deploys a real Cloudflare `Agent` Durable Object, connects it to an upstream `McpAgent` through `Agent.addMcpServer`, wraps the connection with `attributeCloudflareAgentMcp`, and verifies the fallback transaction record against `log.atrib.dev`.

The proof runner checks that the upstream MCP tool observed atrib trace metadata, that the unwrapped upstream produced an unsigned gap node, and that the agent emitted a signed transaction record with a valid public log inclusion proof.

```text
pnpm --filter @atrib/cloudflare-live-client-proof proof
```

Latest clean run:

```text
context_id: 9918dd8064998e04c07c72635fc496ee
verified record:
  22871 sha256:a1a9d277f65b2c1195d5bec6395b60b242cac76cfe826fdbb334ae4f1bbd7f01 transaction
```

### Interactive approval trace

The runnable example at [`approval-trace/`](approval-trace/) turns a Cloudflare
trigger into a human approval workflow backed by Code Mode runtime semantics:

```text
incoming trigger -> autonomous triage -> CodemodeRuntime approval halt -> human decision -> replayed execution -> signed outcome -> audit trace
```

It is intentionally Cloudflare-shaped. The target system is a Durable Object
SQLite table that models a repository file update, and the review gate pauses a
Code Mode connector method marked with `requiresApproval: true`. Tests use a
deterministic local executor with the same `createCodemodeRuntime` handle,
connector approval metadata, pending action shape, approve/reject calls, and
replay path. Production configuration uses `CodemodeRuntime`,
`DynamicWorkerExecutor`, and a Worker Loader binding.

The signed boundary is the point: exact proposal payload, generated code digest,
human decision over that payload, resumed execution, outcome, and handoff trace.
The UI focuses on the parts a reviewer needs first: trigger context, live
progress, review state, signed decision chain, receipt inspection, and signer
separation.

The current hosted proof is at
`https://atrib-cloudflare.nagala.workers.dev/`.
The latest verified refresh passed `proof:worker` with `391/391` checks at
`2026-06-19T06:26:47.961Z` from the public commit used for that proof:
[`4676ef40608b9a10a6701354d91772e24c529366`](https://github.com/creatornader/atrib/commit/4676ef40608b9a10a6701354d91772e24c529366).
The deployed Worker version for that run was
`34297846-9402-45e4-81ad-93712c0cfbdb`.

Third-party production redeploys may require Cloudflare Dynamic Workers access
because Worker Loader is used by `DynamicWorkerExecutor`. On accounts without
that access, `proof:worker` can fail before publishing with Cloudflare error
10195. Local Worker tests and deploy dry-runs still exercise the Code Mode
approval bridge without mutating a real Cloudflare production resource.

Run it with:

```text
pnpm --filter @atrib/cloudflare-approval-trace proof:worker
```

### OAuth evidence infrastructure reference

The reference at [`oauth-evidence-infra/`](oauth-evidence-infra/) is a Cloudflare
Worker plus Durable Object for the host-owned OAuth evidence surfaces from
[D111](../../../../DECISIONS.md#d111-host-owned-oauth-evidence-infrastructure):

- `POST /v1/dpop/check` backs `createFetchDpopReplayCache()` with atomic shared
  replay state.
- `POST /v1/oauth/introspect` backs `introspectOAuthToken()` with a proxy that
  keeps upstream OAuth secrets at the host boundary and strips token-shaped
  fields before returning evidence.

The reference is support infrastructure rather than a third Cloudflare Agent
adapter. Cloudflare-hosted MCP/OAuth deployments can run it next to either
surface when they
need fleet-shared DPoP replay checks or controlled opaque-token introspection.
It strengthens the Cloudflare authorization-evidence story without replacing
the approval-trace demo.

Run it with:

```text
pnpm --filter @atrib/cloudflare-oauth-evidence-infra test
```

### What if I need to support a stdio upstream from a Cloudflare Agent?

You can't; Cloudflare Workers don't support child processes, so `StdioClientTransport` from the MCP SDK doesn't work in the Worker runtime. Your upstream MCP server must be HTTP-accessible (`streamable-http` or the deprecated `sse` transport).

If your upstream is stdio-only, you have two options:

1. **Run the stdio MCP server elsewhere** (a long-lived process, container, etc.) and put a Streamable HTTP front-end in front of it. The Cloudflare Agent then connects to the HTTP front-end.
2. **Use `createAtribProxy()` on a non-Worker runtime** (Node.js process that you control) that proxies a stdio upstream out as Streamable HTTP. The Cloudflare Agent connects to that proxy URL. This is the same primitive shipped in commit `73094a9` for Claude Agent SDK Case B; see `packages/integration/examples/claude-agent-sdk/case-b-third-party-mcp.ts`.

---

## Environment variables

Both surfaces assume:

- **`ATRIB_PRIVATE_KEY`**: base64url-encoded 32-byte Ed25519 seed. Set via `wrangler secret put ATRIB_PRIVATE_KEY`. In production, store the matching public key on the merchant verification side.
- **`ATRIB_LOG_ENDPOINT`**: URL of your atrib Merkle log submission endpoint. Optional in development; submission queue silently buffers when unset (per spec [§5.8](../../../../atrib-spec.md#58-degradation-contract) degradation contract).

If `ATRIB_PRIVATE_KEY` is omitted, atrib operates in pass-through mode with a console warning. No records are emitted, but tool calls (and the Cloudflare DO lifecycle) still work normally.

---

## What you should observe

After deploying either example:

- **Surface 1 (McpAgent)**: every successful `tools/call` to your Worker emits a signed atrib record. Records share a `context_id` per MCP session and chain via `chain_root` references. Each Durable Object instance (per-session) constructs its own submission queue; that's per the spec's session model.
- **Surface 2 (Agent)**: every tool call your Agent makes to an upstream MCP server carries atrib/W3C context and can consume upstream attribution tokens. If the upstream is atrib-instrumented with `@atrib/mcp`, ordinary tool calls are signed upstream and form a verifiable chain with the agent's context. If the upstream is not wrapped, the agent records an unsigned gap node locally, and it emits a signed fallback `transaction` record when the response matches ACP, UCP, x402, MPP, AP2, or the checkout heuristic. The upstream response is unchanged from the agent's perspective.

If you don't see records, check:

1. `creatorKey` is set and is a valid 32-byte base64url string
2. `serverUrl` is set on the server side (it's required for unambiguous content_id derivation)
3. `merchantDomain` and `serverUrls` are set on the agent side (they drive policy negotiation in `onBeforeToolCall`)
4. For ordinary upstream tool-call records, the upstream MCP server is wrapped with `@atrib/mcp`
5. For agent-side fallback records, the response shape matches one of the transaction detectors in `@atrib/agent`
6. `logEndpoint` is reachable from the Worker runtime (Cloudflare's outbound fetch is allowed by default but check any firewall rules)
