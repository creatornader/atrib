// SPDX-License-Identifier: Apache-2.0

import {
  analyzeCheckpointGossip,
  createWitnessCosignature,
  verifyCheckpointConsistencyFromLeafHashes,
  verifyOperatorCheckpoint,
  type TrustedCheckpointKey,
} from '@atrib/verify'
import { WitnessStore, type StoredWitnessState } from './store.js'

export interface WitnessLogConfig {
  logBaseUrl: string
  logKey: TrustedCheckpointKey
  gossipSources?: readonly WitnessGossipSource[]
}

export interface WitnessGossipSource {
  sourceId: string
  logBaseUrl: string
}

export interface WitnessIdentity {
  name: string
  privateKey: Uint8Array
}

export interface WitnessOnceOptions {
  log: WitnessLogConfig
  identity: WitnessIdentity
  store: WitnessStore
  fetch?: typeof globalThis.fetch
  nowSeconds?: number
  timeoutMs?: number
}

export interface WitnessOnceResult {
  status: 'witnessed' | 'unchanged'
  treeSize: number
  rootHashBase64: string
  cosignature: string
  gossipSourcesCompared: number
}

export async function witnessOnce(options: WitnessOnceOptions): Promise<WitnessOnceResult> {
  const fetcher = options.fetch ?? globalThis.fetch
  const checkpointNote = await fetchText(
    fetcher,
    `${stripTrailingSlash(options.log.logBaseUrl)}/v1/checkpoint`,
    options.timeoutMs,
  )
  const operator = await verifyOperatorCheckpoint(checkpointNote, options.log.logKey)
  if (!operator.valid || !operator.checkpoint) {
    throw new Error(`operator checkpoint rejected: ${operator.reason ?? 'unknown failure'}`)
  }
  const checkpoint = operator.checkpoint
  const rootHashBase64 = Buffer.from(checkpoint.rootHash).toString('base64')
  const prior = options.store.load(checkpoint.origin)

  if (prior && checkpoint.treeSize < prior.treeSize) {
    throw new Error(
      `checkpoint rollback: ${checkpoint.treeSize} is below witnessed size ${prior.treeSize}`,
    )
  }
  const unchanged = prior !== undefined && checkpoint.treeSize === prior.treeSize
  if (prior && checkpoint.treeSize === prior.treeSize) {
    if (rootHashBase64 !== prior.rootHashBase64) {
      throw new Error('checkpoint split view: same tree size has a different root')
    }
  }

  const priorHashes = prior ? options.store.loadLeafHashes(prior) : []
  const fetched = unchanged
    ? { appended: [], overlapStart: priorHashes.length }
    : await fetchLeafHashRange(
        fetcher,
        options.log.logBaseUrl,
        priorHashes.length,
        checkpoint.treeSize,
        options.timeoutMs,
      )
  if (fetched.overlap) {
    for (let index = 0; index < fetched.overlap.length; index += 1) {
      const absoluteIndex = fetched.overlapStart + index
      if (
        !bytesEqual(priorHashes[absoluteIndex] as Uint8Array, fetched.overlap[index] as Uint8Array)
      ) {
        throw new Error(`checkpoint split view: leaf ${absoluteIndex} changed`)
      }
    }
  }
  const leafHashes = [...priorHashes, ...fetched.appended]
  const consistent = verifyCheckpointConsistencyFromLeafHashes(
    prior ? { treeSize: prior.treeSize, rootHash: decodeHash(prior.rootHashBase64) } : undefined,
    { treeSize: checkpoint.treeSize, rootHash: checkpoint.rootHash },
    leafHashes,
  )
  if (!consistent) {
    throw new Error('checkpoint consistency verification failed')
  }

  const gossipSources = options.log.gossipSources ?? []
  if (gossipSources.length > 0) {
    const observedAtMs = (options.nowSeconds ?? Math.floor(Date.now() / 1_000)) * 1_000
    const peerObservations = await Promise.all(
      gossipSources.map(async (source) => {
        const peerCheckpointNote = await fetchText(
          fetcher,
          `${stripTrailingSlash(source.logBaseUrl)}/v1/checkpoint`,
          options.timeoutMs,
        )
        const peerOperator = await verifyOperatorCheckpoint(peerCheckpointNote, options.log.logKey)
        if (!peerOperator.valid || !peerOperator.checkpoint) {
          return {
            source_id: source.sourceId,
            observed_at_ms: observedAtMs,
            checkpoint_note: peerCheckpointNote,
          }
        }
        const peerRange = await fetchLeafHashRange(
          fetcher,
          source.logBaseUrl,
          0,
          peerOperator.checkpoint.treeSize,
          options.timeoutMs,
        )
        return {
          source_id: source.sourceId,
          observed_at_ms: observedAtMs,
          checkpoint_note: peerCheckpointNote,
          leaf_hashes: peerRange.appended,
        }
      }),
    )
    const gossip = await analyzeCheckpointGossip(
      [
        {
          source_id: `primary:${stripTrailingSlash(options.log.logBaseUrl)}`,
          observed_at_ms: observedAtMs,
          checkpoint_note: checkpointNote,
          leaf_hashes: leafHashes,
        },
        ...peerObservations,
      ],
      options.log.logKey,
    )
    for (const incident of gossip.incidents) options.store.commitIncident(incident)
    if (gossip.status !== 'consistent') {
      const incidentIds = gossip.incidents.map((incident) => incident.incident_id).join(', ')
      const detail =
        incidentIds.length > 0
          ? ` incident ${incidentIds}`
          : ` ${gossip.issues.map((issue) => `${issue.source_id}:${issue.code}`).join(', ')}`
      throw new Error(`checkpoint gossip ${gossip.status}:${detail}`)
    }
  }

  if (unchanged) {
    return {
      status: 'unchanged',
      treeSize: prior.treeSize,
      rootHashBase64,
      cosignature: prior.cosignature,
      gossipSourcesCompared: gossipSources.length,
    }
  }

  const rootHashBase64url = Buffer.from(checkpoint.rootHash).toString('base64url')
  const existingCosignature = options.store.getCosignature(checkpoint.origin, rootHashBase64url)
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const cosignature =
    existingCosignature ??
    (await createWitnessCosignature({
      checkpointBody: checkpoint.body,
      witnessName: options.identity.name,
      privateKey: options.identity.privateKey,
      timestampSeconds: nowSeconds,
    }))

  const state: StoredWitnessState = {
    logOrigin: checkpoint.origin,
    treeSize: checkpoint.treeSize,
    rootHashBase64,
    checkpointBody: checkpoint.body,
    checkpointNote,
    cosignature,
    witnessedAtSeconds: nowSeconds,
  }
  options.store.commit(state, leafHashes)
  return {
    status: 'witnessed',
    treeSize: checkpoint.treeSize,
    rootHashBase64,
    cosignature,
    gossipSourcesCompared: gossipSources.length,
  }
}

interface FetchedLeafRange {
  appended: Uint8Array[]
  overlap?: Uint8Array[]
  overlapStart: number
}

async function fetchLeafHashRange(
  fetcher: typeof globalThis.fetch,
  logBaseUrl: string,
  fromIndex: number,
  toIndex: number,
  timeoutMs = 10_000,
): Promise<FetchedLeafRange> {
  if (fromIndex < 0 || toIndex <= fromIndex) {
    if (toIndex === fromIndex) return { appended: [], overlapStart: fromIndex }
    throw new Error('invalid leaf hash range')
  }
  const firstTile = Math.floor(fromIndex / 256)
  const lastTile = Math.floor((toIndex - 1) / 256)
  const tiles = await mapConcurrent(
    Array.from({ length: lastTile - firstTile + 1 }, (_, offset) => firstTile + offset),
    16,
    async (tileIndex) => {
      const tileStart = tileIndex * 256
      const width = Math.min(256, toIndex - tileStart)
      const path =
        width === 256 ? encodeTileIndex(tileIndex) : `${encodeTileIndex(tileIndex)}.p/${width}`
      const bytes = await fetchBytes(
        fetcher,
        `${stripTrailingSlash(logBaseUrl)}/v1/tile/0/${path}`,
        timeoutMs,
      )
      if (bytes.length !== width * 32) {
        throw new Error(`hash tile ${tileIndex} returned ${bytes.length} bytes for width ${width}`)
      }
      return Array.from({ length: width }, (_, index) => bytes.slice(index * 32, (index + 1) * 32))
    },
  )
  const flattened = tiles.flat()
  const firstTileStart = firstTile * 256
  const overlapCount = fromIndex - firstTileStart
  return {
    appended: flattened.slice(overlapCount),
    ...(overlapCount > 0 ? { overlap: flattened.slice(0, overlapCount) } : {}),
    overlapStart: firstTileStart,
  }
}

export function encodeTileIndex(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('tile index must be non-negative')
  const value = String(index)
  const padded = value.padStart(Math.ceil(value.length / 3) * 3, '0')
  const groups = padded.match(/.{3}/g) as string[]
  return groups
    .map((group, position) => (position < groups.length - 1 ? `x${group}` : group))
    .join('/')
}

async function fetchText(
  fetcher: typeof globalThis.fetch,
  url: string,
  timeoutMs = 10_000,
): Promise<string> {
  return Buffer.from(await fetchArtifact(fetcher, url, timeoutMs)).toString('utf8')
}

async function fetchBytes(
  fetcher: typeof globalThis.fetch,
  url: string,
  timeoutMs: number,
): Promise<Uint8Array> {
  return fetchArtifact(fetcher, url, timeoutMs)
}

async function fetchArtifact(
  fetcher: typeof globalThis.fetch,
  url: string,
  timeoutMs: number,
): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      output[index] = await mapper(values[index] as T)
    }
  })
  await Promise.all(workers)
  return output
}

function decodeHash(value: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(value, 'base64'))
  if (bytes.length !== 32) throw new Error('stored checkpoint hash is malformed')
  return bytes
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number)
  }
  return difference === 0
}

function stripTrailingSlash(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return end === value.length ? value : value.slice(0, end)
}
