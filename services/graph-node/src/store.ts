// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory record store for the graph query service.
 * Indexes records by context_id and creator_key for fast lookups.
 */

import { canonicalRecord, sha256, hexEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import type { GapNode } from './graph-builder.js'

export interface RecordStore {
  /**
   * Add a record. logIndex is optional; when supplied (typically by
   * log-node fanout via the x-atrib-log-index header), revocation
   * semantics per §1.9.3 require it. When omitted, revocation cannot
   * be applied to records signed by this creator_key.
   *
   * Returns `true` when the record was new (added to the store) and
   * `false` when the record was already present (dedup hit). Callers
   * MAY use the boolean to skip downstream side effects on duplicate
   * ingest, most importantly, the persistence appender skips
   * duplicate writes to keep the on-disk archive free of redundancy.
   */
  addRecord(record: AtribRecord, logIndex?: number): boolean
  addGapNode(gapNode: GapNode): void
  getRecordsByContextId(contextId: string): AtribRecord[]
  getGapNodesByContextId(contextId: string): GapNode[]
  getSessionsByCreatorKey(creatorKey: string): SessionSummary[]
  hasContext(contextId: string): boolean
  /**
   * All records ingested across all contexts. Used to build the
   * revocation registry (§1.9): key_revocation records can affect
   * any session, so the registry must scan globally.
   */
  getAllRecords(): { record: AtribRecord; log_index: number | null }[]
  /** log_index for a specific record_hash, or null if unknown. */
  getLogIndex(recordHashHex: string): number | null
}

export interface SessionSummary {
  context_id: string
  first_seen: number
  last_seen: number
  node_count: number
  has_transaction: boolean
  /**
   * Per-event-type record counts within the context_id. Surfaces session
   * composition (e.g., 568 tool_call, 469 annotation, 196 observation, 51
   * revision). Zero-count types are omitted to keep responses compact.
   * Mirrors log-node's by-creator helper which has carried this since
   * inception. Specified as OPTIONAL in §3.4.4; implementations MAY include.
   */
  count_by_event_type: Record<string, number>
  /**
   * True when the context_id contains a genesis record (chain_root =
   * SHA-256(context_id) per §1.2.3). Distinguishes "session that started
   * here" from "single record that landed alone with no chain root."
   */
  has_genesis: boolean
}

export function createRecordStore(): RecordStore {
  const byContext = new Map<string, AtribRecord[]>()
  const gapsByContext = new Map<string, GapNode[]>()
  const byCreator = new Map<string, Set<string>>() // creator_key -> Set<context_id>
  // Dedup index: SHA-256 hex of the JCS-canonical signed record. Re-ingest of
  // the same record (same record_hash) is a no-op. Without this, /v1/ingest
  // duplicates compound: every retry/replay/double-post produces a phantom
  // node in the graph, which §3.2.4 derivation then connects with extra edges.
  const seenRecordHashes = new Set<string>()
  const logIndexByHash = new Map<string, number>()
  // Insertion order is the iteration order; flat list mirrors what the log
  // would return. Enables global scans (e.g. for the revocation registry).
  const allRecords: { record: AtribRecord; recordHash: string }[] = []

  return {
    addRecord(record: AtribRecord, logIndex?: number): boolean {
      const recordHash = hexEncode(sha256(canonicalRecord(record)))
      if (seenRecordHashes.has(recordHash)) {
        // If the record was previously ingested without a log_index but is
        // now being re-ingested WITH one (e.g., backfill), record the index.
        if (typeof logIndex === 'number' && !logIndexByHash.has(recordHash)) {
          logIndexByHash.set(recordHash, logIndex)
        }
        return false
      }
      seenRecordHashes.add(recordHash)
      if (typeof logIndex === 'number') logIndexByHash.set(recordHash, logIndex)
      allRecords.push({ record, recordHash })

      const list = byContext.get(record.context_id) ?? []
      list.push(record)
      byContext.set(record.context_id, list)

      const contexts = byCreator.get(record.creator_key) ?? new Set()
      contexts.add(record.context_id)
      byCreator.set(record.creator_key, contexts)
      return true
    },

    addGapNode(gapNode: GapNode): void {
      const list = gapsByContext.get(gapNode.context_id) ?? []
      list.push(gapNode)
      gapsByContext.set(gapNode.context_id, list)
    },

    getRecordsByContextId(contextId: string): AtribRecord[] {
      return byContext.get(contextId) ?? []
    },

    getGapNodesByContextId(contextId: string): GapNode[] {
      return gapsByContext.get(contextId) ?? []
    },

    getSessionsByCreatorKey(creatorKey: string): SessionSummary[] {
      const contextIds = byCreator.get(creatorKey)
      if (!contextIds) return []

      const summaries: SessionSummary[] = []
      for (const contextId of contextIds) {
        const records = byContext.get(contextId) ?? []
        if (records.length === 0) continue

        // Single pass: collect timestamps, event-type breakdown, transaction
        // flag, and genesis presence. Math.min/max(...timestamps) avoided
        // here because spread on a 1000+ record array hits the v8 spread
        // arg limit on some hosts (call stack overflow).
        const expectedGenesis = `sha256:${hexEncode(sha256(new TextEncoder().encode(contextId)))}`
        let firstSeen = records[0]!.timestamp
        let lastSeen = records[0]!.timestamp
        let hasTransaction = false
        let hasGenesis = false
        const countByEventType: Record<string, number> = {}
        for (const r of records) {
          if (r.timestamp < firstSeen) firstSeen = r.timestamp
          if (r.timestamp > lastSeen) lastSeen = r.timestamp
          const label = r.event_type.startsWith('https://atrib.dev/v1/types/')
            ? r.event_type.slice('https://atrib.dev/v1/types/'.length)
            : r.event_type
          countByEventType[label] = (countByEventType[label] ?? 0) + 1
          if (label === 'transaction') hasTransaction = true
          if (r.chain_root === expectedGenesis) hasGenesis = true
        }
        summaries.push({
          context_id: contextId,
          first_seen: firstSeen,
          last_seen: lastSeen,
          node_count: records.length + (gapsByContext.get(contextId)?.length ?? 0),
          has_transaction: hasTransaction,
          count_by_event_type: countByEventType,
          has_genesis: hasGenesis,
        })
      }

      return summaries.sort((a, b) => b.last_seen - a.last_seen)
    },

    hasContext(contextId: string): boolean {
      return byContext.has(contextId) || gapsByContext.has(contextId)
    },

    getAllRecords(): { record: AtribRecord; log_index: number | null }[] {
      return allRecords.map(({ record, recordHash }) => ({
        record,
        log_index: logIndexByHash.get(recordHash) ?? null,
      }))
    },

    getLogIndex(recordHashHex: string): number | null {
      return logIndexByHash.get(recordHashHex) ?? null
    },
  }
}
