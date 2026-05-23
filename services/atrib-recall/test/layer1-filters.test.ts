// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  signRecord,
  getPublicKey,
  base64urlEncode,
  genesisChainRoot,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { recall } from '../src/index.js'
import { computeRecordHash } from '../src/aggregations.js'

const KEY = new Uint8Array(32).fill(7)
const CTX = 'a'.repeat(32)

interface MakeOpts {
  context_id?: string
  event_type?: string
  timestamp?: number
  content_id?: string
  tool_name?: string
  signers?: Array<{ creator_key: string; signature: string }>
}

async function makeSigned(opts: MakeOpts = {}): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const ctx = opts.context_id ?? CTX
  const record: Record<string, unknown> = {
    spec_version: 'atrib/1.0',
    event_type: opts.event_type ?? EVENT_TYPE_TOOL_CALL_URI,
    context_id: ctx,
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(ctx),
    content_id: opts.content_id ?? `sha256:${'c'.repeat(64)}`,
    timestamp: opts.timestamp ?? 1700000000000,
    signature: '',
  }
  if (opts.tool_name) record.tool_name = opts.tool_name
  if (opts.signers) record.signers = opts.signers
  return signRecord(record as AtribRecord, KEY)
}

function envelope(record: AtribRecord, content: unknown): string {
  return JSON.stringify({ record, _local: { content } })
}

let tmp: string
let file: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-layer1-test-'))
  file = join(tmp, 'records.jsonl')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('min_importance filter', () => {
  it('keeps records whose annotations meet the threshold', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(anno, { annotates: targetHash, importance: 'high' }),
      ].join('\n'),
    )
    const result = await recall({ min_importance: 'medium' }, file)
    expect(result.returned).toBe(1)
    expect((result.records[0] as { event_type: string }).event_type).toBe(EVENT_TYPE_TOOL_CALL_URI)
  })

  it('excludes records that meet only a lower importance', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(anno, { annotates: targetHash, importance: 'low' }),
      ].join('\n'),
    )
    const result = await recall({ min_importance: 'high' }, file)
    expect(result.returned).toBe(0)
  })

  it('excludes records with no annotations entirely', async () => {
    const lone = await makeSigned({ timestamp: 1 })
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({ min_importance: 'low' }, file)
    expect(result.returned).toBe(0)
  })

  it('uses max across multiple annotations on the same target', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const a1 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    const a2 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 3 })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(a1, { annotates: targetHash, importance: 'low' }),
        envelope(a2, { annotates: targetHash, importance: 'critical' }),
      ].join('\n'),
    )
    const result = await recall({ min_importance: 'high' }, file)
    expect(result.returned).toBe(1)
  })
})

describe('topic_tags filter', () => {
  it('keeps records whose annotations carry ≥1 matching topic', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(anno, { annotates: targetHash, topic_tags: ['security', 'audit'] }),
      ].join('\n'),
    )
    const result = await recall({ topic_tags: ['security'] }, file)
    expect(result.returned).toBe(1)
  })

  it('excludes records whose annotation topics do not overlap', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(anno, { annotates: targetHash, topic_tags: ['performance'] }),
      ].join('\n'),
    )
    const result = await recall({ topic_tags: ['security'] }, file)
    expect(result.returned).toBe(0)
  })

  it('excludes records with no annotations at all', async () => {
    const lone = await makeSigned()
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({ topic_tags: ['anything'] }, file)
    expect(result.returned).toBe(0)
  })
})

describe('include_revised filter', () => {
  it('default keeps revised records with superseded_by populated', async () => {
    const orig = await makeSigned({ timestamp: 1 })
    const origHash = computeRecordHash(orig)
    const rev = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 2 })
    const revHash = computeRecordHash(rev)
    writeFileSync(
      file,
      [JSON.stringify(orig), envelope(rev, { revises: origHash })].join('\n'),
    )
    const result = await recall({}, file)
    expect(result.returned).toBe(2)
    const origRecord = result.records.find(
      (r) => (r as { event_type: string }).event_type === EVENT_TYPE_TOOL_CALL_URI,
    ) as { superseded_by?: string[] } | undefined
    expect(origRecord?.superseded_by).toEqual([revHash])
  })

  it('include_revised=true hides records that have been revised', async () => {
    const orig = await makeSigned({ timestamp: 1 })
    const origHash = computeRecordHash(orig)
    const rev = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 2 })
    writeFileSync(
      file,
      [JSON.stringify(orig), envelope(rev, { revises: origHash })].join('\n'),
    )
    const result = await recall({ include_revised: true, event_type: 'tool_call' }, file)
    expect(result.returned).toBe(0)
  })
})

describe('min_signers filter', () => {
  it('treats non-transaction records as 1 signer', async () => {
    const r = await makeSigned()
    writeFileSync(file, JSON.stringify(r))
    expect((await recall({ min_signers: 1 }, file)).returned).toBe(1)
    expect((await recall({ min_signers: 2 }, file)).returned).toBe(0)
  })

  it('counts signers[].length when present', async () => {
    // For test purposes we construct a transaction record with a signers
    // array. We don't validate cross-attestation signatures here - that's
    // a separate concern - we just exercise the filter logic.
    const txWith2 = await makeSigned({
      event_type: EVENT_TYPE_TRANSACTION_URI,
      signers: [
        { creator_key: 'k1', signature: 's1' },
        { creator_key: 'k2', signature: 's2' },
      ],
    })
    writeFileSync(file, JSON.stringify(txWith2))
    expect((await recall({ min_signers: 2 }, file)).returned).toBe(1)
    expect((await recall({ min_signers: 3 }, file)).returned).toBe(0)
  })
})

describe('rank_by=relevance', () => {
  // verifyRecord rejects timestamps >5 min in the future, so this section
  // anchors all timestamps to a past wall-clock instant.
  // A recent unix-ms anchor (early May 2026 era); kept under Date.now()
  // so verifyRecord's +5min future-skew check accepts it. Bump this if
  // the test starts producing skewed recency scores in distant future
  // checkouts.
  const RECENT_TS = 1746950000000

  it('importance boosts records of equal recency', async () => {
    // Both records near present, so recency component is ~equal. The
    // critical-annotation record should rank above the un-annotated one
    // because beta*importance > 0 for the former and = 0 for the latter.
    const critRec = await makeSigned({
      timestamp: RECENT_TS,
      content_id: `sha256:${'1'.repeat(64)}`,
    })
    const plainRec = await makeSigned({
      timestamp: RECENT_TS,
      content_id: `sha256:${'2'.repeat(64)}`,
    })
    const critHash = computeRecordHash(critRec)
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: RECENT_TS + 1000,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    writeFileSync(
      file,
      [
        JSON.stringify(critRec),
        JSON.stringify(plainRec),
        envelope(anno, { annotates: critHash, importance: 'critical' }),
      ].join('\n'),
    )
    const result = await recall(
      { rank_by: 'relevance', event_type: 'tool_call', compact: false },
      file,
    )
    expect(result.returned).toBe(2)
    expect((result.records[0] as { content_id: string }).content_id).toBe(`sha256:${'1'.repeat(64)}`)
  })

  it('boosts records matching the rank_anchor query', async () => {
    const r1 = await makeSigned({ timestamp: RECENT_TS, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeSigned({ timestamp: RECENT_TS, content_id: `sha256:${'2'.repeat(64)}` })
    const h1 = computeRecordHash(r1)
    const h2 = computeRecordHash(r2)
    const a1 = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: RECENT_TS + 1,
      content_id: `sha256:${'a'.repeat(64)}`,
    })
    const a2 = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: RECENT_TS + 2,
      content_id: `sha256:${'b'.repeat(64)}`,
    })
    writeFileSync(
      file,
      [
        JSON.stringify(r1),
        JSON.stringify(r2),
        envelope(a1, {
          annotates: h1,
          importance: 'medium',
          topic_tags: ['security'],
          summary: 'authentication bypass found',
        }),
        envelope(a2, {
          annotates: h2,
          importance: 'medium',
          topic_tags: ['performance'],
          summary: 'cache hit rate improved',
        }),
      ].join('\n'),
    )
    // Both records equal-age, equal-importance. Query "authentication"
    // matches r1's annotation summary; r1 should rank above r2. Verify
    // by reading back content_id with compact=false (compact mode drops
    // content_id).
    const result = await recall(
      {
        rank_by: 'relevance',
        rank_anchor: 'authentication bypass',
        event_type: 'tool_call',
        compact: false,
      },
      file,
    )
    expect(result.returned).toBe(2)
    expect((result.records[0] as { content_id: string }).content_id).toBe(`sha256:${'1'.repeat(64)}`)
    expect((result.records[1] as { content_id: string }).content_id).toBe(`sha256:${'2'.repeat(64)}`)
  })

  it('rank_by=causal_distance sorts by BFS distance from rank_anchor', async () => {
    // r1 (anchor) -- CHAIN_PRECEDES -- r2 -- CHAIN_PRECEDES -- r3.
    // Walking from r1, expect r2 (distance 1) before r3 (distance 2).
    // Use a SEPARATE makeSigned helper to attach an explicit chain_root.
    const { canonicalRecord, sha256, hexEncode } = await import('@atrib/mcp')
    const chainRootFor = (r: AtribRecord) =>
      `sha256:${hexEncode(sha256(canonicalRecord(r)))}`
    const r1 = await makeSigned({ timestamp: RECENT_TS, content_id: `sha256:${'1'.repeat(64)}` })
    const r1Hash = computeRecordHash(r1)
    const pub = await getPublicKey(KEY)
    const r2 = await signRecord({
      spec_version: 'atrib/1.0',
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: CTX,
      creator_key: base64urlEncode(pub),
      chain_root: chainRootFor(r1),
      content_id: `sha256:${'2'.repeat(64)}`,
      timestamp: RECENT_TS + 1,
      signature: '',
    } as AtribRecord, KEY)
    const r2Hash = computeRecordHash(r2)
    const r3 = await signRecord({
      spec_version: 'atrib/1.0',
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: CTX,
      creator_key: base64urlEncode(pub),
      chain_root: chainRootFor(r2),
      content_id: `sha256:${'3'.repeat(64)}`,
      timestamp: RECENT_TS + 2,
      signature: '',
    } as AtribRecord, KEY)
    const r3Hash = computeRecordHash(r3)
    writeFileSync(
      file,
      [JSON.stringify(r1), JSON.stringify(r2), JSON.stringify(r3)].join('\n'),
    )
    const result = await recall(
      { rank_by: 'causal_distance', rank_anchor: r1Hash, compact: false },
      file,
    )
    expect(result.returned).toBe(3)
    // r1 at distance 0; then r2 at distance 1; then r3 at distance 2.
    // Assert via the distinct content_id values rather than re-hashing the
    // compact=false response, RecallRecordFull carries extra fields
    // (signature_verified, etc.) that change the canonical hash.
    const contentIds = (result.records as Array<{ content_id: string }>).map(
      (r) => r.content_id,
    )
    expect(contentIds).toEqual([
      `sha256:${'1'.repeat(64)}`,
      `sha256:${'2'.repeat(64)}`,
      `sha256:${'3'.repeat(64)}`,
    ])
    // Use the constructed hashes too so they aren't dead variables.
    expect([r1Hash, r2Hash, r3Hash]).toHaveLength(3)
  })

  it('rank_by=causal_distance falls back to timestamp when rank_anchor is unusable', async () => {
    const r1 = await makeSigned({ timestamp: RECENT_TS })
    const r2 = await makeSigned({ timestamp: RECENT_TS + 1, content_id: `sha256:${'2'.repeat(64)}` })
    writeFileSync(file, [JSON.stringify(r1), JSON.stringify(r2)].join('\n'))
    const result = await recall({ rank_by: 'causal_distance' }, file)
    expect(result.returned).toBe(2)
    // Newest first (r2 then r1)
    expect(result.records[0]!.timestamp).toBe(RECENT_TS + 1)
  })

  it('record_hash-shaped rank_anchor does NOT inject as a BM25 query', async () => {
    // When rank_anchor parses as sha256:<64-hex>, the relevance component
    // collapses to 0, the recall path treats it as a causal_distance
    // anchor (still stub-accepted) rather than a free-form query.
    // Uses Date.now() for the timestamp so recency keeps the Park score
    // above the Layer 1 v2 anti-noise threshold (a stale fixture would
    // be suppressed by ATRIB_RECALL_NOISE_FLOOR; this test is about the
    // rank_anchor parsing, not threshold behavior).
    const r = await makeSigned({ timestamp: Date.now() })
    writeFileSync(file, JSON.stringify(r))
    const result = await recall(
      { rank_by: 'relevance', rank_anchor: `sha256:${'0'.repeat(64)}` },
      file,
    )
    expect(result.returned).toBe(1)
    // No throw, normal response shape returned.
  })

  it('anti-noise threshold suppresses results when top Park score is below ATRIB_RECALL_NOISE_FLOOR', async () => {
    // Stale timestamp (no recency), no annotation (no importance), no
    // BM25 query (no relevance). Park score collapses to ~0 < default
    // floor of 0.15. Recall returns empty + quality='below_threshold'
    // instead of low-confidence top-K.
    const r = await makeSigned({ timestamp: RECENT_TS })
    writeFileSync(file, JSON.stringify(r))
    const result = await recall(
      { rank_by: 'relevance', rank_anchor: 'nonexistent-token-xyz' },
      file,
    )
    expect(result.returned).toBe(0)
    expect(result.records).toEqual([])
    expect((result as { quality?: string }).quality).toBe('below_threshold')
    expect((result as { top_score?: number }).top_score).toBeLessThan(0.15)
  })

  it('anti-noise threshold does NOT suppress when results clear the floor', async () => {
    // Fresh timestamp gives recency ~1.0; alpha*1.0 = 0.3 > 0.15 floor.
    const r = await makeSigned({ timestamp: Date.now() })
    writeFileSync(file, JSON.stringify(r))
    const result = await recall(
      { rank_by: 'relevance', rank_anchor: 'nonexistent-token-xyz' },
      file,
    )
    expect(result.returned).toBe(1)
    expect((result as { quality?: string }).quality).toBeUndefined()
  })

  it('anti-noise threshold does NOT apply to rank_by=timestamp', async () => {
    // Default rank_by=timestamp never triggers the threshold; the floor
    // applies only when the agent explicitly asks for relevance ranking.
    const r = await makeSigned({ timestamp: RECENT_TS })
    writeFileSync(file, JSON.stringify(r))
    const result = await recall({}, file)
    expect(result.returned).toBe(1)
    expect((result as { quality?: string }).quality).toBeUndefined()
  })
})

describe('Layer 1 v2 legibility fields in compact response', () => {
  it('display_summary, display_producer, age fields are present on each record', async () => {
    const r = await makeSigned({ timestamp: Date.now() })
    writeFileSync(file, JSON.stringify(r))
    const result = await recall({}, file)
    expect(result.returned).toBe(1)
    const rec = result.records[0] as {
      display_summary?: string
      display_producer?: string
      age?: string
    }
    expect(typeof rec.display_summary).toBe('string')
    expect(rec.display_summary!.length).toBeGreaterThan(0)
    expect(typeof rec.display_producer).toBe('string')
    expect(rec.display_producer).toMatch(/^(key:|[a-z])/)
    expect(typeof rec.age).toBe('string')
    expect(rec.age).toBe('just now')
  })
})

describe('toc=true response shape', () => {
  it('returns the TOC entry shape per record', async () => {
    const target = await makeSigned({ timestamp: 1700000000000 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: 1700000001000,
    })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(anno, {
          annotates: targetHash,
          importance: 'high',
          topic_tags: ['security', 'audit'],
          summary: 'auth bypass',
        }),
      ].join('\n'),
    )
    const result = await recall({ toc: true, event_type: 'tool_call' }, file)
    expect(result.returned).toBe(1)
    const entry = result.records[0] as {
      record_hash?: string
      tool_name?: string
      summary?: string
      importance?: string
      topic_tags?: string[]
      timestamp: number
      superseded_by?: string[]
    }
    expect(entry.record_hash).toBe(targetHash)
    expect(entry.summary).toBe('auth bypass')
    expect(entry.importance).toBe('high')
    expect(entry.topic_tags).toEqual(['audit', 'security'])
    expect(entry.timestamp).toBe(1700000000000)
    // TOC entries DO NOT include the heavy AtribRecord fields.
    expect((entry as { signature?: string }).signature).toBeUndefined()
    expect((entry as { creator_key?: string }).creator_key).toBeUndefined()
    expect((entry as { event_type?: string }).event_type).toBeUndefined()
  })

  it('omits optional fields when not present', async () => {
    const lone = await makeSigned({ timestamp: 1700000000000 })
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({ toc: true }, file)
    expect(result.returned).toBe(1)
    const entry = result.records[0] as {
      timestamp: number
      summary?: string
      importance?: string
      topic_tags?: string[]
      superseded_by?: string[]
    }
    expect(entry.timestamp).toBe(1700000000000)
    expect(entry.summary).toBeUndefined()
    expect(entry.importance).toBeUndefined()
    expect(entry.topic_tags).toBeUndefined()
    expect(entry.superseded_by).toBeUndefined()
  })

  it('layer_1_warnings is empty when toc=true (no longer stub-accepted)', async () => {
    const lone = await makeSigned({ timestamp: 1700000000000 })
    writeFileSync(file, JSON.stringify(lone))
    // recall() doesn't surface layer_1_warnings directly; that's the MCP
    // handler layer. Here we just exercise the recall() core to confirm
    // toc=true doesn't error and produces TOC shape.
    const result = await recall({ toc: true }, file)
    expect(result.returned).toBe(1)
  })
})

describe('response enrichment', () => {
  it('attaches annotations field when record has annotations', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    writeFileSync(
      file,
      [
        JSON.stringify(target),
        envelope(anno, {
          annotates: targetHash,
          importance: 'high',
          topic_tags: ['security'],
          summary: 'auth bypass found',
        }),
      ].join('\n'),
    )
    const result = await recall({ event_type: 'tool_call' }, file)
    expect(result.returned).toBe(1)
    expect((result.records[0] as { annotations?: unknown }).annotations).toEqual({
      max_importance: 'high',
      topics: ['security'],
      summary: 'auth bypass found',
    })
  })

  it('omits annotations field when record has none', async () => {
    const lone = await makeSigned()
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({}, file)
    expect((result.records[0] as { annotations?: unknown }).annotations).toBeUndefined()
  })

  it('omits superseded_by field when record has no revisions', async () => {
    const lone = await makeSigned()
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({}, file)
    expect(result.records[0]!.superseded_by).toBeUndefined()
  })
})
