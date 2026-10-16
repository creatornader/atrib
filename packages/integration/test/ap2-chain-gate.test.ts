// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { createGoogleActiveRuntimeRun } from '../examples/google-stack-chain/runtime/active-runtime.js'
import {
  DEFAULT_GOOGLE_REPLAY_FILES,
  buildGoogleEvidenceGate,
  buildReplayPacket,
  type GoogleEvidencePacket,
} from '../src/google-evidence-runtime.js'
import { runAp2LiveInterop } from '../src/ap2-live-interop.js'

const fixtures = join(process.cwd(), 'test/fixtures')
let packet: GoogleEvidencePacket

beforeAll(async () => {
  packet = await buildReplayPacket(DEFAULT_GOOGLE_REPLAY_FILES)
})

describe('Google chain AP2 gate', () => {
  it('accepts the local positive fixture with receipt JWTs and all four VI layers verified', async () => {
    const summary = await runAp2LiveInterop({
      result: packet.result,
      evidence: packet.evidence,
      transactionRecord: packet.transactionRecord,
      evidenceOptions: { nowSeconds: packet.nowSeconds },
      requireCounterpartyAttestation: true,
    })
    expect(summary.ok).toBe(true)
    expect(summary.evidence?.ap2.paymentReceipt?.jwt?.verified).toBe(true)
    expect(summary.evidence?.ap2.checkoutReceipt?.jwt?.verified).toBe(true)
    expect(summary.evidence?.vi.credentials).toHaveLength(4)
    expect(
      summary.evidence?.vi.credentials.every(
        (credential) => credential.sdJwtConformance.status === 'verified',
      ),
    ).toBe(true)
    expect((await buildGoogleEvidenceGate(packet)).allowed).toBe(true)
  })

  it.each(['receipt-signature', 'disclosure', 'counterparty', 'mandate-only'])(
    'blocks %s before A2A or ADK execution',
    async (mutation) => {
      const invalid = structuredClone(packet)
      if (mutation === 'receipt-signature') {
        const parts = invalid.evidence.ap2!.paymentReceiptJwt!.split('.')
        parts[2] = Buffer.alloc(64).toString('base64url')
        invalid.evidence.ap2!.paymentReceiptJwt = parts.join('.')
      } else if (mutation === 'disclosure') {
        const credential = invalid.evidence.vi!.credentials!.find((entry) => entry.layer === 'L2')!
        const parts = credential.sdJwt.split('~')
        parts.splice(1, 0, parts[1]!)
        credential.sdJwt = parts.join('~')
      } else if (mutation === 'counterparty') {
        invalid.transactionRecord.signers![1]!.signature = Buffer.alloc(64).toString('base64url')
      } else {
        invalid.result = { status: 'success', payment_mandate: { transaction_id: 'mandate-only' } }
      }
      const run = await createGoogleActiveRuntimeRun({
        runId: `blocked-${mutation}`,
        packet: invalid,
      })
      expect(run.status).toBe('blocked')
      expect(run.gate.allowed).toBe(false)
      expect(run.steps.map((step) => step.key)).toEqual(['ap2_gate'])
      expect(run.a2a).toBeUndefined()
      expect(run.adk_python).toBeUndefined()
    },
  )

  it('keeps the preserved upstream duplicate-digest capture rejected before handoff', async () => {
    const upstream = await buildReplayPacket({
      resultJson: join(fixtures, 'ap2-vi-reference/ap2-vi-reference-result.json'),
      evidenceJson: join(fixtures, 'ap2-vi-reference/ap2-vi-reference-evidence.json'),
    })
    const run = await createGoogleActiveRuntimeRun({ runId: 'blocked-upstream', packet: upstream })
    expect(run.status).toBe('blocked')
    expect(run.gate.verifier_errors).toContain('ap2_vi_evidence_invalid')
    expect(run.a2a).toBeUndefined()
    expect(run.adk_python).toBeUndefined()
  })
})
