// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for the spec §1.7.6 conformance corpus
 * (`spec/conformance/1.7.6/cases/`).
 *
 * Loads each case fixture, runs `verifyRecord` against the embedded
 * transaction record, and asserts the expected `cross_attestation`
 * annotation per spec §1.7.6 / D052. Conforming third-party verifier
 * implementations SHOULD load the same fixtures and assert the same
 * invariants.
 *
 * Generator: `packages/log-dev/scripts/generate-conformance-1.7.6.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import { verifyRecord, type CrossAttestationAnnotation } from '../src/verify-record.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.7.6')

interface ConformanceCase {
  name: string
  spec_section: '1.7.6'
  description: string
  input: { record: AtribRecord; signer_seed_hex?: string; signer_seeds_hex?: Record<string, string> }
  expected: {
    record_hash_hex: string
    cross_attestation: CrossAttestationAnnotation
    verifier_signature_ok?: boolean
    validator_should_accept: boolean
    valid_after_signal?: boolean
  }
}

function loadCase(name: string): ConformanceCase {
  const path = join(CORPUS_ROOT, 'cases', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf-8'))
}

async function runCase(name: string): Promise<void> {
  const fixture = loadCase(name)
  const result = await verifyRecord(fixture.input.record)

  expect(result.cross_attestation).toEqual(fixture.expected.cross_attestation)

  if (fixture.expected.valid_after_signal) {
    // §1.7.6: missing cross-attestation is a SIGNAL not invalidation.
    // The legacy single-signer signature path keeps the record valid.
    expect(result.signatureOk).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.valid).toBe(true)
  }
}

describe('spec §1.7.6 conformance corpus', () => {
  it('legacy-single-signer: top-level signature only → signers_count: 0, missing: true', async () => {
    await runCase('legacy-single-signer')
  })

  it('one-signer: signers_count: 1 → still missing (below normative minimum of 2)', async () => {
    await runCase('one-signer')
  })

  it('two-signers-valid: canonical happy path → signers_count: 2, missing: false', async () => {
    await runCase('two-signers-valid')
  })

  it('three-signers: above minimum → signers_count: 3, missing: false', async () => {
    await runCase('three-signers')
  })

  it('tampered-second-signature: signers_count: 2, signers_valid: 1, missing: true', async () => {
    await runCase('tampered-second-signature')
  })
})
