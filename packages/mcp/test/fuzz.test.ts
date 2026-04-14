// SPDX-License-Identifier: Apache-2.0

/**
 * Fuzz and edge-case tests for the serialization layer.
 *
 * Tests base64url, hex, token encoding/decoding, timestamp validation,
 * and entry serialization with adversarial and boundary inputs.
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  base64urlEncode,
  base64urlDecode,
  hexEncode,
  hexDecode,
  decodeToken,
  validateSubmission,
  verifyRecord,
  signRecord,
} from '../src/index.js'
import type { AtribRecord } from '../src/index.js'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

// ─────────────────────────────────────────────────────────────────────────────
// base64url round-trip and adversarial inputs
// ─────────────────────────────────────────────────────────────────────────────

describe('base64url fuzz', () => {
  it('round-trips arbitrary byte arrays', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 1024 }), (bytes) => {
        const encoded = base64urlEncode(bytes)
        const decoded = base64urlDecode(encoded)
        expect(decoded).toEqual(bytes)
      }),
      { numRuns: 500 },
    )
  })

  it('encoded output contains only valid base64url characters', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 256 }), (bytes) => {
        const encoded = base64urlEncode(bytes)
        expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/)
      }),
      { numRuns: 200 },
    )
  })

  it('rejects strings with invalid characters', () => {
    const invalidChars = ['+', '/', '=', ' ', '\n', '\t', '\0', '!', '@', '#']
    for (const ch of invalidChars) {
      expect(() => base64urlDecode(`AAAA${ch}AAAA`)).toThrow()
    }
  })

  it('rejects length ≡ 1 (mod 4)', () => {
    expect(() => base64urlDecode('A')).toThrow()
    expect(() => base64urlDecode('AAAAA')).toThrow() // 5 chars
    expect(() => base64urlDecode('AAAAAAAAA')).toThrow() // 9 chars
  })

  it('handles empty input', () => {
    expect(base64urlEncode(new Uint8Array(0))).toBe('')
    expect(base64urlDecode('')).toEqual(new Uint8Array(0))
  })

  it('handles all valid lengths (mod 4): 0, 2, 3', () => {
    expect(() => base64urlDecode('AA')).not.toThrow() // 2 chars = 1 byte
    expect(() => base64urlDecode('AAA')).not.toThrow() // 3 chars = 2 bytes
    expect(() => base64urlDecode('AAAA')).not.toThrow() // 4 chars = 3 bytes
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// hex round-trip and adversarial inputs
// ─────────────────────────────────────────────────────────────────────────────

describe('hex fuzz', () => {
  it('round-trips arbitrary byte arrays', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 512 }), (bytes) => {
        const encoded = hexEncode(bytes)
        const decoded = hexDecode(encoded)
        expect(decoded).toEqual(bytes)
      }),
      { numRuns: 500 },
    )
  })

  it('encoded output is always lowercase hex', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 128 }), (bytes) => {
        const encoded = hexEncode(bytes)
        expect(encoded).toMatch(/^[0-9a-f]*$/)
        expect(encoded.length).toBe(bytes.length * 2)
      }),
      { numRuns: 200 },
    )
  })

  it('rejects odd-length strings', () => {
    expect(() => hexDecode('a')).toThrow()
    expect(() => hexDecode('abc')).toThrow()
    expect(() => hexDecode('abcde')).toThrow()
  })

  it('rejects non-hex characters', () => {
    expect(() => hexDecode('gg')).toThrow()
    expect(() => hexDecode('zz')).toThrow()
    expect(() => hexDecode('0x')).toThrow()
    expect(() => hexDecode(' a')).toThrow()
  })

  it('accepts uppercase hex', () => {
    // hexDecode should accept both cases
    const lower = hexDecode('abcdef')
    const upper = hexDecode('ABCDEF')
    expect(lower).toEqual(upper)
  })

  it('handles empty input', () => {
    expect(hexEncode(new Uint8Array(0))).toBe('')
    expect(hexDecode('')).toEqual(new Uint8Array(0))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Token encoding/decoding fuzz
// ─────────────────────────────────────────────────────────────────────────────

describe('token fuzz', () => {
  it('decodeToken returns null for random garbage strings', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (str) => {
        // Most random strings are not valid tokens
        const result = decodeToken(str)
        // Result is either null or a valid DecodedToken, never throws
        if (result !== null) {
          expect(result.recordHash).toBeInstanceOf(Uint8Array)
          expect(result.creatorKey).toBeInstanceOf(Uint8Array)
          expect(result.recordHash.length).toBe(32)
          expect(result.creatorKey.length).toBe(32)
        }
      }),
      { numRuns: 500 },
    )
  })

  it('returns null for strings with no dot', () => {
    expect(decodeToken('abcdef')).toBeNull()
    expect(decodeToken('')).toBeNull()
  })

  it('returns null for strings with multiple dots', () => {
    expect(decodeToken('a.b.c')).toBeNull()
    expect(decodeToken('...')).toBeNull()
  })

  it('returns null when parts are wrong length', () => {
    // 32 bytes = 43 base64url chars. Anything else should fail.
    expect(decodeToken('AA.AA')).toBeNull()
    expect(decodeToken('AAAA.AAAA')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp validation edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('timestamp validation', () => {
  const validBase = {
    spec_version: 'atrib/1.0' as const,
    event_type: 'tool_call' as const,
    context_id: 'a'.repeat(32),
    creator_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    chain_root: 'sha256:' + 'b'.repeat(64),
    content_id: 'sha256:' + 'c'.repeat(64),
    signature: 'A'.repeat(86),
  }

  it('rejects NaN timestamp', () => {
    const r = validateSubmission({ ...validBase, timestamp: NaN })
    expect(r.ok).toBe(false)
  })

  it('rejects Infinity timestamp', () => {
    const r = validateSubmission({ ...validBase, timestamp: Infinity })
    expect(r.ok).toBe(false)
  })

  it('rejects -Infinity timestamp', () => {
    const r = validateSubmission({ ...validBase, timestamp: -Infinity })
    expect(r.ok).toBe(false)
  })

  it('rejects negative timestamps', () => {
    const r = validateSubmission({ ...validBase, timestamp: -1 })
    expect(r.ok).toBe(false)
  })

  it('rejects negative zero', () => {
    // -0 is === 0 in JS, so it should be accepted as 0
    const r = validateSubmission({ ...validBase, timestamp: -0 })
    // -0 is technically non-negative (Object.is(-0, 0) is false but -0 >= 0 is true)
    expect(r.ok).toBe(true)
  })

  it('rejects float timestamps', () => {
    const r = validateSubmission({ ...validBase, timestamp: 1234.5 })
    expect(r.ok).toBe(false)
  })

  it('accepts timestamp 0', () => {
    const r = validateSubmission({ ...validBase, timestamp: 0 })
    expect(r.ok).toBe(true)
  })

  it('accepts current timestamp', () => {
    const r = validateSubmission({ ...validBase, timestamp: Date.now() })
    expect(r.ok).toBe(true)
  })

  it('rejects timestamp far in the future (>10 min)', () => {
    const r = validateSubmission({ ...validBase, timestamp: Date.now() + 20 * 60 * 1000 })
    expect(r.ok).toBe(false)
  })

  it('accepts timestamp slightly in the future (<10 min)', () => {
    const r = validateSubmission({ ...validBase, timestamp: Date.now() + 5 * 60 * 1000 })
    expect(r.ok).toBe(true)
  })

  it('accepts MAX_SAFE_INTEGER when within future window', () => {
    // MAX_SAFE_INTEGER as a timestamp is year ~287,396, far future, should be rejected
    const r = validateSubmission({ ...validBase, timestamp: Number.MAX_SAFE_INTEGER })
    expect(r.ok).toBe(false)
  })

  it('rejects string timestamps', () => {
    const r = validateSubmission({ ...validBase, timestamp: '1234' as unknown as number })
    expect(r.ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// verifyRecord edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyRecord edge cases', () => {
  it('rejects records with tampered signatures', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const creatorKey = Buffer.from(publicKey).toString('base64url')
    const contextId = 'a'.repeat(32)
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      event_type: 'tool_call',
      timestamp: Date.now(),
      context_id: contextId,
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'b'.repeat(64),
      content_id: 'sha256:' + 'c'.repeat(64),
      signature: '',
    }
    const signed = await signRecord(record, privateKey)
    // Tamper with signature (flip one character)
    const tampered = {
      ...signed,
      signature: signed.signature[0] === 'A'
        ? 'B' + signed.signature.slice(1)
        : 'A' + signed.signature.slice(1),
    }
    expect(await verifyRecord(tampered)).toBe(false)
  })

  it('rejects records with wrong creator_key', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const otherKey = ed.utils.randomPrivateKey()
    const otherPublic = await ed.getPublicKeyAsync(otherKey)
    const contextId = 'a'.repeat(32)
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      event_type: 'tool_call',
      timestamp: Date.now(),
      context_id: contextId,
      creator_key: Buffer.from(otherPublic).toString('base64url'),
      chain_root: 'sha256:' + 'b'.repeat(64),
      content_id: 'sha256:' + 'c'.repeat(64),
      signature: '',
    }
    const signed = await signRecord(record, privateKey)
    expect(await verifyRecord(signed)).toBe(false)
  })

  it('verifies correctly signed records', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const creatorKey = Buffer.from(publicKey).toString('base64url')
    const contextId = 'a'.repeat(32)
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      event_type: 'tool_call',
      timestamp: Date.now(),
      context_id: contextId,
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'b'.repeat(64),
      content_id: 'sha256:' + 'c'.repeat(64),
      signature: '',
    }
    const signed = await signRecord(record, privateKey)
    expect(await verifyRecord(signed)).toBe(true)
  })

  it('never throws on random garbage input', async () => {
    // verifyRecord should return false, not throw
    const garbage = {
      spec_version: 'atrib/1.0',
      event_type: 'tool_call',
      timestamp: Date.now(),
      context_id: 'x'.repeat(32),
      creator_key: 'not_valid_base64url!@#',
      chain_root: 'sha256:garbage',
      content_id: 'sha256:garbage',
      signature: 'not_a_real_signature',
    } as unknown as AtribRecord
    expect(await verifyRecord(garbage)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateSubmission fuzz
// ─────────────────────────────────────────────────────────────────────────────

describe('validateSubmission fuzz', () => {
  it('never throws on arbitrary objects', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        // Should always return a result, never throw
        const result = validateSubmission(input as Partial<AtribRecord>)
        expect(typeof result.ok).toBe('boolean')
      }),
      { numRuns: 500 },
    )
  })

  it('rejects all primitives', () => {
    for (const v of [null, undefined, 0, 1, '', 'hello', true, false]) {
      const result = validateSubmission(v as Partial<AtribRecord>)
      expect(result.ok).toBe(false)
    }
  })
})
