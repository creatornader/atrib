// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runTraceRepairSuspect } from '../src/trace-repair-suspect.js'

describe('trace repair suspect example', () => {
  it('verifies a trace packet, rejects stale evidence, and signs a diagnostic outcome', async () => {
    const result = await runTraceRepairSuspect({ nowMs: Date.now() })

    expect(result.summary).toEqual({
      current_trace_accepts: true,
      stale_packet_rejects: true,
      top_suspect_is_failed_tool_action: true,
      diagnostic_signature_ok: true,
      diagnostic_links_failure_and_suspect: true,
    })

    expect(result.accepted_record_hashes).toHaveLength(3)
    expect(result.rejected_stale_packet[0]?.reasons).toContain('stale')

    const [topSuspect, secondSuspect] = result.ranked_suspects
    expect(topSuspect).toMatchObject({
      rank: 1,
      label: 'read-stale-route-draft',
      role: 'tool_action',
    })
    expect(topSuspect?.reason_codes).toEqual([
      'direct-parent-of-failure',
      'tool-action-boundary',
      'failed-step',
      'explicit-error',
      'repair-hint-present',
    ])
    expect(secondSuspect).toMatchObject({
      rank: 2,
      label: 'plan-route',
      role: 'plan',
    })

    expect(result.diagnostic_outcome.informed_by_dangling).toEqual([])
    expect(result.diagnostic_outcome.informed_by_resolved).toContain(
      result.ranked_suspects[0]?.record_hash,
    )
    expect(result.diagnostic_outcome.informed_by_resolved).toHaveLength(2)
  })
})
