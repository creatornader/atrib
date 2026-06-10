import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME_CONTEXT_ID,
  buildGoogleEvidenceGate,
  buildReplayPacket,
  merchantAdapterContract,
} from '../src/google-evidence-runtime.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/ap2-vi-reference')

describe('Google evidence runtime', () => {
  it('allows the next action from replayed AP2 evidence', async () => {
    const packet = await buildReplayPacket({
      resultJson: join(fixtureDir, 'ap2-vi-reference-result.json'),
      evidenceJson: join(fixtureDir, 'ap2-vi-reference-evidence.json'),
    })

    const gate = await buildGoogleEvidenceGate(packet)

    expect(gate.allowed).toBe(true)
    expect(gate.decision).toBe('allow_next_action')
    expect(gate.packet_source).toBe('committed AP2 / VI replay fixture')
    expect(gate.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(gate.next_action_context.informed_by).toEqual([gate.record_hash])
    expect(gate.analytics_row).toMatchObject({
      event_type: 'atrib.ap2.next_action_allowed',
      agent: 'atrib-google-evidence-runtime',
      session_id: DEFAULT_RUNTIME_CONTEXT_ID,
      status: 'OK',
      atrib_record_hash: gate.record_hash,
      protocol: 'AP2',
    })
    expect(gate.checks.every((check) => check.ok)).toBe(true)
  })

  it('documents the bring-your-AP2-merchant packet shape', () => {
    expect(merchantAdapterContract()).toMatchObject({
      endpoint: 'POST /v1/verify-ap2',
      accepted_body: {
        result: expect.any(String),
        evidence: expect.any(String),
        transactionRecord: expect.any(String),
      },
    })
  })
})
