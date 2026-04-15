// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory record store for the graph query service.
 * Indexes records by context_id and creator_key for fast lookups.
 */

import type { AtribRecord } from '@atrib/mcp'
import type { GapNode } from './graph-builder.js'

export interface RecordStore {
  addRecord(record: AtribRecord): void
  addGapNode(gapNode: GapNode): void
  getRecordsByContextId(contextId: string): AtribRecord[]
  getGapNodesByContextId(contextId: string): GapNode[]
  getSessionsByCreatorKey(creatorKey: string): SessionSummary[]
  hasContext(contextId: string): boolean
}

export interface SessionSummary {
  context_id: string
  first_seen: number
  last_seen: number
  node_count: number
  has_transaction: boolean
}

export function createRecordStore(): RecordStore {
  const byContext = new Map<string, AtribRecord[]>()
  const gapsByContext = new Map<string, GapNode[]>()
  const byCreator = new Map<string, Set<string>>() // creator_key -> Set<context_id>

  return {
    addRecord(record: AtribRecord): void {
      const list = byContext.get(record.context_id) ?? []
      list.push(record)
      byContext.set(record.context_id, list)

      const contexts = byCreator.get(record.creator_key) ?? new Set()
      contexts.add(record.context_id)
      byCreator.set(record.creator_key, contexts)
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

        const timestamps = records.map((r) => r.timestamp)
        summaries.push({
          context_id: contextId,
          first_seen: Math.min(...timestamps),
          last_seen: Math.max(...timestamps),
          node_count: records.length + (gapsByContext.get(contextId)?.length ?? 0),
          has_transaction: records.some((r) => r.event_type === 'transaction'),
        })
      }

      return summaries.sort((a, b) => b.last_seen - a.last_seen)
    },

    hasContext(contextId: string): boolean {
      return byContext.has(contextId) || gapsByContext.has(contextId)
    },
  }
}
