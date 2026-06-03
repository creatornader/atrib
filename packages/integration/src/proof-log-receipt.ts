// SPDX-License-Identifier: Apache-2.0

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlDecode,
  canonicalRecord,
  hexEncode,
  sha256,
  verifyInclusion,
  type AtribRecord,
  type OnRecordSidecar,
  type ProofBundle,
} from '@atrib/mcp'
import { parseCheckpointBody, parseSignatureLine } from '@atrib/log-node'
import {
  verifyRecord,
  type EvidenceVerificationBlock,
  type RecordVerificationResult,
} from '@atrib/verify'
import {
  runMcpOAuthEvidenceHarness,
  type McpOAuthEvidenceHarnessResult,
} from './mcp-oauth-evidence-harness.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.dev/v1'
const DEFAULT_ARCHIVE_ENDPOINT = 'https://archive.atrib.dev/v1'
const DEFAULT_EXPLORER_ORIGIN = 'https://explore.atrib.dev'
const FIXTURE_ACCESS_TOKEN = 'fixture-access-token'
const API_LEAVES = new Set([
  'checkpoint',
  'entries',
  'evidence',
  'lookup',
  'proof',
  'pubkey',
  'record',
  'records',
])

type FetchLike = typeof fetch

export interface ProofLogReceiptOptions {
  logEndpoint?: string
  archiveEndpoint?: string
  explorerOrigin?: string
  fetchImpl?: FetchLike
  runHarness?: () => Promise<McpOAuthEvidenceHarnessResult>
}

export interface CheckpointVerificationSummary {
  origin: string
  tree_size: number
  checkpoint_signature_ok: boolean
  key_id_matches_pubkey: boolean
  origin_matches_pubkey: boolean
}

export interface InclusionVerificationSummary {
  log_index: number
  leaf_hash: string
  path_length: number
  verifies_against_checkpoint_root: boolean
}

export interface ArchiveVerificationSummary {
  record_url: string
  evidence_url: string
  record_status: number
  evidence_status: number
  body_hash_matches_log_hash: boolean
  evidence_count: number
  evidence_valid: boolean | null
  raw_bearer_token_published: false
}

export interface VerifierSummary {
  signature_ok: boolean
  valid: boolean
  warnings: string[]
  evidence_protocols: string[]
}

export interface ProofLogReceipt {
  strategy: 'atrib-proof-log-single-hash-receipt-v1'
  record_hash: string
  context_id: string
  event_type: string
  urls: {
    log_lookup: string
    log_proof: string
    archive_record: string
    archive_evidence: string
    explorer_action: string
  }
  checkpoint: CheckpointVerificationSummary
  inclusion: InclusionVerificationSummary
  archive: ArchiveVerificationSummary
  verifier: VerifierSummary
  caveats: string[]
}

interface LogPubkeyResponse {
  origin?: unknown
  key_id?: unknown
  public_key?: unknown
}

interface ArchiveRecordResponse {
  record_hash?: unknown
  record?: unknown
  evidence?: EvidenceVerificationBlock[]
}

interface ArchiveEvidenceResponse {
  evidence?: EvidenceVerificationBlock[]
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function hashHex(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash
}

function endpoint(base: string, leaf: string, suffix?: string): string {
  const url = new URL(base)
  const parts = url.pathname.split('/').filter(Boolean)
  while (parts.length > 0 && API_LEAVES.has(parts.at(-1) ?? '')) parts.pop()
  if (parts.at(-1) !== 'v1') parts.push('v1')
  parts.push(leaf)
  if (suffix) parts.push(suffix)
  url.pathname = `/${parts.join('/')}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function explorerActionUrl(origin: string, hash: string): string {
  const url = new URL(origin)
  url.pathname = `/action/${hash}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function readText(res: Response, label: string): Promise<string> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${label} failed with HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  return text
}

async function readJson<T>(res: Response, label: string): Promise<T> {
  return JSON.parse(await readText(res, label)) as T
}

async function submitRecord(
  fetchImpl: FetchLike,
  logEndpoint: string,
  record: AtribRecord,
): Promise<ProofBundle> {
  const res = await fetchImpl(endpoint(logEndpoint, 'entries'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  return readJson<ProofBundle>(res, 'log submission')
}

async function submitArchive(
  fetchImpl: FetchLike,
  archiveEndpoint: string,
  record: AtribRecord,
  proof: ProofBundle,
  sidecar: OnRecordSidecar,
): Promise<void> {
  const res = await fetchImpl(endpoint(archiveEndpoint, 'records'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      record,
      proof,
      _local: sidecar,
    }),
  })
  await readJson<unknown>(res, 'archive submission')
}

async function fetchLogPubkey(
  fetchImpl: FetchLike,
  logEndpoint: string,
): Promise<{ origin: string; keyId: Uint8Array; publicKey: Uint8Array }> {
  const response = await readJson<LogPubkeyResponse>(
    await fetchImpl(endpoint(logEndpoint, 'pubkey')),
    'log pubkey',
  )
  if (
    typeof response.origin !== 'string' ||
    typeof response.key_id !== 'string' ||
    typeof response.public_key !== 'string'
  ) {
    throw new Error('log pubkey response is missing origin, key_id, or public_key')
  }
  return {
    origin: response.origin,
    keyId: new Uint8Array(Buffer.from(response.key_id, 'hex')),
    publicKey: base64urlDecode(response.public_key),
  }
}

async function verifyCheckpoint(
  fetchImpl: FetchLike,
  logEndpoint: string,
  proof: ProofBundle,
): Promise<CheckpointVerificationSummary> {
  const blankLineIndex = proof.checkpoint.indexOf('\n\n')
  if (blankLineIndex < 0) throw new Error('checkpoint is missing signed-note separator')
  const checkpointBody = proof.checkpoint.slice(0, blankLineIndex + 1)
  const signatureLine = proof.checkpoint
    .slice(blankLineIndex + 2)
    .split('\n')
    .find((line) => line.trim().length > 0)
  if (!signatureLine) throw new Error('checkpoint is missing signature line')

  const parsedBody = parseCheckpointBody(checkpointBody)
  const parsedSignature = parseSignatureLine(signatureLine)
  if (!parsedSignature) throw new Error('checkpoint signature line is malformed')
  const pubkey = await fetchLogPubkey(fetchImpl, logEndpoint)
  const checkpointSignatureOk = await ed.verifyAsync(
    parsedSignature.signature,
    new TextEncoder().encode(checkpointBody),
    pubkey.publicKey,
  )
  const keyIdMatchesPubkey = Buffer.from(parsedSignature.keyId).equals(Buffer.from(pubkey.keyId))

  return {
    origin: parsedBody.origin,
    tree_size: parsedBody.treeSize,
    checkpoint_signature_ok: checkpointSignatureOk,
    key_id_matches_pubkey: keyIdMatchesPubkey,
    origin_matches_pubkey: parsedBody.origin === pubkey.origin,
  }
}

function verifyProofBundle(proof: ProofBundle): InclusionVerificationSummary {
  const checkpointBody = proof.checkpoint.split('\n').slice(0, 3).join('\n') + '\n'
  const parsed = parseCheckpointBody(checkpointBody)
  const rootHash = new Uint8Array(Buffer.from(parsed.rootHash, 'base64'))
  const leafHash = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
  const proofPath = proof.inclusion_proof.map(
    (entry) => new Uint8Array(Buffer.from(entry, 'base64')),
  )

  return {
    log_index: proof.log_index,
    leaf_hash: proof.leaf_hash,
    path_length: proofPath.length,
    verifies_against_checkpoint_root: verifyInclusion(
      proof.log_index,
      parsed.treeSize,
      leafHash,
      proofPath,
      rootHash,
    ),
  }
}

async function fetchArchiveSummary(
  fetchImpl: FetchLike,
  archiveRecordUrl: string,
  archiveEvidenceUrl: string,
  expectedHash: string,
): Promise<ArchiveVerificationSummary> {
  const recordRes = await fetchImpl(archiveRecordUrl)
  const recordText = await readText(recordRes, 'archive record retrieval')
  if (recordText.includes(FIXTURE_ACCESS_TOKEN)) {
    throw new Error('archive record response exposed the raw bearer token')
  }
  const recordBody = JSON.parse(recordText) as ArchiveRecordResponse
  const archivedRecord = recordBody.record as AtribRecord | undefined
  const archivedHash = archivedRecord ? recordHash(archivedRecord) : null

  const evidenceRes = await fetchImpl(archiveEvidenceUrl)
  const evidenceText = await readText(evidenceRes, 'archive evidence retrieval')
  if (evidenceText.includes(FIXTURE_ACCESS_TOKEN)) {
    throw new Error('archive evidence response exposed the raw bearer token')
  }
  const evidenceBody = JSON.parse(evidenceText) as ArchiveEvidenceResponse
  const evidence = evidenceBody.evidence ?? []
  const firstEvidence = evidence[0]

  return {
    record_url: archiveRecordUrl,
    evidence_url: archiveEvidenceUrl,
    record_status: recordRes.status,
    evidence_status: evidenceRes.status,
    body_hash_matches_log_hash:
      recordBody.record_hash === expectedHash && archivedHash === expectedHash,
    evidence_count: evidence.length,
    evidence_valid: typeof firstEvidence?.valid === 'boolean' ? firstEvidence.valid : null,
    raw_bearer_token_published: false,
  }
}

function summarizeVerifier(result: RecordVerificationResult): VerifierSummary {
  return {
    signature_ok: result.signatureOk,
    valid: result.valid,
    warnings: result.warnings,
    evidence_protocols: result.evidence?.map((entry) => entry.protocol) ?? [],
  }
}

async function verifyRecordWithSidecar(
  record: AtribRecord,
  sidecar: OnRecordSidecar,
): Promise<RecordVerificationResult> {
  const authorizationEvidence = sidecar.authorizationEvidence as
    | NonNullable<Parameters<typeof verifyRecord>[1]>['authorizationEvidence']
    | undefined
  return verifyRecord(record, {
    ...(authorizationEvidence ? { authorizationEvidence } : {}),
    ...(sidecar.resolvedFacts ? { resolvedFacts: sidecar.resolvedFacts } : {}),
  })
}

export async function createProofLogReceipt(
  options: ProofLogReceiptOptions = {},
): Promise<ProofLogReceipt> {
  const fetchImpl = options.fetchImpl ?? fetch
  const logEndpoint = options.logEndpoint ?? DEFAULT_LOG_ENDPOINT
  const archiveEndpoint = options.archiveEndpoint ?? DEFAULT_ARCHIVE_ENDPOINT
  const explorerOrigin = options.explorerOrigin ?? DEFAULT_EXPLORER_ORIGIN
  const harness = await (options.runHarness ?? runMcpOAuthEvidenceHarness)()
  const hash = recordHash(harness.record)
  const hex = hashHex(hash)
  const proof = await submitRecord(fetchImpl, logEndpoint, harness.record)
  await submitArchive(fetchImpl, archiveEndpoint, harness.record, proof, harness.sidecar)

  const archiveRecordUrl = endpoint(archiveEndpoint, 'record', hex)
  const archiveEvidenceUrl = endpoint(archiveEndpoint, 'evidence', hex)
  const verifierResult = await verifyRecordWithSidecar(harness.record, harness.sidecar)

  return {
    strategy: 'atrib-proof-log-single-hash-receipt-v1',
    record_hash: hash,
    context_id: harness.record.context_id,
    event_type: harness.record.event_type,
    urls: {
      log_lookup: endpoint(logEndpoint, 'lookup', hex),
      log_proof: endpoint(logEndpoint, 'proof', hex),
      archive_record: archiveRecordUrl,
      archive_evidence: archiveEvidenceUrl,
      explorer_action: explorerActionUrl(explorerOrigin, hash),
    },
    checkpoint: await verifyCheckpoint(fetchImpl, logEndpoint, proof),
    inclusion: verifyProofBundle(proof),
    archive: await fetchArchiveSummary(fetchImpl, archiveRecordUrl, archiveEvidenceUrl, hash),
    verifier: summarizeVerifier(verifierResult),
    caveats: [
      'single-log proof only; no witness cosignature is claimed',
      'no cross-log replication is claimed',
      'archive retrieval is opt-in body and evidence retrieval, not proof that every record body is archived',
      'OAuth evidence is fixture evidence for the proof shape, not a live third-party authorization server proof',
    ],
  }
}
