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

/** Atrib normative event_type URI set (spec 1.2.4). */
export const NORMATIVE_EVENT_TYPE_URIS = new Set([
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_OBSERVATION_URI,
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
