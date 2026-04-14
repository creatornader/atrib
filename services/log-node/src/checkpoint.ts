/**
 * Checkpoint generation and Ed25519 signing, spec Section 2.4
 *
 * Implements the C2SP tlog-tiles checkpoint format:
 *   - formatCheckpointBody: produces the 3-line body (origin, size, rootHash)
 *   - parseCheckpointBody: parses a body back into its components
 *   - createCheckpointSigner: produces a CheckpointSigner that signs checkpoint bodies
 *
 * Key ID computation per spec Section 2.4.2:
 *   key_id = SHA-256(key_name || 0x0A || 0x01 || public_key_bytes)[:4]
 *
 * Signed note format per spec Section 2.4.3:
 *   body text here\n
 *   \n
 *  , origin keyIdHex+sigBase64\n
 */

import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'

// NOTE: ed.etc.sha512Sync must be set by the application entry point (index.ts)
// before calling any signing functions. It is NOT set here to avoid split
// initialization responsibility, see @noble/ed25519 docs.

export interface CheckpointSigner {
  /** Sign a checkpoint and return the signed note string. */
  sign(treeSize: number, rootHash: Uint8Array): Promise<string>
  /** The raw 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array
  /** The 4-byte key ID derived from SHA-256(key_name || 0x0A || 0x01 || pubkey)[:4]. */
  readonly keyId: Uint8Array
}

/**
 * Format a checkpoint body per spec Section 2.4.1.
 *
 * Output:
 *   origin\n
 *   treeSize\n
 *   base64(rootHash)\n
 *
 * Uses standard base64 (not base64url) per the C2SP tlog-tiles spec.
 */
export function formatCheckpointBody(
  origin: string,
  treeSize: number,
  rootHash: Uint8Array,
): string {
  const rootBase64 = Buffer.from(rootHash).toString('base64')
  return `${origin}\n${treeSize}\n${rootBase64}\n`
}

/**
 * Parse a checkpoint body back into its components.
 */
export function parseCheckpointBody(body: string): {
  origin: string
  treeSize: number
  rootHash: string
} {
  const lines = body.split('\n')
  // lines: [origin, treeSize, rootHash, ''], trailing newline produces empty last element
  if (lines.length < 3) {
    throw new Error('parseCheckpointBody: body has fewer than 3 lines')
  }
  const origin = lines[0] as string
  const treeSizeStr = lines[1] as string
  const rootHash = lines[2] as string

  if (origin.includes('\r')) {
    throw new Error('parseCheckpointBody: origin contains carriage return')
  }

  // Strict: digits only, no leading zeros (spec says "decimal, no leading zeros")
  if (!/^\d+$/.test(treeSizeStr) || (treeSizeStr.length > 1 && treeSizeStr[0] === '0')) {
    throw new Error(`parseCheckpointBody: invalid tree size "${treeSizeStr}"`)
  }
  const treeSize = Number(treeSizeStr)
  return { origin, treeSize, rootHash }
}

/**
 * Compute the 4-byte key ID per spec Section 2.4.2:
 *   key_id = SHA-256(key_name || 0x0A || 0x01 || public_key_bytes)[:4]
 *
 * Where:
 *   - key_name is the origin string encoded as UTF-8
 *   - 0x0A is a newline byte
 *   - 0x01 is the Ed25519 signature type byte
 */
function computeKeyId(origin: string, publicKey: Uint8Array): Uint8Array {
  const encoder = new TextEncoder()
  const keyNameBytes = encoder.encode(origin)
  const preimage = new Uint8Array(keyNameBytes.length + 1 + 1 + publicKey.length)
  preimage.set(keyNameBytes, 0)
  preimage[keyNameBytes.length] = 0x0a // newline
  preimage[keyNameBytes.length + 1] = 0x01 // Ed25519 type byte
  preimage.set(publicKey, keyNameBytes.length + 2)
  const hash = sha256(preimage)
  return hash.slice(0, 4)
}

/**
 * Create a CheckpointSigner that signs checkpoint bodies with Ed25519.
 *
 * @param privateKey - Raw 32-byte Ed25519 seed
 * @param publicKey  - Raw 32-byte Ed25519 public key
 * @param origin     - The log origin string (e.g. "log.atrib.io/v1")
 */
export function createCheckpointSigner(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  origin: string,
): CheckpointSigner {
  const keyId = computeKeyId(origin, publicKey)
  const keyIdHex = Buffer.from(keyId).toString('hex')

  return {
    get publicKey(): Uint8Array {
      return publicKey
    },

    get keyId(): Uint8Array {
      return keyId
    },

    async sign(treeSize: number, rootHash: Uint8Array): Promise<string> {
      const body = formatCheckpointBody(origin, treeSize, rootHash)
      const bodyBytes = new TextEncoder().encode(body)
      const sigBytes = await ed.signAsync(bodyBytes, privateKey)
      const sigBase64 = Buffer.from(sigBytes).toString('base64')
      // The signed-note format uses em-dash (U+2014), not ASCII hyphen-minus.
      // This follows the Go note.Signature format (golang.org/x/mod/sumdb/note)
      // which is the reference implementation for C2SP signed-notes.
      //
      // Signed note format per spec Section 2.4.3:
      //   body\n\n— origin keyIdHex+sigBase64\n
      return `${body}\n\u2014 ${origin} ${keyIdHex}+${sigBase64}\n`
    },
  }
}
