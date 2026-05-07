// SPDX-License-Identifier: Apache-2.0

/**
 * §3.2.4 demo-vs-production drift check.
 *
 * Honest framing (clarified 2026-05-07): the integration package's
 * `buildGraphFromRecords` exists because the runnable end-to-end demo,
 * the calc-demo script, and the in-process integration tests all need
 * to compute a graph in-process without calling out to the graph-node
 * HTTP service. It is the GRAPH BUILDER CUSTOMERS SEE WHEN THEY RUN
 * `pnpm demo` IN FRONT OF THEM. If it silently drifts from
 * graph-node's production derivation, the demo's chain-hash output
 * misrepresents what production atrib infrastructure actually emits —
 * a customer-trust bug, not just a test-coverage gap.
 *
 * This test enforces that drift never happens: every record fixture
 * is run through BOTH `graph-node`'s buildGraph and the integration
 * package's buildGraphFromAllRecords, and the normalized edge sets,
 * node sets, and per-node verification_state values must match exactly.
 *
 * Note on what this test ISN'T: it is NOT a cross-implementation
 * conformance check in the spec's strongest sense. Both
 * implementations are TypeScript, share the same JCS canonicalization
 * (`@atrib/mcp.canonicalRecord`), the same SHA-256
 * (`@noble/hashes/sha2`), the same Ed25519 verification
 * (`@atrib/mcp.verifyRecord`), the same node/edge type definitions
 * (`@atrib/verify`), and the same maintainer reading the same spec
 * prose. Cross-language conformance against the
 * `spec/conformance/3.4.1/` and `spec/conformance/3.4.5-7/` corpora
 * is a separate later effort — it lands when an external integrator
 * writes a non-TS implementation and validates it against the corpus
 * without help from this codebase.
 *
 * The 9-edge regression case at the bottom of this file is the
 * load-bearing assertion: if any of the four producer-claim edges
 * (INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES) silently drifts
 * between the two implementations, the demo will start lying to
 * customers about what production behavior looks like for cognitive
 * primitives (atrib-emit / atrib-recall / atrib-trace / atrib-summarize
 * are the surface customers care most about). That is the bug class
 * this test is designed to catch.
 */

import { describe, it, expect } from 'vitest'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  canonicalRecord,
  sha256,
  hexEncode,
  genesisChainRoot,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import type { GraphEdge, GraphResponse } from '@atrib/verify'
import { buildGraph } from '@atrib/graph-node'
import { buildGraphFromRecords, buildGraphFromAllRecords } from '../src/graph-builder.js'

const KEY_A = new Uint8Array(32).fill(11)
const KEY_B = new Uint8Array(32).fill(22)
const CTX_1 = 'a'.repeat(32)
const CTX_2 = 'b'.repeat(32)

interface RecordOverrides {
  privateKey?: Uint8Array
  context_id?: string
  chain_root?: string
  event_type?: string
  timestamp?: number
  session_token?: string
  content_id?: string
  // Producer-claim fields (D041, D044, D058, D059). When the test fixture
  // exercises INFORMED_BY / PROVENANCE_OF / ANNOTATES / REVISES edges the
  // record-construction helper must accept these fields and place them in
  // JCS-canonical order before signing (`a` < `c` < `e` < `i` < `p` < `r`).
  informed_by?: string[]
  provenance_token?: string
  annotates?: string
  revises?: string
}

async function makeRecord(overrides: RecordOverrides = {}): Promise<AtribRecord> {
  const pk = overrides.privateKey ?? KEY_A
  const pub = await getPublicKey(pk)
  const ctx = overrides.context_id ?? CTX_1
  // Object key order in this literal does not affect signing (signRecord
  // re-canonicalizes via JCS), but listing keys in JCS order keeps fixture
  // diffs readable.
  const record = {
    spec_version: 'atrib/1.0' as const,
    ...(overrides.annotates ? { annotates: overrides.annotates } : {}),
    chain_root: overrides.chain_root ?? genesisChainRoot(ctx),
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    context_id: ctx,
    creator_key: base64urlEncode(pub),
    event_type: overrides.event_type ?? 'https://atrib.dev/v1/types/tool_call',
    ...(overrides.informed_by && overrides.informed_by.length > 0
      ? { informed_by: [...overrides.informed_by].sort() }
      : {}),
    ...(overrides.provenance_token ? { provenance_token: overrides.provenance_token } : {}),
    ...(overrides.revises ? { revises: overrides.revises } : {}),
    ...(overrides.session_token ? { session_token: overrides.session_token } : {}),
    signature: '',
    timestamp: overrides.timestamp ?? 1000,
  }
  return signRecord(record as AtribRecord, pk)
}

function normalizeEdges(edges: GraphEdge[]): string[] {
  return edges
    .map((e) => {
      // Undirected edges (SESSION_PARALLEL) are normalized so the lower id
      // always sits in source position.
      if (!e.directed && e.source > e.target) {
        return `${e.type}:${e.target}<->${e.source}`
      }
      const arrow = e.directed ? '->' : '<->'
      return `${e.type}:${e.source}${arrow}${e.target}`
    })
    .sort()
}

function assertGraphsAgree(a: GraphResponse, b: GraphResponse): void {
  const aIds = a.nodes.map((n) => n.id).sort()
  const bIds = b.nodes.map((n) => n.id).sort()
  expect(aIds).toEqual(bIds)

  const aEdges = normalizeEdges(a.edges)
  const bEdges = normalizeEdges(b.edges)
  expect(aEdges).toEqual(bEdges)

  expect(a.has_transaction).toBe(b.has_transaction)

  // verification_state per node must match — both impls must mark a tampered
  // record the same way, otherwise downstream policy filters disagree.
  const aStates = a.nodes
    .map((n) => `${n.id}:${n.verification_state}`)
    .sort()
  const bStates = b.nodes
    .map((n) => `${n.id}:${n.verification_state}`)
    .sort()
  expect(aStates).toEqual(bStates)
}

describe('§3.2.4 cross-implementation conformance', () => {
  it('agrees on a single genesis record', async () => {
    const r = await makeRecord()
    const gnGraph = await buildGraph([r])
    const intGraph = await buildGraphFromRecords([r], CTX_1)
    assertGraphsAgree(gnGraph, intGraph)
  })

  it('agrees on a chained pair (CHAIN_PRECEDES)', async () => {
    const r1 = await makeRecord({ timestamp: 1000 })
    const r1Hash = hexEncode(sha256(canonicalRecord(r1)))
    const r2 = await makeRecord({
      chain_root: `sha256:${r1Hash}`,
      timestamp: 2000,
      content_id: `sha256:${'d'.repeat(64)}`,
    })
    const gnGraph = await buildGraph([r1, r2])
    const intGraph = await buildGraphFromRecords([r1, r2], CTX_1)
    assertGraphsAgree(gnGraph, intGraph)
    expect(gnGraph.edges.filter((e: GraphEdge) => e.type === 'CHAIN_PRECEDES')).toHaveLength(1)
  })

  it('agrees on parallel records in same context (SESSION_PRECEDES + SESSION_PARALLEL)', async () => {
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'e'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'f'.repeat(64)}` })
    const gnGraph = await buildGraph([r1, r2])
    const intGraph = await buildGraphFromRecords([r1, r2], CTX_1)
    assertGraphsAgree(gnGraph, intGraph)
  })

  it('agrees on a transaction record (CONVERGES_ON)', async () => {
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2000, content_id: `sha256:${'2'.repeat(64)}` })
    const tx = await makeRecord({
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 3000,
      content_id: `sha256:${'3'.repeat(64)}`,
    })
    const gnGraph = await buildGraph([r1, r2, tx])
    const intGraph = await buildGraphFromRecords([r1, r2, tx], CTX_1)
    assertGraphsAgree(gnGraph, intGraph)
    expect(gnGraph.edges.filter((e: GraphEdge) => e.type === 'CONVERGES_ON')).toHaveLength(2)
  })

  it('agrees on a cross-session chain (CROSS_SESSION)', async () => {
    const TOKEN = 'shared-session-token-v1'
    // Session 1: tool_call with session_token, no transaction
    const sess1 = await makeRecord({
      privateKey: KEY_A,
      context_id: CTX_1,
      timestamp: 1000,
      session_token: TOKEN,
      content_id: `sha256:${'7'.repeat(64)}`,
    })
    // Session 2: tool_call + transaction, both with session_token
    const sess2Call = await makeRecord({
      privateKey: KEY_B,
      context_id: CTX_2,
      timestamp: 2000,
      session_token: TOKEN,
      content_id: `sha256:${'8'.repeat(64)}`,
    })
    const sess2Tx = await makeRecord({
      privateKey: KEY_B,
      context_id: CTX_2,
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 3000,
      session_token: TOKEN,
      content_id: `sha256:${'9'.repeat(64)}`,
    })

    const all = [sess1, sess2Call, sess2Tx]

    // graph-node buildGraph operates on all records simultaneously.
    // buildGraphFromRecords filters to a contextId; pass the transaction
    // session's contextId so cross-session walks back into CTX_1.
    const gnGraph = await buildGraph(all)
    const intGraph = await buildGraphFromRecords(all, CTX_2)

    assertGraphsAgree(gnGraph, intGraph)
    const crossEdges = gnGraph.edges.filter((e: GraphEdge) => e.type === 'CROSS_SESSION')
    expect(crossEdges).toHaveLength(1)
  })

  it('agrees on a tampered record (verification_state divergence regression)', async () => {
    // Sign a record, then corrupt one byte of its payload AFTER signing. Both
    // implementations must mark the resulting node as 'unsigned'. Without
    // signature verification in buildGraphFromRecords this test fails because
    // the integration impl would hardcode 'signature_valid' on the tampered
    // record while graph-node correctly flags it.
    const r = await makeRecord({ timestamp: 5000 })
    const tampered = { ...r, content_id: `sha256:${'9'.repeat(64)}` }

    const gnGraph = await buildGraph([tampered])
    const intGraph = await buildGraphFromRecords([tampered], CTX_1)
    assertGraphsAgree(gnGraph, intGraph)

    // Both impls must concretely flag the node as not-valid, not silently
    // accept it.
    expect(gnGraph.nodes[0]!.verification_state).not.toBe('signature_valid')
    expect(intGraph.nodes[0]!.verification_state).not.toBe('signature_valid')
  })

  it('agrees on multiple transactions in the same session', async () => {
    // §3.2.4 step 4: each transaction emits CONVERGES_ON edges from every
    // non-tx node. Two transactions on two non-tx tool calls = 2 * 2 = 4 edges.
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'4'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2000, content_id: `sha256:${'5'.repeat(64)}` })
    const tx1 = await makeRecord({
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 3000,
      content_id: `sha256:${'6'.repeat(64)}`,
    })
    const tx2 = await makeRecord({
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 4000,
      content_id: `sha256:${'7'.repeat(64)}`,
    })
    const gnGraph = await buildGraph([r1, r2, tx1, tx2])
    const intGraph = await buildGraphFromRecords([r1, r2, tx1, tx2], CTX_1)
    assertGraphsAgree(gnGraph, intGraph)
    const converges = gnGraph.edges.filter((e: GraphEdge) => e.type === 'CONVERGES_ON')
    expect(converges).toHaveLength(4)
  })

  it('agrees under reverse input ordering (deterministic)', async () => {
    const r1 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'a'.repeat(64)}` })
    const r2 = await makeRecord({ timestamp: 2000, content_id: `sha256:${'b'.repeat(64)}` })
    const tx = await makeRecord({
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 3000,
      content_id: `sha256:${'c'.repeat(64)}`,
    })

    const fwd = await buildGraph([r1, r2, tx])
    const rev = await buildGraph([tx, r2, r1])
    expect(normalizeEdges(fwd.edges)).toEqual(normalizeEdges(rev.edges))

    // And both reorderings agree with the integration impl
    const intFwd = await buildGraphFromRecords([r1, r2, tx], CTX_1)
    assertGraphsAgree(fwd, intFwd)
    assertGraphsAgree(rev, intFwd)
  })

  // ──────────────────────────────────────────────────────────────────────
  // Comprehensive 9-edge regression: every spec edge type is reachable
  // from a single fixture, and the demo's graph builder
  // (buildGraphFromAllRecords) agrees with graph-node on the result.
  //
  // Replays the same fixture shape as graph-node's
  // graph-builder.test.ts > "all 9 spec edge types are derivable" so any
  // future drift in the producer-claim layer (INFORMED_BY,
  // PROVENANCE_OF, ANNOTATES, REVISES) surfaces as a cross-impl
  // disagreement instead of a silent drift in the demo.
  // ──────────────────────────────────────────────────────────────────────

  it('agrees on a comprehensive 9-edge fixture (demo-vs-production drift guard)', async () => {
    const sessionToken = 'STSTSTSTSTSTSTSTSTSTSt'
    const ctxA = 'a'.repeat(32)
    const ctxB = 'b'.repeat(32)
    const ctxD = 'd'.repeat(32)
    const ctxE = 'e'.repeat(32)
    const ctxF = 'f'.repeat(32)

    // Session A: a transaction, a related tool_call (CONVERGES_ON), and a chained successor.
    const txA = await makeRecord({
      context_id: ctxA,
      event_type: 'https://atrib.dev/v1/types/transaction',
      timestamp: 1000,
      content_id: `sha256:${'1'.repeat(64)}`,
      session_token: sessionToken,
    })
    const toolA1 = await makeRecord({
      context_id: ctxA,
      timestamp: 1500,
      content_id: `sha256:${'2'.repeat(64)}`,
    })
    const toolA1Hash = hexEncode(sha256(canonicalRecord(toolA1)))
    const toolA2 = await makeRecord({
      context_id: ctxA,
      chain_root: `sha256:${toolA1Hash}`, // CHAIN_PRECEDES toolA1 → toolA2
      timestamp: 2000,
      content_id: `sha256:${'3'.repeat(64)}`,
    })

    // Session B: a tool_call (with session_token to force CROSS_SESSION) and
    // a separate genesis record that anchors to session A via provenance_token.
    const toolB = await makeRecord({
      context_id: ctxB,
      timestamp: 3000,
      content_id: `sha256:${'4'.repeat(64)}`,
      session_token: sessionToken, // matches txA.session_token
      informed_by: [`sha256:${toolA1Hash}`], // INFORMED_BY toolB → toolA1
    })
    const txAToken = base64urlEncode(sha256(canonicalRecord(txA)).slice(0, 16))
    const genB = await makeRecord({
      context_id: ctxD,
      timestamp: 4000,
      content_id: `sha256:${'5'.repeat(64)}`,
      provenance_token: txAToken, // PROVENANCE_OF genB → txA
    })

    // Two records sharing context B to force SESSION_PRECEDES + SESSION_PARALLEL.
    const toolB2 = await makeRecord({
      context_id: ctxB,
      timestamp: 3500,
      content_id: `sha256:${'6'.repeat(64)}`,
    })
    const toolB3 = await makeRecord({
      context_id: ctxB,
      timestamp: 3500, // SAME ts as toolB2 → SESSION_PARALLEL
      content_id: `sha256:${'7'.repeat(64)}`,
    })

    // Annotation pointing at txA exercises Step 8 (ANNOTATES, D058).
    const txAHash = hexEncode(sha256(canonicalRecord(txA)))
    const annotation = await makeRecord({
      context_id: ctxE,
      event_type: 'https://atrib.dev/v1/types/annotation',
      timestamp: 5000,
      content_id: `sha256:${'8'.repeat(64)}`,
      annotates: `sha256:${txAHash}`,
    })

    // Revision of toolA1 exercises Step 9 (REVISES, D059).
    const revision = await makeRecord({
      context_id: ctxF,
      event_type: 'https://atrib.dev/v1/types/revision',
      timestamp: 6000,
      content_id: `sha256:${'9'.repeat(64)}`,
      revises: `sha256:${toolA1Hash}`,
    })

    const allRecords = [txA, toolA1, toolA2, toolB, toolB2, toolB3, genB, annotation, revision]

    const gnGraph = await buildGraph(allRecords)
    const intGraph = await buildGraphFromAllRecords(allRecords)
    assertGraphsAgree(gnGraph, intGraph)

    // Sanity: every spec-mandated edge type is reachable from this fixture
    // in BOTH implementations. If either drops a type the previous assertion
    // would already have failed; this is just a defense-in-depth check.
    const expectedTypes = [
      'CHAIN_PRECEDES',
      'SESSION_PRECEDES',
      'SESSION_PARALLEL',
      'CONVERGES_ON',
      'CROSS_SESSION',
      'INFORMED_BY',
      'PROVENANCE_OF',
      'ANNOTATES',
      'REVISES',
    ]
    for (const t of expectedTypes) {
      expect(gnGraph.edges.some((e: GraphEdge) => e.type === t), `gn missing ${t}`).toBe(true)
      expect(intGraph.edges.some((e: GraphEdge) => e.type === t), `int missing ${t}`).toBe(true)
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // §3.4.1.1 compaction agreement: with compactIntraSessionEdges set on
  // both sides, the implementations must continue to produce identical
  // edge sets. Without this case the integration impl could diverge on
  // the compaction logic (Union-Find + adjacent-only walk) and the
  // /v1/graph endpoint default (compact=true) would silently mismatch
  // the demo's output.
  // ──────────────────────────────────────────────────────────────────────

  it('agrees under compactIntraSessionEdges=true (§3.4.1.1)', async () => {
    // Five-record linear chain: zero SESSION_PRECEDES expected under compact mode.
    const r0 = await makeRecord({ timestamp: 1000, content_id: `sha256:${'aa'.repeat(32)}` })
    const r0Hash = hexEncode(sha256(canonicalRecord(r0)))
    const r1 = await makeRecord({
      chain_root: `sha256:${r0Hash}`,
      timestamp: 1001,
      content_id: `sha256:${'bb'.repeat(32)}`,
    })
    const r1Hash = hexEncode(sha256(canonicalRecord(r1)))
    const r2 = await makeRecord({
      chain_root: `sha256:${r1Hash}`,
      timestamp: 1002,
      content_id: `sha256:${'cc'.repeat(32)}`,
    })
    const r2Hash = hexEncode(sha256(canonicalRecord(r2)))
    const r3 = await makeRecord({
      chain_root: `sha256:${r2Hash}`,
      timestamp: 1003,
      content_id: `sha256:${'dd'.repeat(32)}`,
    })
    const r3Hash = hexEncode(sha256(canonicalRecord(r3)))
    const r4 = await makeRecord({
      chain_root: `sha256:${r3Hash}`,
      timestamp: 1004,
      content_id: `sha256:${'ee'.repeat(32)}`,
    })
    const records = [r0, r1, r2, r3, r4]

    const gnCompact = await buildGraph(records, [], { compactIntraSessionEdges: true })
    const intCompact = await buildGraphFromAllRecords(records, { compactIntraSessionEdges: true })
    assertGraphsAgree(gnCompact, intCompact)

    // Also verify the compaction actually fired in both impls (4 chain links, 0 session edges).
    expect(gnCompact.edges.filter((e: GraphEdge) => e.type === 'CHAIN_PRECEDES')).toHaveLength(4)
    expect(gnCompact.edges.filter((e: GraphEdge) => e.type === 'SESSION_PRECEDES')).toHaveLength(0)
    expect(intCompact.edges.filter((e: GraphEdge) => e.type === 'CHAIN_PRECEDES')).toHaveLength(4)
    expect(intCompact.edges.filter((e: GraphEdge) => e.type === 'SESSION_PRECEDES')).toHaveLength(0)
  })
})
