// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { __test_only__ } from '../src/index.js'
import { callLlm, resolveLlmConfig } from '../src/llm.js'
import type { IndexedRecord } from '../src/storage.js'

const { selectRecords, handleSummarize } = __test_only__

const ENV_KEYS = [
  'ATRIB_SUMMARIZE_API_KEY',
  'ATRIB_SUMMARIZE_BASE_URL',
  'ATRIB_SUMMARIZE_MODEL',
  'NVIDIA_API_KEY',
  'NVIDIA_NIM_API_KEY',
  'CEREBRAS_API_KEY',
  'CLOUDFLARE_API_KEY',
]
const ORIGINAL_HOME = process.env['HOME']

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  if (ORIGINAL_HOME === undefined) delete process.env['HOME']
  else process.env['HOME'] = ORIGINAL_HOME
  vi.restoreAllMocks()
})

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
    const byHash = new Map([
      [r1.record_hash, r1],
      [r2.record_hash, r2],
    ])
    const result = selectRecords({ record_hashes: [r1.record_hash] }, byHash, [r2, r1])
    expect(result).toHaveLength(1)
    expect(result[0]!.record_hash).toBe(r1.record_hash)
  })

  it('returns records by context_id', () => {
    const r1 = fakeIndexed('11', 'a'.repeat(32), 1000)
    const r2 = fakeIndexed('22', 'a'.repeat(32), 2000)
    const r3 = fakeIndexed('33', 'b'.repeat(32), 3000)
    const byHash = new Map([
      [r1.record_hash, r1],
      [r2.record_hash, r2],
      [r3.record_hash, r3],
    ])
    const result = selectRecords({ context_id: 'a'.repeat(32) }, byHash, [r3, r2, r1])
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.record_hash).sort()).toEqual([r1.record_hash, r2.record_hash].sort())
  })

  it('unions context_id + record_hashes without duplicates', () => {
    const r1 = fakeIndexed('11', 'a'.repeat(32), 1000)
    const r2 = fakeIndexed('22', 'a'.repeat(32), 2000)
    const r3 = fakeIndexed('33', 'b'.repeat(32), 3000)
    const byHash = new Map([
      [r1.record_hash, r1],
      [r2.record_hash, r2],
      [r3.record_hash, r3],
    ])
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
    const home = mkdtempSync(join(tmpdir(), 'atrib-summarize-empty-home-'))
    try {
      process.env['HOME'] = home
      const result = await handleSummarize({
        record_hashes: ['sha256:' + 'a'.repeat(64)],
      })
      expect(result.narrative).toBeNull()
      expect(result.warnings.some((w) => w.includes('no LLM API key'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('LLM config resolution', () => {
  it('reads the NVIDIA cache when env is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'atrib-summarize-home-'))
    try {
      process.env['HOME'] = home
      const secretsDir = join(home, '.atrib', 'secrets')
      mkdirSync(secretsDir, { recursive: true })
      writeFileSync(join(secretsDir, 'nvidia-api-key'), 'cached-nvidia-key')

      const cfg = resolveLlmConfig()

      expect(cfg?.apiKey).toBe('cached-nvidia-key')
      expect(cfg?.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('uses the Cloudflare cache when the base URL is Cloudflare', () => {
    const home = mkdtempSync(join(tmpdir(), 'atrib-summarize-home-'))
    try {
      process.env['HOME'] = home
      process.env['ATRIB_SUMMARIZE_BASE_URL'] =
        'https://api.cloudflare.com/client/v4/accounts/acct/ai/v1'
      const secretsDir = join(home, '.atrib', 'secrets')
      mkdirSync(secretsDir, { recursive: true })
      writeFileSync(join(secretsDir, 'cloudflare-api-key'), 'cached-cf-key')

      const cfg = resolveLlmConfig('@cf/moonshotai/kimi-k2.6')

      expect(cfg?.apiKey).toBe('cached-cf-key')
      expect(cfg?.model).toBe('@cf/moonshotai/kimi-k2.6')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('callLlm', () => {
  it('reads reasoning_content when content is blank', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        model: 'reasoning-model',
        choices: [{ message: { content: null, reasoning_content: 'reasoned output' } }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callLlm(
      {
        baseUrl: 'https://example.test/v1',
        model: 'reasoning-model',
        apiKey: 'test-key',
        maxTokens: 50,
        temperature: 0.1,
        timeoutMs: 1000,
      },
      'system',
      'user',
    )

    expect(result.content).toBe('reasoned output')
    expect(result.model).toBe('reasoning-model')
  })
})
