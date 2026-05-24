// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  recencyScore,
  importanceScore,
  tokenize,
  buildBM25Index,
  bm25Score,
  parkScore,
  indexableTextFromAnnotation,
  indexableTokensForRecord,
} from '../src/scoring.js'
import type { LoadedRecord } from '../src/aggregations.js'
import type { AtribRecord } from '@atrib/mcp'
import {
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
} from '@atrib/mcp'

function makeLoaded(
  eventType: string,
  content: unknown,
  overrides: Partial<AtribRecord> = {},
): LoadedRecord {
  const record = {
    spec_version: 'atrib/1.0' as const,
    event_type: eventType,
    timestamp: 1_700_000_000_000,
    context_id: '00112233445566778899aabbccddeeff',
    creator_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain_root: 'sha256:' + 'a'.repeat(64),
    content_id: 'sha256:' + 'b'.repeat(64),
    signature: 'sigBytes',
    ...overrides,
  } as AtribRecord
  return {
    record,
    record_hash: 'sha256:' + 'c'.repeat(64),
    content,
  }
}

const NOW = 1700000000000
const DAY_MS = 86400000

describe('recencyScore', () => {
  it('returns 1 for now', () => {
    expect(recencyScore(NOW, NOW, 7)).toBe(1)
  })

  it('decays exponentially: half-life ≈ tau * ln(2)', () => {
    const tau = 7
    const halfLife = tau * Math.LN2 * DAY_MS
    const score = recencyScore(NOW - halfLife, NOW, tau)
    expect(score).toBeCloseTo(0.5, 5)
  })

  it('returns 1 for tau<=0 (decay disabled)', () => {
    expect(recencyScore(NOW - 1000 * DAY_MS, NOW, 0)).toBe(1)
    expect(recencyScore(NOW - 1000 * DAY_MS, NOW, -1)).toBe(1)
  })

  it('clamps negative age (future timestamps treated as now)', () => {
    expect(recencyScore(NOW + 1000 * DAY_MS, NOW, 7)).toBe(1)
  })

  it('older records score lower than newer ones', () => {
    const old = recencyScore(NOW - 30 * DAY_MS, NOW, 7)
    const recent = recencyScore(NOW - 1 * DAY_MS, NOW, 7)
    expect(old).toBeLessThan(recent)
  })
})

describe('importanceScore', () => {
  it('returns 0 for undefined summary', () => {
    expect(importanceScore(undefined)).toBe(0)
  })

  it('returns 0 for summary with no max_importance', () => {
    expect(importanceScore({ topics: ['x'] })).toBe(0)
  })

  it('maps the five levels onto [0, 1]', () => {
    expect(importanceScore({ max_importance: 'noise' })).toBe(0)
    expect(importanceScore({ max_importance: 'low' })).toBe(0.25)
    expect(importanceScore({ max_importance: 'medium' })).toBe(0.5)
    expect(importanceScore({ max_importance: 'high' })).toBe(0.75)
    expect(importanceScore({ max_importance: 'critical' })).toBe(1)
  })
})

describe('tokenize', () => {
  it('lowercases + splits on non-word', () => {
    expect(tokenize('Hello, World! 123')).toEqual(['hello', 'world', '123'])
  })

  it('drops empty tokens', () => {
    expect(tokenize('  ---  ')).toEqual([])
    expect(tokenize('')).toEqual([])
  })

  it('preserves alphanumeric mix', () => {
    expect(tokenize('AES-256 GCM')).toEqual(['aes', '256', 'gcm'])
  })
})

describe('BM25', () => {
  const corpus = [
    { id: 'a', tokens: tokenize('security audit found an issue') },
    { id: 'b', tokens: tokenize('performance tuning of the cache') },
    { id: 'c', tokens: tokenize('audit log security review weekly') },
  ]
  const index = buildBM25Index(corpus)

  it('scores 0 for unknown doc id', () => {
    expect(bm25Score(index, 'unknown', tokenize('security'))).toBe(0)
  })

  it('scores 0 for empty query', () => {
    expect(bm25Score(index, 'a', [])).toBe(0)
  })

  it('ranks documents by query overlap', () => {
    const sa = bm25Score(index, 'a', tokenize('security'))
    const sb = bm25Score(index, 'b', tokenize('security'))
    const sc = bm25Score(index, 'c', tokenize('security'))
    expect(sb).toBe(0)
    expect(sa).toBeGreaterThan(0)
    expect(sc).toBeGreaterThan(0)
  })

  it('rewards higher term frequency (after length normalization)', () => {
    const security = bm25Score(index, 'c', tokenize('audit'))
    const perf = bm25Score(index, 'c', tokenize('performance'))
    expect(security).toBeGreaterThan(perf)
  })

  it('idf rewards rare terms (security: 2 of 3 docs, weekly: 1 of 3)', () => {
    const security = bm25Score(index, 'c', tokenize('security'))
    const weekly = bm25Score(index, 'c', tokenize('weekly'))
    expect(weekly).toBeGreaterThan(security)
  })

  it('handles empty corpus gracefully', () => {
    const empty = buildBM25Index([])
    expect(bm25Score(empty, 'anything', tokenize('foo'))).toBe(0)
  })

  it('sums scores across multiple query tokens', () => {
    const single = bm25Score(index, 'c', tokenize('audit'))
    const multi = bm25Score(index, 'c', tokenize('audit security'))
    expect(multi).toBeGreaterThan(single)
  })
})

describe('parkScore', () => {
  it('linearly combines the three signals', () => {
    expect(parkScore(1, 0, 0, 0.3, 0.3, 0.4)).toBe(0.3)
    expect(parkScore(0, 1, 0, 0.3, 0.3, 0.4)).toBe(0.3)
    expect(parkScore(0, 0, 1, 0.3, 0.3, 0.4)).toBe(0.4)
    expect(parkScore(1, 1, 1, 0.3, 0.3, 0.4)).toBeCloseTo(1, 10)
  })

  it('returns 0 for all-zero signals', () => {
    expect(parkScore(0, 0, 0, 0.3, 0.3, 0.4)).toBe(0)
  })
})

describe('indexableTextFromAnnotation', () => {
  it('returns empty for no summary', () => {
    expect(indexableTextFromAnnotation(undefined)).toEqual([])
  })

  it('tokenizes summary + topics', () => {
    expect(
      indexableTextFromAnnotation({
        summary: 'auth bypass via Stripe',
        topics: ['security', 'payments'],
      }),
    ).toEqual(['auth', 'bypass', 'via', 'stripe', 'security', 'payments'])
  })

  it('works with topics only', () => {
    expect(indexableTextFromAnnotation({ topics: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('works with summary only', () => {
    expect(indexableTextFromAnnotation({ summary: 'Foo bar' })).toEqual(['foo', 'bar'])
  })
})

describe('indexableTokensForRecord (D086)', () => {
  it('returns observation content tokens when no annotation', () => {
    const lr = makeLoaded(EVENT_TYPE_OBSERVATION_URI, {
      what: 'decided to require TLD for email validation',
    })
    const tokens = indexableTokensForRecord(lr, undefined)
    expect(tokens).toContain('decided')
    expect(tokens).toContain('require')
    expect(tokens).toContain('tld')
    expect(tokens).toContain('email')
    expect(tokens).toContain('validation')
  })

  it('falls back to annotation-only tokens when content is missing', () => {
    const lr = makeLoaded(EVENT_TYPE_OBSERVATION_URI, undefined)
    const tokens = indexableTokensForRecord(lr, {
      summary: 'curated note',
      topics: ['x'],
    })
    expect(tokens).toEqual(['curated', 'note', 'x'])
  })

  it('returns empty when neither content nor annotation present', () => {
    const lr = makeLoaded(EVENT_TYPE_OBSERVATION_URI, undefined)
    expect(indexableTokensForRecord(lr, undefined)).toEqual([])
  })

  it('augments content tokens with annotation tokens (both present)', () => {
    const lr = makeLoaded(EVENT_TYPE_OBSERVATION_URI, {
      what: 'raw content body',
    })
    const tokens = indexableTokensForRecord(lr, {
      summary: 'curator label',
      topics: ['flag'],
    })
    // Content tokens first, then annotation tokens (concat order).
    expect(tokens).toContain('raw')
    expect(tokens).toContain('content')
    expect(tokens).toContain('body')
    expect(tokens).toContain('curator')
    expect(tokens).toContain('label')
    expect(tokens).toContain('flag')
  })

  it('extracts annotation event_type content (annotates ref omitted)', () => {
    const lr = makeLoaded(EVENT_TYPE_ANNOTATION_URI, {
      annotates: 'sha256:' + 'd'.repeat(64),
      importance: 'high',
      summary: 'flagged decision matters',
      topics: ['design'],
    })
    const tokens = indexableTokensForRecord(lr, undefined)
    expect(tokens).toContain('flagged')
    expect(tokens).toContain('decision')
    expect(tokens).toContain('matters')
    expect(tokens).toContain('design')
    expect(tokens.join(' ')).not.toContain('sha256')
  })

  it('extracts tool_call content (tool_name + args excerpt)', () => {
    const lr = makeLoaded(EVENT_TYPE_TOOL_CALL_URI, {
      tool_name: 'search_documents',
      args: { query: 'OAuth migration plan' },
    })
    const tokens = indexableTokensForRecord(lr, undefined)
    // Tokenizer splits on non-alphanumeric: 'search_documents' → ['search', 'documents'].
    expect(tokens).toContain('search')
    expect(tokens).toContain('documents')
    expect(tokens).toContain('oauth')
    expect(tokens).toContain('migration')
    expect(tokens).toContain('plan')
  })

  it('BM25 search finds an observation by content without any annotation (the D086 win)', () => {
    // The pre-D086 corpus required an annotation to be searchable. Now a
    // bare emit with no annotation is findable by its `what` text.
    const lr1 = makeLoaded(
      EVENT_TYPE_OBSERVATION_URI,
      { what: 'rejected localhost for security reasons' },
      { content_id: 'sha256:' + '1'.repeat(64) },
    )
    const lr2 = makeLoaded(
      EVENT_TYPE_OBSERVATION_URI,
      { what: 'allowed plus addressing in local part' },
      { content_id: 'sha256:' + '2'.repeat(64) },
    )
    // Two records with distinct record_hash so BM25 indexes them separately.
    const lr1WithHash: LoadedRecord = { ...lr1, record_hash: 'sha256:' + 'e'.repeat(64) }
    const lr2WithHash: LoadedRecord = { ...lr2, record_hash: 'sha256:' + 'f'.repeat(64) }

    const corpus = [lr1WithHash, lr2WithHash].map((lr) => ({
      id: lr.record_hash,
      tokens: indexableTokensForRecord(lr, undefined),
    }))
    const idx = buildBM25Index(corpus)

    const queryTokens = tokenize('localhost rejection')
    const lr1Score = bm25Score(idx, lr1WithHash.record_hash, queryTokens)
    const lr2Score = bm25Score(idx, lr2WithHash.record_hash, queryTokens)

    // lr1 mentions "localhost" → matches; lr2 does not → 0
    expect(lr1Score).toBeGreaterThan(0)
    expect(lr2Score).toBe(0)
  })

  it('handles malformed content gracefully (extractor returns empty string)', () => {
    const lr = makeLoaded(EVENT_TYPE_OBSERVATION_URI, 'not-an-object')
    const tokens = indexableTokensForRecord(lr, {
      summary: 'fallback to annotation',
    })
    // Content extraction returned "", so we fall through to annotation tokens only.
    expect(tokens).toEqual(['fallback', 'to', 'annotation'])
  })

  it('caps single-field contribution via DEFAULT_FIELD_CAP (huge what does not flood corpus)', () => {
    const huge = 'x'.repeat(10_000)
    const lr = makeLoaded(EVENT_TYPE_OBSERVATION_URI, { what: huge })
    const tokens = indexableTokensForRecord(lr, undefined)
    // One token, all x's, capped at DEFAULT_FIELD_CAP (2048)
    expect(tokens).toHaveLength(1)
    expect(tokens[0]?.length).toBeLessThanOrEqual(2048)
  })
})
