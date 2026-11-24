// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import * as readline from 'node:readline'
import { canonicalRecord } from './canon.js'
import { hexEncode, sha256 } from './hash.js'
import { recordHashExistsInMirror } from './mirror.js'
import { SHA256_REF_PATTERN } from './refs.js'
import type { AtribRecord } from './types.js'
import { hasCreatorSignerEntry } from './types.js'

export type RecordReferenceResolution = 'found' | 'not-found' | 'unknown'

export interface DefaultRecordReferenceResolverOptions {
  /**
   * Optional wall-clock budget for local mirror scanning. When exceeded, log
   * lookup may still prove the record exists, but a miss is reported as
   * `unknown` because local evidence was not fully searched.
   */
  localLookupTimeoutMs?: number | undefined
  /** Optional wall-clock budget for public log lookup. Defaults to 750ms. */
  logLookupTimeoutMs?: number | undefined
  /**
   * Explicit local mirror files for this lookup. When present, these replace
   * process-global mirror discovery while public log fallback stays enabled.
   */
  localMirrorPaths?: readonly string[] | undefined
}

export type LocalRecordReferenceResolver = (
  recordHash: string,
) => RecordReferenceResolution | Promise<RecordReferenceResolution>

interface LocalMirrorFileState {
  size: number
  mtimeMs: number
  ctimeMs: number
  ino: number
}

interface LocalMirrorFileCacheEntry extends LocalMirrorFileState {
  hashes: Set<string>
  endedWithNewline: boolean
  /** sha256 hex of the last RECORD_HASH_INDEX_TAIL_BYTES bytes before `size`. */
  tailSha256: string
  /** File size the on-disk index entry covers, when one exists. */
  persistedSize?: number | undefined
}

// Persisted beside each mirror directory so short-lived producers, such as
// one atrib-emit-cli process per record, do not rehash the whole corpus on
// every spawn. It is an advisory cache: file metadata and a tail digest
// validate every entry, appended bytes are scanned incrementally, and any
// truncation, replacement, or rewrite falls back to a full scan of that file.
const RECORD_HASH_INDEX_SCHEMA = 'atrib.record-hash-index.v1'
const RECORD_HASH_INDEX_FILE = '.atrib-record-hash-index-v1.json'
const RECORD_HASH_INDEX_TAIL_BYTES = 4096
// Rewriting the index costs time proportional to the whole corpus, so a
// producer that appends one row per process must not rewrite it every time.
// Until this many bytes are appended, the next process rescans that tail.
const RECORD_HASH_INDEX_REWRITE_BYTES = 256 * 1024
const HEX64_PATTERN = /^[0-9a-f]{64}$/

let localRecordHashCache: Set<string> | undefined
let localRecordHashCacheLoad: Promise<Set<string>> | undefined
let localMirrorFileCaches = new Map<string, LocalMirrorFileCacheEntry>()
let localMirrorFullFileScansForTests = 0
let localMirrorAppendFileScansForTests = 0
let localMirrorReusedFileCachesForTests = 0
let localMirrorPersistedFileCachesForTests = 0
let afterMirrorScanHookForTests: ((file: string) => Promise<void>) | undefined

/**
 * Resolve a record_hash against local mirrors first, then the public log.
 *
 * `found` means the producer has enough evidence to keep an `informed_by`
 * edge. `not-found` means lookup succeeded and the ref is absent. `unknown`
 * means the validation substrate failed, so callers that require validated
 * refs should drop the candidate without blocking the wrapped tool call.
 */
export async function defaultRecordReferenceResolver(
  recordHash: string,
  logEndpoint?: string | undefined,
  options: DefaultRecordReferenceResolverOptions = {},
): Promise<RecordReferenceResolution> {
  if (!SHA256_REF_PATTERN.test(recordHash)) return 'not-found'

  let localLookupIncomplete = false
  try {
    const localLookup =
      options.localMirrorPaths !== undefined
        ? hasRecordHashInExplicitMirrors(recordHash, options.localMirrorPaths)
        : hasLocalRecordHash(recordHash)
    const localResult = await withOptionalTimeout(localLookup, options.localLookupTimeoutMs)
    if (localResult === 'timeout') {
      localLookupIncomplete = true
    } else if (localResult) {
      return 'found'
    }
  } catch {
    localLookupIncomplete = true
  }

  const logResolution = await lookupLogRecord(recordHash, logEndpoint, options.logLookupTimeoutMs)
  if (logResolution === 'found') return 'found'
  return localLookupIncomplete ? 'unknown' : logResolution
}

async function hasRecordHashInExplicitMirrors(
  recordHash: string,
  paths: readonly string[],
): Promise<boolean> {
  for (const path of new Set(paths)) {
    if (await recordHashExistsInMirror({ path, recordHash })) return true
  }
  return false
}

async function hasLocalRecordHash(recordHash: string): Promise<boolean> {
  localRecordHashCache ??= await refreshLocalRecordHashCache()
  if (localRecordHashCache.has(recordHash)) return true

  localRecordHashCache = await refreshLocalRecordHashCache()
  return localRecordHashCache.has(recordHash)
}

async function refreshLocalRecordHashCache(): Promise<Set<string>> {
  localRecordHashCacheLoad ??= loadLocalRecordHashes()
    .then((hashes) => {
      localRecordHashCache = hashes
      return hashes
    })
    .finally(() => {
      localRecordHashCacheLoad = undefined
    })
  return localRecordHashCacheLoad
}

async function loadLocalRecordHashes(): Promise<Set<string>> {
  const hashes = new Set<string>()
  const files = await localMirrorFiles()
  const nextFileCaches = new Map<string, LocalMirrorFileCacheEntry>()
  const persistedByDirectory = new Map<string, Map<string, LocalMirrorFileCacheEntry>>()
  const changedDirectories = new Set<string>()

  for (const file of files) {
    try {
      const fileStat = await stat(file)
      if (!fileStat.isFile()) continue
      const state: LocalMirrorFileState = {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        ctimeMs: fileStat.ctimeMs,
        ino: fileStat.ino,
      }
      const directory = dirname(file)
      let previous = localMirrorFileCaches.get(file)
      let previousFromDisk = false
      if (!previous) {
        let persisted = persistedByDirectory.get(directory)
        if (!persisted) {
          persisted = await readRecordHashIndex(directory)
          persistedByDirectory.set(directory, persisted)
        }
        previous = persisted.get(basename(file))
        previousFromDisk = previous !== undefined
      }

      let entry: LocalMirrorFileCacheEntry
      if (previous && sameLocalMirrorFileState(previous, state)) {
        entry = previous
        if (previousFromDisk) localMirrorPersistedFileCachesForTests += 1
        else localMirrorReusedFileCachesForTests += 1
      } else {
        const resumeFrom =
          previous && (await canResumeAfter(file, previous, state)) ? previous : undefined
        const scan = await scanFileEntry(file, state, resumeFrom)
        if (resumeFrom) localMirrorAppendFileScansForTests += 1
        else localMirrorFullFileScansForTests += 1
        for (const hash of scan.entry.hashes) hashes.add(hash)
        // The file changed under the scan in a way an append cannot explain.
        // The hashes still serve this lookup, but they are not cached.
        if (!scan.stable) continue
        entry = scan.entry
        if (
          entry.persistedSize === undefined ||
          entry.size - entry.persistedSize >= RECORD_HASH_INDEX_REWRITE_BYTES
        ) {
          changedDirectories.add(directory)
        }
      }

      nextFileCaches.set(file, entry)
      for (const hash of entry.hashes) hashes.add(hash)
    } catch {
      continue
    }
  }

  localMirrorFileCaches = nextFileCaches
  for (const directory of changedDirectories) {
    await writeRecordHashIndex(directory, nextFileCaches)
  }
  return hashes
}

function sameLocalMirrorFileState(
  left: LocalMirrorFileState,
  right: LocalMirrorFileState,
): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino
  )
}

// Same-inode growth after an in-place rewrite would look like an append, so
// the bytes that ended the earlier read must still be there unchanged.
async function canResumeAfter(
  file: string,
  previous: LocalMirrorFileCacheEntry,
  state: LocalMirrorFileState,
): Promise<boolean> {
  if (previous.ino !== state.ino || previous.size >= state.size || !previous.endedWithNewline) {
    return false
  }
  return (await tailDigest(file, previous.size)) === previous.tailSha256
}

// Scans [resumeFrom.size, state.size), or the whole file. The tail digest is
// taken before and after the read: a truncation or rewrite that lands during
// the scan would otherwise be cached under metadata that no longer describes
// the bytes that were hashed. Concurrent appends leave both checks intact.
async function scanFileEntry(
  file: string,
  state: LocalMirrorFileState,
  resumeFrom: LocalMirrorFileCacheEntry | undefined,
): Promise<{ entry: LocalMirrorFileCacheEntry; stable: boolean }> {
  const tailSha256 = await tailDigest(file, state.size)
  const hashes = new Set(resumeFrom?.hashes)
  await collectFileHashes(file, hashes, resumeFrom?.size ?? 0, state.size)
  const endedWithNewline = await fileEndsWithNewline(file, state.size)
  if (afterMirrorScanHookForTests) await afterMirrorScanHookForTests(file)

  let stable: boolean
  try {
    const after = await stat(file)
    stable =
      after.ino === state.ino &&
      (after.size > state.size ||
        (after.size === state.size &&
          after.mtimeMs === state.mtimeMs &&
          after.ctimeMs === state.ctimeMs)) &&
      (await tailDigest(file, state.size)) === tailSha256
  } catch {
    stable = false
  }
  return {
    entry: {
      ...state,
      hashes,
      endedWithNewline,
      tailSha256,
      persistedSize: resumeFrom?.persistedSize,
    },
    stable,
  }
}

// Reads only [start, end) so the cached hashes match the stat that keys them,
// even while another producer keeps appending.
async function collectFileHashes(
  file: string,
  hashes: Set<string>,
  start: number,
  end: number,
): Promise<void> {
  if (end <= start) return
  const stream = createReadStream(file, { encoding: 'utf8', start, end: end - 1 })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as unknown
      collectMirrorHashes(parsed, hashes)
    } catch {
      continue
    }
  }
}

async function tailDigest(file: string, size: number): Promise<string> {
  const length = Math.min(size, RECORD_HASH_INDEX_TAIL_BYTES)
  const bytes = new Uint8Array(length)
  if (length > 0) {
    const handle = await open(file, 'r')
    try {
      let offset = 0
      while (offset < length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset,
          length - offset,
          size - length + offset,
        )
        if (bytesRead === 0) throw new Error('mirror shrank during read')
        offset += bytesRead
      }
    } finally {
      await handle.close().catch(() => {})
    }
  }
  return hexEncode(sha256(bytes))
}

async function readRecordHashIndex(
  directory: string,
): Promise<Map<string, LocalMirrorFileCacheEntry>> {
  const entries = new Map<string, LocalMirrorFileCacheEntry>()
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(directory, RECORD_HASH_INDEX_FILE), 'utf8')) as unknown
  } catch {
    return entries
  }
  if (!isPlainObject(parsed) || parsed['schema'] !== RECORD_HASH_INDEX_SCHEMA) return entries
  const files = parsed['files']
  if (!Array.isArray(files)) return entries
  for (const value of files) {
    const entry = parseRecordHashIndexEntry(value)
    // One malformed entry makes the whole index suspect.
    if (!entry || entries.has(entry.name)) return new Map()
    entries.set(entry.name, entry.entry)
  }
  return entries
}

function parseRecordHashIndexEntry(
  value: unknown,
): { name: string; entry: LocalMirrorFileCacheEntry } | null {
  if (!isPlainObject(value)) return null
  const { name, size, mtimeMs, ctimeMs, ino, endedWithNewline, tailSha256, hashes } = value
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name !== basename(name) ||
    !isNonNegativeFinite(size) ||
    !isNonNegativeFinite(mtimeMs) ||
    !isNonNegativeFinite(ctimeMs) ||
    !isNonNegativeFinite(ino) ||
    typeof endedWithNewline !== 'boolean' ||
    typeof tailSha256 !== 'string' ||
    !HEX64_PATTERN.test(tailSha256) ||
    !Array.isArray(hashes)
  ) {
    return null
  }
  const set = new Set<string>()
  for (const hash of hashes) {
    if (typeof hash !== 'string' || !HEX64_PATTERN.test(hash)) return null
    set.add(`sha256:${hash}`)
  }
  return {
    name,
    entry: {
      size,
      mtimeMs,
      ctimeMs,
      ino,
      endedWithNewline,
      tailSha256,
      hashes: set,
      persistedSize: size,
    },
  }
}

async function writeRecordHashIndex(
  directory: string,
  caches: Map<string, LocalMirrorFileCacheEntry>,
): Promise<void> {
  const entries = new Map<string, LocalMirrorFileCacheEntry>()
  // Keep entries another process wrote for files this process does not list
  // (for example a differently named ATRIB_MIRROR_FILE), while they exist.
  for (const [name, entry] of await readRecordHashIndex(directory)) {
    try {
      if ((await stat(join(directory, name))).isFile()) entries.set(name, entry)
    } catch {
      continue
    }
  }
  for (const [file, entry] of caches) {
    if (dirname(file) === directory) entries.set(basename(file), entry)
  }

  const index = {
    schema: RECORD_HASH_INDEX_SCHEMA,
    files: [...entries.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => ({
        name,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        ctimeMs: entry.ctimeMs,
        ino: entry.ino,
        endedWithNewline: entry.endedWithNewline,
        tailSha256: entry.tailSha256,
        hashes: [...entry.hashes].map((hash) => hash.slice('sha256:'.length)).sort(),
      })),
  }
  const path = join(directory, RECORD_HASH_INDEX_FILE)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
    for (const [file, entry] of caches) {
      if (dirname(file) === directory) entry.persistedSize = entry.size
    }
  } catch {
    // Advisory cache: a failed write only costs the next process a rescan.
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

async function fileEndsWithNewline(file: string, size: number): Promise<boolean> {
  if (size === 0) return true
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(file, 'r')
    const byte = new Uint8Array(1)
    const { bytesRead } = await handle.read(byte, 0, 1, size - 1)
    return bytesRead === 1 && byte[0] === 10
  } catch {
    return false
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

async function localMirrorFiles(): Promise<string[]> {
  const files = new Set<string>()
  for (const explicit of [
    process.env['ATRIB_AUTOCHAIN_SOURCE'],
    process.env['ATRIB_MIRROR_FILE'],
  ]) {
    if (explicit) files.add(explicit)
  }

  const recordsDir = process.env['ATRIB_RECORDS_DIR'] ?? join(homedir(), '.atrib', 'records')
  try {
    for (const entry of await readdir(recordsDir)) {
      if (entry.endsWith('.jsonl')) files.add(join(recordsDir, entry))
    }
  } catch {
    // Missing mirror directories are normal in tests and first-run setups.
  }

  return [...files]
}

function collectMirrorHashes(value: unknown, hashes: Set<string>): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  const obj = value as Record<string, unknown>

  const directHash = obj['record_hash']
  if (typeof directHash === 'string' && SHA256_REF_PATTERN.test(directHash)) {
    hashes.add(directHash)
  }

  for (const candidate of [obj, obj['record'], obj['signed_record']]) {
    if (isAtribRecordLike(candidate)) hashes.add(hashRecord(candidate))
  }
}

function isAtribRecordLike(value: unknown): value is AtribRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const obj = value as Record<string, unknown>
  const hasCreatorSigner = hasCreatorSignerEntry(obj)
  const contentIdRequired = [
    'https://atrib.dev/v1/types/tool_call',
    'https://atrib.dev/v1/types/transaction',
    'https://atrib.dev/v1/types/directory_anchor',
    'https://atrib.dev/v1/types/session_checkpoint',
  ].includes(obj['event_type'] as string)
  return (
    obj['spec_version'] === 'atrib/1.0' &&
    (!('content_id' in obj || contentIdRequired) || typeof obj['content_id'] === 'string') &&
    typeof obj['creator_key'] === 'string' &&
    typeof obj['chain_root'] === 'string' &&
    typeof obj['event_type'] === 'string' &&
    typeof obj['context_id'] === 'string' &&
    typeof obj['timestamp'] === 'number' &&
    (typeof obj['signature'] === 'string' || (!('signature' in obj) && hasCreatorSigner))
  )
}

function hashRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function lookupLogRecord(
  recordHash: string,
  logEndpoint?: string | undefined,
  timeoutMs = 750,
): Promise<RecordReferenceResolution> {
  const lookupUrl = `${logLookupBase(logEndpoint)}/lookup/${recordHash.slice('sha256:'.length)}`
  try {
    const response = await fetch(lookupUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 404) return 'not-found'
    if (!response.ok) return 'unknown'
    return 'found'
  } catch {
    return 'unknown'
  }
}

function logLookupBase(logEndpoint?: string | undefined): string {
  const raw = logEndpoint ?? process.env['ATRIB_LOG_ENDPOINT'] ?? 'https://log.atrib.dev/v1'
  const withoutEntries = raw.replace(/\/entries\/?$/, '')
  return withoutEntries.replace(/\/$/, '')
}

async function withOptionalTimeout<T>(
  promise: Promise<T>,
  timeoutMs?: number | undefined,
): Promise<T | 'timeout'> {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function clearRecordReferenceResolverCacheForTests(): void {
  localRecordHashCache = undefined
  localRecordHashCacheLoad = undefined
  localMirrorFileCaches = new Map()
  localMirrorFullFileScansForTests = 0
  localMirrorAppendFileScansForTests = 0
  localMirrorReusedFileCachesForTests = 0
  localMirrorPersistedFileCachesForTests = 0
  afterMirrorScanHookForTests = undefined
}

/** Runs between a mirror scan and its stability check. Not part of the package surface. */
export function setRecordReferenceResolverScanHookForTests(
  hook: ((file: string) => Promise<void>) | undefined,
): void {
  afterMirrorScanHookForTests = hook
}

export function recordReferenceResolverCacheStatsForTests(): {
  cached_file_count: number
  cached_record_hash_count: number
  full_file_scans: number
  append_file_scans: number
  reused_file_caches: number
  persisted_file_caches: number
} {
  return {
    cached_file_count: localMirrorFileCaches.size,
    cached_record_hash_count: localRecordHashCache?.size ?? 0,
    full_file_scans: localMirrorFullFileScansForTests,
    append_file_scans: localMirrorAppendFileScansForTests,
    reused_file_caches: localMirrorReusedFileCachesForTests,
    persisted_file_caches: localMirrorPersistedFileCachesForTests,
  }
}
