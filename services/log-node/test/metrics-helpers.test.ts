// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for the pure helpers in scripts/metrics.mjs.
 *
 * The Tier 1 snapshot script feeds METRICS.md review meetings. Bad parsing
 * or arithmetic here produces silent garbage in committed snapshots. These
 * tests pin the metric definitions, the wire-format parsers, and the
 * delta-computation logic to known-good fixtures.
 */

import { describe, it, expect } from 'vitest'
import {
  METRICS,
  bucketize,
  parseEntryBundle,
  parseEntry,
  computeDeltas,
  parseCheckpointBody,
} from '../scripts/metrics.mjs'

interface MetricEntry {
  name: string
  tier: number
  status: 'provisional' | 'tracked' | 'load-bearing' | 'retired'
  decisionSupported: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (ctx: any) => any
}

function makeEntry(opts: {
  recordHash?: Uint8Array
  creatorKey?: Uint8Array
  contextId?: Uint8Array
  ts?: number
  eventType?: number
} = {}): { recordHash: Uint8Array; creatorKey: Uint8Array; contextId: Uint8Array; ts: number; eventType: number } {
  return {
    recordHash: opts.recordHash ?? new Uint8Array(32).fill(0xab),
    creatorKey: opts.creatorKey ?? new Uint8Array(32).fill(1),
    contextId: opts.contextId ?? new Uint8Array(16).fill(2),
    ts: opts.ts ?? 1700000000000,
    eventType: opts.eventType ?? 0x01,
  }
}

describe('metrics METRICS array shape', () => {
  it('every entry has required fields', () => {
    for (const m of METRICS as MetricEntry[]) {
      expect(typeof m.name).toBe('string')
      expect(m.tier).toBeGreaterThanOrEqual(0)
      expect(['provisional', 'tracked', 'load-bearing', 'retired']).toContain(m.status)
      expect(typeof m.decisionSupported).toBe('string')
      expect(typeof m.run).toBe('function')
    }
  })

  it('contains the named load-bearing metrics from METRICS.md', () => {
    const names = (METRICS as MetricEntry[]).map((m) => m.name)
    expect(names).toContain('tree_size')
    expect(names).toContain('distinct_creator_keys')
    expect(names).toContain('chain_depth')
    expect(names).toContain('event_type_ratio')
  })
})

describe('metric: tree_size', () => {
  const m = (METRICS as MetricEntry[]).find((x) => x.name === 'tree_size')!
  it('returns ctx.treeSize unchanged', () => {
    expect(m.run({ treeSize: 0, entries: [] })).toBe(0)
    expect(m.run({ treeSize: 137, entries: [] })).toBe(137)
  })
})

describe('metric: distinct_creator_keys', () => {
  const m = (METRICS as MetricEntry[]).find((x) => x.name === 'distinct_creator_keys')!
  it('counts unique creator_key values across entries', () => {
    const k1 = new Uint8Array(32).fill(1)
    const k2 = new Uint8Array(32).fill(2)
    const entries = [
      makeEntry({ creatorKey: k1 }),
      makeEntry({ creatorKey: k1 }),
      makeEntry({ creatorKey: k2 }),
    ]
    expect(m.run({ entries })).toBe(2)
  })

  it('returns 0 for empty input', () => {
    expect(m.run({ entries: [] })).toBe(0)
  })
})

describe('metric: distinct_context_ids', () => {
  const m = (METRICS as MetricEntry[]).find((x) => x.name === 'distinct_context_ids')!
  it('counts unique context_id values', () => {
    const c1 = new Uint8Array(16).fill(1)
    const c2 = new Uint8Array(16).fill(2)
    const c3 = new Uint8Array(16).fill(3)
    const entries = [
      makeEntry({ contextId: c1 }),
      makeEntry({ contextId: c2 }),
      makeEntry({ contextId: c2 }),
      makeEntry({ contextId: c3 }),
    ]
    expect(m.run({ entries })).toBe(3)
  })
})

describe('metric: chain_depth', () => {
  const m = (METRICS as MetricEntry[]).find((x) => x.name === 'chain_depth')!

  it('returns zeros for an empty corpus', () => {
    const out = m.run({ entries: [] })
    expect(out).toMatchObject({ median: 0, p95: 0, max: 0, n: 0 })
  })

  it('reports per-context counts: 3 contexts of depth 1, 2, 5 → max 5, n 3', () => {
    const c = (i: number) => {
      const out = new Uint8Array(16).fill(0)
      out[0] = i
      return out
    }
    const entries = [
      makeEntry({ contextId: c(1) }),
      makeEntry({ contextId: c(2) }),
      makeEntry({ contextId: c(2) }),
      makeEntry({ contextId: c(3) }),
      makeEntry({ contextId: c(3) }),
      makeEntry({ contextId: c(3) }),
      makeEntry({ contextId: c(3) }),
      makeEntry({ contextId: c(3) }),
    ]
    const out = m.run({ entries })
    expect(out.max).toBe(5)
    expect(out.n).toBe(3)
    expect(out.distribution_buckets).toBeDefined()
  })
})

describe('metric: event_type_ratio', () => {
  const m = (METRICS as MetricEntry[]).find((x) => x.name === 'event_type_ratio')!

  it('counts tool_calls, transactions, observations, extensions, and computes percentage', () => {
    const entries = [
      makeEntry({ eventType: 0x01 }),
      makeEntry({ eventType: 0x01 }),
      makeEntry({ eventType: 0x01 }),
      makeEntry({ eventType: 0x02 }),
      makeEntry({ eventType: 0x03 }),
      makeEntry({ eventType: 0xff }),
    ]
    const out = m.run({ entries })
    expect(out.tool_call).toBe(3)
    expect(out.transaction).toBe(1)
    expect(out.observation).toBe(1)
    expect(out.extension).toBe(1)
    expect(out.total).toBe(6)
    // 1 transaction out of 6 total = 16.67%
    expect(out.transaction_pct).toBeCloseTo(16.67, 1)
  })

  it('handles empty corpus without divide-by-zero', () => {
    const out = m.run({ entries: [] })
    expect(out.transaction_pct).toBe(0)
  })
})

describe('metric: top_creator_share', () => {
  const m = (METRICS as MetricEntry[]).find((x) => x.name === 'top_creator_share')!

  it('returns 1 (all attributable) for empty corpus', () => {
    expect(m.run({ entries: [] })).toBe(1)
  })

  it('computes top creator percentage when one signer dominates', () => {
    const dominant = new Uint8Array(32).fill(7)
    const minor = new Uint8Array(32).fill(8)
    const entries = [
      makeEntry({ creatorKey: dominant }),
      makeEntry({ creatorKey: dominant }),
      makeEntry({ creatorKey: dominant }),
      makeEntry({ creatorKey: minor }),
    ]
    expect(m.run({ entries })).toBe(75)
  })
})

describe('bucketize', () => {
  it('places values into the correct buckets', () => {
    const buckets = bucketize([0, 1, 2, 3, 5, 9, 50], [1, 2, 3, 5, 10, 25, 100])
    expect(buckets['<=1']).toBe(2) // 0, 1
    expect(buckets['<=2']).toBe(1) // 2
    expect(buckets['<=3']).toBe(1) // 3
    expect(buckets['<=5']).toBe(1) // 5
    expect(buckets['<=10']).toBe(1) // 9
    expect(buckets['<=25']).toBe(0)
    expect(buckets['<=100']).toBe(1) // 50
    expect(buckets['>100']).toBe(0)
  })

  it('overflow values land in the >max bucket', () => {
    const buckets = bucketize([200, 1000], [1, 2, 5])
    expect(buckets['>5']).toBe(2)
  })
})

describe('parseEntryBundle', () => {
  it('parses length-prefixed entries', () => {
    const bundle = new Uint8Array([
      0x00, 0x03, 1, 2, 3,
      0x00, 0x02, 9, 9,
    ])
    const out = parseEntryBundle(bundle)
    expect(out).toHaveLength(2)
    expect(Array.from(out[0])).toEqual([1, 2, 3])
    expect(Array.from(out[1])).toEqual([9, 9])
  })

  it('returns empty for empty input', () => {
    expect(parseEntryBundle(new Uint8Array(0))).toEqual([])
  })
})

describe('parseEntry', () => {
  it('extracts §2.3.1 fields at correct offsets', () => {
    const buf = new Uint8Array(90)
    buf[0] = 0x01
    buf.set(new Uint8Array(32).map((_, i) => i + 1), 1)
    buf.set(new Uint8Array(32).fill(0xcc), 33)
    buf.set(new Uint8Array(16).fill(0xdd), 65)
    new DataView(buf.buffer).setBigUint64(81, 1735689600000n, false)
    buf[89] = 0x02
    const e = parseEntry(buf)
    expect(e.version).toBe(0x01)
    expect(e.eventType).toBe(0x02)
    expect(e.ts).toBe(1735689600000)
    expect(e.recordHash.length).toBe(32)
    expect(e.creatorKey.length).toBe(32)
    expect(e.contextId.length).toBe(16)
  })
})

describe('parseCheckpointBody', () => {
  it('extracts origin, treeSize, rootHash from the canonical body shape', () => {
    const text = `log.atrib.dev/v1\n100\nROOTBASE64\n\nsig-block-ignored`
    const cp = parseCheckpointBody(text)
    expect(cp.origin).toBe('log.atrib.dev/v1')
    expect(cp.treeSize).toBe(100)
    expect(cp.rootHashB64).toBe('ROOTBASE64')
  })
})

describe('computeDeltas', () => {
  const baseSnapshot = (ts: string, metrics: Record<string, unknown>) => ({
    schema_version: 'atrib-metrics/1',
    ts,
    log: { endpoint: 'x', root_hash_b64: 'r' },
    metrics,
  })

  it('returns null when no history exists', () => {
    expect(computeDeltas(baseSnapshot('2026-04-27T00:00:00Z', { tree_size: 10 }), [])).toBeNull()
  })

  it('reports record_added vs the snapshot closest to 7 days back', () => {
    const cur = baseSnapshot('2026-04-27T00:00:00Z', {
      tree_size: 50,
      distinct_creator_keys: 3,
      distinct_context_ids: 9,
    })
    const history = [
      baseSnapshot('2026-04-20T00:00:00Z', {
        tree_size: 20,
        distinct_creator_keys: 1,
        distinct_context_ids: 4,
      }),
    ]
    const deltas = computeDeltas(cur, history)
    expect(deltas).not.toBeNull()
    expect(deltas!.records_added).toBe(30)
    expect(deltas!.distinct_creator_keys_added).toBe(2)
    expect(deltas!.distinct_context_ids_added).toBe(5)
    expect(deltas!.elapsed_days).toBe(7)
  })

  it('returns null records_per_day when elapsed is 0 (same-day re-run)', () => {
    const sameTs = '2026-04-27T00:00:00Z'
    const cur = baseSnapshot(sameTs, { tree_size: 50 })
    const history = [baseSnapshot(sameTs, { tree_size: 50 })]
    // Same-ts history is filtered out (Date.parse(prev.ts) < Date.parse(cur.ts) is false)
    expect(computeDeltas(cur, history)).toBeNull()
  })
})
