// SPDX-License-Identifier: Apache-2.0

/**
 * Ed25519 key generation for atrib (§5.6.1).
 *
 * Generates a 32-byte random seed, derives the Ed25519 public key,
 * and outputs both in the ATRIB_PRIVATE_KEY / ATRIB_PUBLIC_KEY format.
 */

import { getPublicKey, base64urlEncode } from '@atrib/mcp'

export async function keygen(): Promise<{ privateKey: string; publicKey: string }> {
  const seed = new Uint8Array(32)
  crypto.getRandomValues(seed)

  const publicKeyBytes = await getPublicKey(seed)

  const privateKey = base64urlEncode(seed)
  const publicKey = base64urlEncode(publicKeyBytes)

  // Zero the seed from memory after encoding (§5.6.3)
  seed.fill(0)

  return { privateKey, publicKey }
}

export function printKeypair(keys: { privateKey: string; publicKey: string }): void {
  console.log(`ATRIB_PRIVATE_KEY=${keys.privateKey}`)
  console.log(`ATRIB_PUBLIC_KEY=${keys.publicKey}`)
}
