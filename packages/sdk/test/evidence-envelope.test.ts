// SPDX-License-Identifier: Apache-2.0

/**
 * Evidence-envelope activation (D137, spec §5.5.7) against the shared
 * conformance corpus at spec/conformance/evidence-envelope/.
 *
 * Covers: buildEvidenceEnvelope reproducing corpus payload hashes from
 * payload_material via the stated hash rule, validateEvidenceEnvelope
 * accepting the corpus accept-cases and rejecting the reject-cases, the
 * TypeError contract for contradictory input, the peer-missing §5.8
 * degrade path (via the test loader seam), and parity between the SDK's
 * structural helpers (evidenceEnvelopeKey / evidenceTierRank) and the
 * peer's envelopeIdentityKey / tierRank.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { envelopeIdentityKey, tierRank, type EvidenceTier as PeerTier } from '@atrib/verify'
import {
  buildEvidenceEnvelope,
  evidenceEnvelopeKey,
  evidenceTierRank,
  validateEvidenceEnvelope,
  type EvidenceEnvelope,
  type EvidenceTier,
} from '../src/index.js'
import { __setVerifyEnvelopeLoaderForTests } from '../src/evidence-envelope.js'

const CASES = join(__dirname, '../../../spec/conformance/evidence-envelope/cases')

interface EnvelopeCase {
  name: string
  input: {
    envelope: Record<string, unknown>
    payload_material?: unknown
    payload_hash_rule?: 'jcs' | 'raw'
  }
  expected: {
    accept: boolean
    payload_hash?: string
    reject_reasons?: string[]
  }
}

function loadCase(file: string): EnvelopeCase {
  return JSON.parse(readFileSync(join(CASES, file), 'utf8')) as EnvelopeCase
}

afterEach(() => {
  // Restore the real lazy loader after any test that stubbed it.
  __setVerifyEnvelopeLoaderForTests(undefined)
})

describe('buildEvidenceEnvelope against the corpus accept cases', () => {
  for (const file of ['shape--minimal-valid.json', 'shape--maximal-valid.json']) {
    it(`${file}: reproduces payload.hash from payload_material via the stated rule`, async () => {
      const testCase = loadCase(file)
      const corpus = testCase.input.envelope as unknown as EvidenceEnvelope
      const built = await buildEvidenceEnvelope({
        profile: corpus.profile,
        profile_version: corpus.profile_version,
        tier: corpus.tier,
        payload: {
          ...(corpus.payload.media_type !== undefined
            ? { media_type: corpus.payload.media_type }
            : {}),
          ...(corpus.payload.ref !== undefined ? { ref: corpus.payload.ref } : {}),
          ...(corpus.payload.inline !== undefined ? { inline: corpus.payload.inline } : {}),
          material: testCase.input.payload_material,
          ...(testCase.input.payload_hash_rule !== undefined
            ? { hash_rule: testCase.input.payload_hash_rule }
            : {}),
        },
        ...(corpus.facts !== undefined ? { facts: corpus.facts } : {}),
        ...(corpus.result !== undefined ? { result: corpus.result } : {}),
        ...(corpus.verifier !== undefined ? { verifier: corpus.verifier } : {}),
      })
      expect(built.envelope).not.toBeNull()
      expect(built.warnings).toEqual([])
      // The commitment recomputes to the corpus-pinned hash.
      expect(built.envelope?.payload.hash).toBe(testCase.expected.payload_hash)
      // The built envelope reproduces the corpus envelope byte-for-byte at
      // the JSON level (defaults fill exactly what the corpus carries).
      expect(built.envelope).toEqual(corpus)
      expect(testCase.expected.accept).toBe(true)
      const validated = await validateEvidenceEnvelope(built.envelope)
      expect(validated.validation).toEqual({ valid: true, reasons: [] })
    })
  }
})

describe('validateEvidenceEnvelope against the corpus reject cases', () => {
  for (const file of [
    'shape--missing-tier.json',
    'shape--invalid-hash-prefix.json',
    'shape--invalid-tier-value.json',
    'shape--missing-payload-hash.json',
  ]) {
    it(`${file}: fails validation with the pinned reasons`, async () => {
      const testCase = loadCase(file)
      expect(testCase.expected.accept).toBe(false)
      const outcome = await validateEvidenceEnvelope(testCase.input.envelope)
      const validation = outcome.validation as { valid: boolean; reasons: string[] }
      expect(validation.valid).toBe(false)
      for (const reason of testCase.expected.reject_reasons ?? []) {
        expect(validation.reasons).toContain(reason)
      }
    })
  }

  it('a structurally-invalid build RESULT yields envelope null with the reasons in warnings', async () => {
    const built = await buildEvidenceEnvelope({
      profile: 'not-an-https-uri',
      profile_version: '1.0.0',
      tier: 'declared',
      payload: { material: { note: 'x' } },
    })
    expect(built.envelope).toBeNull()
    expect((built.validation as { valid: boolean }).valid).toBe(false)
    expect(built.warnings.some((w) => w.includes('profile_uri'))).toBe(true)
  })
})

describe('buildEvidenceEnvelope input contract (programmer error → TypeError)', () => {
  const base = {
    profile: 'https://atrib.dev/v1/evidence/oauth2',
    profile_version: '1.0.0',
    tier: 'declared' as EvidenceTier,
  }

  it('throws on both hash and material', async () => {
    await expect(
      buildEvidenceEnvelope({
        ...base,
        payload: { hash: `sha256:${'0'.repeat(64)}`, material: {} },
      }),
    ).rejects.toThrow(TypeError)
  })

  it('throws on hash_rule without material', async () => {
    await expect(
      buildEvidenceEnvelope({
        ...base,
        payload: { hash: `sha256:${'0'.repeat(64)}`, hash_rule: 'jcs' },
      }),
    ).rejects.toThrow(TypeError)
  })

  it('throws when neither hash nor material provides a commitment source', async () => {
    await expect(buildEvidenceEnvelope({ ...base, payload: {} })).rejects.toThrow(TypeError)
  })

  it("throws on hash_rule 'raw' with non-string material", async () => {
    await expect(
      buildEvidenceEnvelope({
        ...base,
        payload: { material: { not: 'a string' }, hash_rule: 'raw' },
      }),
    ).rejects.toThrow(TypeError)
  })

  it("supports the 'raw' rule for string material", async () => {
    const built = await buildEvidenceEnvelope({
      ...base,
      payload: { material: 'raw evidence text', hash_rule: 'raw' },
    })
    expect(built.envelope?.payload.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe('peer-missing degrade path (§5.8)', () => {
  it('degrades to envelope/validation null with a warning naming @atrib/verify', async () => {
    __setVerifyEnvelopeLoaderForTests(() => Promise.resolve(null))
    const built = await buildEvidenceEnvelope({
      profile: 'https://atrib.dev/v1/evidence/oauth2',
      profile_version: '1.0.0',
      tier: 'declared',
      payload: { material: { note: 'x' } },
    })
    expect(built.envelope).toBeNull()
    expect(built.validation).toBeNull()
    expect(built.warnings.some((w) => w.includes("'@atrib/verify'"))).toBe(true)

    const validated = await validateEvidenceEnvelope({ envelope: 1 })
    expect(validated.validation).toBeNull()
    expect(validated.warnings.some((w) => w.includes("'@atrib/verify'"))).toBe(true)
  })

  it('contradictory input still throws TypeError before the peer is consulted', async () => {
    __setVerifyEnvelopeLoaderForTests(() => Promise.resolve(null))
    await expect(
      buildEvidenceEnvelope({
        profile: 'https://atrib.dev/v1/evidence/oauth2',
        profile_version: '1.0.0',
        tier: 'declared',
        payload: { hash: `sha256:${'0'.repeat(64)}`, material: {} },
      }),
    ).rejects.toThrow(TypeError)
  })
})

describe('structural helpers agree with the peer implementation', () => {
  const sample: EvidenceEnvelope[] = (['declared', 'shape', 'attested', 'verified'] as const).map(
    (tier, i) => ({
      envelope: 1,
      profile: `https://atrib.dev/v1/evidence/${['oauth2', 'aauth', 'x401', 'ap2-vi'][i]}`,
      profile_version: '1.0.0',
      tier,
      payload: { hash: `sha256:${String(i).repeat(64)}`, ref: { kind: 'withheld' } },
      result: { valid: true, constraints: [], errors: [], warnings: [] },
    }),
  )

  it('evidenceEnvelopeKey equals the peer envelopeIdentityKey on sample envelopes', () => {
    for (const envelope of sample) {
      expect(evidenceEnvelopeKey(envelope)).toBe(
        envelopeIdentityKey(envelope as unknown as Parameters<typeof envelopeIdentityKey>[0]),
      )
    }
  })

  it('evidenceTierRank equals the peer tierRank across the whole ladder', () => {
    for (const tier of ['declared', 'shape', 'attested', 'verified'] as const) {
      expect(evidenceTierRank(tier)).toBe(tierRank(tier as PeerTier))
    }
  })
})
