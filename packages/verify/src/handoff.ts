// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlDecode,
  canonicalRecord,
  hexEncode,
  leafHash,
  serializeEntry,
  sha256,
  verifyInclusion,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { verifyRecord } from './verify-record.js'
import type { RecordVerificationResult } from './verify-record.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

export type HandoffRejectionReason =
  | 'record_missing'
  | 'record_hash_mismatch'
  | 'record_invalid'
  | 'signature_invalid'
  | 'wrong_signer'
  | 'wrong_context'
  | 'stale'
  | 'body_missing'
  | 'body_commitment_missing'
  | 'body_hash_mismatch'
  | 'proof_missing'
  | 'proof_invalid'

export interface HandoffClaimInput {
  record_hash: string
  record?: AtribRecord
  body?: unknown
  args?: unknown
  result?: unknown
  proof?: ProofBundle
  trusted_creator_keys?: string[]
  allowed_context_ids?: string[]
  max_age_ms?: number
}

export interface VerifyHandoffClaimsOptions {
  trusted_creator_keys?: string[]
  allowed_context_ids?: string[]
  require_body?: boolean
  require_body_commitment?: boolean
  require_log_inclusion?: boolean
  log_public_key?: Uint8Array
  now_ms?: number
  max_age_ms?: number
}

export interface HandoffBodyVerification {
  args_hash_present: boolean
  args_hash_ok: boolean | null
  result_hash_present: boolean
  result_hash_ok: boolean | null
}

export interface HandoffProofVerification {
  present: boolean
  inclusion_ok: boolean | null
  checkpoint_signature_ok: boolean | null
  error?: string
}

export interface HandoffClaimVerification {
  record_hash: string
  accepted: boolean
  rejection_reasons: HandoffRejectionReason[]
  warnings: string[]
  record?: AtribRecord
  verification?: RecordVerificationResult
  signature_ok: boolean | null
  computed_record_hash: string | null
  signer_trusted: boolean | null
  context_allowed: boolean | null
  body?: HandoffBodyVerification
  proof?: HandoffProofVerification
}

export interface HandoffVerificationResult {
  accepted: HandoffClaimVerification[]
  rejected: HandoffClaimVerification[]
  accepted_record_hashes: string[]
  all_accepted: boolean
}

export interface HandoffEvidenceEntry {
  record_hash?: string
  record?: AtribRecord
  body?: unknown
  args?: unknown
  result?: unknown
  proof?: ProofBundle | null
  _local?: {
    content?: unknown
    body?: unknown
    args?: unknown
    result?: unknown
    producer?: string
    [key: string]: unknown
  } | null
  [key: string]: unknown
}

export interface HandoffEvidencePacket {
  kind?: string
  records?: HandoffEvidenceEntry[]
  claims?: HandoffEvidenceEntry[]
  record_hashes?: string[]
  required_record_hashes?: string[]
  trusted_creator_keys?: string[]
  allowed_context_ids?: string[]
  max_age_ms?: number
  archive_refs?: unknown[]
  [key: string]: unknown
}

export interface HandoffClaimsFromEvidenceOptions {
  required_record_hashes?: string[]
  trusted_creator_keys?: string[]
  allowed_context_ids?: string[]
  max_age_ms?: number
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function hashPlainJson(value: unknown): string | null {
  try {
    const encoded = canonicalize(value)
    if (encoded === undefined) return null
    return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
  } catch {
    return null
  }
}

function hashSaltedJson(value: unknown, salt: string): string | null {
  try {
    const encoded = canonicalize(value)
    if (encoded === undefined) return null
    const saltBytes = base64urlDecode(salt)
    const bodyBytes = new TextEncoder().encode(encoded)
    const input = new Uint8Array(saltBytes.length + bodyBytes.length)
    input.set(saltBytes, 0)
    input.set(bodyBytes, saltBytes.length)
    return `sha256:${hexEncode(sha256(input))}`
  } catch {
    return null
  }
}

function hashMaterial(value: unknown, salt?: string): string | null {
  return salt === undefined ? hashPlainJson(value) : hashSaltedJson(value, salt)
}

function hasMaterial(value: unknown): boolean {
  return value !== undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAtribRecordLike(value: unknown): value is AtribRecord {
  if (!isObject(value)) return false
  return (
    typeof value.spec_version === 'string' &&
    typeof value.event_type === 'string' &&
    typeof value.context_id === 'string' &&
    typeof value.creator_key === 'string' &&
    typeof value.chain_root === 'string' &&
    typeof value.content_id === 'string' &&
    typeof value.signature === 'string'
  )
}

function proofOrUndefined(value: unknown): ProofBundle | undefined {
  if (value === null || value === undefined) return undefined
  return value as ProofBundle
}

function localSidecar(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined
}

function evidenceEntries(
  packet: HandoffEvidencePacket | HandoffEvidenceEntry[],
): HandoffEvidenceEntry[] {
  if (Array.isArray(packet)) return packet
  const entries: HandoffEvidenceEntry[] = []
  if (Array.isArray(packet.records)) entries.push(...packet.records)
  if (Array.isArray(packet.claims)) entries.push(...packet.claims)
  return entries
}

function requiredHashes(
  packet: HandoffEvidencePacket | HandoffEvidenceEntry[],
  options: HandoffClaimsFromEvidenceOptions,
): string[] {
  const values = new Set<string>()
  if (!Array.isArray(packet)) {
    for (const hash of packet.required_record_hashes ?? []) values.add(hash)
    for (const hash of packet.record_hashes ?? []) values.add(hash)
  }
  for (const hash of options.required_record_hashes ?? []) values.add(hash)
  return [...values]
}

function claimFromEvidenceEntry(
  entry: HandoffEvidenceEntry,
  packet: HandoffEvidencePacket | HandoffEvidenceEntry[],
  options: HandoffClaimsFromEvidenceOptions,
): HandoffClaimInput | null {
  const envelope = isObject(entry) ? entry : {}
  const record = isAtribRecordLike(envelope.record)
    ? envelope.record
    : isAtribRecordLike(entry)
      ? entry
      : undefined
  const local = localSidecar(envelope._local)
  const claimHash =
    typeof envelope.record_hash === 'string'
      ? envelope.record_hash
      : record
        ? recordHash(record)
        : undefined
  if (claimHash === undefined) return null

  const trustedCreatorKeys =
    options.trusted_creator_keys ??
    (!Array.isArray(packet) ? packet.trusted_creator_keys : undefined)
  const allowedContextIds =
    options.allowed_context_ids ?? (!Array.isArray(packet) ? packet.allowed_context_ids : undefined)
  const maxAgeMs = options.max_age_ms ?? (!Array.isArray(packet) ? packet.max_age_ms : undefined)

  const claim: HandoffClaimInput = { record_hash: claimHash }
  if (record) claim.record = record
  const body = envelope.body ?? local?.body ?? local?.content
  const args = envelope.args ?? local?.args
  const result = envelope.result ?? local?.result
  if (body !== undefined) claim.body = body
  if (args !== undefined) claim.args = args
  if (result !== undefined) claim.result = result
  const proof = proofOrUndefined(envelope.proof)
  if (proof !== undefined) claim.proof = proof
  if (trustedCreatorKeys !== undefined) claim.trusted_creator_keys = trustedCreatorKeys
  if (allowedContextIds !== undefined) claim.allowed_context_ids = allowedContextIds
  if (maxAgeMs !== undefined) claim.max_age_ms = maxAgeMs
  return claim
}

export function handoffClaimsFromEvidencePacket(
  packet: HandoffEvidencePacket | HandoffEvidenceEntry[],
  options: HandoffClaimsFromEvidenceOptions = {},
): HandoffClaimInput[] {
  const claims: HandoffClaimInput[] = []
  const seen = new Set<string>()
  for (const entry of evidenceEntries(packet)) {
    const claim = claimFromEvidenceEntry(entry, packet, options)
    if (!claim) continue
    claims.push(claim)
    seen.add(claim.record_hash)
  }
  for (const hash of requiredHashes(packet, options)) {
    if (!seen.has(hash)) claims.push({ record_hash: hash })
  }
  return claims
}

function verifyBody(
  claim: HandoffClaimInput,
  record: AtribRecord,
  requireBody: boolean,
  requireBodyCommitment: boolean,
  reasons: HandoffRejectionReason[],
): HandoffBodyVerification {
  const body: HandoffBodyVerification = {
    args_hash_present: record.args_hash !== undefined,
    args_hash_ok: null,
    result_hash_present: record.result_hash !== undefined,
    result_hash_ok: null,
  }

  const argsMaterial = claim.args ?? claim.body
  const resultMaterial = claim.result
  const anyMaterial = hasMaterial(argsMaterial) || hasMaterial(resultMaterial)
  const anyCommitment = record.args_hash !== undefined || record.result_hash !== undefined

  if (requireBody && !anyMaterial) {
    reasons.push('body_missing')
  }
  if (requireBodyCommitment && !anyCommitment) {
    reasons.push('body_commitment_missing')
  }

  if (record.args_hash !== undefined && hasMaterial(argsMaterial)) {
    body.args_hash_ok = hashMaterial(argsMaterial, record.args_salt) === record.args_hash
    if (!body.args_hash_ok) reasons.push('body_hash_mismatch')
  }

  if (record.result_hash !== undefined && hasMaterial(resultMaterial)) {
    body.result_hash_ok = hashMaterial(resultMaterial, record.result_salt) === record.result_hash
    if (!body.result_hash_ok) reasons.push('body_hash_mismatch')
  }

  return body
}

function verifyFreshness(
  record: AtribRecord,
  nowMs: number,
  maxAgeMs: number | undefined,
  reasons: HandoffRejectionReason[],
): void {
  if (maxAgeMs === undefined) return
  const ageMs = nowMs - record.timestamp
  if (ageMs < 0 || ageMs > maxAgeMs) reasons.push('stale')
}

async function verifyProofPresence(
  claim: HandoffClaimInput,
  record: AtribRecord,
  computedRecordHash: string,
  requireLogInclusion: boolean,
  logPublicKey: Uint8Array | undefined,
  reasons: HandoffRejectionReason[],
): Promise<HandoffProofVerification | undefined> {
  if (claim.proof === undefined) {
    if (requireLogInclusion) reasons.push('proof_missing')
    return requireLogInclusion
      ? { present: false, inclusion_ok: null, checkpoint_signature_ok: null }
      : undefined
  }
  const verification = await verifyProofBundle(
    record,
    computedRecordHash,
    claim.proof,
    logPublicKey,
  )
  if (verification.inclusion_ok !== true) reasons.push('proof_invalid')
  if (logPublicKey !== undefined && verification.checkpoint_signature_ok !== true) {
    reasons.push('proof_invalid')
  }
  return verification
}

function decodeBase64Bytes(value: string, expectedLength: number): Uint8Array {
  const decoded = new Uint8Array(Buffer.from(value, 'base64'))
  if (decoded.length !== expectedLength) {
    throw new Error(`expected ${expectedLength} bytes, got ${decoded.length}`)
  }
  return decoded
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i++) {
    diff |= (left[i] as number) ^ (right[i] as number)
  }
  return diff === 0
}

function checkpointBody(checkpoint: string): string {
  const body = checkpoint.split('\n\n')[0]
  if (body === undefined || body.length === 0) throw new Error('checkpoint body missing')
  return body.endsWith('\n') ? body : `${body}\n`
}

function parseCheckpointRoot(checkpoint: string): { treeSize: number; rootHash: Uint8Array } {
  const body = checkpointBody(checkpoint)
  const lines = body.trimEnd().split('\n')
  if (lines.length !== 3) throw new Error('checkpoint body must have three lines')
  const treeSize = Number(lines[1])
  if (!Number.isSafeInteger(treeSize) || treeSize < 0) {
    throw new Error('checkpoint tree size is invalid')
  }
  return {
    treeSize,
    rootHash: decodeBase64Bytes(lines[2]!, 32),
  }
}

async function verifyCheckpointSignature(
  checkpoint: string,
  logPublicKey: Uint8Array,
): Promise<boolean> {
  const parts = checkpoint.split('\n\n')
  const body = checkpointBody(checkpoint)
  const sigLine = parts[1]?.trim()
  if (sigLine === undefined || sigLine.length === 0) return false
  const match = sigLine.match(/^\S+ \S+ (\S+)\s*$/)
  if (match === null) return false
  const decoded = decodeBase64Bytes(match[1]!, 68)
  const signature = decoded.slice(4)
  return ed.verifyAsync(signature, new TextEncoder().encode(body), logPublicKey)
}

function expectedLeafHash(record: AtribRecord, computedRecordHash: string): Uint8Array {
  const recordHashHex = computedRecordHash.slice('sha256:'.length)
  const entry = serializeEntry({
    record_hash_hex: recordHashHex,
    creator_key_b64url: record.creator_key,
    context_id: record.context_id,
    timestamp: record.timestamp,
    event_type: record.event_type,
  })
  return leafHash(entry)
}

async function verifyProofBundle(
  record: AtribRecord,
  computedRecordHash: string,
  proof: ProofBundle,
  logPublicKey: Uint8Array | undefined,
): Promise<HandoffProofVerification> {
  try {
    const checkpoint = parseCheckpointRoot(proof.checkpoint)
    const leaf = decodeBase64Bytes(proof.leaf_hash, 32)
    const expectedLeaf = expectedLeafHash(record, computedRecordHash)
    if (!bytesEqual(leaf, expectedLeaf)) {
      return {
        present: true,
        inclusion_ok: false,
        checkpoint_signature_ok: null,
        error: 'proof leaf hash does not match record entry',
      }
    }
    const proofHashes = proof.inclusion_proof.map((item) => decodeBase64Bytes(item, 32))
    const checkpointSignatureOk =
      logPublicKey === undefined
        ? null
        : await verifyCheckpointSignature(proof.checkpoint, logPublicKey)
    return {
      present: true,
      inclusion_ok: verifyInclusion(
        proof.log_index,
        checkpoint.treeSize,
        leaf,
        proofHashes,
        checkpoint.rootHash,
      ),
      checkpoint_signature_ok: checkpointSignatureOk,
    }
  } catch (error) {
    return {
      present: true,
      inclusion_ok: false,
      checkpoint_signature_ok: null,
      error: error instanceof Error ? error.message : 'proof verification failed',
    }
  }
}

function verifyTrustedSigner(
  record: AtribRecord,
  trustedCreatorKeys: string[] | undefined,
  reasons: HandoffRejectionReason[],
): boolean | null {
  if (trustedCreatorKeys === undefined || trustedCreatorKeys.length === 0) return null
  const trusted = trustedCreatorKeys.includes(record.creator_key)
  if (!trusted) reasons.push('wrong_signer')
  return trusted
}

function verifyAllowedContext(
  record: AtribRecord,
  allowedContextIds: string[] | undefined,
  reasons: HandoffRejectionReason[],
): boolean | null {
  if (allowedContextIds === undefined || allowedContextIds.length === 0) return null
  const allowed = allowedContextIds.includes(record.context_id)
  if (!allowed) reasons.push('wrong_context')
  return allowed
}

async function verifyOneClaim(
  claim: HandoffClaimInput,
  options: VerifyHandoffClaimsOptions,
): Promise<HandoffClaimVerification> {
  const reasons: HandoffRejectionReason[] = []
  const warnings: string[] = []
  const nowMs = options.now_ms ?? Date.now()
  const trustedCreatorKeys = claim.trusted_creator_keys ?? options.trusted_creator_keys
  const allowedContextIds = claim.allowed_context_ids ?? options.allowed_context_ids
  const maxAgeMs = claim.max_age_ms ?? options.max_age_ms

  if (claim.record === undefined) {
    reasons.push('record_missing')
    return {
      record_hash: claim.record_hash,
      accepted: false,
      rejection_reasons: reasons,
      warnings,
      signature_ok: null,
      computed_record_hash: null,
      signer_trusted: null,
      context_allowed: null,
    }
  }

  const computed = recordHash(claim.record)
  if (computed !== claim.record_hash) {
    reasons.push('record_hash_mismatch')
  }

  const verification = await verifyRecord(claim.record)
  if (!verification.signatureOk) reasons.push('signature_invalid')
  if (!verification.valid) reasons.push('record_invalid')
  warnings.push(...verification.warnings)

  const signerTrusted = verifyTrustedSigner(claim.record, trustedCreatorKeys, reasons)
  const contextAllowed = verifyAllowedContext(claim.record, allowedContextIds, reasons)
  verifyFreshness(claim.record, nowMs, maxAgeMs, reasons)
  const proof = await verifyProofPresence(
    claim,
    claim.record,
    computed,
    options.require_log_inclusion === true,
    options.log_public_key,
    reasons,
  )
  const body = verifyBody(
    claim,
    claim.record,
    options.require_body === true,
    options.require_body_commitment === true,
    reasons,
  )

  const uniqueReasons = Array.from(new Set(reasons))

  const result: HandoffClaimVerification = {
    record_hash: claim.record_hash,
    accepted: uniqueReasons.length === 0,
    rejection_reasons: uniqueReasons,
    warnings,
    record: claim.record,
    verification,
    signature_ok: verification.signatureOk,
    computed_record_hash: computed,
    signer_trusted: signerTrusted,
    context_allowed: contextAllowed,
    body,
  }
  if (proof !== undefined) result.proof = proof
  return result
}

export async function verifyHandoffClaims(
  claims: HandoffClaimInput[],
  options: VerifyHandoffClaimsOptions = {},
): Promise<HandoffVerificationResult> {
  const checked = await Promise.all(claims.map((claim) => verifyOneClaim(claim, options)))
  const accepted = checked.filter((claim) => claim.accepted)
  const rejected = checked.filter((claim) => !claim.accepted)
  return {
    accepted,
    rejected,
    accepted_record_hashes: accepted.map((claim) => claim.record_hash),
    all_accepted: rejected.length === 0,
  }
}
