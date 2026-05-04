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

    expect(result.warnings.some((w) => w.includes('provenance_token has invalid format'))).toBe(true)
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

describe('verifyRecord — informed_by_resolution', () => {
  it('omits the annotation when informed_by is absent', async () => {
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.informed_by_resolution).toBeUndefined()
  })

  it('omits the annotation when informed_by is present but empty', async () => {
    // Empty array shouldn't reach the canonical record per §1.2.5 (informed_by
    // is omitted when empty), but defensively confirm the verifier handles it.
    // signRecord canonicalizes — if the signer omitted informed_by per spec,
    // the record won't have it; explicitly omit here.
    const seed = await freshKey()
    const record = await buildRecord(seed)

    const result = await verifyRecord(record)

    expect(result.informed_by_resolution).toBeUndefined()
  })

  it('classifies all entries as dangling when no candidates supplied', async () => {
    const seed = await freshKey()
    const refs = [
      'sha256:' + 'd'.repeat(64),
      'sha256:' + 'e'.repeat(64),
    ]
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

describe('verifyRecord — posture (timestamp_granularity)', () => {
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
      // 16_666_666 minutes since epoch in ms — exactly minute-aligned
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
