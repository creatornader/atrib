// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { ActionControlGateSmokeResult } from '../examples/action-control-gate/action-control-gate-smoke.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('action-control gate proof', () => {
  it('proves allow, block, and escalate outcomes before browser-shaped actions run', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/action-control-gate/action-control-gate-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as ActionControlGateSmokeResult

    expect(result.ok).toBe(true)
    expect(result.contract.package).toBe('@atrib/action-gate')
    expect(result.contract.states).toEqual(['allowed', 'blocked', 'escalated'])
    expect(result.runs.map((run) => run.state)).toEqual([
      'allowed',
      'blocked',
      'escalated',
    ])
    expect(result.runs.map((run) => run.outcome_status)).toEqual([
      'executed',
      'blocked',
      'escalated',
    ])
    expect(result.runs.every((run) => /^sha256:[0-9a-f]{64}$/u.test(run.decision_record_hash))).toBe(
      true,
    )
    expect(result.runs.every((run) => /^sha256:[0-9a-f]{64}$/u.test(run.outcome_record_hash))).toBe(
      true,
    )
    expect(result.runs.every((run) => run.outcome_informed_by_decision)).toBe(true)
    expect(result.proof).toEqual({
      allowed_action_executed: true,
      blocked_action_body_executed: false,
      escalated_action_body_executed: false,
      all_verifications_valid: true,
      all_outcomes_cite_decisions: true,
    })
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
      raw_browser_payloads_omitted: true,
    })
  }, 30000)
})
