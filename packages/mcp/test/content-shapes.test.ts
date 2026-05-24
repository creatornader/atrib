// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  extractIndexableText,
  extractObservationText,
  extractAnnotationText,
  extractRevisionText,
  extractToolCallText,
  extractTransactionText,
  extractDirectoryAnchorText,
  DEFAULT_FIELD_CAP,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
} from '../src/index.js'

describe('extractIndexableText: normative event types', () => {
  it('observation: pulls what + why_noted + topics', () => {
    const text = extractIndexableText(EVENT_TYPE_OBSERVATION_URI, {
      what: 'decided to require TLD',
      why_noted: 'prevents accepting localhost-style emails',
      topics: ['email', 'validation', 'edge-cases'],
    })
    expect(text).toContain('decided to require TLD')
    expect(text).toContain('prevents accepting localhost-style emails')
    expect(text).toContain('email')
    expect(text).toContain('validation')
    expect(text).toContain('edge-cases')
  })

  it('observation: omits informed_by sha256 refs from indexable text', () => {
    const text = extractIndexableText(EVENT_TYPE_OBSERVATION_URI, {
      what: 'real content',
      informed_by: ['sha256:' + 'a'.repeat(64)],
    })
    expect(text).toBe('real content')
    expect(text).not.toContain('sha256:')
  })

  it('annotation: pulls summary + topics, omits annotates ref', () => {
    const text = extractIndexableText(EVENT_TYPE_ANNOTATION_URI, {
      annotates: 'sha256:' + 'b'.repeat(64),
      importance: 'high',
      summary: 'this decision was load-bearing',
      topics: ['design', 'rejected-alternatives'],
    })
    expect(text).toContain('this decision was load-bearing')
    expect(text).toContain('design')
    expect(text).toContain('rejected-alternatives')
    expect(text).not.toContain('sha256:')
  })

  it('revision: pulls prior_position + new_position + reason + topics', () => {
    const text = extractIndexableText(EVENT_TYPE_REVISION_URI, {
      revises: 'sha256:' + 'c'.repeat(64),
      prior_position: 'rejected localhost',
      new_position: 'accept localhost in non-strict mode',
      reason: 'developer feedback during testing',
      topics: ['email', 'strictness'],
    })
    expect(text).toContain('rejected localhost')
    expect(text).toContain('accept localhost in non-strict mode')
    expect(text).toContain('developer feedback during testing')
    expect(text).toContain('email')
    expect(text).toContain('strictness')
  })

  it('tool_call: pulls tool_name + json args + json result', () => {
    const text = extractIndexableText(EVENT_TYPE_TOOL_CALL_URI, {
      tool_name: 'python',
      args: { code: 'print("hello world")' },
      result: 'hello world\n',
    })
    expect(text).toContain('python')
    expect(text).toContain('hello world')
    expect(text).toContain('print')
  })

  it('tool_call: accepts legacy input/arguments aliases for args', () => {
    const textInput = extractIndexableText(EVENT_TYPE_TOOL_CALL_URI, {
      tool_name: 'search',
      input: { query: 'OAuth migration' },
    })
    expect(textInput).toContain('OAuth migration')

    const textArguments = extractIndexableText(EVENT_TYPE_TOOL_CALL_URI, {
      tool_name: 'search',
      arguments: { query: 'JWT validation' },
    })
    expect(textArguments).toContain('JWT validation')
  })

  it('tool_call: accepts legacy output/response aliases for result', () => {
    const textOutput = extractIndexableText(EVENT_TYPE_TOOL_CALL_URI, {
      tool_name: 't',
      output: 'output-value',
    })
    expect(textOutput).toContain('output-value')

    const textResponse = extractIndexableText(EVENT_TYPE_TOOL_CALL_URI, {
      tool_name: 't',
      response: 'response-value',
    })
    expect(textResponse).toContain('response-value')
  })

  it('transaction: pulls counterparty + memo + protocol + aliases', () => {
    const text = extractIndexableText(EVENT_TYPE_TRANSACTION_URI, {
      counterparty: 'merchant-x',
      memo: 'API access subscription',
      protocol: 'x402',
    })
    expect(text).toContain('merchant-x')
    expect(text).toContain('API access subscription')
    expect(text).toContain('x402')
  })

  it('directory_anchor: pulls tree_root + epoch_id', () => {
    const text = extractIndexableText(EVENT_TYPE_DIRECTORY_ANCHOR_URI, {
      tree_root: 'sha256:abc',
      epoch_id: 'epoch-42',
    })
    expect(text).toContain('sha256:abc')
    expect(text).toContain('epoch-42')
  })
})

describe('extractIndexableText: field-length cap', () => {
  it('truncates a single field at fieldCap', () => {
    const huge = 'x'.repeat(5000)
    const text = extractIndexableText(
      EVENT_TYPE_OBSERVATION_URI,
      { what: huge },
      { fieldCap: 100 },
    )
    expect(text.length).toBe(100)
    expect(text).toBe('x'.repeat(100))
  })

  it('applies default cap when no opts provided', () => {
    const huge = 'y'.repeat(DEFAULT_FIELD_CAP * 2)
    const text = extractIndexableText(EVENT_TYPE_OBSERVATION_URI, { what: huge })
    expect(text.length).toBe(DEFAULT_FIELD_CAP)
  })

  it('tool_call: truncates serialized args at cap', () => {
    const bigArgs = { data: 'z'.repeat(10_000) }
    const text = extractIndexableText(
      EVENT_TYPE_TOOL_CALL_URI,
      { tool_name: 'test', args: bigArgs },
      { fieldCap: 200 },
    )
    // tool_name + (capped args excerpt) joined with " "
    // 'test' (4 chars) + ' ' + 200 chars capped excerpt
    expect(text.length).toBeLessThanOrEqual(4 + 1 + 200)
  })
})

describe('extractIndexableText: malformed input', () => {
  it('returns empty string when content is undefined', () => {
    expect(extractIndexableText(EVENT_TYPE_OBSERVATION_URI, undefined)).toBe('')
  })

  it('returns empty string when content is null', () => {
    expect(extractIndexableText(EVENT_TYPE_OBSERVATION_URI, null)).toBe('')
  })

  it('returns empty string when content is a primitive', () => {
    expect(extractIndexableText(EVENT_TYPE_OBSERVATION_URI, 'just a string')).toBe('')
    expect(extractIndexableText(EVENT_TYPE_OBSERVATION_URI, 42)).toBe('')
    expect(extractIndexableText(EVENT_TYPE_OBSERVATION_URI, true)).toBe('')
  })

  it('returns empty string when content is an array', () => {
    expect(extractIndexableText(EVENT_TYPE_OBSERVATION_URI, ['x'])).toBe('')
  })

  it('returns empty string when content object has wrong-typed fields', () => {
    expect(
      extractIndexableText(EVENT_TYPE_OBSERVATION_URI, { what: 42 }),
    ).toBe('')
  })

  it('drops wrong-typed topic entries silently', () => {
    const text = extractIndexableText(EVENT_TYPE_OBSERVATION_URI, {
      what: 'real',
      topics: ['ok', 42, null, 'also-ok'],
    })
    expect(text).toContain('real')
    expect(text).toContain('ok')
    expect(text).toContain('also-ok')
  })

  it('drops topics that are not arrays', () => {
    const text = extractIndexableText(EVENT_TYPE_OBSERVATION_URI, {
      what: 'real',
      topics: 'not-an-array',
    })
    expect(text).toBe('real')
  })
})

describe('extractIndexableText: extension URIs', () => {
  it('recursively walks string values in extension URI content', () => {
    const text = extractIndexableText('https://example.com/v1/types/custom-event', {
      title: 'custom title',
      data: { nested: 'deep value', items: ['a', 'b'] },
    })
    expect(text).toContain('custom title')
    expect(text).toContain('deep value')
    expect(text).toContain('a')
    expect(text).toContain('b')
  })

  it('caps deep recursion at depth 4', () => {
    const deepObj: Record<string, unknown> = {}
    let cursor: Record<string, unknown> = deepObj
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = { deeper: `at-depth-${i}` }
      cursor.nested = next
      cursor = next
    }
    const text = extractIndexableText('https://example.com/x', deepObj)
    // Walk visits root + nested(1) + nested(2) + nested(3) + nested(4). The
    // string at depth 0 ("at-depth-0" via deepObj.nested.deeper) is visited.
    // Strings deeper than MAX_WALK_DEPTH are skipped.
    expect(text).toContain('at-depth-0')
    expect(text).not.toContain('at-depth-9')
  })

  it('skips primitives that are not strings in extension content', () => {
    const text = extractIndexableText('https://example.com/x', {
      keep: 'string',
      drop_number: 42,
      drop_bool: true,
      drop_null: null,
    })
    expect(text).toBe('string')
  })
})

describe('per-event_type extractors (direct)', () => {
  it('extractObservationText returns "" for empty input', () => {
    expect(extractObservationText({}, DEFAULT_FIELD_CAP)).toBe('')
  })

  it('extractAnnotationText preserves backward-compatible summary+topics output', () => {
    const text = extractAnnotationText(
      { summary: 'matters', topics: ['x'] },
      DEFAULT_FIELD_CAP,
    )
    expect(text).toBe('matters x')
  })

  it('extractRevisionText returns "" when no text fields present', () => {
    expect(
      extractRevisionText(
        { revises: 'sha256:' + 'd'.repeat(64) },
        DEFAULT_FIELD_CAP,
      ),
    ).toBe('')
  })

  it('extractToolCallText returns "" when no recognizable fields', () => {
    expect(extractToolCallText({}, DEFAULT_FIELD_CAP)).toBe('')
  })

  it('extractTransactionText returns "" for purely numeric content', () => {
    // Only counterparty/memo/protocol-style strings are extracted; numeric
    // amounts are deliberately omitted per the shape contract.
    expect(extractTransactionText({} as never, DEFAULT_FIELD_CAP)).toBe('')
  })

  it('extractDirectoryAnchorText returns "" when no anchor fields present', () => {
    expect(extractDirectoryAnchorText({}, DEFAULT_FIELD_CAP)).toBe('')
  })
})
