#!/usr/bin/env node
// atrib-revise standalone binary (forwarding shim). Serves the legacy
// atrib-revise server, which mounts `atrib-revise` plus `attest` per the
// alias-window rule W1.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribReviseServer } from '@atrib/attest'

async function main() {
  const { mcp } = await createAtribReviseServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-revise: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
