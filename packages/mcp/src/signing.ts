// SPDX-License-Identifier: Apache-2.0

/**
 * Ed25519 signing and verification for atrib records (§1.4).
 * Uses @noble/ed25519. pure JS, no native deps, audited.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { base64urlEncode, base64urlDecode } from './base64url.js'
import { canonicalCrossAttestationInput, canonicalSigningInput } from './canon.js'
import { isValidEventTypeUri } from './types.js'
import type { AtribRecord, SignerEntry } from './types.js'

// @noble/ed25519 v3 needs sha512 wired via the hashes object
ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (m) => Promise.resolve(sha512(m))

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
 * Sign a transaction record using the §1.7.6 cross-attestation bytes.
 *
 * The returned record carries `signers[]` with this creator's signer entry
 * first, followed by any caller-supplied counterparty entries that already
 * signed the same canonical bytes. AP2 receipt JWTs are not valid inputs here:
 * they prove receipt acceptance, but they do not sign the atrib record bytes.
 */
export async function signTransactionRecord(
  record: AtribRecord,
  privateKey: Uint8Array,
  counterpartySigners: SignerEntry[] = [],
): Promise<AtribRecord> {
  const publicKey = await getPublicKey(privateKey)
  const creatorKey = base64urlEncode(publicKey)
  const transactionRecord = {
    ...record,
    creator_key: creatorKey,
    signature: '',
    signers: [],
  } as AtribRecord
  const signingInput = canonicalCrossAttestationInput(transactionRecord)
  const sigBytes = await ed.signAsync(signingInput, privateKey)
  const signer: SignerEntry = {
    creator_key: creatorKey,
    signature: base64urlEncode(sigBytes),
  }
  const signed = { ...transactionRecord, signers: [signer, ...counterpartySigners] }
  if ('session_token' in signed && signed.session_token !== undefined) {
    return signed
  }
  const { session_token: _, ...rest } = signed as AtribRecord & { session_token?: never }
  return rest as AtribRecord
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

    const isTransaction = record.event_type === 'https://atrib.dev/v1/types/transaction'
    const hasSignersArray = Array.isArray(record.signers) && record.signers.length > 0

    if (isTransaction && hasSignersArray) {
      const creatorSigner = record.signers!.find(
        (entry) => entry.creator_key === record.creator_key,
      )
      if (!creatorSigner) return false
      const sigBytes = base64urlDecode(creatorSigner.signature)
      if (sigBytes.length !== 64) return false
      const verifyInput = canonicalCrossAttestationInput(record)
      const valid = await ed.verifyAsync(sigBytes, verifyInput, pubKeyBytes)
      if (!valid) return false
    } else {
      // Step 2: Decode signature → 64-byte signature
      const sigBytes = base64urlDecode(record.signature)
      if (sigBytes.length !== 64) return false

      // Step 3: Remove signature, apply JCS → verification input bytes
      const verifyInput = canonicalSigningInput(record)

      // Step 4: Verify Ed25519 signature (RFC 8032 §5.1.7)
      const valid = await ed.verifyAsync(sigBytes, verifyInput, pubKeyBytes)
      if (!valid) return false
    }

    // Step 5: spec_version must be "atrib/1.0"
    if (record.spec_version !== 'atrib/1.0') return false

    // Step 6: event_type must be a syntactically-valid absolute URI per spec 1.4.5.
    // Recognition (whether the URI is in atrib normative set) is informational
    // and does NOT gate verification; an extension URI passes this check.
    if (!isValidEventTypeUri(record.event_type)) return false

    // Step 7: timestamp must be a finite number and not >5 min in the future.
    // NaN, Infinity, negative values are all invalid.
    // The log server (§2.6.1 Step 4) uses a wider 10-minute window to
    // account for network/queue delay between signing and log submission.
    if (!Number.isInteger(record.timestamp) || record.timestamp < 0) return false
    const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000
    if (record.timestamp > fiveMinutesFromNow) return false

    // Step 8: context_id must be exactly 32 lowercase hex chars
    if (!/^[0-9a-f]{32}$/.test(record.context_id)) return false

    return true
  } catch {
    return false
  }
}
