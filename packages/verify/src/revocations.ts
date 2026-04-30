// SPDX-License-Identifier: Apache-2.0

/**
 * Revocation registry per spec §1.9.
 *
 * A "key_revocation" record retires a creator_key at a specific log_index.
 * Records signed by that key with log_index >= R are flagged
 * 'revoked_after_revocation' and MUST NOT contribute to attribution
 * calculations (§4.6). Records with log_index < R retain their state.
 *
 * Why a registry: per-record verification needs to know "was this signer
 * retired before this record was committed?" The answer requires knowing
 * about every key_revocation in the log. Build the registry once over the
 * full log; consult it per record.
 */

import type { VerificationState } from './types.js'

/** Reasons per §1.9.1. */
export type RevocationReason = 'rotation' | 'retirement' | 'compromise'

/** A single key_revocation event extracted from a log entry. */
export interface RevocationEntry {
  /** Base64url Ed25519 pubkey being retired. */
  revoked_key: string
  /** Log index at which the revocation was committed. Records with log_index >= R for revoked_key are post-revocation. */
  log_index: number
  /** Reason per §1.9.1. */
  revocation_reason: RevocationReason
  /** Successor key when revocation_reason='rotation'. */
  successor_key?: string
  /** Emergency-key signer when revocation_reason='compromise' AND signed by an emergency key. */
  emergency_signed_by?: string
}

/**
 * The minimal record shape this module needs. Avoids depending on the
 * full @atrib/mcp record type so callers in graph-node + verify can
 * consume their own decoded forms.
 */
export interface MinimalRecord {
  event_type?: string | null
  event_type_uri?: string | null
  creator_key?: string | null
  log_index?: number | null
  revoked_key?: string
  revocation_reason?: string
  successor_key?: string
  emergency_signed_by?: string
}

const KEY_REVOCATION_URI = 'https://atrib.dev/v1/types/key_revocation'

function isRevocationRecord(r: MinimalRecord): boolean {
  // The record may carry the type as either the short label ('key_revocation'),
  // the canonical URI ('https://atrib.dev/v1/types/key_revocation'), or via
  // a separate event_type_uri field (e.g., when the source surfaces both
  // a short label in event_type and the full URI alongside).
  if (r.event_type === 'key_revocation') return true
  if (r.event_type === KEY_REVOCATION_URI) return true
  if (r.event_type_uri === KEY_REVOCATION_URI) return true
  return false
}

/**
 * Scan a list of records for valid key_revocation entries and return a
 * registry indexed by revoked_key. When the same key is revoked more
 * than once (which the spec doesn't strictly forbid but is unusual),
 * the EARLIEST revocation wins — once retired, a key cannot be
 * un-retired by a later record.
 *
 * Records that look like revocations but lack required fields, or have
 * non-numeric log_index, are skipped silently. Cryptographic validity
 * (signature checks per §1.9.2 signing rules) is the caller's job —
 * this module only registers what the records claim.
 */
export function buildRevocationRegistry(records: MinimalRecord[]): Map<string, RevocationEntry> {
  const registry = new Map<string, RevocationEntry>()
  for (const r of records) {
    if (!isRevocationRecord(r)) continue
    if (typeof r.revoked_key !== 'string' || r.revoked_key.length === 0) continue
    if (typeof r.log_index !== 'number') continue
    const reason = r.revocation_reason
    if (reason !== 'rotation' && reason !== 'retirement' && reason !== 'compromise') continue
    const existing = registry.get(r.revoked_key)
    if (existing && existing.log_index <= r.log_index) continue // earlier revocation wins
    registry.set(r.revoked_key, {
      revoked_key: r.revoked_key,
      log_index: r.log_index,
      revocation_reason: reason,
      ...(r.successor_key ? { successor_key: r.successor_key } : {}),
      ...(r.emergency_signed_by ? { emergency_signed_by: r.emergency_signed_by } : {}),
    })
  }
  return registry
}

/**
 * Apply a revocation registry to a node's verification state. Returns
 * the new state. Per §1.9.3:
 *   - creator_key revoked AND log_index >= revocation log_index
 *     → 'revoked_after_revocation'
 *   - otherwise → unchanged
 *
 * The current state ('signature_valid', 'log_committed', etc.) is
 * preserved for pre-revocation records — those remain valid.
 */
export function applyRevocation(
  node: { creator_key: string | null; log_index: number | null; verification_state: VerificationState },
  registry: Map<string, RevocationEntry>,
): VerificationState {
  if (!node.creator_key) return node.verification_state
  if (node.log_index === null) return node.verification_state
  const entry = registry.get(node.creator_key)
  if (!entry) return node.verification_state
  if (node.log_index < entry.log_index) return node.verification_state
  // The revocation record itself is the one at log_index === entry.log_index;
  // it does NOT flag itself as revoked (it's the act of retirement, not a
  // post-retirement record). Spec §1.9.3 says "log_index >= R" but the
  // implicit reading is "for OTHER records signed by revoked_key" — the
  // revocation record's own state is unaffected. To be safe + spec-aligned,
  // we apply only when this is a strictly post-revocation record.
  if (node.log_index === entry.log_index) return node.verification_state
  return 'revoked_after_revocation'
}
