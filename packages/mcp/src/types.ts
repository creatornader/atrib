// SPDX-License-Identifier: Apache-2.0

/**
 * The canonical atrib attribution record (§1.2).
 *
 * session_token is optional and MUST be omitted (not null, not undefined)
 * when absent. its presence changes the JCS canonical form and therefore
 * the signature.
 */
export type AtribRecord = {
  spec_version: 'atrib/1.0'
  content_id: string
  creator_key: string
  chain_root: string
  event_type: string // absolute URI; see spec 1.2.4 and 1.4.5
  context_id: string
  timestamp: number
  signature: string
  /**
   * Optional reference to the record this annotation describes (D058 / spec
   * §1.2.8). Required when event_type is the atrib-normative annotation URI
   * and rejected on any other event_type per validators. Format
   * `sha256:<64-hex>`. JCS-canonical form sorts the field immediately after
   * `chain_root` and before `content_id` (a < c).
   */
  annotates?: string
  /**
   * Optional base64url-encoded random salt (≥16 bytes) revealing the salt used
   * to compute a `salted-sha256` `args_hash` per spec §8.3 (D045 salted-
   * commitment posture). Presence indicates the salted-commitment posture for
   * args; absence indicates the default plain-sha256 (or the hmac-sha256
   * variant which is indistinguishable to non-key-holders). JCS-canonical form
   * sorts the field between `annotates` ("a-n") and `chain_root` ("c") since
   * "a-r" lies between them. Verifiers detect `args_commitment_form` from this
   * field's presence per spec §8.3.
   */
  args_salt?: string
  /**
   * Optional base64url-encoded random salt (≥16 bytes) revealing the salt used
   * to compute a `salted-sha256` `result_hash` per spec §8.3 (D045 salted-
   * commitment posture). Same posture-detection semantics as `args_salt`.
   * JCS-canonical form sorts the field between `provenance_token` ("p") and
   * `revises` ("r-e-v") since "r-e-s" lies between them.
   */
  result_salt?: string
  /**
   * Optional reference to the record this revision supersedes (D059 / spec
   * §1.2.9). Required when event_type is the atrib-normative revision URI
   * and rejected on any other event_type per validators. Format
   * `sha256:<64-hex>`. The current record asserts a position incompatible
   * with the prior one; not a content edit (records are immutable) but a
   * forward-pointing claim that future-self should weight this over the
   * referenced predecessor. JCS-canonical form sorts the field after
   * `provenance_token` and before `session_token` (p < r < s).
   */
  revises?: string
  /**
   * Optional cross-record reference list (D041 / spec §1.2.7). Each entry
   * is the `sha256:<64-hex>` record_hash of a prior record this one was
   * informed by. JCS-canonical form sorts the field lexicographically
   * between `event_type` and `provenance_token`. Verifiers derive
   * INFORMED_BY graph edges from these (§3.2.4).
   */
  informed_by?: string[]
  /**
   * Optional cross-session causal anchor (D044 / spec §1.2.6).
   * 22-char base64url encoding of the first 16 bytes of an upstream record's
   * hash. Genesis-record-only: validators and verifiers MUST reject records
   * carrying this field when they are not the session's genesis record (the
   * record whose chain_root equals genesisChainRoot(context_id)). Middleware
   * (§5.3 / §5.4) SHOULD refuse to sign records that violate this constraint
   * per §5.8 graceful-degradation. JCS-canonical form sorts the field
   * lexicographically after `informed_by` and before `session_token` (i < p < s).
   */
  provenance_token?: string
  /**
   * Optional timing-posture declaration (D045 / spec §8.4).
   * When present, the timestamp value MUST match the declared granularity's
   * trailing-zero pattern (e.g. `'min'` requires `timestamp % 60000 == 0`).
   * Default semantics when absent: 'ms'. JCS-canonical form sorts the field
   * lexicographically immediately after `timestamp` (`timestamp` is a prefix
   * of `timestamp_granularity`, so the shorter string sorts first).
   */
  timestamp_granularity?: 'ms' | 's' | 'min' | 'h' | 'd'
} & ({ session_token: string } | { session_token?: never })

/** An unsigned record. all fields except signature. */
export type UnsignedAtribRecord = Omit<AtribRecord, 'signature'>

/** A decoded propagation token (spec 1.5.2). */
export interface DecodedToken {
  recordHash: Uint8Array // 32 bytes. SHA-256 of the JCS-canonical signed record
  creatorKey: Uint8Array // 32 bytes. Ed25519 public key
}

/**
 * Atrib normative event_type URIs (spec 1.2.4).
 *
 * event_type is an absolute URI, not a closed enum. Atrib publishes a small
 * canonical core vocabulary; consumers MAY mint extension URIs in their own
 * namespaces. See D035 for the URI-typing rationale and D036 for the bar to
 * promote an extension URI to atrib normative status.
 */
export const EVENT_TYPE_TOOL_CALL_URI = 'https://atrib.dev/v1/types/tool_call'
export const EVENT_TYPE_TRANSACTION_URI = 'https://atrib.dev/v1/types/transaction'
export const EVENT_TYPE_OBSERVATION_URI = 'https://atrib.dev/v1/types/observation'
// Promoted by D056 (2026-04-30); emitted by directory operators per spec 6.2.4.
export const EVENT_TYPE_DIRECTORY_ANCHOR_URI = 'https://atrib.dev/v1/types/directory_anchor'
// Promoted by D058 (2026-05-04); recall-fidelity primitive per spec §1.2.8 +
// §3.2.4 step 8. An annotation is a signed commentary record pointing at any
// prior record via the `annotates` field; verifiers derive ANNOTATES graph
// edges from it. Dual of informed_by (forward-pointing rather than backward-
// pointing).
export const EVENT_TYPE_ANNOTATION_URI = 'https://atrib.dev/v1/types/annotation'
// Promoted by D059 (2026-05-04); contradiction-handling primitive per spec
// §1.2.9 + §3.2.4 step 9. A revision is a signed claim that supersedes a
// prior record via the `revises` field; verifiers derive REVISES graph
// edges from it. Distinct from annotation (which weights/comments) and from
// informed_by (which acknowledges sources): revision says "I now hold a
// position incompatible with that prior claim." The prior record stays
// immutable on the log; the revision is a new record that future-self
// should weight as the current position.
export const EVENT_TYPE_REVISION_URI = 'https://atrib.dev/v1/types/revision'

/** Atrib normative event_type URI set (spec 1.2.4). */
export const NORMATIVE_EVENT_TYPE_URIS = new Set([
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
] as const)

/**
 * Validate an event_type URI per spec 1.4.5.
 *
 * Returns true iff the input is a syntactically-valid absolute URI suitable
 * for use as event_type. This does NOT check whether the URI is in atrib
 * normative set; an extension URI in a non-atrib namespace passes this check.
 */
export function isValidEventTypeUri(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > 256) return false
  if (value.includes('#')) return false
  // Absolute URI: scheme ":" hier-part. Scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
  const match = /^([A-Za-z][A-Za-z0-9+\-.]*):(.+)$/.exec(value)
  if (!match) return false
  const scheme = match[1] ?? ''
  const rest = match[2] ?? ''
  if (rest.length === 0) return false
  // For http/https, require non-empty authority (host between // and next /, ?, or end).
  if (scheme === 'http' || scheme === 'https') {
    if (!rest.startsWith('//')) return false
    const afterAuthority = rest.slice(2)
    const hostEnd = afterAuthority.search(/[/?]/)
    const host = hostEnd === -1 ? afterAuthority : afterAuthority.slice(0, hostEnd)
    if (host.length === 0) return false
  }
  return true
}

/** True iff the URI is in atrib normative set. Recognition is informational only. */
export function isNormativeEventTypeUri(uri: string): boolean {
  return (NORMATIVE_EVENT_TYPE_URIS as Set<string>).has(uri)
}
