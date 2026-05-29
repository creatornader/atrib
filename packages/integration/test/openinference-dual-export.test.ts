// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
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

describe('OpenInference dual-export smoke', () => {
  it('exports the same span stream to OTLP and atrib', async () => {
    await execFileAsync('pnpm', ['--filter', '@atrib/openinference', 'build'], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })

    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/openinference/dual-export-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      status: string
      collector_kind: string
      collector_requests: number
      collector_bytes: number
      atrib_records: number
      run_id: string
      trace_ids: string[]
      span_ids: string[]
      span_names: string[]
      informed_by_edges: number
      tool_informed_by_llm: boolean
      args_hashes_present: boolean
      result_hashes_present: boolean
      backend_verification: null
    }

    expect(result.status).toBe('ok')
    expect(result.run_id).toMatch(/^atrib-dual-export-/)
    expect(result.collector_kind).toBe('local-otlp-http')
    expect(result.collector_requests).toBeGreaterThan(0)
    expect(result.collector_bytes).toBeGreaterThan(0)
    expect(result.atrib_records).toBeGreaterThanOrEqual(2)
    expect(result.trace_ids).toHaveLength(1)
    expect(result.span_ids).toHaveLength(2)
    expect(result.span_names).toEqual(['generate-text', 'search_docs'])
    expect(result.informed_by_edges).toBe(1)
    expect(result.tool_informed_by_llm).toBe(true)
    expect(result.args_hashes_present).toBe(true)
    expect(result.result_hashes_present).toBe(true)
    expect(result.backend_verification).toBeNull()
  }, 30000)
})
