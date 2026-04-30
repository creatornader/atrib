// SPDX-License-Identifier: Apache-2.0

/**
 * Attribution graph builder (section 3.2.4).
 *
 * Applies the 5 normative edge derivation steps to a set of attribution
 * records and optional gap nodes to produce a GraphResponse.
 *
 * Two implementations applying these rules to identical input records
 * MUST produce identical edge sets.
 */

import {
  canonicalRecord,
  sha256,
  hexEncode,
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

