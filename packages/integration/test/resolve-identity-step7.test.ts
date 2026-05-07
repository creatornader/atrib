// End-to-end integration test for §6.3 step 7 wiring.
//
// Unit tests in `@atrib/verify` exercise resolveIdentity against a STUB
// `verifyLookupProof` callback. The conformance corpus exercises the
// SDK's verifyLookupProof against fixed JSON fixtures. Neither tests
// the COMPOSITION: real proof bytes from a live AtribDirectory + the
// `/anchor` JSON envelope shape + base64url+hex decoding inside
// resolve-identity + the WASM bridge callback. A format mismatch
// between any two of those layers would slip past both layers above.
//
// This test:
//   1. Spins up an in-process AtribDirectory (HardCodedAkdVRF backend).
//   2. Publishes a signed claim under a generated keypair.
//   3. Stubs a fetch that emulates directory-node by returning the live
//      lookup result for /lookup/:key and the live snapshot for /anchor,
//      using the SAME JSON envelope shape that services/directory-node
//      ships in production (verified by checking handler code).
//   4. Calls resolveIdentity with the SDK's real verifyLookupProof
//      callback + the SDK's real directoryVrfPublicKey().
//   5. Asserts lookup_proof_valid: true AND step-7-akd-proof-not-validated
//      warning was removed AND identity_resolution_method stays
//      directory_lookup.
//
// Negative cases (tampered root, callback returns false → hard reject)
// also exercised end-to-end here, since the stub-callback unit tests
// can't reproduce the WASM bridge's actual reject behavior.

import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import * as ed25519 from '@noble/ed25519'

import {
  AtribDirectory,
  signClaim,
  directoryVrfPublicKey,
  verifyLookupProof,
  type IdentityClaim,
} from '@atrib/directory'
import { resolveIdentity } from '@atrib/verify'

async function genKeypair(): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  const privateKey = randomBytes(32)
  const pubBytes = await ed25519.getPublicKeyAsync(privateKey)
  const publicKey = Buffer.from(pubBytes).toString('base64url').replace(/=+$/, '')
  return { privateKey, publicKey }
}

/**
 * Build a fetch stub that emulates `services/directory-node` against an
 * in-process AtribDirectory. The shapes are taken from the actual
 * server.ts handlers:
 *   - /lookup/:key → { found, claim, version, proof: base64url(bincode) }
 *   - /anchor      → { epoch: number, root_hash: hex }
 */
function fetchAgainstLiveDirectory(
  dir: AtribDirectory,
  opts: { tamperRoot?: boolean } = {},
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/lookup/')) {
      const key = decodeURIComponent(url.split('/lookup/')[1]!.split(/[?#]/)[0]!)
      const result = await dir.lookup(key)
      if (!result.claim) {
        return new Response(JSON.stringify({ found: false }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          found: true,
          claim: result.claim,
          version: result.version,
          proof: Buffer.from(result.proof).toString('base64url').replace(/=+$/, ''),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/anchor')) {
      const snap = await dir.currentSnapshot()
      let rootHex = snap.root_hash
      if (opts.tamperRoot) {
        // Flip a bit so the verifier's lookup_verify rejects.
        const bytes = Buffer.from(rootHex, 'hex')
        if (bytes.length === 0) throw new Error('empty root_hash')
        bytes[0] = (bytes[0]! ^ 0x01) & 0xff
        rootHex = bytes.toString('hex')
      }
      return new Response(
        JSON.stringify({ epoch: snap.epoch, root_hash: rootHex }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 })
  }) as typeof fetch
}

describe('§6.3 step 7 — end-to-end with real AtribDirectory + real WASM bridge', () => {
  it('verifies a fresh lookup proof against the directory\'s anchored root', async () => {
    const { privateKey, publicKey } = await genKeypair()
    const dir = await AtribDirectory.create(privateKey)

    const unsigned: Omit<IdentityClaim, 'signature'> = {
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'integration-test-user' },
    }
    const signed = await signClaim(unsigned, privateKey)
    await dir.publishSigned(signed)

    const fetchImpl = fetchAgainstLiveDirectory(dir)
    const vrfPublicKey = await directoryVrfPublicKey()

    const result = await resolveIdentity(publicKey, {
      fetchImpl,
      directoryVrfPublicKey: vrfPublicKey,
      verifyLookupProof,
    })

    expect(result.identity_resolution_method).toBe('directory_lookup')
    expect(result.identity_resolved?.creator_key).toBe(publicKey)
    expect(result.identity_resolved?.claim_subject.display_name).toBe('integration-test-user')
    expect(result.lookup_proof_valid).toBe(true)
    expect(result.warnings.some((w) => w.startsWith('step-7-akd-proof-not-validated'))).toBe(false)
  })

  it('rejects the result when the directory advertises a tampered anchor root (§6.3 step 7 hard failure)', async () => {
    const { privateKey, publicKey } = await genKeypair()
    const dir = await AtribDirectory.create(privateKey)
    const signed = await signClaim(
      { creator_key: publicKey, claim_type: 'self_attested', claim_method: 'self', claim_subject: {} },
      privateKey,
    )
    await dir.publishSigned(signed)

    const fetchImpl = fetchAgainstLiveDirectory(dir, { tamperRoot: true })
    const vrfPublicKey = await directoryVrfPublicKey()

    const result = await resolveIdentity(publicKey, {
      fetchImpl,
      directoryVrfPublicKey: vrfPublicKey,
      verifyLookupProof,
    })

    expect(result.identity_resolution_method).toBe('rejected')
    expect(result.identity_resolved).toBeNull()
    expect(result.lookup_proof_valid).toBe(false)
    expect(result.warnings.some((w) => w.includes('step-7-akd-proof-invalid'))).toBe(true)
  })

  it('keeps lookup_proof_valid=null when verifyLookupProof callback is omitted (back-compat)', async () => {
    const { privateKey, publicKey } = await genKeypair()
    const dir = await AtribDirectory.create(privateKey)
    const signed = await signClaim(
      { creator_key: publicKey, claim_type: 'self_attested', claim_method: 'self', claim_subject: {} },
      privateKey,
    )
    await dir.publishSigned(signed)

    const fetchImpl = fetchAgainstLiveDirectory(dir)

    const result = await resolveIdentity(publicKey, {
      fetchImpl,
      // verifyLookupProof + directoryVrfPublicKey intentionally omitted
    })

    expect(result.identity_resolution_method).toBe('directory_lookup')
    expect(result.lookup_proof_valid).toBeNull()
    expect(result.warnings.some((w) => w.startsWith('step-7-akd-proof-not-validated'))).toBe(true)
  })
})
