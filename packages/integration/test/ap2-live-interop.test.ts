import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  envToAp2LiveInteropConfig,
  runAp2LiveInterop,
  runAp2LiveInteropFromEnv,
} from '../src/ap2-live-interop.js'
import type { Ap2ViEvidenceBundle } from '@atrib/verify'

import viAutonomousFixture from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'

const viAutonomousEvidence = viAutonomousFixture as Ap2ViEvidenceBundle
const nowSeconds = 1_779_840_000

function ap2ReferenceResult(evidence: Ap2ViEvidenceBundle): unknown {
  const checkoutReceipt = evidence.ap2?.checkoutReceipt as { order_id?: unknown } | undefined

  return {
    status: 'success',
    order_id: checkoutReceipt?.order_id,
    checkout_receipt: evidence.ap2?.checkoutReceipt,
    payment_receipt: evidence.ap2?.paymentReceipt,
  }
}

describe('AP2 live interop harness', () => {
  it('accepts AP2 reference-style result artifacts plus verifier evidence', async () => {
    const summary = await runAp2LiveInterop({
      result: ap2ReferenceResult(viAutonomousEvidence),
      evidence: viAutonomousEvidence,
      evidenceOptions: { nowSeconds },
    })

    expect(summary.ok).toBe(true)
    expect(summary.errors).toEqual([])
    expect(summary.detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(summary.evidence?.valid).toBe(true)
    expect(summary.evidence?.transactionAccepted).toBe(true)
  })

  it('keeps AP2 mandates from passing the interop transaction gate', async () => {
    const summary = await runAp2LiveInterop({
      result: {
        'ap2.mandates.PaymentMandate': {
          transaction_id: 'tx_not_a_receipt',
        },
      },
      evidence: viAutonomousEvidence,
      evidenceOptions: { nowSeconds },
    })

    expect(summary.ok).toBe(false)
    expect(summary.errors).toContain('ap2_transaction_not_detected')
    expect(summary.evidence?.valid).toBe(true)
  })

  it('loads opt-in interop artifacts from environment variables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atrib-ap2-live-interop-'))
    try {
      const resultPath = join(dir, 'ap2-result.json')
      const evidencePath = join(dir, 'ap2-evidence.json')
      await writeFile(resultPath, JSON.stringify(ap2ReferenceResult(viAutonomousEvidence)))
      await writeFile(evidencePath, JSON.stringify(viAutonomousEvidence))

      const summary = await runAp2LiveInteropFromEnv({
        ATRIB_AP2_INTEROP_RESULT_JSON: resultPath,
        ATRIB_AP2_INTEROP_EVIDENCE_JSON: evidencePath,
        ATRIB_AP2_INTEROP_NOW_SECONDS: String(nowSeconds),
      })

      expect(summary.ok).toBe(true)
      expect(summary.detection.detected).toBe(true)
      expect(summary.evidence?.valid).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects invalid clock configuration early', () => {
    expect(() =>
      envToAp2LiveInteropConfig({
        ATRIB_AP2_INTEROP_NOW_SECONDS: 'not-a-number',
      }),
    ).toThrow('ATRIB_AP2_INTEROP_NOW_SECONDS')
  })
})
