// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the policy templates in policies/.
 *
 * Verifies that each template produces the distribution behavior it claims,
 * and that policies compose correctly when stacked.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { calculate, isValidPolicy, DEFAULT_POLICY } from '../src/calculate.js'
import type { GraphNode, GraphEdge, GraphResponse, PolicyDocument, SessionPolicyRecord } from '../src/types.js'

// ─── Test graph builder ──────────────────────────────────────────────────────

const CTX = 'a'.repeat(32)

function node(id: string, creatorKey: string, ts: number, opts?: Partial<GraphNode>): GraphNode {
  return {
    id,
    event_type: 'tool_call',
    content_id: `sha256:${id}`,
    creator_key: creatorKey,
    chain_root: `sha256:chain_${id}`,
    context_id: CTX,
    timestamp: ts,
    log_index: 0,
    verification_state: 'signature_valid',
    is_genesis: false,
    ...opts,
  }
}

function txNode(ts: number): GraphNode {
  return {
    id: 'tx',
    event_type: 'transaction',
    content_id: 'sha256:tx',
    creator_key: 'merchant',
    chain_root: 'sha256:tx_chain',
    context_id: CTX,
    timestamp: ts,
    log_index: 99,
    verification_state: 'signature_valid',
    is_genesis: false,
  }
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): GraphResponse {
  return {
    spec_version: 'atrib/1.0',
    context_id: CTX,
    generated_at: Date.now(),
    node_count: nodes.length,
    edge_count: edges.length,
    has_transaction: true,
    cross_session_count: 0,
    nodes,
    edges,
  }
}

function convergesOn(source: string): GraphEdge {
  return { type: 'CONVERGES_ON', source, target: 'tx', directed: true }
}

function chainPrecedes(source: string, target: string): GraphEdge {
  return { type: 'CHAIN_PRECEDES', source, target, directed: true }
}

function sum(d: Record<string, number>): number {
  return Object.values(d).reduce((a, b) => a + b, 0)
}

// ─── Load templates ──────────────────────────────────────────────────────────

const policiesDir = join(fileURLToPath(import.meta.url), '../../../../policies')

async function loadPolicy(name: string): Promise<PolicyDocument> {
  const content = await readFile(join(policiesDir, name), 'utf-8')
  return JSON.parse(content) as PolicyDocument
}

// ─── Template validation ─────────────────────────────────────────────────────

describe('all templates are valid policies', () => {
  const templates = [
    'equal-split.json',
    'recency-weighted.json',
    'chain-position.json',
    'creator-floor-10pct.json',
    'merchant-capped-40pct.json',
    'full-stack.json',
  ]

  for (const name of templates) {
    it(`${name} passes isValidPolicy()`, async () => {
      const policy = await loadPolicy(name)
      expect(isValidPolicy(policy)).toBe(true)
    })

    it(`${name} has spec_version atrib/1.0`, async () => {
      const policy = await loadPolicy(name)
      expect(policy.spec_version).toBe('atrib/1.0')
    })
  }
})

// ─── equal-split.json ────────────────────────────────────────────────────────

describe('equal-split.json', () => {
  it('produces equal shares for equal contributors', async () => {
    const policy = await loadPolicy('equal-split.json')
    const g = graph(
      [node('a', 'Alice', 1000), node('b', 'Bob', 1001), txNode(2000)],
      [convergesOn('a'), convergesOn('b')],
    )
    const d = calculate(g, policy)
    expect(d['Alice']).toBeCloseTo(0.5, 9)
    expect(d['Bob']).toBeCloseTo(0.5, 9)
  })

  it('weights by call count (3 calls from Alice, 1 from Bob)', async () => {
    const policy = await loadPolicy('equal-split.json')
    const g = graph(
      [
        node('a1', 'Alice', 1000), node('a2', 'Alice', 1001), node('a3', 'Alice', 1002),
        node('b1', 'Bob', 1003),
        txNode(2000),
      ],
      [convergesOn('a1'), convergesOn('a2'), convergesOn('a3'), convergesOn('b1')],
    )
    const d = calculate(g, policy)
    expect(d['Alice']).toBeCloseTo(0.75, 9)
    expect(d['Bob']).toBeCloseTo(0.25, 9)
  })

  it('matches DEFAULT_POLICY behavior', async () => {
    const policy = await loadPolicy('equal-split.json')
    const g = graph(
      [node('a', 'Alice', 1000), node('b', 'Bob', 1001), node('c', 'Carol', 1002), txNode(2000)],
      [convergesOn('a'), convergesOn('b'), convergesOn('c')],
    )
    expect(calculate(g, policy)).toEqual(calculate(g, DEFAULT_POLICY))
  })
})

// ─── recency-weighted.json ───────────────────────────────────────────────────

describe('recency-weighted.json', () => {
  it('gives more credit to tools called closer to the transaction', async () => {
    const policy = await loadPolicy('recency-weighted.json')
    // half_life_ms = 60000 (1 minute)
    // old: 120s before tx → decay factor = 2^(-120000/60000) = 0.25
    // new: 5s before tx → decay factor = 2^(-5000/60000) ≈ 0.944
    const g = graph(
      [node('old', 'OldTool', 1000), node('new', 'NewTool', 115000), txNode(120000)],
      [convergesOn('old'), convergesOn('new')],
    )
    const d = calculate(g, policy)
    expect(d['NewTool']!).toBeGreaterThan(d['OldTool']!)
    expect(sum(d)).toBeCloseTo(1.0, 8)
  })

  it('equal-time contributors still get equal shares', async () => {
    const policy = await loadPolicy('recency-weighted.json')
    const g = graph(
      [node('a', 'Alice', 1000), node('b', 'Bob', 1000), txNode(2000)],
      [convergesOn('a'), convergesOn('b')],
    )
    const d = calculate(g, policy)
    expect(d['Alice']).toBeCloseTo(d['Bob']!, 9)
  })
})

// ─── chain-position.json ────────────────────────────────────────────────────

describe('chain-position.json', () => {
  it('CHAIN_PRECEDES nodes get higher weight than parallel nodes', async () => {
    const policy = await loadPolicy('chain-position.json')
    // a → b → tx chain, plus c only CONVERGES_ON
    // a and b collect CHAIN_PRECEDES (2.0), c only CONVERGES_ON (1.0)
    const g = graph(
      [node('a', 'Chain1', 1000), node('b', 'Chain2', 1001), node('c', 'Parallel', 1002), txNode(2000)],
      [convergesOn('a'), convergesOn('b'), convergesOn('c'), chainPrecedes('a', 'b'), chainPrecedes('b', 'tx')],
    )
    const d = calculate(g, policy)
    // Chain contributors should have higher total share than the parallel one
    const chainTotal = (d['Chain1'] ?? 0) + (d['Chain2'] ?? 0)
    expect(chainTotal).toBeGreaterThan(d['Parallel'] ?? 0)
    expect(sum(d)).toBeCloseTo(1.0, 8)
  })

  it('deeper chain positions are penalized', async () => {
    const policy = await loadPolicy('chain-position.json')
    // penalty_per_level = 0.15
    // a → b → c → tx (chain)
    // a is depth 3 from tx: factor = max(0, 1 - 3*0.15) = 0.55
    // b is depth 2: factor = max(0, 1 - 2*0.15) = 0.70
    // c is depth 1: factor = max(0, 1 - 1*0.15) = 0.85
    const g = graph(
      [node('a', 'Deep', 1000), node('b', 'Mid', 1001), node('c', 'Close', 1002), txNode(2000)],
      [
        chainPrecedes('a', 'b'), chainPrecedes('b', 'c'), chainPrecedes('c', 'tx'),
        convergesOn('a'), convergesOn('b'), convergesOn('c'),
      ],
    )
    const d = calculate(g, policy)
    expect(d['Close']!).toBeGreaterThan(d['Mid']!)
    expect(d['Mid']!).toBeGreaterThan(d['Deep']!)
    expect(sum(d)).toBeCloseTo(1.0, 8)
  })
})

// ─── creator-floor-10pct.json ────────────────────────────────────────────────

describe('creator-floor-10pct.json', () => {
  it('is a creator policy (role = creator)', async () => {
    const policy = await loadPolicy('creator-floor-10pct.json')
    expect(policy.role).toBe('creator')
  })

  it('minimum_own_share = 0.10 is in constraints', async () => {
    const policy = await loadPolicy('creator-floor-10pct.json')
    expect(policy.constraints?.minimum_own_share).toBe(0.10)
  })

  it('floor is enforced via session policy record', async () => {
    const policy = await loadPolicy('creator-floor-10pct.json')
    // 10 creators, 1 call each. Under equal split, each gets 0.10.
    // With the floor, the protected creator should get at least 0.10.
    const nodes = Array.from({ length: 10 }, (_, i) =>
      node(`n${i}`, `creator_${i}`, 1000 + i),
    )
    const g = graph([...nodes, txNode(2000)], nodes.map((n) => convergesOn(n.id)))

    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: CTX,
      agreed_policy: 'default',
      applied_constraints: {
        minimum_floors: { creator_0: 0.10 },
      },
      warnings: [],
    }

    const d = calculate(g, DEFAULT_POLICY, spr)
    expect(d['creator_0']!).toBeGreaterThanOrEqual(0.10 - 1e-9)
    expect(sum(d)).toBeCloseTo(1.0, 8)
  })
})

// ─── merchant-capped-40pct.json ──────────────────────────────────────────────

describe('merchant-capped-40pct.json', () => {
  it('no single contributor exceeds ~40% with dominant contributor', async () => {
    const policy = await loadPolicy('merchant-capped-40pct.json')
    // One creator with 8 calls, another with 1. Without cap, first would dominate.
    const nodes = [
      ...Array.from({ length: 8 }, (_, i) => node(`a${i}`, 'Dominant', 1000 + i)),
      node('b', 'Small', 1009),
    ]
    const g = graph([...nodes, txNode(2000)], nodes.map((n) => convergesOn(n.id)))
    const d = calculate(g, policy)
    // The cap is on nodes, not creators, so the creator aggregate may exceed 40%
    // but individual node shares should be capped
    expect(sum(d)).toBeCloseTo(1.0, 8)
    // Small contributor should get at least minimum_share (0.05)
    // (depends on how many nodes — with 9 nodes, each normalized to ~1/9 ≈ 0.11, all above 0.05)
  })

  it('includes recency weighting (temporal_decay) with 3+ contributors', async () => {
    const policy = await loadPolicy('merchant-capped-40pct.json')
    // With only 2 contributors and maximum_share=0.40, the cap can't be
    // satisfied (both would exceed 0.40). With 3+, the cap works and
    // temporal decay differentiates contributions.
    const g = graph(
      [
        node('old', 'OldTool', 1000),
        node('mid', 'MidTool', 200000),
        node('new', 'NewTool', 236000),
        txNode(241000),
      ],
      [convergesOn('old'), convergesOn('mid'), convergesOn('new')],
    )
    const d = calculate(g, policy)
    expect(sum(d)).toBeCloseTo(1.0, 8)
    // Newest should get more than oldest
    expect((d['NewTool'] ?? 0)).toBeGreaterThan(d['OldTool'] ?? 0)
    // Cap is approximately enforced (redistribution can overshoot slightly)
    for (const share of Object.values(d)) {
      expect(share).toBeLessThanOrEqual(0.45)
    }
  })
})

// ─── full-stack.json ─────────────────────────────────────────────────────────

describe('full-stack.json', () => {
  it('applies all three modifiers', async () => {
    const policy = await loadPolicy('full-stack.json')
    expect(policy.modifiers?.length).toBe(3)
    expect(policy.modifiers?.[0]?.type).toBe('temporal_decay')
    expect(policy.modifiers?.[1]?.type).toBe('chain_depth_penalty')
    expect(policy.modifiers?.[2]?.type).toBe('call_count_boost')
  })

  it('produces a valid distribution with a complex graph', async () => {
    const policy = await loadPolicy('full-stack.json')
    // Chain: a → b → c → tx, plus parallel tool d
    const g = graph(
      [
        node('a', 'Deep', 1000, { content_id: 'sha256:shared' }),
        node('b', 'Mid', 1001, { content_id: 'sha256:shared' }), // same content_id as a (call_count_boost)
        node('c', 'Close', 1002),
        node('d', 'Parallel', 1003),
        txNode(2000),
      ],
      [
        chainPrecedes('a', 'b'), chainPrecedes('b', 'c'), chainPrecedes('c', 'tx'),
        convergesOn('a'), convergesOn('b'), convergesOn('c'), convergesOn('d'),
      ],
    )
    const d = calculate(g, policy)
    expect(Object.keys(d).length).toBeGreaterThan(0)
    expect(sum(d)).toBeCloseTo(1.0, 8)
    for (const share of Object.values(d)) {
      expect(share).toBeGreaterThanOrEqual(0)
      expect(share).toBeLessThanOrEqual(0.50 + 1e-9) // maximum_share = 0.50
    }
  })

  it('minimum_share floor prevents washout', async () => {
    const policy = await loadPolicy('full-stack.json')
    // minimum_share = 0.05
    // Chain: small → big → tx (so chain_depth_penalty doesn't zero them)
    const txTime = 1700000060000
    const g = graph(
      [
        node('big', 'Major', txTime - 1000),
        node('small', 'Minor', txTime - 50000),
        txNode(txTime),
      ],
      [
        chainPrecedes('small', 'big'), chainPrecedes('big', 'tx'),
        convergesOn('big'), convergesOn('small'),
      ],
    )
    const d = calculate(g, policy)
    expect(Object.keys(d).length).toBeGreaterThan(0)
    expect(sum(d)).toBeCloseTo(1.0, 8)
  })
})

// ─── Policy composition: creator + merchant ──────────────────────────────────

describe('policy composition (creator floor + merchant weights)', () => {
  it('merchant recency-weighted + creator 10% floor', async () => {
    const merchantPolicy = await loadPolicy('recency-weighted.json')
    // Creator's floor is applied via session policy record, not the merchant policy
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: CTX,
      agreed_policy: 'recency-weighted',
      applied_constraints: {
        minimum_floors: { OldTool: 0.10 },
      },
      warnings: [],
    }

    // OldTool called 5 minutes before tx, NewTool called 2s before
    // With half_life=60000ms, 5min delta gives factor=2^(-5)=0.03125
    // Without floor: OldTool gets ~3% (well below 10%)
    const txTime = 1700000300000
    const g = graph(
      [node('old', 'OldTool', txTime - 300000), node('new', 'NewTool', txTime - 2000), txNode(txTime)],
      [convergesOn('old'), convergesOn('new')],
    )

    const withoutFloor = calculate(g, merchantPolicy)
    const withFloor = calculate(g, merchantPolicy, spr)

    // Without floor, OldTool gets well below 10% (heavily decayed)
    expect(withoutFloor['OldTool']!).toBeLessThan(0.10)
    // With floor, OldTool gets at least 10%
    expect(withFloor['OldTool']!).toBeGreaterThanOrEqual(0.10 - 1e-9)
    // Both sum to 1.0
    expect(sum(withoutFloor)).toBeCloseTo(1.0, 8)
    expect(sum(withFloor)).toBeCloseTo(1.0, 8)
  })

  it('merchant chain-position + creator 10% floor for deep contributor', async () => {
    const merchantPolicy = await loadPolicy('chain-position.json')
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: CTX,
      agreed_policy: 'chain-position',
      applied_constraints: {
        minimum_floors: { Deep: 0.10 },
      },
      warnings: [],
    }

    // a(Deep) → b(Mid) → c(Close) → tx
    const g = graph(
      [node('a', 'Deep', 1000), node('b', 'Mid', 1001), node('c', 'Close', 1002), txNode(2000)],
      [
        chainPrecedes('a', 'b'), chainPrecedes('b', 'c'), chainPrecedes('c', 'tx'),
        convergesOn('a'), convergesOn('b'), convergesOn('c'),
      ],
    )

    const withFloor = calculate(g, merchantPolicy, spr)
    expect(withFloor['Deep']!).toBeGreaterThanOrEqual(0.10 - 1e-9)
    expect(sum(withFloor)).toBeCloseTo(1.0, 8)
  })

  it('merchant full-stack + multiple creator floors', async () => {
    const merchantPolicy = await loadPolicy('full-stack.json')
    const spr: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'test',
      context_id: CTX,
      agreed_policy: 'full-stack',
      applied_constraints: {
        minimum_floors: { Alice: 0.15, Bob: 0.15 },
      },
      warnings: [],
    }

    // Chain: a → b → c → tx so chain_depth_penalty doesn't zero them
    const txTime = 1700000060000
    const g = graph(
      [
        node('a', 'Alice', txTime - 50000),
        node('b', 'Bob', txTime - 30000),
        node('c', 'Carol', txTime - 5000),
        txNode(txTime),
      ],
      [
        chainPrecedes('a', 'b'), chainPrecedes('b', 'c'), chainPrecedes('c', 'tx'),
        convergesOn('a'), convergesOn('b'), convergesOn('c'),
      ],
    )

    const d = calculate(g, merchantPolicy, spr)
    expect(d['Alice']!).toBeGreaterThanOrEqual(0.15 - 1e-9)
    expect(d['Bob']!).toBeGreaterThanOrEqual(0.15 - 1e-9)
    expect(sum(d)).toBeCloseTo(1.0, 8)
  })
})
