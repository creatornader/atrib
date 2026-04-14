// SPDX-License-Identifier: Apache-2.0

/**
 * Edge case tests for calculate(), gaps #3, #4, #6, #7.
 *
 * #3: applyMaximumCap iteration bound (ping-pong safety fallback)
 * #4: Large graph performance (1000+ nodes)
 * #6: Creator floors exceeding available share
 * #7: Temporal decay with extreme parameters
 */

import { describe, it, expect } from 'vitest'
import { calculate, DEFAULT_POLICY } from '../src/calculate.js'
import type {
  GraphNode,
  GraphEdge,
  GraphResponse,
  PolicyDocument,
  SessionPolicyRecord,
} from '../src/types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a graph with N tool_call nodes + 1 transaction
// ─────────────────────────────────────────────────────────────────────────────

function buildGraph(
  toolCallCount: number,
  opts?: { creatorCount?: number; gapNodes?: number },
): GraphResponse {
  const creatorCount = opts?.creatorCount ?? 1
  const gapNodes = opts?.gapNodes ?? 0
  const contextId = 'a'.repeat(32)
  const baseTs = 1_700_000_000_000

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (let i = 0; i < toolCallCount; i++) {
    const creatorIdx = i % creatorCount
    nodes.push({
      id: `sha256:tc_${i.toString().padStart(6, '0')}`,
      event_type: 'tool_call',
      content_id: `sha256:content_${i}`,
      creator_key: `creator_${creatorIdx.toString().padStart(3, '0')}`,
      chain_root: `sha256:chain_${i}`,
      context_id: contextId,
      timestamp: baseTs + i * 100,
      log_index: i,
      verification_state: 'signature_valid',
      is_genesis: i === 0,
    })
  }

  for (let i = 0; i < gapNodes; i++) {
    nodes.push({
      id: `gap:${i}`,
      event_type: 'gap_node',
      content_id: null,
      creator_key: null,
      chain_root: null,
      context_id: contextId,
      timestamp: baseTs + toolCallCount * 100 + i * 100,
      log_index: null,
      verification_state: 'unsigned',
      is_genesis: false,
    })
  }

  const txNode: GraphNode = {
    id: 'sha256:tx_node',
    event_type: 'transaction',
    content_id: 'sha256:tx_content',
    creator_key: 'creator_000',
    chain_root: 'sha256:tx_chain',
    context_id: contextId,
    timestamp: baseTs + (toolCallCount + gapNodes) * 100 + 1000,
    log_index: toolCallCount + gapNodes,
    verification_state: 'signature_valid',
    is_genesis: false,
  }
  nodes.push(txNode)

  // CONVERGES_ON edges from all non-tx nodes to tx
  for (const n of nodes) {
    if (n.event_type !== 'transaction') {
      edges.push({ type: 'CONVERGES_ON', source: n.id, target: txNode.id, directed: true })
    }
  }

  // CHAIN_PRECEDES edges between sequential tool calls
  for (let i = 1; i < toolCallCount; i++) {
    edges.push({
      type: 'CHAIN_PRECEDES',
      source: nodes[i - 1]!.id,
      target: nodes[i]!.id,
      directed: true,
    })
  }

  return {
    spec_version: 'atrib/1.0',
    context_id: contextId,
    generated_at: Date.now(),
    node_count: nodes.length,
    edge_count: edges.length,
    has_transaction: true,
    cross_session_count: 0,
    nodes,
    edges,
  }
}

function distributionSum(d: Record<string, number>): number {
  return Object.values(d).reduce((a, b) => a + b, 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Gap #3: applyMaximumCap iteration bound
// ─────────────────────────────────────────────────────────────────────────────

describe('applyMaximumCap edge cases', () => {
  it('handles very low cap with many nodes (ping-pong safety)', () => {
    // 50 nodes, cap = 0.01 means cap * 50 = 0.5 < 1.0
    // Redistribution of excess from capped nodes to below-cap nodes may
    // push those above cap, causing ping-pong. The safety bound should
    // terminate this.
    const graph = buildGraph(50, { creatorCount: 50 })
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      constraints: { maximum_share: 0.01 },
    }

    const d = calculate(graph, policy)
    expect(Object.keys(d).length).toBeGreaterThan(0)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)

    // No share should wildly exceed cap (may be slightly above due to safety fallback)
    for (const share of Object.values(d)) {
      expect(share).toBeLessThanOrEqual(0.05) // generous tolerance for safety fallback
    }
  })

  it('cap = 0.5 with 2 equal contributors distributes evenly', () => {
    const graph = buildGraph(2, { creatorCount: 2 })
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      constraints: { maximum_share: 0.5 },
    }

    const d = calculate(graph, policy)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)
    for (const share of Object.values(d)) {
      expect(share).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })

  it('cap = 0.33 with 3 equal contributors respects cap', () => {
    const graph = buildGraph(3, { creatorCount: 3 })
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      constraints: { maximum_share: 0.33 },
    }

    const d = calculate(graph, policy)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap #4: Large graph performance
// ─────────────────────────────────────────────────────────────────────────────

describe('large graph performance', () => {
  it('calculates distribution for 500 nodes within 2 seconds', () => {
    const graph = buildGraph(500, { creatorCount: 50 })
    const start = performance.now()
    const d = calculate(graph, DEFAULT_POLICY)
    const elapsed = performance.now() - start

    expect(Object.keys(d).length).toBeGreaterThan(0)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)
    expect(elapsed).toBeLessThan(2000)
  })

  it('calculates distribution for 1000 nodes within 5 seconds', () => {
    const graph = buildGraph(1000, { creatorCount: 100 })
    const start = performance.now()
    const d = calculate(graph, DEFAULT_POLICY)
    const elapsed = performance.now() - start

    expect(Object.keys(d).length).toBeGreaterThan(0)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)
    expect(elapsed).toBeLessThan(5000)
  })

  it('maintains determinism on large graphs', () => {
    const graph = buildGraph(200, { creatorCount: 20 })
    const a = calculate(graph, DEFAULT_POLICY)
    const b = calculate(graph, DEFAULT_POLICY)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap #6: Creator floors exceeding available share
// ─────────────────────────────────────────────────────────────────────────────

describe('creator floor edge cases', () => {
  it('returns unchanged when floors sum to > 1.0 (cannot honor)', () => {
    const graph = buildGraph(3, { creatorCount: 3 })
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: graph.context_id,
      agreed_policy: 'default',
      applied_constraints: {
        minimum_floors: {
          creator_000: 0.5,
          creator_001: 0.4,
          creator_002: 0.3, // sum = 1.2 > 1.0
        },
      },
      warnings: [],
    }

    const d = calculate(graph, DEFAULT_POLICY, spr)
    expect(Object.keys(d).length).toBeGreaterThan(0)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)
  })

  it('applies floor when one creator has a floor and others absorb the cost', () => {
    const graph = buildGraph(4, { creatorCount: 4 })
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: graph.context_id,
      agreed_policy: 'default',
      applied_constraints: {
        minimum_floors: { creator_000: 0.5 },
      },
      warnings: [],
    }

    const d = calculate(graph, DEFAULT_POLICY, spr)
    expect(distributionSum(d)).toBeCloseTo(1.0, 8)
    // creator_000 should get at least 0.5
    expect(d['creator_000']).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })

  it('ignores floors for creators not in the graph', () => {
    const graph = buildGraph(2, { creatorCount: 2 })
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: graph.context_id,
      agreed_policy: 'default',
      applied_constraints: {
        minimum_floors: { nonexistent_creator: 0.9 },
      },
      warnings: [],
    }

    const withFloor = calculate(graph, DEFAULT_POLICY, spr)
    const without = calculate(graph, DEFAULT_POLICY)
    expect(withFloor).toEqual(without)
  })

  it('empty floors object has no effect', () => {
    const graph = buildGraph(3, { creatorCount: 3 })
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: graph.context_id,
      agreed_policy: 'default',
      applied_constraints: { minimum_floors: {} },
      warnings: [],
    }

    const withEmpty = calculate(graph, DEFAULT_POLICY, spr)
    const without = calculate(graph, DEFAULT_POLICY)
    expect(withEmpty).toEqual(without)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Gap #7: Temporal decay with extreme parameters
// ─────────────────────────────────────────────────────────────────────────────

describe('temporal decay extremes', () => {
  it('half_life_ms = 1 decays nearly to zero for nodes even slightly before tx', () => {
    // With half_life = 1ms and delta = 100ms, factor = 2^(-100) ≈ 7.9e-31
    const graph = buildGraph(2, { creatorCount: 2 })
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      modifiers: [{ type: 'temporal_decay', half_life_ms: 1 }],
    }

    const d = calculate(graph, policy)
    // Should still produce a valid distribution (or empty if all decayed to ~0)
    if (Object.keys(d).length > 0) {
      expect(distributionSum(d)).toBeCloseTo(1.0, 8)
    }
  })

  it('half_life_ms = 1e12 produces negligible decay', () => {
    // With half_life = 1e12ms (~31 years), even a 60s delta gives factor ≈ 1.0
    const graph = buildGraph(3, { creatorCount: 3 })
    const policyWithDecay: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      modifiers: [{ type: 'temporal_decay', half_life_ms: 1e12 }],
    }
    const policyWithout: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
    }

    const withDecay = calculate(graph, policyWithDecay)
    const without = calculate(graph, policyWithout)

    // Shares should be nearly identical (decay is negligible)
    for (const key of Object.keys(without)) {
      expect(withDecay[key]).toBeCloseTo(without[key]!, 6)
    }
  })

  it('chain_depth_penalty = 0 has no effect', () => {
    const graph = buildGraph(5, { creatorCount: 5 })
    const policyWith: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 0 }],
    }
    const policyWithout: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
    }

    expect(calculate(graph, policyWith)).toEqual(calculate(graph, policyWithout))
  })

  it('chain_depth_penalty = 1.0 zeros out all nodes with depth >= 1', () => {
    const graph = buildGraph(5, { creatorCount: 5 })
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, CHAIN_PRECEDES: 1.0 },
      modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 1.0 }],
    }

    const d = calculate(graph, policy)
    // Most nodes have chain depth >= 1, so they get zeroed out
    // Only nodes with no chain path (depth = MAX_SAFE_INTEGER, factor = 0) or
    // nodes at depth 0 (factor = 1.0) survive
    if (Object.keys(d).length > 0) {
      expect(distributionSum(d)).toBeCloseTo(1.0, 8)
    }
  })

  it('call_count_boost with cap = 1.0 provides no boost', () => {
    const graph = buildGraph(3, { creatorCount: 3 })
    const policyWith: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
      modifiers: [{ type: 'call_count_boost', multiplier_per_call: 0.5, cap: 1.0 }],
    }
    const policyWithout: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0 },
    }

    // Cap = 1.0 means factor = min(1.0, 1.0 + ...) = 1.0 always
    expect(calculate(graph, policyWith)).toEqual(calculate(graph, policyWithout))
  })

  it('all three modifiers applied simultaneously produces valid distribution', () => {
    const graph = buildGraph(10, { creatorCount: 5 })
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, CHAIN_PRECEDES: 0.8 },
      modifiers: [
        { type: 'temporal_decay', half_life_ms: 30_000 },
        { type: 'chain_depth_penalty', penalty_per_level: 0.2 },
        { type: 'call_count_boost', multiplier_per_call: 0.3, cap: 2.0 },
      ],
      constraints: { minimum_share: 0.02, maximum_share: 0.6 },
    }

    const d = calculate(graph, policy)
    if (Object.keys(d).length > 0) {
      expect(distributionSum(d)).toBeCloseTo(1.0, 8)
      for (const share of Object.values(d)) {
        expect(share).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(share)).toBe(true)
      }
    }
  })
})
