// SPDX-License-Identifier: Apache-2.0

/**
 * GET /v1/stats.
 *
 * Two jobs, and the tests split along them:
 *
 *  1. Report the runway. graph-node holds every record in memory, so heap
 *     headroom divided by growth in records per day is how long the current
 *     machine size lasts. Before this endpoint that number lived only in Fly
 *     logs, and on 2026-07-29 the live set reached the V8 ceiling with nothing
 *     watching. See P059 in DECISIONS.md.
 *
 *  2. Be the Fly health-check target. That makes it a polled endpoint, so the
 *     O(1) test below is a real constraint and not a nicety: if this ever walks
 *     the store it becomes a periodic full scan of the thing it is meant to
 *     protect, which is close to what caused the outage in the first place.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { bindGraphServer } from '../src/server.js'
import { createRecordStore, type RecordStore } from '../src/store.js'
import { base64urlEncode, signRecord, getPublicKey, genesisChainRoot } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(23)

async function makeRecord(contextId: string, timestamp: number): Promise<AtribRecord> {
  const pk = await getPublicKey(TEST_KEY)
  return signRecord(
    {
      spec_version: 'atrib/1.0' as const,
      content_id: `sha256:${'c'.repeat(64)}`,
      creator_key: base64urlEncode(pk),
      chain_root: genesisChainRoot(contextId),
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: contextId,
      timestamp,
      signature: '',
    } as AtribRecord,
    TEST_KEY,
  )
}

/** Wraps a real store and counts full-store scans. */
function countingStore(): { store: RecordStore; scans: () => number; reset: () => void } {
  const inner = createRecordStore()
  let scans = 0
  const store: RecordStore = {
    ...inner,
    getAllRecords() {
      scans += 1
      return inner.getAllRecords()
    },
  }
  return { store, scans: () => scans, reset: () => { scans = 0 } }
}

describe('GET /v1/stats', () => {
  let url: string
  let close: () => Promise<void>
  let counter: ReturnType<typeof countingStore>

  const CTX_A = 'a'.repeat(32)
  const CTX_B = 'b'.repeat(32)

  beforeAll(async () => {
    counter = countingStore()
    const handle = await bindGraphServer(0, undefined, {
      store: counter.store,
      runtimeInfo: { replay_ms: 4242, replayed_records: 3 },
    })
    url = handle.url
    close = handle.close

    // 3 records across 2 distinct context_ids.
    for (const [ctx, ts] of [
      [CTX_A, 1000],
      [CTX_A, 2000],
      [CTX_B, 3000],
    ] as const) {
      const res = await fetch(`${url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(await makeRecord(ctx, ts)),
      })
      expect(res.ok).toBe(true)
    }
  })

  afterAll(async () => {
    await close()
  })

  it('reports record and context counts from the store', async () => {
    const res = await fetch(`${url}/v1/stats`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.service).toBe('atrib-graph-node')
    expect(body.record_count).toBe(3)
    expect(body.context_count).toBe(2)
  })

  it('reports heap utilization with a usable percentage', async () => {
    const body = await (await fetch(`${url}/v1/stats`)).json()
    expect(body.heap.used_mb).toBeGreaterThan(0)
    expect(body.heap.limit_mb).toBeGreaterThan(0)
    expect(body.heap.used_mb).toBeLessThanOrEqual(body.heap.limit_mb)
    expect(body.heap.used_pct).toBeGreaterThan(0)
    expect(body.heap.used_pct).toBeLessThanOrEqual(100)
    // The number an operator acts on, so it must survive JSON as a number and
    // not a string.
    expect(typeof body.heap.used_pct).toBe('number')
  })

  it('reports uptime and the last archive replay', async () => {
    const body = await (await fetch(`${url}/v1/stats`)).json()
    expect(Number.isInteger(body.uptime_s)).toBe(true)
    expect(body.uptime_s).toBeGreaterThanOrEqual(0)
    expect(body.replay).toEqual({ ms: 4242, records: 3 })
  })

  it('omits replay entirely when no archive was replayed', async () => {
    // Distinguishable from "archive replayed zero records", which reports
    // { ms, records: 0 }.
    const handle = await bindGraphServer(0)
    try {
      const body = await (await fetch(`${handle.url}/v1/stats`)).json()
      expect('replay' in body).toBe(false)
      expect(body.record_count).toBe(0)
      expect(body.context_count).toBe(0)
    } finally {
      await handle.close()
    }
  })

  it('does not scan the store, because the health check polls it', async () => {
    counter.reset()
    for (let i = 0; i < 5; i++) {
      expect((await fetch(`${url}/v1/stats`)).status).toBe(200)
    }
    expect(counter.scans()).toBe(0)
  })

  it('sets CORS so the explorer can read it cross-origin (D054)', async () => {
    const res = await fetch(`${url}/v1/stats`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('is listed in the service-info index', async () => {
    const body = await (await fetch(`${url}/`)).json()
    expect(body.endpoints.stats).toBe('GET /v1/stats')
  })

  it('tracks new ingests', async () => {
    const before = (await (await fetch(`${url}/v1/stats`)).json()).record_count
    const res = await fetch(`${url}/v1/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(await makeRecord('f'.repeat(32), 9000)),
    })
    expect(res.ok).toBe(true)
    const after = await (await fetch(`${url}/v1/stats`)).json()
    expect(after.record_count).toBe(before + 1)
    expect(after.context_count).toBe(3)
  })
})
