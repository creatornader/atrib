// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { buildGraph } from '../src/graph-builder.js'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  canonicalRecord,
  sha256,
  hexEncode,
  genesisChainRoot,
} from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(42)
const CONTEXT_ID = 'a'.repeat(32)

async function makeRecord(overrides: Partial<{
  context_id: string
  chain_root: string
  event_type: string
  timestamp: number
  session_token: string
  content_id: string
}> = {}) {
  const pk = await getPublicKey(TEST_KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pk),
    chain_root: overrides.chain_root ?? genesisChainRoot(overrides.context_id ?? CONTEXT_ID),
    event_type: (overrides.event_type ?? 'tool_call') as 'tool_call' | 'transaction',
    context_id: overrides.context_id ?? CONTEXT_ID,
    timestamp: overrides.timestamp ?? Date.now(),
    signature: '',
    ...(overrides.session_token ? { session_token: overrides.session_token } : {}),
  }
  return signRecord(record, TEST_KEY)
}

describe('buildGraph (section 3.2.4)', () => {
  it('builds a single-node graph for a genesis record', async () => {
    const record = await makeRecord()
    const graph = await buildGraph([record])

    expect(graph.spec_version).toBe('atrib/1.0')
    expect(graph.node_count).toBe(1)
    expect(graph.edge_count).toBe(0)
    expect(graph.nodes[0]!.is_genesis).toBe(true)
    expect(graph.nodes[0]!.verification_state).toBe('signature_valid')
  })

  it('creates CHAIN_PRECEDES edge for chained records', async () => {
    const r1 = await makeRecord({ timestamp: 1000 })
    const r1Hash = hexEncode(sha256(canonicalRecord(r1)))
    const r2 = await makeRecord({
      chain_root: `sha256:${r1Hash}`,
      timestamp: 2000,
      content_id: `sha256:${'d'.repeat(64)}`,
    })

    const graph = await buildGraph([r1, r2])
    expect(graph.node_count).toBe(2)

    const chainEdges = graph.edges.filter((e) => e.type === 'CHAIN_PRECEDES')
    expect(chainEdges).toHaveLength(1)
    expect(chainEdges[0]!.directed).toBe(true)
  })

  it('creates SESSION_PRECEDES for same-context non-chained records', async () => {
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'e'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2000, content_id: `sha256:${'f'.repeat(64)}` })

    const graph = await buildGraph([r1, r2])
    const sessionEdges = graph.edges.filter((e) => e.type === 'SESSION_PRECEDES')
    expect(sessionEdges.length).toBeGreaterThanOrEqual(1)
  })

  it('creates CONVERGES_ON edges to transaction nodes', async () => {
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'e'.repeat(64)}` })
    const tx = await makeRecord({
      event_type: 'transaction',
      timestamp: 3000,
      content_id: `sha256:${'g'.repeat(64)}`,
    })

    const graph = await buildGraph([r1, tx])
    const convergesEdges = graph.edges.filter((e) => e.type === 'CONVERGES_ON')
    expect(convergesEdges).toHaveLength(1)
    expect(graph.has_transaction).toBe(true)
  })

  it('creates SESSION_PARALLEL for same-context records with identical timestamps', async () => {
    // Same context_id, same timestamp, no chain link. §3.2.4 step 2 places
    // SESSION_PRECEDES only when one timestamp strictly precedes the other.
    // When timestamps are equal, the pair must remain unordered → SESSION_PARALLEL.
    const r1 = await makeRecord({ timestamp: 5000, content_id: `sha256:${'p'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 5000, content_id: `sha256:${'q'.repeat(64)}` })

    const graph = await buildGraph([r1, r2])
    expect(graph.node_count).toBe(2)

    const sessionPrecedes = graph.edges.filter((e) => e.type === 'SESSION_PRECEDES')
    expect(sessionPrecedes).toHaveLength(0)

    const parallels = graph.edges.filter((e) => e.type === 'SESSION_PARALLEL')
    expect(parallels).toHaveLength(1)
    expect(parallels[0]!.directed).toBe(false)
  })

  it('creates CROSS_SESSION edge when transaction session_token matches a tool_call in another context', async () => {
    // Two distinct sessions linked by recommendation_token. CTX_1 has a tool
    // call carrying session_token; CTX_2 has the matching transaction. §3.2.4
    // step 5 must emit a directed CROSS_SESSION edge from the foreign tool
    // call to the transaction.
    const TOKEN = 'cross-session-token-test'
    const FOREIGN_CTX = 'b'.repeat(32)

    const foreignCall = await makeRecord({
      context_id: FOREIGN_CTX,
      timestamp: 1000,
      session_token: TOKEN,
      content_id: `sha256:${'r'.repeat(64)}`,
    })
    const localCall = await makeRecord({
      context_id: CONTEXT_ID,
      timestamp: 2000,
      session_token: TOKEN,
      content_id: `sha256:${'s'.repeat(64)}`,
    })
    const tx = await makeRecord({
      context_id: CONTEXT_ID,
      event_type: 'transaction',
      timestamp: 3000,
      session_token: TOKEN,
      content_id: `sha256:${'t'.repeat(64)}`,
    })

    const graph = await buildGraph([foreignCall, localCall, tx])
    const crossEdges = graph.edges.filter((e) => e.type === 'CROSS_SESSION')
    expect(crossEdges).toHaveLength(1)
    expect(crossEdges[0]!.directed).toBe(true)

    // Source must be the foreign-context tool_call; target must be the
    // in-context transaction.
    const txHash = hexEncode(sha256(canonicalRecord(tx)))
    const foreignHash = hexEncode(sha256(canonicalRecord(foreignCall)))
    expect(crossEdges[0]!.source).toBe(`sha256:${foreignHash}`)
    expect(crossEdges[0]!.target).toBe(`sha256:${txHash}`)
  })

  it('omits CROSS_SESSION when includeCrossSession is false', async () => {
    const TOKEN = 'token-skipped'
    const FOREIGN_CTX = 'c'.repeat(32)
    const foreign = await makeRecord({
      context_id: FOREIGN_CTX,
      timestamp: 1000,
      session_token: TOKEN,
      content_id: `sha256:${'u'.repeat(64)}`,
    })
    const tx = await makeRecord({
      event_type: 'transaction',
      timestamp: 2000,
      session_token: TOKEN,
      content_id: `sha256:${'v'.repeat(64)}`,
    })
    const graph = await buildGraph([foreign, tx], [], { includeCrossSession: false })
    expect(graph.edges.filter((e) => e.type === 'CROSS_SESSION')).toHaveLength(0)
  })

  it('includes gap nodes when requested', async () => {
    const record = await makeRecord()
    const gapNode = {
      type: 'gap_node' as const,
      tool_url: 'https://example.com',
      tool_name: 'search',
      context_id: CONTEXT_ID,
      timestamp: Date.now(),
      signed: false as const,
    }

    const graph = await buildGraph([record], [gapNode])
    expect(graph.node_count).toBe(2)

    const gap = graph.nodes.find((n) => n.event_type === 'gap_node')
    expect(gap).toBeDefined()
    expect(gap!.verification_state).toBe('unsigned')
    expect(gap!.id).toMatch(/^gap:/)
  })

  it('excludes gap nodes when include_gap_nodes is false', async () => {
    const record = await makeRecord()
    const gapNode = {
      type: 'gap_node' as const,
      tool_url: 'https://example.com',
      tool_name: 'search',
      context_id: CONTEXT_ID,
      timestamp: Date.now(),
      signed: false as const,
    }

    const graph = await buildGraph([record], [gapNode], { includeGapNodes: false })
    expect(graph.node_count).toBe(1)
  })

  it('produces deterministic output for identical input', async () => {
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'h'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2000, content_id: `sha256:${'i'.repeat(64)}` })

    const g1 = await buildGraph([r1, r2])
    const g2 = await buildGraph([r2, r1]) // reversed input order

    // Node IDs should match (deterministic hashing)
    const ids1 = g1.nodes.map((n) => n.id).sort()
    const ids2 = g2.nodes.map((n) => n.id).sort()
    expect(ids1).toEqual(ids2)

    // Edge sets should match
    const edgeKey = (e: { type: string; source: string; target: string }) =>
      `${e.type}:${e.source}->${e.target}`
    const edges1 = g1.edges.map(edgeKey).sort()
    const edges2 = g2.edges.map(edgeKey).sort()
    expect(edges1).toEqual(edges2)
  })
})
