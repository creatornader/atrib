#!/usr/bin/env node
// atrib-verify standalone binary (forwarding shim). Serves the legacy
// atrib-verify server, which mounts `atrib-verify` plus the `recall` verb
// per the alias-window rule W1.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribVerifyServer } from '@atrib/recall'

async function main() {
  const { mcp } = await createAtribVerifyServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-verify: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
