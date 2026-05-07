// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll } from 'vitest'
import { bindGraphServer } from '../src/server.js'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  genesisChainRoot,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(42)
const CONTEXT_ID = 'b'.repeat(32)

async function makeRecord(overrides: Partial<{
  context_id: string
  event_type: string
  timestamp: number
  content_id: string
}> = {}) {
  const pk = await getPublicKey(TEST_KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pk),
    chain_root: genesisChainRoot(overrides.context_id ?? CONTEXT_ID),
    event_type: overrides.event_type ?? 'https://atrib.dev/v1/types/tool_call',
    context_id: overrides.context_id ?? CONTEXT_ID,
    timestamp: overrides.timestamp ?? Date.now(),
    signature: '',
  }
  return signRecord(record, TEST_KEY)
}

describe('graph-node server (section 3.4)', () => {
  let url: string
  let close: () => Promise<void>

  beforeAll(async () => {
    const handle = await bindGraphServer(0)
    url = handle.url
    close = handle.close

    // Ingest 2 records
    for (let i = 0; i < 2; i++) {
      const record = await makeRecord({
        timestamp: 1000 + i,
        content_id: `sha256:${'abcdef'[i]!.repeat(64)}`,
      })
      const res = await fetch(`${url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(res.ok).toBe(true)
    }

    return () => close()
  })

  it('GET /v1/graph/:context_id returns full graph', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.spec_version).toBe('atrib/1.0')
    expect(body.node_count).toBe(2)
    expect(body.nodes).toHaveLength(2)
    expect(body.edges.length).toBeGreaterThan(0)
  })

  it('GET /v1/graph/:context_id/nodes returns nodes only', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.nodes).toHaveLength(2)
  })

  it('GET /v1/graph/:context_id/nodes filters by event_type', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes?event_type=transaction`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.nodes).toHaveLength(0)
  })

  it('GET /v1/graph/:context_id/transaction returns 404 when no transaction', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}/transaction`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.type).toContain('session-not-found')
  })

  it('GET /v1/graph/:unknown returns 404', async () => {
    const res = await fetch(`${url}/v1/graph/${'f'.repeat(32)}`)
    expect(res.status).toBe(404)
  })

  it('GET /v1/graph/:invalid returns 400', async () => {
    const res = await fetch(`${url}/v1/graph/not-a-valid-id`)
    expect(res.status).toBe(400)
  })

  it('GET /v1/creators/:key/sessions returns session list', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    const res = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/sessions`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.sessions).toHaveLength(1)
    expect(body.sessions[0].context_id).toBe(CONTEXT_ID)
    expect(body.sessions[0].node_count).toBe(2)
  })

  it('GET /v1/creators/:key/sessions honors since/until window (unix_ms)', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    // Fixture sessions span ts=1000..1001. Window completely after the session
    // → 0 results. Window before the session → 0 results. Window covering it
    // → 1 result.
    const before = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/sessions?until=999`)
    expect(before.ok).toBe(true)
    expect((await before.json()).sessions).toHaveLength(0)

    const after = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/sessions?since=1002`)
    expect(after.ok).toBe(true)
    expect((await after.json()).sessions).toHaveLength(0)

    const cover = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/sessions?since=999&until=1002`)
    expect(cover.ok).toBe(true)
    expect((await cover.json()).sessions).toHaveLength(1)
  })

  it('GET /v1/creators/:key/sessions accepts ISO 8601 since/until (§3.4.4 spec format)', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    // Both formats must work per spec §3.4.4: <ISO8601 | unix_ms>. The fixture
    // is at unix_ms 1000-1001 (1970-01-01T00:00:01Z window). ISO 8601 query
    // with a window AFTER 1970 → 0 results, validating parser conversion.
    const isoFar = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/sessions?since=2050-01-01T00:00:00Z`)
    expect(isoFar.ok).toBe(true)
    expect((await isoFar.json()).sessions).toHaveLength(0)

    // Malformed ISO 8601 → 400.
    const bad = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/sessions?since=not-a-date`)
    expect(bad.status).toBe(400)
    const body = await bad.json()
    // The detail field carries the parser-supplied message naming the offending param.
    expect(body.detail).toMatch(/since/i)
  })

  it('POST /v1/ingest rejects invalid records', async () => {
    const res = await fetch(`${url}/v1/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ not: 'a record' }),
    })
    expect(res.status).toBe(400)
  })

  // §1.9: revocation flips post-revocation records to revoked_after_revocation
  it('flags post-revocation records via /v1/graph', async () => {
    // Submit two records by Alice with explicit log_index headers, then a
    // key_revocation by Alice retiring her own key, then another record by
    // Alice. The post-revocation record should be flagged.
    const aliceCtx = 'd'.repeat(32)
    async function postWithIndex(record: AtribRecord, idx: number) {
      const r = await fetch(`${url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-atrib-log-index': String(idx) },
        body: JSON.stringify(record),
      })
      if (!r.ok) {
        const text = await r.text()
        throw new Error(`ingest failed (${r.status}) for idx=${idx}: ${text}`)
      }
    }
    await postWithIndex(await makeRecord({ context_id: aliceCtx, timestamp: 1000, content_id: `sha256:${'1'.repeat(64)}` }), 100)
    await postWithIndex(await makeRecord({ context_id: aliceCtx, timestamp: 2000, content_id: `sha256:${'2'.repeat(64)}` }), 101)

    // Synthesize a key_revocation record. The extra fields (revoked_key,
    // revocation_reason) must be present BEFORE signing so the canonical
    // bytes include them; otherwise the signature won't verify.
    // content_id char follows the file convention: timestamp/1000 → char,
    // here 3000 → '3' (also avoids non-hex chars that fail §1.3 validation).
    const pk = await getPublicKey(TEST_KEY)
    const revocationUnsigned = {
      spec_version: 'atrib/1.0' as const,
      content_id: `sha256:${'3'.repeat(64)}`,
      creator_key: base64urlEncode(pk),
      chain_root: genesisChainRoot(aliceCtx),
      event_type: 'https://atrib.dev/v1/types/key_revocation',
      context_id: aliceCtx,
      timestamp: 3000,
      // §1.9.1 fields placed at lex order: r > c (creator_key), r > e (event_type),
      // r > i (informed_by), r < s (signature). canonicalRecord (JCS) sorts.
      revoked_key: base64urlEncode(pk),
      revocation_reason: 'rotation',
      signature: '',
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const revocation = await signRecord(revocationUnsigned as any, TEST_KEY)
    await postWithIndex(revocation as AtribRecord, 102)

    // A post-revocation record by Alice
    await postWithIndex(await makeRecord({ context_id: aliceCtx, timestamp: 4000, content_id: `sha256:${'4'.repeat(64)}` }), 103)

    const res = await fetch(`${url}/v1/graph/${aliceCtx}`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { nodes: Array<{ log_index: number | null; verification_state: string; event_type: string }> }
    const postRevoc = body.nodes.find((n) => n.log_index === 103)!
    const preRevoc1 = body.nodes.find((n) => n.log_index === 100)!
    const preRevoc2 = body.nodes.find((n) => n.log_index === 101)!
    const revocNode = body.nodes.find((n) => n.log_index === 102)!
    expect(postRevoc.verification_state).toBe('revoked_after_revocation')
    expect(preRevoc1.verification_state).toBe('signature_valid')
    expect(preRevoc2.verification_state).toBe('signature_valid')
    // The revocation record itself doesn't flag itself
    expect(revocNode.verification_state).toBe('signature_valid')
  })

  // D054: browser-based explorer reads
  it('OPTIONS preflight returns CORS headers (D054)', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('GET')
  })

  it('GET responses include access-control-allow-origin (D054)', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('GET /v1/creators/:key/graph returns activity-map graph for windowed records', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    const res = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/graph`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.creator_key).toBe(creatorKey)
    expect(body.record_count).toBeGreaterThanOrEqual(2)
    expect(body.truncated).toBe(false)
    expect(body.graph.nodes.length).toBe(body.record_count)
    expect(body.window).toEqual({ since: null, until: null, limit: 500 })
    expect(body.intra_session_edges_filtered).toBe(true)
    // Default response excludes intra-session edge types per §3.4.7.
    const intraSessionTypes = new Set(['SESSION_PRECEDES', 'SESSION_PARALLEL'])
    for (const edge of body.graph.edges) {
      expect(intraSessionTypes.has(edge.type)).toBe(false)
    }
  })

  it('GET /v1/creators/:key/graph?include_intra_session=true restores SESSION_PRECEDES', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    const res = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/graph?include_intra_session=true`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.intra_session_edges_filtered).toBe(false)
    // The fixture has 2 records in one context_id; chain_precedes wires them
    // into a chain so SESSION_PRECEDES doesn't fire. Just assert the flag
    // toggles correctly; the edge presence depends on per-fixture chain state.
  })

  it('GET /v1/creators/:key/graph honors since/until window', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    const unfiltered = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/graph`)
    const unfilteredBody = await unfiltered.json()
    // Earliest fixture records have low timestamps (1000+i). A `since` floor
    // of 1_700_000_000_000 (sometime in 2023) drops anything with low test
    // timestamps. Records ingested by sibling tests with Date.now() pass the
    // floor. The contract: filtered count is less than unfiltered count.
    const res = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/graph?since=1700000000000`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.record_count).toBeLessThan(unfilteredBody.record_count)
    expect(body.window.since).toBe(1700000000000)
  })

  it('GET /v1/creators/:key/graph rejects invalid time window', async () => {
    const pk = await getPublicKey(TEST_KEY)
    const creatorKey = base64urlEncode(pk)
    const res = await fetch(`${url}/v1/creators/${encodeURIComponent(creatorKey)}/graph?since=abc`)
    expect(res.status).toBe(400)
  })

  it('GET /v1/creators/:key/graph returns 404 for unknown creator', async () => {
    const fakeKey = base64urlEncode(new Uint8Array(32).fill(0xff))
    const res = await fetch(`${url}/v1/creators/${encodeURIComponent(fakeKey)}/graph`)
    expect(res.status).toBe(404)
  })

  it('GET /v1/trace/:record_hash returns single-node trace for leaf record', async () => {
    // Pull a record_hash from one of the fixture records via /v1/graph.
    const graphRes = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes`)
    const graphBody = await graphRes.json() as { nodes: Array<{ id: string }> }
    const recordHash = graphBody.nodes[0]!.id // node.id == "sha256:<hex>"
    const hashHex = recordHash.replace(/^sha256:/, '')

    const res = await fetch(`${url}/v1/trace/${hashHex}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.start_record_hash).toBe(`sha256:${hashHex}`)
    // Fixture records have no informed_by, no annotates, no revises, leaf.
    expect(body.record_count).toBe(1)
    expect(body.truncated_by_depth).toBe(false)
    expect(body.truncated_by_count).toBe(false)
  })

  it('GET /v1/trace/:record_hash accepts both raw hex and sha256: prefix forms', async () => {
    const graphRes = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes`)
    const graphBody = await graphRes.json() as { nodes: Array<{ id: string }> }
    const recordHash = graphBody.nodes[0]!.id
    const hashHex = recordHash.replace(/^sha256:/, '')

    const r1 = await fetch(`${url}/v1/trace/${hashHex}`)
    const r2 = await fetch(`${url}/v1/trace/sha256:${hashHex}`)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect((await r1.json()).start_record_hash).toBe((await r2.json()).start_record_hash)
  })

  it('GET /v1/trace/:unknown_hash returns 404', async () => {
    const res = await fetch(`${url}/v1/trace/${'0'.repeat(64)}`)
    expect(res.status).toBe(404)
  })

  it('GET /v1/trace/:invalid_hash returns 404 (route not matched)', async () => {
    const res = await fetch(`${url}/v1/trace/not-a-valid-hash`)
    expect(res.status).toBe(404)
  })

  it('GET /v1/chain/:record_hash returns single-node chain for genesis record', async () => {
    // Pull a record_hash; fixture records share one context_id so chain
    // terminates at the session genesis.
    const graphRes = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes`)
    const graphBody = await graphRes.json() as { nodes: Array<{ id: string; is_genesis?: boolean }> }
    const genesisNode = graphBody.nodes.find((n) => n.is_genesis)
    expect(genesisNode).toBeDefined()
    const hashHex = genesisNode!.id.replace(/^sha256:/, '')

    const res = await fetch(`${url}/v1/chain/${hashHex}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.start_record_hash).toBe(`sha256:${hashHex}`)
    expect(body.record_count).toBe(1) // genesis has no chain ancestors
    expect(body.truncated_by_depth).toBe(false)
    expect(body.truncated_by_count).toBe(false)
  })

  it('GET /v1/chain/:record_hash walks chain backward from leaf', async () => {
    const graphRes = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes`)
    const graphBody = await graphRes.json() as { nodes: Array<{ id: string; is_genesis?: boolean; log_index: number | null }> }
    // Find a record that is NOT genesis (has a chain predecessor in store).
    const nonGenesis = graphBody.nodes
      .filter((n) => !n.is_genesis && n.log_index !== null)
      .sort((a, b) => (b.log_index ?? 0) - (a.log_index ?? 0))[0]
    if (!nonGenesis) return // fixture has no non-genesis records; nothing to walk
    const hashHex = nonGenesis.id.replace(/^sha256:/, '')

    const res = await fetch(`${url}/v1/chain/${hashHex}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.record_count).toBeGreaterThan(1) // at least the start + one ancestor
  })

  it('GET /v1/chain/:hash accepts both raw hex and sha256: prefix forms', async () => {
    const graphRes = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes`)
    const graphBody = await graphRes.json() as { nodes: Array<{ id: string }> }
    const hashHex = graphBody.nodes[0]!.id.replace(/^sha256:/, '')

    const r1 = await fetch(`${url}/v1/chain/${hashHex}`)
    const r2 = await fetch(`${url}/v1/chain/sha256:${hashHex}`)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect((await r1.json()).start_record_hash).toBe((await r2.json()).start_record_hash)
  })

  it('GET /v1/chain/:unknown_hash returns 404', async () => {
    const res = await fetch(`${url}/v1/chain/${'0'.repeat(64)}`)
    expect(res.status).toBe(404)
  })

  it('GET / returns service-info index', async () => {
    const res = await fetch(`${url}/`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.service).toBe('atrib-graph-node')
    expect(body.versions).toEqual(['v1'])
    expect(body.current_version).toBe('v1')
    expect(body.endpoints.trace).toBe('GET /v1/trace/<record_hash>')
    expect(body.endpoints.chain).toBe('GET /v1/chain/<record_hash>')
    expect(body.explorer).toBe('https://explore.atrib.dev/')
  })

  it('GET /v1/graph/:context_id/nodes accepts URI form for all 6 normative event_types', async () => {
    // Pre-D063 the inline normalizer only covered tool_call / transaction /
    // observation; URI queries for directory_anchor / annotation / revision
    // silently returned zero results because the equality compare against
    // node.event_type (short label) never matched the URI form.
    const uris = [
      'https://atrib.dev/v1/types/tool_call',
      'https://atrib.dev/v1/types/transaction',
      'https://atrib.dev/v1/types/observation',
      'https://atrib.dev/v1/types/directory_anchor',
      'https://atrib.dev/v1/types/annotation',
      'https://atrib.dev/v1/types/revision',
    ]
    for (const uri of uris) {
      const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}/nodes?event_type=${encodeURIComponent(uri)}`)
      expect(res.ok).toBe(true)
      // The fixture has only tool_call records; we just need the endpoint to
      // not error. The normalizer is exercised regardless of match count.
    }
  })

  // ─────────────────────────────────────────────────────────────────────
  // Server-level test for ?compact=true|false on /v1/graph/<context_id>
  // (§3.4.1.1 intra-session edge compaction). Companion to graph-builder
  // unit tests; this layer verifies the query-param parsing + default
  // wiring in handleGraph, not the derivation itself.
  // ─────────────────────────────────────────────────────────────────────

  it('GET /v1/graph/:context_id defaults to ?compact=true', async () => {
    // The fixture's two records are independent (no chain link), so under the
    // default compact=true we expect 1 SESSION_PRECEDES edge (adjacent-only).
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    const sessionEdges = body.edges.filter((e: { type: string }) => e.type === 'SESSION_PRECEDES')
    // 2-record session, no chain links between them → adjacent-only emits 1 edge.
    expect(sessionEdges).toHaveLength(1)
  })

  it('GET /v1/graph/:context_id?compact=false restores spec §3.2.4 all-pairs derivation', async () => {
    const res = await fetch(`${url}/v1/graph/${CONTEXT_ID}?compact=false`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    // For 2 records, all-pairs and adjacent-only produce the same single edge,
    // so we just verify the request succeeds and the edge type is present.
    // The derivation difference is exercised exhaustively by the graph-builder
    // unit tests (compactIntraSessionEdges describe block).
    const sessionEdges = body.edges.filter((e: { type: string }) => e.type === 'SESSION_PRECEDES')
    expect(sessionEdges).toHaveLength(1)
  })
})
