// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runEvidencePacketEval } from '../src/evidence-packet-eval.js'

describe('evidence packet eval example', () => {
  it('accepts the current packet and rejects the stale, wrong signer, tampered, and off arms', async () => {
    const result = await runEvidencePacketEval({ nowMs: Date.now() })

    expect(result.summary).toEqual({
      passed_arms: 5,
      total_arms: 5,
      packet_on_accepts: true,
      controls_reject: true,
    })

    const packetOn = result.arms.find((arm) => arm.arm === 'packet_on')
    expect(packetOn?.accepted_record_hashes).toHaveLength(1)
    expect(packetOn?.followup?.signature_ok).toBe(true)
    expect(packetOn?.followup?.informed_by_resolved).toEqual(packetOn?.accepted_record_hashes)
    expect(packetOn?.followup?.informed_by_dangling).toEqual([])

    expect(result.arms.find((arm) => arm.arm === 'stale_packet')?.rejected[0]?.reasons).toContain(
      'stale',
    )
    expect(result.arms.find((arm) => arm.arm === 'wrong_signer')?.rejected[0]?.reasons).toContain(
      'wrong_signer',
    )
    expect(result.arms.find((arm) => arm.arm === 'tampered_body')?.rejected[0]?.reasons).toContain(
      'body_hash_mismatch',
    )
    expect(result.arms.find((arm) => arm.arm === 'packet_off')?.rejected[0]?.reasons).toContain(
      'record_missing',
    )
  })
})
