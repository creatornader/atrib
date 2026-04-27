import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { leafHash, verifyInclusion, computeRoot } from '@atrib/mcp'
import { createMerkleTree } from '../src/tree.js'
import { ENTRY_SIZE } from '../src/entry.js'

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

describe('MerkleTree persistence', () => {
  // Fixed 90-byte entries (the wire format for a real log entry).
  function makeRealEntry(seed: number): Uint8Array {
    const bytes = new Uint8Array(ENTRY_SIZE)
    for (let i = 0; i < ENTRY_SIZE; i++) bytes[i] = (seed * 7 + i) & 0xff
    return bytes
  }

  it('persists each append to the entries file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atrib-log-persist-'))
    const path = join(dir, 'entries.bin')
    try {
      const tree = createMerkleTree({ persistencePath: path })
      tree.append(makeRealEntry(1))
      tree.append(makeRealEntry(2))
      tree.append(makeRealEntry(3))

      const buf = readFileSync(path)
      expect(buf.length).toBe(ENTRY_SIZE * 3)
      // First entry's first byte = (1*7 + 0) & 0xff = 7
      expect(buf[0]).toBe(7)
      // Second entry's first byte (offset ENTRY_SIZE) = (2*7 + 0) & 0xff = 14
      expect(buf[ENTRY_SIZE]).toBe(14)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('replays entries from disk on construction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atrib-log-persist-'))
    const path = join(dir, 'entries.bin')
    try {
      // Create a tree with persistence, append three entries
      const t1 = createMerkleTree({ persistencePath: path })
      t1.append(makeRealEntry(1))
      t1.append(makeRealEntry(2))
      t1.append(makeRealEntry(3))
      const root1 = t1.root()
      const proof1 = t1.inclusionProof(0)

      // Create a SECOND tree pointed at the same file (simulating restart)
      const t2 = createMerkleTree({ persistencePath: path })
      expect(t2.size).toBe(3)
      const root2 = t2.root()
      const proof2 = t2.inclusionProof(0)

      // Roots and proofs must be identical: persistence + replay preserves
      // the exact tree state.
      expect(Buffer.from(root2).equals(Buffer.from(root1))).toBe(true)
      expect(proof2.length).toBe(proof1.length)
      for (let i = 0; i < proof1.length; i++) {
        expect(Buffer.from(proof2[i]!).equals(Buffer.from(proof1[i]!))).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates the parent directory if missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atrib-log-persist-'))
    const path = join(dir, 'nested', 'subdir', 'entries.bin')
    try {
      const tree = createMerkleTree({ persistencePath: path })
      tree.append(makeRealEntry(1))
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path).length).toBe(ENTRY_SIZE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a persistence file whose length is not a multiple of ENTRY_SIZE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atrib-log-persist-'))
    const path = join(dir, 'entries.bin')
    try {
      writeFileSync(path, new Uint8Array([1, 2, 3])) // 3 bytes, not 90
      expect(() => createMerkleTree({ persistencePath: path })).toThrow(/multiple of/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
