// Tests for resolveIdentity (spec §6.3 verifier consultation).

import { describe, it, expect, beforeAll } from 'vitest'
import * as ed from '@noble/ed25519'
import {
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_OBSERVATION_URI,
  computeInclusionProof,
  computeRoot,
  leafHash,
  serializeEntry,
} from '@atrib/mcp'
import { resolveIdentity } from '../src/resolve-identity.js'
import { buildRevocationRegistry } from '../src/revocations.js'
import { checkpointKeyId, createWitnessCosignature } from '../src/witness.js'
import type { AnchorCommitment, IdentityClaim } from '../src/resolve-identity.js'

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
      [`/lookup/${KEY}`]: {
        status: 200,
        body: { found: true, claim, version: 1, proof: 'base64proof' },
      },
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
    const result = await resolveIdentity(KEY, {
      fetchImpl,
      revocations,
      revocationsVerified: true,
      recordLogIndex: 100,
    })
    expect(result.key_revocation_status).not.toBeNull()
    expect(result.key_revocation_status?.since_revocation).toBe(true)
    expect(result.key_revocation_status?.order_verifiable).toBe(true)
    expect(result.key_revocation_status?.registry_verified).toBe(true)
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
    const result = await resolveIdentity(KEY, {
      fetchImpl,
      revocations,
      revocationsVerified: true,
      recordLogIndex: 25,
    })
    expect(result.key_revocation_status?.since_revocation).toBe(false)
    expect(result.key_revocation_status?.order_verifiable).toBe(true)
    expect(result.key_revocation_status?.registry_verified).toBe(true)
  })

  it('does not infer revocation order from timestamps when record log index is absent', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const revocations = buildRevocationRegistry([
      {
        event_type: 'key_revocation',
        creator_key: KEY,
        log_index: 50,
        revoked_key: KEY,
        revocation_reason: 'retirement',
      },
    ])
    const result = await resolveIdentity(KEY, {
      fetchImpl,
      revocations,
      revocationsVerified: true,
      recordTimestamp: Number.MAX_SAFE_INTEGER,
    })
    expect(result.key_revocation_status).toMatchObject({
      since_revocation: null,
      order_verifiable: false,
      registry_verified: true,
    })
    expect(result.warnings).toContain(
      'step-9-revocation-order-unverifiable: record log index was not supplied; timestamps were not used',
    )
  })

  it('labels a shape-only revocation registry as unverified', async () => {
    const fetchImpl = mockFetch({
      [`/lookup/${KEY}`]: { status: 404, body: { found: false } },
    })
    const revocations = buildRevocationRegistry([
      {
        event_type: 'key_revocation',
        creator_key: KEY,
        log_index: 50,
        revoked_key: KEY,
        revocation_reason: 'retirement',
      },
    ])
    const result = await resolveIdentity(KEY, {
      fetchImpl,
      revocations,
      recordLogIndex: 100,
    })
    expect(result.key_revocation_status?.registry_verified).toBe(false)
    expect(result.warnings).toContain(
      'step-9-revocation-registry-unverified: registry shape was supplied without signature and revoker-authorization assurance',
    )
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
    const VRF_PUBKEY = new Uint8Array(32).fill(0xab)
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
        verifyLookupProof: (input) => {
          calls.push(input)
          return true
        },
      })
      expect(result.lookup_proof_valid).toBe(true)
      expect(result.identity_resolution_method).toBe('directory_lookup')
      expect(result.warnings.some((w) => w.startsWith('step-7-akd-proof-not-validated'))).toBe(
        false,
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]?.label).toBe(KEY)
      expect(calls[0]?.currentEpoch).toBe(1)
      expect(calls[0]?.rootHash).toEqual(new Uint8Array(32).fill(0xcd))
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
        verifyLookupProof: () => {
          throw new Error('malformed proof')
        },
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
        verifyLookupProof: () => {
          called = true
          return true
        },
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
        verifyLookupProof: () => {
          called = true
          return true
        },
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
  // Real Ed25519 keypair so step 4 (signature verify on anchor bodies)
  // doesn't reject the fixtures. Use the canonical hard-coded base64url
  // pubkey + seed pair so the suite stays deterministic. Generated via
  // ed25519.getPublicKey(seed=0x42^32) and pasted here; verified
  // structurally by the first test in the block.
  const OPERATOR_SEED = new Uint8Array(32).fill(0x42)
  // ed25519 pubkey for the OPERATOR_SEED (derived once via beforeAll
  // and stored in this mutable so synchronous fixture builders can use
  // it). The 43-char base64url shape is enforced by the SDK.
  let OPERATOR_KEY = ''
  const ORIGIN = 'directory.test.local/v6'
  const CONTEXT_ID_HEX = anchorContextHexFor(ORIGIN)
  const CURRENT_ROOT_HEX = 'aa'.repeat(32)
  const PRIOR_ROOT_HEX = 'bb'.repeat(32)
  // Both anchor record_hash values are computed in beforeAll once we
  // have signed bodies (sha256(canonical(body))).
  let CURRENT_HASH = ''
  let PRIOR_HASH = ''
  const T_NOW = 1_700_000_000_000
  const PRIOR_TS = T_NOW - 60_000 // 1 minute before
  const CURRENT_TS = T_NOW - 30_000 // 30s before
  let CURRENT_BODY: ReturnType<typeof makeBodyShape>
  let PRIOR_BODY: ReturnType<typeof makeBodyShape>

  function makeBodyShape(rootHex: string, epoch: number, ts: number) {
    return {
      chain_root: 'sha256:' + '0'.repeat(64),
      content_id: 'sha256:' + '0'.repeat(64),
      context_id: CONTEXT_ID_HEX,
      creator_key: OPERATOR_KEY,
      event_type: 'https://atrib.dev/v1/types/directory_anchor',
      metadata: { directory_origin: ORIGIN, directory_root: rootHex, directory_epoch: epoch },
      spec_version: 'atrib/1.0',
      timestamp: ts,
      signature: '',
    }
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: canonicalize } = await import('canonicalize')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const pubBytes = await ed.getPublicKeyAsync(OPERATOR_SEED)
    OPERATOR_KEY = Buffer.from(pubBytes).toString('base64url').replace(/=+$/, '')

    async function signBody(b: ReturnType<typeof makeBodyShape>) {
      const { signature: _, ...unsigned } = { ...b, creator_key: OPERATOR_KEY }
      const canonical = canonicalize(unsigned)!
      const sigBytes = await ed.signAsync(new TextEncoder().encode(canonical), OPERATOR_SEED)
      const sig = Buffer.from(sigBytes).toString('base64url').replace(/=+$/, '')
      const signed = { ...b, creator_key: OPERATOR_KEY, signature: sig }
      const fullCanonical = canonicalize(signed)!
      const hashHex = Buffer.from(sha256(new TextEncoder().encode(fullCanonical))).toString('hex')
      return { signed, hashHex: 'sha256:' + hashHex }
    }

    const cur = await signBody(makeBodyShape(CURRENT_ROOT_HEX, 2, CURRENT_TS))
    CURRENT_BODY = cur.signed
    CURRENT_HASH = cur.hashHex

    const pri = await signBody(makeBodyShape(PRIOR_ROOT_HEX, 1, PRIOR_TS))
    PRIOR_BODY = pri.signed
    PRIOR_HASH = pri.hashHex
  })

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
    const { sha256 } = require('@noble/hashes/sha2.js') as {
      sha256: (data: Uint8Array) => Uint8Array
    }
    const digest = sha256(new TextEncoder().encode(origin))
    return Array.from(digest.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Returns the pre-signed body matching the requested epoch. Test
   * callers either request epoch=2 (current) or epoch=1 (prior).
   * Constructed in beforeAll with a real ed25519 signature against
   * OPERATOR_SEED so step 4 verification accepts it.
   */
  function makeAnchorBody(_rootHex: string, epoch: number) {
    return epoch === 1 ? PRIOR_BODY : CURRENT_BODY
  }

  /**
   * Build a fetch impl that emulates directory-node + log-node responses.
   * Pass `overrides` to disable individual handlers (e.g. simulate log
   * unreachable) or change response payloads.
   */
  function makeAnchorFetch(
    overrides: {
      /** Replace the directory_anchor entries returned by /by-context. */
      logEntries?: AnchorCommitment[]
      /** Replace the /anchor self-report payload. */
      directoryAnchor?: { epoch: number; root_hash: string; directory_origin: string }
      /** When set, /by-context returns this status. */
      logStatus?: number
    } = {},
  ): typeof fetch {
    const defaultEntries = [
      {
        record_hash: CURRENT_HASH,
        index: 5,
        creator_key: OPERATOR_KEY,
        context_id: CONTEXT_ID_HEX,
        timestamp_ms: CURRENT_TS,
        event_type: 'directory_anchor',
      },
      {
        record_hash: PRIOR_HASH,
        index: 3,
        creator_key: OPERATOR_KEY,
        context_id: CONTEXT_ID_HEX,
        timestamp_ms: PRIOR_TS,
        event_type: 'directory_anchor',
      },
    ]
    const defaultAnchor = { epoch: 2, root_hash: CURRENT_ROOT_HEX, directory_origin: ORIGIN }
    return (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes(`/lookup/${KEY}`)) {
        return new Response(
          JSON.stringify({ found: true, claim: minimalClaim, version: 1, proof: 'p', epoch: 2 }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }
      if (url.includes('/anchor') && !url.includes('/anchors')) {
        return new Response(JSON.stringify(overrides.directoryAnchor ?? defaultAnchor), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes(`/by-context/${CONTEXT_ID_HEX}`)) {
        if (overrides.logStatus && overrides.logStatus !== 200) {
          return new Response(JSON.stringify({ error: 'log error' }), {
            status: overrides.logStatus,
          })
        }
        return new Response(
          JSON.stringify({
            context_id: CONTEXT_ID_HEX,
            count: (overrides.logEntries ?? defaultEntries).length,
            entries: overrides.logEntries ?? defaultEntries,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('/audit-proof')) {
        return new Response(
          JSON.stringify({ from_epoch: 1, to_epoch: 2, proof: 'audit-proof-bytes' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }
      return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 })
    }) as typeof fetch
  }

  function makeFetchAnchorBody(): (
    recordHash: string,
  ) => Promise<ReturnType<typeof makeAnchorBody> | null> {
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

  it('step 6: rejects a current lookup from a different directory epoch', async () => {
    const base = makeAnchorFetch()
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes(`/lookup/${KEY}`)) {
        return new Response(
          JSON.stringify({
            found: true,
            claim: minimalClaim,
            version: 1,
            proof: 'p',
            epoch: 3,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return base(input as RequestInfo)
    }) as typeof fetch
    const result = await resolveIdentity(KEY, {
      fetchImpl,
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.warnings.some((w) => w.startsWith('step-6-lookup-epoch-mismatch'))).toBe(true)
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
    expect(result.identity_resolution_method).toBe('no_anchor_available')
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
        // Clone before mutating, makeAnchorBody returns the shared
        // pre-signed CURRENT_BODY; mutating in place poisoned later tests.
        const body = { ...makeAnchorBody(CURRENT_ROOT_HEX, 2) }
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
    const futureEntries = [
      {
        record_hash: CURRENT_HASH,
        log_index: 5,
        creator_key: OPERATOR_KEY,
        context_id: CONTEXT_ID_HEX,
        timestamp_ms: T_NOW + 1000,
        event_type: 'directory_anchor',
      },
    ]
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({ logEntries: futureEntries }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).toBeNull()
    expect(result.identity_resolution_method).toBe('no_anchor_available')
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
      verifyAuditProof: async () => {
        throw new Error('bad bytes')
      },
      recordTimestamp: T_NOW,
    })
    expect(result.append_only_consistent).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-5-verify-threw'))).toBe(true)
  })

  it('step 5: not invoked when only one anchor exists (no prior body)', async () => {
    const onlyOneEntry = [
      {
        record_hash: CURRENT_HASH,
        log_index: 5,
        creator_key: OPERATOR_KEY,
        context_id: CONTEXT_ID_HEX,
        timestamp_ms: CURRENT_TS,
        event_type: 'directory_anchor',
      },
    ]
    let called = false
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({ logEntries: onlyOneEntry }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      verifyAuditProof: async () => {
        called = true
        return true
      },
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).not.toBeNull()
    expect(result.append_only_consistent).toBeNull()
    expect(called).toBe(false)
  })

  // =========================================================================
  // Step 4, directory checkpoint signature verification.
  //
  // Hard-failure path per spec §6.3 step 4: an invalidly-signed body is
  // a fault, not a soft signal. The verifier rejects the entire result.
  // =========================================================================

  it('step 4: directory_checkpoint_signature_valid=true and warning removed when signature verifies', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.directory_checkpoint_signature_valid).toBe(true)
    expect(
      result.warnings.some((w) => w.startsWith('step-4-checkpoint-signature-not-checked')),
    ).toBe(false)
  })

  it('step 4: hard-rejection when body signature is tampered', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: async () => {
        const body = { ...makeAnchorBody(CURRENT_ROOT_HEX, 2) }
        // Flip a bit in the signature.
        const sigBytes = Buffer.from(
          body.signature + '='.repeat((4 - (body.signature.length % 4)) % 4),
          'base64url',
        )
        sigBytes[0] = (sigBytes[0]! ^ 0x01) & 0xff
        body.signature = sigBytes.toString('base64url').replace(/=+$/, '')
        return body
      },
      recordTimestamp: T_NOW,
    })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.identity_resolved).toBeNull()
    expect(result.directory_checkpoint_signature_valid).toBe(false)
    expect(result.warnings.some((w) => w.includes('step-4-signature-invalid'))).toBe(true)
  })

  it('step 4: hard-rejects a valid body that does not match the log commitment', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: async (recordHash) => {
        if (recordHash === CURRENT_HASH) return makeAnchorBody(PRIOR_ROOT_HEX, 1)
        return null
      },
      recordTimestamp: T_NOW,
    })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.directory_checkpoint_signature_valid).toBe(false)
    expect(result.warnings.some((w) => w.includes('step-4-body-commitment-mismatch'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('step-4-signature-invalid'))).toBe(false)
  })

  it('step 4: hard-rejects log entry fields that do not match the committed body', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({
        logEntries: [
          {
            record_hash: CURRENT_HASH,
            index: 5,
            creator_key: OPERATOR_KEY,
            context_id: CONTEXT_ID_HEX,
            timestamp_ms: CURRENT_TS - 1,
            event_type: 'directory_anchor',
          },
        ],
      }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.directory_checkpoint_signature_valid).toBe(false)
    expect(result.warnings).toContain('step-4-body-entry-mismatch: fields=timestamp')
  })

  it('step 4: hard-rejection when directoryOperatorKey is the wrong pubkey', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: 'A'.repeat(43), // valid format but wrong key
      fetchAnchorBody: async () => {
        // Body still has correct creator_key (OPERATOR_KEY) so step 1
        // cross-check passes; signature was made by OPERATOR_KEY, not 'A'.
        return makeAnchorBody(CURRENT_ROOT_HEX, 2)
      },
      recordTimestamp: T_NOW,
    })
    // Step 1's log-entry filter (event_type=directory_anchor +
    // creator_key === opts.directoryOperatorKey) rejects every entry
    // because the log entries' creator_key is the real OPERATOR_KEY
    // and directoryOperatorKey is the wrong key. Step 1 returns
    // anchor-not-found; step 4 never runs because no anchorBody was
    // discovered. This catches operator-key mismatches earliest in
    // the pipeline (before any body fetch).
    expect(result.anchor).toBeNull()
    expect(result.directory_checkpoint_signature_valid).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-1-anchor-not-found'))).toBe(true)
  })

  it('step 4: not invoked when no anchor body is discovered (no log endpoint)', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      // logEndpoint omitted → step 1 doesn't run → step 4 doesn't run
    })
    expect(result.anchor).toBeNull()
    expect(result.directory_checkpoint_signature_valid).toBeNull()
    expect(
      result.warnings.some((w) => w.startsWith('step-4-checkpoint-signature-not-checked')),
    ).toBe(true)
  })

  // =========================================================================
  // Step 3, witness coverage on the log's checkpoint.
  //
  // Soft signal: verifies the pinned log key, binds checkpoint tree size
  // to the selected anchor log index, and counts only valid, fresh,
  // distinct signatures from caller-pinned witness keys.
  // =========================================================================

  const LOG_NAME = 'log.test/v1'
  const LOG_SEED = new Uint8Array(32).fill(0x51)
  const OTHER_LOG_SEED = new Uint8Array(32).fill(0x52)
  const WITNESS_A_NAME = 'witness-a.test'
  const WITNESS_B_NAME = 'witness-b.test'
  const WITNESS_C_NAME = 'witness-c.test'
  const WITNESS_A_SEED = new Uint8Array(32).fill(0x61)
  const WITNESS_B_SEED = new Uint8Array(32).fill(0x62)
  const WITNESS_C_SEED = new Uint8Array(32).fill(0x63)
  const WITNESS_NOW = 1_800_000_000
  let logPublicKey: Uint8Array
  let otherLogPublicKey: Uint8Array
  let witnessAPublicKey: Uint8Array
  let witnessBPublicKey: Uint8Array
  let witnessCPublicKey: Uint8Array

  beforeAll(async () => {
    logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
    otherLogPublicKey = await ed.getPublicKeyAsync(OTHER_LOG_SEED)
    witnessAPublicKey = await ed.getPublicKeyAsync(WITNESS_A_SEED)
    witnessBPublicKey = await ed.getPublicKeyAsync(WITNESS_B_SEED)
    witnessCPublicKey = await ed.getPublicKeyAsync(WITNESS_C_SEED)
  })

  async function signCheckpoint(treeSize: number, rootHash: Uint8Array): Promise<string> {
    const body = `${LOG_NAME}\n${treeSize}\n${Buffer.from(rootHash).toString('base64')}\n`
    const signature = await ed.signAsync(new TextEncoder().encode(body), LOG_SEED)
    const payload = Buffer.concat([
      Buffer.from(checkpointKeyId(LOG_NAME, logPublicKey)),
      Buffer.from(signature),
    ])
    return `${body}\n— ${LOG_NAME} ${payload.toString('base64')}\n`
  }

  interface TestProofBundle {
    log_index: number
    checkpoint: string
    inclusion_proof: string[]
    leaf_hash: string
  }

  async function makeAnchorProof(treeSize = 6): Promise<TestProofBundle> {
    const anchorEntry = serializeEntry({
      record_hash_hex: CURRENT_HASH.replace(/^sha256:/, ''),
      creator_key_b64url: OPERATOR_KEY,
      context_id: CONTEXT_ID_HEX,
      timestamp: CURRENT_TS,
      event_type: EVENT_TYPE_DIRECTORY_ANCHOR_URI,
    })
    const dummyEntries = Array.from({ length: Math.min(treeSize, 5) }, (_, index) =>
      serializeEntry({
        record_hash_hex: Buffer.alloc(32, index + 1).toString('hex'),
        creator_key_b64url: OPERATOR_KEY,
        context_id: CONTEXT_ID_HEX,
        timestamp: PRIOR_TS - index,
        event_type: EVENT_TYPE_OBSERVATION_URI,
      }),
    )
    const entries = treeSize > 5 ? [...dummyEntries, anchorEntry] : dummyEntries
    const rootHash = computeRoot(entries)
    return {
      log_index: 5,
      checkpoint: await signCheckpoint(entries.length, rootHash),
      inclusion_proof:
        entries.length > 5
          ? computeInclusionProof(5, entries).map((hash) => Buffer.from(hash).toString('base64'))
          : [],
      leaf_hash: Buffer.from(leafHash(anchorEntry)).toString('base64'),
    }
  }

  function checkpointBody(note: string): string {
    return note.slice(0, note.indexOf('\n\n') + 1)
  }

  async function makeCosignature(
    note: string,
    witnessName: string,
    privateKey: Uint8Array,
    timestampSeconds = WITNESS_NOW - 30,
  ): Promise<string> {
    return createWitnessCosignature({
      checkpointBody: checkpointBody(note),
      witnessName,
      privateKey,
      timestampSeconds,
    })
  }

  function tamperCosignature(line: string): string {
    const [prefix, token] = line.trimEnd().split(/ (?=[^ ]+$)/)
    const payload = Buffer.from(token!, 'base64')
    payload[payload.length - 1] = payload[payload.length - 1]! ^ 0x01
    return `${prefix} ${payload.toString('base64')}\n`
  }

  function makeAnchorFetchWithProof(proofBundle: TestProofBundle): typeof fetch {
    const base = makeAnchorFetch()
    return (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes(`/proof/${CURRENT_HASH.replace(/^sha256:/, '')}`)) {
        return new Response(JSON.stringify(proofBundle), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return base(input as RequestInfo)
    }) as typeof fetch
  }

  it('step 3: does not infer witness coverage without a pinned log key', async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch(),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(
      result.warnings.some((w) => w.startsWith('step-3-log-checkpoint-key-not-configured')),
    ).toBe(true)
  })

  it('step 3: counts valid trusted cosignatures fetched from witness endpoints', async () => {
    const proofBundle = await makeAnchorProof()
    const cosigA = await makeCosignature(proofBundle.checkpoint, WITNESS_A_NAME, WITNESS_A_SEED)
    const cosigB = await makeCosignature(proofBundle.checkpoint, WITNESS_B_NAME, WITNESS_B_SEED)
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
      trustedWitnessKeys: [
        { name: WITNESS_A_NAME, publicKey: witnessAPublicKey },
        { name: WITNESS_B_NAME, publicKey: witnessBPublicKey },
      ],
      fetchWitnessCosignatures: async (checkpoint) => {
        expect(checkpoint.treeSize).toBe(6)
        return [cosigA, cosigB]
      },
      witnessThreshold: 2,
      witnessNowSeconds: WITNESS_NOW,
    })
    expect(result.anchor?.anchor_witness_count).toBe(2)
    expect(result.warnings.some((w) => w.startsWith('step-3-witness-insufficient'))).toBe(false)
    expect(result.warnings.some((w) => w.startsWith('step-3-witness-not-checked'))).toBe(false)
  })

  it('step 3: excludes untrusted and invalid cosignatures', async () => {
    const proofBundle = await makeAnchorProof()
    const validA = await makeCosignature(proofBundle.checkpoint, WITNESS_A_NAME, WITNESS_A_SEED)
    const untrustedB = await makeCosignature(proofBundle.checkpoint, WITNESS_B_NAME, WITNESS_B_SEED)
    const invalidC = tamperCosignature(
      await makeCosignature(proofBundle.checkpoint, WITNESS_C_NAME, WITNESS_C_SEED),
    )
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
      trustedWitnessKeys: [
        { name: WITNESS_A_NAME, publicKey: witnessAPublicKey },
        { name: WITNESS_C_NAME, publicKey: witnessCPublicKey },
      ],
      fetchWitnessCosignatures: async () => [validA, untrustedB, invalidC],
      witnessThreshold: 2,
      witnessNowSeconds: WITNESS_NOW,
    })
    expect(result.anchor?.anchor_witness_count).toBe(1)
    expect(result.warnings.some((w) => w.includes('step-3-witness-untrusted-witness-key'))).toBe(
      true,
    )
    expect(result.warnings.some((w) => w.includes('step-3-witness-signature-is-invalid'))).toBe(
      true,
    )
    expect(result.warnings.some((w) => w.includes('actual=1, required=2'))).toBe(true)
  })

  it('step 3: excludes stale, future, and duplicate trusted cosignatures', async () => {
    const proofBundle = await makeAnchorProof()
    const validA = await makeCosignature(proofBundle.checkpoint, WITNESS_A_NAME, WITNESS_A_SEED)
    const staleB = await makeCosignature(
      proofBundle.checkpoint,
      WITNESS_B_NAME,
      WITNESS_B_SEED,
      WITNESS_NOW - 90_000,
    )
    const futureC = await makeCosignature(
      proofBundle.checkpoint,
      WITNESS_C_NAME,
      WITNESS_C_SEED,
      WITNESS_NOW + 1_000,
    )
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
      trustedWitnessKeys: [
        { name: WITNESS_A_NAME, publicKey: witnessAPublicKey },
        { name: WITNESS_B_NAME, publicKey: witnessBPublicKey },
        { name: WITNESS_C_NAME, publicKey: witnessCPublicKey },
      ],
      fetchWitnessCosignatures: async () => [validA, validA, staleB, futureC],
      witnessThreshold: 3,
      witnessNowSeconds: WITNESS_NOW,
    })
    expect(result.anchor?.anchor_witness_count).toBe(1)
    expect(
      result.warnings.some((w) => w.includes('step-3-witness-duplicate-witness-signature')),
    ).toBe(true)
    expect(result.warnings.some((w) => w.includes('step-3-witness-cosignature-is-stale'))).toBe(
      true,
    )
    expect(
      result.warnings.some((w) => w.includes('step-3-witness-timestamp-is-in-the-future')),
    ).toBe(true)
  })

  it('step 3: rejects malformed callback cosignatures before witness verification', async () => {
    const proofBundle = await makeAnchorProof()
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
      trustedWitnessKeys: [{ name: WITNESS_A_NAME, publicKey: witnessAPublicKey }],
      fetchWitnessCosignatures: async () => [
        `— ${WITNESS_A_NAME} ${Buffer.alloc(75).toString('base64')}`,
      ],
      witnessThreshold: 1,
      witnessNowSeconds: WITNESS_NOW,
    })
    expect(result.anchor?.anchor_witness_count).toBe(0)
    expect(result.warnings.some((w) => w.startsWith('step-3-witness-cosignature-malformed'))).toBe(
      true,
    )
    expect(result.warnings.some((w) => w.includes('actual=0, required=1'))).toBe(true)
  })

  it('step 3: anchor_witness_count stays null when proof fetch fails', async () => {
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/proof/')) {
        return new Response('', { status: 503 })
      }
      return makeAnchorFetch()(input as RequestInfo)
    }) as typeof fetch

    const result = await resolveIdentity(KEY, {
      fetchImpl,
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-3-proof-fetch-error'))).toBe(true)
  })

  it('step 3: rejects a checkpoint signed by a different operator key', async () => {
    const proofBundle = await makeAnchorProof()
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: otherLogPublicKey },
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(result.warnings.some((w) => w.startsWith('step-3-operator-checkpoint-invalid'))).toBe(
      true,
    )
  })

  it('step 3: rejects a signed checkpoint that does not cover the anchor log index', async () => {
    const proofBundle = await makeAnchorProof(5)
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(
      result.warnings.some((w) => w.startsWith('step-3-checkpoint-does-not-cover-anchor')),
    ).toBe(true)
  })

  it('step 3: rejects an inclusion proof that does not reconstruct the signed root', async () => {
    const proofBundle = await makeAnchorProof()
    const tampered = Buffer.from(proofBundle.inclusion_proof[0]!, 'base64')
    tampered[0] = tampered[0]! ^ 0x01
    proofBundle.inclusion_proof[0] = tampered.toString('base64')
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(result.warnings.some((w) => w.startsWith('step-3-inclusion-proof-invalid'))).toBe(true)
  })

  it('step 3: rejects a proof for a different log position', async () => {
    const proofBundle = await makeAnchorProof()
    proofBundle.log_index = 4
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(result.warnings.some((w) => w.startsWith('step-3-proof-index-mismatch'))).toBe(true)
  })

  it('step 3: leaves witness count unknown when witness retrieval fails', async () => {
    const proofBundle = await makeAnchorProof()
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
      trustedWitnessKeys: [{ name: WITNESS_A_NAME, publicKey: witnessAPublicKey }],
      fetchWitnessCosignatures: async () => {
        throw new Error('witness unavailable')
      },
    })
    expect(result.anchor?.anchor_witness_count).toBeNull()
    expect(result.warnings.some((w) => w.includes('step-3-witness-fetch-error'))).toBe(true)
  })

  it('step 3: counts zero when the verified checkpoint presents no witness evidence', async () => {
    const proofBundle = await makeAnchorProof()
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetchWithProof(proofBundle),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
      logCheckpointKey: { name: LOG_NAME, publicKey: logPublicKey },
      trustedWitnessKeys: [{ name: WITNESS_A_NAME, publicKey: witnessAPublicKey }],
      witnessNowSeconds: WITNESS_NOW,
    })
    expect(result.anchor?.anchor_witness_count).toBe(0)
  })

  it("step 3: not invoked when step 1 didn't surface an anchor", async () => {
    const result = await resolveIdentity(KEY, {
      fetchImpl: makeAnchorFetch({ logEntries: [] }),
      logEndpoint: 'http://log.test/v1',
      directoryOperatorKey: OPERATOR_KEY,
      fetchAnchorBody: makeFetchAnchorBody(),
      recordTimestamp: T_NOW,
    })
    expect(result.anchor).toBeNull()
    // The up-front step-3 warning is preserved since the actual check didn't run
    expect(result.warnings.some((w) => w.startsWith('step-3-witness-not-checked'))).toBe(true)
  })
})
