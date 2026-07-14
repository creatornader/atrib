// SPDX-License-Identifier: Apache-2.0

/**
 * Bounded directional walk through informed_by chains.
 *
 * Two directions:
 *   - backward (traceBackward): from a record, walk its informed_by chain
 *     toward causal ancestors. Answers "what informed this?"
 *   - forward (traceForward): from a record, walk the records that cite it
 *     via their informed_by. Answers "what was informed by this?" — i.e.
 *     what followed from this decision/observation.
 *
 * Each direction breadth-first walks edges until either (a) depth bound
 * reached, (b) no more unresolved hashes remain, or (c) safety cap on
 * total visited nodes hit.
 *
 * Each visited record is annotated with:
 *   - depth       , hop count from the starting record (0 = the start)
 *   - parent_hashes, which records in the previous level referenced this one
 *
 * Records referenced via informed_by but NOT present in the local mirror
 * are surfaced as `dangling` entries: the verifier hasn't seen the upstream
 * locally. This is informational, not a failure, the upstream may live on
 * the public log but not in the agent's local mirror.
 *
 * Forward walk requires a full-mirror reverse index (built on each call
 * from the same IndexedRecord map; O(N) once, then O(out-degree) per hop).
 * For typical mirror sizes (~14K records) this is negligible.
 */

import type { IndexedRecord } from './trace-storage.js'
import type { AtribRecord } from '@atrib/mcp'

export type TraceDirection = 'backward' | 'forward'

export interface TraceVisited {
  depth: number
  record_hash: string
  parent_hashes: string[]
  /** Empty when source mirror lacks this record (dangling). */
  record: AtribRecord | null
  /** Source file the record was read from, or null if dangling. */
  source: string | null
  /** Sub-set of informed_by entries that are themselves walkable next-hop. */
  next_informed_by: string[]
}

export interface TraceResult {
  start_hash: string
  direction: TraceDirection
  depth_requested: number
  depth_reached: number
  visited: TraceVisited[]
  dangling: string[]
  truncated_by_depth: boolean
  truncated_by_cap: boolean
  warnings: string[]
}

export interface TraceOptions {
  /** Hard cap on total visited nodes regardless of depth. Defaults to 200. */
  maxNodes?: number
  /**
   * When set, scope the walk to records that share this context_id. Edges
   * crossing into a different context_id are treated as dangling: the
   * upstream is real but lies outside the requested scope. Used by
   * Inspect-style harnesses passing ATRIB_CONTEXT_ID to keep each arm's
   * trace inside its own context.
   */
  contextId?: string
}

/**
 * Walk informed_by edges backward from the starting record.
 *
 * Behaviors:
 *   - Cycle-safe: every record is visited at most once, even if multiple
 *     parents reference it.
 *   - Cap-safe: if maxNodes is hit mid-walk, returns partial result with
 *     truncated_by_cap=true. Callers can re-run with a smaller depth or
 *     start from a sub-tree if needed.
 *   - Dangling-aware: informed_by entries pointing at records not in the
 *     local mirror surface as `dangling`. Those entries do NOT advance the
 *     walk (we have nothing to walk from).
 */
export function traceBackward(
  startHash: string,
  depth: number,
  index: Map<string, IndexedRecord>,
  options: TraceOptions = {},
): TraceResult {
  const maxNodes = options.maxNodes ?? 200
  const contextId = options.contextId
  const warnings: string[] = []
  const visited = new Map<string, TraceVisited>()
  const dangling = new Set<string>()
  let truncatedByCap = false
  let truncatedByDepth = false
  let depthReached = 0

  const startIdx = index.get(startHash)
  if (!startIdx) {
    return {
      start_hash: startHash,
      direction: 'backward',
      depth_requested: depth,
      depth_reached: 0,
      visited: [],
      dangling: [startHash],
      truncated_by_depth: false,
      truncated_by_cap: false,
      warnings: [`start_hash ${startHash} not in local mirror`],
    }
  }

  // context_id scope check: when the caller pinned a context_id, the start
  // record itself must already live within it. Reject explicitly rather than
  // silently returning an empty walk; the caller likely wants to know they
  // pointed trace at the wrong record for the requested scope.
  if (contextId && startIdx.record.context_id !== contextId) {
    return {
      start_hash: startHash,
      direction: 'backward',
      depth_requested: depth,
      depth_reached: 0,
      visited: [],
      dangling: [],
      truncated_by_depth: false,
      truncated_by_cap: false,
      warnings: [
        `start_hash ${startHash} lives in context_id ${startIdx.record.context_id} but trace was scoped to ${contextId} (set ATRIB_CONTEXT_ID to override or omit context_id to walk cross-context)`,
      ],
    }
  }

  // BFS frontier: each entry is { hash, parent }. parent is null for the start.
  type Frontier = { hash: string; depth: number; parent: string | null }
  const frontier: Frontier[] = [{ hash: startHash, depth: 0, parent: null }]

  while (frontier.length > 0) {
    if (visited.size >= maxNodes) {
      truncatedByCap = true
      break
    }
    const current = frontier.shift()!
    if (current.depth > depth) {
      truncatedByDepth = true
      continue
    }
    depthReached = Math.max(depthReached, current.depth)

    const idx = index.get(current.hash)
    if (!idx) {
      dangling.add(current.hash)
      // Tag the parent so caller can see which walkable record had a
      // dangling reference, but we don't visit further.
      continue
    }

    // context_id scope filter: an upstream record that lives in a different
    // context_id is treated as dangling from this walk's perspective. The
    // record itself exists, but it sits outside the requested scope. This
    // keeps per-arm trace results clean when ATRIB_CONTEXT_ID is set per
    // D072 (cross-arm informed_by edges, if any leaked, do not pollute
    // the walk).
    if (contextId && idx.record.context_id !== contextId) {
      dangling.add(current.hash)
      continue
    }

    let v = visited.get(current.hash)
    if (!v) {
      const informedByEntries = Array.isArray(idx.record.informed_by)
        ? idx.record.informed_by
        : []
      v = {
        depth: current.depth,
        record_hash: current.hash,
        parent_hashes: [],
        record: idx.record,
        source: idx.source,
        next_informed_by: informedByEntries,
      }
      visited.set(current.hash, v)

      // Schedule informed_by entries for visit at depth+1.
      if (current.depth < depth) {
        for (const upstream of informedByEntries) {
          frontier.push({ hash: upstream, depth: current.depth + 1, parent: current.hash })
        }
      } else if (informedByEntries.length > 0) {
        truncatedByDepth = true
      }
    }
    if (current.parent && !v.parent_hashes.includes(current.parent)) {
      v.parent_hashes.push(current.parent)
    }
  }

  return {
    start_hash: startHash,
    direction: 'backward',
    depth_requested: depth,
    depth_reached: depthReached,
    visited: Array.from(visited.values()),
    dangling: Array.from(dangling),
    truncated_by_depth: truncatedByDepth,
    truncated_by_cap: truncatedByCap,
    warnings,
  }
}

/**
 * Build a reverse informed_by index: for each record_hash R, the list of
 * record_hashes that cite R in their informed_by field. O(total
 * informed_by entries) build; O(1) lookup per parent during walk.
 *
 * Exported so callers (or tests) can pre-build the index when running
 * multiple traceForward calls against the same mirror.
 */
export function buildReverseInformedByIndex(
  index: Map<string, IndexedRecord>,
): Map<string, string[]> {
  const reverse = new Map<string, string[]>()
  for (const { record, record_hash } of index.values()) {
    const ib = Array.isArray(record.informed_by) ? record.informed_by : []
    for (const upstream of ib) {
      if (typeof upstream !== 'string') continue
      const existing = reverse.get(upstream)
      if (existing) existing.push(record_hash)
      else reverse.set(upstream, [record_hash])
    }
  }
  return reverse
}

/**
 * Walk informed_by edges FORWARD from the starting record.
 *
 * Answers: "what records cited THIS record via informed_by?" — i.e. what
 * decisions/observations followed from this one in the causal substrate.
 * The dual of traceBackward. Useful for "I made decision X, what did I do
 * because of it?" lookups.
 *
 * Same behaviors as traceBackward:
 *   - Cycle-safe via visited-set
 *   - Cap-safe via maxNodes
 *   - context_id-scoped (if specified): edges into a different context_id
 *     are treated as dangling
 *   - Dangling: walking forward to a record present in the reverse index
 *     but missing from the mirror surfaces it as dangling (defensive; in
 *     practice the same mirror that built the reverse index has the
 *     record itself)
 */
export function traceForward(
  startHash: string,
  depth: number,
  index: Map<string, IndexedRecord>,
  options: TraceOptions = {},
): TraceResult {
  const maxNodes = options.maxNodes ?? 200
  const contextId = options.contextId
  const warnings: string[] = []
  const visited = new Map<string, TraceVisited>()
  const dangling = new Set<string>()
  let truncatedByCap = false
  let truncatedByDepth = false
  let depthReached = 0

  const startIdx = index.get(startHash)
  if (!startIdx) {
    return {
      start_hash: startHash,
      direction: 'forward',
      depth_requested: depth,
      depth_reached: 0,
      visited: [],
      dangling: [startHash],
      truncated_by_depth: false,
      truncated_by_cap: false,
      warnings: [`start_hash ${startHash} not in local mirror`],
    }
  }

  if (contextId && startIdx.record.context_id !== contextId) {
    return {
      start_hash: startHash,
      direction: 'forward',
      depth_requested: depth,
      depth_reached: 0,
      visited: [],
      dangling: [],
      truncated_by_depth: false,
      truncated_by_cap: false,
      warnings: [
        `start_hash ${startHash} lives in context_id ${startIdx.record.context_id} but trace was scoped to ${contextId} (set ATRIB_CONTEXT_ID to override or omit context_id to walk cross-context)`,
      ],
    }
  }

  // Build the reverse index once per call. For Layer 1 corpus sizes
  // (~14K records) the O(N) build is negligible; the saved per-hop O(1)
  // child lookup is worth the linear scan.
  const reverse = buildReverseInformedByIndex(index)

  // BFS frontier: each entry is { hash, depth, parent }. parent is null for the start.
  type Frontier = { hash: string; depth: number; parent: string | null }
  const frontier: Frontier[] = [{ hash: startHash, depth: 0, parent: null }]

  while (frontier.length > 0) {
    if (visited.size >= maxNodes) {
      truncatedByCap = true
      break
    }
    const current = frontier.shift()!
    if (current.depth > depth) {
      truncatedByDepth = true
      continue
    }
    depthReached = Math.max(depthReached, current.depth)

    const idx = index.get(current.hash)
    if (!idx) {
      // The reverse index pointed at a record not present in the mirror.
      // Defensive case (the reverse index was built FROM the same mirror,
      // so this branch is unreachable in practice). Treat as dangling.
      dangling.add(current.hash)
      continue
    }

    if (contextId && idx.record.context_id !== contextId) {
      dangling.add(current.hash)
      continue
    }

    let v = visited.get(current.hash)
    if (!v) {
      const children = reverse.get(current.hash) ?? []
      v = {
        depth: current.depth,
        record_hash: current.hash,
        parent_hashes: [],
        record: idx.record,
        source: idx.source,
        // `next_informed_by` reused here as "edges out of this node in
        // the walk direction" — for forward walk that's the children
        // (records citing this one), not this record's own informed_by.
        // Field name kept for shape-compat with traceBackward.
        next_informed_by: children,
      }
      visited.set(current.hash, v)

      if (current.depth < depth) {
        for (const child of children) {
          frontier.push({ hash: child, depth: current.depth + 1, parent: current.hash })
        }
      } else if (children.length > 0) {
        truncatedByDepth = true
      }
    }
    if (current.parent && !v.parent_hashes.includes(current.parent)) {
      v.parent_hashes.push(current.parent)
    }
  }

  return {
    start_hash: startHash,
    direction: 'forward',
    depth_requested: depth,
    depth_reached: depthReached,
    visited: Array.from(visited.values()),
    dangling: Array.from(dangling),
    truncated_by_depth: truncatedByDepth,
    truncated_by_cap: truncatedByCap,
    warnings,
  }
}
