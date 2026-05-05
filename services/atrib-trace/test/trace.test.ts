// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { traceBackward } from '../src/trace.js'
import type { IndexedRecord } from '../src/storage.js'

const SEED = new Uint8Array(32).fill(0x42)
const REFERENCE_TIME_MS = Date.now()
const CONTEXT = 'b'.repeat(32)

async function buildSigned(
  contentByte: string,
  timestampOffset: number,
  informedBy?: string[],
): Promise<{ record: AtribRecord; record_hash: string }> {
  const pubKey = base64urlEncode(await getPublicKey(SEED))
  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + contentByte.repeat(32),
    creator_key: pubKey,
    chain_root: genesisChainRoot(CONTEXT),
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: CONTEXT,
    timestamp: REFERENCE_TIME_MS - timestampOffset,
    signature: '',
    ...(informedBy && informedBy.length > 0 ? { informed_by: informedBy } : {}),
  }
  const record = await signRecord(unsigned as AtribRecord, SEED)
  const record_hash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  return { record, record_hash }
}

function indexize(records: { record: AtribRecord; record_hash: string }[]): Map<string, IndexedRecord> {
  const m = new Map<string, IndexedRecord>()
  for (const { record, record_hash } of records) {
    m.set(record_hash, { record, record_hash, source: 'test' })
  }
  return m
}

describe('traceBackward', () => {
  it('returns empty visited + start_hash in dangling when start_hash is not in index', () => {
    const result = traceBackward(
      'sha256:' + 'f'.repeat(64),
      3,
      new Map(),
    )
    expect(result.visited).toEqual([])
    expect(result.dangling).toEqual(['sha256:' + 'f'.repeat(64)])
    expect(result.warnings.length).toBe(1)
  })

  it('returns just the start record when depth=1 and no informed_by', async () => {
    const r1 = await buildSigned('01', 1000)
    const idx = indexize([r1])

    const result = traceBackward(r1.record_hash, 1, idx)

    expect(result.visited.length).toBe(1)
    expect(result.visited[0]!.record_hash).toBe(r1.record_hash)
    expect(result.visited[0]!.depth).toBe(0)
    expect(result.visited[0]!.parent_hashes).toEqual([])
    expect(result.dangling).toEqual([])
  })

  it('walks one hop when depth=1 and start has informed_by', async () => {
    const upstream = await buildSigned('01', 2000)
    const downstream = await buildSigned('02', 1000, [upstream.record_hash])
    const idx = indexize([upstream, downstream])

    const result = traceBackward(downstream.record_hash, 1, idx)

    expect(result.visited.length).toBe(2)
    const visitedHashes = result.visited.map((v) => v.record_hash).sort()
    expect(visitedHashes).toEqual([upstream.record_hash, downstream.record_hash].sort())
    const upVisit = result.visited.find((v) => v.record_hash === upstream.record_hash)!
    expect(upVisit.depth).toBe(1)
    expect(upVisit.parent_hashes).toEqual([downstream.record_hash])
  })

  it('walks multi-hop chain to depth bound', async () => {
    const a = await buildSigned('01', 3000)
    const b = await buildSigned('02', 2000, [a.record_hash])
    const c = await buildSigned('03', 1000, [b.record_hash])
    const idx = indexize([a, b, c])

    const result = traceBackward(c.record_hash, 5, idx)

    expect(result.visited.length).toBe(3)
    expect(result.depth_reached).toBe(2)
    expect(result.truncated_by_depth).toBe(false)
  })

  it('truncates at depth bound', async () => {
    const a = await buildSigned('01', 3000)
    const b = await buildSigned('02', 2000, [a.record_hash])
    const c = await buildSigned('03', 1000, [b.record_hash])
    const idx = indexize([a, b, c])

    const result = traceBackward(c.record_hash, 1, idx)

    expect(result.visited.length).toBe(2) // c (depth 0) + b (depth 1)
    expect(result.truncated_by_depth).toBe(true)
    // a is referenced by b's informed_by but not visited (depth=2 > bound=1)
    expect(result.visited.find((v) => v.record_hash === a.record_hash)).toBeUndefined()
  })

  it('handles diamond fan-in (two parents reference same upstream)', async () => {
    const upstream = await buildSigned('01', 3000)
    const left = await buildSigned('02', 2000, [upstream.record_hash])
    const right = await buildSigned('03', 1500, [upstream.record_hash])
    const tip = await buildSigned('04', 1000, [left.record_hash, right.record_hash].sort())
    const idx = indexize([upstream, left, right, tip])

    const result = traceBackward(tip.record_hash, 5, idx)

    // upstream visited once, but parent_hashes includes both left and right
    expect(result.visited.length).toBe(4)
    const upVisit = result.visited.find((v) => v.record_hash === upstream.record_hash)!
    expect(upVisit.parent_hashes.length).toBe(2)
    expect(upVisit.parent_hashes.sort()).toEqual([left.record_hash, right.record_hash].sort())
  })

  it('surfaces dangling references', async () => {
    const orphanHash = 'sha256:' + 'f'.repeat(64) // not in mirror
    const tip = await buildSigned('02', 1000, [orphanHash])
    const idx = indexize([tip])

    const result = traceBackward(tip.record_hash, 3, idx)

    expect(result.visited.length).toBe(1) // only tip
    expect(result.dangling).toEqual([orphanHash])
  })

  it('respects max_nodes cap', async () => {
    // Build a long chain of 10 records, each referencing the previous.
    const chain: { record: AtribRecord; record_hash: string }[] = []
    let prev: string | undefined
    for (let i = 0; i < 10; i++) {
      const cur = await buildSigned(String(i).padStart(2, '0'), (10 - i) * 100, prev ? [prev] : [])
      chain.push(cur)
      prev = cur.record_hash
    }
    const idx = indexize(chain)

    const tip = chain[chain.length - 1]!
    const result = traceBackward(tip.record_hash, 100, idx, { maxNodes: 4 })

    expect(result.visited.length).toBeLessThanOrEqual(4)
    expect(result.truncated_by_cap).toBe(true)
  })
})
