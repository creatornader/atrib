#!/usr/bin/env node
// atrib-trace standalone binary (forwarding shim). Serves the legacy
// atrib-trace server, which mounts `trace` + `trace_forward` plus the
// `recall` verb per the alias-window rule W1.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribTraceServer } from '@atrib/recall'

async function main() {
  const { mcp } = await createAtribTraceServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-trace: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
