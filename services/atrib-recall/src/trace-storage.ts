// SPDX-License-Identifier: Apache-2.0

/**
 * Local mirror reader for atrib-trace.
 *
 * Reads either one ATRIB_RECORD_FILE mirror or every *.jsonl mirror under
 * ~/.atrib/records/ and normalizes to bare AtribRecord shape regardless of
 * producer (wrapper-signed or emit envelope).
 *
 * Builds an in-memory index by record_hash so trace can walk informed_by
 * chains in O(1) per hop. The hash key is sha256:<64-hex> (the same form
 * informed_by entries use), so no transformation needed at lookup time.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  withDerivedLocalContent,
  type AtribRecord,
  type OnRecordSidecar,
} from '@atrib/mcp'

export interface IndexedRecord {
  record: AtribRecord
  /** sha256:<64-hex> form, matching informed_by entries. */
  record_hash: string
  /** Source file the record was read from (for debugging). */
  source: string
  /**
   * Pre-sign payload context, when the producer wrote it to the local
   * mirror as a `_local` sidecar on the envelope. Carries semantic content
   * (toolName, args, result, content) the signed AtribRecord COMMITS TO
   * via content_id / args_hash / result_hash but does not itself contain.
   * Absent on legacy bare-record entries from older mirror writes.
   */
  local?: SidecarPayload
}

/**
 * Combined sidecar shape, superset of every producer's local payload
 * (mcp-wrap writes toolName/args/result; atrib-emit writes content).
 */
export interface SidecarPayload extends OnRecordSidecar {
  content?: unknown
  producer?: string
}

const RECORDS_FILE = process.env.ATRIB_RECORD_FILE
const RECORDS_DIR = process.env.ATRIB_RECORDS_DIR ?? join(homedir(), '.atrib', 'records')

/**
 * Read every *.jsonl mirror in ATRIB_RECORDS_DIR and return an index keyed
 * by sha256:<64-hex> record_hash. Both shapes (bare AtribRecord and emit's
 * { record, proof, written_at } envelope) are supported.
 *
 * Returns the indexed map AND a flat list (newest-first by timestamp) for
 * callers that want recall-style enumeration without by-hash lookup.
 */
export function loadAllRecords(dir: string = RECORDS_DIR): {
  byHash: Map<string, IndexedRecord>
  newestFirst: IndexedRecord[]
} {
  const byHash = new Map<string, IndexedRecord>()
  const all: IndexedRecord[] = []

  const paths: { path: string; source: string }[] = []
  if (RECORDS_FILE) {
    paths.push({ path: RECORDS_FILE, source: basename(RECORDS_FILE) })
  } else {
    if (!existsSync(dir)) return { byHash, newestFirst: [] }
    try {
      for (const fname of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
        paths.push({ path: join(dir, fname), source: fname })
      }
    } catch {
      return { byHash, newestFirst: [] }
    }
  }

  for (const { path, source } of paths) {
    try {
      const raw = readFileSync(path, 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed) as
            | AtribRecord
            | { record: AtribRecord; proof?: unknown; written_at?: unknown; _local?: SidecarPayload }
          // Normalize: envelope shape vs legacy bare record shape.
          const isEnvelope =
            'record' in parsed &&
            parsed.record &&
            (parsed.record as AtribRecord).context_id !== undefined
          const rec: AtribRecord = isEnvelope
            ? (parsed.record as AtribRecord)
            : (parsed as AtribRecord)
          if (!rec.context_id || !rec.signature || !rec.timestamp) continue

          const hashHex = hexEncode(sha256(canonicalRecord(rec)))
          const indexed: IndexedRecord = {
            record: rec,
            record_hash: `sha256:${hashHex}`,
            source,
          }
          // Lift the `_local` sidecar onto the indexed record when present.
          // Legacy bare-record entries have no sidecar; that's OK, consumers
          // tolerate its absence.
          if (isEnvelope) {
            const sidecar = (parsed as { _local?: SidecarPayload })._local
            if (sidecar) indexed.local = withDerivedLocalContent(rec.event_type, sidecar)
          }
          byHash.set(indexed.record_hash, indexed)
          all.push(indexed)
        } catch {
          // Malformed line; skip.
        }
      }
    } catch {
      // File read failure; skip this file.
    }
  }

  all.sort((a, b) => b.record.timestamp - a.record.timestamp)
  return { byHash, newestFirst: all }
}
