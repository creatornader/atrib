// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..', '..', '..')
const inventory = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts', 'mcp-v2-owned-surfaces.json'), 'utf8'),
) as {
  surfaces: Array<{
    id: string
    workspace: string
    entrypoint: string
    process_proof: string
  }>
}
const WRAPPER_SURFACE = inventory.surfaces.find((surface) => surface.id === 'mcp-wrap-stdio')
if (
  !WRAPPER_SURFACE ||
  WRAPPER_SURFACE.process_proof !== 'packages/mcp-wrap/test/stdio-v2.test.ts'
) {
  throw new Error('mcp-wrap-stdio is missing its owned-surface process proof')
}

it('negotiates MCP 2026-07-28 on the wrapper stdio boundary', { timeout: 30_000 }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atrib-mcp-wrap-v2-'))
  const configPath = join(tempDir, 'wrap-config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      name: 'v2-proof',
      agent: 'test',
      upstream: {
        command: 'node',
        args: [resolve(__dirname, 'fixtures', 'echo-server.mjs')],
      },
      serverUrl: 'mcp://v2-proof.local',
      logEndpoint: 'http://127.0.0.1:1/v1/entries',
      recordFile: join(tempDir, 'records.jsonl'),
      logFile: join(tempDir, 'wrapper.log'),
    }),
  )

  const transport = new StdioClientTransport({
    command: 'node',
    args: [resolve(ROOT, WRAPPER_SURFACE.workspace, WRAPPER_SURFACE.entrypoint), configPath],
    env: {
      ...process.env,
      ATRIB_PRIVATE_KEY: randomBytes(32).toString('base64url'),
    },
    stderr: 'pipe',
  })
  const client = new Client(
    { name: 'mcp-wrap-v2-test', version: '0.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )

  try {
    await client.connect(transport)
    const listed = await client.listTools()
    expect(client.getProtocolEra()).toBe('modern')
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
    expect(listed.tools.map((tool) => tool.name)).toContain('echo')
  } finally {
    await client.close().catch(() => {})
    rmSync(tempDir, { recursive: true, force: true })
  }
})
