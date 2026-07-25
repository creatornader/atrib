// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  checkpointKeyId,
  createWitnessCosignature,
  fetchCheckpointWitnessThreshold,
} from '../src/index.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const LOG_SEED = new Uint8Array(32).fill(11)
const WITNESS_A_SEED = new Uint8Array(32).fill(21)
const WITNESS_B_SEED = new Uint8Array(32).fill(22)
const LOG_NAME = 'log.example/v1'
const LOG_CHECKPOINT_URL = 'https://log.example/v1/checkpoint'
const WITNESS_A = 'witness-a.example'
const WITNESS_B = 'witness-b.example'
const WITNESS_A_URL = 'https://witness-a.example'
const WITNESS_B_URL = 'https://witness-b.example'
const NOW = 1_800_000_000

let logPublicKey: Uint8Array
let witnessAPublicKey: Uint8Array
let witnessBPublicKey: Uint8Array

beforeAll(async () => {
  logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
  witnessAPublicKey = await ed.getPublicKeyAsync(WITNESS_A_SEED)
  witnessBPublicKey = await ed.getPublicKeyAsync(WITNESS_B_SEED)
})

describe('endpoint-aware checkpoint witness verification', () => {
  it('fetches a caller-pinned witness cosignature and meets the threshold', async () => {
    const checkpoint = await signedCheckpoint()
    const cosigA = await witnessCosignature(checkpoint, WITNESS_A, WITNESS_A_SEED, NOW - 60)
    const fetchImpl = mockFetch({
      [LOG_CHECKPOINT_URL]: response(200, checkpoint),
      [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(200, cosigA),
    })

    const result = await verifyWith(fetchImpl)

    expect(result.checkpoint).toMatchObject({ state: 'fetched', httpStatus: 200 })
    expect(result.threshold).toMatchObject({ validWitnesses: 1, thresholdMet: true })
    expect(result.witnesses).toEqual([
      expect.objectContaining({
        name: WITNESS_A,
        transport: expect.objectContaining({ state: 'fetched' }),
        verification: expect.objectContaining({ valid: true }),
      }),
    ])
    expect(fetchImpl).toHaveBeenCalledWith(
      cosignatureUrl(WITNESS_A_URL, checkpoint),
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    )
  })

  it('reports a missing cosignature without treating it as threshold evidence', async () => {
    const checkpoint = await signedCheckpoint()
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpoint),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(404, ''),
      }),
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 0, thresholdMet: false })
    expect(result.witnesses[0]).toMatchObject({
      transport: { state: 'missing', httpStatus: 404 },
      verification: { valid: false, reason: 'witness has not cosigned this checkpoint' },
    })
  })

  it('reports a matching but invalid witness signature', async () => {
    const checkpoint = await signedCheckpoint()
    const cosigA = await witnessCosignature(checkpoint, WITNESS_A, WITNESS_A_SEED, NOW - 60)
    const badCosig = tamperCosignature(cosigA)
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpoint),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(200, badCosig),
      }),
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 0, thresholdMet: false })
    expect(result.threshold.operator.checkpoint?.signatureLines).not.toContain(badCosig.trimEnd())
    expect(result.witnesses[0]?.verification).toMatchObject({
      valid: false,
      reason: 'witness signature is invalid',
    })
  })

  it('reports a stale witness cosignature', async () => {
    const checkpoint = await signedCheckpoint()
    const cosigA = await witnessCosignature(checkpoint, WITNESS_A, WITNESS_A_SEED, NOW - 90_000)
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpoint),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(200, cosigA),
      }),
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 0, thresholdMet: false })
    expect(result.witnesses[0]?.verification).toMatchObject({
      valid: false,
      reason: 'witness cosignature is stale',
    })
  })

  it('discards witness-looking lines supplied only by the log', async () => {
    const checkpoint = await signedCheckpoint()
    const cosigA = await witnessCosignature(checkpoint, WITNESS_A, WITNESS_A_SEED, NOW - 60)
    const checkpointWithLogCosignature = `${checkpoint.trimEnd()}\n${cosigA}`
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpointWithLogCosignature),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(404, ''),
      }),
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 0, thresholdMet: false })
    expect(result.witnesses[0]?.transport).toMatchObject({ state: 'missing' })
  })

  it('rejects a valid cosignature returned by the wrong witness endpoint', async () => {
    const checkpoint = await signedCheckpoint()
    const cosigB = await witnessCosignature(checkpoint, WITNESS_B, WITNESS_B_SEED, NOW - 60)
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpoint),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(200, cosigB),
        [cosignatureUrl(WITNESS_B_URL, checkpoint)]: response(404, ''),
      }),
      {
        witnesses: [
          { name: WITNESS_A, publicKey: witnessAPublicKey, baseUrl: WITNESS_A_URL },
          { name: WITNESS_B, publicKey: witnessBPublicKey, baseUrl: WITNESS_B_URL },
        ],
      },
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 0, thresholdMet: false })
    expect(result.witnesses[0]?.verification).toMatchObject({
      valid: false,
      reason: 'untrusted witness key',
    })
    expect(result.witnesses[1]?.transport).toMatchObject({ state: 'missing' })
  })

  it('does not meet a two-witness threshold when one endpoint is unavailable', async () => {
    const checkpoint = await signedCheckpoint()
    const cosigA = await witnessCosignature(checkpoint, WITNESS_A, WITNESS_A_SEED, NOW - 60)
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpoint),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(200, cosigA),
        [cosignatureUrl(WITNESS_B_URL, checkpoint)]: response(503, ''),
      }),
      {
        witnesses: [
          { name: WITNESS_A, publicKey: witnessAPublicKey, baseUrl: WITNESS_A_URL },
          { name: WITNESS_B, publicKey: witnessBPublicKey, baseUrl: WITNESS_B_URL },
        ],
        requiredWitnesses: 2,
      },
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 1, thresholdMet: false })
    expect(result.witnesses[0]?.verification).toMatchObject({ valid: true })
    expect(result.witnesses[1]).toMatchObject({
      transport: { state: 'http_error', httpStatus: 503 },
      verification: { valid: false, reason: 'witness endpoint returned 503' },
    })
  })

  it('bounds endpoint response bodies before parsing them', async () => {
    const checkpoint = await signedCheckpoint()
    const result = await verifyWith(
      mockFetch({
        [LOG_CHECKPOINT_URL]: response(200, checkpoint),
        [cosignatureUrl(WITNESS_A_URL, checkpoint)]: response(200, 'x'.repeat(257)),
      }),
      { maxResponseBytes: 256 },
    )

    expect(result.threshold).toMatchObject({ validWitnesses: 0, thresholdMet: false })
    expect(result.witnesses[0]).toMatchObject({
      transport: {
        state: 'transport_error',
        reason: 'endpoint response exceeds 256 bytes',
      },
    })
  })
})

async function verifyWith(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof fetchCheckpointWitnessThreshold>[0]> = {},
) {
  return fetchCheckpointWitnessThreshold({
    log: { name: LOG_NAME, publicKey: logPublicKey, checkpointUrl: LOG_CHECKPOINT_URL },
    witnesses: [{ name: WITNESS_A, publicKey: witnessAPublicKey, baseUrl: WITNESS_A_URL }],
    nowSeconds: NOW,
    fetchImpl,
    ...overrides,
  })
}

function response(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

function mockFetch(responses: Record<string, Response>): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn(async (input: string | URL | Request) => {
    const url = input.toString()
    return responses[url] ?? response(404, '')
  }) as unknown as ReturnType<typeof vi.fn<typeof fetch>>
}

async function signedCheckpoint(): Promise<string> {
  const rootHash = Buffer.alloc(32, 7)
  const body = `${LOG_NAME}\n3\n${rootHash.toString('base64')}\n`
  const signature = await ed.signAsync(new TextEncoder().encode(body), LOG_SEED)
  const payload = Buffer.concat([
    Buffer.from(checkpointKeyId(LOG_NAME, logPublicKey)),
    Buffer.from(signature),
  ])
  return `${body}\n— ${LOG_NAME} ${payload.toString('base64')}\n`
}

async function witnessCosignature(
  checkpoint: string,
  witnessName: string,
  witnessSeed: Uint8Array,
  timestampSeconds: number,
): Promise<string> {
  return createWitnessCosignature({
    checkpointBody: checkpoint.slice(0, checkpoint.indexOf('\n\n') + 1),
    witnessName,
    privateKey: witnessSeed,
    timestampSeconds,
  })
}

function cosignatureUrl(baseUrl: string, checkpoint: string): string {
  const rootHash = checkpoint.split('\n')[2]!
  return `${baseUrl}/v1/cosig/${encodeURIComponent(LOG_NAME)}/${Buffer.from(
    rootHash,
    'base64',
  ).toString('base64url')}`
}

function tamperCosignature(line: string): string {
  const [prefix, token] = line.trimEnd().split(/ (?=[^ ]+$)/)
  const payload = Buffer.from(token!, 'base64')
  payload[payload.length - 1] = payload[payload.length - 1]! ^ 0x01
  return `${prefix} ${payload.toString('base64')}\n`
}
