// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory graph builder for the integration test.
 *
 * Implements the §3.2.4 edge derivation rules normatively. This is the
 * algorithm a graph indexing service (graph.atrib.dev) would run on log data.
 * Two implementations applying these rules to identical records MUST produce
 * identical edge sets.
 */

import { sha256, hexEncode, canonicalRecord, base64urlEncode, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import type { GraphNode, GraphEdge, GraphResponse, EdgeType, VerificationState } from '@atrib/verify'
import { graphLabelFromEventTypeUri } from '@atrib/verify'

/**
 * Compute the record hash (sha256 of JCS canonical form). same algorithm
 * @atrib/mcp uses to derive the chain_root reference and the propagation token.
 */
export function recordHash(record: AtribRecord): Uint8Array {
  return sha256(canonicalRecord(record))
}

/** Hex form of the record hash. */
export function recordHashHex(record: AtribRecord): string {
  return hexEncode(recordHash(record))
}

/**
 * Build a graph snapshot from a set of signed attribution records, applying
 * the 5 edge derivation steps from §3.2.4 in order.
 *
 * Each record's signature is verified at node-construction time so that
 * verification_state matches the @atrib/graph-node implementation. This
 * makes the function async; if every record's signature is known-good (the
 * common test path), buildGraphFromRecordsSync is a verification-skipping
 * fast path.
 */
export async function buildGraphFromRecords(
  records: AtribRecord[],
  contextId: string,
): Promise<GraphResponse> {
  // Filter to records belonging to this session OR linked via session_token
  const TOOL_CALL_URI = 'https://atrib.dev/v1/types/tool_call'
  const TRANSACTION_URI = 'https://atrib.dev/v1/types/transaction'

  const sessionRecords = records.filter((r) => r.context_id === contextId)
  const txInSession = sessionRecords.find((r) => r.event_type === TRANSACTION_URI)

  // Cross-session records: tool_calls in OTHER sessions whose session_token
  // matches the in-session transaction's session_token
  let crossSessionRecords: AtribRecord[] = []
  if (txInSession && 'session_token' in txInSession && txInSession.session_token) {
    const txToken = txInSession.session_token
    crossSessionRecords = records.filter((r) => {
      if (r.context_id === contextId) return false
      if (r.event_type !== TOOL_CALL_URI) return false
      return 'session_token' in r && r.session_token === txToken
    })
  }

  const allRecords = [...sessionRecords, ...crossSessionRecords]

  // Verify every record's signature in parallel so verification_state matches
  // the §3.2.4 reference implementation in @atrib/graph-node. Without this the
  // two implementations would silently disagree on tampered records.
  const verificationStates = await Promise.all(
    allRecords.map(async (r): Promise<VerificationState> => {
      try {
        const ok = await verifyRecord(r)
        return ok ? 'signature_valid' : 'unsigned'
      } catch {
        return 'unsigned'
      }
    }),
  )

  // Build the node list
  const nodes: GraphNode[] = allRecords.map((r, i) => {
    const id = `sha256:${recordHashHex(r)}`
    return {
      id,
      event_type: graphLabelFromEventTypeUri(r.event_type),
      event_type_uri: r.event_type,
      content_id: r.content_id,
      creator_key: r.creator_key,
      chain_root: r.chain_root,
      context_id: r.context_id,
      timestamp: r.timestamp,
      log_index: 0,
      verification_state: verificationStates[i]!,
      is_genesis:
        r.chain_root === `sha256:${hexEncode(sha256(new TextEncoder().encode(r.context_id)))}`,
    }
  })

  // Lookup helpers
  const idByRecord = new Map<AtribRecord, string>()
  allRecords.forEach((r, i) => idByRecord.set(r, nodes[i]!.id))
  const recordById = new Map<string, AtribRecord>()
  allRecords.forEach((r, i) => recordById.set(nodes[i]!.id, r))

  const edges: GraphEdge[] = []
  const has = (a: string, b: string, t: EdgeType) =>
    edges.some((e) => e.source === a && e.target === b && e.type === t)

  // Step 1. CHAIN_PRECEDES (§3.2.4 step 1)
  // For each non-genesis record R: find P such that sha256(jcs(P)) == R.chain_root_hash
  const hashToId = new Map<string, string>()
  for (const r of allRecords) {
    hashToId.set(recordHashHex(r), idByRecord.get(r)!)
  }
  for (const r of allRecords) {
    const expected = r.chain_root.replace(/^sha256:/, '')
    const parentId = hashToId.get(expected)
    if (parentId && parentId !== idByRecord.get(r)) {
      edges.push({
        type: 'CHAIN_PRECEDES',
        source: parentId,
        target: idByRecord.get(r)!,
        directed: true,
      })
    }
  }

  // Step 2. SESSION_PRECEDES (§3.2.4 step 2)
  // For each ordered pair (A,B) sharing context_id with no CHAIN_PRECEDES edge
  // in either direction: if A.timestamp < B.timestamp → SESSION_PRECEDES A → B
  const sessionOnly = sessionRecords
  for (let i = 0; i < sessionOnly.length; i++) {
    for (let j = 0; j < sessionOnly.length; j++) {
      if (i === j) continue
      const a = sessionOnly[i]!
      const b = sessionOnly[j]!
      const aId = idByRecord.get(a)!
      const bId = idByRecord.get(b)!
      if (has(aId, bId, 'CHAIN_PRECEDES') || has(bId, aId, 'CHAIN_PRECEDES')) continue
      if (a.timestamp < b.timestamp) {
        edges.push({ type: 'SESSION_PRECEDES', source: aId, target: bId, directed: true })
      }
    }
  }

  // Step 3. SESSION_PARALLEL (§3.2.4 step 3)
  // For each pair (A,B) with no CHAIN_PRECEDES and no SESSION_PRECEDES in either
  // direction: SESSION_PARALLEL A ↔ B (undirected)
  for (let i = 0; i < sessionOnly.length; i++) {
    for (let j = i + 1; j < sessionOnly.length; j++) {
      const a = sessionOnly[i]!
      const b = sessionOnly[j]!
      const aId = idByRecord.get(a)!
      const bId = idByRecord.get(b)!
      if (
        has(aId, bId, 'CHAIN_PRECEDES') ||
        has(bId, aId, 'CHAIN_PRECEDES') ||
        has(aId, bId, 'SESSION_PRECEDES') ||
        has(bId, aId, 'SESSION_PRECEDES')
      )
        continue
      edges.push({ type: 'SESSION_PARALLEL', source: aId, target: bId, directed: false })
    }
  }

  // Step 4. CONVERGES_ON (§3.2.4 step 4)
  // For each transaction T: every other in-session non-tx node N gets CONVERGES_ON N → T
  const sessionTxNodes = nodes.filter(
    (n) => n.event_type === 'transaction' && n.context_id === contextId,
  )
  for (const tx of sessionTxNodes) {
    for (const n of nodes) {
      if (n.event_type === 'transaction') continue
      if (n.context_id !== contextId) continue
      edges.push({ type: 'CONVERGES_ON', source: n.id, target: tx.id, directed: true })
    }
  }

  // Step 5. CROSS_SESSION (§3.2.4 step 5)
  // For each transaction T: search for tool_call A where A.context_id ≠ T.context_id
  // AND A.session_token === T.session_token (both must be present)
  for (const tx of sessionTxNodes) {
    const txRecord = recordById.get(tx.id)!
    const txToken = 'session_token' in txRecord ? txRecord.session_token : undefined
    if (!txToken) continue
    for (const r of allRecords) {
      if (r.event_type !== TOOL_CALL_URI) continue
      if (r.context_id === tx.context_id) continue
      if (!('session_token' in r) || r.session_token !== txToken) continue
      edges.push({
        type: 'CROSS_SESSION',
        source: idByRecord.get(r)!,
        target: tx.id,
        directed: true,
      })
    }
  }

  return {
    spec_version: 'atrib/1.0',
    context_id: contextId,
    generated_at: Date.now(),
    node_count: nodes.length,
    edge_count: edges.length,
    has_transaction: sessionTxNodes.length > 0,
    cross_session_count: crossSessionRecords.length,
    nodes,
    edges,
  }
}

// ────────────────────────────────────────────────────────────────────────
// buildGraphFromAllRecords, second §3.2.4 reference implementation.
//
// Mirrors graph-node's `buildGraph` signature: takes a flat record list
// spanning any number of context_ids, applies all 9 derivation steps in
// order, returns a GraphResponse. Unlike buildGraphFromRecords (which
// pre-filters by contextId for the 5-edge subset), this entry point
// covers every spec-mandated edge type including the four producer-claim
// edges (INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES) that span
// context_id boundaries.
//
// Two implementations applying these rules to identical records MUST
// produce identical edge sets per §3.2.4. This function exists so the
// cross-implementation conformance test in test/conformance-3.2.4.test.ts
// can exercise all 9 edges, not just the original 5. Without it, drift
// between graph-node and the conformance suite goes uncaught for the
// producer-claim layer (D041, D044, D058, D059).
// ────────────────────────────────────────────────────────────────────────

const ANNOTATION_URI = 'https://atrib.dev/v1/types/annotation'
const REVISION_URI = 'https://atrib.dev/v1/types/revision'

export interface BuildGraphFromAllRecordsOptions {
  includeCrossSession?: boolean
  /**
   * §3.4.1.1 intra-session edge compaction. When true, SESSION_PRECEDES /
   * SESSION_PARALLEL emission skips pairs in the same CHAIN_PRECEDES
   * connected component (chain encodes order) and emits only consecutive-
   * in-time pairs across components. Default false (full pairwise §3.2.4
   * step 2 / step 3 derivation). Mirrors graph-node's option of the same
   * name; both impls must agree for a given setting.
   */
  compactIntraSessionEdges?: boolean
}

export async function buildGraphFromAllRecords(
  records: AtribRecord[],
  options: BuildGraphFromAllRecordsOptions = {},
): Promise<GraphResponse> {
  const includeCrossSession = options.includeCrossSession ?? true
  const compact = options.compactIntraSessionEdges ?? false

  // Sort for determinism, same tiebreak as graph-node's buildGraph
  // (timestamp asc, then context_id, then content_id). Without this the
  // two implementations could emit edges in different orders on
  // ambiguous fixtures, surfacing as spurious test failures.
  const sorted = [...records].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    const aKey = `${a.context_id}:${a.content_id}`
    const bKey = `${b.context_id}:${b.content_id}`
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
  })

  const verificationStates = await Promise.all(
    sorted.map(async (r): Promise<VerificationState> => {
      try {
        const ok = await verifyRecord(r)
        return ok ? 'signature_valid' : 'unsigned'
      } catch {
        return 'unsigned'
      }
    }),
  )

  const nodes: GraphNode[] = sorted.map((r, i) => {
    const id = `sha256:${recordHashHex(r)}`
    return {
      id,
      event_type: graphLabelFromEventTypeUri(r.event_type),
      event_type_uri: r.event_type,
      content_id: r.content_id,
      creator_key: r.creator_key,
      chain_root: r.chain_root,
      context_id: r.context_id,
      timestamp: r.timestamp,
      log_index: null,
      verification_state: verificationStates[i]!,
      is_genesis:
        r.chain_root === `sha256:${hexEncode(sha256(new TextEncoder().encode(r.context_id)))}`,
    }
  })

  const idByRecord = new Map<AtribRecord, string>()
  sorted.forEach((r, i) => idByRecord.set(r, nodes[i]!.id))
  const recordById = new Map<string, AtribRecord>()
  sorted.forEach((r, i) => recordById.set(nodes[i]!.id, r))
  const hashToId = new Map<string, string>()
  for (const r of sorted) hashToId.set(recordHashHex(r), idByRecord.get(r)!)

  const edges: GraphEdge[] = []
  const chainPrecedesPairs = new Set<string>() // "sourceId->targetId"

  // Union-Find for §3.4.1.1 chain-component skip. Only used when compact=true.
  const chainParent = new Map<string, string>()
  const findChainRoot = (id: string): string => {
    let curr = id
    let parent = chainParent.get(curr)
    while (parent !== undefined && parent !== curr) {
      curr = parent
      parent = chainParent.get(curr)
    }
    return curr
  }
  const unionChain = (a: string, b: string): void => {
    const rootA = findChainRoot(a)
    const rootB = findChainRoot(b)
    if (rootA !== rootB) chainParent.set(rootA, rootB)
  }

  // Step 1. CHAIN_PRECEDES (§3.2.4 step 1)
  for (const node of nodes) {
    if (node.is_genesis) continue
    if (!node.chain_root) continue
    const expectedHash = node.chain_root.replace(/^sha256:/, '')
    const parentId = hashToId.get(expectedHash)
    if (parentId) {
      edges.push({ type: 'CHAIN_PRECEDES', source: parentId, target: node.id, directed: true })
      chainPrecedesPairs.add(`${parentId}->${node.id}`)
      chainPrecedesPairs.add(`${node.id}->${parentId}`)
      if (compact) unionChain(parentId, node.id)
    }
  }

  // Group by context_id once for steps 2-4.
  const byContext = new Map<string, GraphNode[]>()
  for (const n of nodes) {
    const list = byContext.get(n.context_id) ?? []
    list.push(n)
    byContext.set(n.context_id, list)
  }

  // Step 2. SESSION_PRECEDES (§3.2.4 step 2)
  const sessionPrecedesPairs = new Set<string>()
  if (compact) {
    for (const ctxNodes of byContext.values()) {
      const ts = [...ctxNodes].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
      for (let i = 0; i < ts.length - 1; i++) {
        const a = ts[i]!
        const b = ts[i + 1]!
        if (a.timestamp >= b.timestamp) continue
        const pairKey = `${a.id}->${b.id}`
        const reversePairKey = `${b.id}->${a.id}`
        if (chainPrecedesPairs.has(pairKey) || chainPrecedesPairs.has(reversePairKey)) continue
        if (findChainRoot(a.id) === findChainRoot(b.id)) continue
        edges.push({ type: 'SESSION_PRECEDES', source: a.id, target: b.id, directed: true })
        sessionPrecedesPairs.add(pairKey)
        sessionPrecedesPairs.add(reversePairKey)
      }
    }
  } else {
    for (const ctxNodes of byContext.values()) {
      for (let i = 0; i < ctxNodes.length; i++) {
        for (let j = i + 1; j < ctxNodes.length; j++) {
          const a = ctxNodes[i]!
          const b = ctxNodes[j]!
          const pairKey = `${a.id}->${b.id}`
          const reversePairKey = `${b.id}->${a.id}`
          if (chainPrecedesPairs.has(pairKey) || chainPrecedesPairs.has(reversePairKey)) continue
          if (a.timestamp < b.timestamp) {
            edges.push({ type: 'SESSION_PRECEDES', source: a.id, target: b.id, directed: true })
            sessionPrecedesPairs.add(pairKey)
            sessionPrecedesPairs.add(reversePairKey)
          } else if (b.timestamp < a.timestamp) {
            edges.push({ type: 'SESSION_PRECEDES', source: b.id, target: a.id, directed: true })
            sessionPrecedesPairs.add(pairKey)
            sessionPrecedesPairs.add(reversePairKey)
          }
        }
      }
    }
  }

  // Step 3. SESSION_PARALLEL (§3.2.4 step 3)
  if (compact) {
    for (const ctxNodes of byContext.values()) {
      const byTs = new Map<number, GraphNode[]>()
      for (const n of ctxNodes) {
        const list = byTs.get(n.timestamp) ?? []
        list.push(n)
        byTs.set(n.timestamp, list)
      }
      for (const peers of byTs.values()) {
        if (peers.length < 2) continue
        for (let i = 0; i < peers.length; i++) {
          for (let j = i + 1; j < peers.length; j++) {
            const a = peers[i]!
            const b = peers[j]!
            const pairKey = `${a.id}->${b.id}`
            const reversePairKey = `${b.id}->${a.id}`
            if (chainPrecedesPairs.has(pairKey) || chainPrecedesPairs.has(reversePairKey)) continue
            if (sessionPrecedesPairs.has(pairKey) || sessionPrecedesPairs.has(reversePairKey)) continue
            if (findChainRoot(a.id) === findChainRoot(b.id)) continue
            edges.push({ type: 'SESSION_PARALLEL', source: a.id, target: b.id, directed: false })
          }
        }
      }
    }
  } else {
    for (const ctxNodes of byContext.values()) {
      for (let i = 0; i < ctxNodes.length; i++) {
        for (let j = i + 1; j < ctxNodes.length; j++) {
          const a = ctxNodes[i]!
          const b = ctxNodes[j]!
          const pairKey = `${a.id}->${b.id}`
          const reversePairKey = `${b.id}->${a.id}`
          if (chainPrecedesPairs.has(pairKey) || chainPrecedesPairs.has(reversePairKey)) continue
          if (sessionPrecedesPairs.has(pairKey) || sessionPrecedesPairs.has(reversePairKey)) continue
          edges.push({ type: 'SESSION_PARALLEL', source: a.id, target: b.id, directed: false })
        }
      }
    }
  }

  // Step 4. CONVERGES_ON (§3.2.4 step 4)
  for (const ctxNodes of byContext.values()) {
    const txNodes = ctxNodes.filter((n) => n.event_type === 'transaction')
    const others = ctxNodes.filter((n) => n.event_type !== 'transaction')
    for (const tx of txNodes) {
      for (const other of others) {
        edges.push({ type: 'CONVERGES_ON', source: other.id, target: tx.id, directed: true })
      }
    }
  }

  // Step 5. CROSS_SESSION (§3.2.4 step 5)
  if (includeCrossSession) {
    const txNodes = nodes.filter((n) => n.event_type === 'transaction')
    for (const tx of txNodes) {
      const txRecord = recordById.get(tx.id)
      if (!txRecord || !('session_token' in txRecord) || !txRecord.session_token) continue
      const txToken = txRecord.session_token
      for (const other of nodes) {
        if (other.context_id === tx.context_id) continue
        if (other.event_type !== 'tool_call') continue
        const otherRecord = recordById.get(other.id)
        if (!otherRecord || !('session_token' in otherRecord)) continue
        if (otherRecord.session_token !== txToken) continue
        edges.push({ type: 'CROSS_SESSION', source: other.id, target: tx.id, directed: true })
      }
    }
  }

  // Lazy creation of synthetic dangling nodes for unresolved INFORMED_BY /
  // PROVENANCE_OF / ANNOTATES / REVISES references. Mirrors graph-node's
  // ensureDanglingNode pattern.
  const ensureDanglingNode = (id: string): void => {
    if (idByRecord.size > 0 && [...recordById.keys()].includes(id)) return
    if (nodes.some((n) => n.id === id)) return
    nodes.push({
      id,
      event_type: 'dangling_node',
      event_type_uri: null,
      content_id: null,
      creator_key: null,
      chain_root: null,
      context_id: '',
      timestamp: 0,
      log_index: null,
      verification_state: 'unsigned',
      is_genesis: false,
    })
  }

  // Step 6. INFORMED_BY (§3.2.4 step 6, D041)
  for (const r of sorted) {
    const informedBy = (r as { informed_by?: unknown }).informed_by
    if (!Array.isArray(informedBy) || informedBy.length === 0) continue
    const sourceId = idByRecord.get(r)!
    for (const ref of informedBy) {
      if (typeof ref !== 'string' || !ref.startsWith('sha256:')) continue
      const refHash = ref.slice('sha256:'.length)
      const targetId = hashToId.get(refHash)
      if (targetId) {
        edges.push({ type: 'INFORMED_BY', source: sourceId, target: targetId, directed: true })
      } else {
        const danglingId = `dangling:${ref}`
        ensureDanglingNode(danglingId)
        edges.push({
          type: 'INFORMED_BY',
          source: sourceId,
          target: danglingId,
          directed: true,
          dangling: true,
        })
      }
    }
  }

  // Step 7. PROVENANCE_OF (§3.2.4 step 7, D044)
  // For each session-genesis record D carrying provenance_token T, find any
  // record U where the first 16 bytes of sha256(jcs(U)) match T AND U lives
  // in a different context_id. D → U reads "D's session descends from U's
  // anchor." Non-genesis records carrying provenance_token are malformed
  // per §1.2.6 and excluded.
  for (const r of sorted) {
    const provenanceToken = (r as { provenance_token?: unknown }).provenance_token
    if (typeof provenanceToken !== 'string' || provenanceToken.length === 0) continue
    const expectedGenesis = `sha256:${hexEncode(sha256(new TextEncoder().encode(r.context_id)))}`
    if (r.chain_root !== expectedGenesis) continue
    const sourceId = idByRecord.get(r)!
    let resolvedTargetId: string | undefined
    for (const candidate of sorted) {
      if (candidate.context_id === r.context_id) continue
      const candidateBytes = sha256(canonicalRecord(candidate))
      const candidateToken = base64urlEncode(candidateBytes.slice(0, 16))
      if (candidateToken === provenanceToken) {
        resolvedTargetId = `sha256:${hexEncode(candidateBytes)}`
        break
      }
    }
    if (resolvedTargetId) {
      edges.push({ type: 'PROVENANCE_OF', source: sourceId, target: resolvedTargetId, directed: true })
    } else {
      const danglingId = `dangling:provenance:${provenanceToken}`
      ensureDanglingNode(danglingId)
      edges.push({
        type: 'PROVENANCE_OF',
        source: sourceId,
        target: danglingId,
        directed: true,
        dangling: true,
        reason: 'no_token_source_in_record_set',
      })
    }
  }

  // Step 8. ANNOTATES (§3.2.4 step 8, D058)
  for (const r of sorted) {
    if (r.event_type !== ANNOTATION_URI) continue
    const annotates = (r as { annotates?: unknown }).annotates
    if (typeof annotates !== 'string' || !annotates.startsWith('sha256:')) continue
    const sourceId = idByRecord.get(r)!
    const targetHash = annotates.slice('sha256:'.length)
    const targetId = hashToId.get(targetHash)
    if (targetId) {
      edges.push({ type: 'ANNOTATES', source: sourceId, target: targetId, directed: true })
    } else {
      const danglingId = `dangling:${annotates}`
      ensureDanglingNode(danglingId)
      edges.push({
        type: 'ANNOTATES',
        source: sourceId,
        target: danglingId,
        directed: true,
        dangling: true,
      })
    }
  }

  // Step 9. REVISES (§3.2.4 step 9, D059)
  for (const r of sorted) {
    if (r.event_type !== REVISION_URI) continue
    const revises = (r as { revises?: unknown }).revises
    if (typeof revises !== 'string' || !revises.startsWith('sha256:')) continue
    const sourceId = idByRecord.get(r)!
    const targetHash = revises.slice('sha256:'.length)
    const targetId = hashToId.get(targetHash)
    if (targetId) {
      edges.push({ type: 'REVISES', source: sourceId, target: targetId, directed: true })
    } else {
      const danglingId = `dangling:${revises}`
      ensureDanglingNode(danglingId)
      edges.push({
        type: 'REVISES',
        source: sourceId,
        target: danglingId,
        directed: true,
        dangling: true,
      })
    }
  }

  const crossSessionCount = edges.filter((e) => e.type === 'CROSS_SESSION').length
  const hasTransaction = nodes.some((n) => n.event_type === 'transaction')
  const contextId = nodes.length > 0 ? nodes[0]!.context_id : ''

  return {
    spec_version: 'atrib/1.0',
    context_id: contextId,
    generated_at: Date.now(),
    node_count: nodes.length,
    edge_count: edges.length,
    has_transaction: hasTransaction,
    cross_session_count: crossSessionCount,
    nodes,
    edges,
  }
}

// Re-export base64urlEncode for the test harness
export { base64urlEncode }
