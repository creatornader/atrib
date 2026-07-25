// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rmdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  verifyJsonCommitment,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { hashCanonical } from '@atrib/runtime-log'
import {
  RUNTIME_OBSERVATION_BATCH_SCHEMA,
  verifyRuntimeObservationBatchTransition,
} from '@atrib/runtime-log/observation'
import type { OperatingEnvelope } from './model.js'
import {
  parseRuntimeObservation,
  type PortableObservationBatch,
} from './observations.js'

export const OBSERVATION_JOURNAL_SCHEMA = 'atrib.operating-observation-journal.v1' as const

export interface ObservationJournalCommit {
  readonly operation_id: string
  readonly batch_id: string
  readonly batch: PortableObservationBatch
  readonly envelope: OperatingEnvelope
}

export interface ObservationJournalState {
  readonly schema: typeof OBSERVATION_JOURNAL_SCHEMA
  readonly source: {
    readonly source_ref: string
    readonly generation_ref: string
  }
  readonly initial_cursor: Record<string, unknown>
  readonly authoritative_cursor: Record<string, unknown>
  readonly commits: readonly ObservationJournalCommit[]
}

export interface CommitObservationBatchInput {
  readonly path: string
  readonly operation_id: string
  readonly initial_cursor: Record<string, unknown>
  readonly batch: PortableObservationBatch
  readonly envelope: OperatingEnvelope
}

/**
 * Commits one signed observation envelope and its source cursor as one
 * atomic file replacement. The journal state, not a side cursor, is the
 * authoritative acknowledgment of source bytes.
 */
export async function commitObservationBatch(
  input: CommitObservationBatchInput,
): Promise<ObservationJournalState> {
  if (input.operation_id.trim() === '') throw new Error('operation_id must not be empty')
  await mkdir(dirname(input.path), { recursive: true, mode: 0o700 })
  const lockPath = `${input.path}.lock`
  const lockToken = await acquireLock(lockPath)
  try {
    const current = await readObservationJournal(input.path, {
      source_ref: input.batch.source.source_ref,
      generation_ref: input.batch.source.generation_ref,
      initial_cursor: input.initial_cursor,
    })
    await verifyObservationEnvelope(input.envelope, input.batch)
    const prior = current.commits.find((commit) => commit.operation_id === input.operation_id)
    if (prior) {
      if (prior.batch_id !== input.batch.batch_id) {
        throw new Error('operation_id was already committed with a different batch')
      }
      if (!sameCommittedEnvelope(prior.envelope, input.envelope)) {
        throw new Error('operation_id was already committed with a different signed envelope')
      }
      return current
    }
    const transition = verifyRuntimeObservationBatchTransition(
      input.batch,
      current.authoritative_cursor,
    )
    if (!transition.valid) {
      throw new Error(
        `runtime observation transition rejected: ${transition.issues
          .map((issue) => issue.code)
          .join(', ')}`,
      )
    }
    assertSourceBinding(current, input.batch)
    const next: ObservationJournalState = {
      schema: OBSERVATION_JOURNAL_SCHEMA,
      source: current.source,
      initial_cursor: current.initial_cursor,
      authoritative_cursor: input.batch.proposed_cursor,
      commits: [
        ...current.commits,
        {
          operation_id: input.operation_id,
          batch_id: input.batch.batch_id,
          batch: input.batch,
          envelope: input.envelope,
        },
      ],
    }
    await replaceState(input.path, next)
    return next
  } finally {
    await releaseLock(lockPath, lockToken)
  }
}

export async function readObservationJournal(
  path: string,
  initial: {
    readonly source_ref: string
    readonly generation_ref: string
    readonly initial_cursor: Record<string, unknown>
  },
): Promise<ObservationJournalState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        schema: OBSERVATION_JOURNAL_SCHEMA,
        source: {
          source_ref: initial.source_ref,
          generation_ref: initial.generation_ref,
        },
        initial_cursor: initial.initial_cursor,
        authoritative_cursor: initial.initial_cursor,
        commits: [],
      }
    }
    throw error
  }
  const state = parseObservationJournalState(parsed)
  if (!state) throw new Error('observation journal is malformed')
  if (
    state.source.source_ref !== initial.source_ref ||
    state.source.generation_ref !== initial.generation_ref
  ) {
    throw new Error('observation journal source binding changed')
  }
  if (!sameJson(state.initial_cursor, initial.initial_cursor)) {
    throw new Error('observation journal initial cursor changed')
  }
  await verifyObservationJournalState(state)
  return state
}

export function parseObservationJournalState(value: unknown): ObservationJournalState | null {
  if (!isObject(value) || value['schema'] !== OBSERVATION_JOURNAL_SCHEMA) return null
  if (
    !isObject(value['source']) ||
    !isObject(value['initial_cursor']) ||
    !isObject(value['authoritative_cursor'])
  ) {
    return null
  }
  const source = value['source']
  if (!nonEmptyString(source['source_ref']) || !nonEmptyString(source['generation_ref'])) {
    return null
  }
  if (!Array.isArray(value['commits'])) return null
  const commits: ObservationJournalCommit[] = []
  for (const candidate of value['commits']) {
    if (
      !isObject(candidate) ||
      !nonEmptyString(candidate['operation_id']) ||
      !nonEmptyString(candidate['batch_id']) ||
      !parsePortableObservationBatch(candidate['batch']) ||
      !isOperatingEnvelope(candidate['envelope'])
    ) {
      return null
    }
    commits.push({
      operation_id: candidate['operation_id'],
      batch_id: candidate['batch_id'],
      batch: candidate['batch'],
      envelope: candidate['envelope'],
    })
  }
  return {
    schema: OBSERVATION_JOURNAL_SCHEMA,
    source: {
      source_ref: source['source_ref'],
      generation_ref: source['generation_ref'],
    },
    initial_cursor: value['initial_cursor'],
    authoritative_cursor: value['authoritative_cursor'],
    commits,
  }
}

export async function observationJournalEnvelopes(
  value: unknown,
): Promise<readonly OperatingEnvelope[] | null> {
  const state = parseObservationJournalState(value)
  if (!state) return null
  await verifyObservationJournalState(state)
  return state.commits.map((commit) => commit.envelope)
}

async function verifyObservationEnvelope(
  envelope: OperatingEnvelope,
  batch: PortableObservationBatch,
): Promise<void> {
  if (!(await verifyRecord(envelope.record))) {
    throw new Error('observation envelope signature is invalid')
  }
  const content = envelope._local?.content
  const observation = parseRuntimeObservation(content)
  if (!content || !observation) throw new Error('observation envelope body is invalid')
  if (!bodyCommitmentMatches(envelope.record, content)) {
    throw new Error('observation envelope body does not match its signed commitment')
  }
  if (
    observation.batch.batch_id !== batch.batch_id ||
    observation.source.source_ref !== batch.source.source_ref ||
    observation.source.generation_ref !== batch.source.generation_ref
  ) {
    throw new Error('observation envelope does not bind the committed batch')
  }
}

export async function verifyObservationJournalState(
  state: ObservationJournalState,
): Promise<void> {
  let cursor = state.initial_cursor
  const operations = new Set<string>()
  for (const commit of state.commits) {
    if (operations.has(commit.operation_id)) {
      throw new Error('observation journal repeats an operation_id')
    }
    operations.add(commit.operation_id)
    if (commit.batch_id !== commit.batch.batch_id) {
      throw new Error('observation journal commit does not match its batch')
    }
    const transition = verifyRuntimeObservationBatchTransition(commit.batch, cursor)
    if (!transition.valid) {
      throw new Error(
        `observation journal batch transition is invalid: ${transition.issues
          .map((issue) => issue.code)
          .join(', ')}`,
      )
    }
    if (
      commit.batch.source.source_ref !== state.source.source_ref ||
      commit.batch.source.generation_ref !== state.source.generation_ref
    ) {
      throw new Error('observation journal commit changed the source binding')
    }
    await verifyObservationEnvelope(commit.envelope, commit.batch)
    cursor = commit.batch.proposed_cursor
  }
  if (!sameJson(state.authoritative_cursor, cursor)) {
    throw new Error('observation journal authoritative cursor does not match its history')
  }
}

function assertSourceBinding(
  state: ObservationJournalState,
  batch: PortableObservationBatch,
): void {
  if (
    state.source.source_ref !== batch.source.source_ref ||
    state.source.generation_ref !== batch.source.generation_ref
  ) {
    throw new Error('runtime observation batch does not match the journal source')
  }
}

function bodyCommitmentMatches(record: AtribRecord, content: Record<string, unknown>): boolean {
  if (!record.args_hash) return false
  return verifyJsonCommitment(content, {
    hash: record.args_hash,
    ...(record.args_salt ? { salt: record.args_salt } : {}),
  })
}

async function replaceState(path: string, state: ObservationJournalState): Promise<void> {
  const parent = dirname(path)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(state)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
    const directory = await open(parent, 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } finally {
    await handle?.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
}

async function acquireLock(lockPath: string): Promise<string> {
  const token = randomUUID()
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let created = false
    try {
      await mkdir(lockPath, { mode: 0o700 })
      created = true
      await writeFile(
        joinLockPath(lockPath),
        `${JSON.stringify({ pid: process.pid, token, acquired_at: Date.now() })}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      )
      return token
    } catch (error) {
      if (created) await rm(lockPath, { recursive: true, force: true })
      if (!isAlreadyExists(error) || !(await reclaimableLock(lockPath))) throw error
      await rm(lockPath, { recursive: true, force: true })
    }
  }
  throw new Error('observation journal lock could not be acquired')
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  try {
    const owner = parseLockOwner(JSON.parse(await readFile(joinLockPath(lockPath), 'utf8')))
    if (!owner || owner.token !== token) return
    await unlink(joinLockPath(lockPath))
    await rmdir(lockPath)
  } catch {
    // A missing or replaced lock is not ours to remove.
  }
}

async function reclaimableLock(lockPath: string): Promise<boolean> {
  try {
    const owner = parseLockOwner(JSON.parse(await readFile(joinLockPath(lockPath), 'utf8')))
    return owner !== null && !processExists(owner.pid)
  } catch {
    const lockStat = await stat(lockPath).catch(() => null)
    return lockStat !== null && Date.now() - lockStat.mtimeMs > 30_000
  }
}

function parseLockOwner(value: unknown): { pid: number; token: string } | null {
  if (
    !isObject(value) ||
    !Number.isSafeInteger(value['pid']) ||
    Number(value['pid']) <= 0 ||
    !nonEmptyString(value['token'])
  ) {
    return null
  }
  return { pid: Number(value['pid']), token: value['token'] }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isObject(error) || error['code'] !== 'ESRCH'
  }
}

function joinLockPath(lockPath: string): string {
  return `${lockPath}/owner.json`
}

function sameJson(left: unknown, right: unknown): boolean {
  return hashCanonical(left, 'left cursor') === hashCanonical(right, 'right cursor')
}

function sameCommittedEnvelope(left: OperatingEnvelope, right: OperatingEnvelope): boolean {
  return (
    hashCanonical(left.record, 'left record') === hashCanonical(right.record, 'right record') &&
    hashCanonical(left._local?.content, 'left body') ===
      hashCanonical(right._local?.content, 'right body')
  )
}

function isOperatingEnvelope(value: unknown): value is OperatingEnvelope {
  return isObject(value) && isObject(value['record'])
}

function parsePortableObservationBatch(value: unknown): value is PortableObservationBatch {
  if (!isObject(value) || value['schema'] !== RUNTIME_OBSERVATION_BATCH_SCHEMA) return false
  return (
    nonEmptyString(value['batch_id']) &&
    isObject(value['adapter']) &&
    isObject(value['source']) &&
    isObject(value['expected_cursor']) &&
    isObject(value['proposed_cursor']) &&
    Array.isArray(value['observations']) &&
    isObject(value['coverage']) &&
    Array.isArray(value['gaps']) &&
    isObject(value['claim_boundary'])
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isMissingFile(error: unknown): boolean {
  return isObject(error) && error['code'] === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return isObject(error) && error['code'] === 'EEXIST'
}
