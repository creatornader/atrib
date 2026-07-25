import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateAp2LocalParticipantArtifacts,
  normalizeAp2ViEvidence,
  normalizeClosedMandateReferenceMaterial,
} from '../src/ap2-local-participant.js'
import { runAp2LiveInteropFromEnv } from '../src/ap2-live-interop.js'

import ap2EvidenceJson from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'
import ap2ResultJson from '../../agent/test/fixtures/ap2/payment_receipt_result.json'

const nowSeconds = 1_779_840_000

describe('AP2 local participant artifacts', () => {
  it('extracts closed mandate JWT reference material from delegated AP2 chains', () => {
    expect(
      normalizeClosedMandateReferenceMaterial(
        'open.header.signature~open-disclosure~~closed.header.signature~closed-disclosure~',
      ),
    ).toBe('closed.header.signature')

    expect(
      normalizeClosedMandateReferenceMaterial('closed.header.signature~closed-disclosure~'),
    ).toBe('closed.header.signature')

    expect(normalizeClosedMandateReferenceMaterial('opaque-closed-mandate')).toBe(
      'opaque-closed-mandate',
    )

    expect(() =>
      normalizeClosedMandateReferenceMaterial('open.header.signature~open-disclosure~~not-a-jwt~'),
    ).toThrow('expected compact closed mandate JWT in AP2 mandate chain')
  })

  it('normalizes full AP2 mandate chains before writing verifier evidence', () => {
    const evidence = normalizeAp2ViEvidence({
      ap2: {
        checkoutReceiptJwt: 'receipt.header.signature',
        closedCheckoutMandate:
          'open.header.signature~open-disclosure~~closed.checkout.signature~closed-disclosure~',
        closedPaymentMandate:
          'open.header.signature~open-disclosure~~closed.payment.signature~closed-disclosure~',
      },
    })

    expect(evidence.ap2?.closedCheckoutMandate).toBe('closed.checkout.signature')
    expect(evidence.ap2?.closedPaymentMandate).toBe('closed.payment.signature')
  })

  it('emits a counterparty-signed atrib transaction record for AP2 evidence', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'atrib-ap2-local-participant-'))
    try {
      const generated = await generateAp2LocalParticipantArtifacts({
        result: ap2ResultJson,
        evidence: ap2EvidenceJson,
        outDir,
        nowSeconds,
      })

      expect(generated.transactionRecord.signers).toHaveLength(2)
      expect(generated.files.result).toBe(join(outDir, 'ap2-result.json'))
      expect(generated.files.evidence).toBe(join(outDir, 'ap2-vi-evidence.json'))
      expect(generated.files.transactionRecord).toBe(join(outDir, 'atrib-transaction-record.json'))

      const summary = await runAp2LiveInteropFromEnv({
        ATRIB_AP2_INTEROP_RESULT_JSON: generated.files.result,
        ATRIB_AP2_INTEROP_EVIDENCE_JSON: generated.files.evidence,
        ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON: generated.files.transactionRecord,
        ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION: '1',
        ATRIB_AP2_INTEROP_NOW_SECONDS: String(nowSeconds),
      })

      expect(summary.ok).toBe(true)
      expect(summary.errors).toEqual([])
      expect(summary.evidence?.valid).toBe(true)
      expect(summary.recordVerification?.cross_attestation).toEqual({
        signers_count: 2,
        signers_valid: 2,
        missing: false,
        trust_evaluated: false,
      })
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
