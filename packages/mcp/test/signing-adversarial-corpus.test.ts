// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for the §1.4 adversarial signing corpus.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  canonicalSigningInput,
  hexEncode,
  sha256,
  validateSubmission,
  verifyRecord,
  type AtribRecord,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '../../../spec/conformance/1.4/adversarial-vectors.json')

interface AdversarialVector {
  name: string
  description: string
  input: {
    record: Partial<AtribRecord>
  }
  expected: {
    verification_passes: boolean
    submission_validation_passes?: boolean
    canonical_signing_input?: string
    signing_input_sha256_hex?: string
  }
}

interface Corpus {
  vectors: AdversarialVector[]
}

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as Corpus

describe('§1.4 adversarial signing corpus', () => {
  for (const vector of corpus.vectors) {
    it(`${vector.name}: matches expected verification behavior`, async () => {
      const record = vector.input.record as AtribRecord

      if (vector.expected.canonical_signing_input !== undefined) {
        const canonical = new TextDecoder().decode(canonicalSigningInput(record))
        expect(canonical).toBe(vector.expected.canonical_signing_input)
      }

      if (vector.expected.signing_input_sha256_hex !== undefined) {
        const digest = hexEncode(sha256(canonicalSigningInput(record)))
        expect(digest).toBe(vector.expected.signing_input_sha256_hex)
      }

      if (vector.expected.submission_validation_passes !== undefined) {
        expect(validateSubmission(record).ok).toBe(vector.expected.submission_validation_passes)
      }

      expect(await verifyRecord(record)).toBe(vector.expected.verification_passes)
    })
  }
})
