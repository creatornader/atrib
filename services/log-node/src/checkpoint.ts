// SPDX-License-Identifier: Apache-2.0

/**
 * Checkpoint generation and Ed25519 signing. spec Section 2.4
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
 *  . origin keyIdHex+sigBase64\n
 */

import * as ed from '@noble/ed25519'
import { sha256 } from '@noble/hashes/sha2.js'

// NOTE: ed.etc.sha512Sync must be set by the application entry point (index.ts)
// before calling any signing functions. It is NOT set here to avoid split
// initialization responsibility. see @noble/ed25519 docs.

export interface CheckpointSigner {
  /** Sign a checkpoint and return the signed note string. */
  sign(treeSize: number, rootHash: Uint8Array): Promise<string>
  /** The raw 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array
  /** The 4-byte key ID derived from SHA-256(key_name || 0x0A || 0x01 || pubkey)[:4]. */
  readonly keyId: Uint8Array
  /** The log origin string (e.g. "log.atrib.dev/v1"); needed by /v1/pubkey. */
  readonly origin: string
}

/**
 * Parsed C2SP signed-note signature line per spec §2.4.3.
 */
export interface ParsedSignatureLine {
  origin: string
  keyId: Uint8Array
  signature: Uint8Array
}

/**
 * Parse a single signature line from a C2SP signed-note (one line of the
 * post-blank-line signature block):
 *
 *   "— <key_name> <base64(keyHash[4B] || sig[64B])>"
 *
 * Returns null if the line doesn't conform (wrong shape, wrong byte count,
 * or undecodable base64). Used by tests, the live dogfood verifier, and
 * any third-party verifier that wants to parse atrib checkpoints.
 */
export function parseSignatureLine(line: string): ParsedSignatureLine | null {
  // Em-dash U+2014, then space, then key name, then space, then base64 token.
  // Accept ASCII hyphen as a fallback for tooling that strips wide chars.
  const m = line.match(/^[—\-] (\S+) (\S+)\s*$/)
  if (!m) return null
  const origin = m[1] as string
  const sigToken = m[2] as string
  let decoded: Uint8Array
  try {
    decoded = new Uint8Array(Buffer.from(sigToken, 'base64'))
  } catch {
    return null
  }
  if (decoded.length !== 4 + 64) return null
  return {
    origin,
    keyId: decoded.slice(0, 4),
    signature: decoded.slice(4),
  }
}

/**
 * Format a verifier key string per the C2SP signed-note vkey format
 * (c2sp.org/signed-note). Output:
 *
 *   <origin>+<hex(keyId)>+<base64(0x01 || publicKey)>
 *
 * The single 0x01 byte is the Ed25519 signature type, concatenated with
 * the raw 32-byte public key to form a 33-byte payload that's
 * standard-base64-encoded (RFC 4648 §4, with padding). This is what
 * `golang.org/x/mod/sumdb/note.NewVerifier` and other C2SP-conformant
 * tooling parses; it is the canonical "key publication" format and is
 * served at GET /v1/log-pubkey alongside the JSON /v1/pubkey form.
 */
export function formatVkey(
  origin: string,
  keyId: Uint8Array,
  publicKey: Uint8Array,
): string {
  const keyIdHex = Buffer.from(keyId).toString('hex')
  const payload = new Uint8Array(1 + publicKey.length)
  payload[0] = 0x01
  payload.set(publicKey, 1)
  const payloadB64 = Buffer.from(payload).toString('base64')
  return `${origin}+${keyIdHex}+${payloadB64}`
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
  // lines: [origin, treeSize, rootHash, '']. trailing newline produces empty last element
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
 * @param origin     - The log origin string (e.g. "log.atrib.dev/v1")
 */
export function createCheckpointSigner(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  origin: string,
): CheckpointSigner {
  const keyId = computeKeyId(origin, publicKey)

  return {
    get publicKey(): Uint8Array {
      return publicKey
    },

    get keyId(): Uint8Array {
      return keyId
    },

    get origin(): string {
      return origin
    },

    async sign(treeSize: number, rootHash: Uint8Array): Promise<string> {
      const body = formatCheckpointBody(origin, treeSize, rootHash)
      const bodyBytes = new TextEncoder().encode(body)
      const sigBytes = await ed.signAsync(bodyBytes, privateKey)
      // C2SP signed-note canonical encoding: base64(keyHash[4B] || sig[64B]).
      // Per spec §2.4.3 (post-D031). Parsed by golang.org/x/mod/sumdb/note.
      const combined = new Uint8Array(keyId.length + sigBytes.length)
      combined.set(keyId, 0)
      combined.set(sigBytes, keyId.length)
      const sigToken = Buffer.from(combined).toString('base64')
      // The signed-note format uses em-dash (U+2014), not ASCII hyphen-minus.
      // This follows the Go note.Signature format (golang.org/x/mod/sumdb/note)
      // which is the reference implementation for C2SP signed-notes.
      //
      // Signed note format per spec Section 2.4.3:
      //   body\n\n— origin keyIdHex+sigBase64\n
      return `${body}\n\u2014 ${origin} ${sigToken}\n`
    },
  }
}
