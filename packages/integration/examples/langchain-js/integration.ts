/**
 * atrib + LangChain JS MCP, runnable integration snippet
 *
 * Demonstrates the atrib wiring for a `@langchain/mcp-adapters`
 * `MultiServerMCPClient`. The agent invocation step (`createReactAgent` +
 * `agent.invoke(...)`) is omitted from this file so the example stays focused
 * on the atrib integration. Drop this pattern into any LangChain app that
 * uses MCP tools, the rest of your LangChain code is unchanged.
 *
 * Run with:
 *   ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
 *   ATRIB_LOG_ENDPOINT=https://your.log/submit \
 *   pnpm tsx integration.ts
 *
 * NOTE: This file imports from `@langchain/mcp-adapters`, which is NOT a
 * dependency of @atrib/integration. To run, install it in your own workspace:
 *
 *   pnpm add @langchain/mcp-adapters @langchain/anthropic @langchain/langgraph
 *
 * The integration package's tsconfig excludes `examples/` from compilation
 * for exactly this reason, examples typecheck against user-installed
 * versions, not against our test build.
 */

import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { atrib, attributeLangchainMcp } from '@atrib/agent'

async function main() {
  // 1. Construct the atrib interceptor.
  //    Handles session lifecycle, policy negotiation, W3C trace context
  //    propagation, and Path 1/2 transaction detection per spec §5.4.
  const interceptor = atrib({
    creatorKey: process.env.ATRIB_PRIVATE_KEY!,
    merchantDomain: 'https://merchant.example.com',
    serverUrls: ['https://search.example.com', 'https://shop.example.com'],
    ...(process.env.ATRIB_LOG_ENDPOINT ? { logEndpoint: process.env.ATRIB_LOG_ENDPOINT } : {}),
  })

  // 2. Construct the MultiServerMCPClient as you normally would.
  const multi = new MultiServerMCPClient({
    mcpServers: {
      search: { transport: 'http', url: 'https://search.example.com/mcp' },
      shop: { transport: 'http', url: 'https://shop.example.com/mcp' },
    },
  })

  try {
    // 3. Initialize connections explicitly. This ensures every configured
    //    server has a live Client instance that attributeLangchainMcp can
    //    reach via multi.getClient(serverName).
    await multi.initializeConnections()

    // 4. ★ ATRIB ★, patch every internal Client's callTool + fork in place.
    //    Idempotent. Returns the number of newly-patched clients.
    //    Order: can be called BEFORE or AFTER multi.getTools() because
    //    LangChain dereferences client.callTool at invocation time.
    const patchedCount = await attributeLangchainMcp(multi, {
      interceptor,
      serverUrls: {
        search: 'https://search.example.com',
        shop: 'https://shop.example.com',
      },
    })
    console.log(`Attributed ${patchedCount} MCP clients`)

    // 5. Build the LangChain tool set. Pass `tools` to your LLM / agent
    //    runtime as you normally would. Each tool's execute function calls
    //    client.callTool() under the hood, which is now patched, every
    //    tool call flows through the atrib interceptor without further
    //    changes to your LangChain wiring.
    const tools = await multi.getTools()
    console.log(
      `Loaded ${tools.length} tools from ${Object.keys(multi.config.mcpServers ?? {}).length} servers`,
    )
    console.log(`Tool names: ${tools.map((t) => t.name).join(', ')}`)

    // ... your existing LangChain code goes here, e.g.:
    //
    // import { ChatAnthropic } from '@langchain/anthropic'
    // import { createReactAgent } from '@langchain/langgraph/prebuilt'
    //
    // const agent = createReactAgent({
    //   llm: new ChatAnthropic({ model: 'claude-sonnet-4-6' }),
    //   tools,
    // })
    //
    // const result = await agent.invoke({
    //   messages: [{ role: 'user', content: 'What can you do?' }],
    // })
    // console.log(result)
  } finally {
    // 6. Cleanup. Closing the multi-client releases all transports, and
    //    flushing the interceptor drains the submission queue (any
    //    pending atrib records get one final POST attempt).
    await multi.close()
    await interceptor.flush()
  }
}

main().catch((err) => {
  console.error('integration failed:', err)
  process.exit(1)
})
