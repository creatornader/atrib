/**
 * chain_root computation (§1.2.3).
 *
 * Genesis: "sha256:" + hex(SHA-256(UTF-8(context_id)))
 * Chain:   "sha256:" + hex(SHA-256(JCS(signed_parent_record)))
 */

import { sha256, hexEncode } from './hash.js'
import { canonicalRecord } from './canon.js'
import type { AtribRecord } from './types.js'

const encoder = new TextEncoder()

/**
 * Compute the chain_root for a genesis record (§1.2.3).
 * Anchors the chain to the context_id.
 */
export function genesisChainRoot(contextId: string): string {
  const digest = sha256(encoder.encode(contextId))
  return `sha256:${hexEncode(digest)}`
}

/**
 * Compute the chain_root for a non-genesis record.
 * Hash of the parent record's canonical signed form.
 */
export function chainRoot(parentRecord: AtribRecord): string {
  const canonical = canonicalRecord(parentRecord)
  const digest = sha256(canonical)
  return `sha256:${hexEncode(digest)}`
}
