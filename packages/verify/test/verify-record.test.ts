// SPDX-License-Identifier: Apache-2.0

/**
 * Tests for verifyRecord (single-record verification).
 *
 * Covers:
 *   - signature verification round-trip
 *   - provenance_token surfacing when present + format-validation
 *   - upstream candidate resolution (matching + non-matching)
 *   - records without provenance_token (annotation absent)
 */

import { describe, it, expect } from 'vitest'
import * as ed from '@noble/ed25519'
import {
  base64urlEncode,
  canonicalRecord,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { verifyRecord } from '../src/verify-record.js'
import type { Ap2ViEvidenceBundle } from '../src/ap2-vi-evidence.js'
import autonomousFixture from '../../agent/test/fixtures/ap2/vi_autonomous_success_evidence.json'
import splitAgentFixture from '../../agent/test/fixtures/ap2/vi_autonomous_split_agent_evidence.json'

async function freshKey() {
  const seed = new Uint8Array(32)
  for (let i = 0; i < 32; i++) seed[i] = (i * 7 + 11) & 0xff
  await ed.getPublicKeyAsync(seed)
  return seed
}

async function buildRecord(
  seed: Uint8Array,
  overrides: Partial<AtribRecord & { provenance_token?: string }> = {},
): Promise<AtribRecord> {
  const pubKey = base64urlEncode(await ed.getPublicKeyAsync(seed))
  const base = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + 'a'.repeat(64),
    creator_key: pubKey,
    chain_root: 'sha256:' + 'b'.repeat(64),
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: 'a'.repeat(32),
    timestamp: 1_000_000_000_000,
    signature: '',
  }
  const unsigned = { ...base, ...overrides }
  return signRecord(unsigned as AtribRecord, seed)
}

describe('verifyRecord', () => {
  it('confirms signature on a well-formed record', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.signatureOk).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.provenance).toBeUndefined()
  })

  it('flags signature failure when bytes are tampered', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)
    // Tamper a non-signature field: changes JCS-canonical bytes, breaks sig.
    const tampered = { ...record, context_id: 'f'.repeat(32) } as AtribRecord

    const result = await verifyRecord(tampered)

    expect(result.signatureOk).toBe(false)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.includes('signature'))).toBe(true)
  })

  it('surfaces provenance annotation when provenance_token is present', async () => {
    const seed = await freshKey()
    const provenanceToken = 'AAAAAAAAAAAAAAAAAAAAAA' // 22-char base64url
    const record = await buildRecord(seed, { provenance_token: provenanceToken })

    const result = await verifyRecord(record)

    expect(result.signatureOk).toBe(true)
    expect(result.provenance).toBeDefined()
    expect(result.provenance!.token).toBe(provenanceToken)
    expect(result.provenance!.upstream_record_hash).toBeNull()
    expect(result.provenance!.upstream_resolved).toBe(false)
  })

  it('warns on malformed provenance_token format', async () => {
    const seed = await freshKey()
    // 21 chars instead of 22: invalid base64url length for a 16-byte payload.
    const record = await buildRecord(seed, { provenance_token: 'AAAAAAAAAAAAAAAAAAAAA' })

    const result = await verifyRecord(record)

    expect(result.warnings.some((w) => w.includes('provenance_token has invalid format'))).toBe(
      true,
    )
    expect(result.provenance).toBeUndefined()
    expect(result.valid).toBe(false)
  })

  it('resolves provenance against a matching upstream candidate', async () => {
    // Build the upstream record first; derive its provenance_token from its
    // canonical hash, then build a downstream record that carries it.
    const upstreamSeed = await freshKey()
    const upstream = await buildRecord(upstreamSeed, { context_id: '1'.repeat(32) })
    const upstreamHashBytes = sha256(canonicalRecord(upstream))
    const upstreamFullHash = `sha256:${hexEncode(upstreamHashBytes)}`
    const provenanceToken = base64urlEncode(upstreamHashBytes.slice(0, 16))

    const downstreamSeed = await freshKey()
    const downstream = await buildRecord(downstreamSeed, {
      context_id: '2'.repeat(32),
      provenance_token: provenanceToken,
    })

    const result = await verifyRecord(downstream, { upstreamCandidate: upstream })

    expect(result.provenance).toBeDefined()
    expect(result.provenance!.token).toBe(provenanceToken)
    expect(result.provenance!.upstream_resolved).toBe(true)
    expect(result.provenance!.upstream_record_hash).toBe(upstreamFullHash)
  })

  it('does not resolve provenance against a mismatched upstream candidate', async () => {
    const seed = await freshKey()
    // Unrelated upstream; its hash[:16] won't match this token.
    const unrelatedUpstream = await buildRecord(seed, { context_id: '7'.repeat(32) })
    const downstream = await buildRecord(seed, {
      context_id: '8'.repeat(32),
      provenance_token: 'BBBBBBBBBBBBBBBBBBBBBB',
    })

    const result = await verifyRecord(downstream, { upstreamCandidate: unrelatedUpstream })

    expect(result.provenance).toBeDefined()
    expect(result.provenance!.upstream_resolved).toBe(false)
    expect(result.provenance!.upstream_record_hash).toBeNull()
  })
})

describe('verifyRecord, informed_by_resolution', () => {
  it('omits the annotation when informed_by is absent', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.informed_by_resolution).toBeUndefined()
  })

  it('omits the annotation when informed_by is present but empty', async () => {
    // Empty array shouldn't reach the canonical record per §1.2.5 (informed_by
    // is omitted when empty), but defensively confirm the verifier handles it.
    // signRecord canonicalizes, if the signer omitted informed_by per spec,
    // the record won't have it; explicitly omit here.
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.informed_by_resolution).toBeUndefined()
  })

  it('classifies all entries as dangling when no candidates supplied', async () => {
    const seed = await freshKey()
    const refs = ['sha256:' + 'd'.repeat(64), 'sha256:' + 'e'.repeat(64)]
    const record = await buildRecord(seed, { informed_by: refs.slice().sort() })

    const result = await verifyRecord(record)

    expect(result.informed_by_resolution).toBeDefined()
    expect(result.informed_by_resolution!.dangling.sort()).toEqual(refs.slice().sort())
    expect(result.informed_by_resolution!.resolved).toEqual([])
    // Dangling references are informational, not invalidating.
    expect(result.signatureOk).toBe(true)
  })

  it('classifies entries as resolved when a matching candidate is supplied', async () => {
    // Build the upstream first; compute its full record_hash to use as the
    // informed_by reference on the downstream record.
    const upstreamSeed = await freshKey()
    const upstream = await buildRecord(upstreamSeed, { context_id: '1'.repeat(32) })
    const upstreamHash = `sha256:${hexEncode(sha256(canonicalRecord(upstream)))}`

    const downstreamSeed = await freshKey()
    const downstream = await buildRecord(downstreamSeed, {
      context_id: '2'.repeat(32),
      informed_by: [upstreamHash],
    })

    const result = await verifyRecord(downstream, { informedByCandidates: [upstream] })

    expect(result.informed_by_resolution!.resolved).toEqual([upstreamHash])
    expect(result.informed_by_resolution!.dangling).toEqual([])
  })

  it('mixes resolved + dangling when only some candidates match', async () => {
    const upstreamSeed = await freshKey()
    const upstream = await buildRecord(upstreamSeed, { context_id: '3'.repeat(32) })
    const upstreamHash = `sha256:${hexEncode(sha256(canonicalRecord(upstream)))}`
    const fakeRef = 'sha256:' + 'f'.repeat(64) // no candidate supplied for this

    const downstreamSeed = await freshKey()
    const downstream = await buildRecord(downstreamSeed, {
      context_id: '4'.repeat(32),
      informed_by: [fakeRef, upstreamHash].sort(), // canonical sort per §1.2.5
    })

    const result = await verifyRecord(downstream, { informedByCandidates: [upstream] })

    expect(result.informed_by_resolution!.resolved).toEqual([upstreamHash])
    expect(result.informed_by_resolution!.dangling).toEqual([fakeRef])
  })
})

describe('verifyRecord, posture (timestamp_granularity)', () => {
  it('defaults to ms granularity when the field is absent', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.posture.timestamp_granularity).toBe('ms')
    expect(result.posture.timestamp_granularity_explicit).toBe(false)
    expect(result.posture.timestamp_consistent).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('flags as explicit when the field is set', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      // 16_666_666 minutes since epoch in ms, exactly minute-aligned
      // (16_666_666 * 60_000 = 999_999_960_000).
      timestamp: 999_999_960_000,
      timestamp_granularity: 'min',
    })

    const result = await verifyRecord(record)

    expect(result.posture.timestamp_granularity).toBe('min')
    expect(result.posture.timestamp_granularity_explicit).toBe(true)
    expect(result.posture.timestamp_consistent).toBe(true)
  })

  it('warns when the timestamp does not match the declared granularity', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      timestamp: 1_000_000_000_123, // not minute-aligned
      timestamp_granularity: 'min',
    })

    const result = await verifyRecord(record)

    expect(result.posture.timestamp_granularity).toBe('min')
    expect(result.posture.timestamp_consistent).toBe(false)
    expect(result.warnings.some((w) => w.includes('timestamp_granularity'))).toBe(true)
    expect(result.valid).toBe(false) // any warning fails the valid bit
  })

  it('handles each granularity correctly', async () => {
    // Pick a timestamp aligned to the day boundary so all five granularities
    // pass the modulus check.
    const dayAligned = 1_000_000 * 86_400_000 // 1M days since epoch ms
    const seed = await freshKey()
    for (const g of ['ms', 's', 'min', 'h', 'd'] as const) {
      const record = await buildRecord(seed, { timestamp: dayAligned, timestamp_granularity: g })
      const result = await verifyRecord(record)
      expect(result.posture.timestamp_granularity).toBe(g)
      expect(result.posture.timestamp_consistent).toBe(true)
    }
  })
})

describe('verifyRecord, posture (args/result commitment form, §8.3)', () => {
  it('defaults to plain-sha256 for both args and result when no salts present', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.posture.args_commitment_form).toBe('plain-sha256')
    expect(result.posture.result_commitment_form).toBe('plain-sha256')
  })

  it('detects salted-sha256 for args when args_salt is present', async () => {
    const seed = await freshKey()
    // 16-byte salt encoded base64url (no padding) = 22 chars.
    const record = await buildRecord(seed, { args_salt: 'AAAAAAAAAAAAAAAAAAAAAA' })

    const result = await verifyRecord(record)

    expect(result.posture.args_commitment_form).toBe('salted-sha256')
    expect(result.posture.result_commitment_form).toBe('plain-sha256')
    // signature still verifies, salt is included in canonical form
    expect(result.signatureOk).toBe(true)
    expect(result.valid).toBe(true)
  })

  it('detects salted-sha256 for result when result_salt is present', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, { result_salt: 'BBBBBBBBBBBBBBBBBBBBBB' })

    const result = await verifyRecord(record)

    expect(result.posture.args_commitment_form).toBe('plain-sha256')
    expect(result.posture.result_commitment_form).toBe('salted-sha256')
    expect(result.signatureOk).toBe(true)
  })

  it('detects salted-sha256 independently for both args and result', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      args_salt: 'AAAAAAAAAAAAAAAAAAAAAA',
      result_salt: 'BBBBBBBBBBBBBBBBBBBBBB',
    })

    const result = await verifyRecord(record)

    expect(result.posture.args_commitment_form).toBe('salted-sha256')
    expect(result.posture.result_commitment_form).toBe('salted-sha256')
    expect(result.signatureOk).toBe(true)
  })

  it('preserves the timestamp posture fields alongside commitment form', async () => {
    // Verify the full PostureAnnotation shape co-populates correctly.
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      timestamp: 1_000_000 * 86_400_000,
      timestamp_granularity: 'd',
      args_salt: 'CCCCCCCCCCCCCCCCCCCCCC',
    })

    const result = await verifyRecord(record)

    expect(result.posture).toEqual({
      timestamp_granularity: 'd',
      timestamp_consistent: true,
      timestamp_granularity_explicit: true,
      args_commitment_form: 'salted-sha256',
      result_commitment_form: 'plain-sha256',
      tool_name_form: null,
    })
  })
})

describe('verifyRecord, posture (tool_name_form, §8.2 / D061)', () => {
  it('reports tool_name_form: null when the field is absent', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.posture.tool_name_form).toBeNull()
  })

  it('detects tool_name_form: "plain" for a verbatim-style tool name', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, { tool_name: 'book_flight' })

    const result = await verifyRecord(record)

    expect(result.posture.tool_name_form).toBe('plain')
    expect(result.signatureOk).toBe(true)
  })

  it('detects tool_name_form: "plain" for an opaque-label-style name (not distinguishable from verbatim)', async () => {
    // Per D061: verbatim and opaque are NOT structurally distinguishable.
    // `tool_a7f3` looks opaque but matches the same regex as `book_flight`.
    const seed = await freshKey()
    const record = await buildRecord(seed, { tool_name: 'tool_a7f3' })

    const result = await verifyRecord(record)

    expect(result.posture.tool_name_form).toBe('plain')
  })

  it('detects tool_name_form: "hashed" for a sha256:<hex> value', async () => {
    const seed = await freshKey()
    const hashedName = 'sha256:' + 'a'.repeat(64)
    const record = await buildRecord(seed, { tool_name: hashedName })

    const result = await verifyRecord(record)

    expect(result.posture.tool_name_form).toBe('hashed')
    expect(result.signatureOk).toBe(true)
  })

  it('treats sha256: with wrong hex length as plain (not hashed)', async () => {
    // 63 chars instead of 64: not the canonical hashed form.
    const seed = await freshKey()
    const malformed = 'sha256:' + 'a'.repeat(63)
    const record = await buildRecord(seed, { tool_name: malformed })

    const result = await verifyRecord(record)

    expect(result.posture.tool_name_form).toBe('plain')
  })
})

describe('verifyRecord, cross_attestation (D052 / §1.7.6)', () => {
  // Build a transaction-shape record and sign with N independent seeds,
  // each entry covering the cross-attestation canonical bytes.
  async function buildTransaction(
    signerSeeds: Uint8Array[],
    overrides: Partial<AtribRecord> = {},
  ): Promise<AtribRecord> {
    const { canonicalCrossAttestationInput } = await import('@atrib/mcp')
    const firstSeed = signerSeeds[0]!
    const firstPub = base64urlEncode(await ed.getPublicKeyAsync(firstSeed))
    // Build the unsigned record skeleton with empty signers placeholder.
    const skeleton: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + 'd'.repeat(64),
      creator_key: firstPub,
      chain_root: 'sha256:' + 'e'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/transaction',
      context_id: 'b'.repeat(32),
      timestamp: 1_000_000_000_000,
      signature: '',
      signers: [],
      ...overrides,
    } as AtribRecord
    const canonicalBytes = canonicalCrossAttestationInput(skeleton)
    const signers = []
    for (const seed of signerSeeds) {
      const pub = base64urlEncode(await ed.getPublicKeyAsync(seed))
      const sig = base64urlEncode(await ed.signAsync(canonicalBytes, seed))
      signers.push({ creator_key: pub, signature: sig })
    }
    return { ...skeleton, signers } as AtribRecord
  }

  function altSeed(byte: number): Uint8Array {
    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) seed[i] = (byte + i) & 0xff
    return seed
  }

  it('omits the annotation on non-transaction records', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed) // observation
    const result = await verifyRecord(record)
    expect(result.cross_attestation).toBeUndefined()
  })

  it('flags missing on a transaction record with no signers[] array', async () => {
    // Legacy single-signer transaction (top-level signature only, no
    // signers array). signers_count = 0, missing = true.
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })
    const result = await verifyRecord(record)
    expect(result.cross_attestation).toEqual({
      signers_count: 0,
      signers_valid: 0,
      missing: true,
    })
    // Legacy single-sig keeps the record cryptographically valid.
    expect(result.signatureOk).toBe(true)
  })

  it('flags missing when only one signer is present (below normative minimum of 2)', async () => {
    const record = await buildTransaction([altSeed(0x10)])
    const result = await verifyRecord(record)
    expect(result.cross_attestation!.signers_count).toBe(1)
    expect(result.cross_attestation!.signers_valid).toBe(1)
    expect(result.cross_attestation!.missing).toBe(true)
  })

  it('passes when 2 signers verify (atrib normative minimum met)', async () => {
    const record = await buildTransaction([altSeed(0x10), altSeed(0x20)])
    const result = await verifyRecord(record)
    expect(result.cross_attestation!.signers_count).toBe(2)
    expect(result.cross_attestation!.signers_valid).toBe(2)
    expect(result.cross_attestation!.missing).toBe(false)
  })

  it('handles 3+ signers correctly', async () => {
    const record = await buildTransaction([altSeed(0x10), altSeed(0x20), altSeed(0x30)])
    const result = await verifyRecord(record)
    expect(result.cross_attestation!.signers_count).toBe(3)
    expect(result.cross_attestation!.signers_valid).toBe(3)
    expect(result.cross_attestation!.missing).toBe(false)
  })

  it('counts only valid signers when one signature is tampered', async () => {
    const record = await buildTransaction([altSeed(0x10), altSeed(0x20)])
    // Tamper the second signer's signature: flip a character.
    const tampered = {
      ...record,
      signers: [
        record.signers![0]!,
        { ...record.signers![1]!, signature: 'A' + record.signers![1]!.signature.slice(1) },
      ],
    } as AtribRecord
    const result = await verifyRecord(tampered)
    expect(result.cross_attestation!.signers_count).toBe(2)
    expect(result.cross_attestation!.signers_valid).toBe(1)
    expect(result.cross_attestation!.missing).toBe(true)
  })

  it('signal-not-invalidation: missing cross_attestation does not flip valid', async () => {
    // Legacy single-signer transaction record. Verifier flags missing=true
    // but signature is structurally valid. Per §1.7.6 valid stays true.
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })
    const result = await verifyRecord(record)
    expect(result.cross_attestation!.missing).toBe(true)
    expect(result.signatureOk).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('attaches AP2 VI evidence to transaction verification without changing base validity', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })

    const result = await verifyRecord(record, {
      ap2ViEvidence: autonomousFixture as Ap2ViEvidenceBundle,
      ap2ViEvidenceOptions: { nowSeconds: 1_779_840_000 },
    })

    expect(result.signatureOk).toBe(true)
    expect(result.cross_attestation!.missing).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.ap2_vi_evidence?.valid).toBe(true)
    expect(result.ap2_vi_evidence?.transactionAccepted).toBe(true)
    expect(result.ap2_vi_evidence?.vi.mode).toBe('autonomous')
    expect(result.ap2_vi_evidence?.vi.constraints.status).toBe('passed')
  })

  it('keeps AP2 VI evidence failures tiered from record signature validity', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })

    const result = await verifyRecord(record, {
      ap2ViEvidence: splitAgentFixture as Ap2ViEvidenceBundle,
      ap2ViEvidenceOptions: { constraintPolicy: 'best-effort' },
    })

    expect(result.signatureOk).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.ap2_vi_evidence?.valid).toBe(false)
    expect(result.ap2_vi_evidence?.errors).toContain('vi_l2_cnf_mismatch')
  })

  it('keeps AP2 VI verifier errors tiered from record signature validity', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })

    const result = await verifyRecord(record, {
      ap2ViEvidence: null as unknown as Ap2ViEvidenceBundle,
    })

    expect(result.signatureOk).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.ap2_vi_evidence?.valid).toBe(false)
    expect(result.ap2_vi_evidence?.errors[0]).toMatch(/^ap2_vi_evidence verification error:/)
  })
})

describe('verifyRecord, capability_check (D051 / §6.7)', () => {
  it('omits the annotation when no identityClaim is supplied', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.capability_check).toBeUndefined()
  })

  it('reports trivially in-envelope when the claim has no capabilities field', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record, {
      identityClaim: { creator_key: record.creator_key },
    })

    expect(result.capability_check).toBeDefined()
    expect(result.capability_check!.envelope).toBeNull()
    expect(result.capability_check!.in_envelope).toBe(true)
    expect(result.capability_check!.mismatches).toEqual([])
    expect(result.capability_check!.unresolvable).toBe(false)
  })

  it('reports trivially in-envelope when the envelope is empty ({})', async () => {
    // Per §6.7.1: "A claim with `capabilities: {}` declares no scope."
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record, {
      identityClaim: { creator_key: record.creator_key, capabilities: {} },
    })

    expect(result.capability_check!.envelope).toBeNull()
    expect(result.capability_check!.in_envelope).toBe(true)
    expect(result.capability_check!.mismatches).toEqual([])
  })

  it('confirms in_envelope when the record event_type is in the allowlist', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed) // event_type = observation

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: {
          event_types: [
            'https://atrib.dev/v1/types/observation',
            'https://atrib.dev/v1/types/tool_call',
          ],
        },
      },
    })

    expect(result.capability_check!.in_envelope).toBe(true)
    expect(result.capability_check!.mismatches).toEqual([])
    expect(result.capability_check!.unresolvable).toBe(false)
  })

  it('flags a mismatch when the record event_type is not in the allowlist', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed) // observation

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { event_types: ['https://atrib.dev/v1/types/tool_call'] },
      },
    })

    expect(result.capability_check!.in_envelope).toBe(false)
    expect(result.capability_check!.mismatches.some((m) => m.includes('event_type'))).toBe(true)
    // §6.7.3: out-of-envelope is a SIGNAL, not invalidation. signature still ok.
    expect(result.signatureOk).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('confirms in_envelope when expires_at is in the future', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, { timestamp: 1_000_000_000_000 })

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { expires_at: 2_000_000_000_000 },
      },
    })

    expect(result.capability_check!.in_envelope).toBe(true)
    expect(result.capability_check!.mismatches).toEqual([])
  })

  it('flags expires_at exceeded when record timestamp is past the cutoff', async () => {
    // Both timestamps must be in the past (signRecord rejects >5 min in the
    // future per spec §5.3.5 staleness check). The cutoff is older than the
    // record, so the envelope has already expired by the time the record signs.
    const seed = await freshKey()
    const record = await buildRecord(seed, { timestamp: 1_500_000_000_000 })

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { expires_at: 1_000_000_000_000 },
      },
    })

    expect(result.capability_check!.in_envelope).toBe(false)
    expect(result.capability_check!.mismatches.some((m) => m.includes('expired'))).toBe(true)
    // expiry is a signal, not invalidation. signature still ok.
    expect(result.warnings).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('marks unresolvable when tool_names allowlist applies to a tool_call record', async () => {
    // §6.7.2 step 2: tool_names requires the record's tool_name. The current
    // AtribRecord shape doesn't carry tool_name (per §8.2 default posture
    // only content_id is present), so we mark unresolvable.
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/tool_call',
    })

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { tool_names: ['allowed_tool'] },
      },
    })

    expect(result.capability_check!.unresolvable).toBe(true)
    expect(result.capability_check!.in_envelope).toBe(true) // mismatches empty
  })

  it('does not flag tool_names unresolvable for non-tool_call records', async () => {
    // Per §6.7.2 step 2 the tool_names constraint applies only to tool_call.
    // For an observation record, the tool_names list is irrelevant.
    const seed = await freshKey()
    const record = await buildRecord(seed) // observation

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { tool_names: ['allowed_tool'] },
      },
    })

    expect(result.capability_check!.unresolvable).toBe(false)
    expect(result.capability_check!.in_envelope).toBe(true)
  })

  it('marks unresolvable when transaction record has max_amount constraint', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { max_amount: { currency: 'USD', value: 100 } },
      },
    })

    expect(result.capability_check!.unresolvable).toBe(true)
  })

  it('marks unresolvable when transaction record has counterparties constraint', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      event_type: 'https://atrib.dev/v1/types/transaction',
    })

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: { counterparties: ['vendor.example'] },
      },
    })

    expect(result.capability_check!.unresolvable).toBe(true)
  })

  it('combines event_types mismatch and expires_at mismatch into the same mismatches list', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed, {
      timestamp: 1_500_000_000_000,
      event_type: 'https://atrib.dev/v1/types/observation',
    })

    const result = await verifyRecord(record, {
      identityClaim: {
        creator_key: record.creator_key,
        capabilities: {
          event_types: ['https://atrib.dev/v1/types/tool_call'],
          expires_at: 1_000_000_000_000,
        },
      },
    })

    expect(result.capability_check!.in_envelope).toBe(false)
    expect(result.capability_check!.mismatches.length).toBe(2)
    expect(result.capability_check!.mismatches.some((m) => m.includes('event_type'))).toBe(true)
    expect(result.capability_check!.mismatches.some((m) => m.includes('expired'))).toBe(true)
  })

  it('preserves the envelope object on the result for consumer inspection', async () => {
    // Round-trip the envelope so consumers can read the constraint fields
    // back without re-fetching the claim.
    const seed = await freshKey()
    const record = await buildRecord(seed)
    const envelope = {
      event_types: ['https://atrib.dev/v1/types/observation'],
      expires_at: 9_999_999_999_999,
    }

    const result = await verifyRecord(record, {
      identityClaim: { creator_key: record.creator_key, capabilities: envelope },
    })

    expect(result.capability_check!.envelope).toEqual(envelope)
  })
})
