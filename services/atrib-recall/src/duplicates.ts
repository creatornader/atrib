// SPDX-License-Identifier: Apache-2.0

/**
 * Re-signed duplicate detection for the listing and search read shapes.
 *
 * A producer that retries after a timeout can sign the same statement more
 * than once. Each copy is a valid record with its own hash, and signed
 * records are never removed, so a mirror can hold many copies of one
 * statement. Listing and search results collapse such a group to its
 * earliest copy and report how many more exist.
 *
 * Two records are copies when every signed field matches except
 * `timestamp`, `chain_root` and `signature`, the three fields a re-signing
 * necessarily changes. The comparison is deliberately strict:
 *
 *   - Only records that commit to explicit content through `args_hash`
 *     qualify. Without that commitment two records can share every other
 *     field and still say different things.
 *   - `tool_call` and `transaction` records never qualify. Running the same
 *     call or payment twice is two acts, not one statement signed twice.
 *
 * Collapsing is presentation only. Every copy stays in the mirror and stays
 * reachable by hash, so walks, chains and references into a hidden copy
 * resolve exactly as before.
 */

import { createHash } from 'node:crypto'
import { EVENT_TYPE_TOOL_CALL_URI, EVENT_TYPE_TRANSACTION_URI } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const RESIGN_VARIANT_FIELDS = new Set(['timestamp', 'chain_root', 'signature'])

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * Key shared by every re-signed copy of one statement, or undefined when
 * the record is never collapsed.
 */
export function duplicateKeyForRecord(record: AtribRecord): string | undefined {
  if (
    record.event_type === EVENT_TYPE_TOOL_CALL_URI ||
    record.event_type === EVENT_TYPE_TRANSACTION_URI
  ) {
    return undefined
  }
  const fields = record as unknown as Record<string, unknown>
  if (typeof fields['args_hash'] !== 'string' || fields['args_hash'].length === 0) return undefined
  const comparable: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (!RESIGN_VARIANT_FIELDS.has(name)) comparable[name] = value
  }
  return createHash('sha256').update(stableStringify(comparable)).digest('hex').slice(0, 32)
}

export interface DuplicateCollapse<T> {
  /** Input items with later copies removed, in their original order. */
  kept: T[]
  /** For each kept item that had copies: how many were removed. */
  extraCopies: Map<T, number>
  /** Total number of items removed. */
  collapsed: number
}

/**
 * Keep the earliest item of each duplicate group. Ties on timestamp go to
 * the lexicographically smaller record hash, so the choice is stable across
 * runs. Items without a key are always kept. The kept item takes the
 * position its group first appears at.
 */
export function collapseDuplicates<T>(
  items: readonly T[],
  describe: (item: T) => { key: string | undefined; timestamp: number; recordHash: string },
): DuplicateCollapse<T> {
  const groups = new Map<
    string,
    { slot: number; best: T; timestamp: number; recordHash: string; size: number }
  >()
  const slots: Array<T | undefined> = []
  for (const item of items) {
    const { key, timestamp, recordHash } = describe(item)
    if (key === undefined) {
      slots.push(item)
      continue
    }
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { slot: slots.length, best: item, timestamp, recordHash, size: 1 })
      slots.push(item)
      continue
    }
    group.size++
    if (
      timestamp < group.timestamp ||
      (timestamp === group.timestamp && recordHash < group.recordHash)
    ) {
      group.best = item
      group.timestamp = timestamp
      group.recordHash = recordHash
      slots[group.slot] = item
    }
  }
  const extraCopies = new Map<T, number>()
  let collapsed = 0
  for (const group of groups.values()) {
    if (group.size > 1) {
      extraCopies.set(group.best, group.size - 1)
      collapsed += group.size - 1
    }
  }
  return { kept: slots.filter((item): item is T => item !== undefined), extraCopies, collapsed }
}
