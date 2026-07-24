// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { parseOperatingEvent, type OperatingEntry, type OperatingEnvelope } from './model.js'

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function mirrorFiles(path: string): Promise<string[]> {
  const absolute = resolve(path)
  const pathStat = await stat(absolute)
  if (pathStat.isFile()) return [absolute]
  if (!pathStat.isDirectory()) return []
  const entries = await readdir(absolute, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.jsonl')
    .map((entry) => join(absolute, entry.name))
    .sort()
}

export async function mirrorFingerprint(path: string): Promise<string> {
  const files = await mirrorFiles(path)
  const rows = await Promise.all(
    files.map(async (file) => {
      const fileStat = await stat(file)
      return `${file}:${fileStat.size}:${fileStat.mtimeMs}`
    }),
  )
  return rows.join('|')
}

export async function loadOperatingEntries(
  path: string,
  maxRecords = 100_000,
): Promise<OperatingEntry[]> {
  const files = await mirrorFiles(path)
  const deduped = new Map<string, OperatingEntry>()
  let recordsRead = 0

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      recordsRead += 1
      if (recordsRead > maxRecords) {
        throw new Error(`mirror record limit exceeded (${maxRecords})`)
      }
      let envelope: OperatingEnvelope
      try {
        envelope = JSON.parse(line) as OperatingEnvelope
      } catch {
        continue
      }
      if (!envelope.record || typeof envelope.record !== 'object') continue
      const event = parseOperatingEvent(envelope._local?.content)
      if (!event) continue
      const hash = recordHash(envelope.record)
      const signatureVerified = await verifyRecord(envelope.record).catch(() => false)
      deduped.set(hash, {
        record_hash: hash,
        record: envelope.record,
        event,
        signature_verified: signatureVerified,
        proof_supplied: envelope.proof !== undefined && envelope.proof !== null,
        producer: envelope._local?.producer ?? null,
      })
    }
  }
  return [...deduped.values()]
}

export interface LocalRecordMaterial {
  record_hash: string
  record: AtribRecord
  proof: ProofBundle | null
  local: Record<string, unknown> | null
  signature_verified: boolean
}

export async function loadLocalRecordMaterial(
  path: string,
  targetHash: string,
  maxRecords = 100_000,
): Promise<LocalRecordMaterial | null> {
  const files = await mirrorFiles(path)
  let recordsRead = 0
  let matched: LocalRecordMaterial | null = null

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      recordsRead += 1
      if (recordsRead > maxRecords) {
        throw new Error(`mirror record limit exceeded (${maxRecords})`)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(line) as unknown
      } catch {
        continue
      }
      const envelope = normalizeMirrorEnvelope(parsed)
      if (!envelope) continue
      const hash = recordHash(envelope.record)
      if (hash !== targetHash) continue
      const signatureVerified = await verifyRecord(envelope.record).catch(() => false)
      const candidate: LocalRecordMaterial = {
        record_hash: hash,
        record: envelope.record,
        proof: envelope.proof,
        local: envelope.local,
        signature_verified: signatureVerified,
      }
      if (!matched) {
        matched = candidate
        continue
      }
      matched = {
        ...candidate,
        proof: candidate.proof ?? matched.proof,
        local: mergeLocalMaterial(matched.local, candidate.local),
        signature_verified: matched.signature_verified && candidate.signature_verified,
      }
    }
  }
  return matched
}

function normalizeMirrorEnvelope(value: unknown): {
  record: AtribRecord
  proof: ProofBundle | null
  local: Record<string, unknown> | null
} | null {
  if (!isObject(value)) return null
  const record = isAtribRecord(value['record'])
    ? value['record']
    : isAtribRecord(value)
      ? value
      : null
  if (!record) return null
  const proof = isProofBundle(value['proof']) ? value['proof'] : null
  const local = isObject(value['_local']) ? value['_local'] : null
  return { record, proof, local }
}

function mergeLocalMaterial(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!left) return right
  if (!right) return left
  return { ...left, ...right }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isAtribRecord(value: unknown): value is AtribRecord {
  return (
    isObject(value) &&
    value['spec_version'] === 'atrib/1.0' &&
    typeof value['event_type'] === 'string' &&
    typeof value['context_id'] === 'string' &&
    typeof value['creator_key'] === 'string' &&
    typeof value['signature'] === 'string'
  )
}

function isProofBundle(value: unknown): value is ProofBundle {
  return (
    isObject(value) &&
    typeof value['log_index'] === 'number' &&
    typeof value['checkpoint'] === 'string' &&
    Array.isArray(value['inclusion_proof']) &&
    typeof value['leaf_hash'] === 'string'
  )
}
