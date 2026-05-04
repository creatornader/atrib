// Tests the local-mirror jsonl loader + persister. The mirror is the
// load-bearing piece for chain continuity across wrapper restarts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAutoChainSeed, persistRecord } from '../src/mirror.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-wrap-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const VALID_RECORD = {
  spec_version: 'atrib/1.0',
  content_id: `sha256:${'c'.repeat(64)}`,
  creator_key: 'haoZK4D1AXmy_r05GJP4CZGOv0zh0iK1l7ls1FA8oZI',
  chain_root: `sha256:${'0'.repeat(64)}`,
  event_type: 'https://atrib.dev/v1/types/tool_call',
  context_id: 'a'.repeat(32),
  timestamp: 1000,
  signature: 'A'.repeat(86),
}

describe('persistRecord', () => {
  it('appends one jsonl line per record', () => {
    const file = join(tmpDir, 'records.jsonl')
    persistRecord(file, VALID_RECORD, () => {})
    persistRecord(file, { ...VALID_RECORD, timestamp: 2000 }, () => {})
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).timestamp).toBe(1000)
    expect(JSON.parse(lines[1]!).timestamp).toBe(2000)
  })

  it('creates parent directories as needed', () => {
    const file = join(tmpDir, 'nested', 'subdir', 'records.jsonl')
    persistRecord(file, VALID_RECORD, () => {})
    expect(readFileSync(file, 'utf8')).toContain('atrib/1.0')
  })

  it('no-ops when file path is empty (operator-disabled mirror)', () => {
    persistRecord('', VALID_RECORD, () => {
      throw new Error('should not have errored')
    })
    // No exception, no error callback invocation = passing.
    expect(true).toBe(true)
  })
})

describe('loadAutoChainSeed', () => {
  it('returns empty array when file does not exist', () => {
    expect(loadAutoChainSeed(join(tmpDir, 'missing.jsonl'), () => {})).toEqual([])
  })

  it('returns empty array when file path is empty', () => {
    expect(loadAutoChainSeed('', () => {})).toEqual([])
  })

  it('parses well-formed jsonl into AtribRecord[]', () => {
    const file = join(tmpDir, 'records.jsonl')
    writeFileSync(
      file,
      JSON.stringify(VALID_RECORD) +
        '\n' +
        JSON.stringify({ ...VALID_RECORD, timestamp: 2000 }) +
        '\n',
    )
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(2)
    expect(records[0]!.timestamp).toBe(1000)
    expect(records[1]!.timestamp).toBe(2000)
  })

  it('skips malformed JSON lines silently', () => {
    const file = join(tmpDir, 'records.jsonl')
    writeFileSync(
      file,
      JSON.stringify(VALID_RECORD) + '\nnot json\n' + JSON.stringify({ ...VALID_RECORD, timestamp: 2000 }) + '\n',
    )
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(2)
  })

  it('skips records missing load-bearing fields', () => {
    const file = join(tmpDir, 'records.jsonl')
    writeFileSync(
      file,
      JSON.stringify(VALID_RECORD) + '\n' +
        JSON.stringify({ context_id: 'x' }) + '\n' + // missing fields → skipped
        JSON.stringify({ ...VALID_RECORD, timestamp: 2000 }) + '\n',
    )
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(2)
  })

  it('handles empty + whitespace-only lines', () => {
    const file = join(tmpDir, 'records.jsonl')
    writeFileSync(file, '\n\n  \n' + JSON.stringify(VALID_RECORD) + '\n  \n')
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(1)
  })
})
