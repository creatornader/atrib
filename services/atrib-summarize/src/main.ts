#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// atrib-summarize standalone binary. Wires the McpServer to a stdio transport
// so it can be launched as a subprocess by an MCP host (Claude Code,
// Claude Desktop, etc.).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribSummarizeServer } from './index.js'

async function main() {
  const { mcp } = await createAtribSummarizeServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-summarize: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
