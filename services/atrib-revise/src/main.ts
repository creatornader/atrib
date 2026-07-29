#!/usr/bin/env node
// atrib-revise standalone binary (forwarding shim). Serves the legacy
// atrib-revise server, which mounts `atrib-revise` plus `attest` per the
// alias-window rule W1.
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createAtribReviseServer } from '@atrib/attest'

async function main() {
  const { mcp } = await createAtribReviseServer()
  serveStdio(() => mcp)
}

main().catch((e) => {
  console.error('atrib-revise: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
