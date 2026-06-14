// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

interface RuntimeLogVerifierUxSmokeResult {
  readonly ok: boolean
  readonly strategy: string
  readonly out_dir: string
  readonly packet_count: number
  readonly runtime_source_packets: number
  readonly projection_source_packets: number
  readonly packets: readonly {
    readonly id: string
    readonly path: string
    readonly valid: boolean
    readonly issue_codes: readonly string[]
    readonly html_contains_required_fields: boolean
  }[]
  readonly invalid_packet: {
    readonly id: string
    readonly path: string
    readonly valid: boolean
    readonly issue_codes: readonly string[]
    readonly html_contains_required_fields: boolean
  }
}

describe('runtime-log verifier UX', () => {
  it('renders static proof packets for runtime and projection sources', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'atrib-runtime-log-verifier-ux-test-'))
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/runtime-log-verifier-ux/runtime-log-verifier-ux-smoke.ts', outDir],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as RuntimeLogVerifierUxSmokeResult

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('runtime-log-verifier-ux-v0')
    expect(result.out_dir).toBe(outDir)
    expect(result.packet_count).toBe(8)
    expect(result.runtime_source_packets).toBeGreaterThanOrEqual(7)
    expect(result.projection_source_packets).toBeGreaterThanOrEqual(1)
    expect(result.packets.every((packet) => packet.valid)).toBe(true)
    expect(result.packets.every((packet) => packet.html_contains_required_fields)).toBe(true)

    const activeGraphPacket = result.packets.find(
      (packet) => packet.id === 'activegraph-approval-window',
    )
    expect(activeGraphPacket).toBeDefined()
    const activeGraphHtml = await readFile(activeGraphPacket!.path, 'utf8')
    expect(activeGraphHtml).toContain('Manifest hash')
    expect(activeGraphHtml).toContain('Source identity')
    expect(activeGraphHtml).toContain('Raw runtime bodies')
    expect(activeGraphHtml).toContain('not shown')

    const invalidHtml = await readFile(result.invalid_packet.path, 'utf8')
    expect(result.invalid_packet.valid).toBe(false)
    expect(result.invalid_packet.issue_codes).toContain('event_root_mismatch')
    expect(result.invalid_packet.html_contains_required_fields).toBe(true)
    expect(invalidHtml).toContain('Rejected')
    expect(invalidHtml).toContain('event_root_mismatch')
  }, 30000)
})
