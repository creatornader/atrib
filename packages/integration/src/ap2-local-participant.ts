import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectTransaction } from '@atrib/agent'
import {
  genesisChainRoot,
  signTransactionAttestation,
  signTransactionRecord,
  type AtribRecord,
} from '@atrib/mcp'
import type { Ap2EvidenceInput, Ap2ViEvidenceBundle, ViCredentialInput } from '@atrib/verify'

interface SplitSdJwt {
  jwt: string[]
  disclosures: string[]
  trailingTilde?: boolean
}

interface SplitEvidenceCredential {
  layer: 'L1' | 'L2' | 'L3_PAYMENT' | 'L3_CHECKOUT'
  sdJwtParts?: SplitSdJwt
  sdJwt?: string
  parentPresentationParts?: SplitSdJwt
  parentPresentation?: string
}

interface SplitEvidenceFixture {
  ap2?: {
    paymentReceiptJwtParts?: string[]
    checkoutReceiptJwtParts?: string[]
    paymentReceiptJwt?: string
    checkoutReceiptJwt?: string
    paymentReceipt?: unknown
    checkoutReceipt?: unknown
    closedPaymentMandate?: string
    closedCheckoutMandate?: string
    closedPaymentMandateHash?: string
    closedCheckoutMandateHash?: string
  }
  vi?: { credentials?: SplitEvidenceCredential[] }
  trustedIssuerKeys?: JsonWebKey[]
  receiptJwtIssuers?: Ap2ViEvidenceBundle['receiptJwtIssuers']
}

interface SplitResultFixture {
  status?: string
  source?: string
  payment_receipt_jwt_parts?: string[]
  checkout_receipt_jwt_parts?: string[]
  payment_receipt?: unknown
  checkout_receipt?: unknown
  [key: string]: unknown
}

export interface Ap2LocalParticipantOptions {
  result: unknown
  evidence: unknown
  outDir: string
  nowSeconds: number
  contextId?: string
  agentSeed?: Uint8Array
  counterpartySeed?: Uint8Array
}

export interface Ap2LocalParticipantArtifacts {
  result: unknown
  evidence: Ap2ViEvidenceBundle
  transactionRecord: AtribRecord
  files: {
    result: string
    evidence: string
    transactionRecord: string
    metadata: string
  }
}

const DEFAULT_CONTEXT_ID = 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1'
const DEFAULT_AGENT_SEED = new Uint8Array(32).fill(0xa1)
const DEFAULT_COUNTERPARTY_SEED = new Uint8Array(32).fill(0xc1)

export function joinCompactJwt(parts: string[]): string {
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error('expected compact JWT parts')
  }
  return parts.join('.')
}

export function joinSdJwt(parts: SplitSdJwt): string {
  const body = [joinCompactJwt(parts.jwt), ...parts.disclosures].join('~')
  return parts.trailingTilde === false ? body : `${body}~`
}

export function normalizeClosedMandateReferenceMaterial(serialized: string): string {
  const trimmed = serialized.trim()
  if (!trimmed) throw new Error('expected closed AP2 mandate')

  const chainSegments = trimmed
    .split('~~')
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (chainSegments.length > 1) {
    return extractCompactJwtFromSdJwt(
      chainSegments[chainSegments.length - 1]!,
      'expected compact closed mandate JWT in AP2 mandate chain',
    )
  }

  if (trimmed.includes('~')) {
    return extractCompactJwtFromSdJwt(trimmed, 'expected compact closed mandate JWT in AP2 SD-JWT')
  }

  return trimmed
}

export function normalizeAp2Result(input: unknown): unknown {
  if (!isRecord(input)) return input
  const fixture = input as SplitResultFixture
  return {
    ...fixture,
    ...(fixture.payment_receipt_jwt_parts
      ? { payment_receipt: joinCompactJwt(fixture.payment_receipt_jwt_parts) }
      : {}),
    ...(fixture.checkout_receipt_jwt_parts
      ? { checkout_receipt: joinCompactJwt(fixture.checkout_receipt_jwt_parts) }
      : {}),
  }
}

export function normalizeAp2ViEvidence(input: unknown): Ap2ViEvidenceBundle {
  if (!isRecord(input)) throw new Error('expected AP2 / VI evidence object')
  const fixture = input as SplitEvidenceFixture
  const bundle: Ap2ViEvidenceBundle = {
    ap2: {
      ...(fixture.ap2?.paymentReceipt !== undefined
        ? { paymentReceipt: fixture.ap2.paymentReceipt as Ap2EvidenceInput['paymentReceipt'] }
        : {}),
      ...(fixture.ap2?.checkoutReceipt !== undefined
        ? { checkoutReceipt: fixture.ap2.checkoutReceipt as Ap2EvidenceInput['checkoutReceipt'] }
        : {}),
      ...(fixture.ap2?.paymentReceiptJwtParts
        ? { paymentReceiptJwt: joinCompactJwt(fixture.ap2.paymentReceiptJwtParts) }
        : fixture.ap2?.paymentReceiptJwt
          ? { paymentReceiptJwt: fixture.ap2.paymentReceiptJwt }
          : {}),
      ...(fixture.ap2?.checkoutReceiptJwtParts
        ? { checkoutReceiptJwt: joinCompactJwt(fixture.ap2.checkoutReceiptJwtParts) }
        : fixture.ap2?.checkoutReceiptJwt
          ? { checkoutReceiptJwt: fixture.ap2.checkoutReceiptJwt }
          : {}),
      ...(fixture.ap2?.closedPaymentMandate
        ? {
            closedPaymentMandate: normalizeClosedMandateReferenceMaterial(
              fixture.ap2.closedPaymentMandate,
            ),
          }
        : {}),
      ...(fixture.ap2?.closedCheckoutMandate
        ? {
            closedCheckoutMandate: normalizeClosedMandateReferenceMaterial(
              fixture.ap2.closedCheckoutMandate,
            ),
          }
        : {}),
      ...(fixture.ap2?.closedPaymentMandateHash
        ? { closedPaymentMandateHash: fixture.ap2.closedPaymentMandateHash }
        : {}),
      ...(fixture.ap2?.closedCheckoutMandateHash
        ? { closedCheckoutMandateHash: fixture.ap2.closedCheckoutMandateHash }
        : {}),
    },
  }
  if (fixture.vi?.credentials) {
    bundle.vi = { credentials: fixture.vi.credentials.map(normalizeViCredential) }
  }
  if (fixture.trustedIssuerKeys) {
    bundle.trustedIssuerKeys = fixture.trustedIssuerKeys
  }
  if (fixture.receiptJwtIssuers) {
    bundle.receiptJwtIssuers = fixture.receiptJwtIssuers
  }
  return bundle
}

export async function generateAp2LocalParticipantArtifacts(
  options: Ap2LocalParticipantOptions,
): Promise<Ap2LocalParticipantArtifacts> {
  const result = normalizeAp2Result(options.result)
  const evidence = normalizeAp2ViEvidence(options.evidence)
  const detection = detectTransaction('ap2_local_participant', result)
  if (!detection.detected || detection.protocol !== 'AP2' || !detection.contentId) {
    throw new Error('ap2_transaction_not_detected')
  }

  const contextId = options.contextId ?? DEFAULT_CONTEXT_ID
  const agentRecord = await signTransactionRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: detection.contentId,
      creator_key: '',
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/transaction',
      context_id: contextId,
      timestamp: options.nowSeconds * 1000,
      signature: '',
      signers: [],
    } as AtribRecord,
    options.agentSeed ?? DEFAULT_AGENT_SEED,
  )

  const counterparty = await signTransactionAttestation(
    agentRecord,
    options.counterpartySeed ?? DEFAULT_COUNTERPARTY_SEED,
  )
  const transactionRecord = {
    ...agentRecord,
    signers: [...(agentRecord.signers ?? []), counterparty],
  } as AtribRecord

  await mkdir(options.outDir, { recursive: true })
  const files = {
    result: join(options.outDir, 'ap2-result.json'),
    evidence: join(options.outDir, 'ap2-vi-evidence.json'),
    transactionRecord: join(options.outDir, 'atrib-transaction-record.json'),
    metadata: join(options.outDir, 'metadata.json'),
  }
  await writeJson(files.result, result)
  await writeJson(files.evidence, evidence)
  await writeJson(files.transactionRecord, transactionRecord)
  await writeJson(files.metadata, {
    source: 'atrib AP2 local participant',
    now_seconds: options.nowSeconds,
    content_id: detection.contentId,
    counterparty_attestation: 'signed_over_atrib_transaction_bytes',
  })

  return { result, evidence, transactionRecord, files }
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeViCredential(credential: SplitEvidenceCredential): ViCredentialInput {
  const sdJwt = credential.sdJwtParts ? joinSdJwt(credential.sdJwtParts) : credential.sdJwt
  if (!sdJwt) throw new Error('expected VI credential sdJwt')

  const normalized: ViCredentialInput = { layer: credential.layer, sdJwt }
  if (credential.parentPresentationParts) {
    normalized.parentPresentation = joinSdJwt(credential.parentPresentationParts)
  } else if (credential.parentPresentation) {
    normalized.parentPresentation = credential.parentPresentation
  }
  return normalized
}

function extractCompactJwtFromSdJwt(serialized: string, errorMessage: string): string {
  const compactJwt = serialized.split('~')[0]?.trim()
  if (!compactJwt || !isCompactJwt(compactJwt)) {
    throw new Error(errorMessage)
  }
  return compactJwt
}

function isCompactJwt(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 0)
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
