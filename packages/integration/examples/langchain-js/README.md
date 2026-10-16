# atrib with LangChain JS MCP tools

Validated with `@langchain/core` 1.2.17, `@langchain/langgraph` 1.5.0, and the documented `@langchain/mcp-adapters` 1.1.3 integration. Adapter 2.x is a separate migration.

The [public helper](../../../agent/README.md#langchain-js) accepts an SDK loader callback, so existing agents can keep using `MultiServerMCPClient.getTools()`, including tools fetched before attribution setup. Use the same SDK naming and hook options in that callback:

```ts
import { MultiServerMCPClient, loadMcpTools } from '@langchain/mcp-adapters'
import { atrib, attributeLangchainMcp } from '@atrib/agent'

const interceptor = atrib({ creatorKey: process.env.ATRIB_PRIVATE_KEY! })
const toolOptions = {
  prefixToolNameWithServerName: true,
  beforeToolCall: () => ({ headers: { 'X-Tenant': 'example-tenant' } }),
}
const multi = new MultiServerMCPClient({
  ...toolOptions,
  mcpServers: { search: { transport: 'http', url: 'https://search.example.com/mcp' } },
})
const tools = await multi.getTools()
await attributeLangchainMcp(multi, {
  interceptor,
  loadTools: (name, client) => loadMcpTools(name, client, toolOptions),
})
// Pass the existing tools to your LangChain agent or LangGraph ToolNode.
// Close the owning multi-client and flush the interceptor before exit.
```

The native 1.1.3 client exposes `fork` through a proxy getter, so replacing its `fork` property does not intercept newly created clients. The loader receives an outer `wrapMcpClient` proxy that attributes each fork result without changing SDK prototypes or private fields. The helper updates cached tool callbacks only after the SDK loader returns matching tool names. Select loader mode on the first helper call; combining it with in-place mode is rejected to prevent duplicate attribution.

For direct-client control, call `loadMcpTools(name, wrapMcpClient(client, interceptor), options)` yourself. Without a loader callback, `attributeLangchainMcp` continues to patch base-client calls and mutable forks. It reports unreplaceable native fork factories and directs callers to loader mode.

The [real SDK compatibility test](../../test/langchain-sdk-compat.test.ts) covers actual HTTP tool calls, cached tools, header forks, argument validation, backend errors, checkpointed ToolNode execution, interrupt/resume, and [attributed store](../langgraph-store/README.md) namespace isolation. It uses localhost endpoints and no model provider.

```bash
pnpm --filter @atrib/integration exec vitest run test/langchain-sdk-compat.test.ts
pnpm --filter @atrib/integration typecheck:langchain-examples
```

The runnable `integration.ts` needs caller-owned MCP servers and an atrib key. It is typechecked in CI; compatibility tests use a local fixture instead of those remote example endpoints.
