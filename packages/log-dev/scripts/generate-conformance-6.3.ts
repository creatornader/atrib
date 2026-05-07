/**
 * Generate spec §6.3 verifier conformance corpus fixtures.
 *
 * Run with: pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-6.3.ts
 *
 * Output: spec/conformance/6.3/verifier/cases/*.json + manifest.json
 *
 * Section §6.3 specifies the 9-step verifier consultation algorithm. The
 * primitives that lend themselves to fixture-replay are steps 5
 * (append-only consistency via audit_verify) and step 7 (lookup proof
 * verification via lookup_verify). The other steps (anchor freshness,
 * witness coverage, checkpoint signature, append-only chain wider than
 * one segment, revocation) are surfaced as warnings or output fields
 * by `resolveIdentity` and don't have a single deterministic input/output
 * pair suitable for fixture replay.
 *
 * Each case fixes the input (proof bytes, anchored root, current epoch,
 * label, vrf pubkey) + expected verify result (true / false). A
 * third-party implementation can replay every case and assert the same
 * boolean.
 *
 * The corpus is constructed via @atrib/directory's reference impl
 * (HardCodedAkdVRF over WhatsAppV1Configuration). Implementations using
 * a different VRF backend or AKD configuration will need to regenerate
 * fixtures against their own backend; the wire format (bincode-serialized
 * proofs + 32-byte roots) is shared.
 *
 * Cases:
 *
 *   lookup-verify-accept      , fresh proof against fresh anchored root
 *   lookup-verify-reject-root , same proof, single bit flipped in root
 *   lookup-verify-reject-vrf  , same proof, wrong VRF pubkey
 *   lookup-verify-reject-label, same proof, wrong label
 *   lookup-verify-reject-epoch, same proof, current_epoch < proof.version
 *
 *   audit-verify-accept-2     , clean 2-epoch chain
 *   audit-verify-accept-4     , clean 4-epoch chain
 *   audit-verify-reject-start , 2-epoch chain, tampered start hash
 *   audit-verify-reject-end   , 2-epoch chain, tampered end hash
 *   audit-verify-reject-mid   , 4-epoch chain, tampered intermediate hash
 *   audit-verify-reject-count , wrong epoch/hash count (epochs+1 != hashes)
 *
 * Seeds + labels + values are hardcoded so successive runs produce
 * byte-identical files. Re-run when:
 *   - §6.3 verifier surface changes
 *   - akd version bumps and produces different proof bytes
 *   - new cases are added
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import * as ed25519 from '@noble/ed25519'

import {
  AtribDirectory,
  directoryVrfPublicKey,
  signClaim,
  type IdentityClaim,
} from '@atrib/directory'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/6.3/verifier')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
const SEED_ALICE = new Uint8Array(32).fill(0x11)
const SEED_BOB = new Uint8Array(32).fill(0x22)
const SEED_CAROL = new Uint8Array(32).fill(0x33)
const SEED_DAVE = new Uint8Array(32).fill(0x44)

function bytesToB64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url').replace(/=+$/, '')
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function flipBit(bytes: Uint8Array, byteIdx = 0, bitMask = 0x01): Uint8Array {
  const copy = new Uint8Array(bytes)
  copy[byteIdx]! ^= bitMask
  return copy
}

function writeCase(name: string, body: Record<string, unknown>): void {
  const path = join(CASES_DIR, `${name}.json`)
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n')
}

async function publicKeyOf(seed: Uint8Array): Promise<string> {
  const pubBytes = await ed25519.getPublicKeyAsync(seed)
  return bytesToB64u(pubBytes)
}

async function unsignedSelfAttested(creatorKey: string, displayName: string): Promise<Omit<IdentityClaim, 'signature'>> {
  return {
    creator_key: creatorKey,
    claim_type: 'self_attested',
    claim_method: 'self',
    claim_subject: { display_name: displayName },
  }
}

async function main(): Promise<void> {
  const vrfPubkey = await directoryVrfPublicKey()

  const alicePub = await publicKeyOf(SEED_ALICE)
  const bobPub = await publicKeyOf(SEED_BOB)
  const carolPub = await publicKeyOf(SEED_CAROL)
  const davePub = await publicKeyOf(SEED_DAVE)

  // ---------------------------------------------------------------------
  // Lookup verify cases, single-publish directory; lookup alice.
  // ---------------------------------------------------------------------
  {
    const dir = await AtribDirectory.create(SEED_ALICE)
    const claim = await signClaim(await unsignedSelfAttested(alicePub, 'alice'), SEED_ALICE)
    await dir.publishSigned(claim)
    const looked = await dir.lookup(alicePub)
    const snap = await dir.currentSnapshot()
    const rootBytes = hexToBytes(snap.root_hash)

    const baseInput = {
      vrf_public_key_b64u: bytesToB64u(vrfPubkey),
      root_hash_hex: snap.root_hash,
      current_epoch: snap.epoch,
      label: alicePub,
      proof_b64u: bytesToB64u(looked.proof),
    }

    writeCase('lookup-verify-accept', {
      kind: 'lookup',
      description: 'Fresh lookup proof against the directory\'s anchored root verifies.',
      input: baseInput,
      expected: { verifies: true },
    })

    writeCase('lookup-verify-reject-root', {
      kind: 'lookup',
      description: 'Lookup proof under a tampered root (single bit flipped) fails.',
      input: { ...baseInput, root_hash_hex: bytesToHex(flipBit(rootBytes)) },
      expected: { verifies: false },
    })

    writeCase('lookup-verify-reject-vrf', {
      kind: 'lookup',
      description: 'Lookup proof under a wrong VRF pubkey (32 random bytes) fails.',
      input: {
        ...baseInput,
        vrf_public_key_b64u: bytesToB64u(new Uint8Array(32).fill(0xAA)),
      },
      expected: { verifies: false },
    })

    writeCase('lookup-verify-reject-label', {
      kind: 'lookup',
      description: 'Lookup proof under a wrong label (bob\'s pubkey) fails.',
      input: { ...baseInput, label: bobPub },
      expected: { verifies: false },
    })

    writeCase('lookup-verify-reject-epoch', {
      kind: 'lookup',
      description: 'Lookup proof with current_epoch < proof.version fails (akd lookup_verify guard).',
      input: { ...baseInput, current_epoch: 0 },
      expected: { verifies: false },
    })
  }

  // ---------------------------------------------------------------------
  // Audit verify cases, multi-publish; audit between captured epochs.
  // ---------------------------------------------------------------------
  {
    const dir = await AtribDirectory.create(SEED_ALICE)
    const aliceClaim = await signClaim(await unsignedSelfAttested(alicePub, 'alice'), SEED_ALICE)
    await dir.publishSigned(aliceClaim)
    const snap1 = await dir.currentSnapshot()

    const bobClaim = await signClaim(await unsignedSelfAttested(bobPub, 'bob'), SEED_BOB)
    await dir.publishSigned(bobClaim)
    const snap2 = await dir.currentSnapshot()

    const proof12 = await dir.auditProof(1, 2)
    const baseInput12 = {
      root_hashes_hex: [snap1.root_hash, snap2.root_hash],
      proof_b64u: bytesToB64u(proof12),
    }

    writeCase('audit-verify-accept-2', {
      kind: 'audit',
      description: 'Audit proof for a clean 2-epoch chain verifies.',
      input: baseInput12,
      expected: { verifies: true },
    })

    writeCase('audit-verify-reject-start', {
      kind: 'audit',
      description: 'Audit proof under tampered START hash fails.',
      input: {
        ...baseInput12,
        root_hashes_hex: [bytesToHex(flipBit(hexToBytes(snap1.root_hash))), snap2.root_hash],
      },
      expected: { verifies: false },
    })

    writeCase('audit-verify-reject-end', {
      kind: 'audit',
      description: 'Audit proof under tampered END hash fails.',
      input: {
        ...baseInput12,
        root_hashes_hex: [snap1.root_hash, bytesToHex(flipBit(hexToBytes(snap2.root_hash)))],
      },
      expected: { verifies: false },
    })

    writeCase('audit-verify-reject-count', {
      kind: 'audit',
      description: 'Audit proof rejected when epoch/hash count mismatches (epochs+1 != hashes).',
      input: {
        ...baseInput12,
        root_hashes_hex: [snap1.root_hash], // missing snap2 root
      },
      expected: { verifies: false },
    })
  }

  // 4-epoch chain for the long-chain accept + tampered-mid reject.
  {
    const dir = await AtribDirectory.create(SEED_ALICE)
    const seeds = [
      { seed: SEED_ALICE, pub: alicePub, name: 'alice' },
      { seed: SEED_BOB, pub: bobPub, name: 'bob' },
      { seed: SEED_CAROL, pub: carolPub, name: 'carol' },
      { seed: SEED_DAVE, pub: davePub, name: 'dave' },
    ]
    const rootHexes: string[] = []
    for (const { seed, pub, name } of seeds) {
      const claim = await signClaim(await unsignedSelfAttested(pub, name), seed)
      await dir.publishSigned(claim)
      const snap = await dir.currentSnapshot()
      rootHexes.push(snap.root_hash)
    }
    const proof14 = await dir.auditProof(1, 4)

    writeCase('audit-verify-accept-4', {
      kind: 'audit',
      description: 'Audit proof for a clean 4-epoch chain verifies.',
      input: {
        root_hashes_hex: rootHexes,
        proof_b64u: bytesToB64u(proof14),
      },
      expected: { verifies: true },
    })

    // Tamper one byte in the middle hash (index 2 of 4).
    const tamperedMid = [...rootHexes]
    tamperedMid[2] = bytesToHex(flipBit(hexToBytes(rootHexes[2]!)))
    writeCase('audit-verify-reject-mid', {
      kind: 'audit',
      description: 'Audit proof under tampered intermediate hash in 4-epoch chain fails.',
      input: {
        root_hashes_hex: tamperedMid,
        proof_b64u: bytesToB64u(proof14),
      },
      expected: { verifies: false },
    })
  }

  // ---------------------------------------------------------------------
  // Manifest.
  // ---------------------------------------------------------------------
  const manifest = {
    spec_section: '6.3',
    spec_title: 'Verifier consultation algorithm, proof verification primitives',
    decision_link: 'D034 (AKD) + D051 (capability declarations) + D052 (cross-attestation)',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-6.3.ts',
    backend: {
      vrf: 'HardCodedAkdVRF',
      configuration: 'WhatsAppV1Configuration',
      vrf_public_key_b64u: bytesToB64u(vrfPubkey),
    },
    cases: [
      { file: 'cases/lookup-verify-accept.json', name: 'lookup-verify-accept', kind: 'lookup' },
      { file: 'cases/lookup-verify-reject-root.json', name: 'lookup-verify-reject-root', kind: 'lookup' },
      { file: 'cases/lookup-verify-reject-vrf.json', name: 'lookup-verify-reject-vrf', kind: 'lookup' },
      { file: 'cases/lookup-verify-reject-label.json', name: 'lookup-verify-reject-label', kind: 'lookup' },
      { file: 'cases/lookup-verify-reject-epoch.json', name: 'lookup-verify-reject-epoch', kind: 'lookup' },
      { file: 'cases/audit-verify-accept-2.json', name: 'audit-verify-accept-2', kind: 'audit' },
      { file: 'cases/audit-verify-accept-4.json', name: 'audit-verify-accept-4', kind: 'audit' },
      { file: 'cases/audit-verify-reject-start.json', name: 'audit-verify-reject-start', kind: 'audit' },
      { file: 'cases/audit-verify-reject-end.json', name: 'audit-verify-reject-end', kind: 'audit' },
      { file: 'cases/audit-verify-reject-mid.json', name: 'audit-verify-reject-mid', kind: 'audit' },
      { file: 'cases/audit-verify-reject-count.json', name: 'audit-verify-reject-count', kind: 'audit' },
    ],
    note: 'These eleven cases exercise the verifier-side primitives at the heart of §6.3 steps 5 + 7. The other §6.3 steps (anchor fetch, freshness, witness coverage, checkpoint signature, revocation) surface as warnings or output fields rather than single deterministic input/output pairs and are not fixture-replayable. A third-party implementation can decode each input field, run lookup_verify or audit_verify against the AKD configuration declared in `backend`, and assert the boolean matches `expected.verifies`. Re-run the generator when akd 0.x bumps; the proof byte format is version-coupled.',
  }
  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`Wrote 11 cases + manifest to ${CORPUS_ROOT}`)
}

await main()
