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
})
