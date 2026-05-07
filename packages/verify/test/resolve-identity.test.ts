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

// ===========================================================================
// Steps 1 + 2 + 5, anchor discovery + freshness + append-only consistency.
// Unit tests use stub callbacks + a mock fetch that emulates log-node and
// directory-node response shapes. Integration tests covering the same flow
// against real services live in @atrib/integration.
// ===========================================================================

describe('steps 1 + 2 + 5, anchor arc', () => {
  const OPERATOR_KEY = 'op'.repeat(21) + 'x' // 43 chars
  const ORIGIN = 'directory.test.local/v6'
  const CONTEXT_ID_HEX = anchorContextHexFor(ORIGIN)
  const CURRENT_ROOT_HEX = 'aa'.repeat(32)
  const PRIOR_ROOT_HEX = 'bb'.repeat(32)
  const CURRENT_HASH = 'sha256:' + 'cc'.repeat(32)
  const PRIOR_HASH = 'sha256:' + 'dd'.repeat(32)
  const T_NOW = 1_700_000_000_000
  const PRIOR_TS = T_NOW - 60_000  // 1 minute before
  const CURRENT_TS = T_NOW - 30_000 // 30s before

  const minimalClaim: IdentityClaim = {
    creator_key: KEY,
    claim_type: 'self_attested',
    claim_method: 'self',
    claim_subject: { display_name: 'alice' },
    signature: 'sig',
  }

  function anchorContextHexFor(origin: string): string {
    // Same derivation as resolve-identity.ts (sha256(origin)[:16] hex)
    // computed locally here to keep tests independent of that helper.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sha256 } = require('@noble/hashes/sha2.js') as { sha256: (data: Uint8Array) => Uint8Array }
    const digest = sha256(new TextEncoder().encode(origin))
    return Array.from(digest.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  function makeAnchorBody(rootHex: string, epoch: number): {
    chain_root: string
    content_id: string
    context_id: string
    creator_key: string
    event_type: string
    metadata: { directory_origin: string; directory_root: string; directory_epoch: number }
    spec_version: string
    timestamp: number
    signature: string
  } {
    return {
      chain_root: 'sha256:' + '0'.repeat(64),
      content_id: 'sha256:' + '0'.repeat(64),
      context_id: CONTEXT_ID_HEX,
      creator_key: OPERATOR_KEY,
      event_type: 'https://atrib.dev/v1/types/directory_anchor',
      metadata: { directory_origin: ORIGIN, directory_root: rootHex, directory_epoch: epoch },
      spec_version: 'atrib/1.0',
      timestamp: epoch === 1 ? PRIOR_TS : CURRENT_TS,
      signature: 'sig-' + epoch,
    }
  }

  /**
   * Build a fetch impl that emulates directory-node + log-node responses.
   * Pass `overrides` to disable individual handlers (e.g. simulate log
   * unreachable) or change response payloads.
   */
  function makeAnchorFetch(overrides: {
    /** Replace the directory_anchor entries returned by /by-context. */
    logEntries?: Array<{ record_hash: string; log_index: number; creator_key: string; context_id: string; timestamp_ms: number; event_type: string }>
    /** Replace the /anchor self-report payload. */
    directoryAnchor?: { epoch: number; root_hash: string; directory_origin: string }
    /** When set, /by-context returns this status. */
    logStatus?: number
  } = {}): typeof fetch {
    const defaultEntries = [
      { record_hash: CURRENT_HASH, log_index: 5, creator_key: OPERATOR_KEY, context_id: CONTEXT_ID_HEX, timestamp_ms: CURRENT_TS, event_type: 'directory_anchor' },
      { record_hash: PRIOR_HASH,   log_index: 3, creator_key: OPERATOR_KEY, context_id: CONTEXT_ID_HEX, timestamp_ms: PRIOR_TS,   event_type: 'directory_anchor' },
    ]
    const defaultAnchor = { epoch: 2, root_hash: CURRENT_ROOT_HEX, directory_origin: ORIGIN }
    return (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes(`/lookup/${KEY}`)) {
        return new Response(JSON.stringify({ found: true, claim: minimalClaim, version: 1, proof: 'p' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/anchor') && !url.includes('/anchors')) {
        return new Response(JSON.stringify(overrides.directoryAnchor ?? defaultAnchor), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes(`/by-context/${CONTEXT_ID_HEX}`)) {
        if (overrides.logStatus && overrides.logStatus !== 200) {
          return new Response(JSON.stringify({ error: 'log error' }), { status: overrides.logStatus })
        }
        return new Response(JSON.stringify({
          context_id: CONTEXT_ID_HEX,
          count: (overrides.logEntries ?? defaultEntries).length,
          entries: overrides.logEntries ?? defaultEntries,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/audit-proof')) {
        return new Response(JSON.stringify({ from_epoch: 1, to_epoch: 2, proof: 'audit-proof-bytes' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 })
    }) as typeof fetch
  }

  function makeFetchAnchorBody(): (recordHash: string) => Promise<ReturnType<typeof makeAnchorBody> | null> {
    return async (recordHash) => {
      if (recordHash === CURRENT_HASH) return makeAnchorBody(CURRENT_ROOT_HEX, 2)
      if (recordHash === PRIOR_HASH) return makeAnchorBody(PRIOR_ROOT_HEX, 1)
      return null
    }
  }

  it('step 1: populates anchor surface when log + body fetch succeed', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).not.toBeNull()
    expect(result.anchor?.anchor_record_hash).toBe(CURRENT_HASH)
    expect(result.anchor?.checkpoint_version).toBe(2)
    expect(result.anchor?.anchor_timestamp).toBe(CURRENT_TS)
    expect(result.anchor?.anchor_age_ms).toBe(T_NOW - CURRENT_TS)
    expect(result.warnings.some((w) => w.startsWith('step-1-anchor-not-checked'))).toBe(false)
  })

  it('step 1: anchor null when log returns no matching directory_anchor entries', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({ logEntries: [] }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-1-anchor-not-found'))).toBe(true)
  })

  it('step 1: anchor null when body fetch returns null', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: async () => null,
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-1-body-not-available'))).toBe(true)
  })

  it('step 1: anchor null when body creator_key mismatches operator', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: async () => {
        const body = makeAnchorBody(CURRENT_ROOT_HEX, 2)
        body.creator_key = 'wrong'.repeat(8) + 'xxx'
        return body
      },
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-1-body-creator-mismatch'))).toBe(true)
  })

  it('step 1: filters out anchors after T (timestamp window)', async () => {
    // All anchors are AFTER T_NOW (i.e., produced in the future relative to record)
    const futureEntries = [{
      record_hash: CURRENT_HASH, log_index: 5, creator_key: OPERATOR_KEY,
      context_id: CONTEXT_ID_HEX, timestamp_ms: T_NOW + 1000, event_type: 'directory_anchor',
    }]
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({ logEntries: futureEntries }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).toBeNull()
  })

  it('step 2: freshness_ok=true when anchor age within threshold', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      freshnessThresholdMs: 60_000, // anchor_age = 30s; threshold = 60s
    })
    expect(result.anchor?.anchor_freshness_ok).toBe(true)
    expect(result.warnings.some((w) => w.startsWith('step-2-anchor-stale'))).toBe(false)
  })

  it('step 2: freshness_ok=false + warning when anchor age exceeds threshold', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      freshnessThresholdMs: 10_000, // anchor_age = 30s; threshold = 10s
    })
    expect(result.anchor?.anchor_freshness_ok).toBe(false)
    expect(result.warnings.some((w) => w.startsWith('step-2-anchor-stale'))).toBe(true)
  })

  it('step 2: freshness_ok=null when no threshold supplied', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor?.anchor_freshness_ok).toBeNull()
  })

  it('step 5: append_only_consistent=true when audit proof verifies', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      verifyAuditProof: async () => true,
      recordTimestamp: T_NOW,
    })
    expect(result.append_only_consistent).toBe(true)
    expect(result.warnings.some((w) => w.startsWith('step-5-append-only-not-checked'))).toBe(false)
  })

  it('step 5: rejects (hard failure) when audit proof verification returns false', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      verifyAuditProof: async () => false,
      recordTimestamp: T_NOW,
    })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.identity_resolved).toBeNull()
    expect(result.append_only_consistent).toBe(false)
    expect(result.warnings.some((w) => w.includes('step-5-audit-proof-invalid'))).toBe(true)
  })

  it('step 5: callback throw → null, soft warning', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      verifyAuditProof: async () => { throw new Error('bad bytes') },
      recordTimestamp: T_NOW,
    })
    expect(result.append_only_consistent).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-5-verify-threw'))).toBe(true)
  })

  it('step 5: not invoked when only one anchor exists (no prior body)', async () => {
    const onlyOneEntry = [{
      record_hash: CURRENT_HASH, log_index: 5, creator_key: OPERATOR_KEY,
      context_id: CONTEXT_ID_HEX, timestamp_ms: CURRENT_TS, event_type: 'directory_anchor',
    }]
    let called = false
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({ logEntries: onlyOneEntry }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      verifyAuditProof: async () => { called = true; return true },
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).not.toBeNull()
    expect(result.append_only_consistent).toBeNull()
    expect(called).toBe(false)
  })
})
