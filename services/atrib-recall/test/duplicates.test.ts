// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EVENT_TYPE_OBSERVATION_URI,
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
import { collapseDuplicates, duplicateKeyForRecord } from '../src/duplicates.js'

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
  return signRecord(record as AtribRecord, key)
}

function line(record: AtribRecord, what: string): string {
  return JSON.stringify({ record, _local: { content: { what }, producer: 'test' } })
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

describe('collapseDuplicates', () => {
  const describeItem = (item: { key?: string; t: number; h: string }) => ({
    key: item.key,
    timestamp: item.t,
    recordHash: item.h,
  })

  it('keeps the earliest of each group at the group’s first position', () => {
    const items = [
      { key: 'x', t: 30, h: 'c' },
      { t: 25, h: 'solo' },
      { key: 'x', t: 10, h: 'a' },
      { key: 'y', t: 5, h: 'y1' },
      { key: 'x', t: 20, h: 'b' },
    ]
    const result = collapseDuplicates(items, describeItem)
    expect(result.kept.map((item) => item.h)).toEqual(['a', 'solo', 'y1'])
    expect(result.collapsed).toBe(2)
    expect(result.extraCopies.get(items[2]!)).toBe(2)
    expect(result.extraCopies.has(items[3]!)).toBe(false)
  })

  it('breaks a timestamp tie by the smaller record hash', () => {
    const items = [
      { key: 'x', t: 1, h: 'b' },
      { key: 'x', t: 1, h: 'a' },
    ]
    expect(collapseDuplicates(items, describeItem).kept.map((item) => item.h)).toEqual(['a'])
    expect(collapseDuplicates(items.slice().reverse(), describeItem).kept.map((i) => i.h)).toEqual([
      'a',
    ])
  })

  it('returns the input untouched when nothing repeats', () => {
    const items = [
      { key: 'x', t: 1, h: 'a' },
      { t: 2, h: 'b' },
    ]
    const result = collapseDuplicates(items, describeItem)
    expect(result.kept).toEqual(items)
    expect(result.collapsed).toBe(0)
    expect(result.extraCopies.size).toBe(0)
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
    // Newest first, with the group standing at its earliest copy's time.
    expect(records.map((r) => r.record_hash)).toEqual([
      computeRecordHash(callAgain),
      computeRecordHash(call),
      computeRecordHash(other),
      computeRecordHash(first),
    ])
    expect(records[3]!.duplicate_count).toBe(2)
    expect(records[2]!.duplicate_count).toBeUndefined()

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
})
