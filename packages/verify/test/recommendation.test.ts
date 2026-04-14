import { describe, it, expect } from 'vitest'
import {
  signRecommendation,
  verifyRecommendationSignature,
  recommendationSigningInput,
  distributionsMatch,
} from '../src/recommendation.js'
import { base64urlEncode, getPublicKey } from '@atrib/mcp'
import type { RecommendationDocument } from '../src/types.js'

const PRIVATE_KEY = new Uint8Array(32).fill(7)

function baseDoc(): Omit<RecommendationDocument, 'signature'> {
  return {
    spec_version: 'atrib/1.0',
    document_type: 'settlement_recommendation',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    transaction_id: 'sha256:8b2f1c0000000000000000000000000000000000000000000000000000000000',
    policy_record_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    graph_checkpoint: 'log.atrib.io/v1',
    graph_tree_size: 4821937,
    calculated_at: 1743860000000,
    calculated_by: 'local',
    distribution: {
      ABC: 0.45,
      DEF: 0.35,
      GHI: 0.2,
    },
    maximum_total_share: 0.15,
    warnings: [],
  }
}

describe('signRecommendation', () => {
  it('returns a document with a base64url 64-byte signature', async () => {
    const signed = await signRecommendation(baseDoc(), PRIVATE_KEY)
    expect(signed.signature).toBeDefined()
    expect(signed.signature.length).toBeGreaterThan(80) // base64url(64) ≈ 86 chars
    expect(signed.signature).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('signs deterministically (same input → same signature)', async () => {
    const a = await signRecommendation(baseDoc(), PRIVATE_KEY)
    const b = await signRecommendation(baseDoc(), PRIVATE_KEY)
    expect(a.signature).toBe(b.signature)
  })

  it('rejects keys that are not 32 bytes', async () => {
    await expect(signRecommendation(baseDoc(), new Uint8Array(16))).rejects.toThrow(
      'privateKey must be 32 bytes',
    )
  })

  it('produces different signatures for different documents', async () => {
    const docA = baseDoc()
    const docB = baseDoc()
    docB.distribution = { XYZ: 1.0 }
    const a = await signRecommendation(docA, PRIVATE_KEY)
    const b = await signRecommendation(docB, PRIVATE_KEY)
    expect(a.signature).not.toBe(b.signature)
  })
})

describe('verifyRecommendationSignature', () => {
  it('verifies a freshly signed document', async () => {
    const signed = await signRecommendation(baseDoc(), PRIVATE_KEY)
    const pubKey = base64urlEncode(await getPublicKey(PRIVATE_KEY))
    expect(await verifyRecommendationSignature(signed, pubKey)).toBe(true)
  })

  it('rejects signature with wrong public key', async () => {
    const signed = await signRecommendation(baseDoc(), PRIVATE_KEY)
    const otherPub = base64urlEncode(await getPublicKey(new Uint8Array(32).fill(99)))
    expect(await verifyRecommendationSignature(signed, otherPub)).toBe(false)
  })

  it('rejects tampered document', async () => {
    const signed = await signRecommendation(baseDoc(), PRIVATE_KEY)
    const pubKey = base64urlEncode(await getPublicKey(PRIVATE_KEY))
    // Tamper with the distribution
    const tampered = {
      ...signed,
      distribution: { ABC: 1.0 },
    }
    expect(await verifyRecommendationSignature(tampered, pubKey)).toBe(false)
  })

  it('rejects empty signature', async () => {
    const pubKey = base64urlEncode(await getPublicKey(PRIVATE_KEY))
    const doc: RecommendationDocument = { ...baseDoc(), signature: '' }
    expect(await verifyRecommendationSignature(doc, pubKey)).toBe(false)
  })

  it('rejects malformed public key gracefully (no throw)', async () => {
    const signed = await signRecommendation(baseDoc(), PRIVATE_KEY)
    expect(await verifyRecommendationSignature(signed, 'not-base64url!!')).toBe(false)
  })
})

describe('recommendationSigningInput', () => {
  it('omits the signature field from the canonical input', () => {
    const docNoSig = baseDoc()
    const docWithSig = { ...baseDoc(), signature: 'fake' }
    const a = recommendationSigningInput(docNoSig)
    const b = recommendationSigningInput(docWithSig)
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b))
  })

  it('produces JCS canonical (sorted keys, no whitespace)', () => {
    const input = recommendationSigningInput(baseDoc())
    const text = new TextDecoder().decode(input)
    expect(text).not.toContain(' ')
    expect(text).not.toContain('\n')
    // Keys should appear in sorted order
    const calculatedAtIdx = text.indexOf('"calculated_at"')
    const distributionIdx = text.indexOf('"distribution"')
    expect(calculatedAtIdx).toBeLessThan(distributionIdx)
  })
})

describe('distributionsMatch', () => {
  it('returns true for identical distributions', () => {
    expect(distributionsMatch({ a: 0.5, b: 0.5 }, { a: 0.5, b: 0.5 })).toBe(true)
  })

  it('returns true within 1e-9 tolerance', () => {
    expect(distributionsMatch({ a: 0.5 }, { a: 0.5 + 1e-10 })).toBe(true)
  })

  it('returns false beyond 1e-9 tolerance', () => {
    expect(distributionsMatch({ a: 0.5 }, { a: 0.5 + 1e-8 })).toBe(false)
  })

  it('returns false for different key sets', () => {
    expect(distributionsMatch({ a: 1.0 }, { b: 1.0 })).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(distributionsMatch({ a: 0.5, b: 0.5 }, { a: 1.0 })).toBe(false)
  })

  it('handles exact 1e-9 boundary', () => {
    // Difference exactly at tolerance: still matches (≤, not <)
    expect(distributionsMatch({ a: 0.5 }, { a: 0.5 + 1e-9 })).toBe(true)
  })

  it('returns false for NaN values', () => {
    expect(distributionsMatch({ a: NaN }, { a: NaN })).toBe(false)
  })

  it('matches __unsigned__ sentinel when present in both', () => {
    expect(
      distributionsMatch({ KEY_A: 0.5, __unsigned__: 0.5 }, { KEY_A: 0.5, __unsigned__: 0.5 }),
    ).toBe(true)
  })

  it('returns false when only one has __unsigned__', () => {
    expect(distributionsMatch({ KEY_A: 0.5, __unsigned__: 0.5 }, { KEY_A: 1.0 })).toBe(false)
  })

  it('handles empty distributions', () => {
    expect(distributionsMatch({}, {})).toBe(true)
  })
})
