// SPDX-License-Identifier: Apache-2.0

/**
 * Spec §1.4 conformance: signing and verification (D101).
 *
 * Loads spec/conformance/1.4/signing-vectors.json and
 * spec/conformance/1.4/adversarial-vectors.json and asserts that the
 * @atrib/sdk surface (re-exporting the @atrib/mcp record layer plus the
 * SDK hash helpers) reproduces every expected output bit-for-bit. The
 * corpora are fixtures; any disagreement is an implementation finding,
 * never a corpus edit.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalSigningInput,
  encodeToken,
  eventTypeUriToByte,
  getPublicKey,
  hexDecode,
  hexEncode,
  isNormativeEventTypeUri,
  recordHashHex,
  recordHashRef,
  sha256,
  signRecord,
  validateSubmission,
  verifyRecord,
  type AtribRecord,
} from '../src/index.js'

const CORPUS = join(__dirname, '../../../spec/conformance/1.4')

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
    is_normative_event_type: boolean
    log_entry_byte: string
  }
}

interface AdversarialVector {
  name: string
  description: string
  input: {
    record: AtribRecord
  }
  expected: {
    verification_passes: boolean
    submission_validation_passes?: boolean
    canonical_signing_input?: string
    signing_input_sha256_hex?: string
  }
}

const signingCorpus = JSON.parse(
  readFileSync(join(CORPUS, 'signing-vectors.json'), 'utf8'),
) as { vectors: SigningVector[] }

const adversarialCorpus = JSON.parse(
  readFileSync(join(CORPUS, 'adversarial-vectors.json'), 'utf8'),
) as { generated_at: number; vectors: AdversarialVector[] }

// Pin the clock to the adversarial corpus generation time so the
// future-skew checks in verifyRecord (§1.4.3 step 7, 5 min) and
// validateSubmission (§2.6.1 step 4, 10 min) are time-independent.
// All corpus timestamps are at or before this instant. Only Date is
// faked so async Ed25519 promise resolution is unaffected.
beforeAll(() => {
  vi.useFakeTimers({ now: adversarialCorpus.generated_at, toFake: ['Date'] })
})

afterAll(() => {
  vi.useRealTimers()
})

describe('spec §1.4 conformance: signing vectors', () => {
  for (const vector of signingCorpus.vectors) {
    describe(vector.name, () => {
      const seed = hexDecode(vector.input.private_key_seed_hex)
      const record = vector.input.record
      const expected = vector.expected

      it('derives the expected public key from the seed', async () => {
        const pub = await getPublicKey(seed)
        expect(hexEncode(pub)).toBe(expected.public_key_hex)
      })

      it('produces the exact canonical signing input (JCS, signature removed)', () => {
        const actual = new TextDecoder().decode(canonicalSigningInput(record))
        expect(actual).toBe(expected.canonical_signing_input)
      })

      it('hashes the signing input to the expected SHA-256', () => {
        expect(hexEncode(sha256(canonicalSigningInput(record)))).toBe(
          expected.signing_input_sha256_hex,
        )
      })

      it('signs deterministically to the exact expected signature', async () => {
        const signed = await signRecord({ ...record }, seed)
        expect(signed.signature).toBe(expected.signature_base64url)
      })

      it('computes record_hash, propagation token, and next chain_root over the signed record', async () => {
        const signed = await signRecord({ ...record }, seed)
        // record_hash = SHA-256(JCS(complete record INCLUDING signature))
        expect(recordHashHex(signed)).toBe(expected.record_hash_hex)
        expect(encodeToken(signed)).toBe(expected.propagation_token)
        expect(recordHashRef(signed)).toBe(expected.next_chain_root)
      })

      it('verifies per §1.4.3', async () => {
        const signed = await signRecord({ ...record }, seed)
        expect(await verifyRecord(signed)).toBe(expected.verification_passes)
      })

      it('classifies the event_type against the normative set and §2.3.1 byte map', () => {
        expect(isNormativeEventTypeUri(record.event_type)).toBe(
          expected.is_normative_event_type,
        )
        const expectedByte = Number.parseInt(expected.log_entry_byte, 16)
        expect(eventTypeUriToByte(record.event_type)).toBe(expectedByte)
      })
    })
  }
})

describe('spec §1.4 conformance: adversarial vectors', () => {
  for (const vector of adversarialCorpus.vectors) {
    describe(vector.name, () => {
      const record = vector.input.record
      const expected = vector.expected

      it(`verification_passes === ${expected.verification_passes}`, async () => {
        expect(await verifyRecord(record)).toBe(expected.verification_passes)
      })

      if (expected.submission_validation_passes !== undefined) {
        it(`submission validation (§2.6.1 steps 2-5) === ${expected.submission_validation_passes}`, () => {
          const result = validateSubmission(record)
          expect(result.ok).toBe(expected.submission_validation_passes)
          if (!expected.submission_validation_passes) {
            expect(result.status).toBe(400)
            expect(typeof result.error).toBe('string')
          }
        })
      }

      if (expected.canonical_signing_input !== undefined) {
        it('produces the exact canonical signing input', () => {
          const actual = new TextDecoder().decode(canonicalSigningInput(record))
          expect(actual).toBe(expected.canonical_signing_input)
        })
      }

      if (expected.signing_input_sha256_hex !== undefined) {
        it('hashes the signing input to the expected SHA-256', () => {
          expect(hexEncode(sha256(canonicalSigningInput(record)))).toBe(
            expected.signing_input_sha256_hex,
          )
        })
      }
    })
  }
})
