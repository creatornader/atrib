#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// atrib-summarize standalone binary. Wires the McpServer to a stdio transport
// so it can be launched as a subprocess by an MCP host (Claude Code,
// Claude Desktop, etc.).

import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createAtribSummarizeServer } from './index.js'

async function main() {
  const { mcp } = await createAtribSummarizeServer()
  serveStdio(() => mcp)
}

main().catch((e) => {
  console.error('atrib-summarize: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
