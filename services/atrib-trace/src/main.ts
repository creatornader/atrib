#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// atrib-trace standalone binary. Wires the McpServer to a stdio transport
// so it can be launched as a subprocess by an MCP host (Claude Code,
// Claude Desktop, etc.).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribTraceServer } from './index.js'

async function main() {
  const { mcp } = await createAtribTraceServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  // Stays alive on the stdio transport until the host closes it.
}

main().catch((e) => {
  console.error('atrib-trace: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
