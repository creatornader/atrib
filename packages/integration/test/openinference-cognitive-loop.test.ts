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

describe('OpenInference cognitive loop example', () => {
  it('writes a local mirror and proves recall, trace, and summarize consumption', async () => {
    await execFileAsync('pnpm', ['--filter', '@atrib/openinference', 'build'], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })

    const { stdout } = await execFileAsync(tsxBin, ['examples/openinference/cognitive-loop.ts'], {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    })
    const result = JSON.parse(stdout.trim()) as {
      status: string
      records: number
      recall_tokens_checked: string[]
      trace_visited: number
      summarize_prompt_bytes: number
    }

    expect(result.status).toBe('ok')
    expect(result.records).toBe(2)
    expect(result.recall_tokens_checked).toEqual(['langfuse', 'boundary', 'qwen3'])
    expect(result.trace_visited).toBe(2)
    expect(result.summarize_prompt_bytes).toBeGreaterThan(500)
  }, 30000)
})
