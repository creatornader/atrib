import { describe, expect, it } from 'vitest'
import { detectTransaction } from '@atrib/agent'
import {
  computeContentId,
  genesisChainRoot,
  signTransactionAttestation,
  signTransactionRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { verifyAp2ViEvidenceAsync, verifyRecord } from '@atrib/verify'
import type { Ap2ViEvidenceBundle } from '@atrib/verify'

import viImmediateFixture from '../../agent/test/fixtures/ap2/vi_immediate_evidence.json'
import viAutonomousFixture from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'

const viImmediateEvidence = viImmediateFixture as Ap2ViEvidenceBundle
const viAutonomousEvidence = viAutonomousFixture as Ap2ViEvidenceBundle

describe('AP2 plus VI e2e', () => {
  it('detects an AP2 v0.2 receipt and verifies the VI evidence bundle off the detector path', async () => {
    const detection = detectTransaction('agent_payment', {
      'ap2.PaymentReceipt': viImmediateEvidence.ap2?.paymentReceipt,
    })
    const evidence = await verifyAp2ViEvidenceAsync(viImmediateEvidence, {
      nowSeconds: 1_779_840_000,
    })

    expect(detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(detection.contentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(detection.contentId).not.toBe(computeContentId('https://tools.example.com', 'checkout'))
    expect(evidence.valid).toBe(true)
    expect(evidence.transactionAccepted).toBe(true)
    expect(evidence.vi.checkoutPaymentBindingOk).toBe(true)
    expect(evidence.vi.constraints.status).toBe('not_applicable')
    expect(
      evidence.vi.credentials.every(
        (credential) => credential.sdJwtConformance.status === 'verified',
      ),
    ).toBe(true)
  })

  it('detects an autonomous AP2 receipt and verifies signed VI constraints off the detector path', async () => {
    const detection = detectTransaction('agent_payment', {
      'ap2.PaymentReceipt': viAutonomousEvidence.ap2?.paymentReceipt,
    })
    const evidence = await verifyAp2ViEvidenceAsync(viAutonomousEvidence, {
      nowSeconds: 1_779_840_000,
    })

    expect(detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(detection.contentId).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(detection.contentId).not.toBe(computeContentId('https://tools.example.com', 'checkout'))
    expect(evidence.valid).toBe(true)
    expect(evidence.vi.mode).toBe('autonomous')
    expect(evidence.vi.delegationOk).toBe(true)
    expect(evidence.vi.constraints.status).toBe('passed')
  })

  it('verifies AP2 Path 2 transaction bytes with a real counterparty signer', async () => {
    const detection = detectTransaction('agent_payment', {
      'ap2.PaymentReceipt': viAutonomousEvidence.ap2?.paymentReceipt,
    })
    if (!detection.contentId) throw new Error('AP2 fixture did not produce content_id')

    const agentKey = new Uint8Array(32).fill(0x61)
    const merchantKey = new Uint8Array(32).fill(0x62)
    const agentRecord = await signTransactionRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: detection.contentId,
        creator_key: '',
        chain_root: genesisChainRoot('cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'),
        event_type: 'https://atrib.dev/v1/types/transaction',
        context_id: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        timestamp: 1_779_840_000_000,
        signature: '',
        signers: [],
      } as AtribRecord,
      agentKey,
    )
    const merchantSigner = await signTransactionAttestation(agentRecord, merchantKey)
    const transactionRecord = {
      ...agentRecord,
      signers: [...agentRecord.signers!, merchantSigner],
    } as AtribRecord

    const result = await verifyRecord(transactionRecord, {
      ap2ViEvidence: viAutonomousEvidence,
      ap2ViEvidenceOptions: { nowSeconds: 1_779_840_000 },
    })

    expect(result.signatureOk).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.cross_attestation).toEqual({
      signers_count: 2,
      signers_valid: 2,
      missing: false,
    })
    expect(result.ap2_vi_evidence?.valid).toBe(true)
    expect(result.ap2_vi_evidence?.vi.mode).toBe('autonomous')
    expect(result.ap2_vi_evidence?.vi.constraints.status).toBe('passed')
  })
})
