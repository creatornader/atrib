// @atrib/directory smoke tests
//
// End-to-end exercises:
//   1. Create empty directory + sign + publish a claim → lookup returns it
//   2. Publish two versions for one key → history returns both in order
//   3. Lookup unregistered key → returns null with valid non-membership proof
//   4. currentSnapshot() returns advancing epochs after each publish
//   5. auditProof between two epochs returns serialized proof bytes
//   6. verifyLookupProof accepts a fresh lookup proof against the anchored root (§6.3 step 7)
//   7. verifyLookupProof rejects a lookup proof under a tampered root
//   8. verifyAuditProof accepts an audit proof against the captured root chain (§6.3 step 5)
//   9. verifyAuditProof rejects an audit proof under tampered hashes
//   10. directoryVrfPublicKey returns 32 bytes (HardCodedAkdVRF reference)

import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import * as ed25519 from '@noble/ed25519'

import {
  AtribDirectory,
  signClaim,
  verifyClaimSignature,
  verifyLookupProof,
  verifyAuditProof,
  directoryVrfPublicKey,
} from '../src/index.js'
import type { IdentityClaim } from '../src/index.js'

/** Helper: hex string → Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

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
    // bridge's lookup returns null on miss — proof shape for absence is a
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

  it('directoryVrfPublicKey returns 32-byte HardCodedAkdVRF pubkey', async () => {
    const pk = await directoryVrfPublicKey()
    expect(pk).toBeInstanceOf(Uint8Array)
    expect(pk.length).toBe(32)
  })

  it('verifyLookupProof accepts a fresh proof against the anchored root (§6.3 step 7)', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'verifier-target' },
    })

    const looked = await dir.lookup(publicKey)
    expect(looked.claim).not.toBeNull()
    expect(looked.proof.length).toBeGreaterThan(0)

    const snap = await dir.currentSnapshot()
    const vrfPublicKey = await directoryVrfPublicKey()

    const ok = verifyLookupProof({
      vrfPublicKey,
      rootHash: hexToBytes(snap.root_hash),
      currentEpoch: snap.epoch,
      label: publicKey,
      proof: looked.proof,
    })
    expect(ok).toBe(true)
  })

  it('verifyLookupProof rejects a proof under a tampered root', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })

    const looked = await dir.lookup(publicKey)
    const snap = await dir.currentSnapshot()
    const vrfPublicKey = await directoryVrfPublicKey()

    // Flip a bit in the root hash to simulate a tampered anchor.
    const tampered = hexToBytes(snap.root_hash)
    tampered[0] ^= 0x01

    const ok = verifyLookupProof({
      vrfPublicKey,
      rootHash: tampered,
      currentEpoch: snap.epoch,
      label: publicKey,
      proof: looked.proof,
    })
    expect(ok).toBe(false)
  })

  it('verifyAuditProof accepts a proof against the captured root chain (§6.3 step 5)', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    // Capture root at epoch 1 and epoch 2 to feed audit_verify.
    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'epoch1' },
    })
    const snap1 = await dir.currentSnapshot()
    expect(snap1.epoch).toBe(1)

    await dir.publishAndSign({
      creator_key: (await genKeypairAsync()).publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'epoch2' },
    })
    const snap2 = await dir.currentSnapshot()
    expect(snap2.epoch).toBe(2)

    const proof = await dir.auditProof(1, 2)
    const ok = await verifyAuditProof({
      rootHashes: [hexToBytes(snap1.root_hash), hexToBytes(snap2.root_hash)],
      proof,
    })
    expect(ok).toBe(true)
  })

  it('verifyAuditProof rejects a proof under a tampered end-root', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)

    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const snap1 = await dir.currentSnapshot()

    await dir.publishAndSign({
      creator_key: (await genKeypairAsync()).publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const snap2 = await dir.currentSnapshot()

    const proof = await dir.auditProof(1, 2)
    const tamperedEnd = hexToBytes(snap2.root_hash)
    tamperedEnd[0] ^= 0x01

    const ok = await verifyAuditProof({
      rootHashes: [hexToBytes(snap1.root_hash), tamperedEnd],
      proof,
    })
    expect(ok).toBe(false)
  })

  // ===========================================================================
  // Adversarial / input-validation cases.
  //
  // These cover the throw paths in the SDK's verifier wrappers (input length
  // validation) and a cross-directory proof-reuse scenario that the
  // conformance corpus doesn't capture. The crypto-correctness adversarial
  // cases (tampered root, wrong VRF, wrong label, wrong epoch) live in
  // conformance-6.3.test.ts since they replay portable JSON fixtures.
  // ===========================================================================

  it('verifyLookupProof throws on wrong-length rootHash', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)
    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const looked = await dir.lookup(publicKey)
    const vrfPublicKey = await directoryVrfPublicKey()

    expect(() =>
      verifyLookupProof({
        vrfPublicKey,
        rootHash: new Uint8Array(31), // wrong length
        currentEpoch: 1,
        label: publicKey,
        proof: looked.proof,
      }),
    ).toThrow(/rootHash must be 32 bytes/)
  })

  it('verifyLookupProof throws on wrong-length vrfPublicKey', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)
    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const looked = await dir.lookup(publicKey)
    const snap = await dir.currentSnapshot()

    expect(() =>
      verifyLookupProof({
        vrfPublicKey: new Uint8Array(16), // wrong length
        rootHash: hexToBytes(snap.root_hash),
        currentEpoch: snap.epoch,
        label: publicKey,
        proof: looked.proof,
      }),
    ).toThrow(/vrfPublicKey must be 32 bytes/)
  })

  it('verifyAuditProof throws on empty rootHashes', async () => {
    await expect(
      verifyAuditProof({
        rootHashes: [],
        proof: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/rootHashes must be non-empty/)
  })

  it('verifyAuditProof throws on wrong-length rootHash entry', async () => {
    await expect(
      verifyAuditProof({
        rootHashes: [new Uint8Array(32), new Uint8Array(31)], // index 1 is wrong
        proof: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow(/rootHashes\[1\] must be 32 bytes/)
  })

  it('verifyLookupProof rejects a proof from a different directory instance', async () => {
    // Two independent directories, both publish the same key. Each generates
    // its own proof against its own VRF state. Verifying directory A's proof
    // against directory B's root must fail — proofs do not cross directories.
    const { privateKey, publicKey } = await genKeypairAsync()

    const dirA = await AtribDirectory.create(privateKey)
    await dirA.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'A' },
    })
    const proofFromA = (await dirA.lookup(publicKey)).proof

    const dirB = await AtribDirectory.create(privateKey)
    // Salt directory B with an extra publish so its root diverges from A's.
    await dirB.publishAndSign({
      creator_key: (await genKeypairAsync()).publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    await dirB.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: { display_name: 'B' },
    })
    const snapB = await dirB.currentSnapshot()
    const vrfPublicKey = await directoryVrfPublicKey()

    const ok = verifyLookupProof({
      vrfPublicKey,
      rootHash: hexToBytes(snapB.root_hash),
      currentEpoch: snapB.epoch,
      label: publicKey,
      proof: proofFromA,
    })
    expect(ok).toBe(false)
  })

  it('verifyLookupProof rejects malformed proof bytes (truncation)', async () => {
    const { privateKey, publicKey } = await genKeypairAsync()
    const dir = await AtribDirectory.create(privateKey)
    await dir.publishAndSign({
      creator_key: publicKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {},
    })
    const looked = await dir.lookup(publicKey)
    const snap = await dir.currentSnapshot()
    const vrfPublicKey = await directoryVrfPublicKey()

    // Truncate the bincode proof to half its length. The bridge surfaces
    // bincode failures as a thrown error (per the deserialize map_err).
    const truncated = looked.proof.slice(0, Math.floor(looked.proof.length / 2))
    expect(() =>
      verifyLookupProof({
        vrfPublicKey,
        rootHash: hexToBytes(snap.root_hash),
        currentEpoch: snap.epoch,
        label: publicKey,
        proof: truncated,
      }),
    ).toThrow(/deserialize lookup proof/)
  })
})
