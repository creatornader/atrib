// SPDX-License-Identifier: Apache-2.0

/**
 * Conformance test against the §1.4 signing test vectors corpus.
 *
 * Consumes spec/conformance/1.4/signing-vectors.json and verifies that
 * this implementation produces identical outputs. If this test fails,
 * either the implementation changed or the corpus is stale.
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  sha256,
  hexEncode,
  hexDecode,
  canonicalSigningInput,
  canonicalRecord,
  signRecord,
  verifyRecord,
  encodeToken,
  chainRoot,
} from '../src/index.js'
import type { AtribRecord } from '../src/index.js'

ed.hashes.sha512 = sha512

interface SigningVector {
  name: string
  input: {
    private_key_seed_hex: string
    record: AtribRecord
  }
  expected: {
    public_key_hex: string
    canonical_signing_input: string
    signing_input_sha256_hex: string
    signature_base64url: string
    record_hash_hex: string
    propagation_token: string
    next_chain_root: string
    verification_passes: boolean
  }
}

describe('§1.4 signing conformance corpus', async () => {
  const corpusPath = join(
    fileURLToPath(import.meta.url),
    '../../../../spec/conformance/1.4/signing-vectors.json',
  )
  const corpus = JSON.parse(await readFile(corpusPath, 'utf-8'))

  for (const vector of corpus.vectors as SigningVector[]) {
    describe(vector.name, () => {
      it('derives correct public key', async () => {
        const seed = hexDecode(vector.input.private_key_seed_hex)
        const pubkey = await ed.getPublicKeyAsync(seed)
        expect(hexEncode(pubkey)).toBe(vector.expected.public_key_hex)
      })

      it('produces correct canonical signing input', () => {
        const input = canonicalSigningInput(vector.input.record)
        const text = new TextDecoder().decode(input)
        expect(text).toBe(vector.expected.canonical_signing_input)
      })

      it('produces correct signing input hash', () => {
        const input = canonicalSigningInput(vector.input.record)
        expect(hexEncode(sha256(input))).toBe(vector.expected.signing_input_sha256_hex)
      })

      it('produces correct signature', async () => {
        const seed = hexDecode(vector.input.private_key_seed_hex)
        const signed = await signRecord(vector.input.record, seed)
        expect(signed.signature).toBe(vector.expected.signature_base64url)
      })

      it('produces correct record hash', async () => {
        const seed = hexDecode(vector.input.private_key_seed_hex)
        const signed = await signRecord(vector.input.record, seed)
        const canonical = canonicalRecord(signed)
        expect(hexEncode(sha256(canonical))).toBe(vector.expected.record_hash_hex)
      })

      it('produces correct propagation token', async () => {
        const seed = hexDecode(vector.input.private_key_seed_hex)
        const signed = await signRecord(vector.input.record, seed)
        expect(encodeToken(signed)).toBe(vector.expected.propagation_token)
      })

      it('produces correct next chain_root', async () => {
        const seed = hexDecode(vector.input.private_key_seed_hex)
        const signed = await signRecord(vector.input.record, seed)
        expect(chainRoot(signed)).toBe(vector.expected.next_chain_root)
      })

      it('verification passes', async () => {
        const seed = hexDecode(vector.input.private_key_seed_hex)
        const signed = await signRecord(vector.input.record, seed)
        expect(await verifyRecord(signed)).toBe(vector.expected.verification_passes)
      })
    })
  }
})
