#!/usr/bin/env node
// atrib-annotate standalone binary (forwarding shim). Serves the legacy
// atrib-annotate server, which mounts `atrib-annotate` plus `attest` per
// the alias-window rule W1.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribAnnotateServer } from '@atrib/attest'

async function main() {
  const { mcp } = await createAtribAnnotateServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-annotate: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
