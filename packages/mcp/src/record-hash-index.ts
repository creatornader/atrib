// SPDX-License-Identifier: Apache-2.0

/**
 * Per-file record hash cache for local mirrors.
 *
 * Answering "does this mirror hold record_hash X" means canonicalizing and
 * hashing every row. This module keeps the result per mirror file, in memory
 * for long-lived hosts and in `.atrib-record-hash-index-v1.json` beside the
 * mirror for short-lived producers such as one `atrib-emit-cli` process per
 * record.
 *
 * The index is a deletable advisory cache. File metadata and a tail digest
 * validate every entry, appended bytes are scanned incrementally, and any
 * truncation, replacement, or rewrite falls back to a full scan of that file.
 */

import { createReadStream } from 'node:fs'
import { open, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import * as readline from 'node:readline'
import { writeAdvisoryIndexFile } from './advisory-index.js'
import { canonicalRecord } from './canon.js'
import { hexEncode, sha256 } from './hash.js'
import { parseMirrorValue } from './mirror-parse.js'
import { SHA256_REF_PATTERN } from './refs.js'
import type { AtribRecord } from './types.js'
import { hasCreatorSignerEntry } from './types.js'

interface MirrorFileState {
  size: number
  mtimeMs: number
  ctimeMs: number
  ino: number
}

export interface MirrorFileHashEntry extends MirrorFileState {
  /** Hashes of rows that parse as a signed record, bare or under `record`. */
  hashes: Set<string>
  /**
   * Hashes a row only declares: a `record_hash` field, a `signed_record`
   * body, or a record-shaped envelope. Process-wide discovery accepts them;
   * a lookup against one named mirror file does not.
   */
  declared: Set<string>
  endedWithNewline: boolean
  /** sha256 hex of the last RECORD_HASH_INDEX_TAIL_BYTES bytes before `size`. */
  tailSha256: string
  /** File size the on-disk index entry covers, when one exists. */
  persistedSize?: number | undefined
}

const RECORD_HASH_INDEX_SCHEMA = 'atrib.record-hash-index.v1'
const RECORD_HASH_INDEX_FILE = '.atrib-record-hash-index-v1.json'
const RECORD_HASH_INDEX_TAIL_BYTES = 4096
// Rewriting the index costs time proportional to the whole corpus, so a
// producer that appends one row per process must not rewrite it every time.
// Until this many bytes are appended, the next process rescans that tail.
const RECORD_HASH_INDEX_REWRITE_BYTES = 256 * 1024
const HEX64_PATTERN = /^[0-9a-f]{64}$/

interface RefreshBatch {
  persistedByDirectory: Map<string, Map<string, MirrorFileHashEntry>>
  changedDirectories: Set<string>
}

const fileCaches = new Map<string, MirrorFileHashEntry>()
const refreshesInFlight = new Map<string, Promise<MirrorFileHashEntry | undefined>>()
let fullFileScansForTests = 0
let appendFileScansForTests = 0
let reusedFileCachesForTests = 0
let persistedFileCachesForTests = 0
let afterScanHookForTests: ((file: string) => Promise<void>) | undefined

/**
 * Current hash entries for `files`. Unreadable and missing files are left
 * out. Never throws.
 */
export async function loadMirrorFileHashEntries(
  files: readonly string[],
): Promise<MirrorFileHashEntry[]> {
  const batch: RefreshBatch = {
    persistedByDirectory: new Map(),
    changedDirectories: new Set(),
  }
  const entries: MirrorFileHashEntry[] = []
  for (const file of new Set(files)) {
    // A long-lived host can ask about the same mirror from several calls at
    // once. They share one scan.
    let refresh = refreshesInFlight.get(file)
    if (!refresh) {
      refresh = refreshFileEntry(file, batch).finally(() => {
        refreshesInFlight.delete(file)
      })
      refreshesInFlight.set(file, refresh)
    }
    const entry = await refresh
    if (entry) entries.push(entry)
  }
  for (const directory of batch.changedDirectories) {
    await writeRecordHashIndex(directory)
  }
  return entries
}

/**
 * True when `file` holds a row that parses as the signed record with this
 * hash. Declared-only hashes do not count. Never throws.
 */
export async function mirrorFileHasRecordHash(file: string, recordHash: string): Promise<boolean> {
  const [entry] = await loadMirrorFileHashEntries([file])
  return entry?.hashes.has(recordHash) ?? false
}

async function refreshFileEntry(
  file: string,
  batch: RefreshBatch,
): Promise<MirrorFileHashEntry | undefined> {
  try {
    const fileStat = await stat(file)
    if (!fileStat.isFile()) {
      fileCaches.delete(file)
      return undefined
    }
    const state: MirrorFileState = {
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      ctimeMs: fileStat.ctimeMs,
      ino: fileStat.ino,
    }
    const directory = dirname(file)
    let previous = fileCaches.get(file)
    let previousFromDisk = false
    if (!previous) {
      let persisted = batch.persistedByDirectory.get(directory)
      if (!persisted) {
        persisted = await readRecordHashIndex(directory)
        batch.persistedByDirectory.set(directory, persisted)
      }
      previous = persisted.get(basename(file))
      previousFromDisk = previous !== undefined
    }

    if (previous && sameFileState(previous, state)) {
      if (previousFromDisk) persistedFileCachesForTests += 1
      else reusedFileCachesForTests += 1
      fileCaches.set(file, previous)
      return previous
    }

    const resumeFrom =
      previous && (await canResumeAfter(file, previous, state)) ? previous : undefined
    const scan = await scanFileEntry(file, state, resumeFrom)
    if (resumeFrom) appendFileScansForTests += 1
    else fullFileScansForTests += 1
    if (!scan.stable) {
      // The file changed under the scan in a way an append cannot explain.
      // The hashes still serve this lookup, but they are not cached.
      fileCaches.delete(file)
      return scan.entry
    }
    fileCaches.set(file, scan.entry)
    if (
      scan.entry.persistedSize === undefined ||
      scan.entry.size - scan.entry.persistedSize >= RECORD_HASH_INDEX_REWRITE_BYTES
    ) {
      batch.changedDirectories.add(directory)
    }
    return scan.entry
  } catch {
    fileCaches.delete(file)
    return undefined
  }
}

function sameFileState(left: MirrorFileState, right: MirrorFileState): boolean {
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
  previous: MirrorFileHashEntry,
  state: MirrorFileState,
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
  state: MirrorFileState,
  resumeFrom: MirrorFileHashEntry | undefined,
): Promise<{ entry: MirrorFileHashEntry; stable: boolean }> {
  const tailSha256 = await tailDigest(file, state.size)
  const hashes = new Set(resumeFrom?.hashes)
  const declared = new Set(resumeFrom?.declared)
  await collectFileHashes(file, hashes, declared, resumeFrom?.size ?? 0, state.size)
  const endedWithNewline = await fileEndsWithNewline(file, state.size)
  if (afterScanHookForTests) await afterScanHookForTests(file)

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
      declared,
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
  declared: Set<string>,
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
      collectRowHashes(JSON.parse(trimmed) as unknown, hashes, declared)
    } catch {
      continue
    }
  }
}

function collectRowHashes(value: unknown, hashes: Set<string>, declared: Set<string>): void {
  if (!isPlainObject(value)) return

  const record = parseMirrorValue(value)
  const recordHash = record ? hashRecord(record) : undefined
  if (recordHash) {
    hashes.add(recordHash)
    declared.delete(recordHash)
  }

  const declare = (hash: string): void => {
    if (!hashes.has(hash)) declared.add(hash)
  }
  const directHash = value['record_hash']
  if (typeof directHash === 'string' && SHA256_REF_PATTERN.test(directHash)) declare(directHash)
  for (const candidate of [value, value['record'], value['signed_record']]) {
    if (isAtribRecordLike(candidate)) declare(hashRecord(candidate))
  }
}

function isAtribRecordLike(value: unknown): value is AtribRecord {
  if (!isPlainObject(value)) return false
  const hasCreatorSigner = hasCreatorSignerEntry(value)
  const contentIdRequired = [
    'https://atrib.dev/v1/types/tool_call',
    'https://atrib.dev/v1/types/transaction',
    'https://atrib.dev/v1/types/directory_anchor',
    'https://atrib.dev/v1/types/session_checkpoint',
  ].includes(value['event_type'] as string)
  return (
    value['spec_version'] === 'atrib/1.0' &&
    (!('content_id' in value || contentIdRequired) || typeof value['content_id'] === 'string') &&
    typeof value['creator_key'] === 'string' &&
    typeof value['chain_root'] === 'string' &&
    typeof value['event_type'] === 'string' &&
    typeof value['context_id'] === 'string' &&
    typeof value['timestamp'] === 'number' &&
    (typeof value['signature'] === 'string' || (!('signature' in value) && hasCreatorSigner))
  )
}

function hashRecord(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
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

async function readRecordHashIndex(directory: string): Promise<Map<string, MirrorFileHashEntry>> {
  const entries = new Map<string, MirrorFileHashEntry>()
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
): { name: string; entry: MirrorFileHashEntry } | null {
  if (!isPlainObject(value)) return null
  const { name, size, mtimeMs, ctimeMs, ino, endedWithNewline, tailSha256 } = value
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
    !HEX64_PATTERN.test(tailSha256)
  ) {
    return null
  }
  const hashes = parseHashList(value['hashes'])
  const declared = parseHashList(value['declared'])
  if (!hashes || !declared) return null
  return {
    name,
    entry: {
      size,
      mtimeMs,
      ctimeMs,
      ino,
      endedWithNewline,
      tailSha256,
      hashes,
      declared,
      persistedSize: size,
    },
  }
}

function parseHashList(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null
  const set = new Set<string>()
  for (const hash of value) {
    if (typeof hash !== 'string' || !HEX64_PATTERN.test(hash)) return null
    set.add(`sha256:${hash}`)
  }
  return set
}

function serializeHashList(hashes: Set<string>): string[] {
  return [...hashes].map((hash) => hash.slice('sha256:'.length)).sort()
}

async function writeRecordHashIndex(directory: string): Promise<void> {
  const candidates = new Map<string, MirrorFileHashEntry>()
  // Keep entries another process wrote for files this process has not read.
  for (const [name, entry] of await readRecordHashIndex(directory)) {
    candidates.set(name, entry)
  }
  const written: MirrorFileHashEntry[] = []
  for (const [file, entry] of fileCaches) {
    if (dirname(file) !== directory) continue
    candidates.set(basename(file), entry)
    written.push(entry)
  }
  const entries: Array<[string, MirrorFileHashEntry]> = []
  for (const [name, entry] of candidates) {
    try {
      if ((await stat(join(directory, name))).isFile()) entries.push([name, entry])
    } catch {
      continue
    }
  }

  const index = {
    schema: RECORD_HASH_INDEX_SCHEMA,
    files: entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => ({
        name,
        size: entry.size,
        mtimeMs: entry.mtimeMs,
        ctimeMs: entry.ctimeMs,
        ino: entry.ino,
        endedWithNewline: entry.endedWithNewline,
        tailSha256: entry.tailSha256,
        hashes: serializeHashList(entry.hashes),
        declared: serializeHashList(entry.declared),
      })),
  }
  try {
    await writeAdvisoryIndexFile(
      join(directory, RECORD_HASH_INDEX_FILE),
      `${JSON.stringify(index)}\n`,
    )
    for (const entry of written) entry.persistedSize = entry.size
  } catch {
    // Advisory cache: a failed write only costs the next process a rescan.
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function clearRecordHashIndexForTests(): void {
  fileCaches.clear()
  refreshesInFlight.clear()
  fullFileScansForTests = 0
  appendFileScansForTests = 0
  reusedFileCachesForTests = 0
  persistedFileCachesForTests = 0
  afterScanHookForTests = undefined
}

export function recordHashIndexStatsForTests(): {
  cached_file_count: number
  full_file_scans: number
  append_file_scans: number
  reused_file_caches: number
  persisted_file_caches: number
} {
  return {
    cached_file_count: fileCaches.size,
    full_file_scans: fullFileScansForTests,
    append_file_scans: appendFileScansForTests,
    reused_file_caches: reusedFileCachesForTests,
    persisted_file_caches: persistedFileCachesForTests,
  }
}

/** Runs between a mirror scan and its stability check. */
export function setRecordHashIndexScanHookForTests(
  hook: ((file: string) => Promise<void>) | undefined,
): void {
  afterScanHookForTests = hook
}
