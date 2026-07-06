// SPDX-License-Identifier: Apache-2.0

/**
 * Unit coverage for the §5.5.7 evidence-envelope library surface
 * (packages/verify/src/evidence-envelope.ts) that the committed conformance
 * corpus does not exercise: input fuzzing for `validateEnvelope`, mapping
 * idempotence / determinism, unknown-profile round-tripping, ordering
 * stability, and the exported constant/registry invariants.
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  ATRIB_PROFILE_BASE,
  ATRIB_PROFILE_REGISTRY,
  ATRIB_PROFILE_URIS,
  EVIDENCE_REF_KINDS,
  EVIDENCE_TIERS,
  FROZEN_LEGACY_PROTOCOLS,
  LEGACY_PROTOCOL_TO_PROFILE,
  assessReproducibility,
  atribProfileUri,
  classifyProfile,
  envelopeFromEvidenceBlock,
  envelopeIdentityKey,
  fromLegacyEvidenceBlock,
  isRelayIdentitySwap,
  isValidEnvelope,
  jcsSha256,
  mapLegacyEvidenceBlock,
  orderEnvelopeInstances,
  rawSha256,
  renderEnvelopeOpaque,
  tierRank,
  validateEnvelope,
  type EvidenceEnvelope,
  type LegacyEvidenceBlock,
} from '../src/evidence-envelope.js'

// A well-formed baseline envelope the fuzzer mutates from.
function baseEnvelope(): EvidenceEnvelope {
  return {
    envelope: 1,
    profile: 'https://atrib.dev/v1/evidence/oauth2',
    profile_version: '1.0.0',
    tier: 'declared',
    payload: {
      hash: 'sha256:' + '0'.repeat(64),
      ref: { kind: 'withheld' },
    },
    result: { valid: true, constraints: [], errors: [], warnings: [] },
  }
}

function legacyBlock(protocol: string, details?: unknown): LegacyEvidenceBlock {
  return {
    protocol,
    valid: true,
    issuer: 'https://as.example',
    subject: 'agent-7',
    scope: ['tools:read'],
    attenuation_ok: true,
    delegation_ok: null,
    constraints: [],
    errors: [],
    warnings: [],
    ...(details !== undefined ? { details } : {}),
  }
}

describe('evidence-envelope: exported constants', () => {
  it('closed enums match the spec §5.5.7 values exactly', () => {
    expect(EVIDENCE_TIERS).toEqual(['declared', 'shape', 'attested', 'verified'])
    expect(EVIDENCE_REF_KINDS).toEqual(['inline', 'mirror', 'archive', 'external', 'withheld'])
    expect(FROZEN_LEGACY_PROTOCOLS).toHaveLength(5)
    expect(Object.keys(LEGACY_PROTOCOL_TO_PROFILE)).toEqual([...FROZEN_LEGACY_PROTOCOLS])
  })

  it('registry has eight entries and every URI is atrib-maintained and https', () => {
    expect(ATRIB_PROFILE_REGISTRY).toHaveLength(8)
    for (const name of ATRIB_PROFILE_REGISTRY) {
      const uri = atribProfileUri(name)
      expect(uri).toBe(ATRIB_PROFILE_URIS[name])
      expect(uri.startsWith(ATRIB_PROFILE_BASE)).toBe(true)
      const c = classifyProfile(uri)
      expect(c.registered).toBe(true)
      expect(c.treat_as).toBe('registered')
    }
  })

  it('tierRank strictly increases along the ladder', () => {
    expect(tierRank('declared')).toBeLessThan(tierRank('shape'))
    expect(tierRank('shape')).toBeLessThan(tierRank('attested'))
    expect(tierRank('attested')).toBeLessThan(tierRank('verified'))
  })
})

describe('evidence-envelope: validateEnvelope fuzzing', () => {
  it('never throws on arbitrary JSON-ish input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const r = validateEnvelope(input)
        expect(typeof r.valid).toBe('boolean')
        expect(Array.isArray(r.reasons)).toBe(true)
        expect(r.valid).toBe(r.reasons.length === 0)
      }),
    )
  })

  it('non-object inputs are rejected with the single `envelope` reason', () => {
    for (const bad of [null, undefined, 1, 'x', true, [], [1, 2]]) {
      const r = validateEnvelope(bad)
      expect(r.valid).toBe(false)
      expect(r.reasons).toEqual(['envelope'])
    }
  })

  it('accepts the well-formed baseline and its type guard agrees', () => {
    const env = baseEnvelope()
    expect(validateEnvelope(env)).toEqual({ valid: true, reasons: [] })
    expect(isValidEnvelope(env)).toBe(true)
  })

  it('a single mutated required field flips exactly the matching reason', () => {
    const cases: Array<[Partial<EvidenceEnvelope> | Record<string, unknown>, string]> = [
      [{ envelope: 2 }, 'envelope_version'],
      [{ profile: 'oauth2' }, 'profile_uri'],
      [{ profile: 'http://atrib.dev/x' }, 'profile_uri'],
      [{ profile_version: '' }, 'profile_version'],
      [{ tier: 'trusted' }, 'tier'],
    ]
    for (const [patch, reason] of cases) {
      const r = validateEnvelope({ ...baseEnvelope(), ...patch })
      expect(r.valid).toBe(false)
      expect(r.reasons).toContain(reason)
    }
  })

  it('payload / ref rules: hash format, record kind, inline coupling, record_hash sibling', () => {
    const badHash = validateEnvelope({
      ...baseEnvelope(),
      payload: { hash: 'sha256:XYZ', ref: { kind: 'withheld' } },
    })
    expect(badHash.reasons).toContain('payload_hash')

    const recordKind = validateEnvelope({
      ...baseEnvelope(),
      payload: { hash: 'sha256:' + '0'.repeat(64), ref: { kind: 'record' } },
    })
    expect(recordKind.reasons).toContain('ref_kind')

    const inlineWrong = validateEnvelope({
      ...baseEnvelope(),
      payload: { hash: 'sha256:' + '0'.repeat(64), ref: { kind: 'mirror' }, inline: { a: 1 } },
    })
    expect(inlineWrong.reasons).toContain('inline_without_inline_kind')

    const recordHashInline = validateEnvelope({
      ...baseEnvelope(),
      payload: {
        hash: 'sha256:' + '0'.repeat(64),
        ref: { kind: 'inline', record_hash: 'sha256:' + '1'.repeat(64) },
        inline: { a: 1 },
      },
    })
    expect(recordHashInline.reasons).toContain('record_hash_with_inline_kind')

    const recordHashFormat = validateEnvelope({
      ...baseEnvelope(),
      payload: {
        hash: 'sha256:' + '0'.repeat(64),
        ref: { kind: 'mirror', record_hash: 'not-a-hash' },
      },
    })
    expect(recordHashFormat.reasons).toContain('record_hash_format')

    // record_hash MAY accompany a non-inline kind when well-formed.
    const okRecordHash = validateEnvelope({
      ...baseEnvelope(),
      payload: {
        hash: 'sha256:' + '0'.repeat(64),
        ref: { kind: 'mirror', record_hash: 'sha256:' + '1'.repeat(64) },
      },
    })
    expect(okRecordHash.valid).toBe(true)
  })

  it('result and verifier structural rules', () => {
    expect(
      validateEnvelope({ ...baseEnvelope(), result: 'nope' as unknown as never }).reasons,
    ).toContain('result')
    expect(
      validateEnvelope({
        ...baseEnvelope(),
        result: { valid: 'yes', constraints: [], errors: [], warnings: [] } as unknown as never,
      }).reasons,
    ).toContain('result_valid')
    expect(
      validateEnvelope({
        ...baseEnvelope(),
        result: {
          valid: true,
          constraints: [{ type: 'x', status: 'maybe' }],
          errors: [],
          warnings: [],
        } as unknown as never,
      }).reasons,
    ).toContain('constraint_status')
    expect(
      validateEnvelope({
        ...baseEnvelope(),
        verifier: { version: '1' } as unknown as never,
      }).reasons,
    ).toContain('verifier')
  })
})

describe('evidence-envelope: classifyProfile', () => {
  it('full-URI identity: foreign domain reusing an atrib name is never registered', () => {
    const c = classifyProfile('https://example.com/v1/evidence/oauth2')
    expect(c.uri_valid).toBe(true)
    expect(c.atrib_maintained).toBe(false)
    expect(c.registered).toBe(false)
    expect(c.treat_as).toBe('unknown-preserve')
  })

  it('atrib-shaped but unregistered trailing name is unknown-preserve', () => {
    const c = classifyProfile(`${ATRIB_PROFILE_BASE}not-a-real-profile`)
    expect(c.atrib_maintained).toBe(true)
    expect(c.registered).toBe(false)
    expect(c.treat_as).toBe('unknown-preserve')
  })

  it('nested path under a registered name is not an exact registration', () => {
    const c = classifyProfile(`${ATRIB_PROFILE_BASE}oauth2/extra`)
    expect(c.registered).toBe(false)
  })

  it('non-https and bare-name URIs are invalid', () => {
    expect(classifyProfile('oauth2').uri_valid).toBe(false)
    // http:// is not https:// — invalid, and never atrib-maintained.
    expect(classifyProfile('http://atrib.dev/v1/evidence/oauth2').uri_valid).toBe(false)
    expect(classifyProfile('http://atrib.dev/v1/evidence/oauth2').atrib_maintained).toBe(false)
  })
})

describe('evidence-envelope: mapLegacyEvidenceBlock', () => {
  it('maps each frozen protocol to its profile URI, tier attested, no verifier', () => {
    for (const legacy of FROZEN_LEGACY_PROTOCOLS) {
      const env = mapLegacyEvidenceBlock(legacyBlock(legacy))
      expect(env.profile).toBe(LEGACY_PROTOCOL_TO_PROFILE[legacy])
      expect(env.tier).toBe('attested')
      expect(env.profile_version).toBe('1.0.0')
      expect('verifier' in env).toBe(false)
      expect(env.payload.ref.kind).toBe('withheld')
      expect(env.payload.media_type).toBe('application/json')
      expect(isValidEnvelope(env)).toBe(true)
    }
  })

  it('is deterministic and idempotent: same block → identical envelope every time', () => {
    const block = legacyBlock('aauth', { token: { alg: 'ES256' }, nested: [1, 2, 3] })
    const a = mapLegacyEvidenceBlock(block)
    const b = mapLegacyEvidenceBlock(block)
    expect(a).toEqual(b)
    // Re-mapping a structurally identical (re-parsed) block reproduces it.
    const reparsed = JSON.parse(JSON.stringify(block)) as LegacyEvidenceBlock
    expect(mapLegacyEvidenceBlock(reparsed)).toEqual(a)
  })

  it('commits details as facts.details_hash and never inlines details', () => {
    const details = { token: { verified: true }, scope: ['a', 'b'] }
    const env = mapLegacyEvidenceBlock(legacyBlock('x401', details))
    expect(env.facts?.['details_hash']).toBe(jcsSha256(details))
    expect(JSON.stringify(env)).not.toContain('"verified":true')
  })

  it('omits details_hash when the block carries no details', () => {
    const env = mapLegacyEvidenceBlock(legacyBlock('oauth2'))
    expect('details_hash' in (env.facts ?? {})).toBe(false)
  })

  it('rejects any non-frozen protocol string without inventing a URI', () => {
    for (const bad of ['delegation', 'oauth', 'ap2', 'atrib_delegation', '']) {
      expect(() => mapLegacyEvidenceBlock(legacyBlock(bad))).toThrow(
        /unknown legacy evidence protocol/,
      )
    }
  })

  it('fromLegacyEvidenceBlock is the same function as mapLegacyEvidenceBlock', () => {
    expect(fromLegacyEvidenceBlock).toBe(mapLegacyEvidenceBlock)
  })

  it('envelopeFromEvidenceBlock accepts a verifier EvidenceVerificationBlock shape', () => {
    const env = envelopeFromEvidenceBlock({
      protocol: 'oauth2',
      valid: false,
      issuer: null,
      subject: null,
      scope: [],
      attenuation_ok: null,
      delegation_ok: null,
      constraints: [],
      errors: ['boom'],
      warnings: [],
    })
    expect(env.result.valid).toBe(false)
    expect(env.result.errors).toEqual(['boom'])
    expect(env.profile).toBe('https://atrib.dev/v1/evidence/oauth2')
  })
})

describe('evidence-envelope: unknown-profile round-trip', () => {
  it('renders opaquely and preservation is byte-identity (JCS hash stable)', () => {
    const env: EvidenceEnvelope = {
      ...baseEnvelope(),
      profile: 'https://evidence.example.org/profiles/warranty-claim',
      profile_version: '2.3.1',
      tier: 'shape',
      payload: {
        hash: rawSha256('warranty-bytes'),
        media_type: 'application/octet-stream',
        ref: { kind: 'external', uri: 'https://evidence.example.org/claims/42' },
      },
      facts: { claim_id: 'WC-42' },
    }
    expect(isValidEnvelope(env)).toBe(true)
    const rendered = renderEnvelopeOpaque(env)
    expect(rendered).toEqual({
      profile: env.profile,
      tier: env.tier,
      payload_hash: env.payload.hash,
    })
    // Preservation must not mutate: JCS hash before/after a pass-through
    // (structured clone) is identical.
    const passthrough = JSON.parse(JSON.stringify(env)) as EvidenceEnvelope
    expect(jcsSha256(passthrough)).toBe(jcsSha256(env))
  })
})

describe('evidence-envelope: tier ordering and relay detection', () => {
  it('orders by tier desc, then checked_at_ms desc, then verifier name asc; input unmutated', () => {
    const mk = (tier: EvidenceEnvelope['tier'], name: string, at?: number): EvidenceEnvelope => ({
      ...baseEnvelope(),
      tier,
      ...(name || at !== undefined
        ? { verifier: { name, ...(at !== undefined ? { checked_at_ms: at } : {}) } }
        : {}),
    })
    const input = [
      mk('declared', 'z'),
      mk('verified', 'b', 100),
      mk('verified', 'a', 100),
      mk('attested', 'c', 500),
      mk('verified', 'd', 900),
    ]
    const snapshot = JSON.stringify(input)
    const ordered = orderEnvelopeInstances(input)
    expect(ordered.map((e) => `${e.tier}:${e.verifier?.name}`)).toEqual([
      'verified:d',
      'verified:a',
      'verified:b',
      'attested:c',
      'declared:z',
    ])
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('identity key is (profile, payload.hash)', () => {
    const env = baseEnvelope()
    expect(envelopeIdentityKey(env)).toBe(`${env.profile} ${env.payload.hash}`)
  })

  it('flags a verifier-only swap and clears a genuinely re-verified instance', () => {
    const original = baseEnvelope() as unknown as Record<string, unknown>
    original['verifier'] = { name: 'gateway', checked_at_ms: 1 }
    const swapped = { ...baseEnvelope(), verifier: { name: 'relay', checked_at_ms: 1 } } as Record<
      string,
      unknown
    >
    expect(isRelayIdentitySwap(original, swapped)).toBe(true)
    const reverified = {
      ...baseEnvelope(),
      tier: 'shape',
      verifier: { name: 'relay', checked_at_ms: 1 },
    } as Record<string, unknown>
    expect(isRelayIdentitySwap(original, reverified)).toBe(false)
  })
})

describe('evidence-envelope: reproducibility', () => {
  it('withheld verified is claimed-not-reproducible; retrievable is reproducible', () => {
    const withheld = { ...baseEnvelope(), tier: 'verified' as const }
    expect(assessReproducibility(withheld)).toEqual({
      reproducible: false,
      report: 'claimed-not-reproducible',
    })
    const mirror: EvidenceEnvelope = {
      ...baseEnvelope(),
      tier: 'verified',
      payload: { hash: 'sha256:' + '0'.repeat(64), ref: { kind: 'mirror' } },
    }
    expect(assessReproducibility(mirror)).toEqual({
      reproducible: true,
      report: 'reproducible',
    })
  })
})
