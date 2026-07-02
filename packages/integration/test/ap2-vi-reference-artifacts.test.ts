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

import ap2ViReferenceEvidenceJson from './fixtures/ap2-vi-reference/ap2-vi-reference-evidence.json'
import ap2ViReferenceMetadataJson from './fixtures/ap2-vi-reference/ap2-vi-reference-metadata.json'
import ap2ViReferenceResultJson from './fixtures/ap2-vi-reference/ap2-vi-reference-result.json'

interface SplitSdJwt {
  jwt: string[]
  disclosures: string[]
  trailingTilde?: boolean
}

interface SplitEvidenceCredential {
  layer: 'L1' | 'L2' | 'L3_PAYMENT' | 'L3_CHECKOUT'
  sdJwtParts: SplitSdJwt
  parentPresentationParts?: SplitSdJwt
}

interface SplitEvidenceFixture {
  ap2: {
    paymentReceiptJwtParts: string[]
    checkoutReceiptJwtParts: string[]
    closedPaymentMandate: string
    closedCheckoutMandate: string
  }
  vi: { credentials: SplitEvidenceCredential[] }
  trustedIssuerKeys: JsonWebKey[]
  receiptJwtIssuers: Array<{
    issuer: string
    jwks: { keys: JsonWebKey[] }
  }>
}

interface SplitResultFixture {
  status: string
  source: string
  payment_receipt_jwt_parts: string[]
  checkout_receipt_jwt_parts: string[]
}

function joinCompactJwt(parts: string[]): string {
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error('expected compact JWT parts')
  }
  return parts.join('.')
}

function joinSdJwt(parts: SplitSdJwt): string {
  const body = [joinCompactJwt(parts.jwt), ...parts.disclosures].join('~')
  return parts.trailingTilde === false ? body : `${body}~`
}

function rehydrateEvidence(fixture: SplitEvidenceFixture): Ap2ViEvidenceBundle {
  return {
    ap2: {
      paymentReceiptJwt: joinCompactJwt(fixture.ap2.paymentReceiptJwtParts),
      checkoutReceiptJwt: joinCompactJwt(fixture.ap2.checkoutReceiptJwtParts),
      closedPaymentMandate: fixture.ap2.closedPaymentMandate,
      closedCheckoutMandate: fixture.ap2.closedCheckoutMandate,
    },
    vi: {
      credentials: fixture.vi.credentials.map((credential) => {
        const input = {
          layer: credential.layer,
          sdJwt: joinSdJwt(credential.sdJwtParts),
        }
        return credential.parentPresentationParts
          ? { ...input, parentPresentation: joinSdJwt(credential.parentPresentationParts) }
          : input
      }),
    },
    trustedIssuerKeys: fixture.trustedIssuerKeys,
    receiptJwtIssuers: fixture.receiptJwtIssuers,
  }
}

function rehydrateResult(fixture: SplitResultFixture): unknown {
  return {
    status: fixture.status,
    source: fixture.source,
    payment_receipt: joinCompactJwt(fixture.payment_receipt_jwt_parts),
    checkout_receipt: joinCompactJwt(fixture.checkout_receipt_jwt_parts),
  }
}

const splitEvidence = ap2ViReferenceEvidenceJson as SplitEvidenceFixture
const splitResult = ap2ViReferenceResultJson as SplitResultFixture
const ap2ViReferenceEvidence = rehydrateEvidence(splitEvidence)
const ap2ViReferenceResult = rehydrateResult(splitResult)
const ap2ViReferenceMetadata = ap2ViReferenceMetadataJson as {
  source_repositories: string[]
  source_paths: string[]
  now_seconds: number
}

async function counterpartySignedTransactionRecord(): Promise<AtribRecord> {
  const detection = detectTransaction('ap2_vi_reference_artifact', ap2ViReferenceResult)
  if (!detection.contentId) throw new Error('AP2 / VI reference fixture did not produce content_id')

  const agentKey = new Uint8Array(32).fill(0x61)
  const counterpartyKey = new Uint8Array(32).fill(0x62)
  const agentRecord = await signTransactionRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: detection.contentId,
      creator_key: '',
      chain_root: genesisChainRoot('edededededededededededededededed'),
      event_type: 'https://atrib.dev/v1/types/transaction',
      context_id: 'edededededededededededededededed',
      timestamp: ap2ViReferenceMetadata.now_seconds * 1000,
      signature: '',
      signers: [],
    } as AtribRecord,
    agentKey,
  )

  const counterparty = await signTransactionAttestation(agentRecord, counterpartyKey)
  return { ...agentRecord, signers: [...agentRecord.signers!, counterparty] } as AtribRecord
}

describe('AP2 plus Verifiable Intent upstream reference artifacts', () => {
  it('verifies AP2 SDK receipts and VI reference credentials through the live interop harness', async () => {
    expect(ap2ViReferenceMetadata.source_repositories).toEqual(
      expect.arrayContaining([
        'https://github.com/google-agentic-commerce/AP2',
        'https://github.com/agent-intent/verifiable-intent',
      ]),
    )
    expect(ap2ViReferenceMetadata.source_paths).toEqual(
      expect.arrayContaining([
        'AP2/code/sdk/python/ap2/sdk/receipt_wrapper.py',
        'verifiable-intent/examples/autonomous_flow.py',
        'verifiable-intent/src/verifiable_intent/issuance/user.py',
      ]),
    )
    expect(ap2ViReferenceEvidence.ap2?.paymentReceipt).toBeUndefined()
    expect(ap2ViReferenceEvidence.ap2?.checkoutReceipt).toBeUndefined()
    expect(splitEvidence.ap2.paymentReceiptJwtParts).toHaveLength(3)
    expect(splitEvidence.ap2.checkoutReceiptJwtParts).toHaveLength(3)
    expect(ap2ViReferenceEvidence.ap2?.paymentReceiptJwt).toEqual(expect.any(String))
    expect(ap2ViReferenceEvidence.ap2?.checkoutReceiptJwt).toEqual(expect.any(String))
    expect(ap2ViReferenceEvidence.vi?.credentials).toHaveLength(4)

    const transactionRecord = await counterpartySignedTransactionRecord()
    const summary = await runAp2LiveInterop({
      result: ap2ViReferenceResult,
      evidence: ap2ViReferenceEvidence,
      evidenceOptions: {
        nowSeconds: ap2ViReferenceMetadata.now_seconds,
        sdJwtConformanceProfile: 'sd-jwt',
      },
      transactionRecord,
    })

    expect(summary.ok).toBe(true)
    expect(summary.errors).toEqual([])
    expect(summary.detection).toMatchObject({ detected: true, protocol: 'AP2' })
    expect(summary.evidence?.ap2.paymentReceipt?.jwt?.verified).toBe(true)
    expect(summary.evidence?.ap2.checkoutReceipt?.jwt?.verified).toBe(true)
    expect(summary.evidence?.vi.mode).toBe('autonomous')
    expect(summary.evidence?.vi.delegationOk).toBe(true)
    expect(summary.evidence?.vi.checkoutPaymentBindingOk).toBe(true)
    expect(summary.evidence?.vi.constraints.status).toBe('passed')
    expect(summary.evidence?.vi.constraints.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'mandate.payment.reference', status: 'passed' }),
        expect.objectContaining({ type: 'mandate.checkout.line_items', status: 'passed' }),
      ]),
    )
    expect(
      summary.evidence?.vi.credentials.every(
        (credential) => credential.sdJwtConformance.status === 'verified',
      ),
    ).toBe(true)
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
