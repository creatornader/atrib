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
