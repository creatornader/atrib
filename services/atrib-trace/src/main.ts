#!/usr/bin/env node
// atrib-trace standalone binary (forwarding shim). Serves the legacy
// atrib-trace server, which mounts `trace` + `trace_forward` plus the
// `recall` verb per the alias-window rule W1.
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createAtribTraceServer } from '@atrib/recall'

async function main() {
  const { mcp } = await createAtribTraceServer()
  serveStdio(() => mcp)
}

main().catch((e) => {
  console.error('atrib-trace: fatal', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
