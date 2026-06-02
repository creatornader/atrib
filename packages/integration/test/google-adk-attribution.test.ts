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

describe('Google ADK plugin attribution example', () => {
  it('signs an ADK FunctionTool call through the BasePlugin lifecycle', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/google-adk/google-adk-plugin-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as {
      ok: boolean
      adk: { package: string; runner: string; plugin: string; tool: string }
      signed_records: number
      operations: string[]
      record_hashes: string[]
      final_text: string
      event_counts: {
        function_call_events: number
        function_response_events: number
      }
      privacy: {
        public_records_hash_only: boolean
        local_sidecars_keep_payloads: boolean
      }
    }

    expect(result.ok).toBe(true)
    expect(result.adk).toMatchObject({
      package: '@google/adk',
      runner: 'InMemoryRunner',
      plugin: 'BasePlugin',
      tool: 'FunctionTool',
    })
    expect(result.signed_records).toBe(1)
    expect(result.operations).toEqual(['google.adk.tool.quote_price'])
    expect(result.record_hashes).toHaveLength(1)
    expect(result.final_text).toContain('Quote ready')
    expect(result.event_counts.function_call_events).toBe(1)
    expect(result.event_counts.function_response_events).toBe(1)
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    })
  })
})
