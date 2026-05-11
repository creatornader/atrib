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
} from '../src/scoring.js'

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
