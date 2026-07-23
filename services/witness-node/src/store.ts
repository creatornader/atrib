// SPDX-License-Identifier: Apache-2.0

import {
  closeSync,
  existsSync,
  ftruncateSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { CheckpointGossipIncident } from '@atrib/verify'

export interface StoredWitnessState {
  logOrigin: string
  treeSize: number
  rootHashBase64: string
  checkpointBody: string
  checkpointNote: string
  cosignature: string
  witnessedAtSeconds: number
}

export class WitnessStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
    mkdirSync(root, { recursive: true })
  }

  load(logOrigin: string): StoredWitnessState | undefined {
    const path = this.#statePath(logOrigin)
    if (!existsSync(path)) return undefined
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredWitnessState
    validateState(parsed, logOrigin)
    return parsed
  }

  getCosignature(logOrigin: string, rootHashBase64url: string): string | undefined {
    const path = this.#cosignaturePath(logOrigin, rootHashBase64url)
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined
  }

  commitIncident(incident: CheckpointGossipIncident): void {
    validateIncident(incident)
    const path = this.#incidentPath(incident.incident_id)
    const content = `${JSON.stringify(incident)}\n`
    mkdirSync(dirname(path), { recursive: true })
    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, 'utf8')) as CheckpointGossipIncident
      validateIncident(existing)
      if (incidentIdentity(existing) !== incidentIdentity(incident)) {
        throw new Error('refusing to replace an immutable checkpoint gossip incident')
      }
      return
    }
    writeDurably(path, content)
  }

  getIncident(incidentId: string): CheckpointGossipIncident | undefined {
    const path = this.#incidentPath(incidentId)
    if (!existsSync(path)) return undefined
    const incident = JSON.parse(readFileSync(path, 'utf8')) as CheckpointGossipIncident
    validateIncident(incident)
    return incident
  }

  listIncidents(): CheckpointGossipIncident[] {
    const directory = join(this.#root, 'incidents')
    if (!existsSync(directory)) return []
    return readdirSync(directory)
      .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
      .sort()
      .map((name) => {
        const incident = JSON.parse(
          readFileSync(join(directory, name), 'utf8'),
        ) as CheckpointGossipIncident
        validateIncident(incident)
        return incident
      })
  }

  loadLeafHashes(state: StoredWitnessState): Uint8Array[] {
    const path = this.#leafHashesPath(state.logOrigin)
    if (!existsSync(path)) throw new Error('stored witness leaf history is missing')
    const bytes = readFileSync(path)
    const committedLength = state.treeSize * 32
    if (bytes.length < committedLength) {
      throw new Error('stored witness leaf history is shorter than the committed checkpoint')
    }
    return Array.from({ length: state.treeSize }, (_, index) =>
      bytes.subarray(index * 32, (index + 1) * 32),
    )
  }

  commit(state: StoredWitnessState, leafHashes: readonly Uint8Array[]): void {
    validateState(state, state.logOrigin)
    if (leafHashes.length !== state.treeSize || leafHashes.some((hash) => hash.length !== 32)) {
      throw new Error('witness leaf history does not match the checkpoint tree size')
    }
    const prior = this.load(state.logOrigin)
    if (prior && state.treeSize < prior.treeSize) {
      throw new Error('refusing to commit a witness checkpoint rollback')
    }
    writeLeafHashesDurably(this.#leafHashesPath(state.logOrigin), leafHashes, prior?.treeSize ?? 0)
    const rootHashBase64url = Buffer.from(state.rootHashBase64, 'base64').toString('base64url')
    const cosignaturePath = this.#cosignaturePath(state.logOrigin, rootHashBase64url)
    mkdirSync(dirname(cosignaturePath), { recursive: true })
    if (existsSync(cosignaturePath)) {
      const existing = readFileSync(cosignaturePath, 'utf8')
      if (existing !== state.cosignature) {
        throw new Error('refusing to replace an immutable witness cosignature')
      }
    } else {
      writeDurably(cosignaturePath, state.cosignature)
    }
    writeDurably(this.#statePath(state.logOrigin), `${JSON.stringify(state)}\n`)
  }

  #statePath(logOrigin: string): string {
    return join(this.#root, `${stableName(logOrigin)}.json`)
  }

  #leafHashesPath(logOrigin: string): string {
    return join(this.#root, `${stableName(logOrigin)}.leaves`)
  }

  #cosignaturePath(logOrigin: string, rootHashBase64url: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rootHashBase64url)) {
      throw new Error('root hash must be 32-byte base64url')
    }
    return join(this.#root, 'cosigs', stableName(logOrigin), `${rootHashBase64url}.txt`)
  }

  #incidentPath(incidentId: string): string {
    if (!/^sha256:[0-9a-f]{64}$/.test(incidentId)) {
      throw new Error('checkpoint gossip incident id must be a SHA-256 URI')
    }
    return join(this.#root, 'incidents', `${incidentId.slice('sha256:'.length)}.json`)
  }
}

function writeLeafHashesDurably(
  path: string,
  hashes: readonly Uint8Array[],
  committedCount: number,
): void {
  if (committedCount > hashes.length) {
    throw new Error('committed witness leaf count exceeds the new checkpoint')
  }
  mkdirSync(dirname(path), { recursive: true })
  const existed = existsSync(path)
  const fd = openSync(path, existed ? 'r+' : 'w+', 0o600)
  try {
    const committedLength = committedCount * 32
    ftruncateSync(fd, committedLength)
    let offset = committedLength
    for (const hash of hashes.slice(committedCount)) {
      const bytes = Buffer.from(hash)
      let hashOffset = 0
      while (hashOffset < bytes.length) {
        const written = writeSync(
          fd,
          bytes,
          hashOffset,
          bytes.length - hashOffset,
          offset + hashOffset,
        )
        if (written <= 0) throw new Error('durable witness leaf write made no progress')
        hashOffset += written
      }
      offset += bytes.length
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (!existed) fsyncDirectory(dirname(path))
}

function stableName(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function writeDurably(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    const bytes = Buffer.from(content)
    let offset = 0
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset, null)
      if (written <= 0) throw new Error('durable witness write made no progress')
      offset += written
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
  fsyncDirectory(dirname(path))
}

function fsyncDirectory(path: string): void {
  const directoryFd = openSync(path, 'r')
  try {
    fsyncSync(directoryFd)
  } finally {
    closeSync(directoryFd)
  }
}

function validateState(state: StoredWitnessState, expectedOrigin: string): void {
  if (
    state.logOrigin !== expectedOrigin ||
    !Number.isSafeInteger(state.treeSize) ||
    state.treeSize < 1 ||
    Buffer.from(state.rootHashBase64, 'base64').length !== 32 ||
    !state.checkpointBody.endsWith('\n') ||
    !state.checkpointNote.includes('\n\n') ||
    !state.cosignature.endsWith('\n') ||
    !Number.isSafeInteger(state.witnessedAtSeconds)
  ) {
    throw new Error('stored witness state is malformed')
  }
}

function validateIncident(incident: CheckpointGossipIncident): void {
  if (
    incident.schema !== 'atrib.checkpoint-gossip-incident.v1' ||
    !/^sha256:[0-9a-f]{64}$/.test(incident.incident_id) ||
    incident.origin.length === 0 ||
    incident.sources.length === 0 ||
    incident.observations.length < 2
  ) {
    throw new Error('checkpoint gossip incident is malformed')
  }
}

function incidentIdentity(incident: CheckpointGossipIncident): string {
  return JSON.stringify({
    incident_id: incident.incident_id,
    kind: incident.kind,
    origin: incident.origin,
    sources: incident.sources,
    observations: incident.observations.map(
      ({ observed_at_ms: _observedAtMs, ...observation }) => observation,
    ),
  })
}
