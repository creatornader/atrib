// SPDX-License-Identifier: Apache-2.0

/**
 * The calculation algorithm (§4.6). pure function from
 * (graph, policy, sessionPolicyRecord?) → distribution.
 *
 * INVARIANT: This function is deterministic. Two runs on identical input
 * MUST produce identical output bit-for-bit. No network calls. No timestamps
 * beyond what's in the records. No randomness. No iteration order dependencies.
 */

import type {
  Distribution,
  EdgeType,
  GraphNode,
  GraphResponse,
  Modifier,
  PolicyConstraints,
  PolicyDocument,
  SessionPolicyRecord,
} from './types.js'

/**
 * §4.6.1 / §4.2 / §4.5.2 Rule 6: validate a policy document.
 * Returns true iff the policy is structurally usable for calculation.
 *
 * Reasons a policy fails validation:
 * - missing or wrong spec_version
 * - contradictory constraints (minimum_share > maximum_share)
 * - any negative constraint value
 * - any negative edge weight
 */
export function isValidPolicy(policy: unknown): policy is PolicyDocument {
  if (!policy || typeof policy !== 'object') return false
  const p = policy as Record<string, unknown>
  if (p.spec_version !== 'atrib/1.0') return false

  if (p.edge_weights !== undefined) {
    if (typeof p.edge_weights !== 'object' || p.edge_weights === null) return false
    for (const v of Object.values(p.edge_weights as Record<string, unknown>)) {
      if (typeof v !== 'number' || v < 0 || Number.isNaN(v)) return false
    }
  }

  if (p.constraints !== undefined) {
    if (typeof p.constraints !== 'object' || p.constraints === null) return false
    const c = p.constraints as Record<string, unknown>
    for (const v of Object.values(c)) {
      if (v !== undefined && (typeof v !== 'number' || v < 0 || Number.isNaN(v))) return false
    }
    const minShare = c.minimum_share as number | undefined
    const maxShare = c.maximum_share as number | undefined
    if (minShare !== undefined && maxShare !== undefined && minShare > maxShare) return false
  }

  return true
}

/** §4.3 default policy. */
export const DEFAULT_POLICY: PolicyDocument = {
  spec_version: 'atrib/1.0',
  policy_id: 'https://atrib.dev/policies/default/v1',
  role: 'default',
  edge_weights: {
    CHAIN_PRECEDES: 1.0,
    SESSION_PRECEDES: 1.0,
    SESSION_PARALLEL: 1.0,
    CONVERGES_ON: 1.0,
    CROSS_SESSION: 1.0,
    unsigned: 0.0,
  },
  modifiers: [],
  distribution: 'proportional',
  constraints: {},
}

/**
 * Run the full calculation pipeline (§4.6 closing pseudocode).
 *
 * @param graph. graph snapshot for the session
 * @param policy. agreed policy document
 * @param sessionPolicyRecord. optional; provides per-creator floors (§4.6.7)
 * @returns final distribution (creator_key → share, sums to 1.0 ± 1e-9)
 */
export function calculate(
  graph: GraphResponse,
  policy: PolicyDocument,
  sessionPolicyRecord?: SessionPolicyRecord | null,
): Distribution {
  // §4.6.1: precondition. must have at least one transaction node
  const txNode = graph.nodes.find((n) => n.event_type === 'transaction')
  if (!txNode) {
    return {}
  }

  // §4.6.1: "P is a valid v1 policy document per the schema in §4.2. If
  // validation fails, use the default policy."
  const validatedPolicy = isValidPolicy(policy) ? policy : DEFAULT_POLICY

  // Step 1: identify contributing nodes
  const contributing = identifyContributingNodes(graph)

  // Step 2: compute raw scores
  const rawScores = new Map<string, number>()
  for (const node of contributing) {
    rawScores.set(node.id, rawScore(node, graph, validatedPolicy, txNode))
  }

  // Step 3: apply node-level constraints (per-node floor/cap on normalized fractions)
  const constrained = applyConstraints(rawScores, validatedPolicy.constraints ?? {})

  // Step 4: re-normalize
  const normalized = finalNormalize(constrained)

  // Step 5: aggregate by creator
  const byCreator = aggregateByCreator(normalized, graph)

  // Step 6: apply per-creator floors from session policy record
  const creatorFloors = sessionPolicyRecord?.applied_constraints.minimum_floors ?? {}
  const floored = applyCreatorFloors(byCreator, creatorFloors)

  // Final renormalization, then convert Map → sorted plain object for determinism
  return distributionFromMap(finalNormalize(floored))
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.6.2. Step 1: identify contributing nodes
// ─────────────────────────────────────────────────────────────────────────────

function identifyContributingNodes(graph: GraphResponse): GraphNode[] {
  // A contributing node is non-transaction (tool_call or gap_node) AND has
  // an edge to a transaction node (CONVERGES_ON or CROSS_SESSION).
  const txNodeIds = new Set(
    graph.nodes.filter((n) => n.event_type === 'transaction').map((n) => n.id),
  )
  const hasEdgeToTx = new Set<string>()
  for (const edge of graph.edges) {
    if (
      (edge.type === 'CONVERGES_ON' || edge.type === 'CROSS_SESSION') &&
      txNodeIds.has(edge.target)
    ) {
      hasEdgeToTx.add(edge.source)
    }
  }
  // Sort by id for deterministic iteration
  return graph.nodes
    .filter((n) => n.event_type !== 'transaction' && hasEdgeToTx.has(n.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.6.3. Step 2: raw scores
// ─────────────────────────────────────────────────────────────────────────────

function rawScore(
  node: GraphNode,
  graph: GraphResponse,
  policy: PolicyDocument,
  txNode: GraphNode,
): number {
  const weights = policy.edge_weights ?? {}

  // Step 2a: base weight from edge type
  let base: number
  if (node.event_type === 'gap_node') {
    base = weights.unsigned ?? 0.0
  } else {
    // Collect all edge types on paths from this node leading to a transaction
    const edgeTypes = collectEdgeTypesToTransaction(node.id, graph)
    if (edgeTypes.size === 0) {
      base = 0.0
    } else {
      // §4.2.2 / §4.6.3: max() over all applicable edge weights
      let max = -Infinity
      for (const t of edgeTypes) {
        const w = (weights as Record<string, number | undefined>)[t] ?? 0.0
        if (w > max) max = w
      }
      base = max === -Infinity ? 0.0 : max
    }
  }

  // Step 2b: apply modifiers in declared order
  let score = base
  for (const modifier of policy.modifiers ?? []) {
    score = applyModifier(modifier, score, node, graph, txNode)
  }

  return score < 0 ? 0 : score
}

/**
 * Collect every edge type that appears on any directed/undirected path from
 * `nodeId` to any transaction node, including the direct CONVERGES_ON and
 * CROSS_SESSION edges from the node itself.
 *
 * Per §4.6.3: "edge_types = {e.type for e in G.edges where e.source == n.id
 * and G.nodes[e.target].event_type == 'transaction'}; also include
 * CHAIN_PRECEDES and SESSION_* edges between non-transaction nodes that form
 * a path leading to a transaction node"
 */
function collectEdgeTypesToTransaction(nodeId: string, graph: GraphResponse): Set<EdgeType> {
  const txNodeIds = new Set(
    graph.nodes.filter((n) => n.event_type === 'transaction').map((n) => n.id),
  )
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

  // Traversal: BFS from nodeId following ANY outgoing edge (including
  // SESSION_PARALLEL undirected, plus reverse direction which we treat as
  // outgoing for path-finding). Collect every edge type encountered on
  // edges that participate in a path reaching a transaction node.
  //
  // Implementation strategy: do a forward reachability search to find which
  // nodes can reach a transaction. Then any edge whose source is in that set
  // and whose path continues toward a transaction contributes its type.
  //
  // Simpler exact approach: for any node N, the edge types on N's "path to
  // transaction" are the union of:
  //   1. types of edges directly from N (or undirected involving N) whose
  //      other endpoint can reach a transaction (or IS a transaction)
  //   2. recursively, the path types from the next hop
  //
  // We compute this iteratively as a fixed-point set per node.

  // Build adjacency: for each node, list (edgeType, neighborId) for both
  // directed-out and undirected edges.
  const adj = new Map<string, Array<{ type: EdgeType; to: string }>>()
  for (const node of graph.nodes) adj.set(node.id, [])
  for (const edge of graph.edges) {
    adj.get(edge.source)?.push({ type: edge.type, to: edge.target })
    if (!edge.directed) {
      adj.get(edge.target)?.push({ type: edge.type, to: edge.source })
    }
  }

  // BFS forward from nodeId; collect edge types whose target either is a
  // transaction node OR can reach a transaction.
  // First compute "can reach transaction" set via reverse BFS from tx nodes.
  const canReachTx = new Set<string>(txNodeIds)
  const reverseAdj = new Map<string, string[]>()
  for (const node of graph.nodes) reverseAdj.set(node.id, [])
  for (const edge of graph.edges) {
    reverseAdj.get(edge.target)?.push(edge.source)
    if (!edge.directed) reverseAdj.get(edge.source)?.push(edge.target)
  }
  const reverseQueue: string[] = [...txNodeIds]
  while (reverseQueue.length > 0) {
    const curr = reverseQueue.shift()!
    for (const pred of reverseAdj.get(curr) ?? []) {
      if (!canReachTx.has(pred)) {
        canReachTx.add(pred)
        reverseQueue.push(pred)
      }
    }
  }

  // Now BFS forward from nodeId, collecting edge types on edges whose target
  // can reach a transaction.
  const collected = new Set<EdgeType>()
  const visited = new Set<string>([nodeId])
  const queue: string[] = [nodeId]
  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const { type, to } of adj.get(curr) ?? []) {
      // Only count edges that participate in a transaction-reaching path
      if (!canReachTx.has(to)) continue
      // Skip edges leading to non-transaction nodes that still can reach tx,
      // but include the edge type. Also include edges directly to tx nodes.
      // Per §4.6.3, we collect both direct CONVERGES_ON edges and chain/session
      // edges on paths leading to tx.
      const targetNode = nodeMap.get(to)
      if (!targetNode) continue
      collected.add(type)
      if (targetNode.event_type !== 'transaction' && !visited.has(to)) {
        visited.add(to)
        queue.push(to)
      }
    }
  }
  return collected
}

function applyModifier(
  modifier: Modifier,
  score: number,
  node: GraphNode,
  graph: GraphResponse,
  txNode: GraphNode,
): number {
  if (modifier.type === 'temporal_decay') {
    const halfLifeMs = (modifier as { half_life_ms: number }).half_life_ms
    const deltaMs = txNode.timestamp - node.timestamp
    if (deltaMs < 0) return 0.0
    return score * Math.pow(2.0, -(deltaMs / halfLifeMs))
  }
  if (modifier.type === 'chain_depth_penalty') {
    const penaltyPerLevel = (modifier as { penalty_per_level: number }).penalty_per_level
    const depth = shortestChainPath(node.id, graph)
    const factor = Math.max(0.0, 1.0 - depth * penaltyPerLevel)
    return score * factor
  }
  if (modifier.type === 'call_count_boost') {
    const m = modifier as { multiplier_per_call: number; cap: number }
    const count = countNodesWithSameContentId(node.content_id, graph)
    const factor = Math.min(m.cap, 1.0 + (count - 1) * m.multiplier_per_call)
    return score * factor
  }
  // Unknown modifier types are ignored (§4.6.3)
  return score
}

function shortestChainPath(nodeId: string, graph: GraphResponse): number {
  // Hops via CHAIN_PRECEDES from this node to nearest transaction.
  // Build chain-only adjacency.
  const chainAdj = new Map<string, string[]>()
  for (const node of graph.nodes) chainAdj.set(node.id, [])
  for (const edge of graph.edges) {
    if (edge.type === 'CHAIN_PRECEDES') {
      chainAdj.get(edge.source)?.push(edge.target)
    }
  }
  const txIds = new Set(graph.nodes.filter((n) => n.event_type === 'transaction').map((n) => n.id))
  // BFS
  const visited = new Set<string>([nodeId])
  type Step = { id: string; depth: number }
  const queue: Step[] = [{ id: nodeId, depth: 0 }]
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (txIds.has(id)) return depth
    for (const next of chainAdj.get(id) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push({ id: next, depth: depth + 1 })
      }
    }
  }
  // No chain path to a transaction. return a large depth to fully penalize
  return Number.MAX_SAFE_INTEGER
}

function countNodesWithSameContentId(contentId: string | null, graph: GraphResponse): number {
  if (!contentId) return 1
  let count = 0
  for (const n of graph.nodes) {
    if (n.content_id === contentId) count++
  }
  return count
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.6.4. Step 3: apply constraints
// ─────────────────────────────────────────────────────────────────────────────

function applyConstraints(
  rawScores: Map<string, number>,
  constraints: PolicyConstraints,
): Map<string, number> {
  // Filter to positive contributors
  const contributors = new Map<string, number>()
  for (const [id, score] of rawScores) {
    if (score > 0) contributors.set(id, score)
  }
  if (contributors.size === 0) return new Map()

  // Initial proportional pass
  let total = 0
  for (const s of contributors.values()) total += s
  let normalized = new Map<string, number>()
  for (const [id, s] of contributors) normalized.set(id, s / total)

  if (constraints.minimum_share !== undefined) {
    normalized = applyMinimumFloor(normalized, constraints.minimum_share)
  }
  if (constraints.maximum_share !== undefined) {
    normalized = applyMaximumCap(normalized, constraints.maximum_share)
  }

  return normalized
}

function applyMinimumFloor(normalized: Map<string, number>, floor: number): Map<string, number> {
  const below = new Map<string, number>()
  const above = new Map<string, number>()
  for (const [id, s] of normalized) {
    if (s < floor) below.set(id, s)
    else above.set(id, s)
  }
  let boostNeeded = 0
  for (const s of below.values()) boostNeeded += floor - s
  let aboveTotal = 0
  for (const s of above.values()) aboveTotal += s

  const result = new Map<string, number>()
  if (aboveTotal <= boostNeeded) {
    // Equal-distribution fallback
    const equal = 1.0 / normalized.size
    for (const id of normalized.keys()) result.set(id, equal)
    return result
  }
  const scale = (aboveTotal - boostNeeded) / aboveTotal
  for (const id of below.keys()) result.set(id, floor)
  for (const [id, s] of above) result.set(id, s * scale)
  return result
}

function applyMaximumCap(normalized: Map<string, number>, cap: number): Map<string, number> {
  // Iterate until no entries exceed cap. Each pass caps at least one new
  // entry, so the loop terminates in at most N passes. A safety bound
  // prevents infinite loops if redistribution ping-pongs between entries
  // (possible when cap * N < 1.0 and excess can't be absorbed).
  let current = normalized
  const maxIters = normalized.size + 1
  for (let iter = 0; iter < maxIters; iter++) {
    const above = new Map<string, number>()
    const below = new Map<string, number>()
    for (const [id, s] of current) {
      if (s > cap) above.set(id, s)
      else below.set(id, s)
    }
    if (above.size === 0) return current

    let excess = 0
    for (const s of above.values()) excess += s - cap
    let belowTotal = 0
    for (const s of below.values()) belowTotal += s

    const result = new Map<string, number>()
    for (const id of above.keys()) result.set(id, cap)
    if (belowTotal > 0) {
      const scale = (belowTotal + excess) / belowTotal
      for (const [id, s] of below) result.set(id, s * scale)
    } else {
      for (const [id, s] of below) result.set(id, s)
    }
    current = result
  }
  // Safety: if we exhaust iterations (ping-pong), cap everyone at cap
  // and let finalNormalize handle the sum.
  const result = new Map<string, number>()
  for (const [id, s] of current) result.set(id, Math.min(s, cap))
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.6.5. Step 4: final normalize
// ─────────────────────────────────────────────────────────────────────────────

function finalNormalize<K>(shares: Map<K, number>): Map<K, number> {
  let total = 0
  for (const s of shares.values()) total += s
  // Guard against zero, near-zero (denormalized), and NaN totals
  if (!Number.isFinite(total) || total <= 0) return new Map()
  const result = new Map<K, number>()
  for (const [k, s] of shares) {
    const normalized = s / total
    // Guard against NaN/Infinity from division of very small numbers
    result.set(k, Number.isFinite(normalized) ? normalized : 0)
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.6.6. Step 5: aggregate by creator
// ─────────────────────────────────────────────────────────────────────────────

function aggregateByCreator(
  normalized: Map<string, number>,
  graph: GraphResponse,
): Map<string, number> {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))
  const byCreator = new Map<string, number>()
  // Sort node ids for deterministic accumulation order
  const sortedIds = [...normalized.keys()].sort()
  for (const id of sortedIds) {
    const share = normalized.get(id)!
    const node = nodeMap.get(id)
    if (!node) continue
    const key = node.creator_key ?? '__unsigned__'
    byCreator.set(key, (byCreator.get(key) ?? 0) + share)
  }
  return byCreator
}

// ─────────────────────────────────────────────────────────────────────────────
// §4.6.7. Step 6: apply creator floors
// ─────────────────────────────────────────────────────────────────────────────

function applyCreatorFloors(
  byCreator: Map<string, number>,
  creatorFloors: Record<string, number>,
): Map<string, number> {
  const floorEntries = Object.entries(creatorFloors)
  if (floorEntries.length === 0) return byCreator

  const result = new Map(byCreator)
  const flooredKeys = new Set<string>()

  // Identify creators below their floor (sorted for determinism)
  for (const [key, floor] of floorEntries.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!result.has(key)) continue
    if ((result.get(key) ?? 0) < floor) flooredKeys.add(key)
  }
  if (flooredKeys.size === 0) return result

  let boostNeeded = 0
  for (const k of flooredKeys) boostNeeded += creatorFloors[k]! - (result.get(k) ?? 0)
  const nonFloored = new Map<string, number>()
  for (const [k, v] of result) {
    if (!flooredKeys.has(k)) nonFloored.set(k, v)
  }
  let nonFlooredTotal = 0
  for (const v of nonFloored.values()) nonFlooredTotal += v

  if (nonFlooredTotal <= boostNeeded) {
    // Cannot honor. should have been caught at negotiation. Return unchanged.
    return result
  }

  const scale = (nonFlooredTotal - boostNeeded) / nonFlooredTotal
  // Use sorted iteration to keep result construction deterministic
  for (const k of [...flooredKeys].sort()) {
    result.set(k, creatorFloors[k]!)
  }
  for (const [k, v] of [...nonFloored.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    result.set(k, v * scale)
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for converting Map → plain Distribution object (for output)
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a Map<creator_key, share> to a sorted plain object distribution. */
function distributionFromMap(map: Map<string, number>): Distribution {
  const result: Distribution = {}
  // Sort keys for deterministic JSON ordering
  for (const k of [...map.keys()].sort()) {
    result[k] = map.get(k)!
  }
  return result
}
