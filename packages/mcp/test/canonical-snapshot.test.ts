// SPDX-License-Identifier: Apache-2.0

/**
 * JCS canonical output snapshot test.
 *
 * Pins the exact byte-level output of the `canonicalize` npm package for a
 * known atrib record. If the package changes serialization behavior (key
 * ordering, whitespace, number formatting), this test catches it immediately.
 */

import { describe, it, expect } from 'vitest'

import { canonicalSigningInput } from '../src/index.js'
import type { AtribRecord } from '../src/index.js'

// ---------------------------------------------------------------------------
// Fixed record, same inputs as Appendix A test vectors
// ---------------------------------------------------------------------------

const RECORD: AtribRecord = {
  spec_version: 'atrib/1.0',
  content_id:
    'sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e',
  creator_key: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w',
  chain_root:
    'sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547',
  event_type: 'tool_call',
  context_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  timestamp: 1700000000000,
  signature: 'PrhhwDFrAcDwbfHVzQWG0y58SwGP3FWZdSKyxMeKVSA5EQOZQJYXbqwEZJC1MkFj6W1M0_17o22cGyzKEtSVDg',
}

// ---------------------------------------------------------------------------
// Expected canonical signing input (signature field removed, JCS-serialized)
// ---------------------------------------------------------------------------

const EXPECTED_CANONICAL =
  '{"chain_root":"sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547",' +
  '"content_id":"sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e",' +
  '"context_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",' +
  '"creator_key":"iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w",' +
  '"event_type":"tool_call",' +
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
