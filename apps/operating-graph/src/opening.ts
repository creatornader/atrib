// SPDX-License-Identifier: Apache-2.0

import {
  createToolNameCommitment,
  deriveLocalContentFromSidecar,
  verifyJsonCommitment,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import type { LocalRecordMaterial } from './store.js'

export const BODY_OPENING_SCHEMA = 'atrib.body-opening.v1'

export interface ArchiveRecordMaterial {
  record_hash: string
  record: AtribRecord
  log_proofs?: ProofBundle[]
  archived_at_ms?: number
  retention_window_ms?: number
}

interface Opening {
  present: boolean
  verified: boolean | null
  value?: unknown
  commitment?: string
  salt?: string
}

export interface BodyOpeningResponse {
  schema: typeof BODY_OPENING_SCHEMA
  record_hash: string
  source: 'local-mirror' | 'archive'
  record: AtribRecord
  integrity: {
    record_hash_verified: boolean
    signature_verified: boolean
  }
  proof: ProofBundle | null
  archive: {
    archived_at_ms: number | null
    retention_window_ms: number | null
  } | null
  openings: {
    content: Opening
    tool_name: Opening
    args: Opening
    result: Opening
  }
}

export async function buildLocalBodyOpening(
  material: LocalRecordMaterial,
): Promise<BodyOpeningResponse> {
  const local = material.local
  const content = deriveLocalContentFromSidecar(material.record.event_type, local)
  const explicitContent = firstPresent(local, 'content')
  const toolName = stringField(local, 'toolName', 'tool_name')
  const args = firstPresent(local, 'args', 'input', 'arguments')
  const result = firstPresent(local, 'result', 'output', 'response')
  return {
    schema: BODY_OPENING_SCHEMA,
    record_hash: material.record_hash,
    source: 'local-mirror',
    record: material.record,
    integrity: {
      record_hash_verified: true,
      signature_verified: material.signature_verified,
    },
    proof: material.proof,
    archive: null,
    openings: {
      content: explicitContent.found
        ? jsonOpening(
            explicitContent.value,
            material.record.args_hash,
            material.record.args_salt,
            true,
          )
        : jsonOpening(content, undefined, undefined),
      tool_name: toolNameOpening(toolName, material.record.tool_name),
      args: jsonOpening(
        args.value,
        material.record.args_hash,
        material.record.args_salt,
        args.found,
      ),
      result: jsonOpening(
        result.value,
        material.record.result_hash,
        material.record.result_salt,
        result.found,
      ),
    },
  }
}

export async function buildArchiveBodyOpening(
  material: ArchiveRecordMaterial,
): Promise<BodyOpeningResponse> {
  return {
    schema: BODY_OPENING_SCHEMA,
    record_hash: material.record_hash,
    source: 'archive',
    record: material.record,
    integrity: {
      record_hash_verified: true,
      signature_verified: await verifyRecord(material.record).catch(() => false),
    },
    proof: material.log_proofs?.[0] ?? null,
    archive: {
      archived_at_ms: material.archived_at_ms ?? null,
      retention_window_ms: material.retention_window_ms ?? null,
    },
    openings: {
      content: emptyOpening(),
      tool_name: emptyOpening(),
      args: emptyOpening(),
      result: emptyOpening(),
    },
  }
}

function jsonOpening(
  value: unknown,
  hash: string | undefined,
  salt: string | undefined,
  present = value !== undefined,
): Opening {
  if (!present) return emptyOpening()
  if (!hash) return { present: true, verified: null, value }
  return {
    present: true,
    verified: verifyJsonCommitment(value, { hash, ...(salt ? { salt } : {}) }),
    value,
    commitment: hash,
    ...(salt ? { salt } : {}),
  }
}

function toolNameOpening(value: string | undefined, commitment: string | undefined): Opening {
  if (value === undefined) return emptyOpening()
  if (!commitment) return { present: true, verified: null, value }
  const verified =
    value === commitment ||
    (commitment.startsWith('sha256:') && createToolNameCommitment(value) === commitment)
  return { present: true, verified, value, commitment }
}

function emptyOpening(): Opening {
  return { present: false, verified: null }
}

function stringField(
  value: Record<string, unknown> | null,
  ...names: string[]
): string | undefined {
  if (!value) return undefined
  for (const name of names) {
    if (typeof value[name] === 'string') return value[name]
  }
  return undefined
}

function firstPresent(
  value: Record<string, unknown> | null,
  ...names: string[]
): { found: boolean; value: unknown } {
  if (!value) return { found: false, value: undefined }
  for (const name of names) {
    if (name in value) return { found: true, value: value[name] }
  }
  return { found: false, value: undefined }
}
