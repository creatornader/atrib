// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { leafHash } from '@atrib/mcp'
import {
  analyzeCheckpointGossip,
  checkpointKeyId,
  checkpointRootFromLeafHashes,
  type CheckpointGossipObservation,
} from '../src/index.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const LOG_NAME = 'log.gossip.fixture/v1'
const LOG_SEED = new Uint8Array(32).fill(51)
let logPublicKey: Uint8Array

beforeAll(async () => {
  logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
})

describe('checkpoint gossip analysis', () => {
  it('detects a same-size split view and emits a deterministic incident', async () => {
    const left = hashes(1, 2, 3)
    const right = hashes(1, 9, 3)
    const observations = [
      await observation('observer-a', 100, left),
      await observation('observer-b', 101, right),
    ]

    const report = await analyzeCheckpointGossip(observations, operatorKey())
    const reversed = await analyzeCheckpointGossip([...observations].reverse(), operatorKey())
    const observedLater = await analyzeCheckpointGossip(
      observations.map((observation) => ({
        ...observation,
        observed_at_ms: observation.observed_at_ms + 1_000,
      })),
      operatorKey(),
    )

    expect(report.status).toBe('conflict')
    expect(report.compared_pairs).toBe(1)
    expect(report.uncompared_pairs).toBe(0)
    expect(report.incidents).toHaveLength(1)
    expect(report.incidents[0]).toMatchObject({
      schema: 'atrib.checkpoint-gossip-incident.v1',
      kind: 'same_size_split_view',
      origin: LOG_NAME,
      sources: ['observer-a', 'observer-b'],
    })
    expect(reversed.incidents[0]?.incident_id).toBe(report.incidents[0]?.incident_id)
    expect(observedLater.incidents[0]?.incident_id).toBe(report.incidents[0]?.incident_id)
  })

  it('detects a divergent shared prefix at different tree sizes', async () => {
    const observations = [
      await observation('observer-a', 100, hashes(1, 2, 3)),
      await observation('observer-b', 101, hashes(1, 9, 3, 4)),
    ]

    const report = await analyzeCheckpointGossip(observations, operatorKey())

    expect(report.status).toBe('conflict')
    expect(report.incidents.map((incident) => incident.kind)).toEqual(['prefix_split_view'])
  })

  it('accepts different-size checkpoints when complete leaf views prove the prefix', async () => {
    const observations = [
      await observation('observer-a', 100, hashes(1, 2, 3)),
      await observation('observer-b', 101, hashes(1, 2, 3, 4)),
    ]

    const report = await analyzeCheckpointGossip(observations, operatorKey())

    expect(report.status).toBe('consistent')
    expect(report.compared_pairs).toBe(1)
    expect(report.uncompared_pairs).toBe(0)
    expect(report.incidents).toEqual([])
    expect(report.observations.every((item) => item.leaf_hashes_verified)).toBe(true)
  })

  it('reports different-size checkpoints as inconclusive without prefix evidence', async () => {
    const smaller = await observation('observer-a', 100, hashes(1, 2, 3))
    const larger = await observation('observer-b', 101, hashes(1, 2, 3, 4))
    const observations = [
      { ...smaller, leaf_hashes: undefined },
      { ...larger, leaf_hashes: undefined },
    ]

    const report = await analyzeCheckpointGossip(observations, operatorKey())

    expect(report.status).toBe('inconclusive')
    expect(report.compared_pairs).toBe(0)
    expect(report.uncompared_pairs).toBe(1)
  })

  it('detects a source rollback from observation order', async () => {
    const observations = [
      await observation('observer-a', 100, hashes(1, 2, 3, 4)),
      await observation('observer-a', 101, hashes(1, 2, 3)),
    ]

    const report = await analyzeCheckpointGossip(observations, operatorKey())

    expect(report.status).toBe('conflict')
    expect(report.incidents.map((incident) => incident.kind)).toContain('source_rollback')
  })

  it('rejects leaf evidence that does not reconstruct its signed checkpoint', async () => {
    const valid = await observation('observer-a', 100, hashes(1, 2, 3))
    const invalid: CheckpointGossipObservation = {
      ...valid,
      leaf_hashes: hashes(1, 2, 9),
    }

    const report = await analyzeCheckpointGossip([invalid], operatorKey())

    expect(report.status).toBe('invalid')
    expect(report.observations).toEqual([])
    expect(report.issues).toEqual([
      {
        source_id: 'observer-a',
        code: 'leaf_hashes_invalid',
        message: 'leaf hashes do not reconstruct the signed checkpoint root',
      },
    ])
  })
})

function operatorKey(): { name: string; publicKey: Uint8Array } {
  return { name: LOG_NAME, publicKey: logPublicKey }
}

function hashes(...values: number[]): Uint8Array[] {
  return values.map((value) => leafHash(Uint8Array.of(value)))
}

async function observation(
  sourceId: string,
  observedAtMs: number,
  leafHashes: Uint8Array[],
): Promise<CheckpointGossipObservation> {
  return {
    source_id: sourceId,
    observed_at_ms: observedAtMs,
    checkpoint_note: await signedCheckpoint(leafHashes),
    leaf_hashes: leafHashes,
  }
}

async function signedCheckpoint(leafHashes: Uint8Array[]): Promise<string> {
  const root = checkpointRootFromLeafHashes(leafHashes)
  const body = `${LOG_NAME}\n${leafHashes.length}\n${Buffer.from(root).toString('base64')}\n`
  const signature = await ed.signAsync(new TextEncoder().encode(body), LOG_SEED)
  const payload = Buffer.concat([
    Buffer.from(checkpointKeyId(LOG_NAME, logPublicKey)),
    Buffer.from(signature),
  ])
  return `${body}\n\u2014 ${LOG_NAME} ${payload.toString('base64')}\n`
}
