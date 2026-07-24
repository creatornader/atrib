// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { leafHash, nodeHash } from '@atrib/mcp'
import {
  checkpointKeyId,
  checkpointRootFromLeafHashes,
  createWitnessCosignature,
  verifyCheckpointConsistencyFromLeafHashes,
  verifyCheckpointWitnessThreshold,
  verifyOperatorCheckpoint,
} from '../src/witness.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const LOG_SEED = new Uint8Array(32).fill(11)
const OTHER_LOG_SEED = new Uint8Array(32).fill(12)
const WITNESS_A_SEED = new Uint8Array(32).fill(21)
const WITNESS_B_SEED = new Uint8Array(32).fill(22)
const LOG_NAME = 'log.example/v1'
const WITNESS_A = 'witness-a.example'
const WITNESS_B = 'witness-b.example'
const NOW = 1_800_000_000

let logPublicKey: Uint8Array
let otherLogPublicKey: Uint8Array
let witnessAPublicKey: Uint8Array
let witnessBPublicKey: Uint8Array

beforeAll(async () => {
  logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
  otherLogPublicKey = await ed.getPublicKeyAsync(OTHER_LOG_SEED)
  witnessAPublicKey = await ed.getPublicKeyAsync(WITNESS_A_SEED)
  witnessBPublicKey = await ed.getPublicKeyAsync(WITNESS_B_SEED)
})

describe('operator checkpoint verification', () => {
  it('verifies a checkpoint only against the pinned log key', async () => {
    const note = await signedCheckpoint(3, Buffer.alloc(32, 7))
    expect(
      await verifyOperatorCheckpoint(note, { name: LOG_NAME, publicKey: logPublicKey }),
    ).toMatchObject({ valid: true })
    expect(
      await verifyOperatorCheckpoint(note, { name: LOG_NAME, publicKey: otherLogPublicKey }),
    ).toMatchObject({ valid: false, reason: 'checkpoint has no signature from the pinned log key' })
  })

  it('rejects a body changed after signing', async () => {
    const note = await signedCheckpoint(3, Buffer.alloc(32, 7))
    const changed = note.replace(`\n3\n`, `\n4\n`)
    expect(
      await verifyOperatorCheckpoint(changed, { name: LOG_NAME, publicKey: logPublicKey }),
    ).toMatchObject({ valid: false, reason: 'checkpoint operator signature is invalid' })
  })

  it('rejects noncanonical signature framing', async () => {
    const note = await signedCheckpoint(3, Buffer.alloc(32, 7))
    expect(
      await verifyOperatorCheckpoint(note.replace('\u2014 ', '- '), {
        name: LOG_NAME,
        publicKey: logPublicKey,
      }),
    ).toMatchObject({ valid: false, reason: 'checkpoint has no signature from the pinned log key' })
    expect(
      await verifyOperatorCheckpoint(note.trimEnd(), {
        name: LOG_NAME,
        publicKey: logPublicKey,
      }),
    ).toMatchObject({
      valid: false,
      reason: 'checkpoint signature block must end with a newline',
    })
  })
})

describe('witness cosignatures and thresholds', () => {
  it('counts distinct valid trusted witness keys', async () => {
    const operatorNote = await signedCheckpoint(3, Buffer.alloc(32, 7))
    const body = operatorNote.slice(0, operatorNote.indexOf('\n\n') + 1)
    const cosigA = await createWitnessCosignature({
      checkpointBody: body,
      witnessName: WITNESS_A,
      privateKey: WITNESS_A_SEED,
      timestampSeconds: NOW - 60,
    })
    const cosigB = await createWitnessCosignature({
      checkpointBody: body,
      witnessName: WITNESS_B,
      privateKey: WITNESS_B_SEED,
      timestampSeconds: NOW - 30,
    })
    const note = `${operatorNote.trimEnd()}\n${cosigA}${cosigA}${cosigB}`
    const result = await verifyCheckpointWitnessThreshold(note, {
      operatorKey: { name: LOG_NAME, publicKey: logPublicKey },
      witnessKeys: [
        { name: WITNESS_A, publicKey: witnessAPublicKey },
        { name: WITNESS_B, publicKey: witnessBPublicKey },
      ],
      requiredWitnesses: 2,
      nowSeconds: NOW,
    })

    expect(result.operator.valid).toBe(true)
    expect(result.validWitnesses).toBe(2)
    expect(result.thresholdMet).toBe(true)
    expect(result.witnesses).toContainEqual(
      expect.objectContaining({
        name: WITNESS_A,
        valid: false,
        reason: 'duplicate witness signature',
      }),
    )
  })

  it.each([
    ['stale', NOW - 90_000, 'witness cosignature is stale'],
    ['future', NOW + 1_000, 'witness timestamp is in the future'],
  ])('rejects a %s cosignature', async (_label, timestampSeconds, reason) => {
    const operatorNote = await signedCheckpoint(3, Buffer.alloc(32, 7))
    const body = operatorNote.slice(0, operatorNote.indexOf('\n\n') + 1)
    const cosig = await createWitnessCosignature({
      checkpointBody: body,
      witnessName: WITNESS_A,
      privateKey: WITNESS_A_SEED,
      timestampSeconds,
    })
    const result = await verifyCheckpointWitnessThreshold(`${operatorNote.trimEnd()}\n${cosig}`, {
      operatorKey: { name: LOG_NAME, publicKey: logPublicKey },
      witnessKeys: [{ name: WITNESS_A, publicKey: witnessAPublicKey }],
      nowSeconds: NOW,
    })
    expect(result.thresholdMet).toBe(false)
    expect(result.witnesses[0]).toMatchObject({ valid: false, reason })
  })
})

describe('tile-prefix consistency', () => {
  it('recomputes the current root and the pinned prior prefix', () => {
    const hashes = [1, 2, 3, 4, 5].map((value) => leafHash(Uint8Array.of(value)))
    const priorRoot = checkpointRootFromLeafHashes(hashes.slice(0, 3))
    const currentRoot = checkpointRootFromLeafHashes(hashes)
    expect(
      verifyCheckpointConsistencyFromLeafHashes(
        { treeSize: 3, rootHash: priorRoot },
        { treeSize: 5, rootHash: currentRoot },
        hashes,
      ),
    ).toBe(true)

    const rewritten = [...hashes]
    rewritten[1] = nodeHash(hashes[0] as Uint8Array, hashes[1] as Uint8Array)
    expect(
      verifyCheckpointConsistencyFromLeafHashes(
        { treeSize: 3, rootHash: priorRoot },
        { treeSize: 5, rootHash: checkpointRootFromLeafHashes(rewritten) },
        rewritten,
      ),
    ).toBe(false)
  })
})

async function signedCheckpoint(treeSize: number, rootHash: Uint8Array): Promise<string> {
  const body = `${LOG_NAME}\n${treeSize}\n${Buffer.from(rootHash).toString('base64')}\n`
  const signature = await ed.signAsync(new TextEncoder().encode(body), LOG_SEED)
  const payload = Buffer.concat([
    Buffer.from(checkpointKeyId(LOG_NAME, logPublicKey)),
    Buffer.from(signature),
  ])
  return `${body}\n\u2014 ${LOG_NAME} ${payload.toString('base64')}\n`
}
