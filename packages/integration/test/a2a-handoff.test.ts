// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runA2aHandoffProof } from '../src/a2a-handoff.js'

describe('A2A handoff proof', () => {
  it('verifies an A2A DataPart packet before signing a receiving-agent follow-up', async () => {
    const result = await runA2aHandoffProof(1_779_840_000_000)

    expect(result.sdk).toEqual({
      package: '@a2a-js/sdk',
      protocol_version: '0.3.0',
      transport: 'JSONRPC',
    })
    expect(result.agent_card.signatures_count).toBe(1)
    expect(result.agent_card.signature_alg).toBe('EdDSA')
    expect(result.agent_card.signature_kid).toBe('atrib-a2a-evidence-agent-ed25519')
    expect(result.agent_card.signature_valid).toBe(true)
    expect(result.agent_card.signed_payload_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.a2a.response_kind).toBe('message')
    expect(result.a2a.response_part_kinds).toEqual(['text', 'data'])
    expect(result.evidence.accepted_record_hashes).toEqual([result.evidence.remote_record_hash])
    expect(result.evidence.rejected_count).toBe(0)
    expect(result.followup.signature_ok).toBe(true)
    expect(result.followup.informed_by_resolved).toEqual([result.evidence.remote_record_hash])
    expect(result.followup.informed_by_dangling).toEqual([])
    expect(result.privacy.public_record_contains_private_phrase).toBe(false)
  })
})
