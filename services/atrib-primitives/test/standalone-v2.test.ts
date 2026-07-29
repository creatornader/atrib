// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const ROOT = resolve(__dirname, '..', '..', '..')
const PROCESS_PROOF = 'services/atrib-primitives/test/standalone-v2.test.ts'
const inventory = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts', 'mcp-v2-owned-surfaces.json'), 'utf8'),
) as {
  surfaces: Array<{
    package: string
    workspace: string
    entrypoint: string
    transport: string
    process_proof: string
  }>
}
const STANDALONE_SERVERS = inventory.surfaces.filter(
  (surface) => surface.process_proof === PROCESS_PROOF && surface.transport === 'stdio',
)

describe('standalone MCP v2 entry points', () => {
  for (const surface of STANDALONE_SERVERS) {
    it(`negotiates 2026-07-28 with ${surface.package}`, { timeout: 30_000 }, async () => {
      const transport = new StdioClientTransport({
        command: 'node',
        args: [resolve(ROOT, surface.workspace, surface.entrypoint)],
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
