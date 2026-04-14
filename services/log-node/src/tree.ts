import { leafHash as computeLeafHash, computeRoot, computeInclusionProof } from '@atrib/mcp'

/**
 * Append-only Merkle tree backed by RFC 6962 functions from @atrib/mcp.
 *
 * Stores raw entry bytes so they can be passed directly to computeRoot and
 * computeInclusionProof — those functions call leafHash() internally, so we
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
}

/**
 * Factory that creates a fresh, empty MerkleTree.
 */
export function createMerkleTree(): MerkleTree {
  // Raw entry bytes — passed to computeRoot / computeInclusionProof.
  const rawEntries: Uint8Array[] = []
  // Cached leaf hashes — computed once on append, returned via leafHash().
  const leafHashes: Uint8Array[] = []

  return {
    get size(): number {
      return rawEntries.length
    },

    append(entryBytes: Uint8Array): number {
      const index = rawEntries.length
      rawEntries.push(entryBytes)
      leafHashes.push(computeLeafHash(entryBytes))
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
  }
}
