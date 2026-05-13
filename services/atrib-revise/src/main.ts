#!/usr/bin/env node
// atrib-revise standalone binary. Wires the McpServer to a stdio transport
// so it can be launched as a subprocess by an MCP host (Claude Code,
// Claude Desktop, etc.).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribReviseServer } from './index.js'

async function main() {
  const { mcp } = await createAtribReviseServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-revise: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
