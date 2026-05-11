// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  signRecord,
  getPublicKey,
  base64urlEncode,
  genesisChainRoot,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  canonicalRecord,
  sha256,
  hexEncode,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { buildLocalGraph, shortestDistances, walkFrom } from '../src/graph.js'
import { computeRecordHash } from '../src/aggregations.js'
import type { LoadedRecord } from '../src/aggregations.js'

const KEY = new Uint8Array(32).fill(7)
const CTX = 'a'.repeat(32)

interface MakeOpts {
  context_id?: string
  event_type?: string
  timestamp?: number
  content_id?: string
  chain_root?: string
  informed_by?: string[]
}

async function makeSigned(opts: MakeOpts = {}): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const ctx = opts.context_id ?? CTX
  const record: Record<string, unknown> = {
    spec_version: 'atrib/1.0',
    event_type: opts.event_type ?? EVENT_TYPE_TOOL_CALL_URI,
    context_id: ctx,
    creator_key: base64urlEncode(pub),
    chain_root: opts.chain_root ?? genesisChainRoot(ctx),
    content_id: opts.content_id ?? `sha256:${'c'.repeat(64)}`,
    timestamp: opts.timestamp ?? 1700000000000,
    signature: '',
  }
  if (opts.informed_by) record.informed_by = opts.informed_by
  return signRecord(record as AtribRecord, KEY)
}

function loaded(record: AtribRecord, content?: unknown): LoadedRecord {
  return {
    record,
    record_hash: computeRecordHash(record),
    content,
  }
}

function chainRootFor(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

describe('buildLocalGraph', () => {
  it('returns empty graph for empty input', () => {
    const g = buildLocalGraph([])
    expect(g.size).toBe(0)
  })

  it('every loaded record appears in the graph as a key', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const r2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    const g = buildLocalGraph([loaded(r1), loaded(r2)])
    expect(g.size).toBe(2)
    expect(g.has(computeRecordHash(r1))).toBe(true)
    expect(g.has(computeRecordHash(r2))).toBe(true)
  })

  it('emits CHAIN_PRECEDES between chained records', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const r1ChainRoot = chainRootFor(r1)
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      chain_root: r1ChainRoot,
    })
    const g = buildLocalGraph([loaded(r1), loaded(r2)])
    const r1Hash = computeRecordHash(r1)
    const r2Hash = computeRecordHash(r2)
    expect(g.get(r1Hash)).toContainEqual({ type: 'CHAIN_PRECEDES', target: r2Hash, weight: 1 })
    expect(g.get(r2Hash)).toContainEqual({ type: 'CHAIN_PRECEDES', target: r1Hash, weight: 1 })
  })

  it('does not emit CHAIN_PRECEDES for genesis records', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const g = buildLocalGraph([loaded(r1)])
    expect(g.get(computeRecordHash(r1))).toEqual([])
  })

  it('skips CHAIN_PRECEDES when the prior record is not in the loaded set', async () => {
    const r2 = await makeSigned({
      timestamp: 2,
      chain_root: `sha256:${'9'.repeat(64)}`,
    })
    const g = buildLocalGraph([loaded(r2)])
    expect(g.get(computeRecordHash(r2))).toEqual([])
  })

  it('emits INFORMED_BY when the referenced record is present', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const r1Hash = computeRecordHash(r1)
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      informed_by: [r1Hash],
    })
    const g = buildLocalGraph([loaded(r1), loaded(r2)])
    const r2Hash = computeRecordHash(r2)
    expect(g.get(r2Hash)).toContainEqual({ type: 'INFORMED_BY', target: r1Hash, weight: 1 })
    expect(g.get(r1Hash)).toContainEqual({ type: 'INFORMED_BY', target: r2Hash, weight: 1 })
  })

  it('skips INFORMED_BY entries pointing at records not in the mirror', async () => {
    const ghost = `sha256:${'f'.repeat(64)}`
    const r1 = await makeSigned({ timestamp: 1, informed_by: [ghost] })
    const g = buildLocalGraph([loaded(r1)])
    expect(g.get(computeRecordHash(r1))).toEqual([])
  })

  it('emits ANNOTATES from annotation -> target', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: 2,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    const g = buildLocalGraph([
      loaded(target),
      loaded(anno, { annotates: targetHash, importance: 'high' }),
    ])
    const annoHash = computeRecordHash(anno)
    expect(g.get(annoHash)).toContainEqual({ type: 'ANNOTATES', target: targetHash, weight: 2 })
    expect(g.get(targetHash)).toContainEqual({ type: 'ANNOTATES', target: annoHash, weight: 2 })
  })

  it('emits REVISES from revision -> target', async () => {
    const orig = await makeSigned({ timestamp: 1 })
    const origHash = computeRecordHash(orig)
    const rev = await makeSigned({
      event_type: EVENT_TYPE_REVISION_URI,
      timestamp: 2,
      content_id: `sha256:${'r'.repeat(64)}`,
    })
    const g = buildLocalGraph([
      loaded(orig),
      loaded(rev, { revises: origHash }),
    ])
    const revHash = computeRecordHash(rev)
    expect(g.get(revHash)).toContainEqual({ type: 'REVISES', target: origHash, weight: 2 })
    expect(g.get(origHash)).toContainEqual({ type: 'REVISES', target: revHash, weight: 2 })
  })

  it('skips ANNOTATES/REVISES when annotation/revision has no _local.content', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: 2,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    const g = buildLocalGraph([loaded(target), loaded(anno)])
    expect(g.get(computeRecordHash(anno))).toEqual([])
  })
})

describe('shortestDistances', () => {
  it('returns empty map for unknown start node', () => {
    const g = buildLocalGraph([])
    expect(shortestDistances(g, 'sha256:unknown')).toEqual(new Map())
  })

  it('start node is distance 0', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const g = buildLocalGraph([loaded(r1)])
    const dist = shortestDistances(g, computeRecordHash(r1))
    expect(dist.get(computeRecordHash(r1))).toBe(0)
  })

  it('computes weighted shortest path: chain (1) vs annotation (2)', async () => {
    // r1 -- CHAIN_PRECEDES (w=1) -- r2 -- CHAIN_PRECEDES (w=1) -- r3
    // r1 -- ANNOTATES (via anno, w=2) -- r3 directly through anno
    // Shortest r1 -> r3 is 1 + 1 = 2 via chain.
    const r1 = await makeSigned({ timestamp: 1 })
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      chain_root: chainRootFor(r1),
    })
    const r3 = await makeSigned({
      timestamp: 3,
      content_id: `sha256:${'3'.repeat(64)}`,
      chain_root: chainRootFor(r2),
    })
    const r1Hash = computeRecordHash(r1)
    const r3Hash = computeRecordHash(r3)
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: 4,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    const g = buildLocalGraph([
      loaded(r1),
      loaded(r2),
      loaded(r3),
      loaded(anno, { annotates: r1Hash }),
      // A second annotation on r3 that we never use but keeps both
      // endpoints in the graph.
    ])
    const dist = shortestDistances(g, r1Hash)
    expect(dist.get(r3Hash)).toBe(2) // chain hop r1 -> r2 -> r3, weights 1+1
  })

  it('honors maxHops', async () => {
    // r1 -> r2 -> r3 chained. With maxHops=1 we should see r2 (1 hop) but
    // not r3 (2 hops).
    const r1 = await makeSigned({ timestamp: 1 })
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      chain_root: chainRootFor(r1),
    })
    const r3 = await makeSigned({
      timestamp: 3,
      content_id: `sha256:${'3'.repeat(64)}`,
      chain_root: chainRootFor(r2),
    })
    const g = buildLocalGraph([loaded(r1), loaded(r2), loaded(r3)])
    const r1Hash = computeRecordHash(r1)
    const r2Hash = computeRecordHash(r2)
    const r3Hash = computeRecordHash(r3)
    const dist = shortestDistances(g, r1Hash, undefined, 1)
    expect(dist.get(r2Hash)).toBe(1)
    expect(dist.has(r3Hash)).toBe(false)
  })

  it('filters by edge_types', async () => {
    // r1 connects to r2 via CHAIN_PRECEDES and to r3 via INFORMED_BY.
    // With edge_types={INFORMED_BY}, r2 is unreachable.
    const r1 = await makeSigned({ timestamp: 1 })
    const r1Hash = computeRecordHash(r1)
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      chain_root: chainRootFor(r1),
    })
    const r3 = await makeSigned({
      timestamp: 3,
      content_id: `sha256:${'3'.repeat(64)}`,
      informed_by: [r1Hash],
    })
    const r2Hash = computeRecordHash(r2)
    const r3Hash = computeRecordHash(r3)
    const g = buildLocalGraph([loaded(r1), loaded(r2), loaded(r3)])
    const dist = shortestDistances(g, r1Hash, new Set(['INFORMED_BY']))
    expect(dist.has(r2Hash)).toBe(false)
    expect(dist.get(r3Hash)).toBe(1)
  })
})

describe('walkFrom', () => {
  it('returns empty array when start has no neighbors', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const g = buildLocalGraph([loaded(r1)])
    expect(walkFrom(g, computeRecordHash(r1))).toEqual([])
  })

  it('omits the start node from results', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      chain_root: chainRootFor(r1),
    })
    const g = buildLocalGraph([loaded(r1), loaded(r2)])
    const r1Hash = computeRecordHash(r1)
    const r2Hash = computeRecordHash(r2)
    const walk = walkFrom(g, r1Hash)
    expect(walk).toEqual([{ record_hash: r2Hash, distance: 1 }])
  })

  it('orders by ascending distance', async () => {
    const r1 = await makeSigned({ timestamp: 1 })
    const r1Hash = computeRecordHash(r1)
    const r2 = await makeSigned({
      timestamp: 2,
      content_id: `sha256:${'2'.repeat(64)}`,
      chain_root: chainRootFor(r1),
    })
    const r2Hash = computeRecordHash(r2)
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: 3,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    const annoHash = computeRecordHash(anno)
    // r1 -- CHAIN_PRECEDES (1) -- r2; r1 -- ANNOTATES via anno (2) -- anno
    const g = buildLocalGraph([
      loaded(r1),
      loaded(r2),
      loaded(anno, { annotates: r1Hash }),
    ])
    const walk = walkFrom(g, r1Hash)
    expect(walk[0]?.record_hash).toBe(r2Hash) // distance 1
    expect(walk[0]?.distance).toBe(1)
    expect(walk[1]?.record_hash).toBe(annoHash) // distance 2
    expect(walk[1]?.distance).toBe(2)
  })
})
