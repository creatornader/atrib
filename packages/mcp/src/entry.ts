/**
 * Log entry serialization, spec §2.3.1
 *
 * 90-byte binary format:
 *   [0]      version       u8  , always 0x01
 *   [1-32]   record_hash   u8[32], SHA-256 of JCS-canonical record
 *   [33-64]  creator_key   u8[32], raw Ed25519 public key
 *   [65-80]  context_id    u8[16], 16 bytes from 32 hex chars
 *   [81-88]  timestamp_ms  u64 big-endian, Unix milliseconds
 *   [89]     event_type    u8  , 0x01 = tool_call, 0x02 = transaction
 */

import { hexDecode } from './hash.js'

export const ENTRY_VERSION = 0x01 as const
export const EVENT_TYPE_TOOL_CALL = 0x01 as const
export const EVENT_TYPE_TRANSACTION = 0x02 as const

export const ENTRY_SIZE = 90 as const

export interface EntryInput {
  /** SHA-256 hash of the JCS-canonical record, hex-encoded (64 chars) */
  record_hash_hex: string
  /** Raw 32-byte Ed25519 public key, base64url-encoded */
  creator_key_b64url: string
  /** context_id as 32 hex chars (16 bytes) */
  context_id: string
  /** Unix timestamp in milliseconds */
  timestamp: number
  event_type: 'tool_call' | 'transaction'
}

/**
 * Serialize an attribution record into the 90-byte binary log entry format.
 * Pure function, deterministic given identical inputs.
 */
export function serializeEntry(input: EntryInput): Uint8Array {
  const buf = new Uint8Array(ENTRY_SIZE)
  const view = new DataView(buf.buffer)

  // [0] version
  buf[0] = ENTRY_VERSION

  // [1-32] record_hash, decode 64-char hex string to 32 bytes
  const recordHash = hexDecode(input.record_hash_hex)
  if (recordHash.length !== 32) {
    throw new Error(
      `serializeEntry: record_hash_hex must be 64 hex chars, got ${input.record_hash_hex.length}`,
    )
  }
  buf.set(recordHash, 1)

  // [33-64] creator_key, decode base64url to 32 bytes
  const creatorKey = base64urlToBytes(input.creator_key_b64url, 32)
  buf.set(creatorKey, 33)

  // [65-80] context_id, decode 32-char hex string to 16 bytes
  const contextId = hexDecode(input.context_id)
  if (contextId.length !== 16) {
    throw new Error(
      `serializeEntry: context_id must be 32 hex chars, got ${input.context_id.length}`,
    )
  }
  buf.set(contextId, 65)

  // [81-88] timestamp_ms, big-endian u64
  // DataView.setBigUint64 is available in ES2020+ / Node 12+
  view.setBigUint64(81, BigInt(input.timestamp), false /* big-endian */)

  // [89] event_type
  buf[89] = input.event_type === 'tool_call' ? EVENT_TYPE_TOOL_CALL : EVENT_TYPE_TRANSACTION

  return buf
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function base64urlToBytes(b64url: string, expectedBytes: number): Uint8Array {
  // Convert base64url → base64 → Buffer
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = Buffer.from(b64, 'base64')
  if (raw.byteLength !== expectedBytes) {
    throw new Error(`base64urlToBytes: expected ${expectedBytes} bytes, got ${raw.byteLength}`)
  }
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}
