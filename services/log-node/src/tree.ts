// SPDX-License-Identifier: Apache-2.0

import { leafHash as computeLeafHash, computeRoot, computeInclusionProof } from '@atrib/mcp'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { ENTRY_SIZE } from './entry.js'

/**
 * Append-only Merkle tree backed by RFC 6962 functions from @atrib/mcp.
 *
 * Stores raw entry bytes so they can be passed directly to computeRoot and
 * computeInclusionProof. those functions call leafHash() internally, so we
 * must NOT pass pre-hashed values to them (that would double-hash).
 *
 * Leaf hashes are cached on append for O(1) access via leafHash(index).
 *
 * PERFORMANCE NOTE: Root computation and proof generation are O(n) per call,
 * recomputing the entire tree from leaf hashes. This is correct and fast
 * enough for launch scale (<100K entries). For production scale, cache
 * intermediate node hashes and update only the O(log n) path on append.
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
  // Cached leaf hashes. computed once on append, returned via leafHash().
  const leafHashes: Uint8Array[] = []

  const persistPath = options?.persistencePath
  if (persistPath && existsSync(persistPath)) {
    const buf = readFileSync(persistPath)
    if (buf.length % ENTRY_SIZE !== 0) {
      throw new Error(
        `MerkleTree: persistence file ${persistPath} length ${buf.length} is not a multiple of ${ENTRY_SIZE} bytes`,
      )
    }
    for (let off = 0; off < buf.length; off += ENTRY_SIZE) {
      const entry = new Uint8Array(buf.subarray(off, off + ENTRY_SIZE))
      rawEntries.push(entry)
      leafHashes.push(computeLeafHash(entry))
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
      rawEntries.push(entryBytes)
      leafHashes.push(computeLeafHash(entryBytes))
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
      return computeRoot(rawEntries)
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
      return computeInclusionProof(index, rawEntries)
    },

    leafHash(index: number): Uint8Array {
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
