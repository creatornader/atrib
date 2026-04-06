/**
 * Settlement recommendation document signing & verification (§4.7).
 *
 * Uses the same Ed25519 + JCS canonicalization machinery as @atrib/mcp.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import canonicalize from 'canonicalize'
import { base64urlEncode, base64urlDecode } from '@atrib/mcp'
import type { RecommendationDocument } from './types.js'

// @noble/ed25519 v2 requires setting the sha512 sync function (same as @atrib/mcp)
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m))
ed.etc.sha512Async = async (...m) => sha512(ed.etc.concatBytes(...m))

/**
 * Compute the canonical signing input for a recommendation: JCS-canonicalize
 * the document with the `signature` field omitted.
 */
export function recommendationSigningInput(
  doc: Omit<RecommendationDocument, 'signature'> & { signature?: string },
): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { signature: _sig, ...rest } = doc
  const canonical = canonicalize(rest)
  if (!canonical) {
    throw new Error('failed to canonicalize recommendation document')
  }
  return new TextEncoder().encode(canonical)
}

/**
 * Sign a recommendation document with a 32-byte Ed25519 seed.
 * Returns a copy of the document with the `signature` field populated.
 */
export async function signRecommendation(
  doc: Omit<RecommendationDocument, 'signature'>,
  privateKey: Uint8Array,
): Promise<RecommendationDocument> {
  if (privateKey.length !== 32) {
    throw new Error('privateKey must be 32 bytes')
  }
  const message = recommendationSigningInput(doc)
  const sigBytes = await ed.signAsync(message, privateKey)
  return {
    ...doc,
    signature: base64urlEncode(sigBytes),
  }
}

/**
 * Verify the Ed25519 signature on a recommendation document.
 *
 * @param doc, the document with `signature` populated
 * @param publicKey, base64url-encoded 32-byte public key of `calculated_by`
 * @returns true iff the signature is valid
 */
export async function verifyRecommendationSignature(
  doc: RecommendationDocument,
  publicKey: string,
): Promise<boolean> {
  try {
    if (!doc.signature) return false
    const pubBytes = base64urlDecode(publicKey)
    if (pubBytes.length !== 32) return false
    const sigBytes = base64urlDecode(doc.signature)
    if (sigBytes.length !== 64) return false
    const message = recommendationSigningInput(doc)
    return await ed.verifyAsync(sigBytes, message, pubBytes)
  } catch {
    return false
  }
}

/**
 * Compare two distributions for equality within the §4.7.3 tolerance of 1e-9.
 *
 * Returns true iff both have identical keys AND every value matches within
 * the tolerance.
 */
export function distributionsMatch(
  a: Record<string, number>,
  b: Record<string, number>,
  tolerance = 1e-9,
): boolean {
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false
    const av = a[aKeys[i]!]!
    const bv = b[bKeys[i]!]!
    // NaN never matches anything (including itself), calculations producing
    // NaN are bugs and must surface as verification failures.
    if (Number.isNaN(av) || Number.isNaN(bv)) return false
    if (Math.abs(av - bv) > tolerance) return false
  }
  return true
}
