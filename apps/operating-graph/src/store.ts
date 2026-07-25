// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyJsonCommitment,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { parseOperatingEvent, type OperatingEntry, type OperatingEnvelope } from './model.js'
import { parseAnyRuntimeObservation, type RuntimeObservationEntry } from './observations.js'

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
  return (await loadOperatingMirror(path, maxRecords)).operating_entries
}

export async function loadRuntimeObservationEntries(
  path: string,
  maxRecords = 100_000,
): Promise<RuntimeObservationEntry[]> {
  return (await loadOperatingMirror(path, maxRecords)).runtime_observations
}

export interface OperatingMirrorEntries {
  readonly operating_entries: OperatingEntry[]
  readonly runtime_observations: RuntimeObservationEntry[]
}

/**
 * Reads one fingerprintable mirror snapshot once and splits committed content
 * into separate semantic and runtime-observation lanes. A record cannot enter
 * either lane unless its private content reopens against the signed args hash.
 */
export async function loadOperatingMirror(
  path: string,
  maxRecords = 100_000,
): Promise<OperatingMirrorEntries> {
  const files = await mirrorFiles(path)
  const operatingEntries = new Map<string, OperatingEntry>()
  const runtimeObservations = new Map<string, RuntimeObservationEntry>()
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
      const content = committedLocalContent(envelope.record, envelope._local?.content)
      if (!content) continue
      const hash = recordHash(envelope.record)
      const signatureVerified = await verifyRecord(envelope.record).catch(() => false)
      const event = parseOperatingEvent(content)
      if (event) {
        operatingEntries.set(hash, {
          record_hash: hash,
          record: envelope.record,
          event,
          signature_verified: signatureVerified,
          content_commitment_verified: true,
          proof_supplied: envelope.proof !== undefined && envelope.proof !== null,
          producer: envelope._local?.producer ?? null,
        })
      }
      const observation = parseAnyRuntimeObservation(content)
      if (observation) {
        runtimeObservations.set(hash, {
          record_hash: hash,
          record: envelope.record,
          observation,
          signature_verified: signatureVerified,
          content_commitment_verified: true,
          proof_supplied: envelope.proof !== undefined && envelope.proof !== null,
          producer: envelope._local?.producer ?? null,
        })
      }
    }
  }
  const joinedOperatingEntries = [...operatingEntries.values()].filter((entry) => {
    const observationHash = entry.event.source_observation
    if (!observationHash) return true
    if (!entry.record.informed_by?.includes(observationHash)) return false
    const observation = runtimeObservations.get(observationHash)
    return (
      observation !== undefined &&
      observation.signature_verified &&
      samePlacement(entry, observation)
    )
  })
  return {
    operating_entries: joinedOperatingEntries,
    runtime_observations: [...runtimeObservations.values()],
  }
}

function samePlacement(entry: OperatingEntry, observation: RuntimeObservationEntry): boolean {
  const event = entry.event
  const mapped = observation.observation
  return (
    sameNamedRef(event.workspace, mapped.workspace) &&
    sameOptionalNamedRef(event.task, mapped.task) &&
    sameOptionalNamedRef(event.team, mapped.team) &&
    sameOptionalAgentRef(event.agent, mapped.mapped_agent)
  )
}

function sameNamedRef(
  left: { id: string; name: string },
  right: { id: string; name: string },
): boolean {
  return left.id === right.id && left.name === right.name
}

function sameOptionalNamedRef(
  left: { id: string; name: string } | undefined,
  right: { id: string; name: string } | undefined,
): boolean {
  return left === undefined ? right === undefined : right !== undefined && sameNamedRef(left, right)
}

function sameOptionalAgentRef(
  left: { id: string; name: string; role: string } | undefined,
  right: { id: string; name: string; role: string } | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && sameNamedRef(left, right) && left.role === right.role
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

function committedLocalContent(
  record: AtribRecord,
  content: unknown,
): Record<string, unknown> | null {
  if (!isObject(content) || !record.args_hash) return null
  const hasArgsSalt = Object.prototype.hasOwnProperty.call(record, 'args_salt')
  if (hasArgsSalt && typeof record.args_salt !== 'string') return null
  try {
    const verified = verifyJsonCommitment(content, {
      hash: record.args_hash,
      ...(hasArgsSalt ? { salt: record.args_salt } : {}),
    })
    return verified ? content : null
  } catch {
    return null
  }
}
