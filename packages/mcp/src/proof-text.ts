// SPDX-License-Identifier: Apache-2.0

/**
 * Proof bundle text format (§2.8).
 *
 * Serializes and parses proof bundles in the C2SP tlog-proof format.
 * This format is self-contained and offline-verifiable.
 */

import type { ProofBundle } from './submission.js'

const HEADER = 'c2sp.org/tlog-proof@v1'

/**
 * Serialize a ProofBundle to the C2SP tlog-proof text format (§2.8).
 *
 * Output format:
 *   c2sp.org/tlog-proof@v1
 *   index <log_index>
 *   <inclusion_proof_hash_1>
 *   <inclusion_proof_hash_2>
 *   ...
 *
 *   <checkpoint text>
 */
export function formatProofBundle(bundle: ProofBundle): string {
  const lines: string[] = [
    HEADER,
    `index ${bundle.log_index}`,
    ...bundle.inclusion_proof,
    '',
    bundle.checkpoint,
  ]
  return lines.join('\n')
}

/**
 * Parse a C2SP tlog-proof text format string back into a ProofBundle.
 * Throws on malformed input with a descriptive message.
 */
export function parseProofBundle(text: string): ProofBundle {
  const lines = text.split('\n')

  if (lines.length < 3 || lines[0] !== HEADER) {
    throw new Error('parseProofBundle: expected header "c2sp.org/tlog-proof@v1"')
  }

  const indexLine = lines[1]
  if (!indexLine || !indexLine.startsWith('index ')) {
    throw new Error('parseProofBundle: expected "index <N>" on line 2')
  }
  const indexStr = indexLine.slice(6).trim()
  const logIndex = Number(indexStr)
  if (!Number.isInteger(logIndex) || logIndex < 0) {
    throw new Error(`parseProofBundle: invalid index "${indexStr}"`)
  }

  // Find the empty line that separates proof hashes from the checkpoint
  let emptyLineIdx = -1
  for (let i = 2; i < lines.length; i++) {
    if (lines[i] === '') {
      emptyLineIdx = i
      break
    }
  }
  if (emptyLineIdx === -1) {
    throw new Error('parseProofBundle: missing empty line separator before checkpoint')
  }

  const inclusionProof = lines.slice(2, emptyLineIdx)
  const checkpoint = lines.slice(emptyLineIdx + 1).join('\n')

  if (!checkpoint) {
    throw new Error('parseProofBundle: missing checkpoint after separator')
  }

  return {
    log_index: logIndex,
    checkpoint,
    inclusion_proof: inclusionProof,
    // leaf_hash is not in the tlog-proof text format;
    // recompute from entry bytes if needed.
    leaf_hash: '',
  }
}
