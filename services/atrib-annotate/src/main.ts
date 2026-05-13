#!/usr/bin/env node
// atrib-annotate standalone binary. Wires the McpServer to a stdio transport
// so it can be launched as a subprocess by an MCP host (Claude Code,
// Claude Desktop, etc.).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribAnnotateServer } from './index.js'

async function main() {
  const { mcp } = await createAtribAnnotateServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-annotate: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
