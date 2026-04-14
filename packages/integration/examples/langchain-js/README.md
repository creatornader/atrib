# Atrib + LangChain JS (`@langchain/mcp-adapters`)

This example shows how to add Atrib attribution to a LangChain JS application that uses MCP tools via `MultiServerMCPClient` from `@langchain/mcp-adapters`.

The integration is **one extra line**: `await attributeLangchainMcp(multiClient, { interceptor })` after `multiClient.initializeConnections()` resolves. The helper walks every server in the multi-client's config, reaches each internal `@modelcontextprotocol/sdk` Client via `multiClient.getClient(serverName)`, and patches `callTool` in place so every outbound tools/call flows through Atrib's interceptor lifecycle (W3C trace context propagation, attribution token chaining, transaction detection per spec §5.4).

---

## Why `MultiServerMCPClient` needs its own helper (and `loadMcpTools` does not)

LangChain's `@langchain/mcp-adapters` exposes two APIs, and they integrate with Atrib differently:

### High-level: `MultiServerMCPClient` → **use `attributeLangchainMcp`**

```ts
const multi = new MultiServerMCPClient({ mcpServers: { ... } })
await multi.initializeConnections()
await attributeLangchainMcp(multi, { interceptor })
const tools = await multi.getTools()
```

`MultiServerMCPClient` owns its internal Client instances behind `#private` fields. You never touch the Client reference directly — the only way to reach it is the `getClient(serverName)` getter, and there is no corresponding setter. This rules out the `wrapMcpClient` Proxy pattern (which returns a new wrapped object) because there is nowhere to put the new reference.

The helper monkey-patches `callTool` on each internal Client in place, which is safe because LangChain's tool functions dereference `client.callTool` at invocation time (verified at `@langchain/mcp-adapters@1.1.3` `dist/tools.js:391`). It also wraps `client.fork()` — LangChain's per-call header-changing mechanism — so forked clients are recursively patched too. Without that, any tool using per-call authentication headers would silently bypass Atrib.

### Low-level: `loadMcpTools(name, rawClient)` → **use `wrapMcpClient`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { loadMcpTools } from '@langchain/mcp-adapters'
import { atrib, wrapMcpClient } from '@atrib/agent'

const interceptor = atrib({ creatorKey: process.env.ATRIB_PRIVATE_KEY! })
const rawClient = new Client({ name: 'my-agent', version: '1.0.0' }, { capabilities: {} })
await rawClient.connect(transport)

const wrapped = wrapMcpClient(rawClient, { interceptor })
const tools = await loadMcpTools('search', wrapped)
```

`loadMcpTools(serverName, client)` accepts a raw `@modelcontextprotocol/sdk` Client as its second argument (verified at `dist/tools.d.ts:28`), so you can construct your own Client, wrap it with the existing `wrapMcpClient` helper from `@atrib/agent`, and pass the wrapped instance directly. No new code required for this path — it's just a shape the existing wrapper already covers.

Use this path when you want explicit control over Client construction (e.g. custom transports, custom auth flows). Use `MultiServerMCPClient` + `attributeLangchainMcp` for the config-driven multi-server workflow that most LangChain apps use.

---

## Usage (MultiServerMCPClient path)

```ts
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { atrib, attributeLangchainMcp } from '@atrib/agent'

// 1. Construct the Atrib interceptor (once per agent process / request).
//    Handles session lifecycle, policy negotiation, W3C trace context
//    propagation, and Path 1/2 transaction detection per spec §5.4.
const interceptor = atrib({
  creatorKey: process.env.ATRIB_PRIVATE_KEY!,
  merchantDomain: 'https://merchant.example.com',
  serverUrls: ['https://search.example.com', 'https://shop.example.com'],
  logEndpoint: process.env.ATRIB_LOG_ENDPOINT,
})

// 2. Construct the MultiServerMCPClient as you normally would.
const multi = new MultiServerMCPClient({
  mcpServers: {
    search: { transport: 'http', url: 'https://search.example.com/mcp' },
    shop: { transport: 'http', url: 'https://shop.example.com/mcp' },
  },
})

// 3. Initialize connections explicitly so that attributeLangchainMcp can
//    reach every configured server's internal Client.
await multi.initializeConnections()

// 4. ★ ATRIB ★ — patch every internal Client's callTool + fork in place.
//    Idempotent — safe to call multiple times.
//    Returns the number of newly-patched clients.
await attributeLangchainMcp(multi, {
  interceptor,
  serverUrls: {
    search: 'https://search.example.com',
    shop: 'https://shop.example.com',
  },
})

// 5. Build the LangChain tool set and use it as you normally would.
const tools = await multi.getTools()

const agent = createReactAgent({
  llm: new ChatAnthropic({ model: 'claude-sonnet-4-6' }),
  tools,
})

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What tools can you call?' }],
})

console.log(result)

// 6. Cleanup: close the multi-client and flush pending attribution records.
await multi.close()
await interceptor.flush()
```

That's the entire integration. Every successful tool call going through LangChain emits a signed Atrib record. Tool inputs and outputs are unchanged from LangChain's perspective.

---

## Order independence: before or after `getTools()`

`attributeLangchainMcp` can be called **before or after** `multi.getTools()`. LangChain's tool construction captures the `client` reference by closure but dereferences `client.callTool` at _invocation_ time (see `@langchain/mcp-adapters@1.1.3` `dist/tools.js:391`). As long as the patch is in place before any tool is invoked, every invocation flows through Atrib regardless of when you called the helper.

Most production setups call `initializeConnections()` first, then `attributeLangchainMcp`, then `getTools()` — a predictable linear order. But the helper is designed to be safe in either direction so you don't need to remember the sequence.

---

## Per-call auth headers and `fork()`

LangChain's MCP adapters support per-call HTTP header changes via a `beforeToolCall` hook and an internal `client.fork(headers)` call that creates a fresh Client with the requested headers. This is the idiomatic pattern for per-user authentication (every user's tool calls get their own auth token).

**`attributeLangchainMcp` handles this correctly.** When it patches a Client, it also wraps `fork()` so that any forked instance is recursively patched before being returned. Every forked client goes through Atrib just like the original. If a tool sets per-user headers, attribution still flows.

This is explicitly tested (`test/langchain-mcp.test.ts` → "fork propagation"). A naive monkey-patch that forgot to handle `fork()` would silently drop attribution for every per-user tool call — exactly the kind of invisible bug that would only surface when an auditor asked "why are our per-user calls not in the log?" a month later.

---

## Multiple MCP servers

`MultiServerMCPClient` is inherently multi-server — you list all of them in `mcpServers` and `attributeLangchainMcp` patches every one by default. Use the `serverUrls` option to give each server a canonical URL for Atrib's content_id derivation:

```ts
await attributeLangchainMcp(multi, {
  interceptor,
  serverUrls: {
    search: 'https://search.example.com',
    shop: 'https://shop.example.com',
    maps: 'https://maps.example.com',
  },
})
```

To selectively patch only a subset of servers (rare — usually you want all of them), pass `servers`:

```ts
await attributeLangchainMcp(multi, {
  interceptor,
  servers: ['search'], // shop and maps will NOT be attributed
})
```

---

## Environment variables

- **`ATRIB_PRIVATE_KEY`** — base64url-encoded 32-byte Ed25519 seed. Generate one for development with:
  ```bash
  node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))'
  ```
- **`ATRIB_LOG_ENDPOINT`** — URL of your Atrib Merkle log submission endpoint. Optional in development; the submission queue silently buffers when unset.

If `ATRIB_PRIVATE_KEY` is omitted, Atrib operates in pass-through mode with a console warning. No records are emitted, but LangChain keeps working.

---

## What you should observe

After running with `ATRIB_LOG_ENDPOINT` pointed at your log:

- Every successful `tools/call` from the LangChain agent emits a signed Atrib record
- Records share a `context_id` per agent session and chain via `chain_root` references
- Failed tool calls (`isError: true` from the upstream) emit no record per spec §5.3.3
- Internal atrib failures (network, signing, interceptor errors) never reach LangChain's tool dispatch — they're caught and logged with the `atrib:` console prefix per §5.8
- Per-call-header workflows (forked clients) also emit records — no silent drops

If you don't see records, check:

1. `creatorKey` is set and is a valid 32-byte base64url string
2. `merchantDomain` and `serverUrls` are set on the `atrib()` interceptor (they drive policy negotiation in `onBeforeToolCall`)
3. `serverUrls` is set on the per-client `attributeLangchainMcp` call (otherwise content_id values for transactions will be less specific)
4. `logEndpoint` is reachable from where LangChain runs
5. You called `attributeLangchainMcp` AFTER `initializeConnections()` (or use `getClient(name)`'s lazy init)
