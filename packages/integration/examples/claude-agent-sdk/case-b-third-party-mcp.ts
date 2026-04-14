/**
 * atrib + Claude Agent SDK. Case B: instrument a third-party MCP server
 *
 * Your tools live in an upstream MCP server (filesystem, fetch, GitHub, etc.)
 * that you connect to via stdio or HTTP. You don't own the McpServer instance,
 * so atrib() can't be applied directly. createAtribProxy() solves this by
 * standing up an in-process surrogate McpServer that mirrors the upstream's
 * tool catalog and forwards tools/call to it. atrib() is applied to the
 * surrogate, so every forwarded call is attributed.
 *
 * Run with:
 *   ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
 *   ATRIB_LOG_ENDPOINT=https://your.log/submit \
 *   ANTHROPIC_API_KEY=sk-... \
 *   pnpm tsx case-b-third-party-mcp.ts
 *
 * NOTE: This file imports from @anthropic-ai/claude-agent-sdk, which is NOT a
 * dependency of @atrib/integration. To run, install it in a separate workspace
 * or temporarily add it to your local copy of this directory:
 *
 *   pnpm add @anthropic-ai/claude-agent-sdk
 *
 * The example also assumes `@modelcontextprotocol/server-filesystem` is
 * available via `npx -y` (it is. npx will fetch it on first run).
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { createAtribProxy } from '@atrib/mcp'

async function main() {
  // 1. Build the proxy. This connects to the upstream as an MCP client and
  //    snapshots its tool catalog. The proxy itself is an in-process McpServer
  //    that you hand to Claude Agent SDK as { type: 'sdk', ... }.
  const proxy = await createAtribProxy({
    name: 'fs',
    upstream: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    },
    atrib: {
      ...(process.env.ATRIB_PRIVATE_KEY ? { creatorKey: process.env.ATRIB_PRIVATE_KEY } : {}),
      serverUrl: 'https://example.com/fs',
      ...(process.env.ATRIB_LOG_ENDPOINT ? { logEndpoint: process.env.ATRIB_LOG_ENDPOINT } : {}),
    },
  })

  try {
    // 2. Pass the proxy's in-process server to Claude Agent SDK as the SDK
    //    transport type. Same shape as Case A. Claude Agent SDK can't tell
    //    the difference.
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
    // 3. Disconnect the upstream cleanly. The host will close the in-process
    //    side of the proxy server when it tears down its own MCP connection.
    await proxy.close()
  }
}

main().catch((err) => {
  console.error('agent failed:', err)
  process.exit(1)
})
