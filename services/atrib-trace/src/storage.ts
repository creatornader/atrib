// SPDX-License-Identifier: Apache-2.0

/**
 * Local mirror reader for atrib-trace.
 *
 * Reads every *.jsonl mirror under ~/.atrib/records/ and normalizes to bare
 * AtribRecord shape regardless of producer (wrapper-signed or emit envelope).
 *
 * Builds an in-memory index by record_hash so trace can walk informed_by
 * chains in O(1) per hop. The hash key is sha256:<64-hex> (the same form
 * informed_by entries use), so no transformation needed at lookup time.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'

export interface IndexedRecord {
  record: AtribRecord
  /** sha256:<64-hex> form, matching informed_by entries. */
  record_hash: string
  /** Source file the record was read from (for debugging). */
  source: string
}

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

  if (!existsSync(dir)) return { byHash, newestFirst: [] }

  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { byHash, newestFirst: [] }
  }

  for (const fname of files) {
    const path = join(dir, fname)
    try {
      const raw = readFileSync(path, 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed) as
            | AtribRecord
            | { record: AtribRecord; proof?: unknown; written_at?: unknown }
          // Normalize: emit envelope vs bare wrapper record.
          const rec: AtribRecord =
            'record' in parsed && parsed.record && (parsed.record as AtribRecord).context_id
              ? (parsed.record as AtribRecord)
              : (parsed as AtribRecord)
          if (!rec.context_id || !rec.signature || !rec.timestamp) continue

          const hashHex = hexEncode(sha256(canonicalRecord(rec)))
          const indexed: IndexedRecord = {
            record: rec,
            record_hash: `sha256:${hashHex}`,
            source: fname,
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
