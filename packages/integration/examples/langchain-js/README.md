# atrib with LangChain JS MCP tools

Validated with `@langchain/core` 1.2.17, `@langchain/langgraph` 1.5.0, and `@langchain/mcp-adapters` 2.0.1.

The [public helper](../../../agent/README.md#langchain-js) accepts an SDK loader callback, so agents can use `MCPAdapter.listTools()` or the deprecated `MultiServerMCPClient.getTools()` alias, including tools fetched before attribution setup. Use the same SDK naming and hook options in that callback:

```ts
import { MCPAdapter, loadMcpTools } from '@langchain/mcp-adapters'
import { atrib, attributeLangchainMcp } from '@atrib/agent'

const interceptor = atrib({ creatorKey: process.env.ATRIB_PRIVATE_KEY! })
const toolOptions = {
  prefixToolNameWithServerName: true,
  beforeToolCall: () => ({ headers: { 'X-Tenant': 'example-tenant' } }),
}
const multi = new MCPAdapter({
  ...toolOptions,
  servers: { search: { transport: 'http', url: 'https://search.example.com/mcp' } },
})
const tools = await multi.listTools()
await attributeLangchainMcp(multi, {
  interceptor,
  loadTools: (name, client) => loadMcpTools(name, client, toolOptions),
})
// Pass the existing tools to your LangChain agent or LangGraph ToolNode.
// Close the owning multi-client and flush the interceptor before exit.
```

In 2.0.1, cached tools capture the native header fork before attribution setup.
Use loader mode for per-call headers. In-place attribution covers base-client
calls and warns once about captured forks. Version 1.1.3 synthesizes forks through a proxy getter;
loader mode remains necessary for those forks. The helper accepts both
configuration snapshots (`servers` in 2.x, `mcpServers` in 1.x) and tool-list APIs.
It keeps cached tools and requires matching names from the loader. Select a
mode on the first helper call; mixing modes is rejected to avoid duplicates.

The [upstream migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-mcp-adapters)
covers the new configuration and result contracts. The adapter prefixes tool
names by default, while standalone `loadMcpTools` does not. Forward the same
naming options in both places, as above. Keep approval rules aligned with the
prefixed names. SDK 2 clients negotiate modern and legacy servers independently.
Structured content and protocol metadata remain in the tool artifact; a single
text block becomes plain model-facing text. Modern elicitation pauses a
checkpointed graph and resumes through `createMCPElicitationResume`.

For direct-client control, call `loadMcpTools(name, wrapMcpClient(client, interceptor), options)` yourself. Without a loader callback, `attributeLangchainMcp` continues to patch base-client calls and mutable forks. It reports unreplaceable native fork factories and directs callers to loader mode.

The [real SDK compatibility test](../../test/langchain-sdk-compat.test.ts) covers modern and legacy HTTP tool calls, cached tools, header forks, argument validation, backend errors, private result artifacts, checkpointed ToolNode execution, native MCP elicitation/resume, and [attributed store](../langgraph-store/README.md) namespace isolation. It uses localhost endpoints and no model provider.

```bash
pnpm --filter @atrib/integration exec vitest run test/langchain-sdk-compat.test.ts
pnpm --filter @atrib/integration typecheck:langchain-examples
pnpm --filter @atrib/integration test:langchain-packed
```

The runnable `integration.ts` needs caller-owned MCP servers and an atrib key. It is typechecked in CI; compatibility tests use a local fixture instead of those remote example endpoints.
