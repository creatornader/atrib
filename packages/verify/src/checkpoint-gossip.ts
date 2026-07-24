// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import { sha256 } from '@atrib/mcp'
import {
  checkpointRootFromLeafHashes,
  verifyOperatorCheckpoint,
  type TrustedCheckpointKey,
} from './witness.js'

const encoder = new TextEncoder()

export interface CheckpointGossipObservation {
  readonly source_id: string
  readonly observed_at_ms: number
  readonly checkpoint_note: string
  /**
   * Optional complete level-zero leaf-hash view for the checkpoint. Supplying
   * it lets the verifier compare checkpoints at different tree sizes.
   */
  readonly leaf_hashes?: readonly (Uint8Array | string)[]
}

export interface VerifiedCheckpointGossipObservation {
  readonly source_id: string
  readonly observed_at_ms: number
  readonly checkpoint_hash: `sha256:${string}`
  readonly origin: string
  readonly tree_size: number
  readonly root_hash_base64url: string
  readonly leaf_hashes_verified: boolean
}

export type CheckpointGossipIssueCode =
  'source_id_invalid' | 'observed_at_invalid' | 'checkpoint_invalid' | 'leaf_hashes_invalid'

export interface CheckpointGossipIssue {
  readonly source_id: string
  readonly code: CheckpointGossipIssueCode
  readonly message: string
}

export type CheckpointGossipIncidentKind =
  'same_size_split_view' | 'prefix_split_view' | 'source_rollback'

export interface CheckpointGossipIncident {
  readonly schema: 'atrib.checkpoint-gossip-incident.v1'
  readonly incident_id: `sha256:${string}`
  readonly kind: CheckpointGossipIncidentKind
  readonly origin: string
  readonly sources: readonly string[]
  readonly observations: readonly {
    source_id: string
    observed_at_ms: number
    checkpoint_hash: `sha256:${string}`
    tree_size: number
    root_hash_base64url: string
  }[]
}

export interface CheckpointGossipReport {
  readonly status: 'consistent' | 'conflict' | 'inconclusive' | 'invalid'
  readonly observations: readonly VerifiedCheckpointGossipObservation[]
  readonly issues: readonly CheckpointGossipIssue[]
  readonly incidents: readonly CheckpointGossipIncident[]
  readonly compared_pairs: number
  readonly uncompared_pairs: number
}

export async function analyzeCheckpointGossip(
  observations: readonly CheckpointGossipObservation[],
  operatorKey: TrustedCheckpointKey,
): Promise<CheckpointGossipReport> {
  const issues: CheckpointGossipIssue[] = []
  const verified: Array<VerifiedCheckpointGossipObservation & { leafHashes?: Uint8Array[] }> = []

  for (const observation of observations) {
    if (
      observation.source_id.length === 0 ||
      observation.source_id.includes('\n') ||
      observation.source_id.includes('\r')
    ) {
      issues.push({
        source_id: observation.source_id,
        code: 'source_id_invalid',
        message: 'source_id must be non-empty and single-line',
      })
      continue
    }
    if (!Number.isSafeInteger(observation.observed_at_ms) || observation.observed_at_ms < 0) {
      issues.push({
        source_id: observation.source_id,
        code: 'observed_at_invalid',
        message: 'observed_at_ms must be a non-negative safe integer',
      })
      continue
    }
    const operator = await verifyOperatorCheckpoint(observation.checkpoint_note, operatorKey)
    if (!operator.valid || !operator.checkpoint) {
      issues.push({
        source_id: observation.source_id,
        code: 'checkpoint_invalid',
        message: operator.reason ?? 'operator checkpoint verification failed',
      })
      continue
    }
    const checkpoint = operator.checkpoint
    let leafHashes: Uint8Array[] | undefined
    if (observation.leaf_hashes !== undefined) {
      try {
        leafHashes = observation.leaf_hashes.map(normalizeLeafHash)
        if (
          leafHashes.length !== checkpoint.treeSize ||
          !bytesEqual(checkpointRootFromLeafHashes(leafHashes), checkpoint.rootHash)
        ) {
          throw new Error('leaf hashes do not reconstruct the signed checkpoint root')
        }
      } catch (error) {
        issues.push({
          source_id: observation.source_id,
          code: 'leaf_hashes_invalid',
          message: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }
    verified.push({
      source_id: observation.source_id,
      observed_at_ms: observation.observed_at_ms,
      checkpoint_hash: hashText(observation.checkpoint_note),
      origin: checkpoint.origin,
      tree_size: checkpoint.treeSize,
      root_hash_base64url: Buffer.from(checkpoint.rootHash).toString('base64url'),
      leaf_hashes_verified: leafHashes !== undefined,
      ...(leafHashes !== undefined ? { leafHashes } : {}),
    })
  }

  verified.sort(compareObservation)
  const incidents: CheckpointGossipIncident[] = []
  const incidentKeys = new Set<string>()
  let comparedPairs = 0
  let uncomparedPairs = 0

  for (let leftIndex = 0; leftIndex < verified.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < verified.length; rightIndex += 1) {
      const left = verified[leftIndex] as (typeof verified)[number]
      const right = verified[rightIndex] as (typeof verified)[number]
      if (left.origin !== right.origin) {
        uncomparedPairs += 1
        continue
      }
      if (left.tree_size === right.tree_size) {
        comparedPairs += 1
        if (left.root_hash_base64url !== right.root_hash_base64url) {
          addIncident(incidents, incidentKeys, 'same_size_split_view', left.origin, left, right)
        }
        continue
      }
      if (left.leafHashes === undefined || right.leafHashes === undefined) {
        uncomparedPairs += 1
        continue
      }
      comparedPairs += 1
      const sharedSize = Math.min(left.tree_size, right.tree_size)
      if (!hashArraysEqual(left.leafHashes, right.leafHashes, sharedSize)) {
        addIncident(incidents, incidentKeys, 'prefix_split_view', left.origin, left, right)
      }
    }
  }

  const bySource = new Map<string, typeof verified>()
  for (const observation of verified) {
    const history = bySource.get(observation.source_id) ?? []
    history.push(observation)
    bySource.set(observation.source_id, history)
  }
  for (const history of bySource.values()) {
    history.sort(
      (left, right) =>
        left.observed_at_ms - right.observed_at_ms ||
        left.checkpoint_hash.localeCompare(right.checkpoint_hash),
    )
    for (let index = 1; index < history.length; index += 1) {
      const prior = history[index - 1] as (typeof history)[number]
      const current = history[index] as (typeof history)[number]
      if (current.tree_size < prior.tree_size) {
        addIncident(incidents, incidentKeys, 'source_rollback', current.origin, prior, current)
      }
    }
  }

  incidents.sort((left, right) => left.incident_id.localeCompare(right.incident_id))
  const publicObservations = verified.map(
    ({ leafHashes: _leafHashes, ...observation }) => observation,
  )
  const status =
    incidents.length > 0
      ? 'conflict'
      : issues.length > 0
        ? 'invalid'
        : uncomparedPairs > 0
          ? 'inconclusive'
          : 'consistent'
  return {
    status,
    observations: publicObservations,
    issues,
    incidents,
    compared_pairs: comparedPairs,
    uncompared_pairs: uncomparedPairs,
  }
}

function addIncident(
  incidents: CheckpointGossipIncident[],
  keys: Set<string>,
  kind: CheckpointGossipIncidentKind,
  origin: string,
  left: VerifiedCheckpointGossipObservation,
  right: VerifiedCheckpointGossipObservation,
): void {
  const observations = [incidentObservation(left), incidentObservation(right)].sort(
    compareIncidentObservation,
  )
  const withoutId = {
    schema: 'atrib.checkpoint-gossip-incident.v1' as const,
    kind,
    origin,
    sources: [...new Set(observations.map((observation) => observation.source_id))].sort(),
    observations,
  }
  const incidentId = hashCanonical({
    schema: withoutId.schema,
    kind,
    origin,
    sources: withoutId.sources,
    observations: observations.map(
      ({ observed_at_ms: _observedAtMs, ...observation }) => observation,
    ),
  })
  if (keys.has(incidentId)) return
  keys.add(incidentId)
  incidents.push({ ...withoutId, incident_id: incidentId })
}

function incidentObservation(observation: VerifiedCheckpointGossipObservation): {
  source_id: string
  observed_at_ms: number
  checkpoint_hash: `sha256:${string}`
  tree_size: number
  root_hash_base64url: string
} {
  return {
    source_id: observation.source_id,
    observed_at_ms: observation.observed_at_ms,
    checkpoint_hash: observation.checkpoint_hash,
    tree_size: observation.tree_size,
    root_hash_base64url: observation.root_hash_base64url,
  }
}

function compareObservation(
  left: VerifiedCheckpointGossipObservation,
  right: VerifiedCheckpointGossipObservation,
): number {
  return (
    left.origin.localeCompare(right.origin) ||
    left.source_id.localeCompare(right.source_id) ||
    left.observed_at_ms - right.observed_at_ms ||
    left.checkpoint_hash.localeCompare(right.checkpoint_hash)
  )
}

function compareIncidentObservation(
  left: ReturnType<typeof incidentObservation>,
  right: ReturnType<typeof incidentObservation>,
): number {
  return (
    left.source_id.localeCompare(right.source_id) ||
    left.observed_at_ms - right.observed_at_ms ||
    left.checkpoint_hash.localeCompare(right.checkpoint_hash)
  )
}

function normalizeLeafHash(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) throw new Error('leaf hash must be 32 bytes')
    return new Uint8Array(value)
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('leaf hash must be canonical unpadded base64url')
  }
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length !== 32 || bytes.toString('base64url') !== value) {
    throw new Error('leaf hash must decode to 32 canonical bytes')
  }
  return new Uint8Array(bytes)
}

function hashArraysEqual(
  left: readonly Uint8Array[],
  right: readonly Uint8Array[],
  length: number,
): boolean {
  for (let index = 0; index < length; index += 1) {
    if (!bytesEqual(left[index] as Uint8Array, right[index] as Uint8Array)) return false
  }
  return true
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number)
  }
  return difference === 0
}

function hashText(value: string): `sha256:${string}` {
  return `sha256:${Buffer.from(sha256(encoder.encode(value))).toString('hex')}`
}

function hashCanonical(value: unknown): `sha256:${string}` {
  const json = canonicalize(value)
  if (json === undefined) throw new Error('checkpoint gossip canonicalization produced undefined')
  return hashText(json)
}
