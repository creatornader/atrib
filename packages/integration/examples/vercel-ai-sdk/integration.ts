/**
 * atrib + Vercel AI SDK MCP — runnable integration snippet
 *
 * Demonstrates the atrib wiring for an `@ai-sdk/mcp` MCPClient.
 * The model invocation step (`streamText` / `generateText`) is omitted from
 * this file so the example stays focused on the atrib integration. Drop this
 * pattern into any AI SDK app that uses MCP tools — the rest of your AI SDK
 * code is unchanged.
 *
 * Run with:
 *   ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
 *   ATRIB_LOG_ENDPOINT=https://your.log/submit \
 *   pnpm tsx integration.ts
 *
 * NOTE: This file imports from `@ai-sdk/mcp`, which is NOT a dependency of
 * @atrib/integration. To run, install it in your own workspace:
 *
 *   pnpm add @ai-sdk/mcp
 *
 * The integration package's tsconfig excludes `examples/` from compilation
 * for exactly this reason — examples typecheck against user-installed
 * versions, not against our test build.
 */

import { createMCPClient } from '@ai-sdk/mcp'
import { atrib, attributeVercelAiSdkMcp } from '@atrib/agent'

async function main() {
  // 1. Construct the atrib interceptor.
  //    Handles session lifecycle, policy negotiation, W3C trace context
  //    propagation, and Path 1/2 transaction detection per spec §5.4.
  const interceptor = atrib({
    creatorKey: process.env.ATRIB_PRIVATE_KEY!,
    merchantDomain: 'https://merchant.example.com',
    serverUrls: ['https://my-tool.example.com'],
    ...(process.env.ATRIB_LOG_ENDPOINT ? { logEndpoint: process.env.ATRIB_LOG_ENDPOINT } : {}),
  })

  // 2. Create the @ai-sdk/mcp MCPClient as you normally would.
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: 'https://my-tool.example.com/mcp',
    },
  })

  try {
    // 3. ★ ATRIB ★ — patch the client's request method.
    //    Idempotent. Order: can be called BEFORE or AFTER mcpClient.tools()
    //    because the AI SDK builds tool execute() callbacks that read
    //    client.request at INVOCATION time, not at build time.
    attributeVercelAiSdkMcp(mcpClient, {
      interceptor,
      serverUrl: 'https://my-tool.example.com',
    })

    // 4. Build the AI SDK ToolSet. Pass `tools` to streamText/generateText
    //    in your application code as you normally would. Each tool's
    //    execute() callback calls client.request() under the hood, which
    //    is now patched — every tool call flows through the atrib
    //    interceptor without further changes to your AI SDK wiring.
    const tools = await mcpClient.tools()
    console.log(`Loaded ${Object.keys(tools).length} tools from MCP server`)
    console.log(`Tool names: ${Object.keys(tools).join(', ')}`)

    // ... your existing AI SDK code goes here, e.g.:
    //
    // import { streamText } from 'ai'
    // const result = await streamText({
    //   model: '<your model id>',
    //   tools,
    //   prompt: 'What can you do?',
    // })
    // for await (const chunk of result.textStream) process.stdout.write(chunk)
  } finally {
    // 5. Cleanup. Closing the MCP client releases the transport, and
    //    flushing the interceptor drains the submission queue (any
    //    pending atrib records get one final POST attempt).
    await mcpClient.close()
    await interceptor.flush()
  }
}

main().catch((err) => {
  console.error('integration failed:', err)
  process.exit(1)
})
