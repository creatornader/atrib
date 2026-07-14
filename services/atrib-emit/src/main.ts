#!/usr/bin/env node
// atrib-emit standalone binary (forwarding shim). Serves the legacy
// atrib-emit server, which mounts `emit` plus `attest` per the alias-window
// rule W1. Wires the McpServer to a stdio transport so it can be launched
// as a subprocess by an MCP host (Claude Code, Claude Desktop, etc.).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribEmitServer } from '@atrib/attest'

async function main() {
  const { mcp } = await createAtribEmitServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  // Stays alive on the stdio transport until the host closes it.
}

main().catch((e) => {
  console.error('atrib-emit: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
