// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

describe('OpenInference dual-export smoke', () => {
  it('exports the same span stream to OTLP and atrib', async () => {
    await execFileAsync('pnpm', ['--filter', '@atrib/openinference', 'build'], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })

    const { stdout } = await execFileAsync(
      join(process.cwd(), 'node_modules', '.bin', 'tsx'),
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
      informed_by_edges: number
      tool_informed_by_llm: boolean
      args_hashes_present: boolean
      result_hashes_present: boolean
    }

    expect(result.status).toBe('ok')
    expect(result.collector_kind).toBe('local-otlp-http')
    expect(result.collector_requests).toBeGreaterThan(0)
    expect(result.collector_bytes).toBeGreaterThan(0)
    expect(result.atrib_records).toBeGreaterThanOrEqual(2)
    expect(result.informed_by_edges).toBe(1)
    expect(result.tool_informed_by_llm).toBe(true)
    expect(result.args_hashes_present).toBe(true)
    expect(result.result_hashes_present).toBe(true)
  }, 30000)
})
