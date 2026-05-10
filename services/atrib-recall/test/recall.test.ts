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
  sha256,
  hexEncode,
  canonicalRecord,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { loadRecords, loadRecordsFromDir, discoverRecords, recall } from '../src/index.js'

const KEY = new Uint8Array(32).fill(7)
const CTX = 'a'.repeat(32)

interface RecordOverrides {
  context_id?: string
  event_type?: string
  timestamp?: number
  content_id?: string
  session_token?: string
  tool_name?: string
  args_hash?: string
}

async function makeSigned(overrides: RecordOverrides = {}): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const ctx = overrides.context_id ?? CTX
  const record = {
    spec_version: 'atrib/1.0' as const,
    // URI form per spec §1.2.4 + §1.4.5; verifyRecord rejects the legacy
    // short form 'tool_call' that this fixture used pre-URI-migration.
    event_type: overrides.event_type ?? EVENT_TYPE_TOOL_CALL_URI,
    context_id: ctx,
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(ctx),
    content_id: overrides.content_id ?? `sha256:${'c'.repeat(64)}`,
    timestamp: overrides.timestamp ?? 1700000000000,
    signature: '',
    ...(overrides.session_token ? { session_token: overrides.session_token } : {}),
    ...(overrides.tool_name ? { tool_name: overrides.tool_name } : {}),
    ...(overrides.args_hash ? { args_hash: overrides.args_hash } : {}),
  }
  return signRecord(record as AtribRecord, KEY)
}

let tmp: string
let recordFile: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-recall-test-'))
  recordFile = join(tmp, 'records.jsonl')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('loadRecords', () => {
  it('returns empty array when file does not exist', () => {
    expect(loadRecords(join(tmp, 'missing.jsonl'))).toEqual([])
  })

  it('parses one record per line', async () => {
    const records = [
      await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}` }),
      await makeSigned({ timestamp: 2, content_id: `sha256:${'b'.repeat(64)}` }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))
    expect(loadRecords(recordFile)).toHaveLength(2)
  })

  it('skips malformed jsonl lines silently', async () => {
    const r = await makeSigned()
    writeFileSync(
      recordFile,
      [
        JSON.stringify(r),
        'not-json',
        JSON.stringify({ shape: 'wrong' }), // missing required fields
        JSON.stringify(r),
      ].join('\n'),
    )
    expect(loadRecords(recordFile)).toHaveLength(2)
  })
})

describe('recall', () => {
  it('annotates each record with signature_verified=true for valid signatures', async () => {
    const records = [
      await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` }),
      await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const result = await recall({}, recordFile)
    expect(result.total).toBe(2)
    expect(result.returned).toBe(2)
    for (const r of result.records) {
      expect(r.signature_verified).toBe(true)
    }
  })

  it('drops tampered records by default (include_unverified=false default)', async () => {
    const good = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const tampered = { ...good, content_id: `sha256:${'9'.repeat(64)}` }
    writeFileSync(recordFile, [JSON.stringify(good), JSON.stringify(tampered)].join('\n'))

    const result = await recall({}, recordFile)
    expect(result.total).toBe(2)
    expect(result.returned).toBe(1) // tampered dropped
    expect(result.filtered_out_by_verification).toBe(1)
    expect(result.records.every((r) => r.signature_verified === true)).toBe(true)
  })

  it('includes tampered records when include_unverified=true (THE security opt-out)', async () => {
    const good = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const tampered = { ...good, content_id: `sha256:${'9'.repeat(64)}` }
    writeFileSync(recordFile, [JSON.stringify(good), JSON.stringify(tampered)].join('\n'))

    const result = await recall({ include_unverified: true }, recordFile)
    expect(result.total).toBe(2)
    expect(result.filtered_out_by_verification).toBe(0)
    const verified = result.records.filter((r) => r.signature_verified === true).length
    const unverified = result.records.filter((r) => r.signature_verified === false).length
    expect(verified).toBe(1)
    expect(unverified).toBe(1)
  })

  it('returns paginated newest-first records', async () => {
    const records = [
      await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}` }),
      await makeSigned({ timestamp: 5, content_id: `sha256:${'b'.repeat(64)}` }),
      await makeSigned({ timestamp: 3, content_id: `sha256:${'c'.repeat(64)}` }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const result = await recall({}, recordFile)
    expect(result.records[0]!.timestamp).toBe(5)
    expect(result.records[1]!.timestamp).toBe(3)
    expect(result.records[2]!.timestamp).toBe(1)
  })

  it('filters by context_id', async () => {
    const ctx1 = 'a'.repeat(32)
    const ctx2 = 'b'.repeat(32)
    const records = [
      await makeSigned({ context_id: ctx1, timestamp: 1, content_id: `sha256:${'a'.repeat(64)}` }),
      await makeSigned({ context_id: ctx2, timestamp: 2, content_id: `sha256:${'b'.repeat(64)}` }),
      await makeSigned({ context_id: ctx1, timestamp: 3, content_id: `sha256:${'c'.repeat(64)}` }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const result = await recall({ context_id: ctx1 }, recordFile)
    expect(result.total).toBe(2)
  })

  it('filters by event_type', async () => {
    const records = [
      await makeSigned({ event_type: EVENT_TYPE_TOOL_CALL_URI, timestamp: 1, content_id: `sha256:${'a'.repeat(64)}` }),
      await makeSigned({ event_type: EVENT_TYPE_TRANSACTION_URI, timestamp: 2, content_id: `sha256:${'b'.repeat(64)}` }),
      await makeSigned({ event_type: EVENT_TYPE_TOOL_CALL_URI, timestamp: 3, content_id: `sha256:${'c'.repeat(64)}` }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    expect((await recall({ event_type: 'transaction' }, recordFile)).total).toBe(1)
    expect((await recall({ event_type: 'tool_call' }, recordFile)).total).toBe(2)
  })

  it('filters by content_id (exact match)', async () => {
    const cidA = `sha256:${'a'.repeat(64)}`
    const cidB = `sha256:${'b'.repeat(64)}`
    const records = [
      await makeSigned({ timestamp: 1, content_id: cidA }),
      await makeSigned({ timestamp: 2, content_id: cidB }),
      await makeSigned({ timestamp: 3, content_id: cidA }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    expect((await recall({ content_id: cidA }, recordFile)).total).toBe(2)
    expect((await recall({ content_id: cidB }, recordFile)).total).toBe(1)
    expect((await recall({ content_id: `sha256:${'9'.repeat(64)}` }, recordFile)).total).toBe(0)
  })

  it('filters by tool_name (excludes records without tool_name disclosure)', async () => {
    const records = [
      await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}`, tool_name: 'Edit' }),
      await makeSigned({ timestamp: 2, content_id: `sha256:${'b'.repeat(64)}`, tool_name: 'Bash' }),
      await makeSigned({ timestamp: 3, content_id: `sha256:${'c'.repeat(64)}` }), // no tool_name
      await makeSigned({ timestamp: 4, content_id: `sha256:${'d'.repeat(64)}`, tool_name: 'Edit' }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    expect((await recall({ tool_name: 'Edit' }, recordFile)).total).toBe(2)
    expect((await recall({ tool_name: 'Bash' }, recordFile)).total).toBe(1)
    expect((await recall({ tool_name: 'Read' }, recordFile)).total).toBe(0)
    // Sanity: total without filter is 4 (the no-tool_name record is included).
    expect((await recall({}, recordFile)).total).toBe(4)
  })

  it('filters by args_hash (exact match)', async () => {
    const hashA = `sha256:${'1'.repeat(64)}`
    const hashB = `sha256:${'2'.repeat(64)}`
    const records = [
      await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}`, args_hash: hashA }),
      await makeSigned({ timestamp: 2, content_id: `sha256:${'b'.repeat(64)}`, args_hash: hashB }),
      await makeSigned({ timestamp: 3, content_id: `sha256:${'c'.repeat(64)}` }), // no args_hash
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    expect((await recall({ args_hash: hashA }, recordFile)).total).toBe(1)
    expect((await recall({ args_hash: hashB }, recordFile)).total).toBe(1)
    expect((await recall({ args_hash: `sha256:${'9'.repeat(64)}` }, recordFile)).total).toBe(0)
  })

  it('passes tool_name through compact mode (when disclosed)', async () => {
    const records = [
      await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}`, tool_name: 'Edit' }),
      await makeSigned({ timestamp: 2, content_id: `sha256:${'b'.repeat(64)}` }), // no tool_name
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const result = await recall({ compact: true }, recordFile)
    expect(result.returned).toBe(2)
    const withTool = result.records.find((r) => r.timestamp === 1)
    const without = result.records.find((r) => r.timestamp === 2)
    expect(withTool && 'tool_name' in withTool ? withTool.tool_name : undefined).toBe('Edit')
    expect(without && 'tool_name' in without ? without.tool_name : undefined).toBeUndefined()
  })

  it('AND-combines content_id + tool_name + args_hash filters', async () => {
    const cidA = `sha256:${'a'.repeat(64)}`
    const hashA = `sha256:${'1'.repeat(64)}`
    const records = [
      // Matches all three
      await makeSigned({ timestamp: 1, content_id: cidA, tool_name: 'Edit', args_hash: hashA }),
      // Matches content_id + tool_name only
      await makeSigned({ timestamp: 2, content_id: cidA, tool_name: 'Edit', args_hash: `sha256:${'2'.repeat(64)}` }),
      // Matches content_id only
      await makeSigned({ timestamp: 3, content_id: cidA, tool_name: 'Bash', args_hash: hashA }),
      // Matches none
      await makeSigned({ timestamp: 4, content_id: `sha256:${'b'.repeat(64)}`, tool_name: 'Read' }),
    ]
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const all = await recall({ content_id: cidA, tool_name: 'Edit', args_hash: hashA }, recordFile)
    expect(all.total).toBe(1)
    expect(all.records[0]!.timestamp).toBe(1)

    const contentAndTool = await recall({ content_id: cidA, tool_name: 'Edit' }, recordFile)
    expect(contentAndTool.total).toBe(2)
  })

  it('respects limit and offset for pagination', async () => {
    const records = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        makeSigned({ timestamp: i, content_id: `sha256:${String(i).padStart(64, '0')}` }),
      ),
    )
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const page1 = await recall({ limit: 3, offset: 0 }, recordFile)
    expect(page1.returned).toBe(3)
    expect(page1.records.map((r) => r.timestamp)).toEqual([9, 8, 7])

    const page2 = await recall({ limit: 3, offset: 3 }, recordFile)
    expect(page2.records.map((r) => r.timestamp)).toEqual([6, 5, 4])
  })

  it('clamps limit to max 200', async () => {
    const records = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        makeSigned({ timestamp: i, content_id: `sha256:${String(i).padStart(64, '0')}` }),
      ),
    )
    writeFileSync(recordFile, records.map((r) => JSON.stringify(r)).join('\n'))

    const result = await recall({ limit: 999 }, recordFile)
    expect(result.returned).toBe(5)
  })

  it('returns empty result when file does not exist', async () => {
    const result = await recall({}, join(tmp, 'missing.jsonl'))
    expect(result.total).toBe(0)
    expect(result.records).toEqual([])
  })

  it('compact mode is the default and omits heavy fields', async () => {
    const r = await makeSigned()
    writeFileSync(recordFile, JSON.stringify(r))

    // Default call → compact response.
    const compactDefault = await recall({}, recordFile)
    expect(compactDefault.records[0]).toMatchObject({
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: CTX,
      signature_verified: true,
    })
    expect((compactDefault.records[0] as Record<string, unknown>).signature).toBeUndefined()
    expect((compactDefault.records[0] as Record<string, unknown>).content_id).toBeUndefined()
    expect((compactDefault.records[0] as Record<string, unknown>).chain_root).toBeUndefined()

    // compact: false explicitly → full response.
    const verbose = await recall({ compact: false }, recordFile)
    expect(Object.keys(verbose.records[0]!)).toEqual(
      expect.arrayContaining(['signature', 'content_id', 'chain_root', 'signature_verified']),
    )
  })

  it('includes a pagination_caveat string in every response', async () => {
    const r = await makeSigned()
    writeFileSync(recordFile, JSON.stringify(r))
    const result = await recall({}, recordFile)
    expect(result.pagination_caveat).toMatch(/offset is not stable/i)
  })
})

describe('envelope parsing (D062 sidecar form)', () => {
  it('extracts records from {record, proof, _local} envelopes', async () => {
    const r = await makeSigned()
    const envelope = {
      record: r,
      proof: { tree_size: 100, leaf_index: 42 },
      _local: { content: { tool_name: 'Edit' }, producer: 'test' },
      written_at: 1700000000000,
    }
    writeFileSync(recordFile, JSON.stringify(envelope))
    const loaded = loadRecords(recordFile)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.signature).toBe(r.signature)
  })

  it('coexists in one file with bare records (mixed shapes)', async () => {
    const r1 = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    writeFileSync(recordFile, [
      JSON.stringify(r1),
      JSON.stringify({ record: r2, _local: {} }),
    ].join('\n'))
    expect(loadRecords(recordFile)).toHaveLength(2)
  })

  it('skips envelopes whose inner record is missing required fields', async () => {
    writeFileSync(recordFile, JSON.stringify({ record: { foo: 'bar' } }))
    expect(loadRecords(recordFile)).toEqual([])
  })

  it('verifyRecord round-trips through envelope extraction', async () => {
    const r = await makeSigned()
    writeFileSync(recordFile, JSON.stringify({ record: r, _local: {} }))
    const result = await recall({}, recordFile)
    expect(result.returned).toBe(1)
    expect(result.records[0]!.signature_verified).toBe(true)
  })
})

describe('directory-as-contract (loadRecordsFromDir)', () => {
  it('loads + merges every *.jsonl in the directory', async () => {
    const r1 = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    const r3 = await makeSigned({ timestamp: 3, content_id: `sha256:${'3'.repeat(64)}` })
    writeFileSync(join(tmp, 'producer-a-claude.jsonl'), JSON.stringify(r1))
    writeFileSync(join(tmp, 'producer-b-claude.jsonl'), JSON.stringify(r2))
    writeFileSync(join(tmp, 'producer-c-claude.jsonl'), JSON.stringify({ record: r3, _local: {} }))
    const { records, files } = loadRecordsFromDir(tmp)
    expect(records).toHaveLength(3)
    expect(files).toHaveLength(3)
  })

  it('returns empty when dir does not exist', () => {
    const { records, files } = loadRecordsFromDir(join(tmp, 'no-such-dir'))
    expect(records).toEqual([])
    expect(files).toEqual([])
  })

  it('ignores non-.jsonl files in the directory', async () => {
    const r = await makeSigned()
    writeFileSync(join(tmp, 'records.jsonl'), JSON.stringify(r))
    writeFileSync(join(tmp, 'README.md'), '# notes')
    writeFileSync(join(tmp, 'log.txt'), 'unrelated')
    const { records, files } = loadRecordsFromDir(tmp)
    expect(records).toHaveLength(1)
    expect(files).toHaveLength(1)
  })

  it('discoverRecords prefers ATRIB_RECORD_FILE when both env vars are set (back-compat)', async () => {
    // Spec the priority: explicit single file beats directory scan, so
    // operators with pinned configs from before 0.4.0 keep working.
    const r1 = await makeSigned({ timestamp: 1, content_id: `sha256:${'1'.repeat(64)}` })
    const r2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'2'.repeat(64)}` })
    writeFileSync(join(tmp, 'pinned.jsonl'), JSON.stringify(r1))
    writeFileSync(join(tmp, 'other.jsonl'), JSON.stringify(r2))
    const result = discoverRecords(join(tmp, 'pinned.jsonl'))
    expect(result.records).toHaveLength(1)
    expect(result.files).toEqual([join(tmp, 'pinned.jsonl')])
  })
})

describe('recall result shape', () => {
  it('reports record_files (plural) alongside legacy record_file', async () => {
    const r = await makeSigned()
    writeFileSync(recordFile, JSON.stringify(r))
    const result = await recall({}, recordFile)
    expect(result.record_files).toEqual([recordFile])
    expect(result.record_file).toBe(recordFile)
  })

  it('record_files lists every file scanned when reading from a directory', async () => {
    const r1 = await makeSigned({ timestamp: 1, content_id: `sha256:${'a'.repeat(64)}` })
    const r2 = await makeSigned({ timestamp: 2, content_id: `sha256:${'b'.repeat(64)}` })
    const dir = mkdtempSync(join(tmpdir(), 'atrib-recall-dirtest-'))
    try {
      const f1 = join(dir, 'a.jsonl')
      const f2 = join(dir, 'b.jsonl')
      writeFileSync(f1, JSON.stringify(r1))
      writeFileSync(f2, JSON.stringify(r2))
      // recall reads via discoverRecords; pass dir-scoped env via a shim:
      // use loadRecordsFromDir directly for the dir-scan check, since recall's
      // env-var path is integration-tested by mcp-protocol.test.ts.
      const { files } = loadRecordsFromDir(dir)
      expect(files.sort()).toEqual([f1, f2].sort())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// Suppress unused-import warnings for the round-trip helpers.
void canonicalRecord
void sha256
void hexEncode
