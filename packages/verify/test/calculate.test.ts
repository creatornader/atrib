import { describe, it, expect } from 'vitest'
import { calculate, DEFAULT_POLICY, isValidPolicy } from '../src/calculate.js'
import type {
  GraphResponse,
  GraphNode,
  GraphEdge,
  PolicyDocument,
  SessionPolicyRecord,
} from '../src/types.js'

// ─── helpers ────────────────────────────────────────────────────────────────

const CTX = '4bf92f3577b34da6a3ce929d0e0e4736'

function node(
  id: string,
  event_type: GraphNode['event_type'],
  creator_key: string | null,
  ts = 1_000,
  extra: Partial<GraphNode> = {},
): GraphNode {
  const event_type_uri =
    event_type === 'gap_node'
      ? null
      : event_type === 'extension'
        ? 'https://example.com/v1/types/custom'
        : `https://atrib.dev/v1/types/${event_type}`
  return {
    id,
    event_type,
    event_type_uri,
    content_id: event_type === 'gap_node' ? null : `sha256:${id}`,
    creator_key,
    chain_root: event_type === 'gap_node' ? null : `sha256:${'0'.repeat(64)}`,
    context_id: CTX,
    timestamp: ts,
    log_index: event_type === 'gap_node' ? null : 1,
    verification_state: event_type === 'gap_node' ? 'unsigned' : 'signature_valid',
    is_genesis: false,
    ...extra,
  }
}

function edge(type: GraphEdge['type'], source: string, target: string, directed = true): GraphEdge {
  return { type, source, target, directed }
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphResponse {
  return {
    spec_version: 'atrib/1.0',
    context_id: CTX,
    generated_at: 0,
    node_count: nodes.length,
    edge_count: edges.length,
    has_transaction: nodes.some((n) => n.event_type === 'transaction'),
    cross_session_count: 0,
    nodes,
    edges,
  }
}

function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + b, 0)
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('calculate(): preconditions', () => {
  it('returns empty distribution when no transaction node present', () => {
    const g = makeGraph([node('a', 'tool_call', 'KEY_A')], [])
    expect(calculate(g, DEFAULT_POLICY)).toEqual({})
  })

  it('returns empty distribution for empty graph', () => {
    expect(calculate(makeGraph([], []), DEFAULT_POLICY)).toEqual({})
  })
})

describe('calculate(): observation and extension nodes are NOT contributing', () => {
  it('observation records are present in the graph but skipped during contribution selection', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('o', 'observation', 'KEY_O'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'o', 't'), // graph would never emit this in v1, but even if it did, observation is skipped
      ],
    )
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_A']).toBeCloseTo(1.0, 9)
    expect(dist['KEY_O']).toBeUndefined()
  })

  it('extension-typed records are skipped during contribution selection', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('x', 'extension', 'KEY_X'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'x', 't')],
    )
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_A']).toBeCloseTo(1.0, 9)
    expect(dist['KEY_X']).toBeUndefined()
  })
})

describe('calculate(): default policy, equal-weight distribution', () => {
  it('distributes equally between two signed contributors', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'b', 't')],
    )
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_A']).toBeCloseTo(0.5, 9)
    expect(dist['KEY_B']).toBeCloseTo(0.5, 9)
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })

  it('aggregates multiple nodes from the same creator', () => {
    const g = makeGraph(
      [
        node('a1', 'tool_call', 'KEY_A'),
        node('a2', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a1', 't'),
        edge('CONVERGES_ON', 'a2', 't'),
        edge('CONVERGES_ON', 'b', 't'),
      ],
    )
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_A']).toBeCloseTo(2 / 3, 9)
    expect(dist['KEY_B']).toBeCloseTo(1 / 3, 9)
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })

  it('excludes gap nodes under default policy (unsigned weight = 0)', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('g', 'gap_node', null),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'g', 't')],
    )
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_A']).toBeCloseTo(1.0, 9)
    expect(dist['__unsigned__']).toBeUndefined()
  })

  it('includes gap nodes under sentinel key when unsigned weight > 0', () => {
    const policy: PolicyDocument = {
      ...DEFAULT_POLICY,
      edge_weights: { ...DEFAULT_POLICY.edge_weights, unsigned: 1.0 },
    }
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('g', 'gap_node', null),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'g', 't')],
    )
    const dist = calculate(g, policy)
    expect(dist['KEY_A']).toBeCloseTo(0.5, 9)
    expect(dist['__unsigned__']).toBeCloseTo(0.5, 9)
  })

  it('excludes the transaction node itself from the distribution', () => {
    const g = makeGraph(
      [node('a', 'tool_call', 'KEY_A'), node('t', 'transaction', 'KEY_M')],
      [edge('CONVERGES_ON', 'a', 't')],
    )
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_M']).toBeUndefined()
    expect(dist['KEY_A']).toBeCloseTo(1.0, 9)
  })
})

describe('calculate(): determinism (CLAUDE.md invariant #3)', () => {
  it('produces identical output across runs on identical input', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('c', 'tool_call', 'KEY_C'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
        edge('CONVERGES_ON', 'c', 't'),
      ],
    )
    const r1 = JSON.stringify(calculate(g, DEFAULT_POLICY))
    const r2 = JSON.stringify(calculate(g, DEFAULT_POLICY))
    const r3 = JSON.stringify(calculate(g, DEFAULT_POLICY))
    expect(r1).toBe(r2)
    expect(r2).toBe(r3)
  })

  it('produces stable JSON key ordering regardless of input node order', () => {
    const nodes1 = [
      node('a', 'tool_call', 'KEY_Z'),
      node('b', 'tool_call', 'KEY_A'),
      node('t', 'transaction', 'KEY_M'),
    ]
    const nodes2 = [
      node('t', 'transaction', 'KEY_M'),
      node('b', 'tool_call', 'KEY_A'),
      node('a', 'tool_call', 'KEY_Z'),
    ]
    const edges = [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'b', 't')]
    const r1 = JSON.stringify(calculate(makeGraph(nodes1, edges), DEFAULT_POLICY))
    const r2 = JSON.stringify(calculate(makeGraph(nodes2, edges), DEFAULT_POLICY))
    expect(r1).toBe(r2)
  })
})

describe('calculate(): edge type max() weighting (§4.2.2)', () => {
  it('uses max(edge_weights) when a node has multiple paths to transaction', () => {
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: {
        CHAIN_PRECEDES: 5.0,
        CONVERGES_ON: 1.0,
        SESSION_PARALLEL: 0.5,
        SESSION_PRECEDES: 0.5,
        unsigned: 0,
      },
    }
    // a → t via CHAIN_PRECEDES (weight 5.0) AND CONVERGES_ON (weight 1.0)
    // b → t only via CONVERGES_ON (weight 1.0)
    // a's max weight is 5.0, b's max weight is 1.0
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CHAIN_PRECEDES', 'a', 't'),
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
      ],
    )
    const dist = calculate(g, policy)
    // raw scores: a=5.0, b=1.0 → fractions a=5/6, b=1/6
    expect(dist['KEY_A']).toBeCloseTo(5 / 6, 9)
    expect(dist['KEY_B']).toBeCloseTo(1 / 6, 9)
  })
})

describe('calculate(): modifiers (§4.6.3)', () => {
  it('temporal_decay halves score per half-life', () => {
    // tx at t=2000, contributor at t=1000, half_life=1000 → factor 0.5
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'temporal_decay', half_life_ms: 1000 }],
    }
    const g = makeGraph(
      [
        node('decayed', 'tool_call', 'KEY_OLD', 1000),
        node('fresh', 'tool_call', 'KEY_NEW', 2000),
        node('t', 'transaction', 'KEY_M', 2000),
      ],
      [edge('CONVERGES_ON', 'decayed', 't'), edge('CONVERGES_ON', 'fresh', 't')],
    )
    const dist = calculate(g, policy)
    // raw: decayed = 1.0 * 2^-1 = 0.5, fresh = 1.0 * 2^0 = 1.0
    // normalized: 0.5/1.5, 1.0/1.5
    expect(dist['KEY_OLD']).toBeCloseTo(1 / 3, 9)
    expect(dist['KEY_NEW']).toBeCloseTo(2 / 3, 9)
  })

  it('temporal_decay zeroes out nodes after the transaction', () => {
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'temporal_decay', half_life_ms: 1000 }],
    }
    const g = makeGraph(
      [
        node('past', 'tool_call', 'KEY_PAST', 1000),
        node('future', 'tool_call', 'KEY_FUTURE', 5000),
        node('t', 'transaction', 'KEY_M', 2000),
      ],
      [edge('CONVERGES_ON', 'past', 't'), edge('CONVERGES_ON', 'future', 't')],
    )
    const dist = calculate(g, policy)
    expect(dist['KEY_FUTURE']).toBeUndefined()
    expect(dist['KEY_PAST']).toBeCloseTo(1.0, 9)
  })

  it('ignores unknown modifier types (§4.6.3 last line)', () => {
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'mystery_modifier', some_field: 99 }],
    }
    const g = makeGraph(
      [node('a', 'tool_call', 'KEY_A'), node('t', 'transaction', 'KEY_M')],
      [edge('CONVERGES_ON', 'a', 't')],
    )
    const dist = calculate(g, policy)
    expect(dist['KEY_A']).toBeCloseTo(1.0, 9)
  })
})

describe('calculate(): constraints (§4.6.4). node-level', () => {
  // §4.6.4 minimum_share / maximum_share apply to per-NODE normalized fractions
  // BEFORE aggregation by creator. Tests use distinct creators per node so the
  // post-aggregation distribution matches the per-node distribution.

  it('applies minimum_share floor to under-floor nodes', () => {
    // Two nodes: weight 10 (heavy) and weight 1 (light)
    // raw normalized: heavy=10/11≈0.909, light=1/11≈0.091
    // minimum_share=0.2: light is below, boost to 0.2; heavy scaled to 0.8
    const heavyPolicy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CHAIN_PRECEDES: 10.0, CONVERGES_ON: 1.0, unsigned: 0 },
      constraints: { minimum_share: 0.2 },
    }
    const g = makeGraph(
      [
        node('heavy', 'tool_call', 'KEY_HEAVY'),
        node('light', 'tool_call', 'KEY_LIGHT'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        // heavy gets a CHAIN_PRECEDES edge → max(10, 1) = 10
        edge('CHAIN_PRECEDES', 'heavy', 't'),
        edge('CONVERGES_ON', 'heavy', 't'),
        // light only has CONVERGES_ON → 1
        edge('CONVERGES_ON', 'light', 't'),
      ],
    )
    const dist = calculate(g, heavyPolicy)
    expect(dist['KEY_LIGHT']).toBeCloseTo(0.2, 9)
    expect(dist['KEY_HEAVY']).toBeCloseTo(0.8, 9)
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })

  it('applies maximum_share cap to over-cap nodes', () => {
    // Same shape but raw weights 10 vs 5 → normalized 0.667, 0.333
    // Cap heavy at 0.6, redistribute 0.067 → light becomes 0.4
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CHAIN_PRECEDES: 10.0, CONVERGES_ON: 5.0, unsigned: 0 },
      constraints: { maximum_share: 0.6 },
    }
    // §3.2.4 step 4: every non-tx node in a session with a tx gets a CONVERGES_ON
    const g = makeGraph(
      [
        node('heavy', 'tool_call', 'KEY_HEAVY'),
        node('light', 'tool_call', 'KEY_LIGHT'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CHAIN_PRECEDES', 'heavy', 't'),
        edge('CONVERGES_ON', 'heavy', 't'),
        edge('CONVERGES_ON', 'light', 't'),
      ],
    )
    const dist = calculate(g, policy)
    expect(dist['KEY_HEAVY']).toBeCloseTo(0.6, 9)
    expect(dist['KEY_LIGHT']).toBeCloseTo(0.4, 9)
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })

  it('falls back to equal distribution when floor cannot be honored', () => {
    // Three nodes all with equal weight 1 → raw 1/3 each
    // Floor 0.5. impossible to give all three at least 0.5 (sum 1.5 > 1.0)
    // Equal-distribution fallback: each = 1/3
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
      constraints: { minimum_share: 0.5 },
    }
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('c', 'tool_call', 'KEY_C'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
        edge('CONVERGES_ON', 'c', 't'),
      ],
    )
    const dist = calculate(g, policy)
    expect(dist['KEY_A']).toBeCloseTo(1 / 3, 9)
    expect(dist['KEY_B']).toBeCloseTo(1 / 3, 9)
    expect(dist['KEY_C']).toBeCloseTo(1 / 3, 9)
  })
})

describe('calculate(): creator floors (§4.6.7)', () => {
  it('boosts a creator to its floor and scales others down', () => {
    const sessionPolicy: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'sha256:abc',
      context_id: CTX,
      agreed_policy: 'default',
      applied_constraints: { minimum_floors: { KEY_B: 0.3 } },
      warnings: [],
    }
    // 4 nodes for A, 1 for B → raw fractions A=0.8, B=0.2
    // Floor B at 0.3 → A=0.7, B=0.3
    const g = makeGraph(
      [
        node('a1', 'tool_call', 'KEY_A'),
        node('a2', 'tool_call', 'KEY_A'),
        node('a3', 'tool_call', 'KEY_A'),
        node('a4', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a1', 't'),
        edge('CONVERGES_ON', 'a2', 't'),
        edge('CONVERGES_ON', 'a3', 't'),
        edge('CONVERGES_ON', 'a4', 't'),
        edge('CONVERGES_ON', 'b', 't'),
      ],
    )
    const dist = calculate(g, DEFAULT_POLICY, sessionPolicy)
    expect(dist['KEY_B']).toBeCloseTo(0.3, 9)
    expect(dist['KEY_A']).toBeCloseTo(0.7, 9)
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })

  it('does not modify distribution when all creators already meet floors', () => {
    const sessionPolicy: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'sha256:abc',
      context_id: CTX,
      agreed_policy: 'default',
      applied_constraints: { minimum_floors: { KEY_A: 0.1, KEY_B: 0.1 } },
      warnings: [],
    }
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'b', 't')],
    )
    const dist = calculate(g, DEFAULT_POLICY, sessionPolicy)
    expect(dist['KEY_A']).toBeCloseTo(0.5, 9)
    expect(dist['KEY_B']).toBeCloseTo(0.5, 9)
  })

  it('skips floors for creators not present in the graph', () => {
    const sessionPolicy: SessionPolicyRecord = {
      spec_version: 'atrib/1.0',
      record_id: 'sha256:abc',
      context_id: CTX,
      agreed_policy: 'default',
      // KEY_NOT_HERE didn't contribute; floor should be ignored
      applied_constraints: { minimum_floors: { KEY_NOT_HERE: 0.5 } },
      warnings: [],
    }
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'b', 't')],
    )
    const dist = calculate(g, DEFAULT_POLICY, sessionPolicy)
    expect(dist['KEY_A']).toBeCloseTo(0.5, 9)
    expect(dist['KEY_B']).toBeCloseTo(0.5, 9)
    expect(dist['KEY_NOT_HERE']).toBeUndefined()
  })
})

describe('calculate(): chain_depth_penalty modifier (§4.6.3)', () => {
  it('penalizes nodes by their chain depth from a transaction', () => {
    // Build a chain: a → b → c → t
    // Depths via CHAIN_PRECEDES from each node to t:
    //   a: 3, b: 2, c: 1, (t itself: 0)
    // penalty_per_level = 0.25:
    //   a: factor = 1 - 3*0.25 = 0.25
    //   b: factor = 1 - 2*0.25 = 0.5
    //   c: factor = 1 - 1*0.25 = 0.75
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CHAIN_PRECEDES: 1.0, CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 0.25 }],
    }
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('c', 'tool_call', 'KEY_C'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CHAIN_PRECEDES', 'a', 'b'),
        edge('CHAIN_PRECEDES', 'b', 'c'),
        edge('CHAIN_PRECEDES', 'c', 't'),
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
        edge('CONVERGES_ON', 'c', 't'),
      ],
    )
    const dist = calculate(g, policy)
    // Raw scores: a=0.25, b=0.5, c=0.75; total=1.5
    // Normalized: a=1/6, b=2/6, c=3/6
    expect(dist['KEY_A']).toBeCloseTo(1 / 6, 9)
    expect(dist['KEY_B']).toBeCloseTo(2 / 6, 9)
    expect(dist['KEY_C']).toBeCloseTo(3 / 6, 9)
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })

  it('zeroes out nodes when chain depth × penalty exceeds 1.0', () => {
    // 5 hops × penalty 0.25 = 1.25 > 1.0 → factor clamped to 0
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CHAIN_PRECEDES: 1.0, CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'chain_depth_penalty', penalty_per_level: 0.25 }],
    }
    // a → b → c → d → e → t : a is 5 hops away
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('c', 'tool_call', 'KEY_C'),
        node('d', 'tool_call', 'KEY_D'),
        node('e', 'tool_call', 'KEY_E'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CHAIN_PRECEDES', 'a', 'b'),
        edge('CHAIN_PRECEDES', 'b', 'c'),
        edge('CHAIN_PRECEDES', 'c', 'd'),
        edge('CHAIN_PRECEDES', 'd', 'e'),
        edge('CHAIN_PRECEDES', 'e', 't'),
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
        edge('CONVERGES_ON', 'c', 't'),
        edge('CONVERGES_ON', 'd', 't'),
        edge('CONVERGES_ON', 'e', 't'),
      ],
    )
    const dist = calculate(g, policy)
    // KEY_A is 5 hops out → factor 0 → no share
    expect(dist['KEY_A']).toBeUndefined()
    expect(sumValues(dist)).toBeCloseTo(1.0, 9)
  })
})

describe('calculate(): call_count_boost modifier (§4.6.3)', () => {
  it('boosts nodes that share content_id with other nodes', () => {
    // Three calls to the same tool (same content_id), one to a different one.
    // multiplier_per_call=0.5, cap=10:
    //   shared content_id: count=3, factor = min(10, 1 + (3-1)*0.5) = 2.0
    //   solo: count=1, factor = min(10, 1 + 0) = 1.0
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'call_count_boost', multiplier_per_call: 0.5, cap: 10 }],
    }
    const sharedCid = 'sha256:shared'
    const g = makeGraph(
      [
        { ...node('a', 'tool_call', 'KEY_A'), content_id: sharedCid },
        { ...node('b', 'tool_call', 'KEY_A'), content_id: sharedCid },
        { ...node('c', 'tool_call', 'KEY_A'), content_id: sharedCid },
        { ...node('d', 'tool_call', 'KEY_B'), content_id: 'sha256:solo' },
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
        edge('CONVERGES_ON', 'c', 't'),
        edge('CONVERGES_ON', 'd', 't'),
      ],
    )
    const dist = calculate(g, policy)
    // Per-node scores: a=b=c=2.0, d=1.0 → total=7.0
    // Normalized: each shared = 2/7, solo = 1/7
    // KEY_A = 3 * (2/7) = 6/7, KEY_B = 1/7
    expect(dist['KEY_A']).toBeCloseTo(6 / 7, 9)
    expect(dist['KEY_B']).toBeCloseTo(1 / 7, 9)
  })

  it('respects the cap on the call_count_boost factor', () => {
    // Many calls to same content_id with multiplier_per_call=1.0, cap=2.0
    // factor = min(2.0, 1 + (10-1)*1.0) = 2.0 (capped)
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 0 },
      modifiers: [{ type: 'call_count_boost', multiplier_per_call: 1.0, cap: 2.0 }],
    }
    const cid = 'sha256:shared'
    const sharedNodes = Array.from({ length: 10 }, (_, i) => ({
      ...node(`a${i}`, 'tool_call', 'KEY_A'),
      content_id: cid,
    }))
    const g = makeGraph(
      [...sharedNodes, node('solo', 'tool_call', 'KEY_B'), node('t', 'transaction', 'KEY_M')],
      [
        ...sharedNodes.map((n) => edge('CONVERGES_ON', n.id, 't')),
        edge('CONVERGES_ON', 'solo', 't'),
      ],
    )
    const dist = calculate(g, policy)
    // Each shared node: factor = 2 (capped) → score 2.0; solo: 1.0
    // Total = 10*2 + 1 = 21; KEY_A = 20/21, KEY_B = 1/21
    expect(dist['KEY_A']).toBeCloseTo(20 / 21, 9)
    expect(dist['KEY_B']).toBeCloseTo(1 / 21, 9)
  })
})

describe('calculate(): edge cases', () => {
  it('returns empty distribution when all contributors are gap nodes under zero weight', () => {
    const g = makeGraph(
      [
        node('g1', 'gap_node', null),
        node('g2', 'gap_node', null),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'g1', 't'), edge('CONVERGES_ON', 'g2', 't')],
    )
    expect(calculate(g, DEFAULT_POLICY)).toEqual({})
  })

  it('handles CROSS_SESSION edges as contributing edges', () => {
    // Node a is in a different session but linked via session_token
    const otherCtx = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const aCross: GraphNode = {
      ...node('a', 'tool_call', 'KEY_CROSS'),
      context_id: otherCtx, // different session
    }
    const g = makeGraph(
      [aCross, node('b', 'tool_call', 'KEY_LOCAL'), node('t', 'transaction', 'KEY_M')],
      [edge('CROSS_SESSION', 'a', 't'), edge('CONVERGES_ON', 'b', 't')],
    )
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CROSS_SESSION: 1.0, CONVERGES_ON: 1.0, unsigned: 0 },
    }
    const dist = calculate(g, policy)
    expect(dist['KEY_CROSS']).toBeCloseTo(0.5, 9)
    expect(dist['KEY_LOCAL']).toBeCloseTo(0.5, 9)
  })

  it('handles multi-transaction graph (uses first tx for modifier reference)', () => {
    // Locks in current behavior. multi-tx is v2 deferred but we should not crash
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('t1', 'transaction', 'KEY_M', 1000),
        node('t2', 'transaction', 'KEY_M', 2000),
      ],
      [edge('CONVERGES_ON', 'a', 't1'), edge('CONVERGES_ON', 'a', 't2')],
    )
    expect(() => calculate(g, DEFAULT_POLICY)).not.toThrow()
    const dist = calculate(g, DEFAULT_POLICY)
    expect(dist['KEY_A']).toBeCloseTo(1.0, 9)
  })

  it('preserves __unsigned__ sentinel sorted with creator keys', () => {
    const policy: PolicyDocument = {
      spec_version: 'atrib/1.0',
      edge_weights: { CONVERGES_ON: 1.0, unsigned: 1.0 },
    }
    const g = makeGraph(
      [
        node('z', 'tool_call', 'ZZZ_KEY'),
        node('g', 'gap_node', null),
        node('a', 'tool_call', 'AAA_KEY'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'z', 't'),
        edge('CONVERGES_ON', 'g', 't'),
        edge('CONVERGES_ON', 'a', 't'),
      ],
    )
    const dist = calculate(g, policy)
    // All three have equal share
    expect(dist['AAA_KEY']).toBeCloseTo(1 / 3, 9)
    expect(dist['ZZZ_KEY']).toBeCloseTo(1 / 3, 9)
    expect(dist['__unsigned__']).toBeCloseTo(1 / 3, 9)
    // Stable JSON ordering: keys sorted alphabetically
    const keys = Object.keys(dist)
    expect(keys).toEqual([...keys].sort())
  })
})

describe('isValidPolicy + §4.6.1 fall-back to default', () => {
  it('accepts the default policy', () => {
    expect(isValidPolicy(DEFAULT_POLICY)).toBe(true)
  })

  it('rejects null/undefined/non-object', () => {
    expect(isValidPolicy(null)).toBe(false)
    expect(isValidPolicy(undefined)).toBe(false)
    expect(isValidPolicy('not a policy')).toBe(false)
    expect(isValidPolicy(42)).toBe(false)
  })

  it('rejects wrong spec_version', () => {
    expect(isValidPolicy({ spec_version: 'atrib/0.9' })).toBe(false)
    expect(isValidPolicy({ spec_version: 'unknown' })).toBe(false)
    expect(isValidPolicy({})).toBe(false)
  })

  it('rejects negative edge weights', () => {
    expect(
      isValidPolicy({
        spec_version: 'atrib/1.0',
        edge_weights: { CONVERGES_ON: -1.0 },
      }),
    ).toBe(false)
  })

  it('rejects negative constraint values', () => {
    expect(
      isValidPolicy({
        spec_version: 'atrib/1.0',
        constraints: { minimum_share: -0.1 },
      }),
    ).toBe(false)
  })

  it('rejects minimum_share > maximum_share', () => {
    expect(
      isValidPolicy({
        spec_version: 'atrib/1.0',
        constraints: { minimum_share: 0.6, maximum_share: 0.4 },
      }),
    ).toBe(false)
  })

  it('rejects NaN values in edge weights or constraints', () => {
    expect(
      isValidPolicy({
        spec_version: 'atrib/1.0',
        edge_weights: { CONVERGES_ON: NaN },
      }),
    ).toBe(false)
  })

  it('falls back to default when calculate() receives invalid policy', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [edge('CONVERGES_ON', 'a', 't'), edge('CONVERGES_ON', 'b', 't')],
    )
    // Pass an invalid policy: contradictory constraints
    const badPolicy = {
      spec_version: 'atrib/1.0' as const,
      constraints: { minimum_share: 0.9, maximum_share: 0.1 },
    }
    const dist = calculate(g, badPolicy)
    // Should match default policy result: equal split
    expect(dist['KEY_A']).toBeCloseTo(0.5, 9)
    expect(dist['KEY_B']).toBeCloseTo(0.5, 9)
  })
})

describe('calculate(): distribution always sums to 1.0', () => {
  it('every output sums to 1.0 within tolerance', () => {
    const g = makeGraph(
      [
        node('a', 'tool_call', 'KEY_A'),
        node('b', 'tool_call', 'KEY_B'),
        node('c', 'tool_call', 'KEY_C'),
        node('d', 'tool_call', 'KEY_D'),
        node('e', 'tool_call', 'KEY_E'),
        node('t', 'transaction', 'KEY_M'),
      ],
      [
        edge('CONVERGES_ON', 'a', 't'),
        edge('CONVERGES_ON', 'b', 't'),
        edge('CONVERGES_ON', 'c', 't'),
        edge('CONVERGES_ON', 'd', 't'),
        edge('CONVERGES_ON', 'e', 't'),
      ],
    )
    expect(sumValues(calculate(g, DEFAULT_POLICY))).toBeCloseTo(1.0, 9)
  })
})
