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
 * A group has no time bound, because a producer can keep re-signing one
 * statement for days. A statement that is deliberately restated later is
 * therefore one group too: the group reports the time of its latest copy,
 * and callers order the group by that time, so a restatement still sorts
 * after whatever was said in between.
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

/** True when the record can never be a re-signed copy of another. */
function neverCollapses(record: AtribRecord): boolean {
  if (
    record.event_type === EVENT_TYPE_TOOL_CALL_URI ||
    record.event_type === EVENT_TYPE_TRANSACTION_URI
  ) {
    return true
  }
  const argsHash = (record as unknown as Record<string, unknown>)['args_hash']
  return typeof argsHash !== 'string' || argsHash.length === 0
}

/**
 * Cheap pre-key: copies of one statement always share it, and it costs no
 * hashing. Only records that share a bucket need the full key, which keeps
 * a large mirror with few copies from hashing every record.
 */
export function duplicateBucketForRecord(record: AtribRecord): string | undefined {
  if (neverCollapses(record)) return undefined
  const argsHash = (record as unknown as Record<string, unknown>)['args_hash'] as string
  return `${record.creator_key}|${record.context_id}|${record.event_type}|${argsHash}`
}

/**
 * Key shared by every re-signed copy of one statement, or undefined when
 * the record is never collapsed.
 */
export function duplicateKeyForRecord(record: AtribRecord): string | undefined {
  if (neverCollapses(record)) return undefined
  const comparable: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(record as unknown as Record<string, unknown>)) {
    if (!RESIGN_VARIANT_FIELDS.has(name)) comparable[name] = value
  }
  return createHash('sha256').update(stableStringify(comparable)).digest('hex')
}

export interface DuplicateDescription {
  /** Cheap pre-key; undefined when the item is never collapsed. */
  bucket: string | undefined
  /** Full key. Called only for items whose bucket has another item in it. */
  key: () => string | undefined
  timestamp: number
  recordHash: string
}

export interface DuplicateGroup<T> {
  /**
   * The distinct signed copies, earliest first. Ties on timestamp go to the
   * lexicographically smaller record hash, so the order is stable across
   * runs. Always two or more.
   */
  members: T[]
  /**
   * Items that repeat a member's record hash: one signed record read from
   * two mirror files. They are not copies and are never counted as such.
   */
  twins: T[]
  /** Timestamp of the latest copy. */
  latestTimestamp: number
}

/**
 * Find every group of two or more distinct signed copies. Items outside a
 * group are not returned.
 */
export function findDuplicateGroups<T>(
  items: readonly T[],
  describe: (item: T) => DuplicateDescription,
): DuplicateGroup<T>[] {
  const buckets = new Map<string, Array<{ item: T; description: DuplicateDescription }>>()
  for (const item of items) {
    const description = describe(item)
    if (description.bucket === undefined) continue
    const bucket = buckets.get(description.bucket)
    if (bucket) bucket.push({ item, description })
    else buckets.set(description.bucket, [{ item, description }])
  }
  const groups: DuplicateGroup<T>[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    const byKey = new Map<string, Array<{ item: T; description: DuplicateDescription }>>()
    for (const candidate of bucket) {
      const key = candidate.description.key()
      if (key === undefined) continue
      const sameKey = byKey.get(key)
      if (sameKey) sameKey.push(candidate)
      else byKey.set(key, [candidate])
    }
    for (const sameKey of byKey.values()) {
      if (sameKey.length < 2) continue
      sameKey.sort(
        (a, b) =>
          a.description.timestamp - b.description.timestamp ||
          (a.description.recordHash < b.description.recordHash
            ? -1
            : a.description.recordHash > b.description.recordHash
              ? 1
              : 0),
      )
      const members: T[] = []
      const twins: T[] = []
      const seen = new Set<string>()
      let latestTimestamp = -Infinity
      for (const { item, description } of sameKey) {
        if (seen.has(description.recordHash)) {
          twins.push(item)
          continue
        }
        seen.add(description.recordHash)
        members.push(item)
        if (description.timestamp > latestTimestamp) latestTimestamp = description.timestamp
      }
      if (members.length < 2) continue
      groups.push({ members, twins, latestTimestamp })
    }
  }
  return groups
}

export interface DuplicateCollapse<T> {
  /** Input items with every group reduced to its chosen member, in input order. */
  kept: T[]
  /** The group each chosen member stands for. */
  groupOf: Map<T, DuplicateGroup<T>>
  /** Number of distinct signed copies removed. Twins are not counted. */
  collapsed: number
}

/**
 * Reduce each group to one member. `choose` picks it and defaults to the
 * earliest copy.
 */
export function collapseDuplicateGroups<T>(
  items: readonly T[],
  groups: readonly DuplicateGroup<T>[],
  choose: (group: DuplicateGroup<T>) => T = (group) => group.members[0] as T,
): DuplicateCollapse<T> {
  const groupOf = new Map<T, DuplicateGroup<T>>()
  const removed = new Set<T>()
  let collapsed = 0
  for (const group of groups) {
    const chosen = choose(group)
    groupOf.set(chosen, group)
    for (const member of group.members) if (member !== chosen) removed.add(member)
    for (const twin of group.twins) removed.add(twin)
    collapsed += group.members.length - 1
  }
  return { kept: items.filter((item) => !removed.has(item)), groupOf, collapsed }
}
