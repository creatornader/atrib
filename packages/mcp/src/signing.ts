/**
 * Ed25519 signing and verification for Atrib records (§1.4).
 * Uses @noble/ed25519 — pure JS, no native deps, audited.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { base64urlEncode, base64urlDecode } from './base64url.js'
import { canonicalSigningInput } from './canon.js'
import { VALID_EVENT_TYPES } from './types.js'
import type { AtribRecord } from './types.js'

// @noble/ed25519 v2 requires setting the sha512 sync function
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))
ed.etc.sha512Async = async (...m) => sha512(ed.etc.concatBytes(...m))

/**
 * Get the Ed25519 public key for a 32-byte private key.
 */
export async function getPublicKey(privateKey: Uint8Array): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(privateKey)
}

/**
 * Sign an attribution record (§1.4.2).
 *
 * Step 1: Construct record with all fields except signature.
 * Step 2: Remove signature, apply JCS → signing input bytes.
 * Step 3: Ed25519 sign (RFC 8032 §5.1.6, Pure EdDSA).
 * Step 4: base64url encode the 64-byte signature.
 */
export async function signRecord(
  record: AtribRecord,
  privateKey: Uint8Array,
): Promise<AtribRecord> {
  const signingInput = canonicalSigningInput(record)
  const sigBytes = await ed.signAsync(signingInput, privateKey)
  const sigEncoded = base64urlEncode(sigBytes)
  if ('session_token' in record && record.session_token !== undefined) {
    return { ...record, signature: sigEncoded }
  }
  const { session_token: _, ...rest } = record as AtribRecord & { session_token?: never }
  return { ...rest, signature: sigEncoded } as AtribRecord
}

/**
 * Verify an attribution record (§1.4.3). All 8 steps.
 * Returns true if and only if all steps pass.
 */
export async function verifyRecord(record: AtribRecord): Promise<boolean> {
  try {
    // Step 1: Decode creator_key → 32-byte public key
    const pubKeyBytes = base64urlDecode(record.creator_key)
    if (pubKeyBytes.length !== 32) return false

    // Step 2: Decode signature → 64-byte signature
    const sigBytes = base64urlDecode(record.signature)
    if (sigBytes.length !== 64) return false

    // Step 3: Remove signature, apply JCS → verification input bytes
    const verifyInput = canonicalSigningInput(record)

    // Step 4: Verify Ed25519 signature (RFC 8032 §5.1.7)
    const valid = await ed.verifyAsync(sigBytes, verifyInput, pubKeyBytes)
    if (!valid) return false

    // Step 5: spec_version must be "atrib/1.0"
    if (record.spec_version !== 'atrib/1.0') return false

    // Step 6: event_type must be known
    if (!VALID_EVENT_TYPES.has(record.event_type)) return false

    // Step 7: timestamp must not be >5 min in the future
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000
    if (record.timestamp > fiveMinutesFromNow) return false

    // Step 8: context_id must be exactly 32 lowercase hex chars
    if (!/^[0-9a-f]{32}$/.test(record.context_id)) return false

    return true
  } catch {
    return false
  }
}
