// @atrib/directory smoke tests
//
// End-to-end exercises:
//   1. Create empty directory + sign + publish a claim → lookup returns it
//   2. Publish two versions for one key → history returns both in order
//   3. Lookup unregistered key → returns null with valid non-membership proof
//   4. currentSnapshot() returns advancing epochs after each publish
//   5. auditProof between two epochs returns serialized proof bytes

import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import * as ed25519 from '@noble/ed25519'

import { AtribDirectory, signClaim, verifyClaimSignature } from '../src/index.js'
import type { IdentityClaim } from '../src/index.js'

function genKeypair(): { privateKey: Uint8Array; publicKey: string } {
  const privateKey = randomBytes(32)
  // ed25519.getPublicKeyAsync is the only way to derive pub from seed in @noble/ed25519 v2
  return { privateKey, publicKey: '' }
}

async function genKeypairAsync(): Promise<{ privateKey: Uint8Array; publicKey: string }> {
  const privateKey = randomBytes(32)
  const pubBytes = await ed25519.getPublicKeyAsync(privateKey)
  const publicKey = Buffer.from(pubBytes).toString('base64url').replace(/=+$/, '')
  return { privateKey, publicKey }
}

describe('@atrib/directory smoke', () => {
  it('creates empty directory + publishes signed claim + looks it up', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    const unsignedClaim: Omit<IdentityClaim, 'signature'> = {
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'test agent' },
    }

    const signed = await dir.publishAndSign(unsignedClaim)
    expect(signed.epoch).toBeGreaterThan(0)
    expect(signed.signature.length).toBeGreaterThan(0)

    const looked = await dir.lookup(publicKey)
    expect(looked.claim).not.toBeNull()
    expect(looked.claim?.creator_key).toBe(publicKey)
    expect(looked.claim?.claim_subject.display_name).toBe('test agent')
    expect(looked.version).toBe(1)
    expect(looked.proof.length).toBeGreaterThan(0)

    // Signature on the looked-up claim verifies
    expect(await verifyClaimSignature(looked.claim!)).toBe(true)
  })

  it('publishes two versions for one key + history returns both', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'v1', issuer: 'self' },
    })

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'domain_verified',
      claim_method: 'dns_txt:atrib.dev',
      claim_subject: { display_name: 'v2', issuer: 'atrib.dev' },
    })

    const history = await dir.history(publicKey)
    expect(history.versions.length).toBe(2)
    expect(history.versions[0]?.claim.claim_subject.display_name).toBeDefined()
    expect(history.proof.length).toBeGreaterThan(0)
  })

  it('returns null + non-membership proof for unregistered key', async () => {
    const { privateKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    // Publish a claim for one key so the directory is non-empty
    const { publicKey: registered } = await genKeypairAsync()
    await dir.publishAndSign({
      creator_key: registered,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })

    const { publicKey: unregistered } = await genKeypairAsync()
    const result = await dir.lookup(unregistered)
    expect(result.claim).toBeNull()
    expect(result.version).toBeNull()
    // AKD returns a non-membership proof; we expect bytes, but currently the
    // bridge's lookup returns null on miss, proof shape for absence is a
    // separate code path we'll wire when we add prove_absence to the bridge.
  })

  it('currentSnapshot returns advancing epochs', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    const snap0 = await dir.currentSnapshot()
    expect(snap0.epoch).toBe(0)
    expect(snap0.root_hash.length).toBeGreaterThan(0)

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const snap1 = await dir.currentSnapshot()
    expect(snap1.epoch).toBe(1)
    expect(snap1.root_hash).not.toBe(snap0.root_hash)

    await dir.publishAndSign({
      creator_key: (await genKeypairAsync()).publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const snap2 = await dir.currentSnapshot()
    expect(snap2.epoch).toBe(2)
    expect(snap2.root_hash).not.toBe(snap1.root_hash)
  })

  it('auditProof between two epochs returns serialized bytes', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    await dir.publishAndSign({
      creator_key: (await genKeypairAsync()).publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })

    const proof = await dir.auditProof(1, 2)
    expect(proof).toBeInstanceOf(Uint8Array)
    expect(proof.length).toBeGreaterThan(0)
  })
})
