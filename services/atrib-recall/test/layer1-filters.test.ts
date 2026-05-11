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
    expect(result.records[0]!.event_type).toBe(EVENT_TYPE_TOOL_CALL_URI)
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
    const origRecord = result.records.find((r) => r.event_type === EVENT_TYPE_TOOL_CALL_URI)
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
    expect(result.records[0]!.annotations).toEqual({
      max_importance: 'high',
      topics: ['security'],
      summary: 'auth bypass found',
    })
  })

  it('omits annotations field when record has none', async () => {
    const lone = await makeSigned()
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({}, file)
    expect(result.records[0]!.annotations).toBeUndefined()
  })

  it('omits superseded_by field when record has no revisions', async () => {
    const lone = await makeSigned()
    writeFileSync(file, JSON.stringify(lone))
    const result = await recall({}, file)
    expect(result.records[0]!.superseded_by).toBeUndefined()
  })
})
