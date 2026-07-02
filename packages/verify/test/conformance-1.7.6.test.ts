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
import {
  verifyRecord,
  isTrustedCrossAttested,
  type CrossAttestationAnnotation,
} from '../src/verify-record.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/1.7.6')

interface ConformanceCase {
  name: string
  spec_section: '1.7.6'
  description: string
  input: {
    record: AtribRecord
    signer_seed_hex?: string
    signer_seeds_hex?: Record<string, string>
    trusted_creator_keys?: string[]
  }
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
  // Forward a trust set only when the fixture supplies one. The seven
  // trust-blind cases pass `undefined`, so their cross_attestation stays the
  // pre-trust three-field shape and deep-equals unchanged (backward compat).
  const result = await verifyRecord(fixture.input.record, {
    trustedCreatorKeys: fixture.input.trusted_creator_keys,
  })

  expect(result.cross_attestation).toEqual(fixture.expected.cross_attestation)

  if (fixture.expected.valid_after_signal) {
    // §1.7.6: missing / sybil_suspected cross-attestation is a SIGNAL not
    // invalidation. The underlying signature path keeps the record valid.
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

  it('creator-signer-missing: counterparty signatures do not validate the creator', async () => {
    const fixture = loadCase('creator-signer-missing')
    const result = await verifyRecord(fixture.input.record)

    expect(result.signatureOk).toBe(false)
    expect(result.valid).toBe(false)
    expect(result.warnings).toEqual(['creator signer verification failed'])
    expect(result.cross_attestation).toEqual(fixture.expected.cross_attestation)
  })

  it('duplicate-signer-key: duplicate keys do not satisfy the minimum', async () => {
    await runCase('duplicate-signer-key')
  })

  it('sybil-two-untrusted-signers: signers_valid: 2 but signers_trusted: 0 → sybil_suspected, still valid', async () => {
    await runCase('sybil-two-untrusted-signers')

    const fixture = loadCase('sybil-two-untrusted-signers')
    const result = await verifyRecord(fixture.input.record, {
      trustedCreatorKeys: fixture.input.trusted_creator_keys,
    })
    // The footgun: the trust-blind fields still look "safe".
    expect(result.cross_attestation?.signers_valid).toBe(2)
    expect(result.cross_attestation?.missing).toBe(false)
    // The trust-aware fields catch the Sybil posture.
    expect(result.cross_attestation?.signers_trusted).toBe(0)
    expect(result.cross_attestation?.sybil_suspected).toBe(true)
    // The guarded predicate is the correct gate and rejects the record.
    expect(isTrustedCrossAttested(result.cross_attestation)).toBe(false)
    // Signal not block: the record stays cryptographically valid.
    expect(result.valid).toBe(true)
  })

  it('two-trusted-signers: signers_trusted: 2 → non-malleable authority, isTrustedCrossAttested true', async () => {
    await runCase('two-trusted-signers')

    const fixture = loadCase('two-trusted-signers')
    const result = await verifyRecord(fixture.input.record, {
      trustedCreatorKeys: fixture.input.trusted_creator_keys,
    })
    expect(result.cross_attestation?.signers_trusted).toBe(2)
    expect(result.cross_attestation?.sybil_suspected).toBe(false)
    expect(isTrustedCrossAttested(result.cross_attestation)).toBe(true)
  })

  it('backward compat: no trust set → trust fields omitted, single trusted signer is not attested', async () => {
    // The seven trust-blind cases assert this via toEqual on the three-field
    // shape. Here we additionally guard the footgun the critique flagged: a
    // single trusted signer must NOT read as attested via the guarded gate.
    const fixture = loadCase('one-signer')
    const noTrust = await verifyRecord(fixture.input.record)
    // Loud absence: trust_evaluated is always present so `false` is a visible
    // signal that only the trust-blind count was computed; the trust-relative
    // fields are omitted until a trust set is supplied.
    expect(noTrust.cross_attestation?.trust_evaluated).toBe(false)
    expect(noTrust.cross_attestation).not.toHaveProperty('signers_trusted')
    expect(noTrust.cross_attestation).not.toHaveProperty('sybil_suspected')
    expect(isTrustedCrossAttested(noTrust.cross_attestation)).toBe(false)
    // one-signer has signers_valid 1; even if that key were trusted, it is
    // below the 2-distinct-verified minimum, so the gate must be false.
    const signerKey = fixture.input.record.signers?.[0]?.creator_key
    const oneTrusted = await verifyRecord(fixture.input.record, {
      trustedCreatorKeys: signerKey ? [signerKey] : [],
    })
    expect(oneTrusted.cross_attestation?.signers_trusted).toBe(1)
    expect(oneTrusted.cross_attestation?.sybil_suspected).toBe(false)
    expect(isTrustedCrossAttested(oneTrusted.cross_attestation)).toBe(false)
  })
})
