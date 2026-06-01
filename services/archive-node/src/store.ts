// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import type {
  AuthorizationEvidenceInput,
  EvidenceVerificationBlock,
  ResolvedCapabilityFacts,
} from '@atrib/verify'

export interface ArchiveSubmissionEnvelope {
  record_hash?: string
  record: AtribRecord
  proof?: ProofBundle | null
  log_proofs?: ProofBundle[]
  authorizationEvidence?: AuthorizationEvidenceInput[]
  evidence?: EvidenceVerificationBlock[]
  resolvedFacts?: ResolvedCapabilityFacts
  _local?: Record<string, unknown> | null
}

export interface StoredArchiveEntry {
  record_hash: string
  record: AtribRecord
  archived_at_ms: number
  retention_window_ms: number
  log_proofs: ProofBundle[]
  authorizationEvidence: AuthorizationEvidenceInput[]
  evidence: EvidenceVerificationBlock[]
  resolvedFacts?: ResolvedCapabilityFacts
}

export interface ArchiveStoreOptions {
  persistencePath?: string
  retentionWindowMs: number
  nowMs?: () => number
}

export type ArchiveLookupResult =
  | { status: 'found'; entry: StoredArchiveEntry }
  | { status: 'expired'; entry: StoredArchiveEntry; expired_at_ms: number }
  | { status: 'missing' }

export interface ArchivePutResult {
  created: boolean
  entry: StoredArchiveEntry
}

const SHA256_REF_RE = /^sha256:[0-9a-f]{64}$/

export function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

export function normalizeArchiveSubmission(input: unknown): ArchiveSubmissionEnvelope {
  if (!isObject(input)) throw new Error('body must be a JSON object')

  const record = isAtribRecordLike(input.record) ? input.record : isAtribRecordLike(input) ? input : null
  if (!record) throw new Error('record must be an AtribRecord object')

  const explicitHash = typeof input.record_hash === 'string' ? input.record_hash : undefined
  if (explicitHash !== undefined && !SHA256_REF_RE.test(explicitHash)) {
    throw new Error('record_hash must be sha256:<64 lowercase hex>')
  }

  const local = isObject(input._local) ? input._local : undefined
  const localContent = isObject(local?.content) ? local.content : undefined
  const proof = isProofBundle(input.proof) ? input.proof : undefined
  const logProofs = Array.isArray(input.log_proofs)
    ? input.log_proofs.filter(isProofBundle)
    : proof
      ? [proof]
      : []

  const authorizationEvidence = firstArray(
    input.authorizationEvidence,
    local?.authorizationEvidence,
    localContent?.authorizationEvidence,
    localContent?.authorization_evidence,
  ) as AuthorizationEvidenceInput[]
  const evidence = firstArray(input.evidence) as EvidenceVerificationBlock[]
  const resolvedFacts = firstObject(
    input.resolvedFacts,
    local?.resolvedFacts,
    localContent?.resolvedFacts,
    localContent?.resolved_facts,
  ) as ResolvedCapabilityFacts | undefined

  return {
    ...(explicitHash ? { record_hash: explicitHash } : {}),
    record,
    ...(logProofs.length > 0 ? { log_proofs: logProofs } : {}),
    ...(authorizationEvidence.length > 0 ? { authorizationEvidence } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(resolvedFacts ? { resolvedFacts } : {}),
    ...(local ? { _local: local } : {}),
  }
}

export class ArchiveStore {
  private readonly entries = new Map<string, StoredArchiveEntry>()
  private readonly persistencePath: string | undefined
  private readonly retentionWindowMs: number
  private readonly nowMs: () => number

  constructor(options: ArchiveStoreOptions) {
    this.persistencePath = options.persistencePath
    this.retentionWindowMs = options.retentionWindowMs
    this.nowMs = options.nowMs ?? (() => Date.now())
  }

  async init(): Promise<number> {
    if (!this.persistencePath) return 0
    await mkdir(dirname(this.persistencePath), { recursive: true })
    if (!existsSync(this.persistencePath)) return 0
    const text = await readFile(this.persistencePath, 'utf8')
    let count = 0
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed) as StoredArchiveEntry
        if (!isStoredEntry(parsed)) continue
        if (recordHash(parsed.record) !== parsed.record_hash) continue
        this.entries.set(parsed.record_hash, parsed)
        count += 1
      } catch {
        continue
      }
    }
    return count
  }

  get(recordHashRef: string): ArchiveLookupResult {
    const entry = this.entries.get(recordHashRef)
    if (!entry) return { status: 'missing' }
    const expiredAtMs = entry.archived_at_ms + entry.retention_window_ms
    if (this.nowMs() > expiredAtMs) {
      return { status: 'expired', entry, expired_at_ms: expiredAtMs }
    }
    return { status: 'found', entry }
  }

  async put(submission: ArchiveSubmissionEnvelope): Promise<ArchivePutResult> {
    const computedHash = recordHash(submission.record)
    if (submission.record_hash !== undefined && submission.record_hash !== computedHash) {
      throw new Error('record_hash does not match canonical record body')
    }

    const next: StoredArchiveEntry = {
      record_hash: computedHash,
      record: submission.record,
      archived_at_ms: this.nowMs(),
      retention_window_ms: this.retentionWindowMs,
      log_proofs: submission.log_proofs ?? [],
      authorizationEvidence: submission.authorizationEvidence ?? [],
      evidence: submission.evidence ?? [],
      ...(submission.resolvedFacts ? { resolvedFacts: submission.resolvedFacts } : {}),
    }

    const existing = this.entries.get(computedHash)
    const entry = existing ? mergeEntries(existing, next) : next
    this.entries.set(computedHash, entry)
    if (!existing || stableJson(entry) !== stableJson(existing)) {
      await this.persist(entry)
    }
    return { created: existing === undefined, entry }
  }

  private async persist(entry: StoredArchiveEntry): Promise<void> {
    if (!this.persistencePath) return
    await appendFile(this.persistencePath, `${JSON.stringify(entry)}\n`, 'utf8')
  }
}

function mergeEntries(existing: StoredArchiveEntry, next: StoredArchiveEntry): StoredArchiveEntry {
  const merged: StoredArchiveEntry = {
    ...existing,
    log_proofs: dedupeObjects([...existing.log_proofs, ...next.log_proofs]),
    authorizationEvidence: dedupeObjects([
      ...existing.authorizationEvidence,
      ...next.authorizationEvidence,
    ]),
    evidence: dedupeObjects([...existing.evidence, ...next.evidence]),
  }
  if (existing.resolvedFacts || next.resolvedFacts) {
    merged.resolvedFacts = { ...(existing.resolvedFacts ?? {}), ...(next.resolvedFacts ?? {}) }
  }
  return merged
}

function dedupeObjects<T>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = stableJson(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }
  return []
}

function firstObject(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (isObject(value)) return value
  }
  return undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAtribRecordLike(value: unknown): value is AtribRecord {
  if (!isObject(value)) return false
  return (
    value.spec_version === 'atrib/1.0' &&
    typeof value.event_type === 'string' &&
    typeof value.timestamp === 'number' &&
    typeof value.context_id === 'string' &&
    typeof value.creator_key === 'string' &&
    typeof value.chain_root === 'string' &&
    typeof value.content_id === 'string' &&
    typeof value.signature === 'string'
  )
}

function isProofBundle(value: unknown): value is ProofBundle {
  if (!isObject(value)) return false
  return (
    typeof value.log_index === 'number' &&
    typeof value.checkpoint === 'string' &&
    Array.isArray(value.inclusion_proof) &&
    typeof value.leaf_hash === 'string'
  )
}

function isStoredEntry(value: unknown): value is StoredArchiveEntry {
  if (!isObject(value)) return false
  return (
    typeof value.record_hash === 'string' &&
    isAtribRecordLike(value.record) &&
    typeof value.archived_at_ms === 'number' &&
    typeof value.retention_window_ms === 'number' &&
    Array.isArray(value.log_proofs) &&
    Array.isArray(value.authorizationEvidence) &&
    Array.isArray(value.evidence)
  )
}
