// SPDX-License-Identifier: Apache-2.0

/**
 * Unit tests for the pure helpers in scripts/verify-loop.mjs.
 *
 * The daily CI workflow (.github/workflows/verify-log.yml) runs verify-loop
 * against the deployed log. The gate logic relies on a set of pure helpers
 * that compute leaf/node hashes, build inclusion proofs, and parse the wire
 * formats (checkpoint, entry bundle, fixed-size entry). If any of these is
 * wrong, the daily CI silently passes against bad data, the script logs
 * PASS but the assertion was based on a flawed primitive.
 *
 * These tests pin those primitives to known-good fixtures and round-trip
 * checks. They are independent of the live log and run in milliseconds.
 */

import { describe, it, expect } from 'vitest'
import {
  sha256,
  leafHash,
  nodeHash,
  largestPowerOfTwoLessThan,
  computeRoot,
  computeRootCached,
  computeInclusionProof,
  computeInclusionProofCached,
  verifyInclusion,
  bytesEqual,
  parseCheckpoint,
  parseEntryBundle,
  parseEntry,
  b64urlDecode,
  b64urlEncode,
  parseNonNegativeInt,
  formatDecodedEntryLine,
  selectEntrySamples,
} from '../scripts/verify-loop.mjs'

const enc = (s: string) => new TextEncoder().encode(s)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

describe('verify-loop helpers: hash primitives', () => {
  it('sha256("") matches the known empty-string digest', () => {
    const got = sha256(new Uint8Array(0))
    expect(hex(got)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('sha256("abc") matches the FIPS-180 test vector', () => {
    expect(hex(sha256(enc('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('leafHash prepends 0x00 per RFC 6962 §2.1', () => {
    // RFC 6962 leaf hash = SHA-256(0x00 || entry)
    const expected = sha256(new Uint8Array([0x00, 0x61, 0x62, 0x63])) // 0x00 || "abc"
    expect(hex(leafHash(enc('abc')))).toBe(hex(expected))
  })

  it('nodeHash prepends 0x01 and concatenates left||right', () => {
    const a = sha256(enc('a'))
    const b = sha256(enc('b'))
    const buf = new Uint8Array(1 + a.length + b.length)
    buf[0] = 0x01
    buf.set(a, 1)
    buf.set(b, 1 + a.length)
    const expected = sha256(buf)
    expect(hex(nodeHash(a, b))).toBe(hex(expected))
  })
})

describe('verify-loop helpers: largestPowerOfTwoLessThan', () => {
  it('handles boundary values per RFC 6962 §2.1.1', () => {
    expect(largestPowerOfTwoLessThan(0)).toBe(0)
    expect(largestPowerOfTwoLessThan(1)).toBe(0)
    expect(largestPowerOfTwoLessThan(2)).toBe(1)
    expect(largestPowerOfTwoLessThan(3)).toBe(2)
    expect(largestPowerOfTwoLessThan(4)).toBe(2)
    expect(largestPowerOfTwoLessThan(5)).toBe(4)
    expect(largestPowerOfTwoLessThan(7)).toBe(4)
    expect(largestPowerOfTwoLessThan(8)).toBe(4)
    expect(largestPowerOfTwoLessThan(9)).toBe(8)
    expect(largestPowerOfTwoLessThan(256)).toBe(128)
    expect(largestPowerOfTwoLessThan(257)).toBe(256)
  })
})

describe('verify-loop helpers: computeRoot', () => {
  it('single-leaf root equals the leaf hash itself', () => {
    const leaves = [leafHash(enc('only'))]
    expect(hex(computeRoot(leaves))).toBe(hex(leaves[0]!))
  })

  it('two-leaf root is nodeHash(left, right)', () => {
    const l = leafHash(enc('a'))
    const r = leafHash(enc('b'))
    const expected = nodeHash(l, r)
    expect(hex(computeRoot([l, r]))).toBe(hex(expected))
  })

  it('three-leaf tree splits at largest power-of-two (LH ⊕ RH)', () => {
    // RFC 6962 splits 3 → (2, 1). Root = H(0x01 || H(0x01 || L0 || L1) || L2)
    const a = leafHash(enc('a'))
    const b = leafHash(enc('b'))
    const c = leafHash(enc('c'))
    const left = nodeHash(a, b)
    const right = c
    const expected = nodeHash(left, right)
    expect(hex(computeRoot([a, b, c]))).toBe(hex(expected))
  })

  it('produces a stable root for 5 leaves', () => {
    const leaves = [
      leafHash(enc('e0')),
      leafHash(enc('e1')),
      leafHash(enc('e2')),
      leafHash(enc('e3')),
      leafHash(enc('e4')),
    ]
    const root = computeRoot(leaves)
    expect(root.length).toBe(32)
    expect(hex(computeRoot(leaves))).toBe(hex(root)) // determinism
  })
})

describe('verify-loop helpers: inclusion proofs', () => {
  function leaves(n: number) {
    return Array.from({ length: n }, (_, i) => leafHash(enc(`e${i}`)))
  }

  it('round-trips proofs for every leaf in trees of size 1..16', () => {
    for (let n = 1; n <= 16; n++) {
      const ls = leaves(n)
      const root = computeRoot(ls)
      for (let i = 0; i < n; i++) {
        const proof = computeInclusionProof(i, ls)
        const ok = verifyInclusion(i, n, ls[i]!, proof, root)
        expect(ok, `inclusion(${i}/${n}) failed`).toBe(true)
      }
    }
  })

  it('cached roots match the reference recursive root for trees of size 1..16', () => {
    for (let n = 1; n <= 16; n++) {
      const ls = leaves(n)
      const { root, cache } = computeRootCached(ls)
      expect(hex(root), `root(${n})`).toBe(hex(computeRoot(ls)))
      expect(cache.size, `cache(${n})`).toBeGreaterThan(0)
    }
  })

  it('cached inclusion proofs match reference proofs and verify for every leaf', () => {
    for (let n = 1; n <= 16; n++) {
      const ls = leaves(n)
      const { root, cache } = computeRootCached(ls)
      for (let i = 0; i < n; i++) {
        const proof = computeInclusionProofCached(i, ls, cache)
        const referenceProof = computeInclusionProof(i, ls)
        expect(proof.map(hex), `proof(${i}/${n})`).toEqual(referenceProof.map(hex))
        expect(verifyInclusion(i, n, ls[i]!, proof, root), `cached inclusion(${i}/${n})`).toBe(true)
      }
    }
  })

  it('cached inclusion proofs reject out-of-range indexes', () => {
    const ls = leaves(4)
    const { cache } = computeRootCached(ls)
    expect(() => computeInclusionProofCached(-1, ls, cache)).toThrow(/out of range/)
    expect(() => computeInclusionProofCached(4, ls, cache)).toThrow(/out of range/)
  })

  it('rejects a proof that targets the wrong leaf', () => {
    const ls = leaves(8)
    const root = computeRoot(ls)
    const proof = computeInclusionProof(3, ls)
    expect(verifyInclusion(3, 8, ls[3]!, proof, root)).toBe(true)
    // Use leaf for index 4 with proof for index 3
    expect(verifyInclusion(3, 8, ls[4]!, proof, root)).toBe(false)
  })

  it('rejects a tampered root', () => {
    const ls = leaves(8)
    const root = computeRoot(ls)
    const tampered = new Uint8Array(root)
    tampered[0] ^= 0xff
    const proof = computeInclusionProof(0, ls)
    expect(verifyInclusion(0, 8, ls[0]!, proof, tampered)).toBe(false)
  })

  it('rejects a tampered proof element', () => {
    const ls = leaves(8)
    const root = computeRoot(ls)
    const proof = computeInclusionProof(0, ls)
    const tampered = proof.map((p: Uint8Array, i: number) => {
      if (i !== 0) return p
      const c = new Uint8Array(p)
      c[0] ^= 0xff
      return c
    })
    expect(verifyInclusion(0, 8, ls[0]!, tampered, root)).toBe(false)
  })

  it('rejects out-of-range index', () => {
    const ls = leaves(4)
    const root = computeRoot(ls)
    const proof = computeInclusionProof(0, ls)
    expect(verifyInclusion(-1, 4, ls[0]!, proof, root)).toBe(false)
    expect(verifyInclusion(4, 4, ls[0]!, proof, root)).toBe(false)
  })

  it('rejects malformed leaf or root length', () => {
    const ls = leaves(2)
    const proof = computeInclusionProof(0, ls)
    const root = computeRoot(ls)
    expect(verifyInclusion(0, 2, new Uint8Array(31), proof, root)).toBe(false)
    expect(verifyInclusion(0, 2, ls[0]!, proof, new Uint8Array(31))).toBe(false)
  })

  it('rejects empty tree', () => {
    expect(verifyInclusion(0, 0, leafHash(enc('x')), [], leafHash(enc('x')))).toBe(false)
  })
})

describe('verify-loop helpers: bytesEqual', () => {
  it('treats identical buffers as equal', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
  })
  it('rejects different lengths', () => {
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
  })
  it('rejects single-byte difference (constant-time path still hits diff)', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
  })
})

describe('verify-loop helpers: base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x42, 0xab, 0xcd])
    expect(b64urlEncode(b64urlDecode(b64urlEncode(bytes)))).toBe(b64urlEncode(bytes))
    expect(Array.from(b64urlDecode(b64urlEncode(bytes)))).toEqual(Array.from(bytes))
  })

  it('handles URL-safe characters correctly', () => {
    // 0xfb 0xff 0xff 0xff encodes to "+///" in standard base64,
    // which is "-___" in base64url. The decoder must accept the URL-safe form.
    const bytes = new Uint8Array([0xfb, 0xff, 0xff, 0xff])
    const encoded = b64urlEncode(bytes)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(Array.from(b64urlDecode(encoded))).toEqual(Array.from(bytes))
  })
})

describe('verify-loop helpers: parseCheckpoint', () => {
  it('parses a minimal C2SP signed-note checkpoint', () => {
    // Valid checkpoint body: origin\nsize\nbase64(rootHash)\n\n<sig line>
    const root = sha256(enc('fake-root'))
    const rootB64 = Buffer.from(root).toString('base64')
    const keyId = new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4])
    const sig = new Uint8Array(64).fill(7)
    const sigPayload = new Uint8Array([...keyId, ...sig])
    const sigB64 = Buffer.from(sigPayload).toString('base64')
    const text = `log.atrib.dev/v1\n42\n${rootB64}\n\n— log.atrib.dev/v1 ${sigB64}\n`

    const cp = parseCheckpoint(text)
    expect(cp.origin).toBe('log.atrib.dev/v1')
    expect(cp.treeSize).toBe(42)
    expect(Array.from(cp.rootHash)).toEqual(Array.from(root))
    expect(cp.signatures).toHaveLength(1)
    expect(Array.from(cp.signatures[0]!.keyId)).toEqual(Array.from(keyId))
    expect(Array.from(cp.signatures[0]!.signature)).toEqual(Array.from(sig))
  })

  it('skips signature lines whose payload length is not 4+64', () => {
    const root = sha256(enc('r'))
    const rootB64 = Buffer.from(root).toString('base64')
    const wrongLen = Buffer.from(new Uint8Array(50)).toString('base64')
    const text = `origin\n1\n${rootB64}\n\n— origin ${wrongLen}\n`
    const cp = parseCheckpoint(text)
    expect(cp.signatures).toHaveLength(0)
  })

  it('throws when body/signature separator is missing', () => {
    expect(() => parseCheckpoint('only-body-no-blank-line')).toThrow(/separator/)
  })

  it('throws when body has fewer than 3 lines', () => {
    expect(() => parseCheckpoint('origin\n\n— origin sig\n')).toThrow(/too short/)
  })
})

describe('verify-loop helpers: parseEntryBundle', () => {
  it('parses a stream of length-prefixed entries', () => {
    // Two entries of length 3 and 5
    const e1 = new Uint8Array([1, 2, 3])
    const e2 = new Uint8Array([4, 5, 6, 7, 8])
    const bundle = new Uint8Array([
      0x00, 0x03, ...e1,
      0x00, 0x05, ...e2,
    ])
    const parsed = parseEntryBundle(bundle)
    expect(parsed).toHaveLength(2)
    expect(Array.from(parsed[0])).toEqual([1, 2, 3])
    expect(Array.from(parsed[1])).toEqual([4, 5, 6, 7, 8])
  })

  it('returns empty for an empty buffer', () => {
    expect(parseEntryBundle(new Uint8Array(0))).toEqual([])
  })

  it('throws on truncated length prefix', () => {
    expect(() => parseEntryBundle(new Uint8Array([0x00]))).toThrow(/truncated length/)
  })

  it('throws on truncated entry body', () => {
    // Length says 5 bytes but only 2 are present
    expect(() => parseEntryBundle(new Uint8Array([0x00, 0x05, 0xaa, 0xbb]))).toThrow(/truncated entry/)
  })
})

describe('verify-loop helpers: parseEntry', () => {
  function makeEntry(opts: {
    version?: number
    recordHash?: Uint8Array
    creatorKey?: Uint8Array
    contextId?: Uint8Array
    timestamp?: number
    eventType?: number
  } = {}) {
    const buf = new Uint8Array(90)
    buf[0] = opts.version ?? 0x01
    buf.set(opts.recordHash ?? new Uint8Array(32).fill(1), 1)
    buf.set(opts.creatorKey ?? new Uint8Array(32).fill(2), 33)
    buf.set(opts.contextId ?? new Uint8Array(16).fill(3), 65)
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    view.setBigUint64(81, BigInt(opts.timestamp ?? 1700000000000), false)
    buf[89] = opts.eventType ?? 0x01
    return buf
  }

  it('parses a well-formed §2.3.1 entry', () => {
    const ts = 1735689600000 // 2025-01-01T00:00Z
    const e = parseEntry(makeEntry({ timestamp: ts, eventType: 0x02 }))
    expect(e.version).toBe(0x01)
    expect(e.eventType).toBe(0x02)
    expect(e.ts).toBe(ts)
    expect(e.recordHash.length).toBe(32)
    expect(e.creatorKey.length).toBe(32)
    expect(e.contextId.length).toBe(16)
  })

  it('throws on wrong-length input', () => {
    expect(() => parseEntry(new Uint8Array(89))).toThrow(/expected 90/)
    expect(() => parseEntry(new Uint8Array(91))).toThrow(/expected 90/)
  })

  it('preserves field offsets exactly per spec §2.3.1', () => {
    const recordHash = new Uint8Array(32).map((_, i) => i + 1)
    const creatorKey = new Uint8Array(32).map((_, i) => i + 100)
    const contextId = new Uint8Array(16).map((_, i) => i + 200)
    const e = parseEntry(makeEntry({ recordHash, creatorKey, contextId }))
    expect(Array.from(e.recordHash)).toEqual(Array.from(recordHash))
    expect(Array.from(e.creatorKey)).toEqual(Array.from(creatorKey))
    expect(Array.from(e.contextId)).toEqual(Array.from(contextId))
  })
})

describe('verify-loop helpers: decoded entry output', () => {
  it('parses non-negative integer env values with fallback', () => {
    expect(parseNonNegativeInt('0', 40)).toBe(0)
    expect(parseNonNegativeInt('12', 40)).toBe(12)
    expect(parseNonNegativeInt('', 40)).toBe(40)
    expect(parseNonNegativeInt(undefined, 40)).toBe(40)
    expect(parseNonNegativeInt('-1', 40)).toBe(40)
    expect(parseNonNegativeInt('1.5', 40)).toBe(40)
    expect(parseNonNegativeInt('nope', 40)).toBe(40)
  })

  it('samples head and tail entries with one omission marker', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: i }))
    expect(selectEntrySamples(entries, 4)).toEqual([
      { kind: 'entry', index: 0, entry: entries[0] },
      { kind: 'entry', index: 1, entry: entries[1] },
      { kind: 'omitted', count: 6 },
      { kind: 'entry', index: 8, entry: entries[8] },
      { kind: 'entry', index: 9, entry: entries[9] },
    ])
  })

  it('can suppress entry lines entirely while reporting the omitted count', () => {
    expect(selectEntrySamples([1, 2, 3], 0)).toEqual([{ kind: 'omitted', count: 3 }])
    expect(selectEntrySamples([], 0)).toEqual([])
  })

  it('formats one decoded entry line without dumping the full record body', () => {
    const entry = {
      recordHash: new Uint8Array(32).fill(1),
      creatorKey: new Uint8Array(32).fill(2),
      contextId: new Uint8Array(16).fill(3),
      ts: 1735689600000,
      eventType: 0x01,
    }
    expect(formatDecodedEntryLine(7, entry)).toBe(
      '  [7] record_hash=0101010101010101...  ' +
      'creator_key=AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI  ' +
      'context_id=03030303030303030303030303030303  ' +
      'ts=2025-01-01T00:00:00.000Z  ' +
      'event_type=0x01',
    )
  })
})
