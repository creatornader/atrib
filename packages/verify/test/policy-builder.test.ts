// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the policy builder helper.
 */

import { describe, it, expect } from 'vitest'
import { buildPolicy, policyFrom } from '../src/policy-builder.js'
import { DEFAULT_POLICY, isValidPolicy, calculate } from '../src/calculate.js'
import type { PolicyDocument, GraphResponse, GraphNode, GraphEdge } from '../src/types.js'

const CTX = 'a'.repeat(32)

function makeGraph(nodes: Partial<GraphNode>[], edges: GraphEdge[]): GraphResponse {
  return {
    spec_version: 'atrib/1.0',
    context_id: CTX,
    generated_at: Date.now(),
    node_count: nodes.length,
    edge_count: edges.length,
    has_transaction: true,
    cross_session_count: 0,
    nodes: nodes as GraphNode[],
    edges,
  }
}

describe('buildPolicy', () => {
  it('returns a valid policy', () => {
    const result = buildPolicy(DEFAULT_POLICY, {})
    expect(isValidPolicy(result)).toBe(true)
  })

  it('overrides edge weights', () => {
    const result = buildPolicy(DEFAULT_POLICY, {
      edge_weights: { CHAIN_PRECEDES: 3.0 },
    })
    expect(result.edge_weights?.CHAIN_PRECEDES).toBe(3.0)
    // Other weights should be from the base
    expect(result.edge_weights?.CONVERGES_ON).toBe(1.0)
  })

  it('concatenates modifiers (base first, then additions)', () => {
    const base: PolicyDocument = {
      spec_version: 'atrib/1.0',
      modifiers: [{ type: 'temporal_decay', half_life_ms: 60000 }],
    }
    const result = buildPolicy(base, {
      modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 0.2 }],
    })
    expect(result.modifiers?.length).toBe(2)
    expect(result.modifiers?.[0]?.type).toBe('temporal_decay')
    expect(result.modifiers?.[1]?.type).toBe('chain_depth_penalty')
  })

  it('merges constraints', () => {
    const base: PolicyDocument = {
      spec_version: 'atrib/1.0',
      constraints: { minimum_share: 0.05 },
    }
    const result = buildPolicy(base, {
      constraints: { maximum_share: 0.40 },
    })
    expect(result.constraints?.minimum_share).toBe(0.05)
    expect(result.constraints?.maximum_share).toBe(0.40)
  })

  it('override constraints replace base constraints', () => {
    const base: PolicyDocument = {
      spec_version: 'atrib/1.0',
      constraints: { minimum_share: 0.05 },
    }
    const result = buildPolicy(base, {
      constraints: { minimum_share: 0.10 },
    })
    expect(result.constraints?.minimum_share).toBe(0.10)
  })

  it('throws on invalid result (min > max)', () => {
    expect(() =>
      buildPolicy(DEFAULT_POLICY, {
        constraints: { minimum_share: 0.60, maximum_share: 0.30 },
      }),
    ).toThrow('invalid')
  })

  it('throws on negative weights', () => {
    expect(() =>
      buildPolicy(DEFAULT_POLICY, {
        edge_weights: { CONVERGES_ON: -1.0 },
      }),
    ).toThrow('invalid')
  })
})

describe('policyFrom', () => {
  it('starts from DEFAULT_POLICY', () => {
    const result = policyFrom({})
    expect(result.edge_weights?.CONVERGES_ON).toBe(1.0)
    expect(result.modifiers).toEqual([])
  })

  it('builds a recency-weighted policy in one call', () => {
    const result = policyFrom({
      modifiers: [{ type: 'temporal_decay', half_life_ms: 60000 }],
    })
    expect(result.modifiers?.length).toBe(1)
    expect(isValidPolicy(result)).toBe(true)
  })

  it('builds a chain-position + capped policy in one call', () => {
    const result = policyFrom({
      edge_weights: { CHAIN_PRECEDES: 2.0 },
      modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 0.15 }],
      constraints: { maximum_share: 0.40 },
    })
    expect(result.edge_weights?.CHAIN_PRECEDES).toBe(2.0)
    expect(result.constraints?.maximum_share).toBe(0.40)
    expect(isValidPolicy(result)).toBe(true)
  })

  it('produces a policy that calculate() accepts', () => {
    const policy = policyFrom({
      edge_weights: { CONVERGES_ON: 1.0 },
      modifiers: [{ type: 'temporal_decay', half_life_ms: 30000 }],
      constraints: { minimum_share: 0.05 },
    })

    const g = makeGraph(
      [
        { id: 'a', event_type: 'tool_call', event_type_uri: 'https://atrib.dev/v1/types/tool_call', content_id: 'sha256:a', creator_key: 'Alice', chain_root: 'sha256:r', context_id: CTX, timestamp: 1000, log_index: 0, verification_state: 'signature_valid', is_genesis: true },
        { id: 'b', event_type: 'tool_call', event_type_uri: 'https://atrib.dev/v1/types/tool_call', content_id: 'sha256:b', creator_key: 'Bob', chain_root: 'sha256:r', context_id: CTX, timestamp: 1001, log_index: 1, verification_state: 'signature_valid', is_genesis: false },
        { id: 'tx', event_type: 'transaction', event_type_uri: 'https://atrib.dev/v1/types/transaction', content_id: 'sha256:tx', creator_key: 'M', chain_root: 'sha256:r', context_id: CTX, timestamp: 2000, log_index: 2, verification_state: 'signature_valid', is_genesis: false },
      ],
      [
        { type: 'CONVERGES_ON', source: 'a', target: 'tx', directed: true },
        { type: 'CONVERGES_ON', source: 'b', target: 'tx', directed: true },
      ],
    )

    const d = calculate(g, policy)
    expect(Object.keys(d).length).toBe(2)
    const sum = Object.values(d).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1.0, 8)
  })
})
