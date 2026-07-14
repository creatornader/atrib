import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { detectTransaction } from '@atrib/agent'
import {
  genesisChainRoot,
  signTransactionAttestation,
  signTransactionRecord,
  type AtribRecord,
} from '@atrib/mcp'
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

async function ap2TransactionRecord(
  evidence: Ap2ViEvidenceBundle,
  includeCounterparty = true,
): Promise<AtribRecord> {
  const detection = detectTransaction('ap2_live_interop', ap2ReferenceResult(evidence))
  if (!detection.contentId) throw new Error('test fixture did not produce AP2 content_id')

  const agentKey = new Uint8Array(32).fill(0x51)
  const counterpartyKey = new Uint8Array(32).fill(0x52)
  const agentRecord = await signTransactionRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: detection.contentId,
      creator_key: '',
      chain_root: genesisChainRoot('abababababababababababababababab'),
      event_type: 'https://atrib.dev/v1/types/transaction',
      context_id: 'abababababababababababababababab',
      timestamp: 1_779_840_000_000,
      signature: '',
      signers: [],
    } as AtribRecord,
    agentKey,
  )

  if (!includeCounterparty) return agentRecord

  const counterparty = await signTransactionAttestation(agentRecord, counterpartyKey)
  return { ...agentRecord, signers: [...agentRecord.signers!, counterparty] } as AtribRecord
}

describe('AP2 live interop harness', () => {
  it('accepts AP2 reference-style result artifacts plus verifier evidence', async () => {
    const transactionRecord = await ap2TransactionRecord(viAutonomousEvidence)
    const summary = await runAp2LiveInterop({
      result: ap2ReferenceResult(viAutonomousEvidence),
      evidence: viAutonomousEvidence,
      evidenceOptions: { nowSeconds },
      transactionRecord,
    })

    expect(summary.ok).toBe(true)
    expect(summary.errors).toEqual([])
    expect(summary.detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(summary.evidence?.valid).toBe(true)
    expect(summary.evidence?.transactionAccepted).toBe(true)
    expect(summary.recordVerification?.cross_attestation).toEqual({
      signers_count: 2,
      signers_valid: 2,
      missing: false,
      trust_evaluated: false,
    })
    expect(summary.recordVerification?.ap2_vi_evidence?.valid).toBe(true)
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

  it('rejects AP2 transaction records without counterparty attestation', async () => {
    const transactionRecord = await ap2TransactionRecord(viAutonomousEvidence, false)
    const summary = await runAp2LiveInterop({
      result: ap2ReferenceResult(viAutonomousEvidence),
      evidence: viAutonomousEvidence,
      evidenceOptions: { nowSeconds },
      transactionRecord,
    })

    expect(summary.ok).toBe(false)
    expect(summary.errors).toContain('atrib_counterparty_attestation_missing')
    expect(summary.recordVerification?.cross_attestation).toEqual({
      signers_count: 1,
      signers_valid: 1,
      missing: true,
      trust_evaluated: false,
    })
  })

  it('requires a transaction record when counterparty attestation is requested', async () => {
    const summary = await runAp2LiveInterop({
      result: ap2ReferenceResult(viAutonomousEvidence),
      evidence: viAutonomousEvidence,
      evidenceOptions: { nowSeconds },
      requireCounterpartyAttestation: true,
    })

    expect(summary.ok).toBe(false)
    expect(summary.errors).toContain('atrib_transaction_record_missing')
  })

  it('loads opt-in interop artifacts from environment variables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atrib-ap2-live-interop-'))
    try {
      const resultPath = join(dir, 'ap2-result.json')
      const evidencePath = join(dir, 'ap2-evidence.json')
      const transactionRecordPath = join(dir, 'ap2-transaction-record.json')
      const transactionRecord = await ap2TransactionRecord(viAutonomousEvidence)
      await writeFile(resultPath, JSON.stringify(ap2ReferenceResult(viAutonomousEvidence)))
      await writeFile(evidencePath, JSON.stringify(viAutonomousEvidence))
      await writeFile(transactionRecordPath, JSON.stringify(transactionRecord))

      const summary = await runAp2LiveInteropFromEnv({
        ATRIB_AP2_INTEROP_RESULT_JSON: resultPath,
        ATRIB_AP2_INTEROP_EVIDENCE_JSON: evidencePath,
        ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON: transactionRecordPath,
        ATRIB_AP2_INTEROP_REQUIRE_COUNTERPARTY_ATTESTATION: '1',
        ATRIB_AP2_INTEROP_NOW_SECONDS: String(nowSeconds),
      })

      expect(summary.ok).toBe(true)
      expect(summary.detection.detected).toBe(true)
      expect(summary.evidence?.valid).toBe(true)
      expect(summary.recordVerification?.cross_attestation?.missing).toBe(false)
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
