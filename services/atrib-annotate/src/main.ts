#!/usr/bin/env node
// atrib-annotate standalone binary (forwarding shim). Serves the legacy
// atrib-annotate server, which mounts `atrib-annotate` plus `attest` per
// the alias-window rule W1.
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createAtribAnnotateServer } from '@atrib/attest'

async function main() {
  const { mcp } = await createAtribAnnotateServer()
  serveStdio(() => mcp)
}

main().catch((e) => {
  console.error('atrib-annotate: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
