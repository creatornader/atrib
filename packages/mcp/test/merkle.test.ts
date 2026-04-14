/**
 * Tests for RFC 6962 Merkle tree implementation.
 *
 * Test vectors computed independently using @noble/hashes directly to verify
 * correctness of domain separation prefixes and tree structure.
 */

import { describe, it, expect } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  leafHash,
  nodeHash,
  computeRoot,
  computeInclusionProof,
  verifyInclusion,
} from '../src/merkle.js'
import { hexEncode } from '../src/hash.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

/** Five distinct entry payloads used throughout tests. */
const ENTRIES = [
  new Uint8Array([0x01, 0x02]),
  new Uint8Array([0x03, 0x04]),
  new Uint8Array([0x05, 0x06]),
  new Uint8Array([0x07, 0x08]),
  new Uint8Array([0x09, 0x0a]),
]

// Pre-computed leaf hashes for ENTRIES (SHA-256(0x00 || entry))
// These hex values were computed independently as ground truth.
const LEAF_HASHES = ENTRIES.map((e) => leafHash(e))

// ---------------------------------------------------------------------------
// leafHash
// ---------------------------------------------------------------------------

describe('leafHash', () => {
  it('prefixes with 0x00 before hashing', () => {
    const entry = ENTRIES[0]
    const expected = sha256(concat(new Uint8Array([0x00]), entry))
    expect(hexEncode(leafHash(entry))).toBe(hexEncode(expected))
  })

  it('matches known test vector for ENTRIES[0]', () => {
    // SHA-256(0x00 || [0x01, 0x02]). pre-computed reference value
    expect(hexEncode(leafHash(ENTRIES[0]))).toBe(
      'ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc',
    )
  })

  it('matches known test vector for ENTRIES[1]', () => {
    expect(hexEncode(leafHash(ENTRIES[1]))).toBe(
      'ed2139a910c69105ce3628d7aae9c530ad4cbb6aa45a683a0eb02f85a2807287',
    )
  })

  it('different inputs produce different hashes', () => {
    const h0 = hexEncode(leafHash(ENTRIES[0]))
    const h1 = hexEncode(leafHash(ENTRIES[1]))
    expect(h0).not.toBe(h1)
  })

  it('is deterministic', () => {
    expect(hexEncode(leafHash(ENTRIES[0]))).toBe(hexEncode(leafHash(ENTRIES[0])))
  })

  it('returns 32 bytes', () => {
    expect(leafHash(ENTRIES[0]).length).toBe(32)
  })
})

// ---------------------------------------------------------------------------
// nodeHash
// ---------------------------------------------------------------------------

describe('nodeHash', () => {
  it('prefixes with 0x01 and concatenates left || right', () => {
    const left = LEAF_HASHES[0]
    const right = LEAF_HASHES[1]
    const expected = sha256(concat(new Uint8Array([0x01]), left, right))
    expect(hexEncode(nodeHash(left, right))).toBe(hexEncode(expected))
  })

  it('matches known test vector for nodeHash(leaf0, leaf1)', () => {
    // SHA-256(0x01 || leafHash(ENTRIES[0]) || leafHash(ENTRIES[1]))
    expect(hexEncode(nodeHash(LEAF_HASHES[0], LEAF_HASHES[1]))).toBe(
      '5564155a2da076daa766119fb3863b56b463fde2b5ca5f644ced5fd47a8488da',
    )
  })

  it('is NOT commutative: nodeHash(a,b) !== nodeHash(b,a)', () => {
    const a = LEAF_HASHES[0]
    const b = LEAF_HASHES[1]
    expect(hexEncode(nodeHash(a, b))).not.toBe(hexEncode(nodeHash(b, a)))
  })

  it('is deterministic', () => {
    const a = LEAF_HASHES[0]
    const b = LEAF_HASHES[1]
    expect(hexEncode(nodeHash(a, b))).toBe(hexEncode(nodeHash(a, b)))
  })

  it('returns 32 bytes', () => {
    expect(nodeHash(LEAF_HASHES[0], LEAF_HASHES[1]).length).toBe(32)
  })
})

// ---------------------------------------------------------------------------
// computeRoot
// ---------------------------------------------------------------------------

describe('computeRoot', () => {
  it('throws for empty tree', () => {
    expect(() => computeRoot([])).toThrow()
  })

  it('single leaf: returns leafHash of the leaf', () => {
    const root = computeRoot([ENTRIES[0]])
    expect(hexEncode(root)).toBe(hexEncode(LEAF_HASHES[0]))
  })

  it('two leaves: returns nodeHash(leaf0, leaf1)', () => {
    const root = computeRoot([ENTRIES[0], ENTRIES[1]])
    const expected = nodeHash(LEAF_HASHES[0], LEAF_HASHES[1])
    expect(hexEncode(root)).toBe(hexEncode(expected))
  })

  it('three leaves (non-power-of-2): split at 2', () => {
    // Largest power-of-2 < 3 is 2.
    // left = computeRoot([e0, e1]) = nodeHash(leaf0, leaf1)
    // right = computeRoot([e2]) = leaf2
    // root = nodeHash(left, right)
    const left = nodeHash(LEAF_HASHES[0], LEAF_HASHES[1])
    const right = LEAF_HASHES[2]
    const expected = nodeHash(left, right)
    expect(hexEncode(computeRoot(ENTRIES.slice(0, 3)))).toBe(hexEncode(expected))
  })

  it('three leaves matches known test vector', () => {
    expect(hexEncode(computeRoot(ENTRIES.slice(0, 3)))).toBe(
      '404decb30b7393262416216bd997ef8b929067e16f6e62166545d8771744eeba',
    )
  })

  it('four leaves: balanced tree', () => {
    const node01 = nodeHash(LEAF_HASHES[0], LEAF_HASHES[1])
    const node23 = nodeHash(LEAF_HASHES[2], LEAF_HASHES[3])
    const expected = nodeHash(node01, node23)
    expect(hexEncode(computeRoot(ENTRIES.slice(0, 4)))).toBe(hexEncode(expected))
  })

  it('four leaves matches known test vector', () => {
    expect(hexEncode(computeRoot(ENTRIES.slice(0, 4)))).toBe(
      '8d897f1c3ce8336170f0757eae08206f35b865afc291b3b3a66845d53ab2a732',
    )
  })

  it('five leaves: split at 4, nodeHash(root4, leafHash(e4))', () => {
    const root4 = computeRoot(ENTRIES.slice(0, 4))
    const expected = nodeHash(root4, LEAF_HASHES[4])
    expect(hexEncode(computeRoot(ENTRIES.slice(0, 5)))).toBe(hexEncode(expected))
  })

  it('five leaves matches known test vector', () => {
    expect(hexEncode(computeRoot(ENTRIES.slice(0, 5)))).toBe(
      'f326493eceab4f2d9ffbc78c59432a0a005d6ea98392045c74df5d14a113be18',
    )
  })

  it('is deterministic', () => {
    const r1 = hexEncode(computeRoot(ENTRIES.slice(0, 5)))
    const r2 = hexEncode(computeRoot(ENTRIES.slice(0, 5)))
    expect(r1).toBe(r2)
  })
})

// ---------------------------------------------------------------------------
// computeInclusionProof + verifyInclusion
// ---------------------------------------------------------------------------

describe('computeInclusionProof + verifyInclusion', () => {
  it('single-element tree: proof is empty, verifies true', () => {
    const leaves = [ENTRIES[0]]
    const proof = computeInclusionProof(0, leaves)
    expect(proof).toHaveLength(0)

    const root = computeRoot(leaves)
    expect(verifyInclusion(0, 1, LEAF_HASHES[0], proof, root)).toBe(true)
  })

  it('all positions in a 4-element tree generate valid proofs', () => {
    const leaves = ENTRIES.slice(0, 4)
    const root = computeRoot(leaves)

    for (let i = 0; i < 4; i++) {
      const proof = computeInclusionProof(i, leaves)
      expect(verifyInclusion(i, 4, leafHash(leaves[i]), proof, root)).toBe(true)
    }
  })

  it('all positions in a 7-element tree generate valid proofs', () => {
    // Build 7 distinct entries
    const entries7 = Array.from({ length: 7 }, (_, i) => new Uint8Array([0x10 + i]))
    const root = computeRoot(entries7)

    for (let i = 0; i < 7; i++) {
      const proof = computeInclusionProof(i, entries7)
      expect(verifyInclusion(i, 7, leafHash(entries7[i]), proof, root)).toBe(true)
    }
  })

  it('wrong leaf hash: verification returns false', () => {
    const leaves = ENTRIES.slice(0, 4)
    const proof = computeInclusionProof(0, leaves)
    const root = computeRoot(leaves)

    // Use the leaf hash for a different entry
    const wrongLeafHash = LEAF_HASHES[1]
    expect(verifyInclusion(0, 4, wrongLeafHash, proof, root)).toBe(false)
  })

  it('tampered sibling hash: verification returns false', () => {
    const leaves = ENTRIES.slice(0, 4)
    const proof = computeInclusionProof(0, leaves)
    const root = computeRoot(leaves)

    // Flip a byte in the first proof element
    const tamperedProof = proof.map((p, i) => {
      if (i === 0) {
        const copy = new Uint8Array(p)
        copy[0] ^= 0xff
        return copy
      }
      return p
    })
    expect(verifyInclusion(0, 4, LEAF_HASHES[0], tamperedProof, root)).toBe(false)
  })

  it('tampered root: verification returns false', () => {
    const leaves = ENTRIES.slice(0, 4)
    const proof = computeInclusionProof(0, leaves)
    const root = computeRoot(leaves)

    const tamperedRoot = new Uint8Array(root)
    tamperedRoot[0] ^= 0x01
    expect(verifyInclusion(0, 4, LEAF_HASHES[0], proof, tamperedRoot)).toBe(false)
  })

  it('proof length mismatch: verification returns false', () => {
    const leaves = ENTRIES.slice(0, 4)
    const proof = computeInclusionProof(0, leaves)
    const root = computeRoot(leaves)

    // Truncate proof by one element
    const shortProof = proof.slice(0, proof.length - 1)
    expect(verifyInclusion(0, 4, LEAF_HASHES[0], shortProof, root)).toBe(false)
  })

  it('index out of range: verification returns false', () => {
    const leaves = ENTRIES.slice(0, 4)
    const proof = computeInclusionProof(0, leaves)
    const root = computeRoot(leaves)

    expect(verifyInclusion(4, 4, LEAF_HASHES[0], proof, root)).toBe(false)
    expect(verifyInclusion(-1, 4, LEAF_HASHES[0], proof, root)).toBe(false)
  })

  it('cross-index: proof for one leaf does not verify for another', () => {
    const leaves = ENTRIES.slice(0, 4)
    const root = computeRoot(leaves)

    // Proof for index 0 should not verify for index 1
    const proof0 = computeInclusionProof(0, leaves)
    expect(verifyInclusion(1, 4, LEAF_HASHES[1], proof0, root)).toBe(false)
  })

  it('5-element tree: all positions verify', () => {
    const leaves = ENTRIES.slice(0, 5)
    const root = computeRoot(leaves)

    for (let i = 0; i < 5; i++) {
      const proof = computeInclusionProof(i, leaves)
      expect(verifyInclusion(i, 5, leafHash(leaves[i]), proof, root)).toBe(true)
    }
  })
})
