// SPDX-License-Identifier: Apache-2.0

/**
 * Attribution graph builder (section 3.2.4).
 *
 * Applies the 9 normative edge derivation steps to a set of attribution
 * records and optional gap nodes to produce a GraphResponse.
 *
 *   Step 1: CHAIN_PRECEDES
 *   Step 2: SESSION_PRECEDES
 *   Step 3: SESSION_PARALLEL
 *   Step 4: CONVERGES_ON
 *   Step 5: CROSS_SESSION
 *   Step 6: INFORMED_BY (D041)
 *   Step 7: PROVENANCE_OF (D044)
 *   Step 8: ANNOTATES (D058)
 *   Step 9: REVISES (D059)
 *
 * Two implementations applying these rules to identical input records
 * MUST produce identical edge sets.
 */

import {
  canonicalRecord,
  sha256,
  hexEncode,
  base64urlEncode,
  verifyRecord,
  genesisChainRoot,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  GapNode,
  VerificationState,
} from '@atrib/verify'
import { graphLabelFromEventTypeUri, applyRevocation } from '@atrib/verify'
import type { RevocationEntry } from '@atrib/verify'

// GapNode is re-exported for use by store.ts and callers.
export type { GapNode }

export interface BuildGraphOptions {
  includeGapNodes?: boolean
  includeCrossSession?: boolean
  /**
   * Revocation registry from @atrib/verify (built by scanning all records
   * for key_revocation events). When provided, nodes whose creator_key
   * was retired before their log_index get verification_state set to
   * 'revoked_after_revocation' per spec §1.9.3.
   */
  revocations?: Map<string, RevocationEntry>
  /**
   * Lookup function: record_hash hex (without 'sha256:' prefix) → log_index.
   * Required for revocation logic to work; without it nodes have null
   * log_index and revocation cannot be applied.
   */
  logIndexLookup?: (recordHashHex: string) => number | null
}

/** Build an attribution graph from records and gap nodes. */
export async function buildGraph(
  records: AtribRecord[],
  gapNodes: GapNode[] = [],
  options: BuildGraphOptions = {},
): Promise<GraphResponse> {
  const includeGapNodes = options.includeGapNodes ?? true
  const includeCrossSession = options.includeCrossSession ?? true

  // Sort records by timestamp for determinism (tiebreak by context_id + content_id)
  const sorted = [...records].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    const aKey = `${a.context_id}:${a.content_id}`
    const bKey = `${b.context_id}:${b.content_id}`
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
  })

  // Build node map: record_hash -> GraphNode
  const nodes: GraphNode[] = []
  const nodeById = new Map<string, GraphNode>()
  // Map canonical hash (hex) to node ID for chain_root lookups
  const hashToNodeId = new Map<string, string>()

  for (const record of sorted) {
    const canonical = canonicalRecord(record)
    const hash = hexEncode(sha256(canonical))
    const nodeId = `sha256:${hash}`

    // Verify signature for verification_state
    let verificationState: VerificationState = 'signature_valid'
    try {
      const valid = await verifyRecord(record)
      if (!valid) verificationState = 'unsigned'
    } catch {
      verificationState = 'unsigned'
    }

    const isGenesis = record.chain_root.startsWith('sha256:') &&
      record.chain_root === genesisChainRoot(record.context_id)

    const logIndex = options.logIndexLookup ? options.logIndexLookup(hash) : null
    const node: GraphNode = {
      id: nodeId,
      event_type: graphLabelFromEventTypeUri(record.event_type),
      event_type_uri: record.event_type,
      content_id: record.content_id,
      creator_key: record.creator_key,
      chain_root: record.chain_root,
      context_id: record.context_id,
      timestamp: record.timestamp,
      log_index: logIndex,
      verification_state: verificationState,
      is_genesis: isGenesis,
    }
    if (options.revocations) {
      node.verification_state = applyRevocation(node, options.revocations)
    }

    nodes.push(node)
    nodeById.set(nodeId, node)
    hashToNodeId.set(hash, nodeId)
  }

  // Add gap nodes
  if (includeGapNodes) {
    for (const gap of gapNodes) {
      const gapIdInput = `${gap.tool_url}:${gap.tool_name}:${gap.context_id}`
      const encoder = new TextEncoder()
      const gapHash = hexEncode(sha256(encoder.encode(gapIdInput)))
      const nodeId = `gap:${gapHash}`

      const node: GraphNode = {
        id: nodeId,
        event_type: 'gap_node',
        event_type_uri: null,
        content_id: null,
        creator_key: null,
        chain_root: null,
        context_id: gap.context_id,
        timestamp: gap.timestamp,
        log_index: null,
        verification_state: 'unsigned',
        is_genesis: false,
      }
      nodes.push(node)
      nodeById.set(nodeId, node)
    }
  }

  // Edge derivation (section 3.2.4, normative, must be applied in order)
  const edges: GraphEdge[] = []
  const chainPrecedesPairs = new Set<string>() // "sourceId->targetId"

  // Step 1: CHAIN_PRECEDES
  for (const node of nodes) {
    if (node.is_genesis || node.event_type === 'gap_node') continue
    if (!node.chain_root) continue

    const expectedHash = node.chain_root.replace('sha256:', '')
    const parentId = hashToNodeId.get(expectedHash)
    if (parentId) {
      edges.push({
        type: 'CHAIN_PRECEDES',
        source: parentId,
        target: node.id,
        directed: true,
      })
      chainPrecedesPairs.add(`${parentId}->${node.id}`)
      chainPrecedesPairs.add(`${node.id}->${parentId}`)
    }
  }

  // Step 2: SESSION_PRECEDES
  const sessionPrecedesPairs = new Set<string>()
  const byContext = groupByContextId(nodes)

  for (const contextNodes of byContext.values()) {
    for (let i = 0; i < contextNodes.length; i++) {
      for (let j = i + 1; j < contextNodes.length; j++) {
        const a = contextNodes[i]!
        const b = contextNodes[j]!
        const pairKey = `${a.id}->${b.id}`
        const reversePairKey = `${b.id}->${a.id}`

        // Skip if CHAIN_PRECEDES exists between them
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
        // Equal timestamps handled in Step 3 (SESSION_PARALLEL)
      }
    }
  }

  // Step 3: SESSION_PARALLEL
  for (const contextNodes of byContext.values()) {
    for (let i = 0; i < contextNodes.length; i++) {
      for (let j = i + 1; j < contextNodes.length; j++) {
        const a = contextNodes[i]!
        const b = contextNodes[j]!
        const pairKey = `${a.id}->${b.id}`
        const reversePairKey = `${b.id}->${a.id}`

        if (chainPrecedesPairs.has(pairKey) || chainPrecedesPairs.has(reversePairKey)) continue
        if (sessionPrecedesPairs.has(pairKey) || sessionPrecedesPairs.has(reversePairKey)) continue

        edges.push({ type: 'SESSION_PARALLEL', source: a.id, target: b.id, directed: false })
      }
    }
  }

  // Step 4: CONVERGES_ON
  for (const contextNodes of byContext.values()) {
    const txNodes = contextNodes.filter((n) => n.event_type === 'transaction')
    const otherNodes = contextNodes.filter((n) => n.event_type !== 'transaction')

    for (const txNode of txNodes) {
      for (const other of otherNodes) {
        edges.push({ type: 'CONVERGES_ON', source: other.id, target: txNode.id, directed: true })
      }
    }
  }

  // Step 5: CROSS_SESSION
  if (includeCrossSession) {
    const txNodes = nodes.filter((n) => n.event_type === 'transaction')
    for (const txNode of txNodes) {
      const txRecord = sorted.find((r) => {
        const h = hexEncode(sha256(canonicalRecord(r)))
        return `sha256:${h}` === txNode.id
      })
      if (!txRecord || !('session_token' in txRecord) || !txRecord.session_token) continue

      for (const otherNode of nodes) {
        if (otherNode.context_id === txNode.context_id) continue
        if (otherNode.event_type !== 'tool_call') continue

        const otherRecord = sorted.find((r) => {
          const h = hexEncode(sha256(canonicalRecord(r)))
          return `sha256:${h}` === otherNode.id
        })
        if (!otherRecord || !('session_token' in otherRecord)) continue
        if (otherRecord.session_token !== txRecord.session_token) continue

        edges.push({ type: 'CROSS_SESSION', source: otherNode.id, target: txNode.id, directed: true })
      }
    }
  }

  // Per §3.2.4 step 6 + 7: lazy creation of synthetic dangling nodes for
  // unresolved INFORMED_BY / PROVENANCE_OF references. Created at most once
  // per missing reference; subsequent edges to the same dangling target
  // reuse the same node.
  const ensureDanglingNode = (id: string): void => {
    if (nodeById.has(id)) return
    const node: GraphNode = {
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
    }
    nodes.push(node)
    nodeById.set(id, node)
  }

  // Step 6: INFORMED_BY (D041, spec §3.2.4)
  // For each record A with a non-empty informed_by array, create one
  // INFORMED_BY edge per entry. Direction A → B reads "A is informed by B".
  // Targets resolve via record_hash lookup; unresolved entries get a
  // synthetic dangling target so the agent's claim stays visible.
  for (const record of sorted) {
    const informedBy = record.informed_by
    if (!Array.isArray(informedBy) || informedBy.length === 0) continue
    const sourceHash = hexEncode(sha256(canonicalRecord(record)))
    const sourceId = `sha256:${sourceHash}`
    for (const ref of informedBy) {
      if (typeof ref !== 'string' || !ref.startsWith('sha256:')) continue
      const refHash = ref.slice('sha256:'.length)
      const targetId = hashToNodeId.get(refHash)
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

  // Step 7: PROVENANCE_OF (D044, spec §3.2.4)
  // For each session-genesis record D carrying provenance_token T, find any
  // record U with first 16 bytes of SHA-256(JCS(U)) matching T AND
  // U.context_id ≠ D.context_id. Direction D → U reads "D's session
  // descends from U's anchor." Non-genesis records carrying
  // provenance_token are malformed per §1.2.6 and excluded from derivation.
  for (const record of sorted) {
    const provenanceToken = record.provenance_token
    if (typeof provenanceToken !== 'string' || provenanceToken.length === 0) continue
    if (record.chain_root !== genesisChainRoot(record.context_id)) continue
    const sourceHash = hexEncode(sha256(canonicalRecord(record)))
    const sourceId = `sha256:${sourceHash}`
    let resolvedTargetId: string | undefined
    for (const candidate of sorted) {
      if (candidate.context_id === record.context_id) continue
      const candidateBytes = sha256(canonicalRecord(candidate))
      const candidateToken = base64urlEncode(candidateBytes.slice(0, 16))
      if (candidateToken === provenanceToken) {
        resolvedTargetId = `sha256:${hexEncode(candidateBytes)}`
        break
      }
    }
    if (resolvedTargetId) {
      edges.push({
        type: 'PROVENANCE_OF',
        source: sourceId,
        target: resolvedTargetId,
        directed: true,
      })
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

  // Step 8: ANNOTATES (D058, spec §3.2.4)
  // For each annotation record A (event_type =
  // https://atrib.dev/v1/types/annotation) carrying a non-empty `annotates`
  // field referencing record T, create one ANNOTATES edge A → T. Direction
  // reads "A is an annotation of T." Targets resolve via record_hash lookup;
  // unresolved entries get a synthetic dangling target so the agent's claim
  // stays visible. The dual of INFORMED_BY: forward-pointing (annotation
  // points at an earlier record) rather than backward-pointing (informed_by
  // points at records the current record was informed by). Multiple
  // annotations of the same target are normal and produce multiple edges.
  for (const record of sorted) {
    if (record.event_type !== 'https://atrib.dev/v1/types/annotation') continue
    const annotates = record.annotates
    if (typeof annotates !== 'string' || !annotates.startsWith('sha256:')) continue
    const sourceHash = hexEncode(sha256(canonicalRecord(record)))
    const sourceId = `sha256:${sourceHash}`
    const targetHash = annotates.slice('sha256:'.length)
    const targetId = hashToNodeId.get(targetHash)
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

  // Step 9: REVISES (D059, spec §3.2.4)
  // For each revision record R (event_type =
  // https://atrib.dev/v1/types/revision) carrying a non-empty `revises`
  // field referencing record P, create one REVISES edge R → P. Direction
  // reads "R supersedes P." Mirrors the ANNOTATES derivation pattern but
  // with a stronger semantic: an annotation comments on a target while
  // leaving the agent's prior position intact; a revision asserts the
  // target is no longer held. Targets resolve via record_hash lookup;
  // unresolved entries get a synthetic dangling target so the agent's
  // claim stays visible. Multiple revisions of the same target are
  // allowed (chain of mind-changes); the graph surfaces all of them.
  for (const record of sorted) {
    if (record.event_type !== 'https://atrib.dev/v1/types/revision') continue
    const revises = record.revises
    if (typeof revises !== 'string' || !revises.startsWith('sha256:')) continue
    const sourceHash = hexEncode(sha256(canonicalRecord(record)))
    const sourceId = `sha256:${sourceHash}`
    const targetHash = revises.slice('sha256:'.length)
    const targetId = hashToNodeId.get(targetHash)
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

function groupByContextId(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>()
  for (const node of nodes) {
    const list = map.get(node.context_id) ?? []
    list.push(node)
    map.set(node.context_id, list)
  }
  return map
}

