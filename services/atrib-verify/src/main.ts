#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createAtribVerifyServer } from './index.js'

async function main() {
  const { mcp } = await createAtribVerifyServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

main().catch((e) => {
  console.error('atrib-verify: fatal', e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
