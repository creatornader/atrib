// SPDX-License-Identifier: Apache-2.0

/**
 * Record-hash and provenance-token helpers (§1.2.3, §1.2.6, §1.5.2).
 *
 * These are compositions of the existing `@atrib/mcp` primitives — no new
 * canonicalization or signing implementation. The record-hash idiom
 * `sha256:<hex(SHA-256(JCS(signed record)))>` is used verbatim across all
 * atrib producers; do not diverge from it.
 */

import {
  base64urlEncode,
  canonicalRecord,
  hexEncode,
  sha256,
  type AtribRecord,
} from '@atrib/mcp'

/**
 * The record hash as bare 64-char lowercase hex (§1.2.3).
 * SHA-256 over the JCS-canonical COMPLETE record, including `signature`.
 */
export function recordHashHex(record: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

/**
 * The record hash in `sha256:<64-hex>` reference form, as used by
 * `chain_root`, `informed_by`, `annotates`, and `revises`.
 */
export function recordHashRef(record: AtribRecord): string {
  return `sha256:${recordHashHex(record)}`
}

/**
 * Derive the §1.2.6 provenance_token for a downstream genesis record from
 * the complete signed upstream record: base64url (no padding) of the first
 * 16 bytes of the upstream record hash. Always 22 characters.
 */
export function deriveProvenanceToken(upstream: AtribRecord): string {
  return base64urlEncode(sha256(canonicalRecord(upstream)).slice(0, 16))
}
