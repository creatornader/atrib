// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import {
  synthesizeDisplaySummary,
  resolveDisplayProducer,
  formatAge,
} from '../src/legibility.js'

const ATRIB = 'https://atrib.dev/v1/types/'
const FAKE_KEY = '_'.repeat(43)
const FAKE_SIG = '_'.repeat(86)

function record(
  event_type: string,
  extras: Partial<AtribRecord> & { tool_name?: string } = {},
): AtribRecord {
  return {
    spec_version: 'atrib/1.0',
    event_type,
    context_id: 'a'.repeat(32),
    creator_key: FAKE_KEY,
    timestamp: 1700000000000,
    chain_root: `sha256:${'0'.repeat(64)}`,
    signature: FAKE_SIG,
    ...extras,
  } as AtribRecord
}

describe('synthesizeDisplaySummary', () => {
  it('annotation summary always wins when present', () => {
    const r = record(`${ATRIB}tool_call`, { tool_name: 'Bash' } as Partial<AtribRecord>)
    const result = synthesizeDisplaySummary(r, { args: { command: 'ls' } }, {
      summary: 'this is the annotation summary',
      max_importance: 'high',
    })
    expect(result).toBe('this is the annotation summary')
  })

  it('tool_call synth includes tool_name + arg excerpt', () => {
    const r = record(`${ATRIB}tool_call`, { tool_name: 'Bash' } as Partial<AtribRecord>)
    const result = synthesizeDisplaySummary(r, { args: { command: 'ls -la', cwd: '/tmp' } }, undefined)
    expect(result).toMatch(/^call Bash\(.*command=.*\)$/)
  })

  it('tool_call synth without args returns just the name', () => {
    const r = record(`${ATRIB}tool_call`, { tool_name: 'Read' } as Partial<AtribRecord>)
    const result = synthesizeDisplaySummary(r, {}, undefined)
    expect(result).toBe('call Read')
  })

  it('tool_call synth without tool_name falls back', () => {
    const r = record(`${ATRIB}tool_call`)
    const result = synthesizeDisplaySummary(r, {}, undefined)
    expect(result).toBe('tool call')
  })

  it('tool_call synth reads tool_name from derived local content', () => {
    const r = record(`${ATRIB}tool_call`)
    const result = synthesizeDisplaySummary(
      r,
      { tool_name: 'search_web', args: { query: 'Langfuse overlap' } },
      undefined,
    )
    expect(result).toMatch(/^call search_web\(.*query=.*\)$/)
  })

  it('observation uses what field', () => {
    const r = record(`${ATRIB}observation`)
    const result = synthesizeDisplaySummary(
      r,
      { what: 'D083 v2 file-fallback verified end-to-end in production' },
      undefined,
    )
    expect(result).toBe('D083 v2 file-fallback verified end-to-end in production')
  })

  it('observation truncates long what to 120 chars', () => {
    const longWhat = 'x'.repeat(500)
    const r = record(`${ATRIB}observation`)
    const result = synthesizeDisplaySummary(r, { what: longWhat }, undefined)
    expect(result.length).toBeLessThanOrEqual(120)
    expect(result.endsWith('…')).toBe(true)
  })

  it('observation without what field falls back to "observation"', () => {
    const r = record(`${ATRIB}observation`)
    const result = synthesizeDisplaySummary(r, {}, undefined)
    expect(result).toBe('observation')
  })

  it('transaction includes amount + merchant + protocol', () => {
    const r = record(`${ATRIB}transaction`)
    const result = synthesizeDisplaySummary(
      r,
      { amount: '$0.05', merchant: 'merchant.example.com', protocol: 'x402' },
      undefined,
    )
    expect(result).toBe('$0.05 to merchant.example.com via x402')
  })

  it('annotation surfaces target hash + importance + summary', () => {
    const r = record(`${ATRIB}annotation`)
    const result = synthesizeDisplaySummary(
      r,
      {
        annotates: `sha256:${'a'.repeat(64)}`,
        importance: 'high',
        summary: 'this prior record matters',
      },
      undefined,
    )
    expect(result).toContain('annotates sha256:')
    expect(result).toContain('[high]')
    expect(result).toContain('this prior record matters')
  })

  it('revision surfaces target hash + new_position', () => {
    const r = record(`${ATRIB}revision`)
    const result = synthesizeDisplaySummary(
      r,
      {
        revises: `sha256:${'b'.repeat(64)}`,
        new_position: 'updated stance here',
      },
      undefined,
    )
    expect(result).toContain('revises sha256:')
    expect(result).toContain('updated stance here')
  })

  it('directory_anchor surfaces the tree_root', () => {
    const r = record(`${ATRIB}directory_anchor`)
    const result = synthesizeDisplaySummary(r, { tree_root: 'sha256:abcdef0123456789' }, undefined)
    expect(result).toContain('directory anchor sha256:abcdef')
  })

  it('extension URI falls back to the URI tail', () => {
    const r = record('https://example.com/v1/types/custom-event')
    const result = synthesizeDisplaySummary(r, undefined, undefined)
    expect(result).toBe('custom-event')
  })

  it('handles null content without throwing', () => {
    const r = record(`${ATRIB}observation`)
    const result = synthesizeDisplaySummary(r, null, undefined)
    expect(result).toBe('observation')
  })

  it('empty annotation summary string falls through to per-event synthesis', () => {
    const r = record(`${ATRIB}observation`)
    const result = synthesizeDisplaySummary(r, { what: 'real description' }, { summary: '' })
    expect(result).toBe('real description')
  })
})

describe('resolveDisplayProducer', () => {
  it('returns producer label when present', () => {
    const r = record(`${ATRIB}tool_call`)
    expect(resolveDisplayProducer(r, 'atrib-emit-cli')).toBe('atrib-emit-cli')
  })

  it('returns "key:<8hex>" fallback when producer is missing', () => {
    const r = record(`${ATRIB}tool_call`, { creator_key: 'abcdef0123456789xyzwvut' } as Partial<AtribRecord>)
    expect(resolveDisplayProducer(r, undefined)).toBe('key:abcdef01')
  })

  it('returns "key:<8hex>" fallback when producer is empty string', () => {
    const r = record(`${ATRIB}tool_call`, { creator_key: 'abcdef0123456789' } as Partial<AtribRecord>)
    expect(resolveDisplayProducer(r, '')).toBe('key:abcdef01')
  })

  it('handles short creator_key gracefully', () => {
    const r = record(`${ATRIB}tool_call`, { creator_key: 'abc' } as Partial<AtribRecord>)
    expect(resolveDisplayProducer(r, undefined)).toBe('unknown')
  })
})

describe('formatAge', () => {
  const NOW = 1700000000000
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE
  const DAY = 24 * HOUR

  it('returns "just now" for under 60s', () => {
    expect(formatAge(NOW - 30 * SECOND, NOW)).toBe('just now')
    expect(formatAge(NOW - 59 * SECOND, NOW)).toBe('just now')
  })

  it('returns "Xm ago" between 1m and 1h', () => {
    expect(formatAge(NOW - 5 * MINUTE, NOW)).toBe('5m ago')
    expect(formatAge(NOW - 59 * MINUTE, NOW)).toBe('59m ago')
  })

  it('returns "Xh ago" between 1h and 24h', () => {
    expect(formatAge(NOW - 3 * HOUR, NOW)).toBe('3h ago')
    expect(formatAge(NOW - 23 * HOUR, NOW)).toBe('23h ago')
  })

  it('returns "Xd ago" between 1d and 30d', () => {
    expect(formatAge(NOW - 1 * DAY, NOW)).toBe('1d ago')
    expect(formatAge(NOW - 29 * DAY, NOW)).toBe('29d ago')
  })

  it('returns ISO date for older than 30 days', () => {
    const oneYear = 365 * DAY
    const result = formatAge(NOW - oneYear, NOW)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns "future" for timestamps after now', () => {
    expect(formatAge(NOW + 1000, NOW)).toBe('future')
  })

  it('returns "just now" exactly at now', () => {
    expect(formatAge(NOW, NOW)).toBe('just now')
  })

  it('returns "unknown" for NaN timestamp (defensive)', () => {
    expect(formatAge(NaN, NOW)).toBe('unknown')
  })

  it('returns "unknown" for NaN now (defensive)', () => {
    expect(formatAge(NOW, NaN)).toBe('unknown')
  })

  it('returns "unknown" for Infinity timestamp (defensive)', () => {
    expect(formatAge(Infinity, NOW)).toBe('unknown')
    expect(formatAge(-Infinity, NOW)).toBe('unknown')
  })
})
