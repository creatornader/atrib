import { describe, expect, it } from 'vitest'
import { detectTransaction } from '@atrib/agent'
import {
  genesisChainRoot,
  signTransactionAttestation,
  signTransactionRecord,
  type AtribRecord,
} from '@atrib/mcp'
import type { Ap2ViEvidenceBundle } from '@atrib/verify'
import { runAp2LiveInterop } from '../src/ap2-live-interop.js'

import ap2ReferenceEvidenceJson from './fixtures/ap2-reference/ap2-reference-evidence.json'
import ap2ReferenceMetadataJson from './fixtures/ap2-reference/ap2-reference-metadata.json'
import ap2ReferenceResultJson from './fixtures/ap2-reference/ap2-reference-result.json'

const ap2ReferenceEvidence = ap2ReferenceEvidenceJson as Ap2ViEvidenceBundle
const ap2ReferenceResult = ap2ReferenceResultJson as unknown
const ap2ReferenceMetadata = ap2ReferenceMetadataJson as {
  source_repository: string
  source_paths: string[]
}
const nowSeconds = 1_779_840_060

async function counterpartySignedTransactionRecord(): Promise<AtribRecord> {
  const detection = detectTransaction('ap2_reference_artifact', ap2ReferenceResult)
  if (!detection.contentId) throw new Error('AP2 reference fixture did not produce content_id')

  const agentKey = new Uint8Array(32).fill(0x61)
  const counterpartyKey = new Uint8Array(32).fill(0x62)
  const agentRecord = await signTransactionRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: detection.contentId,
      creator_key: '',
      chain_root: genesisChainRoot('cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'),
      event_type: 'https://atrib.dev/v1/types/transaction',
      context_id: 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      timestamp: nowSeconds * 1000,
      signature: '',
      signers: [],
    } as AtribRecord,
    agentKey,
  )

  const counterparty = await signTransactionAttestation(agentRecord, counterpartyKey)
  return { ...agentRecord, signers: [...agentRecord.signers!, counterparty] } as AtribRecord
}

describe('AP2 official SDK reference artifacts', () => {
  it('verifies AP2 SDK receipt JWT artifacts through the live interop harness', async () => {
    expect(ap2ReferenceMetadata.source_repository).toBe(
      'https://github.com/google-agentic-commerce/AP2',
    )
    expect(ap2ReferenceMetadata.source_paths).toContain(
      'code/sdk/python/ap2/sdk/receipt_wrapper.py',
    )
    expect(ap2ReferenceEvidence.ap2?.paymentReceipt).toBeUndefined()
    expect(ap2ReferenceEvidence.ap2?.checkoutReceipt).toBeUndefined()
    expect(ap2ReferenceEvidence.ap2?.paymentReceiptJwt).toEqual(expect.any(String))
    expect(ap2ReferenceEvidence.ap2?.checkoutReceiptJwt).toEqual(expect.any(String))

    const transactionRecord = await counterpartySignedTransactionRecord()
    const summary = await runAp2LiveInterop({
      result: ap2ReferenceResult,
      evidence: ap2ReferenceEvidence,
      evidenceOptions: { nowSeconds },
      transactionRecord,
    })

    expect(summary.ok).toBe(true)
    expect(summary.errors).toEqual([])
    expect(summary.detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(summary.evidence?.ap2.paymentReceipt?.jwt?.verified).toBe(true)
    expect(summary.evidence?.ap2.checkoutReceipt?.jwt?.verified).toBe(true)
    expect(summary.evidence?.ap2.paymentReceipt?.jwt?.jwksSource).toBe('static')
    expect(summary.evidence?.ap2.checkoutReceipt?.jwt?.jwksSource).toBe('static')
    expect(summary.evidence?.transactionAccepted).toBe(true)
    expect(summary.recordVerification?.cross_attestation).toEqual({
      signers_count: 2,
      signers_valid: 2,
      missing: false,
      trust_evaluated: false,
    })
    expect(summary.recordVerification?.ap2_vi_evidence?.valid).toBe(true)
  })
})
