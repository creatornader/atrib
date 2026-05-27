import { describe, expect, it } from 'vitest'
import { detectTransaction } from '@atrib/agent'
import { verifyAp2ViEvidence } from '@atrib/verify'
import type { Ap2ViEvidenceBundle } from '@atrib/verify'

import viImmediateFixture from '../../agent/test/fixtures/ap2/vi_immediate_evidence.json'

const viImmediateEvidence = viImmediateFixture as Ap2ViEvidenceBundle

describe('AP2 plus VI e2e', () => {
  it('detects an AP2 v0.2 receipt and verifies the VI evidence bundle off the detector path', () => {
    const detection = detectTransaction('agent_payment', {
      'ap2.PaymentReceipt': viImmediateEvidence.ap2?.paymentReceipt,
    })
    const evidence = verifyAp2ViEvidence(viImmediateEvidence)

    expect(detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(evidence.valid).toBe(true)
    expect(evidence.transactionAccepted).toBe(true)
    expect(evidence.vi.checkoutPaymentBindingOk).toBe(true)
  })
})
