// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll } from 'vitest'
import { bindGraphServer } from '../src/server.js'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  genesisChainRoot,
} from '@atrib/mcp'

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
})
