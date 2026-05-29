// Tests the local-mirror jsonl loader + persister. The mirror is the
// decision-critical piece for chain continuity across wrapper restarts.

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
  it('appends one jsonl envelope per record', () => {
    const file = join(tmpDir, 'records.jsonl')
    persistRecord(file, VALID_RECORD, () => {})
    persistRecord(file, { ...VALID_RECORD, timestamp: 2000 }, () => {})
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    // New envelope shape: { record, written_at, _local? }
    const env0 = JSON.parse(lines[0]!)
    const env1 = JSON.parse(lines[1]!)
    expect(env0.record.timestamp).toBe(1000)
    expect(env1.record.timestamp).toBe(2000)
    expect(typeof env0.written_at).toBe('number')
    expect(env0._local).toBeUndefined() // no sidecar passed
  })

  it('persists pre-sign sidecar when supplied', () => {
    const file = join(tmpDir, 'records-with-sidecar.jsonl')
    persistRecord(file, VALID_RECORD, () => {}, {
      toolName: 'search_web',
      args: { query: 'test query' },
      result: { content: [{ type: 'text', text: 'result text' }] },
    })
    const env = JSON.parse(readFileSync(file, 'utf8').trim())
    expect(env._local).toBeDefined()
    expect(env._local.toolName).toBe('search_web')
    expect(env._local.args.query).toBe('test query')
    expect(env._local.result.content[0].text).toBe('result text')
    // Signed record bytes are unchanged.
    expect(env.record).toEqual(VALID_RECORD)
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

describe('loadAutoChainSeed, backward compatibility with legacy bare-record entries', () => {
  it('reads new envelope-shape lines correctly', () => {
    const file = join(tmpDir, 'envelope.jsonl')
    persistRecord(file, VALID_RECORD, () => {}, { toolName: 'foo' })
    persistRecord(file, { ...VALID_RECORD, timestamp: 2000 }, () => {})
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(2)
    expect(records[0]!.timestamp).toBe(1000)
    expect(records[1]!.timestamp).toBe(2000)
  })

  it('reads legacy bare-record lines correctly (legacy bare-record shape)', () => {
    const file = join(tmpDir, 'legacy.jsonl')
    writeFileSync(
      file,
      JSON.stringify(VALID_RECORD) + '\n' +
        JSON.stringify({ ...VALID_RECORD, timestamp: 2000 }) + '\n',
    )
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(2)
    expect(records[0]!.timestamp).toBe(1000)
  })

  it('reads mixed legacy + envelope lines correctly', () => {
    const file = join(tmpDir, 'mixed.jsonl')
    // Legacy line (bare record) + envelope line in the same file.
    writeFileSync(file, JSON.stringify(VALID_RECORD) + '\n')
    persistRecord(file, { ...VALID_RECORD, timestamp: 2000 }, () => {}, {
      toolName: 'mixed_tool',
    })
    const records = loadAutoChainSeed(file, () => {})
    expect(records).toHaveLength(2)
    expect(records[0]!.timestamp).toBe(1000) // legacy
    expect(records[1]!.timestamp).toBe(2000) // envelope
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

  it('skips records missing decision-critical fields', () => {
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
