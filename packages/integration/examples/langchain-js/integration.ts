// SPDX-License-Identifier: Apache-2.0

import { loadMcpTools, MultiServerMCPClient } from '@langchain/mcp-adapters'
import { atrib, attributeLangchainMcp } from '@atrib/agent'

async function main() {
  const interceptor = atrib({
    creatorKey: process.env.ATRIB_PRIVATE_KEY!,
    ...(process.env.ATRIB_LOG_ENDPOINT ? { logEndpoint: process.env.ATRIB_LOG_ENDPOINT } : {}),
  })
  const serverUrls: Record<string, string> = {
    search: 'https://search.example.com/mcp',
    shop: 'https://shop.example.com/mcp',
  }
  const toolOptions = { prefixToolNameWithServerName: true }
  const multi = new MultiServerMCPClient({
    ...toolOptions,
    mcpServers: Object.fromEntries(
      Object.entries(serverUrls).map(([name, url]) => [name, { transport: 'http' as const, url }]),
    ),
  })

  try {
    const tools = await multi.getTools()
    await attributeLangchainMcp(multi, {
      interceptor,
      serverUrls,
      loadTools: (name, client) => loadMcpTools(name, client, toolOptions),
    })
    // Existing tool objects now use attributed callbacks, including forked
    // clients. Forward any beforeToolCall hook in the loader options too.
    console.log(`Loaded ${tools.length} attributed tools`)
  } finally {
    await multi.close()
    await interceptor.flush()
  }
}

main().catch((error) => {
  console.error('integration failed:', error)
  process.exit(1)
})
