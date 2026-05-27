import { describe, expect, it } from 'vitest'
import { verifyAp2ViEvidence } from '../src/ap2-vi-evidence.js'

import immediateFixture from '../../agent/test/fixtures/ap2/vi_immediate_evidence.json'
import splitAgentFixture from '../../agent/test/fixtures/ap2/vi_autonomous_split_agent_evidence.json'

describe('verifyAp2ViEvidence', () => {
  it('verifies signed VI immediate evidence with matching AP2 receipts', () => {
    const result = verifyAp2ViEvidence(immediateFixture)

    expect(result.valid).toBe(true)
    expect(result.transactionAccepted).toBe(true)
    expect(result.ap2.paymentReceipt?.referenceOk).toBe(true)
    expect(result.ap2.checkoutReceipt?.referenceOk).toBe(true)
    expect(result.vi.mode).toBe('immediate')
    expect(result.vi.checkoutPaymentBindingOk).toBe(true)
    expect(
      result.vi.credentials.every((credential) => credential.signature.status === 'verified'),
    ).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects autonomous VI evidence when checkout and payment mandates bind different agent keys', () => {
    const result = verifyAp2ViEvidence(splitAgentFixture)

    expect(result.valid).toBe(false)
    expect(result.vi.mode).toBe('autonomous')
    expect(result.vi.delegationOk).toBe(false)
    expect(result.errors).toContain('vi_l2_cnf_mismatch')
  })

  it('returns a failed result instead of throwing on malformed evidence', () => {
    const result = verifyAp2ViEvidence({
      vi: { credentials: [{ layer: 'L1', sdJwt: 'not-a-jwt' }] },
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('vi_jwt_malformed')
  })
})
