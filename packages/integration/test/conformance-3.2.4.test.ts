// SPDX-License-Identifier: Apache-2.0

/**
 * §3.2.4 conformance: two graph-derivation implementations must agree.
 *
 * The spec mandates: "Two implementations applying these rules to identical
 * input records MUST produce identical edge sets." This test runs both
 * shipped implementations — graph-node's buildGraph and @atrib/integration's
 * buildGraphFromRecords — against the same record corpora and asserts the
 * normalized edge sets match.
 *
 * Earlier in development we shipped a graph-node dedup fix on the back of
 * an apparent edge-count divergence (26 vs 20). The actual cause was input
 * duplication, not algorithmic mismatch — but a conformance test like this
 * one would have surfaced the real issue immediately. This is the missing
 * regression boundary.
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
import { buildGraphFromRecords } from '../src/graph-builder.js'

const KEY_A = new Uint8Array(32).fill(11)
const KEY_B = new Uint8Array(32).fill(22)
const CTX_1 = 'a'.repeat(32)
const CTX_2 = 'b'.repeat(32)

interface RecordOverrides {
  privateKey?: Uint8Array
  context_id?: string
  chain_root?: string
  event_type?: 'tool_call' | 'transaction'
  timestamp?: number
  session_token?: string
  content_id?: string
}

async function makeRecord(overrides: RecordOverrides = {}): Promise<AtribRecord> {
  const pk = overrides.privateKey ?? KEY_A
  const pub = await getPublicKey(pk)
  const ctx = overrides.context_id ?? CTX_1
  const record = {
    spec_version: 'atrib/1.0' as const,
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pub),
    chain_root: overrides.chain_root ?? genesisChainRoot(ctx),
    event_type: overrides.event_type ?? 'tool_call',
    context_id: ctx,
    timestamp: overrides.timestamp ?? 1000,
    signature: '',
    ...(overrides.session_token ? { session_token: overrides.session_token } : {}),
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
      event_type: 'transaction',
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
      event_type: 'transaction',
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
      event_type: 'transaction',
      timestamp: 3000,
      content_id: `sha256:${'6'.repeat(64)}`,
    })
    const tx2 = await makeRecord({
      event_type: 'transaction',
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
      event_type: 'transaction',
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
})
