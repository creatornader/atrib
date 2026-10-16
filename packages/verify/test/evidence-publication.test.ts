// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { serializeEntry, leafHash, sha256 } from '@atrib/mcp'
import { verifyEvidencePublication } from '../src/evidence-publication.js'
import type { AnchorProofBundle } from '../src/anchor-plurality.js'

describe('source-bound publication', () => {
  it('checks exact inclusion and pinned checkpoint trust without bundle metadata', async () => {
    const recordHash = `sha256:${'a'.repeat(64)}`
    const seed = new Uint8Array(32).fill(77)
    const pub = await ed.getPublicKeyAsync(seed)
    const origin = 'offline.test/v1'
    const entry = serializeEntry({
      record_hash_hex: recordHash.slice(7),
      creator_key_b64url: Buffer.from(pub).toString('base64url'),
      context_id: 'b'.repeat(32),
      timestamp: 1000,
      event_type: 'https://atrib.dev/evidence/v1/request',
    })
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
    const body = `${origin}\n1\n${b64(leafHash(entry))}\n`
    const signature = await ed.signAsync(new TextEncoder().encode(body), seed)
    const keyPreimage = Buffer.concat([Buffer.from(`${origin}\n`), Buffer.from([1]), pub])
    const noteSignature = Buffer.concat([sha256(keyPreimage).slice(0, 4), signature])
    const proof = {
      record_hash: recordHash,
      log_proofs: [
        {
          log_id: 'offline',
          log_index: 0,
          checkpoint: `${body}\n\u2014 ${origin} ${b64(noteSignature)}`,
          inclusion_proof: [],
          entry_bytes_b64: b64(entry),
        },
      ],
    }
    const trust = { trust_material: { logs: { offline: { origin, pubkey_b64: b64(pub) } } } }
    const verify = (value: unknown = proof) =>
      verifyEvidencePublication(recordHash, {
        proofs: new Map([[recordHash, value as AnchorProofBundle]]),
        trust,
      })
    expect(await verify()).toMatchObject({ state: 'supported', basis: [recordHash] })
    expect(await verifyEvidencePublication(recordHash)).toMatchObject({
      state: 'unresolved',
      reasons: ['not_submitted'],
    })
    expect(
      await verifyEvidencePublication(recordHash, {
        proofs: new Map([[recordHash, proof]]),
        trust: {
          trust_material: { logs: { offline: { origin, pubkey_b64: b64(new Uint8Array(32)) } } },
        },
      }),
    ).toMatchObject({ state: 'rejected', reasons: ['dependency_invalid'] })
    for (const malformed of [
      null,
      42,
      { record_hash: recordHash, log_proofs: [null, 42] },
      { record_hash: recordHash, log_proofs: [] },
      {
        record_hash: recordHash,
        log_proofs: [{ log_id: 'offline', checkpoint: 'forged', inclusion_proof: [] }],
      },
      { ...proof, record_hash: `sha256:${'0'.repeat(64)}` },
    ])
      expect(await verify(malformed)).toMatchObject({
        state: 'rejected',
        reasons: ['dependency_invalid'],
      })
    expect(
      await verify({
        record_hash: recordHash,
        log_proofs: [
          { anchor_type: 'https://example.test/anchor/v1', anchor_id: 'external', proof: {} },
        ],
      }),
    ).toMatchObject({
      state: 'unresolved',
      reasons: ['https://atrib.dev/evidence/v1/reason/publication-anchor-unsupported'],
    })
  })
})
