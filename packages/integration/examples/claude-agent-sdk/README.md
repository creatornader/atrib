# atrib + Claude Agent SDK

This example shows how to add **value provenance** (atrib attribution records) to a Claude Agent SDK application. It covers both common cases:

- **Case A** — your tools live in-process, defined with `createSdkMcpServer()`. atrib is **one extra line** of code.
- **Case B** — your tools live in a third-party MCP server (filesystem, fetch, custom stdio, etc.). atrib uses a thin proxy primitive (`createAtribProxy`) to attribute calls flowing through the upstream.

Both cases produce the same kind of attribution record. From Claude Agent SDK's perspective, both look like a normal `{ type: 'sdk', name, instance: McpServer }` MCP server config.

---

## Why this works without a Claude-SDK-specific adapter

Claude Agent SDK accepts user-supplied MCP servers as `{ type: 'sdk', name, instance }` where `instance` is a real `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` — the **exact same class** that atrib's `atrib()` middleware wraps. When the SDK invokes a tool on the in-process server, it goes through the standard `McpServer.connect(transport)` dispatch path, and atrib's interceptor fires on every `tools/call`. There is no Claude-specific code in `@atrib/mcp` — the same primitive works against any host that accepts an in-process `McpServer`.

See `DECISIONS.md` D021 for the full architecture rationale.

---

## Case A — instrument in-process tools

Your tools are defined in your own code with `createSdkMcpServer()` and `tool()` from `@anthropic-ai/claude-agent-sdk`. Add atrib in **one line**: call `atrib(sdkServer.instance, options)` after creating the server.

```ts
import { createSdkMcpServer, tool, query } from '@anthropic-ai/claude-agent-sdk'
import { atrib } from '@atrib/mcp'
import { z } from 'zod'

// 1. Define your tools as you normally would
const getTemperature = tool(
  'get_temperature',
  'Get the current temperature at a location',
  {
    latitude: z.number().describe('Latitude coordinate'),
    longitude: z.number().describe('Longitude coordinate'),
  },
  async (args) => {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m&temperature_unit=fahrenheit`,
    )
    const data = (await r.json()) as { current: { temperature_2m: number } }
    return {
      content: [{ type: 'text', text: `Temperature: ${data.current.temperature_2m}°F` }],
    }
  },
)

// 2. Wrap them in an in-process SDK MCP server (standard Claude Agent SDK API)
const weatherServer = createSdkMcpServer({
  name: 'weather',
  version: '1.0.0',
  tools: [getTemperature],
})

// 3. ★ ATRIB: one line to attribute every tool call ★
//    weatherServer.instance is a real McpServer from @modelcontextprotocol/sdk
atrib(weatherServer.instance, {
  creatorKey: process.env.ATRIB_PRIVATE_KEY!, // base64url-encoded 32-byte Ed25519 seed
  serverUrl: 'https://your-domain.example/weather', // canonical content_id derivation
  logEndpoint: process.env.ATRIB_LOG_ENDPOINT,
})

// 4. Hand the server to Claude Agent SDK exactly as you would without atrib
for await (const message of query({
  prompt: "What's the temperature in San Francisco?",
  options: {
    mcpServers: { weather: weatherServer },
    allowedTools: ['mcp__weather__get_temperature'],
  },
})) {
  if (message.type === 'result' && message.subtype === 'success') {
    console.log(message.result)
  }
}
```

That's the entire integration. Every successful `tools/call` going through `weatherServer` emits a signed atrib record to `logEndpoint`. The tool's response is unchanged from Claude's perspective.

---

## Case B — instrument a third-party MCP server

Your tools live in a third-party MCP server that you connect to via stdio or HTTP. You don't own the `McpServer` instance — it's running in another process. To attribute calls flowing through it, use `createAtribProxy()` from `@atrib/mcp`. The proxy is an in-process surrogate `McpServer` that:

1. Connects to your upstream as a normal MCP client
2. Mirrors the upstream's tool catalog
3. Forwards `tools/call` requests to the upstream and returns the response
4. Has atrib middleware applied at the proxy layer, so every forwarded call is attributed

You hand the proxy's `.server` to Claude Agent SDK as `{ type: 'sdk', name, instance: proxy.server }` — the same shape as Case A. From Claude's perspective, the proxy is just another in-process MCP server.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'
import { createAtribProxy } from '@atrib/mcp'

// 1. Build the proxy. It will spawn `npx -y @modelcontextprotocol/server-filesystem`
//    as a stdio child and mirror its tool catalog.
const proxy = await createAtribProxy({
  name: 'fs',
  upstream: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  },
  atrib: {
    creatorKey: process.env.ATRIB_PRIVATE_KEY!,
    serverUrl: 'https://your-domain.example/fs',
    logEndpoint: process.env.ATRIB_LOG_ENDPOINT,
  },
})

try {
  // 2. Pass the proxy's in-process server to Claude Agent SDK as { type: 'sdk' }
  for await (const message of query({
    prompt: 'List the files in /tmp.',
    options: {
      mcpServers: {
        fs: { type: 'sdk', name: 'fs', instance: proxy.server },
      },
      allowedTools: ['mcp__fs__list_directory', 'mcp__fs__read_file'],
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      console.log(message.result)
    }
  }
} finally {
  // 3. Disconnect from the upstream cleanly
  await proxy.close()
}
```

What happens at runtime:

```
┌────────────────────┐  in-process    ┌─────────────────────┐  stdio  ┌─────────────────────────┐
│ Claude Agent SDK   │ ──[tools/*]──▶ │ atrib proxy         │ ──────▶ │ server-filesystem       │
│ (your app)         │                │ (atrib() applied)    │         │ (npx child process)     │
└────────────────────┘                └─────────────────────┘         └─────────────────────────┘
                                                │
                                                │ on success: emit signed
                                                ▼ atrib record
                                       ┌─────────────────────┐
                                       │  ATRIB_LOG_ENDPOINT │
                                       └─────────────────────┘
```

The upstream `server-filesystem` process is unmodified. It sees a normal `tools/call` request with no atrib metadata; the proxy strips atrib's outbound `_meta.atrib` token before forwarding so the upstream's response shape is unchanged.

---

## When to use which case

| If…                                                                                       | Use                                                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Your tools are defined in your own TypeScript with `tool()` + `createSdkMcpServer()`      | **Case A**                                                            |
| You're connecting to an existing third-party MCP server (filesystem, fetch, GitHub, etc.) | **Case B**                                                            |
| You have multiple upstream servers                                                        | One **Case B** proxy per upstream                                     |
| You have a mix                                                                            | Use both — Case A for your own tools and Case B for the third parties |

---

## Environment variables

Both cases assume:

- `ATRIB_PRIVATE_KEY` — base64url-encoded 32-byte Ed25519 seed. Use `node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'` to generate one for development. In production, store the matching public key on the merchant verification side.
- `ATRIB_LOG_ENDPOINT` — URL of your atrib Merkle log submission endpoint. Optional in development; submission queue silently buffers when unset (per spec §5.8 degradation contract).

If `ATRIB_PRIVATE_KEY` is omitted, atrib operates in pass-through mode with a console warning — no records are emitted but the tool calls still work.

---

## What you should observe

After running either example with `ATRIB_LOG_ENDPOINT` pointed at your log:

- A signed atrib record per successful tool call (Case A: per `weather` call; Case B: per forwarded filesystem call)
- The records share a `context_id` per Claude session and chain via `chain_root` references (verifiable with `@atrib/verify`)
- Failed calls (`isError: true` from the tool) emit no record per spec §5.3.3
- atrib failures (network, signing) never reach Claude Agent SDK's tool dispatch — they're caught and logged with the `atrib:` console prefix per §5.8

If you don't see records, check:

1. `creatorKey` is set and is a valid 32-byte base64url string
2. `serverUrl` is set (otherwise `content_id` won't uniquely identify your server — atrib emits a console warning at startup for this case)
3. `logEndpoint` is reachable from where the SDK runs
