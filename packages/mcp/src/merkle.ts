/**
 * RFC 6962 Certificate Transparency Merkle tree.
 *
 * Implements the Merkle Tree Hash algorithm from RFC 6962 Section 2.1,
 * including leaf hashing, node hashing, root computation, inclusion proof
 * generation, and inclusion proof verification.
 *
 * Domain separation prefixes:
 *   0x00, leaf nodes (prevents second-preimage attacks)
 *   0x01, internal nodes
 */

import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Concatenate multiple Uint8Arrays into one.
 */
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

/**
 * Largest power of 2 strictly less than n.
 * Precondition: n >= 2.
 */
function largestPowerOfTwoLessThan(n: number): number {
  let k = 1
  while (k < n) k <<= 1
  return k >> 1
}

/**
 * Compute the leaf hash for a log entry (RFC 6962 §2.1).
 * leafHash(entry) = SHA-256(0x00 || entry)
 */
export function leafHash(entryBytes: Uint8Array): Uint8Array {
  return sha256(concat(new Uint8Array([0x00]), entryBytes))
}

/**
 * Compute the internal node hash (RFC 6962 §2.1).
 * nodeHash(left, right) = SHA-256(0x01 || left || right)
 */
export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(new Uint8Array([0x01]), left, right))
}

/**
 * Compute the Merkle Tree Hash for a list of leaves (RFC 6962 §2.1).
 *
 * - Empty tree: throws (no root is defined for an empty tree)
 * - Single leaf: returns leafHash(leaves[0])
 * - n > 1: split at k = largestPowerOfTwoLessThan(n),
 *   recursively compute left = MTH(leaves[0..k-1]) and right = MTH(leaves[k..n-1]),
 *   return nodeHash(left, right)
 *
 * The input is raw entry bytes (not pre-hashed leaves).
 */
export function computeRoot(leaves: Uint8Array[]): Uint8Array {
  if (leaves.length === 0) {
    throw new Error('computeRoot: empty tree has no root')
  }
  if (leaves.length === 1) {
    const leaf = leaves[0] as Uint8Array
    return leafHash(leaf)
  }
  const k = largestPowerOfTwoLessThan(leaves.length)
  const left = computeRoot(leaves.slice(0, k))
  const right = computeRoot(leaves.slice(k))
  return nodeHash(left, right)
}

/**
 * Generate an inclusion proof for the leaf at `index` in a tree of `leaves`.
 *
 * The proof is an array of sibling hashes from leaf to root. The verifier
 * re-derives the path using the same tree decomposition and combines each
 * sibling to reconstruct the root.
 *
 * Input is raw entry bytes (not pre-hashed).
 */
export function computeInclusionProof(index: number, leaves: Uint8Array[]): Uint8Array[] {
  if (leaves.length === 0) {
    throw new Error('computeInclusionProof: empty tree')
  }
  if (index < 0 || index >= leaves.length) {
    throw new Error(`computeInclusionProof: index ${index} out of range [0, ${leaves.length})`)
  }
  return _inclusionProof(index, leaves)
}

function _inclusionProof(index: number, leaves: Uint8Array[]): Uint8Array[] {
  if (leaves.length === 1) {
    // Leaf node, no sibling at this level
    return []
  }
  const k = largestPowerOfTwoLessThan(leaves.length)
  if (index < k) {
    // Target is in the left subtree. Recurse left, then append the right subtree root.
    const proof = _inclusionProof(index, leaves.slice(0, k))
    proof.push(computeRoot(leaves.slice(k)))
    return proof
  } else {
    // Target is in the right subtree. Recurse right, then append the left subtree root.
    const proof = _inclusionProof(index - k, leaves.slice(k))
    proof.push(computeRoot(leaves.slice(0, k)))
    return proof
  }
}

/**
 * Verify an inclusion proof (RFC 6962 §2.1.3).
 *
 * @param index       - 0-based leaf index
 * @param treeSize    - total number of leaves in the tree
 * @param leafHashValue - SHA-256(0x00 || entry), i.e. the pre-computed leaf hash
 * @param proof       - array of sibling hashes from leaf to root
 * @param expectedRoot - the known-good Merkle root to verify against
 *
 * Uses constant-time comparison (bitwise OR accumulation) for the final root
 * check to resist timing attacks.
 */
export function verifyInclusion(
  index: number,
  treeSize: number,
  leafHashValue: Uint8Array,
  proof: Uint8Array[],
  expectedRoot: Uint8Array,
): boolean {
  if (treeSize === 0) return false
  if (index < 0 || index >= treeSize) return false
  if (leafHashValue.length !== 32 || expectedRoot.length !== 32) return false

  const computedRoot = _verifyPath(index, treeSize, leafHashValue, proof)
  if (computedRoot === null) return false

  // Constant-time comparison: accumulate XOR differences with bitwise OR
  let diff = 0
  for (let i = 0; i < 32; i++) {
    diff |= (computedRoot[i] as number) ^ (expectedRoot[i] as number)
  }
  return diff === 0
}

/**
 * Walk the proof array, rebuilding the root hash from the leaf.
 *
 * Iterates through the proof elements bottom-up, combining the running hash
 * with each sibling in the correct left/right order based on the RFC 6962
 * tree decomposition at each level.
 *
 * Returns the computed root, or null if the proof length is inconsistent.
 */
function _verifyPath(
  index: number,
  size: number,
  leafHashValue: Uint8Array,
  proof: Uint8Array[],
): Uint8Array | null {
  // Collect (index, size) pairs along the path from ROOT down to the leaf,
  // then reverse so they are in leaf-to-root order matching the proof array.
  const path: Array<{ idx: number; sz: number }> = []
  let idx = index
  let sz = size
  while (sz > 1) {
    path.push({ idx, sz })
    const k = largestPowerOfTwoLessThan(sz)
    if (idx < k) {
      // Going left: shrink size to k, index stays
      sz = k
    } else {
      // Going right: shrink size to sz-k, adjust index
      idx = idx - k
      sz = sz - k
    }
  }

  // path is currently root-to-leaf; proof is leaf-to-root.
  // Reverse path so each path[i] corresponds to proof[i].
  path.reverse()

  // path.length must equal proof.length
  if (path.length !== proof.length) return null

  let current = leafHashValue
  for (let i = 0; i < proof.length; i++) {
    const { idx: pathIdx, sz: pathSz } = path[i] as { idx: number; sz: number }
    const sibling = proof[i] as Uint8Array
    const k = largestPowerOfTwoLessThan(pathSz)
    if (pathIdx < k) {
      // Target is in left subtree, current (left) combines with sibling (right)
      current = nodeHash(current, sibling)
    } else {
      // Target is in right subtree, sibling (left) combines with current (right)
      current = nodeHash(sibling, current)
    }
  }

  return current
}
