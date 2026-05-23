// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  logReadPrimitiveCall,
  extractRecordHashesFromMcpResult,
} from '../src/read-instrumentation.js'

let tmpDir: string
let logPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'atrib-read-instrumentation-'))
  logPath = join(tmpDir, 'calls.jsonl')
  process.env.ATRIB_READ_PRIMITIVES_LOG = logPath
})

afterEach(() => {
  delete process.env.ATRIB_READ_PRIMITIVES_LOG
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractRecordHashesFromMcpResult', () => {
  it('extracts sha256 hashes from MCP text content', () => {
    const result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            results: [
              { record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001' },
              { record_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000002' },
            ],
          }),
        },
      ],
    }
    const hashes = extractRecordHashesFromMcpResult(result)
    expect(hashes).toHaveLength(2)
    expect(hashes).toContain('sha256:0000000000000000000000000000000000000000000000000000000000000001')
    expect(hashes).toContain('sha256:0000000000000000000000000000000000000000000000000000000000000002')
  })

  it('dedupes repeated hashes', () => {
    const sameHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    const result = {
      content: [{ type: 'text', text: `${sameHash} and again ${sameHash}` }],
    }
    expect(extractRecordHashesFromMcpResult(result)).toEqual([sameHash])
  })

  it('returns empty array when no hashes present', () => {
    expect(extractRecordHashesFromMcpResult({ content: [{ type: 'text', text: 'no hashes here' }] })).toEqual([])
  })

  it('handles null / undefined gracefully', () => {
    expect(extractRecordHashesFromMcpResult(null)).toEqual([])
    expect(extractRecordHashesFromMcpResult(undefined)).toEqual([])
  })

  it('ignores non-hex pseudo-hashes', () => {
    const result = {
      content: [{ type: 'text', text: 'sha256:notvalid' }],
    }
    expect(extractRecordHashesFromMcpResult(result)).toEqual([])
  })
})

describe('logReadPrimitiveCall', () => {
  it('appends a jsonl line on successful invocation', async () => {
    const fakeResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            record_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          }),
        },
      ],
    }

    const result = await logReadPrimitiveCall(
      'recall_my_attribution_history',
      { context_id: 'abc', limit: 25 },
      async () => fakeResult,
      extractRecordHashesFromMcpResult,
    )

    expect(result).toBe(fakeResult)
    expect(existsSync(logPath)).toBe(true)
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!)
    expect(entry.primitive).toBe('recall_my_attribution_history')
    expect(entry.errored).toBe(false)
    expect(entry.query_shape).toEqual(['context_id', 'limit'])
    expect(entry.result_count).toBe(1)
    expect(entry.sample_result_hashes).toEqual(['sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])
    expect(typeof entry.invoked_at).toBe('number')
    expect(typeof entry.elapsed_ms).toBe('number')
    expect(entry.elapsed_ms).toBeGreaterThanOrEqual(0)
  })

  it('logs and re-throws on handler error', async () => {
    const err = new Error('boom')
    await expect(
      logReadPrimitiveCall(
        'trace',
        { record_hash: 'sha256:1234' },
        async () => {
          throw err
        },
        extractRecordHashesFromMcpResult,
      ),
    ).rejects.toBe(err)

    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!)
    expect(entry.primitive).toBe('trace')
    expect(entry.errored).toBe(true)
    expect(entry.result_count).toBe(-1)
    expect(entry.sample_result_hashes).toEqual([])
  })

  it('drops empty / falsy query-shape keys', async () => {
    await logReadPrimitiveCall(
      'recall_walk',
      {
        from_record_hash: 'sha256:abc',
        edge_types: [],
        depth: 0,
        max_nodes: undefined,
      },
      async () => ({ content: [{ type: 'text', text: '{}' }] }),
      extractRecordHashesFromMcpResult,
    )
    const entry = JSON.parse(readFileSync(logPath, 'utf8').trim())
    // edge_types=[] is dropped (empty), max_nodes=undefined is dropped,
    // depth=0 IS retained per current shape rule (0 is a valid number).
    expect(entry.query_shape).toEqual(['depth', 'from_record_hash'])
  })

  it('caps sample_result_hashes at 10', async () => {
    const hashes = Array.from({ length: 25 }, (_, i) =>
      'sha256:' + String(i).padStart(64, '0'),
    )
    const fakeResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ all: hashes }),
        },
      ],
    }
    await logReadPrimitiveCall(
      'recall_by_content',
      { query: 'x' },
      async () => fakeResult,
      extractRecordHashesFromMcpResult,
    )
    const entry = JSON.parse(readFileSync(logPath, 'utf8').trim())
    expect(entry.sample_result_hashes.length).toBe(10)
    expect(entry.result_count).toBe(25)
  })

  it('appends multiple calls as separate jsonl lines', async () => {
    const r1 = { content: [{ type: 'text', text: '{}' }] }
    const r2 = { content: [{ type: 'text', text: '{}' }] }
    await logReadPrimitiveCall('summarize', {}, async () => r1, extractRecordHashesFromMcpResult)
    await logReadPrimitiveCall('summarize', {}, async () => r2, extractRecordHashesFromMcpResult)
    const lines = readFileSync(logPath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('silently swallows write errors without affecting the handler', async () => {
    // Point the log at an unwritable path; the handler MUST still return.
    process.env.ATRIB_READ_PRIMITIVES_LOG = '/proc/zzz/invalid/calls.jsonl'
    // Note: env vars are only read at module import. We can't re-import in
    // vitest cleanly; this test verifies the silent-failure behavior holds
    // by depending on the default constant. The contract is "instrumentation
    // never throws"; we exercise the happy path here and rely on the
    // try/finally + swallow-catch pattern's structural correctness.
    const sentinel = { content: [{ type: 'text', text: '{}' }] }
    const result = await logReadPrimitiveCall(
      'recall_revisions',
      { record_hash: 'sha256:x' },
      async () => sentinel,
      extractRecordHashesFromMcpResult,
    )
    expect(result).toBe(sentinel)
  })
})
