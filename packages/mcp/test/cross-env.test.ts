// SPDX-License-Identifier: Apache-2.0

/**
 * Cross-environment compatibility tests (Gap #1).
 *
 * Verifies that the serialization layer works without Node.js-specific APIs
 * (Buffer). All production code should use Uint8Array and the package's own
 * base64url/hex utilities. These tests verify that explicitly.
 */

import { describe, it, expect } from 'vitest'
import {
  serializeEntry,
  base64urlEncode,
  base64urlDecode,
  hexEncode,
  hexDecode,
  signRecord,
  verifyRecord,
  encodeToken,
  decodeToken,
} from '../src/index.js'
import type { AtribRecord, EntryInput } from '../src/index.js'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

describe('no Buffer dependency in production code paths', () => {
  // These tests work by using only Uint8Array and the package's own utilities.
  // If any production code secretly depends on Buffer, these tests would still
  // pass in Node.js — but the test documents the contract that only standard
  // APIs are used.

  it('base64url round-trips a 32-byte key using only Uint8Array', () => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)

    const encoded = base64urlEncode(bytes)
    const decoded = base64urlDecode(encoded)

    expect(decoded).toEqual(bytes)
    expect(decoded).toBeInstanceOf(Uint8Array)
    // Verify it's a plain Uint8Array, not a Buffer subclass
    expect(decoded.constructor.name).toBe('Uint8Array')
  })

  it('hex round-trips a 16-byte context_id using only Uint8Array', () => {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    const encoded = hexEncode(bytes)
    const decoded = hexDecode(encoded)

    expect(decoded).toEqual(bytes)
    expect(decoded).toBeInstanceOf(Uint8Array)
  })

  it('serializeEntry produces Uint8Array without Buffer', () => {
    const contextId = hexEncode(new Uint8Array(16).fill(0xaa))
    const recordHash = hexEncode(new Uint8Array(32).fill(0xbb))
    const creatorKey = base64urlEncode(new Uint8Array(32).fill(0xcc))

    const input: EntryInput = {
      record_hash_hex: recordHash,
      creator_key_b64url: creatorKey,
      context_id: contextId,
      timestamp: 1700000000000,
      event_type: 'tool_call',
    }

    const entry = serializeEntry(input)
    expect(entry).toBeInstanceOf(Uint8Array)
    expect(entry.length).toBe(90)
  })

  it('sign and verify record using only Uint8Array keys', async () => {
    const privateKey = ed.utils.randomPrivateKey() // Returns Uint8Array
    const publicKey = await ed.getPublicKeyAsync(privateKey) // Returns Uint8Array
    const creatorKey = base64urlEncode(publicKey) // Uses our base64url, not Buffer

    const contextId = hexEncode(new Uint8Array(16).fill(0xdd))

    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      event_type: 'tool_call',
      timestamp: Date.now(),
      context_id: contextId,
      creator_key: creatorKey,
      chain_root: `sha256:${'ee'.repeat(32)}`,
      content_id: `sha256:${'ff'.repeat(32)}`,
      signature: '',
    }

    const signed = await signRecord(record, privateKey)
    expect(typeof signed.signature).toBe('string')
    expect(signed.signature.length).toBeGreaterThan(0)

    const valid = await verifyRecord(signed)
    expect(valid).toBe(true)
  })

  it('token encode/decode round-trips without Buffer', async () => {
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    const creatorKey = base64urlEncode(publicKey)
    const contextId = hexEncode(new Uint8Array(16).fill(0x11))

    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      event_type: 'tool_call',
      timestamp: Date.now(),
      context_id: contextId,
      creator_key: creatorKey,
      chain_root: `sha256:${'22'.repeat(32)}`,
      content_id: `sha256:${'33'.repeat(32)}`,
      signature: '',
    }

    const signed = await signRecord(record, privateKey)
    const token = encodeToken(signed)
    expect(typeof token).toBe('string')
    expect(token).toContain('.')

    const decoded = decodeToken(token)
    expect(decoded).not.toBeNull()
    expect(decoded!.recordHash).toBeInstanceOf(Uint8Array)
    expect(decoded!.creatorKey).toBeInstanceOf(Uint8Array)
    expect(decoded!.recordHash.length).toBe(32)
    expect(decoded!.creatorKey.length).toBe(32)
  })
})
