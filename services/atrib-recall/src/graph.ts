// SPDX-License-Identifier: Apache-2.0

/**
 * Local graph derivation + BFS for the recall semantic surface.
 *
 * Wires the §3.2.4 derived-graph shape that the recall_walk handler and
 * the rank_by='causal_distance' path need, but scoped to the four
 * edge types for "what records causally inform this one":
 *
 *   CHAIN_PRECEDES (weight 1): direct chain link.
 *     chain_root != genesisChainRoot(context_id) implies a prior record
 *     whose canonical hash equals chain_root sans "sha256:" prefix.
 *
 *   INFORMED_BY (weight 1): explicit record-to-record reference (D041).
 *     Records carry an `informed_by` field whose entries are record_hashes
 *     of records consulted during construction.
 *
 *   ANNOTATES (weight 2): an annotation record points at a target record
 *     (D058). Edge runs annotation -> target.
 *
 *   REVISES (weight 2): a revision record supersedes a target record
 *     (D059). Edge runs revision -> target.
 *
 * Weights come from the Layer 1 design: direct causality (chain +
 * informed_by) is weight 1; annotation/revision relationships are
 * weight 2 (less direct: the agent's later judgment on a record vs the
 * record's own causal inputs).
 *
 * SESSION_PRECEDES + SESSION_PARALLEL + CONVERGES_ON + CROSS_SESSION
 * are deliberately omitted at Layer 1. They encode temporal/sibling
 * structure, not causal-ancestor structure, useful for the public
 * graph-node /v1/graph view but not for "what should the agent re-read
 * before re-attempting a similar action". The graph-node service
 * (services/graph-node/src/graph-builder.ts) is the spec-faithful
 * full §3.2.4 derivation; this module is its Layer 1 subset.
 *
 * PROVENANCE_OF (D044) is also omitted at Layer 1, it operates on the
 * cross-session genesis anchor via a 16-byte-truncated token, which
 * doesn't compose naturally with the within-mirror BFS path. A future
 * release that wires cross-session PROVENANCE_OF onto provenance_token
 * inputs would extend this graph.
 *
 * The graph is built once per recall() call from the LoadedRecord array
 * and discarded; no caching. Layer 2 (sqlite-vec sidecar) materializes
 * the graph alongside the embedding store.
 */

import { genesisChainRoot } from '@atrib/mcp'
import type {
  AtribRecord,
} from '@atrib/mcp'
import type { LoadedRecord } from './aggregations.js'

export type EdgeType = 'CHAIN_PRECEDES' | 'INFORMED_BY' | 'ANNOTATES' | 'REVISES'

/**
 * Layer 1 BFS edge weights. Direct causal links (CHAIN_PRECEDES,
 * INFORMED_BY) are weight 1; annotation/revision relationships are
 * weight 2. The recall_walk handler accepts an edge_types filter that
 * intersects with these four; weights apply only when an edge type
 * passes the filter.
 */
export const EDGE_WEIGHTS: Record<EdgeType, number> = {
  CHAIN_PRECEDES: 1,
  INFORMED_BY: 1,
  ANNOTATES: 2,
  REVISES: 2,
}

export type GraphEdge = {
  type: EdgeType
  target: string
  weight: number
}

/**
 * Undirected adjacency. For each record_hash, the value is the list of
 * edges out of that record_hash. CHAIN_PRECEDES and INFORMED_BY edges
 * are emitted in both directions (the BFS is for "how close is X to
 * anchor", which is symmetric); ANNOTATES and REVISES likewise.
 */
export type LocalGraph = Map<string, GraphEdge[]>

/**
 * Build the local Layer 1 graph from loaded records. Returns adjacency
 * map keyed by record_hash. Records present in the loaded set but with
 * no incident edges still appear as map keys with empty arrays, this
 * keeps the BFS path consistent (graph.has(anchor) is still true even
 * when the anchor has no neighbors).
 *
 * Time complexity: O(N) for the chain index pass + O(E) for edge
 * emission. N = loaded.length, E = sum of informed_by entries + chain
 * links + annotation+revision edges.
 */
export function buildLocalGraph(loaded: LoadedRecord[]): LocalGraph {
  const graph: LocalGraph = new Map()
  for (const lr of loaded) {
    if (!graph.has(lr.record_hash)) graph.set(lr.record_hash, [])
  }
  const addEdge = (from: string, edge: GraphEdge) => {
    const list = graph.get(from)
    if (list) list.push(edge)
    else graph.set(from, [edge])
  }
  const addUndirected = (a: string, b: string, type: EdgeType) => {
    const weight = EDGE_WEIGHTS[type]
    addEdge(a, { type, target: b, weight })
    addEdge(b, { type, target: a, weight })
  }

  // Index by canonical-hash-hex so CHAIN_PRECEDES lookups (chain_root
  // sans "sha256:") can resolve to the prior record's record_hash.
  const byHashHex = new Map<string, string>() // hex -> record_hash form
  for (const lr of loaded) {
    const hex = lr.record_hash.startsWith('sha256:')
      ? lr.record_hash.slice('sha256:'.length)
      : lr.record_hash
    byHashHex.set(hex, lr.record_hash)
  }

  for (const lr of loaded) {
    // CHAIN_PRECEDES: skip genesis records (chain_root == genesisChainRoot(context_id)).
    const genesis = genesisChainRoot(lr.record.context_id)
    if (lr.record.chain_root !== genesis) {
      const expected = lr.record.chain_root.startsWith('sha256:')
        ? lr.record.chain_root.slice('sha256:'.length)
        : lr.record.chain_root
      const prior = byHashHex.get(expected)
      if (prior) {
        addUndirected(lr.record_hash, prior, 'CHAIN_PRECEDES')
      }
    }

    // INFORMED_BY: explicit references.
    const informedBy = (lr.record as AtribRecord & { informed_by?: unknown }).informed_by
    if (Array.isArray(informedBy)) {
      for (const ref of informedBy) {
        if (typeof ref !== 'string') continue
        // Only emit when the referenced record is present in the mirror.
        // Cross-mirror references will be resolved by Layer 2 (cache or
        // log-side lookup) once that ships.
        if (graph.has(ref) || byHashHex.has(stripPrefix(ref))) {
          addUndirected(lr.record_hash, ref, 'INFORMED_BY')
        }
      }
    }

    // ANNOTATES: annotation record -> target. content.annotates lives in
    // _local.content on a D062 envelope; bare-record annotations have no
    // body to read (the §8.1 posture); skip those.
    if (lr.content && typeof lr.content === 'object') {
      const c = lr.content as { annotates?: unknown; revises?: unknown }
      if (
        typeof c.annotates === 'string' &&
        lr.record.event_type === 'https://atrib.dev/v1/types/annotation'
      ) {
        addUndirected(lr.record_hash, c.annotates, 'ANNOTATES')
      }
      if (
        typeof c.revises === 'string' &&
        lr.record.event_type === 'https://atrib.dev/v1/types/revision'
      ) {
        addUndirected(lr.record_hash, c.revises, 'REVISES')
      }
    }
  }
  return graph
}

function stripPrefix(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice('sha256:'.length) : hash
}

/**
 * BFS-shortest-path distances from `start` over the local graph.
 * Returns a map record_hash -> distance (weighted). Records with no path
 * to `start` are omitted (rather than mapped to Infinity) so callers
 * iterate only reachable nodes.
 *
 * The traversal honors `edgeTypes` when provided: only edges whose type
 * is in the set are followed. When edgeTypes is undefined or empty,
 * ALL edge types are followed.
 *
 * `maxDepth` caps the traversal at that hop-count (NOT cumulative
 * weight). Set to Infinity (the default) to traverse the full reachable
 * subgraph. Useful for recall_walk's depth parameter.
 *
 * Since edge weights differ (1 or 2), the traversal uses Dijkstra (with
 * a simple O(V^2) min-extraction since the candidate sets are small at
 * Layer 1). This produces correct shortest paths in weighted graphs.
 */
export function shortestDistances(
  graph: LocalGraph,
  start: string,
  edgeTypes?: Set<EdgeType>,
  maxHops: number = Number.POSITIVE_INFINITY,
): Map<string, number> {
  if (!graph.has(start)) return new Map()
  const dist = new Map<string, number>()
  const hops = new Map<string, number>()
  dist.set(start, 0)
  hops.set(start, 0)
  const visited = new Set<string>()
  while (true) {
    // O(V) min extraction. Layer 1 graphs are small (hundreds of
    // records); a heap is overkill.
    let node: string | undefined
    let minDist = Number.POSITIVE_INFINITY
    for (const [k, d] of dist) {
      if (visited.has(k)) continue
      if (d < minDist) {
        minDist = d
        node = k
      }
    }
    if (node === undefined) break
    visited.add(node)
    const nodeHops = hops.get(node) ?? 0
    if (nodeHops >= maxHops) continue
    for (const edge of graph.get(node) ?? []) {
      if (edgeTypes && edgeTypes.size > 0 && !edgeTypes.has(edge.type)) continue
      const candidate = minDist + edge.weight
      const existing = dist.get(edge.target)
      if (existing === undefined || candidate < existing) {
        dist.set(edge.target, candidate)
        hops.set(edge.target, nodeHops + 1)
      }
    }
  }
  return dist
}

/**
 * Walk the graph from `start`, returning every reachable record_hash
 * within `maxHops` hops, filtered to the requested edge_types. Result
 * is sorted by ascending distance from start. Used by the recall_walk
 * MCP tool to surface the local causal neighborhood of an anchor.
 */
export function walkFrom(
  graph: LocalGraph,
  start: string,
  edgeTypes?: Set<EdgeType>,
  maxHops: number = 3,
): Array<{ record_hash: string; distance: number }> {
  const dist = shortestDistances(graph, start, edgeTypes, maxHops)
  // Drop the start node itself (distance 0), the agent asked for
  // adjacent records, not a re-echo of the anchor.
  return [...dist.entries()]
    .filter(([h]) => h !== start)
    .map(([record_hash, distance]) => ({ record_hash, distance }))
    .sort((a, b) => a.distance - b.distance)
}
