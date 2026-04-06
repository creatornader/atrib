/**
 * Propagation token encoding/decoding (§1.5.2).
 *
 * Token format: base64url(record_hash_bytes) + "." + base64url(creator_key_bytes)
 * Max length: 43 + 1 + 43 = 87 characters
 */

import { base64urlEncode, base64urlDecode } from './base64url.js'
import { sha256 } from './hash.js'
import { canonicalRecord } from './canon.js'
import type { AtribRecord, DecodedToken } from './types.js'

/**
 * Encode a propagation token from a signed record (§1.5.2).
 *
 * record_hash = SHA-256(JCS(signed_record)), raw bytes, no "sha256:" prefix
 * creator_key = raw 32-byte Ed25519 public key decoded from the record
 */
export function encodeToken(record: AtribRecord): string {
  const canonical = canonicalRecord(record)
  const recordHash = sha256(canonical)
  const creatorKeyBytes = base64urlDecode(record.creator_key)
  return `${base64urlEncode(recordHash)}.${base64urlEncode(creatorKeyBytes)}`
}

/**
 * Decode a propagation token into record_hash and creator_key bytes.
 * Returns null if the token is malformed.
 */
export function decodeToken(token: string): DecodedToken | null {
  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return null

  const hashPart = token.substring(0, dotIndex)
  const keyPart = token.substring(dotIndex + 1)

  if (hashPart.length === 0 || keyPart.length === 0) return null

  try {
    const recordHash = base64urlDecode(hashPart)
    const creatorKey = base64urlDecode(keyPart)

    if (recordHash.length !== 32 || creatorKey.length !== 32) return null

    return { recordHash, creatorKey }
  } catch {
    return null
  }
}
