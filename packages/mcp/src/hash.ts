// SPDX-License-Identifier: Apache-2.0

/**
 * SHA-256 hashing. Web Crypto API with Node.js crypto fallback.
 */

/**
 * SHA-256 using @noble/hashes for consistent cross-platform behavior.
 */
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data)
}

export function hexEncode(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

export function hexDecode(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('hexDecode: invalid hex string')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}
