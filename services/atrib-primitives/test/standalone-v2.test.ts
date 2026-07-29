// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const SERVICES_DIR = resolve(__dirname, '..', '..')
const STANDALONE_SERVERS = [
  ['@atrib/attest', 'atrib-attest/dist/main.js'],
  ['@atrib/emit', 'atrib-emit/dist/main.js'],
  ['@atrib/annotate', 'atrib-annotate/dist/main.js'],
  ['@atrib/revise', 'atrib-revise/dist/main.js'],
  ['@atrib/recall', 'atrib-recall/dist/index.js'],
  ['@atrib/summarize', 'atrib-summarize/dist/main.js'],
  ['@atrib/trace', 'atrib-trace/dist/main.js'],
  ['@atrib/verify-mcp', 'atrib-verify/dist/main.js'],
  ['@atrib/primitives-runtime', 'atrib-primitives/dist/index.js'],
] as const

describe('standalone MCP v2 entry points', () => {
  for (const [packageName, relativeBinary] of STANDALONE_SERVERS) {
    it(`negotiates 2026-07-28 with ${packageName}`, { timeout: 30_000 }, async () => {
      const transport = new StdioClientTransport({
        command: 'node',
        args: [resolve(SERVICES_DIR, relativeBinary)],
        env: {
          ...process.env,
          ATRIB_RECORD_FILE: resolve(__dirname, 'standalone-v2-records.jsonl'),
        },
        stderr: 'pipe',
      })
      const client = new Client(
        { name: 'atrib-standalone-v2-test', version: '0.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      )

      try {
        await client.connect(transport)
        const listed = await client.listTools()
        expect(client.getProtocolEra()).toBe('modern')
        expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
        expect(listed.tools.length).toBeGreaterThan(0)
      } finally {
        await client.close().catch(() => {})
      }
    })
  }
})
