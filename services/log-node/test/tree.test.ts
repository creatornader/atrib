import { describe, it, expect } from 'vitest'
import { leafHash, verifyInclusion, computeRoot } from '@atrib/mcp'
import { createMerkleTree } from '../src/tree.js'

function makeEntry(value: number): Uint8Array {
  return new Uint8Array([value])
}

describe('MerkleTree', () => {
  it('starts empty with size 0', () => {
    const tree = createMerkleTree()
    expect(tree.size).toBe(0)
  })

  it('appends entry and returns log_index 0', () => {
    const tree = createMerkleTree()
    const index = tree.append(makeEntry(1))
    expect(index).toBe(0)
    expect(tree.size).toBe(1)
  })

  it('returns sequential indices on multiple appends', () => {
    const tree = createMerkleTree()
    expect(tree.append(makeEntry(1))).toBe(0)
    expect(tree.append(makeEntry(2))).toBe(1)
    expect(tree.append(makeEntry(3))).toBe(2)
    expect(tree.size).toBe(3)
  })

  it('throws on root() when empty', () => {
    const tree = createMerkleTree()
    expect(() => tree.root()).toThrow()
  })

  it('computes valid root after one entry (matches leafHash of the entry bytes)', () => {
    const tree = createMerkleTree()
    const entry = makeEntry(42)
    tree.append(entry)
    const root = tree.root()
    expect(root).toEqual(leafHash(entry))
  })

  it('computes correct root after 3 entries (matches computeRoot of the raw bytes)', () => {
    const tree = createMerkleTree()
    const entries = [makeEntry(10), makeEntry(20), makeEntry(30)]
    for (const e of entries) tree.append(e)
    expect(tree.root()).toEqual(computeRoot(entries))
  })

  it('returns the stored leaf hash at a given index', () => {
    const tree = createMerkleTree()
    const entry = makeEntry(99)
    tree.append(entry)
    expect(tree.leafHash(0)).toEqual(leafHash(entry))
  })

  it('generates verifiable inclusion proofs for 10 entries (all positions)', () => {
    const tree = createMerkleTree()
    const entries: Uint8Array[] = []
    for (let i = 0; i < 10; i++) {
      const e = new Uint8Array([i, i + 1])
      entries.push(e)
      tree.append(e)
    }
    const root = tree.root()
    for (let i = 0; i < 10; i++) {
      const proof = tree.inclusionProof(i)
      const lh = tree.leafHash(i)
      const valid = verifyInclusion(i, tree.size, lh, proof, root)
      expect(valid).toBe(true)
    }
  })

  it('proofs fail with tampered sibling hash', () => {
    const tree = createMerkleTree()
    tree.append(makeEntry(1))
    tree.append(makeEntry(2))
    tree.append(makeEntry(3))
    const root = tree.root()
    const proof = tree.inclusionProof(0)
    // Tamper a sibling hash
    const tampered = proof.map((h: Uint8Array) => {
      const copy = new Uint8Array(h)
      copy[0] ^= 0xff
      return copy
    })
    const lh = tree.leafHash(0)
    expect(verifyInclusion(0, tree.size, lh, tampered, root)).toBe(false)
  })

  it('root changes after appending a new entry', () => {
    const tree = createMerkleTree()
    tree.append(makeEntry(1))
    const root1 = tree.root()
    tree.append(makeEntry(2))
    const root2 = tree.root()
    expect(root1).not.toEqual(root2)
  })

  it('inclusionProof throws for out-of-range index', () => {
    const tree = createMerkleTree()
    tree.append(makeEntry(1))
    expect(() => tree.inclusionProof(1)).toThrow()
    expect(() => tree.inclusionProof(-1)).toThrow()
  })

  it('leafHash throws for out-of-range index', () => {
    const tree = createMerkleTree()
    expect(() => tree.leafHash(0)).toThrow()
  })
})
