// SPDX-License-Identifier: Apache-2.0

import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import {
  deriveNostrEventId,
  verifyBuzzEvent,
  verifyBuzzOwnerAttestation,
  verifyNostrEvent,
  type NostrEvent,
} from '../src/nostr-evidence.js'

const AGENT_SECRET = new Uint8Array(32).fill(2)
const OWNER_SECRET = new Uint8Array(32).fill(1)

async function signedEvent(
  overrides: Partial<Omit<NostrEvent, 'id' | 'sig'>> = {},
): Promise<NostrEvent> {
  const unsigned = {
    pubkey: bytesToHex(secp.schnorr.getPublicKey(AGENT_SECRET)),
    created_at: 1_713_956_400,
    kind: 1,
    tags: [] as string[][],
    content: 'owner-attested agent event',
    ...overrides,
  }
  const event = { ...unsigned, id: deriveNostrEventId(unsigned), sig: '' }
  event.sig = bytesToHex(await secp.schnorr.signAsync(hexToBytes(event.id), AGENT_SECRET))
  return event
}

async function ownerAuthTag(agentPubkey: string, conditions: string): Promise<string[]> {
  const message = new TextEncoder().encode(`nostr:agent-auth:${agentPubkey}:${conditions}`)
  const signature = await secp.schnorr.signAsync(sha256(message), OWNER_SECRET)
  return [
    'auth',
    bytesToHex(secp.schnorr.getPublicKey(OWNER_SECRET)),
    conditions,
    bytesToHex(signature),
  ]
}

describe('Nostr event evidence', () => {
  it('verifies the NIP-01 event ID and Schnorr signature', async () => {
    const event = await signedEvent()
    await expect(verifyNostrEvent(event)).resolves.toMatchObject({
      valid: true,
      shape_valid: true,
      event_id_valid: true,
      signature_valid: true,
      errors: [],
    })
  })

  it('rejects a content mutation even when the original signature is retained', async () => {
    const event = await signedEvent()
    event.content = 'mutated'
    await expect(verifyNostrEvent(event)).resolves.toMatchObject({
      valid: false,
      event_id_valid: false,
      signature_valid: false,
      errors: expect.arrayContaining(['event_id_mismatch', 'signature_invalid']),
    })
  })

  it('rejects coercible and non-canonical event fields', async () => {
    await expect(
      verifyNostrEvent({
        id: 'a'.repeat(64),
        pubkey: 'b'.repeat(64),
        created_at: '1713956400',
        kind: 1,
        tags: [['p', 42]],
        content: 'bad shape',
        sig: 'c'.repeat(128),
      }),
    ).resolves.toMatchObject({
      valid: false,
      shape_valid: false,
      errors: expect.arrayContaining(['created_at_format', 'tags_format']),
    })
  })
})

describe('Buzz NIP-OA evidence', () => {
  it('verifies the published Buzz NIP-OA test vector', async () => {
    const event: NostrEvent = {
      id: 'd892a65e7677e0554ebb70ee16deeb6a0727dba46450fb4bc001291d7bff971b',
      pubkey: 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      created_at: 1_713_956_400,
      kind: 1,
      tags: [
        [
          'auth',
          '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
          'kind=1&created_at<1713957000',
          '8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369',
        ],
      ],
      content: 'owner-attested agent event',
      sig: '7fd38992b70b5e9e113644e51b4c8ee2227f3bdd402b1855f8786c0600394ab3ec2621742a7bad0b0000b93d4d1ae6e39525f286a3c1029f43f46c3359a6c76f',
    }

    await expect(
      verifyBuzzEvent(event, { require_owner_attestation: true }),
    ).resolves.toMatchObject({
      valid: true,
      event: { valid: true },
      owner_attestation: {
        valid: true,
        conditions_satisfied: true,
        signature_valid: true,
      },
    })
  })

  it('verifies independent owner authorization without changing event authorship', async () => {
    const conditions = 'kind=1&created_at<1713957000'
    const agentPubkey = bytesToHex(secp.schnorr.getPublicKey(AGENT_SECRET))
    const event = await signedEvent({
      tags: [await ownerAuthTag(agentPubkey, conditions)],
    })
    await expect(verifyBuzzOwnerAttestation(event)).resolves.toMatchObject({
      present: true,
      valid: true,
      owner_pubkey: bytesToHex(secp.schnorr.getPublicKey(OWNER_SECRET)),
      conditions,
      conditions_valid: true,
      conditions_satisfied: true,
      signature_valid: true,
      errors: [],
    })
    expect(event.pubkey).toBe(agentPubkey)
  })

  it('rejects multiple owner attestations', async () => {
    const agentPubkey = bytesToHex(secp.schnorr.getPublicKey(AGENT_SECRET))
    const auth = await ownerAuthTag(agentPubkey, 'kind=1')
    const event = await signedEvent({ tags: [auth, auth] })
    await expect(verifyBuzzEvent(event)).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['multiple_auth_tags']),
    })
  })

  it('rejects an authorization whose conditions do not cover the event', async () => {
    const agentPubkey = bytesToHex(secp.schnorr.getPublicKey(AGENT_SECRET))
    const event = await signedEvent({
      tags: [await ownerAuthTag(agentPubkey, 'kind=7')],
    })
    await expect(verifyBuzzEvent(event)).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['auth_conditions_unsatisfied']),
    })
  })

  it('does not require optional owner evidence unless policy asks for it', async () => {
    const event = await signedEvent()
    await expect(verifyBuzzEvent(event)).resolves.toMatchObject({ valid: true })
    await expect(
      verifyBuzzEvent(event, { require_owner_attestation: true }),
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['owner_attestation_missing']),
    })
  })
})
