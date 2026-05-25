// SPDX-License-Identifier: Apache-2.0

import { leafHash as computeLeafHash, nodeHash } from '@atrib/mcp'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { ENTRY_SIZE } from './entry.js'

/**
 * Append-only Merkle tree backed by RFC 6962 functions from @atrib/mcp.
 *
 * Stores raw entry bytes for tile/lookup endpoints and cached subtree hashes
 * for root and proof generation.
 *
 * Leaf hashes and complete power-of-two subtree hashes are cached on append,
 * so root() and inclusionProof() do not recompute the full tree on every
 * submission or checkpoint.
 *
 * PERFORMANCE NOTE: Root computation and proof generation use the cached
 * complete-subtree levels below. This keeps submit/checkpoint latency bounded
 * as the persistent log grows.
 */
export interface MerkleTree {
  /** Append an entry. Returns the 0-based log index assigned to this entry. */
  append(entryBytes: Uint8Array): number
  /** Current number of entries in the tree. */
  readonly size: number
  /** Compute the current Merkle root. Throws if the tree is empty. */
  root(): Uint8Array
  /** Generate an RFC 6962 inclusion proof for the entry at index. */
  inclusionProof(index: number): Uint8Array[]
  /** Return the cached leaf hash (SHA-256(0x00 || entry)) for the entry at index. */
  leafHash(index: number): Uint8Array
  /** Return the raw entry bytes for the entry at index. */
  entryBytes(index: number): Uint8Array
}

/**
 * Factory creates a MerkleTree, optionally restoring state from a persistence
 * file and persisting future appends to it.
 *
 * The persistence format is a single append-only binary file containing the
 * concatenation of every 90-byte log entry in order. On startup the tree
 * reads the file and replays each entry via append(). On every subsequent
 * append the entry bytes are flushed to disk before the function returns,
 * so a successful submit is always durable.
 *
 * Note (durability): appendFileSync uses write(2) but does not call fsync.
 * On a hard kernel/host crash the most-recent entries may not have hit
 * platter. For the dogfood loop and Fly's managed volumes this is fine;
 * production-grade durability would add fs.fsyncSync at the cost of write
 * latency. The CheckpointSigner key is separately durable via Fly secrets.
 */
export interface MerkleTreeOptions {
  /**
   * Path to the append-only entries file. When set, the tree restores from
   * this file on construction (file may not exist yet) and persists every
   * append to it. When unset, the tree is purely in-memory.
   */
  persistencePath?: string
}

export function createMerkleTree(options?: MerkleTreeOptions): MerkleTree {
  // Raw entry bytes. passed to computeRoot / computeInclusionProof.
  const rawEntries: Uint8Array[] = []
  // Complete subtree hashes by level. level 0 is leaf hashes, level 1 is
  // 2-leaf subtrees, level 2 is 4-leaf subtrees, and so on. A level entry is
  // present only when that complete power-of-two block exists.
  const levels: Uint8Array[][] = [[]]

  function appendInMemory(entryBytes: Uint8Array): number {
    const index = rawEntries.length
    rawEntries.push(entryBytes)

    let hash = computeLeafHash(entryBytes)
    let level = 0
    let levelIndex = index

    while (true) {
      const nodes = levels[level] ?? (levels[level] = [])
      nodes[levelIndex] = hash

      if (levelIndex % 2 === 0) break

      const left = nodes[levelIndex - 1]
      if (!left) {
        throw new Error(`MerkleTree.append: missing left sibling at level ${level}, index ${levelIndex - 1}`)
      }
      hash = nodeHash(left, hash)
      level += 1
      levelIndex = Math.floor(levelIndex / 2)
    }

    return index
  }

  const persistPath = options?.persistencePath
  if (persistPath && existsSync(persistPath)) {
    const buf = readFileSync(persistPath)
    if (buf.length % ENTRY_SIZE !== 0) {
      throw new Error(
        `MerkleTree: persistence file ${persistPath} length ${buf.length} is not a multiple of ${ENTRY_SIZE} bytes`,
      )
    }
    for (let off = 0; off < buf.length; off += ENTRY_SIZE) {
      appendInMemory(new Uint8Array(buf.subarray(off, off + ENTRY_SIZE)))
    }
  } else if (persistPath) {
    // Make sure the parent directory exists so the first append doesn't fail.
    mkdirSync(dirname(persistPath), { recursive: true })
  }

  return {
    get size(): number {
      return rawEntries.length
    },

    append(entryBytes: Uint8Array): number {
      const index = rawEntries.length
      appendInMemory(entryBytes)
      // Persist before returning so a successful append always means the
      // entry is on disk. Crash before this line: the entry was never
      // accepted; after this line: the entry will replay on next startup.
      if (persistPath) {
        appendFileSync(persistPath, entryBytes)
      }
      return index
    },

    root(): Uint8Array {
      if (rawEntries.length === 0) {
        throw new Error('MerkleTree.root: tree is empty')
      }
      return rangeRootFromLevels(levels, 0, rawEntries.length)
    },

    inclusionProof(index: number): Uint8Array[] {
      if (rawEntries.length === 0) {
        throw new Error('MerkleTree.inclusionProof: tree is empty')
      }
      if (!Number.isInteger(index) || index < 0 || index >= rawEntries.length) {
        throw new Error(
          `MerkleTree.inclusionProof: index ${index} out of range [0, ${rawEntries.length})`,
        )
      }
      return inclusionProofFromLevels(levels, index, 0, rawEntries.length)
    },

    leafHash(index: number): Uint8Array {
      const leafHashes = levels[0] ?? []
      if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) {
        throw new Error(
          `MerkleTree.leafHash: index ${index} out of range [0, ${leafHashes.length})`,
        )
      }
      return leafHashes[index] as Uint8Array
    },

    entryBytes(index: number): Uint8Array {
      if (!Number.isInteger(index) || index < 0 || index >= rawEntries.length) {
        throw new Error(
          `MerkleTree.entryBytes: index ${index} out of range [0, ${rawEntries.length})`,
        )
      }
      return rawEntries[index] as Uint8Array
    },
  }
}

function largestPowerOfTwoLessThan(n: number): number {
  if (n < 2) {
    throw new Error('largestPowerOfTwoLessThan: n must be >= 2')
  }
  if (n - 1 < 0x80000000) {
    return 1 << (31 - Math.clz32(n - 1))
  }
  return 2 ** Math.floor(Math.log2(n - 1))
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && Number.isInteger(Math.log2(n))
}

function powerLevel(size: number): number {
  return Math.log2(size)
}

function rangeRootFromLevels(levels: Uint8Array[][], start: number, size: number): Uint8Array {
  if (size < 1) {
    throw new Error('MerkleTree.rangeRoot: empty range')
  }
  if (isPowerOfTwo(size)) {
    const level = powerLevel(size)
    const index = start / size
    if (!Number.isInteger(index)) {
      throw new Error(`MerkleTree.rangeRoot: misaligned range start ${start} for size ${size}`)
    }
    const hash = levels[level]?.[index]
    if (!hash) {
      throw new Error(`MerkleTree.rangeRoot: missing subtree at level ${level}, index ${index}`)
    }
    return hash
  }
  const k = largestPowerOfTwoLessThan(size)
  return nodeHash(
    rangeRootFromLevels(levels, start, k),
    rangeRootFromLevels(levels, start + k, size - k),
  )
}

function inclusionProofFromLevels(
  levels: Uint8Array[][],
  index: number,
  start: number,
  size: number,
): Uint8Array[] {
  if (size === 1) return []

  const k = largestPowerOfTwoLessThan(size)
  if (index < k) {
    const proof = inclusionProofFromLevels(levels, index, start, k)
    proof.push(rangeRootFromLevels(levels, start + k, size - k))
    return proof
  }

  const proof = inclusionProofFromLevels(levels, index - k, start + k, size - k)
  proof.push(rangeRootFromLevels(levels, start, k))
  return proof
}
