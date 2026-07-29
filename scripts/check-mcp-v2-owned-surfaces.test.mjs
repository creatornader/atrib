#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { validateEntrypointText, runOwnedSurfaceCheck } from './check-mcp-v2-owned-surfaces.mjs'

const stdioSurface = {
  id: 'fixture-stdio',
  source: 'src/main.ts',
  require: ['@modelcontextprotocol/server/stdio', 'serveStdio('],
  forbid: ['StdioServerTransport', 'server.connect('],
}

assert.deepEqual(
  validateEntrypointText(
    stdioSurface,
    "import { serveStdio } from '@modelcontextprotocol/server/stdio'\nserveStdio(() => server)\n",
  ),
  [],
)

assert.match(
  validateEntrypointText(
    stdioSurface,
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'\nserver.connect(new StdioServerTransport())\n",
  ).join('\n'),
  /missing.*serveStdio|forbidden.*StdioServerTransport/,
)

const result = runOwnedSurfaceCheck()
assert.deepEqual(result.errors, [])
assert.equal(result.protocol_version, '2026-07-28')
assert.equal(result.surface_count, 13)
assert.equal(result.published_surface_count, 12)

console.log('MCP v2 owned-surface checker tests passed')
