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
    const pk = await getPublicKey(TEST_KEY)
    const revocationUnsigned = {
      spec_version: 'atrib/1.0' as const,
      content_id: `sha256:${'r'.repeat(64)}`,
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
})
