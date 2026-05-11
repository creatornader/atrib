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
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  computeRecordHash,
  loadLoaded,
  loadLoadedFromDir,
  aggregateAnnotationsByRecord,
  aggregateRevisionsByRecord,
} from '../src/aggregations.js'

const KEY = new Uint8Array(32).fill(7)
const CTX = 'a'.repeat(32)

interface MakeRecordOpts {
  context_id?: string
  event_type?: string
  timestamp?: number
  content_id?: string
}

async function makeSigned(opts: MakeRecordOpts = {}): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const ctx = opts.context_id ?? CTX
  const record = {
    spec_version: 'atrib/1.0' as const,
    event_type: opts.event_type ?? EVENT_TYPE_TOOL_CALL_URI,
    context_id: ctx,
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(ctx),
    content_id: opts.content_id ?? `sha256:${'c'.repeat(64)}`,
    timestamp: opts.timestamp ?? 1700000000000,
    signature: '',
  }
  return signRecord(record as AtribRecord, KEY)
}

function envelope(record: AtribRecord, content: unknown): string {
  return JSON.stringify({ record, _local: { content } })
}

let tmp: string
let file: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-aggregations-test-'))
  file = join(tmp, 'records.jsonl')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('computeRecordHash', () => {
  it('produces a stable sha256:<64-hex> hash', async () => {
    const r = await makeSigned()
    const h = computeRecordHash(r)
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('is deterministic for the same record', async () => {
    const r = await makeSigned()
    expect(computeRecordHash(r)).toBe(computeRecordHash(r))
  })

  it('distinguishes different records', async () => {
    const a = await makeSigned({ timestamp: 1 })
    const b = await makeSigned({ timestamp: 2 })
    expect(computeRecordHash(a)).not.toBe(computeRecordHash(b))
  })
})

describe('loadLoaded', () => {
  it('returns empty array when file missing', () => {
    expect(loadLoaded(join(tmp, 'missing.jsonl'))).toEqual([])
  })

  it('loads bare AtribRecord lines without content', async () => {
    const r = await makeSigned()
    writeFileSync(file, JSON.stringify(r))
    const loaded = loadLoaded(file)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.record.signature).toBe(r.signature)
    expect(loaded[0]!.record_hash).toBe(computeRecordHash(r))
    expect(loaded[0]!.content).toBeUndefined()
  })

  it('loads D062 envelope lines with _local.content preserved', async () => {
    const r = await makeSigned()
    writeFileSync(file, envelope(r, { foo: 'bar', n: 42 }))
    const loaded = loadLoaded(file)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.content).toEqual({ foo: 'bar', n: 42 })
    expect(loaded[0]!.record_hash).toBe(computeRecordHash(r))
  })

  it('mixes bare + envelope lines in one file', async () => {
    const bare = await makeSigned({ timestamp: 1 })
    const wrapped = await makeSigned({ timestamp: 2 })
    writeFileSync(
      file,
      [JSON.stringify(bare), envelope(wrapped, { foo: 'bar' })].join('\n'),
    )
    const loaded = loadLoaded(file)
    expect(loaded).toHaveLength(2)
    expect(loaded[0]!.content).toBeUndefined()
    expect(loaded[1]!.content).toEqual({ foo: 'bar' })
  })

  it('silently skips malformed JSON lines', async () => {
    const r = await makeSigned()
    writeFileSync(file, ['{not-json', JSON.stringify(r), ''].join('\n'))
    expect(loadLoaded(file)).toHaveLength(1)
  })

  it('silently skips lines missing required AtribRecord fields', () => {
    writeFileSync(
      file,
      [JSON.stringify({ spec_version: 'atrib/1.0' }), JSON.stringify({})].join('\n'),
    )
    expect(loadLoaded(file)).toEqual([])
  })
})

describe('loadLoadedFromDir', () => {
  it('returns empty + empty file list when directory missing', () => {
    expect(loadLoadedFromDir(join(tmp, 'missing'))).toEqual({
      loaded: [],
      files: [],
    })
  })

  it('unions records across multiple jsonl files', async () => {
    const a = await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}` })
    const b = await makeSigned({ timestamp: 2, content_id: `sha256:${'b'.repeat(64)}` })
    writeFileSync(join(tmp, 'one.jsonl'), JSON.stringify(a))
    writeFileSync(join(tmp, 'two.jsonl'), envelope(b, { tag: 'x' }))
    writeFileSync(join(tmp, 'ignored.txt'), 'not jsonl')
    const out = loadLoadedFromDir(tmp)
    expect(out.loaded).toHaveLength(2)
    expect(out.files).toHaveLength(2)
    expect(out.files.every((f) => f.endsWith('.jsonl'))).toBe(true)
  })
})

describe('aggregateAnnotationsByRecord', () => {
  it('returns empty map when no records', () => {
    expect(aggregateAnnotationsByRecord([])).toEqual(new Map())
  })

  it('skips non-annotation records', async () => {
    const tc = await makeSigned()
    const out = aggregateAnnotationsByRecord([
      { record: tc, record_hash: computeRecordHash(tc), content: { ignored: true } },
    ])
    expect(out.size).toBe(0)
  })

  it('skips annotation records without _local.content (§8.1 bare posture)', async () => {
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI })
    const out = aggregateAnnotationsByRecord([
      { record: anno, record_hash: computeRecordHash(anno) },
    ])
    expect(out.size).toBe(0)
  })

  it('skips annotations without an annotates target', async () => {
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI })
    const out = aggregateAnnotationsByRecord([
      {
        record: anno,
        record_hash: computeRecordHash(anno),
        content: { importance: 'high', topic_tags: ['x'] },
      },
    ])
    expect(out.size).toBe(0)
  })

  it('bins a single annotation onto its target', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({
      event_type: EVENT_TYPE_ANNOTATION_URI,
      timestamp: 2,
    })
    const out = aggregateAnnotationsByRecord([
      { record: target, record_hash: targetHash },
      {
        record: anno,
        record_hash: computeRecordHash(anno),
        content: {
          annotates: targetHash,
          importance: 'high',
          topic_tags: ['security', 'audit'],
          summary: 'looks suspicious',
        },
      },
    ])
    expect(out.size).toBe(1)
    expect(out.get(targetHash)).toEqual({
      max_importance: 'high',
      topics: ['audit', 'security'],
      summary: 'looks suspicious',
    })
  })

  it('reduces multiple annotations: max importance, union topics, latest summary', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const a1 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 10 })
    const a2 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 20 })
    const a3 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 15 })
    const out = aggregateAnnotationsByRecord([
      { record: target, record_hash: targetHash },
      {
        record: a1,
        record_hash: computeRecordHash(a1),
        content: { annotates: targetHash, importance: 'low', topic_tags: ['a'], summary: 'first' },
      },
      {
        record: a2,
        record_hash: computeRecordHash(a2),
        content: { annotates: targetHash, importance: 'high', topic_tags: ['b'], summary: 'newest' },
      },
      {
        record: a3,
        record_hash: computeRecordHash(a3),
        content: { annotates: targetHash, importance: 'critical', topic_tags: ['c', 'a'] },
      },
    ])
    expect(out.size).toBe(1)
    const s = out.get(targetHash)!
    expect(s.max_importance).toBe('critical')
    expect(s.topics).toEqual(['a', 'b', 'c'])
    expect(s.summary).toBe('newest')
  })

  it('handles invalid importance gracefully (topics still aggregate)', async () => {
    const target = await makeSigned({ timestamp: 1 })
    const targetHash = computeRecordHash(target)
    const anno = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 2 })
    const out = aggregateAnnotationsByRecord([
      {
        record: anno,
        record_hash: computeRecordHash(anno),
        content: {
          annotates: targetHash,
          importance: 'enormous',
          topic_tags: ['x'],
        },
      },
    ])
    const s = out.get(targetHash)
    expect(s).toBeDefined()
    expect(s!.max_importance).toBeUndefined()
    expect(s!.topics).toEqual(['x'])
  })

  it('groups annotations across distinct targets', async () => {
    const t1 = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const t2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    const h1 = computeRecordHash(t1)
    const h2 = computeRecordHash(t2)
    const a1 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 10 })
    const a2 = await makeSigned({ event_type: EVENT_TYPE_ANNOTATION_URI, timestamp: 11 })
    const out = aggregateAnnotationsByRecord([
      { record: a1, record_hash: computeRecordHash(a1), content: { annotates: h1, importance: 'medium' } },
      { record: a2, record_hash: computeRecordHash(a2), content: { annotates: h2, importance: 'low' } },
    ])
    expect(out.size).toBe(2)
    expect(out.get(h1)!.max_importance).toBe('medium')
    expect(out.get(h2)!.max_importance).toBe('low')
  })
})

describe('aggregateRevisionsByRecord', () => {
  it('returns empty map when no records', () => {
    expect(aggregateRevisionsByRecord([])).toEqual(new Map())
  })

  it('skips non-revision records', async () => {
    const tc = await makeSigned()
    const out = aggregateRevisionsByRecord([
      { record: tc, record_hash: computeRecordHash(tc), content: { revises: 'irrelevant' } },
    ])
    expect(out.size).toBe(0)
  })

  it('skips revision records without _local.content (§8.1 bare posture)', async () => {
    const rev = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI })
    const out = aggregateRevisionsByRecord([
      { record: rev, record_hash: computeRecordHash(rev) },
    ])
    expect(out.size).toBe(0)
  })

  it('skips revisions without a revises target', async () => {
    const rev = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI })
    const out = aggregateRevisionsByRecord([
      {
        record: rev,
        record_hash: computeRecordHash(rev),
        content: { reason: 'changed mind', new_position: 'X' },
      },
    ])
    expect(out.size).toBe(0)
  })

  it('bins a single revision onto its target', async () => {
    const orig = await makeSigned({ timestamp: 1 })
    const origHash = computeRecordHash(orig)
    const rev = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 2 })
    const revHash = computeRecordHash(rev)
    const out = aggregateRevisionsByRecord([
      { record: orig, record_hash: origHash },
      {
        record: rev,
        record_hash: revHash,
        content: { revises: origHash, reason: 'updated', new_position: 'Y' },
      },
    ])
    expect(out.size).toBe(1)
    expect(out.get(origHash)).toEqual([revHash])
  })

  it('orders multiple revisions by timestamp ascending', async () => {
    const orig = await makeSigned({ timestamp: 1 })
    const origHash = computeRecordHash(orig)
    const r1 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 20 })
    const r2 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 10 })
    const r3 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 30 })
    const h1 = computeRecordHash(r1)
    const h2 = computeRecordHash(r2)
    const h3 = computeRecordHash(r3)
    const out = aggregateRevisionsByRecord([
      { record: orig, record_hash: origHash },
      { record: r1, record_hash: h1, content: { revises: origHash } },
      { record: r2, record_hash: h2, content: { revises: origHash } },
      { record: r3, record_hash: h3, content: { revises: origHash } },
    ])
    expect(out.get(origHash)).toEqual([h2, h1, h3])
  })

  it('groups revisions across distinct targets', async () => {
    const t1 = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const t2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    const h1 = computeRecordHash(t1)
    const h2 = computeRecordHash(t2)
    const rev1 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 10 })
    const rev2 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 11 })
    const out = aggregateRevisionsByRecord([
      { record: rev1, record_hash: computeRecordHash(rev1), content: { revises: h1 } },
      { record: rev2, record_hash: computeRecordHash(rev2), content: { revises: h2 } },
    ])
    expect(out.size).toBe(2)
    expect(out.get(h1)).toEqual([computeRecordHash(rev1)])
    expect(out.get(h2)).toEqual([computeRecordHash(rev2)])
  })

  it('captures revision chains (target may itself be a revision)', async () => {
    const orig = await makeSigned({ timestamp: 1 })
    const origHash = computeRecordHash(orig)
    const r1 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 10 })
    const r1Hash = computeRecordHash(r1)
    const r2 = await makeSigned({ event_type: EVENT_TYPE_REVISION_URI, timestamp: 20 })
    const r2Hash = computeRecordHash(r2)
    const out = aggregateRevisionsByRecord([
      { record: orig, record_hash: origHash },
      { record: r1, record_hash: r1Hash, content: { revises: origHash } },
      { record: r2, record_hash: r2Hash, content: { revises: r1Hash } },
    ])
    expect(out.get(origHash)).toEqual([r1Hash])
    expect(out.get(r1Hash)).toEqual([r2Hash])
  })
})
