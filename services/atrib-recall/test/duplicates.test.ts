// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_REVISION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  base64urlEncode,
  genesisChainRoot,
  getPublicKey,
  signRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { recall } from '../src/index.js'
import { computeRecordHash } from '../src/aggregations.js'
import {
  collapseDuplicateGroups,
  duplicateBucketForRecord,
  duplicateKeyForRecord,
  findDuplicateGroups,
} from '../src/duplicates.js'

const KEY = new Uint8Array(32).fill(9)
const OTHER_KEY = new Uint8Array(32).fill(10)
const CTX = 'b'.repeat(32)
const ARGS = `sha256:${'a'.repeat(64)}`

interface MakeOpts {
  key?: Uint8Array
  context_id?: string
  event_type?: string
  timestamp?: number
  chain_root?: string
  args_hash?: string | null
  informed_by?: string[]
  annotates?: string
  revises?: string
}

async function makeSigned(opts: MakeOpts = {}): Promise<AtribRecord> {
  const key = opts.key ?? KEY
  const ctx = opts.context_id ?? CTX
  const record: Record<string, unknown> = {
    spec_version: 'atrib/1.0',
    event_type: opts.event_type ?? EVENT_TYPE_OBSERVATION_URI,
    context_id: ctx,
    creator_key: base64urlEncode(await getPublicKey(key)),
    chain_root: opts.chain_root ?? genesisChainRoot(ctx),
    content_id: `sha256:${'c'.repeat(64)}`,
    timestamp: opts.timestamp ?? 1700000000000,
    signature: '',
  }
  if (opts.args_hash !== null) record.args_hash = opts.args_hash ?? ARGS
  if (opts.informed_by) record.informed_by = opts.informed_by
  if (opts.annotates) record.annotates = opts.annotates
  if (opts.revises) record.revises = opts.revises
  return signRecord(record as AtribRecord, key)
}

function line(record: AtribRecord, what: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ record, _local: { content: { what, ...extra }, producer: 'test' } })
}

describe('duplicateKeyForRecord', () => {
  it('is shared by re-signed copies that differ only in timestamp, chain_root and signature', async () => {
    const first = await makeSigned({ timestamp: 1 })
    const again = await makeSigned({ timestamp: 2, chain_root: `sha256:${'d'.repeat(64)}` })
    expect(first.signature).not.toBe(again.signature)
    expect(duplicateKeyForRecord(first)).toBeDefined()
    expect(duplicateKeyForRecord(again)).toBe(duplicateKeyForRecord(first))
  })

  it('differs when any other signed field differs', async () => {
    const base = duplicateKeyForRecord(await makeSigned())
    const variants = [
      await makeSigned({ args_hash: `sha256:${'e'.repeat(64)}` }),
      await makeSigned({ context_id: 'f'.repeat(32) }),
      await makeSigned({ key: OTHER_KEY }),
      await makeSigned({ event_type: 'https://example.com/types/custom' }),
      await makeSigned({ informed_by: [`sha256:${'1'.repeat(64)}`] }),
    ]
    for (const variant of variants) {
      expect(duplicateKeyForRecord(variant)).toBeDefined()
      expect(duplicateKeyForRecord(variant)).not.toBe(base)
    }
  })

  it('never keys tool calls, transactions, or records without a content commitment', async () => {
    expect(
      duplicateKeyForRecord(await makeSigned({ event_type: EVENT_TYPE_TOOL_CALL_URI })),
    ).toBeUndefined()
    expect(
      duplicateKeyForRecord(await makeSigned({ event_type: EVENT_TYPE_TRANSACTION_URI })),
    ).toBeUndefined()
    expect(duplicateKeyForRecord(await makeSigned({ args_hash: null }))).toBeUndefined()
  })

  it('ignores the key order of the record object', async () => {
    const record = await makeSigned()
    const reordered = Object.fromEntries(Object.entries(record).reverse()) as unknown as AtribRecord
    expect(duplicateKeyForRecord(reordered)).toBe(duplicateKeyForRecord(record))
  })
})

describe('findDuplicateGroups', () => {
  type Item = { key?: string; t: number; h: string }
  const describeItem = (item: Item) => ({
    bucket: item.key,
    key: () => item.key,
    timestamp: item.t,
    recordHash: item.h,
  })

  it('groups copies earliest first and keeps the earliest by default', () => {
    const items: Item[] = [
      { key: 'x', t: 30, h: 'c' },
      { t: 25, h: 'solo' },
      { key: 'x', t: 10, h: 'a' },
      { key: 'y', t: 5, h: 'y1' },
      { key: 'x', t: 20, h: 'b' },
    ]
    const groups = findDuplicateGroups(items, describeItem)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.members.map((item) => item.h)).toEqual(['a', 'b', 'c'])
    expect(groups[0]!.latestTimestamp).toBe(30)
    const result = collapseDuplicateGroups(items, groups)
    expect(result.kept.map((item) => item.h)).toEqual(['solo', 'a', 'y1'])
    expect(result.collapsed).toBe(2)
    expect(result.groupOf.get(items[2]!)).toBe(groups[0])
  })

  it('breaks a timestamp tie by the smaller record hash', () => {
    const items: Item[] = [
      { key: 'x', t: 1, h: 'b' },
      { key: 'x', t: 1, h: 'a' },
    ]
    for (const input of [items, items.slice().reverse()]) {
      const groups = findDuplicateGroups(input, describeItem)
      expect(collapseDuplicateGroups(input, groups).kept.map((item) => item.h)).toEqual(['a'])
    }
  })

  it('lets the caller choose which copy stands for the group', () => {
    const items: Item[] = [
      { key: 'x', t: 1, h: 'a' },
      { key: 'x', t: 2, h: 'b' },
    ]
    const groups = findDuplicateGroups(items, describeItem)
    const result = collapseDuplicateGroups(items, groups, (group) => group.members[1]!)
    expect(result.kept.map((item) => item.h)).toEqual(['b'])
  })

  it('finds nothing when nothing repeats', () => {
    const items: Item[] = [
      { key: 'x', t: 1, h: 'a' },
      { t: 2, h: 'b' },
    ]
    expect(findDuplicateGroups(items, describeItem)).toEqual([])
  })

  it('does not count one record read twice as a copy', () => {
    const twinOnly: Item[] = [
      { key: 'x', t: 1, h: 'a' },
      { key: 'x', t: 1, h: 'a' },
    ]
    expect(findDuplicateGroups(twinOnly, describeItem)).toEqual([])
    const withCopy: Item[] = [...twinOnly, { key: 'x', t: 2, h: 'b' }]
    const groups = findDuplicateGroups(withCopy, describeItem)
    const result = collapseDuplicateGroups(withCopy, groups)
    expect(result.kept.map((item) => item.h)).toEqual(['a'])
    expect(result.collapsed).toBe(1)
  })

  it('asks for the full key only when a bucket holds more than one item', () => {
    const asked: string[] = []
    const items = ['a', 'b', 'c'].map((h, i) => ({ h, bucket: i < 2 ? 'shared' : 'alone' }))
    findDuplicateGroups(items, (item) => ({
      bucket: item.bucket,
      key: () => {
        asked.push(item.h)
        return item.h
      },
      timestamp: 1,
      recordHash: item.h,
    }))
    expect(asked.sort()).toEqual(['a', 'b'])
  })

  it('buckets every copy of one statement together', async () => {
    const first = await makeSigned({ timestamp: 1 })
    const again = await makeSigned({ timestamp: 2, chain_root: `sha256:${'d'.repeat(64)}` })
    expect(duplicateBucketForRecord(first)).toBeDefined()
    expect(duplicateBucketForRecord(again)).toBe(duplicateBucketForRecord(first))
    expect(
      duplicateBucketForRecord(await makeSigned({ event_type: EVENT_TYPE_TOOL_CALL_URI })),
    ).toBeUndefined()
  })
})

describe('history recall collapses re-signed copies', () => {
  let tmp: string
  let file: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'atrib-duplicates-test-'))
    file = join(tmp, 'records.jsonl')
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns the earliest copy with a count, and every copy on request', async () => {
    const first = await makeSigned({ timestamp: 100 })
    const second = await makeSigned({ timestamp: 200, chain_root: `sha256:${'d'.repeat(64)}` })
    const third = await makeSigned({ timestamp: 300, chain_root: `sha256:${'e'.repeat(64)}` })
    const other = await makeSigned({ timestamp: 250, args_hash: `sha256:${'f'.repeat(64)}` })
    const call = await makeSigned({ timestamp: 260, event_type: EVENT_TYPE_TOOL_CALL_URI })
    const callAgain = await makeSigned({
      timestamp: 270,
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      chain_root: `sha256:${'d'.repeat(64)}`,
    })
    writeFileSync(
      file,
      [
        line(third, 'same'),
        line(first, 'same'),
        line(other, 'different'),
        line(second, 'same'),
        line(call, 'call'),
        line(callAgain, 'call'),
      ].join('\n'),
    )

    const collapsed = await recall({}, file)
    const records = collapsed.records as Array<{ record_hash: string; duplicate_count?: number }>
    expect(collapsed.total).toBe(4)
    expect(collapsed.collapsed_duplicates).toBe(2)
    // Newest first, with the group ordered by its latest copy (300) and
    // shown as its earliest.
    expect(records.map((r) => r.record_hash)).toEqual([
      computeRecordHash(first),
      computeRecordHash(callAgain),
      computeRecordHash(call),
      computeRecordHash(other),
    ])
    expect(records[0]!.duplicate_count).toBe(2)
    expect((records[0] as { duplicate_latest_timestamp?: number }).duplicate_latest_timestamp).toBe(
      300,
    )
    expect((records[0] as unknown as { timestamp: number }).timestamp).toBe(100)
    expect(records[3]!.duplicate_count).toBeUndefined()

    const every = await recall({ collapse_duplicates: false }, file)
    expect(every.total).toBe(6)
    expect(every.collapsed_duplicates).toBeUndefined()
    expect(
      (every.records as Array<{ duplicate_count?: number }>).some((r) => r.duplicate_count),
    ).toBe(false)
  })

  it('reports the count in verbose and toc shapes too', async () => {
    const first = await makeSigned({ timestamp: 100 })
    const second = await makeSigned({ timestamp: 200, chain_root: `sha256:${'d'.repeat(64)}` })
    writeFileSync(file, [line(first, 'same'), line(second, 'same')].join('\n'))
    const verbose = await recall({ compact: false }, file)
    expect((verbose.records[0] as { duplicate_count?: number }).duplicate_count).toBe(1)
    expect((verbose.records[0] as AtribRecord).signature).toBe(first.signature)
    const toc = await recall({ toc: true }, file)
    expect((toc.records[0] as { duplicate_count?: number }).duplicate_count).toBe(1)
  })

  it('adds nothing to the response when no record repeats', async () => {
    const only = await makeSigned({ timestamp: 100 })
    writeFileSync(file, line(only, 'one'))
    const result = await recall({}, file)
    expect(result).not.toHaveProperty('collapsed_duplicates')
    expect(result.records[0]).not.toHaveProperty('duplicate_count')
  })

  it('keeps a valid copy when an earlier copy fails its signature check', async () => {
    const valid = await makeSigned({ timestamp: 200 })
    const forged = { ...valid, timestamp: 5 } as AtribRecord
    writeFileSync(file, [line(forged, 'same'), line(valid, 'same')].join('\n'))

    const result = await recall({}, file)
    const records = result.records as Array<{ record_hash: string; duplicate_count?: number }>
    expect(records.map((r) => r.record_hash)).toEqual([computeRecordHash(valid)])
    expect(result.filtered_out_by_verification).toBe(0)
    // The copy that fails its check is not counted as a signed copy.
    expect(records[0]!.duplicate_count).toBeUndefined()

    const lenient = await recall({ include_unverified: true }, file)
    expect((lenient.records[0] as { record_hash: string }).record_hash).toBe(
      computeRecordHash(valid),
    )
    expect((lenient.records[0] as { duplicate_count?: number }).duplicate_count).toBe(1)
  })

  it('leaves a copy that fails its check out of the count and the latest time', async () => {
    const valid = await makeSigned({ timestamp: 100 })
    const again = await makeSigned({ timestamp: 200, chain_root: `sha256:${'d'.repeat(64)}` })
    const forgedLate = { ...valid, timestamp: 9_999_999_999_999 } as AtribRecord
    writeFileSync(
      file,
      [line(valid, 'same'), line(again, 'same'), line(forgedLate, 'same')].join('\n'),
    )
    const result = await recall({}, file)
    const record = result.records[0] as {
      record_hash: string
      duplicate_count?: number
      duplicate_latest_timestamp?: number
    }
    expect(record.record_hash).toBe(computeRecordHash(valid))
    expect(record.duplicate_count).toBe(1)
    expect(record.duplicate_latest_timestamp).toBe(200)

    writeFileSync(file, [line(valid, 'same'), line(forgedLate, 'same')].join('\n'))
    const single = await recall({}, file)
    expect(single.records).toHaveLength(1)
    expect(single.records[0]).not.toHaveProperty('duplicate_count')
    expect(single.records[0]).not.toHaveProperty('duplicate_latest_timestamp')

    const lenient = await recall({ include_unverified: true }, file)
    const shown = lenient.records[0] as { record_hash: string; signature_verified: boolean }
    expect(shown.record_hash).toBe(computeRecordHash(valid))
    expect(shown.signature_verified).toBe(true)
  })

  it('treats a statement said again after its revision as live', async () => {
    const green = await makeSigned({ timestamp: 1000 })
    const revision = await makeSigned({
      timestamp: 2000,
      event_type: EVENT_TYPE_REVISION_URI,
      args_hash: `sha256:${'1'.repeat(64)}`,
      revises: computeRecordHash(green),
    })
    const greenAgain = await makeSigned({
      timestamp: 3000,
      chain_root: `sha256:${'d'.repeat(64)}`,
    })
    writeFileSync(
      file,
      [line(green, 'green'), line(revision, 'red'), line(greenAgain, 'green')].join('\n'),
    )
    const shown = await recall({ event_type: 'observation' }, file)
    expect(shown.records[0]).not.toHaveProperty('superseded_by')
    const live = await recall({ event_type: 'observation', include_revised: true }, file)
    expect(live.total).toBe(1)

    // A revision signed after the last copy supersedes the statement
    // whichever copy it names.
    const later = await makeSigned({
      timestamp: 4000,
      event_type: EVENT_TYPE_REVISION_URI,
      args_hash: `sha256:${'2'.repeat(64)}`,
      revises: computeRecordHash(green),
    })
    writeFileSync(
      file,
      [
        line(green, 'green'),
        line(revision, 'red'),
        line(greenAgain, 'green'),
        line(later, 'red again'),
      ].join('\n'),
    )
    const revised = await recall({ event_type: 'observation' }, file)
    expect((revised.records[0] as { superseded_by?: string[] }).superseded_by).toEqual([
      computeRecordHash(later),
    ])
  })

  it('orders a restated statement after what was said in between', async () => {
    const green = await makeSigned({ timestamp: 1000 })
    const red = await makeSigned({ timestamp: 2000, args_hash: `sha256:${'f'.repeat(64)}` })
    const greenAgain = await makeSigned({
      timestamp: 3000,
      chain_root: `sha256:${'d'.repeat(64)}`,
    })
    writeFileSync(
      file,
      [line(green, 'green'), line(red, 'red'), line(greenAgain, 'green')].join('\n'),
    )
    const result = await recall({}, file)
    const records = result.records as Array<{
      record_hash: string
      duplicate_latest_timestamp?: number
    }>
    expect(records.map((r) => r.record_hash)).toEqual([
      computeRecordHash(green),
      computeRecordHash(red),
    ])
    expect(records[0]!.duplicate_latest_timestamp).toBe(3000)
  })

  it('carries a revision aimed at a later copy onto the kept copy', async () => {
    const first = await makeSigned({ timestamp: 100 })
    const second = await makeSigned({ timestamp: 200, chain_root: `sha256:${'d'.repeat(64)}` })
    const revision = await makeSigned({
      timestamp: 300,
      event_type: EVENT_TYPE_REVISION_URI,
      args_hash: `sha256:${'1'.repeat(64)}`,
      revises: computeRecordHash(second),
    })
    writeFileSync(
      file,
      [line(first, 'same'), line(second, 'same'), line(revision, 'changed my mind')].join('\n'),
    )
    const shown = await recall({ event_type: 'observation' }, file)
    const records = shown.records as Array<{ record_hash: string; superseded_by?: string[] }>
    expect(records).toHaveLength(1)
    expect(records[0]!.record_hash).toBe(computeRecordHash(first))
    expect(records[0]!.superseded_by).toEqual([computeRecordHash(revision)])

    const live = await recall({ event_type: 'observation', include_revised: true }, file)
    expect(live.total).toBe(0)
  })

  it('counts an annotation on a later copy for the whole statement', async () => {
    const first = await makeSigned({ timestamp: 100 })
    const second = await makeSigned({ timestamp: 200, chain_root: `sha256:${'d'.repeat(64)}` })
    const annotation = await makeSigned({
      timestamp: 300,
      event_type: EVENT_TYPE_ANNOTATION_URI,
      args_hash: `sha256:${'2'.repeat(64)}`,
      annotates: computeRecordHash(second),
    })
    writeFileSync(
      file,
      [
        line(first, 'same'),
        line(second, 'same'),
        line(annotation, 'note', { importance: 'critical', topics: ['release'] }),
      ].join('\n'),
    )
    const result = await recall({ min_importance: 'high', topic_tags: ['release'] }, file)
    const records = result.records as Array<{
      record_hash: string
      annotations?: { max_importance?: string }
    }>
    expect(records.map((r) => r.record_hash)).toEqual([computeRecordHash(first)])
    expect(records[0]!.annotations?.max_importance).toBe('critical')
  })

  it('ranks a statement by its nearest copy for causal distance', async () => {
    const first = await makeSigned({ timestamp: 100 })
    const second = await makeSigned({ timestamp: 200, chain_root: `sha256:${'d'.repeat(64)}` })
    const unrelated = await makeSigned({ timestamp: 250, args_hash: `sha256:${'f'.repeat(64)}` })
    const follow = await makeSigned({
      timestamp: 300,
      args_hash: `sha256:${'3'.repeat(64)}`,
      context_id: 'c'.repeat(32),
      informed_by: [computeRecordHash(second)],
    })
    writeFileSync(
      file,
      [
        line(first, 'same'),
        line(second, 'same'),
        line(unrelated, 'unrelated'),
        line(follow, 'follow'),
      ].join('\n'),
    )
    const result = await recall(
      { rank_by: 'causal_distance', rank_anchor: computeRecordHash(follow), context_id: CTX },
      file,
    )
    const records = result.records as Array<{ record_hash: string }>
    expect(records[0]!.record_hash).toBe(computeRecordHash(first))
  })

  it('pages over statements, not copies', async () => {
    const lines: string[] = []
    for (let s = 0; s < 3; s++) {
      for (let c = 0; c < 3; c++) {
        const record = await makeSigned({
          timestamp: 1000 * (s + 1) + c,
          args_hash: `sha256:${String(s).repeat(64)}`,
          chain_root: `sha256:${String(c).repeat(64)}`,
        })
        lines.push(line(record, `statement ${s}`))
      }
    }
    writeFileSync(file, lines.join('\n'))
    const first = await recall({ limit: 2 }, file)
    const rest = await recall({ limit: 2, offset: 2 }, file)
    expect(first.total).toBe(3)
    expect(first.returned).toBe(2)
    expect(rest.returned).toBe(1)
  })

  it('collapses within one context only', async () => {
    const here = await makeSigned({ timestamp: 100 })
    const there = await makeSigned({ timestamp: 200, context_id: 'c'.repeat(32) })
    writeFileSync(file, [line(here, 'same'), line(there, 'same')].join('\n'))
    const result = await recall({}, file)
    expect(result.total).toBe(2)
    expect(result.collapsed_duplicates).toBeUndefined()
  })
})

describe('content search collapses re-signed copies', () => {
  let tmp: string
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'atrib-duplicates-content-'))
    for (const name of [
      'ATRIB_RECORD_FILE',
      'ATRIB_RECALL_CONTENT_INDEX_FILE',
      'ATRIB_RECALL_CONTENT_INDEX',
    ]) {
      saved[name] = process.env[name]
    }
    process.env.ATRIB_RECORD_FILE = join(tmp, 'records.jsonl')
    process.env.ATRIB_RECALL_CONTENT_INDEX_FILE = join(tmp, 'content-index.json')
    delete process.env.ATRIB_RECALL_CONTENT_INDEX
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(tmp, { recursive: true, force: true })
  })

  it('ranks a re-signed statement once, in memory and from the durable index', async () => {
    const copies: AtribRecord[] = []
    for (let i = 0; i < 12; i++) {
      copies.push(
        await makeSigned({
          timestamp: 1000 + i,
          chain_root: `sha256:${i.toString(16).padStart(64, '0')}`,
        }),
      )
    }
    const other = await makeSigned({ timestamp: 500, args_hash: `sha256:${'f'.repeat(64)}` })
    writeFileSync(
      process.env.ATRIB_RECORD_FILE!,
      [
        ...copies.map((record) => line(record, 'zebra migration finished')),
        line(other, 'zebra rollback planned'),
      ].join('\n'),
    )

    for (const pass of ['rebuilt', 'hit']) {
      vi.resetModules()
      const recallModule = await import('../src/index.js')
      const result = await recallModule.runRecallByContent({
        query: 'zebra',
        k: 5,
        evidence_mode: 'require_complete',
      })
      expect((result.coverage as { index?: { status?: string } }).index?.status).toBe(pass)
      const results = result.results as Array<{ record_hash: string; duplicate_count?: number }>
      expect(result.collapsed_duplicates).toBe(11)
      expect(results.map((r) => r.record_hash).sort()).toEqual(
        [computeRecordHash(copies[0]!), computeRecordHash(other)].sort(),
      )
      const kept = results.find((r) => r.record_hash === computeRecordHash(copies[0]!))
      expect(kept?.duplicate_count).toBe(11)

      const every = await recallModule.runRecallByContent({
        query: 'zebra',
        k: 5,
        evidence_mode: 'require_complete',
        collapse_duplicates: false,
      })
      expect(every.count).toBe(5)
      expect(every).not.toHaveProperty('collapsed_duplicates')
    }
  })

  it('shows annotations from any copy on the ranked statement', async () => {
    const first = await makeSigned({ timestamp: 1000 })
    const second = await makeSigned({ timestamp: 2000, chain_root: `sha256:${'d'.repeat(64)}` })
    const annotation = await makeSigned({
      timestamp: 3000,
      event_type: EVENT_TYPE_ANNOTATION_URI,
      args_hash: `sha256:${'2'.repeat(64)}`,
      annotates: computeRecordHash(second),
    })
    writeFileSync(
      process.env.ATRIB_RECORD_FILE!,
      [
        line(first, 'zebra migration finished'),
        line(second, 'zebra migration finished'),
        line(annotation, 'note', { importance: 'critical', topics: ['release'] }),
      ].join('\n'),
    )
    vi.resetModules()
    const recallModule = await import('../src/index.js')
    const result = await recallModule.runRecallByContent({
      query: 'zebra migration',
      evidence_mode: 'require_complete',
    })
    const results = result.results as Array<{
      record_hash: string
      annotations?: { max_importance?: string }
    }>
    const kept = results.find((r) => r.record_hash === computeRecordHash(first))
    expect(kept?.annotations?.max_importance).toBe('critical')
  })

  it('is reachable through the recall verb for history and content', async () => {
    const first = await makeSigned({ timestamp: 1000 })
    const second = await makeSigned({ timestamp: 2000, chain_root: `sha256:${'d'.repeat(64)}` })
    writeFileSync(
      process.env.ATRIB_RECORD_FILE!,
      [line(first, 'zebra migration finished'), line(second, 'zebra migration finished')].join(
        '\n',
      ),
    )
    vi.resetModules()
    const { runRecallVerb } = await import('../src/recall-verb.js')
    const payloadOf = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const outcome = await runRecallVerb(input as never)
      if ('error' in outcome) throw new Error(outcome.error)
      return outcome.payload
    }
    expect((await payloadOf({ shape: 'history' })).total).toBe(1)
    expect(
      (await payloadOf({ shape: 'history', filters: { collapse_duplicates: false } })).total,
    ).toBe(2)
    expect((await payloadOf({ shape: 'content', query: 'zebra' })).count).toBe(1)
    expect(
      (
        await payloadOf({
          shape: 'content',
          query: 'zebra',
          filters: { collapse_duplicates: false },
        })
      ).count,
    ).toBe(2)
  })

  it('rebuilds a durable index written before copies were keyed', async () => {
    const first = await makeSigned({ timestamp: 1000 })
    const second = await makeSigned({ timestamp: 2000, chain_root: `sha256:${'d'.repeat(64)}` })
    writeFileSync(
      process.env.ATRIB_RECORD_FILE!,
      [line(first, 'zebra migration finished'), line(second, 'zebra migration finished')].join(
        '\n',
      ),
    )
    vi.resetModules()
    let recallModule = await import('../src/index.js')
    await recallModule.runRecallByContent({ query: 'zebra', evidence_mode: 'require_complete' })
    const indexPath = process.env.ATRIB_RECALL_CONTENT_INDEX_FILE!
    const old = JSON.parse(readFileSync(indexPath, 'utf-8'))
    delete old.duplicate_keys
    for (const entry of old.entries) delete entry.duplicate_key
    writeFileSync(indexPath, JSON.stringify(old))

    vi.resetModules()
    recallModule = await import('../src/index.js')
    const result = await recallModule.runRecallByContent({
      query: 'zebra',
      evidence_mode: 'require_complete',
    })
    expect((result.coverage as { index?: { status?: string } }).index?.status).toBe('rebuilt')
    expect(result.collapsed_duplicates).toBe(1)
    const results = result.results as Array<{
      record_hash: string
      duplicate_latest_timestamp?: number
    }>
    expect(results.map((r) => r.record_hash)).toEqual([computeRecordHash(first)])
    expect(results[0]!.duplicate_latest_timestamp).toBe(2000)
  })
})
