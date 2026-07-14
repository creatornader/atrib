#!/usr/bin/env node
// atrib-attest standalone binary. Serves the write-verb union (attest +
// emit + atrib-annotate + atrib-revise) over a stdio transport so it can be
// launched as a subprocess by an MCP host (Claude Code, Claude Desktop,
// etc.). All four names dispatch to one handleEmit funnel; records are
// byte-identical regardless of which name signed them.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribAttestServer } from './index.js'

async function main() {
  const { mcp } = await createAtribAttestServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  // Stays alive on the stdio transport until the host closes it.
}

main().catch((e) => {
  console.error('atrib-attest: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
