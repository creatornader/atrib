// SPDX-License-Identifier: Apache-2.0

/**
 * Proof bundle generation for `@atrib/log-dev`.
 *
 * Returns proof bundles whose **shape** matches spec §2.6.2 exactly:
 *   { log_index, checkpoint, inclusion_proof, leaf_hash }
 *
 * The HASHES are NOT real Merkle hashes. They are deterministic placeholders
 * derived from the entry's `recordHash` and `logIndex` so that:
 *
 *   - The shape passes `@atrib/verify`'s structural validation
 *   - The hashes are unique per entry (so cached proofs in
 *     `@atrib/mcp`'s submission queue are correctly keyed)
 *   - The dev log is honest about not being a real Merkle tree:
 *     `@atrib/verify`'s strict cryptographic verification path will
 *     fail for these proofs, which is correct, anyone running
 *     verification against a dev log should fail.
 *
 * If you need a proof that PASSES strict cryptographic verification, you
 * need a real Tessera-backed log. That's the entire reason this package
 * exists as a separate, clearly-marked dev fixture.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import type { ProofBundle } from '@atrib/mcp'
import type { StoredEntry } from './storage.js'

const LOG_ORIGIN = 'log.atrib.dev/v1'

/**
 * Build a proof bundle for a stored entry. The bundle is well-formed per
 * §2.6.2 but its hashes are deterministic placeholders, not real Merkle
 * hashes, see file header.
 */
export function buildProofBundle(entry: StoredEntry, totalSize: number): ProofBundle {
  const leafSeed = new TextEncoder().encode(`${entry.recordHash}:${entry.logIndex}`)
  const leafHash = base64(sha256(leafSeed))

  // Generate three deterministic sibling hashes so the inclusion_proof
  // array has a realistic shape (real proofs typically have a small
  // number of sibling hashes, log2(treeSize), so 3 is reasonable for
  // a small dev log).
  const inclusionProof: string[] = []
  for (let depth = 0; depth < 3; depth++) {
    const siblingSeed = new TextEncoder().encode(`${entry.recordHash}:sibling:${depth}`)
    inclusionProof.push(base64(sha256(siblingSeed)))
  }

  // Checkpoint body per §2.4.1, three lines: origin, tree size, root hash.
  // The root hash is a deterministic placeholder derived from the size.
  const rootHashSeed = new TextEncoder().encode(`${LOG_ORIGIN}:${totalSize}`)
  const rootHashB64 = base64(sha256(rootHashSeed))
  const checkpointBody = `${LOG_ORIGIN}\n${totalSize}\n${rootHashB64}\n`

  // Signed-note checkpoint per §2.4.3. The signature is a placeholder,
  // the dev log does not have a real signing key. A real Tessera log
  // would sign the body with its Ed25519 key.
  const checkpoint = `${checkpointBody}\n— ${LOG_ORIGIN} 00000000+devLogPlaceholderSignature\n`

  return {
    log_index: entry.logIndex,
    checkpoint,
    inclusion_proof: inclusionProof,
    leaf_hash: leafHash,
  }
}

function base64(bytes: Uint8Array): string {
  // Standard base64 with padding (RFC 4648 §4) per spec §2.6.2.
  return Buffer.from(bytes).toString('base64')
}
