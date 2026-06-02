// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { runBriefDcbenchEvidenceSmoke } from '../src/brief-dcbench-evidence.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('Brief dcbench evidence proof', () => {
  it('signs a dcbench-shaped evidence path through the runnable smoke', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/brief-dcbench/brief-dcbench-evidence-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as Awaited<
      ReturnType<typeof runBriefDcbenchEvidenceSmoke>
    >

    expect(result.ok).toBe(true)
    expect(result.strategy).toBe('brief-dcbench-evidence-v1')
    expect(result.signed_records).toBe(3)
    expect(result.operations).toEqual([
      'brief.dcbench.context_lookup',
      'brief.dcbench.agent_action',
      'brief.dcbench.score',
    ])
    expect(result.record_hashes).toHaveLength(3)
    expect(result.score).toMatchObject({
      earned_score: 6,
      max_score: 6,
      compliance_percent: 100,
      decision_points_checked: 3,
      blocking_violations: 0,
    })
    expect(result.lineage).toEqual({
      action_informed_by_context_lookup: true,
      score_informed_by_action: true,
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_prompt_and_rubric: true,
    })
    expect(stdout).not.toContain('audit-log wrapper')
  })

  it('keeps the claim caveated when no Brief workspace is used', async () => {
    const result = await runBriefDcbenchEvidenceSmoke()

    expect(result.source.kind).toBe('fixture')
    expect(result.caveats.join(' ')).toContain('does not call Brief CLI or Brief MCP')
    expect(result.caveats.join(' ')).toContain('Outreach still needs operator approval')
  })
})
