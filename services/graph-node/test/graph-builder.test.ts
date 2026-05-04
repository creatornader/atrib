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
  informed_by: string[]
  provenance_token: string
  annotates: string
}> = {}) {
  const pk = await getPublicKey(TEST_KEY)
  // JCS sorts keys lexicographically. `annotates` (a) sorts before
  // `chain_root` (c), so when present it must appear earlier in the
  // object literal we hand to signRecord.
  const record = {
    spec_version: 'atrib/1.0' as const,
    ...(overrides.annotates ? { annotates: overrides.annotates } : {}),
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pk),
    chain_root: overrides.chain_root ?? genesisChainRoot(overrides.context_id ?? CONTEXT_ID),
    event_type: overrides.event_type ?? 'https://atrib.dev/v1/types/tool_call',
    context_id: overrides.context_id ?? CONTEXT_ID,
    timestamp: overrides.timestamp ?? Date.now(),
    signature: '',
    ...(overrides.informed_by ? { informed_by: overrides.informed_by } : {}),
    ...(overrides.provenance_token ? { provenance_token: overrides.provenance_token } : {}),
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
      event_type: 'https://atrib.dev/v1/types/transaction',
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
      event_type: 'https://atrib.dev/v1/types/transaction',
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
      event_type: 'https://atrib.dev/v1/types/transaction',
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

  // ───────────────────────────────────────────────────────────────────────
  // Step 6: INFORMED_BY (D041, spec §3.2.4)
  // ───────────────────────────────────────────────────────────────────────

  describe('INFORMED_BY edges (D041, §3.2.4 step 6)', () => {
    it('creates INFORMED_BY edge when target record exists in resolved set', async () => {
      const upstream = await makeRecord({
        timestamp: 1000,
        content_id: `sha256:${'1'.repeat(64)}`,
      })
      const upstreamHash = hexEncode(sha256(canonicalRecord(upstream)))
      const consumer = await makeRecord({
        timestamp: 2000,
        content_id: `sha256:${'2'.repeat(64)}`,
        informed_by: [`sha256:${upstreamHash}`],
      })

      const graph = await buildGraph([upstream, consumer])
      const informedEdges = graph.edges.filter((e) => e.type === 'INFORMED_BY')
      expect(informedEdges).toHaveLength(1)
      expect(informedEdges[0]!.source).toBe(`sha256:${hexEncode(sha256(canonicalRecord(consumer)))}`)
      expect(informedEdges[0]!.target).toBe(`sha256:${upstreamHash}`)
      expect(informedEdges[0]!.directed).toBe(true)
      expect(informedEdges[0]!.dangling).toBeUndefined()
    })

    it('creates dangling INFORMED_BY edge to synthetic node when target missing', async () => {
      const consumer = await makeRecord({
        timestamp: 1000,
        informed_by: [`sha256:${'9'.repeat(64)}`], // hash that does not exist
      })

      const graph = await buildGraph([consumer])
      const informedEdges = graph.edges.filter((e) => e.type === 'INFORMED_BY')
      expect(informedEdges).toHaveLength(1)
      expect(informedEdges[0]!.dangling).toBe(true)
      expect(informedEdges[0]!.target).toMatch(/^dangling:sha256:9{64}$/)

      // The synthetic dangling node was added to the nodes list
      const danglingNode = graph.nodes.find((n) => n.id === informedEdges[0]!.target)
      expect(danglingNode).toBeDefined()
      expect(danglingNode!.event_type).toBe('dangling_node')
    })

    it('emits one INFORMED_BY edge per entry in the array (multi-source)', async () => {
      const u1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'a'.repeat(64)}` })
      const u2 = await makeRecord({ timestamp: 1500, content_id: `sha256:${'b'.repeat(64)}` })
      const u1Hash = hexEncode(sha256(canonicalRecord(u1)))
      const u2Hash = hexEncode(sha256(canonicalRecord(u2)))
      const consumer = await makeRecord({
        timestamp: 2000,
        content_id: `sha256:${'d'.repeat(64)}`,
        informed_by: [`sha256:${u1Hash}`, `sha256:${u2Hash}`],
      })

      const graph = await buildGraph([u1, u2, consumer])
      const informedEdges = graph.edges.filter((e) => e.type === 'INFORMED_BY')
      expect(informedEdges).toHaveLength(2)
      const targets = informedEdges.map((e) => e.target).sort()
      expect(targets).toEqual([`sha256:${u1Hash}`, `sha256:${u2Hash}`].sort())
    })

    it('creates INFORMED_BY edges across creator_keys and context_ids (cross-repo case)', async () => {
      // The Loop 5 motivation: an emission in one context_id references an
      // upstream record in a different context_id (and conceptually a
      // different signer). The graph layer derives the edge regardless of
      // whether they share creator_key or context_id.
      const upstream = await makeRecord({
        context_id: 'a'.repeat(32),
        timestamp: 1000,
        content_id: `sha256:${'5'.repeat(64)}`,
      })
      const upstreamHash = hexEncode(sha256(canonicalRecord(upstream)))
      const consumer = await makeRecord({
        context_id: 'b'.repeat(32),
        timestamp: 2000,
        content_id: `sha256:${'6'.repeat(64)}`,
        informed_by: [`sha256:${upstreamHash}`],
      })

      const graph = await buildGraph([upstream, consumer])
      const informedEdges = graph.edges.filter((e) => e.type === 'INFORMED_BY')
      expect(informedEdges).toHaveLength(1)
      expect(informedEdges[0]!.dangling).toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Step 7: PROVENANCE_OF (D044, spec §3.2.4)
  // ───────────────────────────────────────────────────────────────────────

  describe('PROVENANCE_OF edges (D044, §3.2.4 step 7)', () => {
    it('creates PROVENANCE_OF edge when token resolves to upstream in different context_id', async () => {
      const upstream = await makeRecord({
        context_id: 'a'.repeat(32),
        timestamp: 1000,
        content_id: `sha256:${'7'.repeat(64)}`,
      })
      const upstreamBytes = sha256(canonicalRecord(upstream))
      const provToken = base64urlEncode(upstreamBytes.slice(0, 16))

      const descendant = await makeRecord({
        context_id: 'b'.repeat(32),
        timestamp: 2000,
        content_id: `sha256:${'8'.repeat(64)}`,
        provenance_token: provToken,
      })

      const graph = await buildGraph([upstream, descendant])
      const provEdges = graph.edges.filter((e) => e.type === 'PROVENANCE_OF')
      expect(provEdges).toHaveLength(1)
      expect(provEdges[0]!.source).toBe(`sha256:${hexEncode(sha256(canonicalRecord(descendant)))}`)
      expect(provEdges[0]!.target).toBe(`sha256:${hexEncode(upstreamBytes)}`)
      expect(provEdges[0]!.directed).toBe(true)
      expect(provEdges[0]!.dangling).toBeUndefined()
    })

    it('creates dangling PROVENANCE_OF edge with reason when token does not resolve', async () => {
      const descendant = await makeRecord({
        context_id: 'b'.repeat(32),
        timestamp: 1000,
        provenance_token: 'AAAAAAAAAAAAAAAAAAAAAA', // 22 base64url chars = 16 random bytes
      })

      const graph = await buildGraph([descendant])
      const provEdges = graph.edges.filter((e) => e.type === 'PROVENANCE_OF')
      expect(provEdges).toHaveLength(1)
      expect(provEdges[0]!.dangling).toBe(true)
      expect(provEdges[0]!.reason).toBe('no_token_source_in_record_set')
      const danglingNode = graph.nodes.find((n) => n.id === provEdges[0]!.target)
      expect(danglingNode!.event_type).toBe('dangling_node')
    })

    it('does NOT create PROVENANCE_OF when upstream is in the same context_id', async () => {
      // Spec invariant: PROVENANCE_OF targets must differ in context_id.
      // If a record references its own session as the anchor, that is an
      // intra-session relationship covered by CHAIN_PRECEDES, not provenance.
      const upstream = await makeRecord({
        context_id: 'c'.repeat(32),
        timestamp: 1000,
        content_id: `sha256:${'a'.repeat(64)}`,
      })
      const upstreamToken = base64urlEncode(sha256(canonicalRecord(upstream)).slice(0, 16))
      const descendant = await makeRecord({
        context_id: 'c'.repeat(32), // SAME context_id
        timestamp: 2000,
        content_id: `sha256:${'b'.repeat(64)}`,
        provenance_token: upstreamToken,
      })

      const graph = await buildGraph([upstream, descendant])
      // No PROVENANCE_OF edge to the in-same-context upstream
      const resolvedProvEdges = graph.edges.filter(
        (e) => e.type === 'PROVENANCE_OF' && !e.dangling,
      )
      expect(resolvedProvEdges).toHaveLength(0)
      // Per spec, dangling edge IS still emitted (the agent's claim is visible)
      const danglingProvEdges = graph.edges.filter(
        (e) => e.type === 'PROVENANCE_OF' && e.dangling,
      )
      expect(danglingProvEdges).toHaveLength(1)
    })

    it('skips non-genesis records carrying provenance_token (malformed per §1.2.6)', async () => {
      // Validators MUST reject non-genesis records carrying provenance_token.
      // The graph layer follows suit: such records do not participate in
      // PROVENANCE_OF derivation. The middleware would normally never emit
      // such a record, but a malformed historical record could appear.
      const r1 = await makeRecord({
        context_id: 'a'.repeat(32),
        timestamp: 1000,
        content_id: `sha256:${'1'.repeat(64)}`,
      })
      const r1Hash = hexEncode(sha256(canonicalRecord(r1)))
      // r2 is non-genesis (chain_root -> r1) but ALSO carries provenance_token.
      const r2 = await makeRecord({
        context_id: 'a'.repeat(32),
        chain_root: `sha256:${r1Hash}`,
        timestamp: 2000,
        content_id: `sha256:${'2'.repeat(64)}`,
        provenance_token: 'BBBBBBBBBBBBBBBBBBBBBB',
      })

      const graph = await buildGraph([r1, r2])
      const provEdges = graph.edges.filter((e) => e.type === 'PROVENANCE_OF')
      expect(provEdges).toHaveLength(0) // skipped entirely
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Step 8: ANNOTATES (D058, spec §3.2.4)
  // ───────────────────────────────────────────────────────────────────────

  describe('ANNOTATES edges (D058, §3.2.4 step 8)', () => {
    it('creates ANNOTATES edge when target record exists in resolved set', async () => {
      const target = await makeRecord({
        timestamp: 1000,
        content_id: `sha256:${'1'.repeat(64)}`,
      })
      const targetHash = hexEncode(sha256(canonicalRecord(target)))
      const annotation = await makeRecord({
        event_type: 'https://atrib.dev/v1/types/annotation',
        timestamp: 2000,
        content_id: `sha256:${'2'.repeat(64)}`,
        annotates: `sha256:${targetHash}`,
      })

      const graph = await buildGraph([target, annotation])
      const annotateEdges = graph.edges.filter((e) => e.type === 'ANNOTATES')
      expect(annotateEdges).toHaveLength(1)
      expect(annotateEdges[0]!.source).toBe(`sha256:${hexEncode(sha256(canonicalRecord(annotation)))}`)
      expect(annotateEdges[0]!.target).toBe(`sha256:${targetHash}`)
      expect(annotateEdges[0]!.directed).toBe(true)
      expect(annotateEdges[0]!.dangling).toBeUndefined()
    })

    it('creates dangling ANNOTATES edge when target missing', async () => {
      const annotation = await makeRecord({
        event_type: 'https://atrib.dev/v1/types/annotation',
        timestamp: 1000,
        annotates: `sha256:${'9'.repeat(64)}`,
      })

      const graph = await buildGraph([annotation])
      const annotateEdges = graph.edges.filter((e) => e.type === 'ANNOTATES')
      expect(annotateEdges).toHaveLength(1)
      expect(annotateEdges[0]!.dangling).toBe(true)
      expect(annotateEdges[0]!.target).toMatch(/^dangling:sha256:9{64}$/)
    })

    it('does NOT derive ANNOTATES from non-annotation records carrying annotates field', async () => {
      // Validators MUST reject `annotates` on any event_type other than
      // annotation (per §1.2.8). The graph layer follows suit: such records
      // do not participate in ANNOTATES derivation. Tests defensive behavior
      // against malformed historical records.
      const target = await makeRecord({
        timestamp: 1000,
        content_id: `sha256:${'a'.repeat(64)}`,
      })
      const targetHash = hexEncode(sha256(canonicalRecord(target)))
      const malformed = await makeRecord({
        event_type: 'https://atrib.dev/v1/types/tool_call', // NOT annotation
        timestamp: 2000,
        content_id: `sha256:${'b'.repeat(64)}`,
        annotates: `sha256:${targetHash}`, // illegal on non-annotation
      })

      const graph = await buildGraph([target, malformed])
      const annotateEdges = graph.edges.filter((e) => e.type === 'ANNOTATES')
      expect(annotateEdges).toHaveLength(0)
    })

    it('multiple annotations of the same target produce multiple edges', async () => {
      const target = await makeRecord({
        timestamp: 1000,
        content_id: `sha256:${'1'.repeat(64)}`,
      })
      const targetHash = hexEncode(sha256(canonicalRecord(target)))
      const ann1 = await makeRecord({
        event_type: 'https://atrib.dev/v1/types/annotation',
        timestamp: 2000,
        content_id: `sha256:${'2'.repeat(64)}`,
        annotates: `sha256:${targetHash}`,
      })
      const ann2 = await makeRecord({
        event_type: 'https://atrib.dev/v1/types/annotation',
        timestamp: 3000,
        content_id: `sha256:${'3'.repeat(64)}`,
        annotates: `sha256:${targetHash}`,
      })

      const graph = await buildGraph([target, ann1, ann2])
      const annotateEdges = graph.edges.filter((e) => e.type === 'ANNOTATES')
      expect(annotateEdges).toHaveLength(2)
    })
  })

  // ───────────────────────────────────────────────────────────────────────
  // Regression guard: all 8 spec-mandated edge types are reachable
  // ───────────────────────────────────────────────────────────────────────

  it('regression: all 8 spec edge types are derivable from a complete fixture', async () => {
    // Constructs a fixture that exercises every step of §3.2.4. If any step
    // ever silently regresses to "implementation missing," this test fails.
    // The two cross-session edges (CROSS_SESSION via shared session_token,
    // PROVENANCE_OF via provenance_token) live in distinct context_ids.
    const sessionToken = 'STSTSTSTSTSTSTSTSTSTSt'

    // Session A: a tx, a related tool_call (CONVERGES_ON), and a chained successor
    const txA = await makeRecord({
      context_id: 'a'.repeat(32),
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 1000,
      content_id: `sha256:${'1'.repeat(64)}`,
      session_token: sessionToken,
    })
    const toolA1 = await makeRecord({
      context_id: 'a'.repeat(32),
      timestamp: 1500,
      content_id: `sha256:${'2'.repeat(64)}`,
    })
    const toolA1Hash = hexEncode(sha256(canonicalRecord(toolA1)))
    const toolA2 = await makeRecord({
      context_id: 'a'.repeat(32),
      chain_root: `sha256:${toolA1Hash}`, // CHAIN_PRECEDES toolA1 -> toolA2
      timestamp: 2000,
      content_id: `sha256:${'3'.repeat(64)}`,
    })

    // Session B: a tool_call (with session_token to force CROSS_SESSION) and
    // a separate genesis record that anchors to session A via provenance_token.
    const toolB = await makeRecord({
      context_id: 'b'.repeat(32),
      timestamp: 3000,
      content_id: `sha256:${'4'.repeat(64)}`,
      session_token: sessionToken, // matches txA's session_token
      informed_by: [`sha256:${toolA1Hash}`], // INFORMED_BY toolB -> toolA1
    })
    const txAToken = base64urlEncode(sha256(canonicalRecord(txA)).slice(0, 16))
    const genB = await makeRecord({
      context_id: 'd'.repeat(32),
      timestamp: 4000,
      content_id: `sha256:${'5'.repeat(64)}`,
      provenance_token: txAToken, // PROVENANCE_OF genB -> txA
    })

    // Two records sharing context_id 'b' to force SESSION_PRECEDES + SESSION_PARALLEL
    const toolB2 = await makeRecord({
      context_id: 'b'.repeat(32),
      timestamp: 3500, // after toolB → SESSION_PRECEDES
      content_id: `sha256:${'6'.repeat(64)}`,
    })
    const toolB3 = await makeRecord({
      context_id: 'b'.repeat(32),
      timestamp: 3500, // SAME ts as toolB2 → SESSION_PARALLEL
      content_id: `sha256:${'7'.repeat(64)}`,
    })

    // Annotation pointing at txA exercises Step 8 (ANNOTATES, D058).
    const txAHash = hexEncode(sha256(canonicalRecord(txA)))
    const annotation = await makeRecord({
      context_id: 'e'.repeat(32),
      event_type: 'https://atrib.dev/v1/types/annotation',
      timestamp: 5000,
      content_id: `sha256:${'8'.repeat(64)}`,
      annotates: `sha256:${txAHash}`,
    })

    const graph = await buildGraph([txA, toolA1, toolA2, toolB, toolB2, toolB3, genB, annotation])

    const present = new Set(graph.edges.map((e) => e.type))
    const expected: Array<typeof graph.edges[number]['type']> = [
      'CHAIN_PRECEDES',
      'SESSION_PRECEDES',
      'SESSION_PARALLEL',
      'CONVERGES_ON',
      'CROSS_SESSION',
      'INFORMED_BY',
      'PROVENANCE_OF',
      'ANNOTATES',
    ]
    for (const type of expected) {
      expect(present.has(type), `missing edge type: ${type}`).toBe(true)
    }
    expect(present.size).toBe(8) // exactly the 8 spec types, no others
  })
})
