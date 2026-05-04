// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for the spec §8.3 conformance corpus
 * (`spec/conformance/8.3/cases/`).
 *
 * Loads each case fixture, runs `verifyRecord` against the embedded record,
 * and asserts the expected `args_commitment_form` / `result_commitment_form`
 * detection per spec §8.3. Conforming third-party verifier implementations
 * SHOULD load the same fixtures and assert the same invariants.
 *
 * Generator: `packages/log-dev/scripts/generate-conformance-8.3.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import { canonicalSigningInput } from '@atrib/mcp'
import { verifyRecord } from '../src/verify-record.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/8.3')

interface ConformanceCase {
  name: string
  spec_section: '8.3'
  description: string
  input: { record: AtribRecord; signer_seed_hex: string }
  expected: {
    canonical_signing_input_utf8: string
    args_salt_in_canonical_form: boolean
    result_salt_in_canonical_form: boolean
    record_hash_hex: string
    verifier_signature_ok: boolean
    validator_should_accept: boolean
    args_commitment_form: 'plain-sha256' | 'salted-sha256'
    result_commitment_form: 'plain-sha256' | 'salted-sha256'
  }
}

function loadCase(name: string): ConformanceCase {
  const path = join(CORPUS_ROOT, 'cases', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('spec §8.3 conformance corpus', () => {
  it('default-posture: no salts → both forms = plain-sha256', async () => {
    const fixture = loadCase('default-posture')
    const result = await verifyRecord(fixture.input.record)

    expect(result.signatureOk).toBe(fixture.expected.verifier_signature_ok)
    expect(result.posture.args_commitment_form).toBe(fixture.expected.args_commitment_form)
    expect(result.posture.result_commitment_form).toBe(fixture.expected.result_commitment_form)

    const signingInput = new TextDecoder().decode(canonicalSigningInput(fixture.input.record))
    expect(signingInput).toBe(fixture.expected.canonical_signing_input_utf8)
    expect(signingInput.includes('"args_salt"')).toBe(fixture.expected.args_salt_in_canonical_form)
    expect(signingInput.includes('"result_salt"')).toBe(fixture.expected.result_salt_in_canonical_form)
  })

  it('args-salted: args_salt only → args = salted-sha256, result = plain-sha256', async () => {
    const fixture = loadCase('args-salted')
    const result = await verifyRecord(fixture.input.record)

    expect(result.signatureOk).toBe(true)
    expect(result.posture.args_commitment_form).toBe('salted-sha256')
    expect(result.posture.result_commitment_form).toBe('plain-sha256')

    const signingInput = new TextDecoder().decode(canonicalSigningInput(fixture.input.record))
    expect(signingInput).toBe(fixture.expected.canonical_signing_input_utf8)
    expect(signingInput.includes('"args_salt"')).toBe(true)
    expect(signingInput.includes('"result_salt"')).toBe(false)
  })

  it('result-salted: result_salt only → args = plain-sha256, result = salted-sha256', async () => {
    const fixture = loadCase('result-salted')
    const result = await verifyRecord(fixture.input.record)

    expect(result.signatureOk).toBe(true)
    expect(result.posture.args_commitment_form).toBe('plain-sha256')
    expect(result.posture.result_commitment_form).toBe('salted-sha256')

    const signingInput = new TextDecoder().decode(canonicalSigningInput(fixture.input.record))
    expect(signingInput.includes('"args_salt"')).toBe(false)
    expect(signingInput.includes('"result_salt"')).toBe(true)
  })

  it('both-salted: both salts → both forms = salted-sha256', async () => {
    const fixture = loadCase('both-salted')
    const result = await verifyRecord(fixture.input.record)

    expect(result.signatureOk).toBe(true)
    expect(result.posture.args_commitment_form).toBe('salted-sha256')
    expect(result.posture.result_commitment_form).toBe('salted-sha256')

    const signingInput = new TextDecoder().decode(canonicalSigningInput(fixture.input.record))
    expect(signingInput.includes('"args_salt"')).toBe(true)
    expect(signingInput.includes('"result_salt"')).toBe(true)
  })
})
