// Tests for resolveIdentity (spec §6.3 verifier consultation).

import { describe, it, expect } from 'vitest'
import { resolveIdentity } from '../src/resolve-identity.js'
import { buildRevocationRegistry } from '../src/revocations.js'
import type { IdentityClaim } from '../src/resolve-identity.js'

const KEY = 'A'.repeat(43)

function mockFetch(responses: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const match = Object.entries(responses).find(([prefix]) => url.includes(prefix))
    if (!match) {
      return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 })
    }
    const [, { status, body }] = match
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('resolveIdentity', () => {
  it('returns the claim when directory has one (membership)', async () => {
    const claim: IdentityClaim = {
      creator_key: KEY,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'Alice' },
      signature: 'sig',
    }
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 200, body: { found: true, claim, version: 1, proof: 'base64proof' } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    expect(result.identity_resolved).not.toBeNull()
    expect(result.identity_resolved?.claim_subject.display_name).toBe('Alice')
    expect(result.identity_resolution_method).toBe('directory_lookup')
    expect(result.lookup_proof_valid).toBeNull() // not validated by this implementation
  })

  it('returns no_claim_registered when directory returns 404', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    expect(result.identity_resolved).toBeNull()
    expect(result.identity_resolution_method).toBe('no_claim_registered')
  })

  it('rejects when directory returns unexpected error', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 500, body: { error: 'server error' } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.warnings.some((w) => w.includes('step-6-directory-error'))).toBe(true)
  })

  it('surfaces capabilities envelope when claim has it', async () => {
    const claim: IdentityClaim = {
      creator_key: KEY,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'Alice' },
      capabilities: { tool_names: ['ToolA'], expires_at: 9999999999 },
      signature: 'sig',
    }
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 200, body: { found: true, claim, version: 1, proof: 'p' } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    expect(result.capability_envelope).toEqual({ tool_names: ['ToolA'], expires_at: 9999999999 })
  })

  it('surfaces revocation status with since_revocation=true for post-revocation records', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const revocations = buildRevocationRegistry([
      {
        event_type: 'key_revocation',
        creator_key: KEY,
        log_index: 50,
        revoked_key: KEY,
        revocation_reason: 'rotation',
        successor_key: 'S'.repeat(43),
      },
    ])
    const result = await resolveIdentity(KEY, { fetchImpl, revocations, recordLogIndex: 100 })
    expect(result.key_revocation_status).not.toBeNull()
    expect(result.key_revocation_status?.since_revocation).toBe(true)
    expect(result.key_revocation_status?.reason).toBe('rotation')
  })

  it('surfaces revocation status with since_revocation=false for pre-revocation records', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const revocations = buildRevocationRegistry([
      {
        event_type: 'key_revocation',
        creator_key: KEY,
        log_index: 50,
        revoked_key: KEY,
        revocation_reason: 'rotation',
        successor_key: 'S'.repeat(43),
      },
    ])
    const result = await resolveIdentity(KEY, { fetchImpl, revocations, recordLogIndex: 25 })
    expect(result.key_revocation_status?.since_revocation).toBe(false)
  })

  it('flags step-9-revocation-not-checked when no registry supplied', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    expect(result.warnings.some((w) => w.startsWith('step-9-revocation-not-checked'))).toBe(true)
  })

  it('always warns about steps that this implementation does not verify', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    const ws = result.warnings.join('\n')
    expect(ws).toMatch(/step-1-anchor-not-checked/)
    expect(ws).toMatch(/step-3-witness-not-checked/)
    expect(ws).toMatch(/step-4-checkpoint-signature-not-checked/)
    expect(ws).toMatch(/step-5-append-only-not-checked/)
    expect(ws).toMatch(/step-7-akd-proof-not-validated/)
  })

  it('rejects when claim payload has wrong creator_key', async () => {
    const claim: IdentityClaim = {
      creator_key: 'B'.repeat(43),
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
      signature: 'sig',
    }
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 200, body: { found: true, claim, version: 1, proof: 'p' } },
    })
    const result = await resolveIdentity(KEY, { fetchImpl })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.warnings.some((w) => w.includes('claim-malformed'))).toBe(true)
  })

  // ===========================================================================
  // Step 7 (AKD lookup proof verification), wired only when caller supplies
  // both `verifyLookupProof` callback and `directoryVrfPublicKey`. Tests use
  // a stub callback so this file stays independent of the WASM bridge.
  // ===========================================================================

  describe('step 7, lookup proof verification', () => {
    const VRF_PUBKEY = new Uint8Array(32).fill(0xAB)
    const ROOT_HEX = 'cd'.repeat(32)
    const PROOF_B64U = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

    const happyClaim: IdentityClaim = {
      creator_key: KEY,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'Alice' },
      signature: 'sig',
    }

    function happyFetch(): typeof fetch {
      return mockFetch({
        [`/lookup/${KEY}`]: {
          status: 200,
          body: { found: true, claim: happyClaim, version: 1, proof: PROOF_B64U },
        },
        '/anchor': { status: 200, body: { epoch: 1, root_hash: ROOT_HEX } },
      })
    }

    it('populates lookup_proof_valid=true and removes the up-front warning when callback returns true', async () => {
      const calls: VerifyArgs[] = []
      const result = await resolveIdentity(KEY, {
        fetchImpl: happyFetch(),
        directoryVrfPublicKey: VRF_PUBKEY,
        verifyLookupProof: (input) => { calls.push(input); return true },
      })
      expect(result.lookup_proof_valid).toBe(true)
      expect(result.identity_resolution_method).toBe('directory_lookup')
      expect(result.warnings.some((w) => w.startsWith('step-7-akd-proof-not-validated'))).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.label).toBe(KEY)
      expect(calls[0]?.currentEpoch).toBe(1)
      expect(calls[0]?.rootHash).toEqual(new Uint8Array(32).fill(0xCD))
      expect(calls[0]?.vrfPublicKey).toBe(VRF_PUBKEY)
    })

    it('rejects the result with lookup_proof_valid=false when callback returns false (§6.3 step 7 hard failure)', async () => {
      const result = await resolveIdentity(KEY, {
        fetchImpl: happyFetch(),
        directoryVrfPublicKey: VRF_PUBKEY,
        verifyLookupProof: () => false,
      })
      expect(result.identity_resolution_method).toBe('rejected')
      expect(result.identity_resolved).toBeNull()
      expect(result.lookup_proof_valid).toBe(false)
      expect(result.warnings.some((w) => w.includes('step-7-akd-proof-invalid'))).toBe(true)
    })

    it('keeps the up-front warning and lookup_proof_valid=null when callback throws', async () => {
      const result = await resolveIdentity(KEY, {
        fetchImpl: happyFetch(),
        directoryVrfPublicKey: VRF_PUBKEY,
        verifyLookupProof: () => { throw new Error('malformed proof') },
      })
      expect(result.lookup_proof_valid).toBeNull()
      expect(result.identity_resolution_method).toBe('directory_lookup')
      expect(result.warnings.some((w) => w.includes('step-7-verify-threw'))).toBe(true)
    })

    it('keeps lookup_proof_valid=null when /anchor fetch fails', async () => {
      const fetchImpl = mockFetch({
        [`/lookup/${KEY}`]: {
          status: 200,
          body: { found: true, claim: happyClaim, version: 1, proof: PROOF_B64U },
        },
        '/anchor': { status: 503, body: {} },
      })
      const result = await resolveIdentity(KEY, {
        fetchImpl,
        directoryVrfPublicKey: VRF_PUBKEY,
        verifyLookupProof: () => true,
      })
      expect(result.lookup_proof_valid).toBeNull()
      expect(result.identity_resolution_method).toBe('directory_lookup')
      expect(result.warnings.some((w) => w.includes('step-7-anchor-fetch-error'))).toBe(true)
    })

    it('keeps lookup_proof_valid=null when /anchor returns malformed body', async () => {
      const fetchImpl = mockFetch({
        [`/lookup/${KEY}`]: {
          status: 200,
          body: { found: true, claim: happyClaim, version: 1, proof: PROOF_B64U },
        },
        '/anchor': { status: 200, body: { epoch: 'not-a-number' } },
      })
      const result = await resolveIdentity(KEY, {
        fetchImpl,
        directoryVrfPublicKey: VRF_PUBKEY,
        verifyLookupProof: () => true,
      })
      expect(result.lookup_proof_valid).toBeNull()
      expect(result.warnings.some((w) => w.includes('step-7-anchor-malformed'))).toBe(true)
    })

    it('keeps lookup_proof_valid=null when proof field is missing from lookup response', async () => {
      const fetchImpl = mockFetch({
        [`/lookup/${KEY}`]: {
          status: 200,
          body: { found: true, claim: happyClaim, version: 1 }, // no proof
        },
        '/anchor': { status: 200, body: { epoch: 1, root_hash: ROOT_HEX } },
      })
      let called = false
      const result = await resolveIdentity(KEY, {
        fetchImpl,
        directoryVrfPublicKey: VRF_PUBKEY,
        verifyLookupProof: () => { called = true; return true },
      })
      expect(result.lookup_proof_valid).toBeNull()
      expect(called).toBe(false) // step 7 short-circuited before the callback
      expect(result.warnings.some((w) => w.includes('step-7-proof-missing'))).toBe(true)
    })

    it('does not invoke step 7 when verifyLookupProof callback is omitted', async () => {
      const result = await resolveIdentity(KEY, {
        fetchImpl: happyFetch(),
        directoryVrfPublicKey: VRF_PUBKEY,
        // verifyLookupProof intentionally omitted
      })
      expect(result.lookup_proof_valid).toBeNull()
      expect(result.warnings.some((w) => w.startsWith('step-7-akd-proof-not-validated'))).toBe(true)
    })

    it('does not invoke step 7 when directoryVrfPublicKey is omitted', async () => {
      let called = false
      const result = await resolveIdentity(KEY, {
        fetchImpl: happyFetch(),
        verifyLookupProof: () => { called = true; return true },
      })
      expect(called).toBe(false)
      expect(result.lookup_proof_valid).toBeNull()
      expect(result.warnings.some((w) => w.startsWith('step-7-akd-proof-not-validated'))).toBe(true)
    })
  })
})

interface VerifyArgs {
  vrfPublicKey: Uint8Array
  rootHash: Uint8Array
  currentEpoch: number
  label: string
  proof: Uint8Array
}
