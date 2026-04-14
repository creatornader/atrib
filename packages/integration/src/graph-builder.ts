// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory graph builder for the integration test.
 *
 * Implements the §3.2.4 edge derivation rules normatively. This is the
 * algorithm a graph indexing service (graph.atrib.dev) would run on log data.
 * Two implementations applying these rules to identical records MUST produce
 * identical edge sets.
 */

import { sha256, hexEncode, canonicalRecord, base64urlEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import type { GraphNode, GraphEdge, GraphResponse, EdgeType } from '@atrib/verify'

/**
 * Compute the record hash (sha256 of JCS canonical form) — same algorithm
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
 */
export function buildGraphFromRecords(records: AtribRecord[], contextId: string): GraphResponse {
  // Filter to records belonging to this session OR linked via session_token
  const sessionRecords = records.filter((r) => r.context_id === contextId)
  const txInSession = sessionRecords.find((r) => r.event_type === 'transaction')

  // Cross-session records: tool_calls in OTHER sessions whose session_token
  // matches the in-session transaction's session_token
  let crossSessionRecords: AtribRecord[] = []
  if (txInSession && 'session_token' in txInSession && txInSession.session_token) {
    const txToken = txInSession.session_token
    crossSessionRecords = records.filter((r) => {
      if (r.context_id === contextId) return false
      if (r.event_type !== 'tool_call') return false
      return 'session_token' in r && r.session_token === txToken
    })
  }

  const allRecords = [...sessionRecords, ...crossSessionRecords]

  // Build the node list
  const nodes: GraphNode[] = allRecords.map((r) => {
    const id = `sha256:${recordHashHex(r)}`
    return {
      id,
      event_type: r.event_type,
      content_id: r.content_id,
      creator_key: r.creator_key,
      chain_root: r.chain_root,
      context_id: r.context_id,
      timestamp: r.timestamp,
      log_index: 0,
      verification_state: 'signature_valid',
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

  // Step 1 — CHAIN_PRECEDES (§3.2.4 step 1)
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

  // Step 2 — SESSION_PRECEDES (§3.2.4 step 2)
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

  // Step 3 — SESSION_PARALLEL (§3.2.4 step 3)
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

  // Step 4 — CONVERGES_ON (§3.2.4 step 4)
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

  // Step 5 — CROSS_SESSION (§3.2.4 step 5)
  // For each transaction T: search for tool_call A where A.context_id ≠ T.context_id
  // AND A.session_token === T.session_token (both must be present)
  for (const tx of sessionTxNodes) {
    const txRecord = recordById.get(tx.id)!
    const txToken = 'session_token' in txRecord ? txRecord.session_token : undefined
    if (!txToken) continue
    for (const r of allRecords) {
      if (r.event_type !== 'tool_call') continue
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

// Re-export base64urlEncode for the test harness
export { base64urlEncode }
