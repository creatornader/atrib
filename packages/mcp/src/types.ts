// SPDX-License-Identifier: Apache-2.0

/**
 * The canonical Atrib attribution record (§1.2).
 *
 * session_token is optional and MUST be omitted (not null, not undefined)
 * when absent, its presence changes the JCS canonical form and therefore
 * the signature.
 */
export type AtribRecord = {
  spec_version: 'atrib/1.0'
  content_id: string
  creator_key: string
  chain_root: string
  event_type: 'tool_call' | 'transaction'
  context_id: string
  timestamp: number
  signature: string
} & ({ session_token: string } | { session_token?: never })

/** An unsigned record, all fields except signature. */
export type UnsignedAtribRecord = Omit<AtribRecord, 'signature'>

/** A decoded propagation token (§1.5.2). */
export interface DecodedToken {
  recordHash: Uint8Array // 32 bytes, SHA-256 of the JCS-canonical signed record
  creatorKey: Uint8Array // 32 bytes, Ed25519 public key
}

/** Event types recognized in atrib/1.0 (§1.2.4). */
export const VALID_EVENT_TYPES = new Set(['tool_call', 'transaction'] as const)
