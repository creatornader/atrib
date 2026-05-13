// SPDX-License-Identifier: Apache-2.0

/**
 * Bounded backward walk through informed_by chains.
 *
 * Given a starting record_hash and a depth bound, breadth-first walks every
 * informed_by edge until either (a) depth bound reached, (b) no more
 * unresolved hashes remain, or (c) safety cap on total visited nodes hit.
 *
 * Each visited record is annotated with:
 *   - depth        — hop count from the starting record (0 = the start)
 *   - parent_hashes — which records in the previous level referenced this one
 *
 * Records referenced via informed_by but NOT present in the local mirror
 * are surfaced as `dangling` entries: the verifier hasn't seen the upstream
 * locally. This is informational, not a failure — the upstream may live on
 * the public log but not in the agent's local mirror.
 *
 * Forward-walk (records that reference THIS record via informed_by) is
 * out of scope for v1; it requires either a full-mirror scan per call
 * (acceptable but slower) or the graph service. v1 is backward-only;
 * forward-walk arrives in v2.
 */

import type { IndexedRecord } from './storage.js'
import type { AtribRecord } from '@atrib/mcp'

export type TraceDirection = 'backward'

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
