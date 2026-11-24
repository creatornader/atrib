// SPDX-License-Identifier: Apache-2.0

/**
 * Mirror line parsing shared by the chain-inheritance helpers and the record
 * hash index. Both on-disk shapes are accepted: a bare record per line, or an
 * envelope with the record under `record`. Anything else parses to null.
 */

import { canonicalRecord } from './canon.js'
import type { AtribRecord } from './types.js'
import { hasCreatorSignerEntry } from './types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseMirrorValue(value: unknown): AtribRecord | null {
  if (!isObject(value)) return null
  const wrapped = value['record']
  const candidate = isObject(wrapped) ? wrapped : value
  const hasCreatorSigner = hasCreatorSignerEntry(candidate)
  const contentIdRequired = [
    'https://atrib.dev/v1/types/tool_call',
    'https://atrib.dev/v1/types/transaction',
    'https://atrib.dev/v1/types/directory_anchor',
    'https://atrib.dev/v1/types/session_checkpoint',
  ].includes(candidate['event_type'] as string)
  if (
    candidate['spec_version'] !== 'atrib/1.0' ||
    (('content_id' in candidate || contentIdRequired) &&
      typeof candidate['content_id'] !== 'string') ||
    typeof candidate['creator_key'] !== 'string' ||
    (typeof candidate['signature'] !== 'string' &&
      ('signature' in candidate || !hasCreatorSigner)) ||
    typeof candidate['chain_root'] !== 'string' ||
    typeof candidate['event_type'] !== 'string' ||
    typeof candidate['context_id'] !== 'string' ||
    typeof candidate['timestamp'] !== 'number' ||
    !Number.isFinite(candidate['timestamp'])
  ) {
    return null
  }
  const record = candidate as unknown as AtribRecord
  try {
    canonicalRecord(record)
  } catch {
    return null
  }
  return record
}

export function parseMirrorLine(line: string): AtribRecord | null {
  try {
    return parseMirrorValue(JSON.parse(line) as unknown)
  } catch {
    return null
  }
}
