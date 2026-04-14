// SPDX-License-Identifier: Apache-2.0

/**
 * Appendix A test vectors, exact values from the atrib specification.
 *
 * If anyone changes the signing code, canonicalization, or hashing,
 * this test fails. Every expected value below is copied verbatim from
 * Appendix A of atrib-spec.md.
 */

import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

// Ensure sha512Sync is configured for @noble/ed25519 v2
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m))

import {
  base64urlEncode,
  sha256,
  hexEncode,
  hexDecode,
  canonicalSigningInput,
  canonicalRecord,
  getPublicKey,
  signRecord,
  genesisChainRoot,
  chainRoot,
  encodeToken,
  leafHash,
  computeRoot,
  serializeEntry,
} from '../src/index.js'

import type { AtribRecord } from '../src/index.js'

// ---------------------------------------------------------------------------
// Fixed inputs from Appendix A
// ---------------------------------------------------------------------------

const PRIVATE_KEY_HEX =
  '0101010101010101010101010101010101010101010101010101010101010101'
const PRIVATE_KEY = hexDecode(PRIVATE_KEY_HEX)

const PUBLIC_KEY_HEX =
  '8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c'
const PUBLIC_KEY_B64URL = 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w'

const CONTEXT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CONTENT_ID =
  'sha256:0a3666a0710c08aa6d0de92ce72beeb5b93124cce1bf3701c9d6cdeb543cb73e'
const GENESIS_CHAIN_ROOT =
  'sha256:3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547'
const TIMESTAMP = 1700000000000

const SHA256_SIGNING_INPUT =
  '78046879d2a762e9a1a65ab1ef284ca65f77384db8050069eaa2cb5cbf9ca8f1'

const SIGNATURE_B64URL =
  'PrhhwDFrAcDwbfHVzQWG0y58SwGP3FWZdSKyxMeKVSA5EQOZQJYXbqwEZJC1MkFj6W1M0_17o22cGyzKEtSVDg'

const RECORD_HASH_HEX =
  'ab30b97e78ce078da518536f43929429a0eab164cd4d8896548215ccea50faba'

const PROPAGATION_TOKEN =
  'qzC5fnjOB42lGFNvQ5KUKaDqsWTNTYiWVIIVzOpQ-ro.iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w'

const NEXT_CHAIN_ROOT =
  'sha256:ab30b97e78ce078da518536f43929429a0eab164cd4d8896548215ccea50faba'

const ENTRY_HEX =
  '01ab30b97e78ce078da518536f43929429a0eab164cd4d8896548215ccea50faba8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000018bcfe5680001'

const LEAF_HASH_HEX =
  '1f0bd2c5ad2518265eff0e13a65167f1f2ce990bd0de19af8fd8ec285bee03ab'


// ---------------------------------------------------------------------------
// Construct the unsigned record
// ---------------------------------------------------------------------------

function makeUnsignedRecord(): AtribRecord {
  return {
    spec_version: 'atrib/1.0',
    content_id: CONTENT_ID,
    creator_key: PUBLIC_KEY_B64URL,
    chain_root: GENESIS_CHAIN_ROOT,
    event_type: 'tool_call',
    context_id: CONTEXT_ID,
    timestamp: TIMESTAMP,
    signature: '', // placeholder, will be replaced by signRecord
  } as AtribRecord
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Appendix A, test vectors', () => {
  it('derives the correct public key from the private key seed', async () => {
    const pubKey = await getPublicKey(PRIVATE_KEY)
    expect(hexEncode(pubKey)).toBe(PUBLIC_KEY_HEX)
    expect(base64urlEncode(pubKey)).toBe(PUBLIC_KEY_B64URL)
  })

  it('computes the correct genesis chain_root', () => {
    const root = genesisChainRoot(CONTEXT_ID)
    expect(root).toBe(GENESIS_CHAIN_ROOT)
  })

  it('produces the correct SHA-256 of the signing input', () => {
    const record = makeUnsignedRecord()
    const signingInput = canonicalSigningInput(record)
    const digest = sha256(signingInput)
    expect(hexEncode(digest)).toBe(SHA256_SIGNING_INPUT)
  })

  it('produces the correct Ed25519 signature', async () => {
    const record = makeUnsignedRecord()
    const signed = await signRecord(record, PRIVATE_KEY)
    expect(signed.signature).toBe(SIGNATURE_B64URL)
  })

  it('computes the correct record hash (SHA-256 of canonical signed record)', async () => {
    const record = makeUnsignedRecord()
    const signed = await signRecord(record, PRIVATE_KEY)
    const canonical = canonicalRecord(signed)
    const digest = sha256(canonical)
    expect(hexEncode(digest)).toBe(RECORD_HASH_HEX)
  })

  it('encodes the correct propagation token', async () => {
    const record = makeUnsignedRecord()
    const signed = await signRecord(record, PRIVATE_KEY)
    const token = encodeToken(signed)
    expect(token).toBe(PROPAGATION_TOKEN)
  })

  it('computes the correct next chain_root', async () => {
    const record = makeUnsignedRecord()
    const signed = await signRecord(record, PRIVATE_KEY)
    const next = chainRoot(signed)
    expect(next).toBe(NEXT_CHAIN_ROOT)
  })

  it('serializes the correct 90-byte log entry', async () => {
    const record = makeUnsignedRecord()
    const signed = await signRecord(record, PRIVATE_KEY)
    const canonical = canonicalRecord(signed)
    const recordHashHex = hexEncode(sha256(canonical))

    const entry = serializeEntry({
      record_hash_hex: recordHashHex,
      creator_key_b64url: signed.creator_key,
      context_id: signed.context_id,
      timestamp: signed.timestamp,
      event_type: signed.event_type,
    })

    expect(entry.length).toBe(90)
    expect(hexEncode(entry)).toBe(ENTRY_HEX)
  })

  it('computes the correct leaf hash', async () => {
    const entryBytes = hexDecode(ENTRY_HEX)
    const hash = leafHash(entryBytes)
    expect(hexEncode(hash)).toBe(LEAF_HASH_HEX)
  })

  it('single-entry tree root equals leaf hash', () => {
    const entryBytes = hexDecode(ENTRY_HEX)
    const root = computeRoot([entryBytes])
    expect(hexEncode(root)).toBe(LEAF_HASH_HEX)
  })
})
