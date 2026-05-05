// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { __test_only__ } from '../src/index.js'
import type { IndexedRecord } from '../src/storage.js'

const { selectRecords, handleSummarize } = __test_only__

function fakeIndexed(
  hashSuffix: string,
  contextId: string,
  timestamp: number,
  withSidecar = false,
): IndexedRecord {
  return {
    record: {
      spec_version: 'atrib/1.0' as const,
      content_id: 'sha256:' + 'a'.repeat(64),
      creator_key: 'k'.repeat(43),
      chain_root: 'sha256:' + '0'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: contextId,
      timestamp,
      signature: 's'.repeat(86),
    },
    record_hash: `sha256:${hashSuffix.padEnd(64, '0')}`,
    source: 'test.jsonl',
    ...(withSidecar
      ? { local: { content: { what: 'sample observation', topics: ['t1'] }, producer: 'test' } }
      : {}),
  }
}

describe('selectRecords', () => {
  it('returns records by record_hashes', () => {
    const r1 = fakeIndexed('11', 'a'.repeat(32), 1000)
    const r2 = fakeIndexed('22', 'a'.repeat(32), 2000)
    const byHash = new Map([[r1.record_hash, r1], [r2.record_hash, r2]])
    const result = selectRecords(
      { record_hashes: [r1.record_hash] },
      byHash,
      [r2, r1],
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.record_hash).toBe(r1.record_hash)
  })

  it('returns records by context_id', () => {
    const r1 = fakeIndexed('11', 'a'.repeat(32), 1000)
    const r2 = fakeIndexed('22', 'a'.repeat(32), 2000)
    const r3 = fakeIndexed('33', 'b'.repeat(32), 3000)
    const byHash = new Map([[r1.record_hash, r1], [r2.record_hash, r2], [r3.record_hash, r3]])
    const result = selectRecords(
      { context_id: 'a'.repeat(32) },
      byHash,
      [r3, r2, r1],
    )
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.record_hash).sort()).toEqual([r1.record_hash, r2.record_hash].sort())
  })

  it('unions context_id + record_hashes without duplicates', () => {
    const r1 = fakeIndexed('11', 'a'.repeat(32), 1000)
    const r2 = fakeIndexed('22', 'a'.repeat(32), 2000)
    const r3 = fakeIndexed('33', 'b'.repeat(32), 3000)
    const byHash = new Map([[r1.record_hash, r1], [r2.record_hash, r2], [r3.record_hash, r3]])
    const result = selectRecords(
      { record_hashes: [r1.record_hash, r3.record_hash], context_id: 'a'.repeat(32) },
      byHash,
      [r3, r2, r1],
    )
    expect(result).toHaveLength(3)
  })

  it('skips record_hashes not in the local mirror', () => {
    const r1 = fakeIndexed('11', 'a'.repeat(32), 1000)
    const byHash = new Map([[r1.record_hash, r1]])
    const result = selectRecords(
      { record_hashes: [r1.record_hash, 'sha256:' + 'f'.repeat(64)] },
      byHash,
      [r1],
    )
    expect(result).toHaveLength(1)
  })
})

describe('handleSummarize, input + degradation paths (no LLM call)', () => {
  it('warns + returns empty when neither context_id nor record_hashes supplied', async () => {
    const result = await handleSummarize({})
    expect(result.narrative).toBeNull()
    expect(result.warnings).toContain('one of context_id or record_hashes is required')
    expect(result.records_summarized).toBe(0)
  })

  it('warns + returns empty when no LLM key resolved', async () => {
    // Test setup.ts blocks production fetches; this path warns out before any fetch.
    delete process.env['ATRIB_SUMMARIZE_API_KEY']
    delete process.env['NVIDIA_API_KEY']
    delete process.env['NVIDIA_NIM_API_KEY']
    const result = await handleSummarize({
      record_hashes: ['sha256:' + 'a'.repeat(64)],
    })
    expect(result.narrative).toBeNull()
    expect(result.warnings.some((w) => w.includes('no LLM API key'))).toBe(true)
  })
})
