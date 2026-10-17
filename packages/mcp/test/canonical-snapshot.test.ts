// SPDX-License-Identifier: Apache-2.0

/**
 * JCS canonical output snapshot test.
 *
 * Pins the exact byte-level output of the `canonicalize` npm package for a
 * known atrib record. If the package changes serialization behavior (key
 * ordering, whitespace, number formatting), this test catches it immediately.
 */

import { describe, it, expect } from 'vitest'
import canonicalize from 'canonicalize'
import { createHash } from 'node:crypto'

import { canonicalSigningInput } from '../src/index.js'
import type { AtribRecord } from '../src/index.js'

// ---------------------------------------------------------------------------
// Fixed record. same inputs as Appendix A test vectors
// ---------------------------------------------------------------------------

const RECORD: AtribRecord = {
  spec_version: 'atrib/1.0',
  content_id: 'sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e',
  creator_key: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w',
  chain_root: 'sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547',
  event_type: 'https://atrib.dev/v1/types/tool_call',
  context_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  timestamp: 1700000000000,
  signature:
    'ZMjtGaUFxp3N4ZA2Vw05NBg8KiymOdNRL3uRB_QJ-zMK7MVOBBqtOA1xLo-DMmeLZfjWjfBFwrHtQemoxXXMBg',
}

// ---------------------------------------------------------------------------
// Expected canonical signing input (signature field removed, JCS-serialized)
// ---------------------------------------------------------------------------

const EXPECTED_CANONICAL =
  '{"chain_root":"sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547",' +
  '"content_id":"sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e",' +
  '"context_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",' +
  '"creator_key":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w",' +
  '"event_type":"https://atrib.dev/v1/types/tool_call",' +
  '"spec_version":"atrib/1.0",' +
  '"timestamp":1700000000000}'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JCS canonical snapshot', () => {
  it('produces the exact expected canonical signing input', () => {
    const bytes = canonicalSigningInput(RECORD)
    const text = new TextDecoder().decode(bytes)
    expect(text).toBe(EXPECTED_CANONICAL)
  })

  it('emits keys in strict lexicographic (JCS) order', () => {
    const bytes = canonicalSigningInput(RECORD)
    const text = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(text) as Record<string, unknown>
    const keys = Object.keys(parsed)
    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
  })

  it('contains no whitespace in the canonical output', () => {
    const bytes = canonicalSigningInput(RECORD)
    const text = new TextDecoder().decode(bytes)
    // JCS output must have no spaces, tabs, or newlines
    expect(text).not.toMatch(/\s/)
  })
})

describe('RFC 8785 byte boundaries', () => {
  it('preserves the canonicalize 4 fingerprint of seeded IEEE-754 numbers', () => {
    // Frozen from canonicalize 4.0.0 before upgrading. No baseline dependency is needed.
    let state = 0x9e3779b97f4a7c15n
    const mask = (1n << 64n) - 1n
    const bytes = Buffer.alloc(8)
    const hash = createHash('sha256')
    let count = 0
    for (let i = 0; i < 10_000; i++) {
      state ^= state << 13n
      state &= mask
      state ^= state >> 7n
      state ^= state << 17n
      state &= mask
      bytes.writeBigUInt64BE(state)
      const number = bytes.readDoubleBE()
      if (!Number.isFinite(number)) continue
      hash.update(canonicalize({ number })! + '\n')
      count++
    }
    expect(count).toBe(9998)
    expect(hash.digest('hex')).toBe(
      '5bd20cc1dfd219844dd6d2af2ab8204898f053655542a5fc89d3c97559164a4f',
    )
  })

  it.each([
    [-0, '0'],
    [5e-324, '5e-324'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
    [1e-7, '1e-7'],
    [1e-6, '0.000001'],
    [1e20, '100000000000000000000'],
    [1e21, '1e+21'],
    [Number('333333333.33333329'), '333333333.3333333'],
    [0.1 + 0.2, '0.30000000000000004'],
  ])('pins the number %s to %s', (input, expected) => {
    expect(canonicalize(input)).toBe(expected)
  })

  it('sorts nested keys by UTF-16 code units without normalizing Unicode', () => {
    const input = { '\uffff': 3, '\ud83d\ude00': 2, a: { z: 'A\u030a', a: 'Å' } }
    expect(canonicalize(input)).toBe('{"a":{"a":"Å","z":"Å"},"😀":2,"￿":3}')
  })

  it('pins escaping, array order, booleans and null', () => {
    expect(canonicalize({ z: [true, null, false], a: '\u0000\b\t\n\f\r"\\/' })).toBe(
      '{"a":"\\u0000\\b\\t\\n\\f\\r\\"\\\\/","z":[true,null,false]}',
    )
  })

  it.each([NaN, Infinity, -Infinity, '\ud800', '\udfff', 1n])(
    'rejects an unsupported value %s before returning canonical bytes',
    (input) => {
      expect(() => canonicalize({ input })).toThrow()
    },
  )

  it('rejects cycles while allowing shared children', () => {
    const shared = { z: 1 }
    expect(canonicalize({ a: shared, b: shared })).toBe('{"a":{"z":1},"b":{"z":1}}')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalize(cyclic)).toThrow('Circular reference detected')
  })
})

describe('canonicalize 5 JavaScript input compatibility', () => {
  it('omits functions and undefined toJSON results in objects', () => {
    expect(canonicalize({ a: () => 1, b: { toJSON: () => undefined }, c: 2 })).toBe('{"c":2}')
  })

  it('uses null for functions, holes and undefined toJSON results in arrays', () => {
    const values = [() => 1, { toJSON: () => undefined }, undefined]
    values.length = 4
    expect(canonicalize(values)).toBe('[null,null,null,null]')
  })

  it('unwraps boxed primitives and rejects boxed nonfinite numbers', () => {
    expect(canonicalize([Object(3), Object('text'), Object(false)])).toBe('[3,"text",false]')
    expect(() => canonicalize(Object(NaN))).toThrow('NaN is not allowed')
  })
})
