// SPDX-License-Identifier: Apache-2.0

/**
 * Regression guard for the 2026-07-29 graph-node outage.
 *
 * /v1/trace and /v1/chain used to resolve a record_hash by rebuilding an index
 * over the entire store on every request: getAllRecords() followed by
 * canonicalRecord -> sha256 -> hexEncode per record. That was written for a log
 * holding "low thousands" of records. At 112k it allocated ~80MB of transient
 * strings per request against a V8 heap already ~450MB full of the resident
 * record set, so V8 aborted the process ("Ineffective mark-compacts near heap
 * limit") on every trace request and Fly served the result as a 502. It flapped
 * the deploy-services graph canary and broke the explorer's trace view.
 *
 * The store already hashes every record once at ingest and exposes
 * getRecordByHash(). These tests pin that hash resolution stays a point lookup:
 * a full-store scan per request must not come back.
 *
 * The §1.9 revocation registry does legitimately scan globally, but it is
 * memoised on record count by buildRegistryCached. So these tests warm the
 * registry first and then assert an exact zero scans in steady state: that is
 * what discriminates the fix from the defect. A "<= 1" assertion would not,
 * because the defect's own count is 1 once the registry is already warm.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { bindGraphServer } from '../src/server.js'
import { createRecordStore, type RecordStore } from '../src/store.js'
import {
  base64urlEncode,
  signRecord,
  getPublicKey,
  genesisChainRoot,
  canonicalRecord,
  sha256,
  hexEncode,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(11)
const CONTEXT_ID = 'd'.repeat(32)

function hashOf(record: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

async function makeRecord(
  overrides: Partial<{ chain_root: string; informed_by: string[]; timestamp: number }> = {},
): Promise<AtribRecord> {
  const pk = await getPublicKey(TEST_KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    content_id: `sha256:${'c'.repeat(64)}`,
    creator_key: base64urlEncode(pk),
    chain_root: overrides.chain_root ?? genesisChainRoot(CONTEXT_ID),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: CONTEXT_ID,
    timestamp: overrides.timestamp ?? 1_700_000_000_000,
    signature: '',
    ...(overrides.informed_by ? { informed_by: overrides.informed_by } : {}),
  }
  return signRecord(record as AtribRecord, TEST_KEY)
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

describe('trace/chain resolve record_hash without scanning the store', () => {
  let url: string
  let close: () => Promise<void>
  let counter: ReturnType<typeof countingStore>
  let genesisHash: string
  let descendantHash: string

  beforeAll(async () => {
    counter = countingStore()
    const handle = await bindGraphServer(0, undefined, { store: counter.store })
    url = handle.url
    close = handle.close

    // genesis <- descendant, linked both ways the two endpoints walk:
    // informed_by (what /v1/trace follows) and chain_root (what /v1/chain follows).
    const genesis = await makeRecord({ timestamp: 1000 })
    genesisHash = hashOf(genesis)
    const descendant = await makeRecord({
      timestamp: 2000,
      chain_root: `sha256:${genesisHash}`,
      informed_by: [`sha256:${genesisHash}`],
    })
    descendantHash = hashOf(descendant)

    for (const record of [genesis, descendant]) {
      const res = await fetch(`${url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      })
      expect(res.ok).toBe(true)
    }

    // Warm the revocation registry so its one legitimate global scan is
    // memoised and every scan assertion below can demand an exact zero.
    await fetch(`${url}/v1/trace/${descendantHash}`)
  })

  afterAll(async () => {
    await close()
  })

  it('/v1/trace still walks informed_by to the ancestor', async () => {
    const res = await fetch(`${url}/v1/trace/${descendantHash}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.start_record_hash).toBe(`sha256:${descendantHash}`)
    const ids = body.graph.nodes.map((n: { id: string }) => n.id)
    expect(ids).toContain(`sha256:${descendantHash}`)
    expect(ids).toContain(`sha256:${genesisHash}`)
  })

  it('/v1/chain still walks chain_root to genesis', async () => {
    const res = await fetch(`${url}/v1/chain/${descendantHash}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.record_count).toBe(2)
  })

  it('/v1/trace does not rebuild a full-store hash index', async () => {
    counter.reset()
    const res = await fetch(`${url}/v1/trace/${descendantHash}`)
    expect(res.status).toBe(200)
    expect(counter.scans()).toBe(0)
  })

  it('/v1/chain does not rebuild a full-store hash index', async () => {
    counter.reset()
    const res = await fetch(`${url}/v1/chain/${descendantHash}`)
    expect(res.status).toBe(200)
    expect(counter.scans()).toBe(0)
  })

  it('an unknown record_hash still 404s without scanning the store', async () => {
    counter.reset()
    const res = await fetch(`${url}/v1/trace/${'0'.repeat(64)}`)
    expect(res.status).toBe(404)
    expect(counter.scans()).toBe(0)
  })
})
