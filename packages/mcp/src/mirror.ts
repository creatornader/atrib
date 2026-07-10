// SPDX-License-Identifier: Apache-2.0

/**
 * Mirror-file inheritance helpers.
 *
 * Producers (mcp-wrap, atrib-emit, future signers) may persist their signed
 * records to a JSONL "mirror" file under `~/.atrib/records/`. The mirror is
 * the file-as-IPC channel for cross-producer chain handoff. When one
 * producer wants to chain on top of another's most recent record, it reads
 * every JSONL mirror in the configured file's directory, picks the newest
 * tail matching its context, and passes that record's canonical hash to
 * `resolveChainRoot` as `mirrorTailHex`.
 *
 * Two on-disk shapes are accepted:
 *   - Bare record per line: `{...AtribRecord fields...}\n` (mcp-wrap).
 *   - Envelope per line: `{record: {...}, proof?: ..., _local?: ...}\n`
 *     (atrib-emit; sidecar fields per D062 §5.9).
 *
 * Both shapes are normalized to an `AtribRecord` here. Any malformed or
 * unparsable line is skipped (per §5.8 degradation: never throw to caller).
 *
 * Filtering by context_id is required for the multi-producer composition
 * contract (spec §1.2.3, D067): inheriting a tail whose context_id differs
 * from the caller's would produce a malformed record (chain_root pointing
 * into a chain on a different context). When `contextId` is supplied, only
 * records on that context_id are eligible. The corpus tail index is only an
 * advisory cache. File metadata validates each read, append-only changes are
 * incorporated from new bytes, and any inconsistent state falls back to a
 * full scan.
 */

import { createReadStream } from 'node:fs'
import { open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import * as readline from 'node:readline'
import { canonicalRecord } from './canon.js'
import { resolveChainRoot, genesisChainRoot } from './chain-root.js'
import { sha256, hexEncode } from './hash.js'
import { SHA256_REF_PATTERN } from './refs.js'
import type { AtribRecord } from './types.js'

/**
 * Read the most recent record from a JSONL mirror file.
 *
 * @param opts.path Path to the mirror file. Returns null if the file does
 *   not exist (per §5.8 degradation).
 * @param opts.contextId Optional. When supplied, only the most recent record
 *   matching this context_id is returned. When omitted, the most recent
 *   record overall is returned (any context_id).
 * @returns The most recent matching record, or null if none found.
 */
export async function readMirrorTail(opts: {
  path: string
  contextId?: string | undefined
}): Promise<AtribRecord | null> {
  try {
    const stats = await stat(opts.path)
    if (stats.size === 0) return null
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      console.warn(`atrib: mirror read skipped for ${opts.path}: ${errorMessage(error)}`)
    }
    return null
  }

  // Stream line-by-line so file size doesn't bound memory. Track the most
  // recent matching record; later lines beat earlier ones (newest-wins
  // because mirrors are append-only and ordered by sign time).
  let mostRecent: AtribRecord | null = null
  try {
    const stream = createReadStream(opts.path, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseMirrorLine(trimmed)
      if (!record) continue
      if (opts.contextId && record.context_id !== opts.contextId) continue
      mostRecent = record
    }
  } catch (error) {
    console.warn(`atrib: mirror read skipped for ${opts.path}: ${errorMessage(error)}`)
    return null
  }
  return mostRecent
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recordHashHex(record: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(record)))
}

function recordTimestamp(record: AtribRecord): number {
  return Number.isFinite(record.timestamp) ? record.timestamp : Number.NEGATIVE_INFINITY
}

function isLaterCorpusTail(candidate: AtribRecord, current: AtribRecord): boolean {
  const candidateTimestamp = recordTimestamp(candidate)
  const currentTimestamp = recordTimestamp(current)
  if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp

  // Two producers can sign in the same millisecond. The record hash makes
  // that tie deterministic without depending on directory enumeration order.
  return recordHashHex(candidate) > recordHashHex(current)
}

const MIRROR_TAIL_INDEX_SCHEMA = 'atrib.mirror-tail-index.v1'
const MIRROR_TAIL_INDEX_FILE = '.atrib-mirror-tail-index-v1.json'
const MAX_INCREMENTAL_BYTES = 16 * 1024 * 1024

interface MirrorFileState {
  name: string
  size: number
  mtimeMs: number
  ctimeMs: number
  ino: number
}

interface IndexedCorpusTail {
  contextId: string
  sourceFile: string
  record: AtribRecord
}

interface MirrorTailIndex {
  schema: typeof MIRROR_TAIL_INDEX_SCHEMA
  files: MirrorFileState[]
  tails: IndexedCorpusTail[]
}

interface CorpusSnapshot {
  directory: string
  effectivePath: string
  indexPath: string
  paths: string[]
  files: MirrorFileState[]
}

interface CorpusTail {
  sourceFile: string
  record: AtribRecord
}

interface FileTailScan {
  complete: boolean
  tails: Map<string, AtribRecord>
}

interface IncrementalChange {
  path: string
  state: MirrorFileState
  start: number
}

function sameFileState(left: MirrorFileState, right: MirrorFileState): boolean {
  return (
    left.name === right.name &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino
  )
}

function sameCorpusState(left: MirrorFileState[], right: MirrorFileState[]): boolean {
  return (
    left.length === right.length &&
    left.every((state, index) => sameFileState(state, right[index]!))
  )
}

async function listMirrorCorpusPaths(effectivePath: string): Promise<string[] | null> {
  const directory = dirname(effectivePath)
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const names = new Set(
      entries
        .filter(
          (entry) => entry.name.endsWith('.jsonl') && (entry.isFile() || entry.isSymbolicLink()),
        )
        .map((entry) => entry.name),
    )

    const effectiveName = basename(effectivePath)
    if (!names.has(effectiveName)) {
      try {
        const effectiveStats = await stat(effectivePath)
        if (effectiveStats.isFile()) names.add(effectiveName)
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          console.warn(
            `atrib: configured mirror skipped for ${effectivePath}: ${errorMessage(error)}`,
          )
        }
      }
    }

    return [...names].sort().map((name) => join(directory, name))
  } catch (error) {
    console.warn(`atrib: mirror corpus scan skipped for ${directory}: ${errorMessage(error)}`)
    return null
  }
}

async function fingerprintCorpus(paths: string[]): Promise<MirrorFileState[] | null> {
  try {
    const states = await Promise.all(
      paths.map(async (path): Promise<MirrorFileState> => {
        const stats = await stat(path)
        if (!stats.isFile()) throw new Error('path is not a regular file')
        return {
          name: basename(path),
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          ino: stats.ino,
        }
      }),
    )
    return states.sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    console.warn(`atrib: mirror corpus fingerprint failed: ${errorMessage(error)}`)
    return null
  }
}

async function snapshotMirrorCorpus(effectivePath: string): Promise<CorpusSnapshot | null> {
  const paths = await listMirrorCorpusPaths(effectivePath)
  if (!paths) return null
  const files = await fingerprintCorpus(paths)
  if (!files) return null
  const directory = dirname(effectivePath)
  return {
    directory,
    effectivePath,
    indexPath: join(directory, MIRROR_TAIL_INDEX_FILE),
    paths,
    files,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMirrorFileState(value: unknown): MirrorFileState | null {
  if (!isObject(value)) return null
  const { name, size, mtimeMs, ctimeMs, ino } = value
  if (
    typeof name !== 'string' ||
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    size < 0 ||
    typeof mtimeMs !== 'number' ||
    !Number.isFinite(mtimeMs) ||
    typeof ctimeMs !== 'number' ||
    !Number.isFinite(ctimeMs) ||
    typeof ino !== 'number' ||
    !Number.isFinite(ino)
  ) {
    return null
  }
  return { name, size, mtimeMs, ctimeMs, ino }
}

async function loadMirrorTailIndex(path: string): Promise<MirrorTailIndex | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8')) as unknown
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      console.warn(`atrib: mirror tail index ignored at ${path}: ${errorMessage(error)}`)
    }
    return null
  }
  if (!isObject(parsed) || parsed['schema'] !== MIRROR_TAIL_INDEX_SCHEMA) return null
  const rawFiles = parsed['files']
  const rawTails = parsed['tails']
  if (!Array.isArray(rawFiles) || !Array.isArray(rawTails)) return null

  const files: MirrorFileState[] = []
  const fileNames = new Set<string>()
  for (const value of rawFiles) {
    const state = parseMirrorFileState(value)
    if (!state || fileNames.has(state.name)) return null
    fileNames.add(state.name)
    files.push(state)
  }
  files.sort((left, right) => left.name.localeCompare(right.name))

  const tails: IndexedCorpusTail[] = []
  const contextIds = new Set<string>()
  for (const value of rawTails) {
    if (!isObject(value)) return null
    const contextId = value['contextId']
    const sourceFile = value['sourceFile']
    const record = parseMirrorValue(value['record'])
    if (
      typeof contextId !== 'string' ||
      typeof sourceFile !== 'string' ||
      !fileNames.has(sourceFile) ||
      !record ||
      record.context_id !== contextId ||
      contextIds.has(contextId)
    ) {
      return null
    }
    try {
      recordHashHex(record)
    } catch {
      return null
    }
    contextIds.add(contextId)
    tails.push({ contextId, sourceFile, record })
  }
  tails.sort((left, right) => left.contextId.localeCompare(right.contextId))
  return { schema: MIRROR_TAIL_INDEX_SCHEMA, files, tails }
}

async function writeMirrorTailIndex(path: string, index: MirrorTailIndex): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index)}\n`, { encoding: 'utf-8', mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    console.warn(`atrib: mirror tail index write failed at ${path}: ${errorMessage(error)}`)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function scanMirrorFileTails(path: string): Promise<FileTailScan> {
  const tails = new Map<string, AtribRecord>()
  try {
    const stats = await stat(path)
    if (stats.size === 0) return { complete: true, tails }
    const stream = createReadStream(path, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseMirrorLine(trimmed)
      if (record) tails.set(record.context_id, record)
    }
    return { complete: true, tails }
  } catch (error) {
    console.warn(`atrib: mirror read skipped for ${path}: ${errorMessage(error)}`)
    return { complete: false, tails }
  }
}

async function fileEndsWithNewline(path: string, size: number): Promise<boolean> {
  if (size === 0) return true
  let handle
  try {
    handle = await open(path, 'r')
    const byte = new Uint8Array(1)
    const { bytesRead } = await handle.read(byte, 0, 1, size - 1)
    return bytesRead === 1 && byte[0] === 0x0a
  } catch (error) {
    console.warn(`atrib: mirror boundary check failed for ${path}: ${errorMessage(error)}`)
    return false
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function mergeCorpusTail(
  tails: Map<string, CorpusTail>,
  contextId: string,
  record: AtribRecord,
  sourceFile: string,
): void {
  const current = tails.get(contextId)
  if (!current || isLaterCorpusTail(record, current.record)) {
    tails.set(contextId, { sourceFile, record })
  }
}

async function scanCorpus(snapshot: CorpusSnapshot): Promise<{
  complete: boolean
  tails: Map<string, CorpusTail>
}> {
  const scans = await Promise.all(snapshot.paths.map((path) => scanMirrorFileTails(path)))
  const tails = new Map<string, CorpusTail>()
  scans.forEach((scan, index) => {
    const sourceFile = basename(snapshot.paths[index]!)
    for (const [contextId, record] of scan.tails) {
      mergeCorpusTail(tails, contextId, record, sourceFile)
    }
  })
  return { complete: scans.every((scan) => scan.complete), tails }
}

function indexFromTails(files: MirrorFileState[], tails: Map<string, CorpusTail>): MirrorTailIndex {
  return {
    schema: MIRROR_TAIL_INDEX_SCHEMA,
    files,
    tails: [...tails.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([contextId, tail]) => ({
        contextId,
        sourceFile: tail.sourceFile,
        record: tail.record,
      })),
  }
}

function tailsFromIndex(index: MirrorTailIndex): Map<string, CorpusTail> {
  return new Map(
    index.tails.map((tail) => [
      tail.contextId,
      { sourceFile: tail.sourceFile, record: tail.record },
    ]),
  )
}

function appendOnlyChanges(
  index: MirrorTailIndex,
  snapshot: CorpusSnapshot,
): IncrementalChange[] | null {
  const previous = new Map(index.files.map((state) => [state.name, state]))
  const current = new Map(snapshot.files.map((state) => [state.name, state]))
  const pathByName = new Map(snapshot.paths.map((path) => [basename(path), path]))
  const changes: IncrementalChange[] = []

  for (const oldState of index.files) {
    const newState = current.get(oldState.name)
    if (!newState || newState.ino !== oldState.ino || newState.size < oldState.size) return null
    if (newState.size === oldState.size) {
      if (!sameFileState(oldState, newState)) return null
      continue
    }
    changes.push({ path: pathByName.get(newState.name)!, state: newState, start: oldState.size })
  }
  for (const newState of snapshot.files) {
    if (!previous.has(newState.name)) {
      changes.push({ path: pathByName.get(newState.name)!, state: newState, start: 0 })
    }
  }
  return changes.sort((left, right) => left.state.name.localeCompare(right.state.name))
}

async function scanAppendedTails(change: IncrementalChange): Promise<FileTailScan> {
  const tails = new Map<string, AtribRecord>()
  const byteLength = change.state.size - change.start
  if (byteLength === 0) return { complete: true, tails }
  if (byteLength > MAX_INCREMENTAL_BYTES) return { complete: false, tails }

  let handle
  try {
    handle = await open(change.path, 'r')
    const bytes = new Uint8Array(byteLength)
    let offset = 0
    while (offset < byteLength) {
      const result = await handle.read(bytes, offset, byteLength - offset, change.start + offset)
      if (result.bytesRead === 0) return { complete: false, tails }
      offset += result.bytesRead
    }
    if (bytes[bytes.length - 1] !== 0x0a) return { complete: false, tails }
    for (const line of new TextDecoder().decode(bytes).split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseMirrorLine(trimmed)
      if (record) tails.set(record.context_id, record)
    }
    return { complete: true, tails }
  } catch (error) {
    console.warn(`atrib: mirror incremental read failed for ${change.path}: ${errorMessage(error)}`)
    return { complete: false, tails }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function tryIndexedCorpusTail(
  index: MirrorTailIndex,
  snapshot: CorpusSnapshot,
  contextId: string,
): Promise<{ usable: boolean; record: AtribRecord | null }> {
  const changes = appendOnlyChanges(index, snapshot)
  if (!changes) return { usable: false, record: null }

  const tails = tailsFromIndex(index)
  for (const change of changes) {
    const scan = await scanAppendedTails(change)
    if (!scan.complete) return { usable: false, record: null }
    for (const [changedContextId, record] of scan.tails) {
      const current = tails.get(changedContextId)
      if (current?.sourceFile === change.state.name) {
        // Append order replaces this file's prior tail. If its timestamp
        // moves backward, only a full scan can recover the runner-up tail
        // from another file without storing a much larger per-file index.
        if (!isLaterCorpusTail(record, current.record)) {
          return { usable: false, record: null }
        }
        tails.set(changedContextId, { sourceFile: change.state.name, record })
      } else if (!current || isLaterCorpusTail(record, current.record)) {
        tails.set(changedContextId, { sourceFile: change.state.name, record })
      }
    }
  }

  const after = await snapshotMirrorCorpus(snapshot.effectivePath)
  if (!after || !sameCorpusState(snapshot.files, after.files)) {
    return { usable: false, record: null }
  }

  if (changes.length > 0) {
    await writeMirrorTailIndex(snapshot.indexPath, indexFromTails(snapshot.files, tails))
  }
  return { usable: true, record: tails.get(contextId)?.record ?? null }
}

async function fullScanCorpusTail(opts: {
  path: string
  contextId: string
}): Promise<AtribRecord | null> {
  let latestTail: AtribRecord | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await snapshotMirrorCorpus(opts.path)
    if (!snapshot) return attempt === 0 ? readMirrorTail(opts) : latestTail
    const scan = await scanCorpus(snapshot)
    latestTail = scan.tails.get(opts.contextId)?.record ?? null
    const after = await snapshotMirrorCorpus(opts.path)
    if (!after || !sameCorpusState(snapshot.files, after.files)) {
      continue
    }

    const boundariesComplete = await Promise.all(
      snapshot.paths.map((path, index) => fileEndsWithNewline(path, snapshot.files[index]!.size)),
    )
    if (scan.complete && boundariesComplete.every(Boolean)) {
      await writeMirrorTailIndex(snapshot.indexPath, indexFromTails(snapshot.files, scan.tails))
    }
    return latestTail
  }
  return latestTail
}

/**
 * Read the newest matching record across the mirror corpus that contains
 * `opts.path`. Every `*.jsonl` sibling is eligible. The configured mirror
 * itself remains eligible even when a host gives it a nonstandard suffix.
 *
 * Each file keeps the established append-order rule through
 * `readMirrorTail`. Across files, signed record timestamps establish recency;
 * equal timestamps use the canonical record hash as a deterministic tie-break.
 * Missing, unreadable, and malformed siblings never reach the caller.
 */
async function readMirrorCorpusTail(opts: {
  path: string
  contextId: string
}): Promise<AtribRecord | null> {
  try {
    const snapshot = await snapshotMirrorCorpus(opts.path)
    if (!snapshot) return readMirrorTail(opts)
    const index = await loadMirrorTailIndex(snapshot.indexPath)
    if (index) {
      const indexed = await tryIndexedCorpusTail(index, snapshot, opts.contextId)
      if (indexed.usable) return indexed.record
    }
    return fullScanCorpusTail(opts)
  } catch (error) {
    console.warn(
      `atrib: mirror corpus scan failed for ${dirname(opts.path)}: ${errorMessage(error)}`,
    )
    return readMirrorTail(opts)
  }
}

/**
 * Return true when a signed-record mirror contains the requested record_hash.
 *
 * This is a producer-side validation helper for Node hosts. It accepts both
 * bare-record and envelope mirror lines, skips malformed lines, and never
 * throws to the caller. The public log may lag local signing, so callers
 * should use this for mirror-backed refs, not for parent-env spawn anchors
 * that were just signed in the parent process.
 */
export async function recordHashExistsInMirror(opts: {
  path: string
  recordHash: string
  contextId?: string | undefined
}): Promise<boolean> {
  if (!SHA256_REF_PATTERN.test(opts.recordHash)) return false
  let exists = true
  try {
    const stats = await stat(opts.path)
    if (stats.size === 0) return false
  } catch {
    exists = false
  }
  if (!exists) return false

  try {
    const stream = createReadStream(opts.path, { encoding: 'utf-8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const record = parseMirrorLine(trimmed)
      if (!record) continue
      if (opts.contextId && record.context_id !== opts.contextId) continue
      const hash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
      if (hash === opts.recordHash) return true
    }
  } catch {
    return false
  }
  return false
}

function parseMirrorValue(value: unknown): AtribRecord | null {
  if (!isObject(value)) return null
  const wrapped = value['record']
  const candidate = isObject(wrapped) ? wrapped : value
  if (
    candidate['spec_version'] !== 'atrib/1.0' ||
    typeof candidate['content_id'] !== 'string' ||
    typeof candidate['creator_key'] !== 'string' ||
    typeof candidate['signature'] !== 'string' ||
    typeof candidate['chain_root'] !== 'string' ||
    typeof candidate['event_type'] !== 'string' ||
    typeof candidate['context_id'] !== 'string' ||
    typeof candidate['timestamp'] !== 'number' ||
    !Number.isFinite(candidate['timestamp'])
  ) {
    return null
  }
  const record = candidate as unknown as AtribRecord
  try {
    canonicalRecord(record)
  } catch {
    return null
  }
  return record
}

function parseMirrorLine(line: string): AtribRecord | null {
  try {
    return parseMirrorValue(JSON.parse(line) as unknown)
  } catch {
    return null
  }
}

export interface ChainContext {
  contextId: string
  chainRoot: string
  inheritedFrom: 'caller-supplied' | 'fresh-orphan' | 'env-tail' | 'mirror-tail' | 'fresh'
}

/**
 * Resolve `{contextId, chainRoot}` for a producer about to sign a record,
 * orchestrating context_id inheritance + chain_root resolution end to end.
 *
 * Decision tree:
 *
 *   1. Caller supplies BOTH `callerContextId` and `callerChainRoot`:
 *      use both verbatim. inheritedFrom = 'caller-supplied'.
 *
 *   2. Caller supplies `callerContextId` only:
 *      - If `ATRIB_CHAIN_TAIL_<callerContextId>` env var is set with a
 *        valid `sha256:<64-hex>` value: chain to it. inheritedFrom = 'env-tail'.
 *      - Else if a mirror tail on the same `callerContextId` exists:
 *        chain to it. inheritedFrom = 'mirror-tail'.
 *      - Else: genesis chain_root for `callerContextId`. inheritedFrom = 'fresh'.
 *
 *   3. Caller supplies no `callerContextId`:
 *      Synthesize a fresh random context_id + genesis chain_root. The result
 *      is marked 'fresh-orphan' to signal that the runtime did NOT pass a
 *      session identifier to the producer (typically a Layer-2 hook miswire
 *      or a harness that doesn't expose its session_id). The orphan record
 *      lands in its own isolated context rather than being absorbed into
 *      whichever session happens to be at the mirror tail. See [D072] for
 *      the rationale; the prior 'mirror-context-and-tail' behavior collapsed
 *      every orphan into one giant pseudo-session ('1500+ records spanning
 *      6+ days under one context_id' in production), which made orphan
 *      provenance unrecoverable.
 *
 *      Consumers can identify orphans by `inheritedFrom === 'fresh-orphan'`
 *      and surface them as such; recall/trace/summarize MAY filter them.
 *
 * Inheriting only `callerContextId` from the caller WHILE pulling chain_root
 * from a mirror that is on a DIFFERENT context_id is forbidden, it would
 * produce a malformed record. The filter-by-context_id behavior in
 * `readMirrorCorpusTail` enforces this across every local mirror file.
 */
export async function inheritChainContext(opts: {
  callerContextId?: string | undefined
  callerChainRoot?: string | undefined
  mirrorPath?: string | undefined
  env?: NodeJS.ProcessEnv
  randomContextId: () => string
}): Promise<ChainContext> {
  const env = opts.env ?? process.env

  // (1) Caller manages chain state explicitly.
  if (opts.callerContextId && opts.callerChainRoot) {
    return {
      contextId: opts.callerContextId,
      chainRoot: opts.callerChainRoot,
      inheritedFrom: 'caller-supplied',
    }
  }

  // (2) Caller-supplied context, no chain_root: consult env-var, then
  // mirror filtered by context_id, then genesis.
  if (opts.callerContextId) {
    const ctxId = opts.callerContextId
    const mirrorTailRecord = opts.mirrorPath
      ? await readMirrorCorpusTail({ path: opts.mirrorPath, contextId: ctxId })
      : null
    let mirrorTailHex: string | undefined
    if (mirrorTailRecord) {
      try {
        mirrorTailHex = hexEncode(sha256(canonicalRecord(mirrorTailRecord)))
      } catch (error) {
        console.warn(`atrib: mirror corpus tail hash failed: ${errorMessage(error)}`)
      }
    }

    const chainRoot = resolveChainRoot({
      contextId: ctxId,
      mirrorTailHex,
      env,
    })

    let inheritedFrom: ChainContext['inheritedFrom']
    if (chainRoot === genesisChainRoot(ctxId)) {
      inheritedFrom = 'fresh'
    } else if (mirrorTailHex && chainRoot === `sha256:${mirrorTailHex}`) {
      inheritedFrom = 'mirror-tail'
    } else {
      inheritedFrom = 'env-tail'
    }
    return { contextId: ctxId, chainRoot, inheritedFrom }
  }

  // (3) No caller context_id, synthesize a fresh isolate. Do NOT inherit
  // context_id from the mirror tail; that absorbs records from runtimes
  // that failed to pass session_id into whichever session was active when
  // the orphan landed. The 'fresh-orphan' label distinguishes "caller
  // didn't pass context_id" from branch (2)'s 'fresh' (caller passed
  // context_id but no chain_root and the session is brand-new). Per [D072].
  const fresh = opts.randomContextId()
  return {
    contextId: fresh,
    chainRoot: genesisChainRoot(fresh),
    inheritedFrom: 'fresh-orphan',
  }
}
