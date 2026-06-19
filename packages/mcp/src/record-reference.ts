// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as readline from 'node:readline'
import { canonicalRecord } from './canon.js'
import { hexEncode, sha256 } from './hash.js'
import { SHA256_REF_PATTERN } from './refs.js'
import type { AtribRecord } from './types.js'

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
}

export type LocalRecordReferenceResolver = (
  recordHash: string,
) => RecordReferenceResolution | Promise<RecordReferenceResolution>

interface LocalMirrorFileCacheEntry {
  size: number
  mtimeMs: number
  hashes: Set<string>
  endedWithNewline: boolean
}

let localRecordHashCache: Set<string> | undefined
let localRecordHashCacheLoad: Promise<Set<string>> | undefined
let localMirrorFileCaches = new Map<string, LocalMirrorFileCacheEntry>()
let localMirrorFullFileScansForTests = 0
let localMirrorAppendFileScansForTests = 0
let localMirrorReusedFileCachesForTests = 0

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
    const localResult = await withOptionalTimeout(
      hasLocalRecordHash(recordHash),
      options.localLookupTimeoutMs,
    )
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

  for (const file of files) {
    try {
      const fileStat = await stat(file)
      const previous = localMirrorFileCaches.get(file)
      let entry: LocalMirrorFileCacheEntry

      if (previous && previous.size === fileStat.size && previous.mtimeMs === fileStat.mtimeMs) {
        entry = previous
        localMirrorReusedFileCachesForTests += 1
      } else if (previous && fileStat.size >= previous.size && previous.endedWithNewline) {
        const appendedHashes =
          fileStat.size === previous.size
            ? new Set<string>()
            : await loadLocalRecordHashesFromFile(file, previous.size)
        const combined = new Set(previous.hashes)
        for (const hash of appendedHashes) combined.add(hash)
        entry = {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          hashes: combined,
          endedWithNewline: await fileEndsWithNewline(file, fileStat.size),
        }
        localMirrorAppendFileScansForTests += 1
      } else {
        entry = {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          hashes: await loadLocalRecordHashesFromFile(file),
          endedWithNewline: await fileEndsWithNewline(file, fileStat.size),
        }
        localMirrorFullFileScansForTests += 1
      }

      nextFileCaches.set(file, entry)
      for (const hash of entry.hashes) hashes.add(hash)
    } catch {
      continue
    }
  }

  localMirrorFileCaches = nextFileCaches
  return hashes
}

async function loadLocalRecordHashesFromFile(file: string, start = 0): Promise<Set<string>> {
  const hashes = new Set<string>()
  const stream = createReadStream(file, {
    encoding: 'utf8',
    ...(start > 0 ? { start } : {}),
  })
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
  return hashes
}

async function fileEndsWithNewline(file: string, size: number): Promise<boolean> {
  if (size === 0) return true
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(file, 'r')
    const byte = new Uint8Array(1)
    await handle.read(byte, 0, 1, size - 1)
    return byte[0] === 10
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
  return (
    obj['spec_version'] === 'atrib/1.0' &&
    typeof obj['content_id'] === 'string' &&
    typeof obj['creator_key'] === 'string' &&
    typeof obj['chain_root'] === 'string' &&
    typeof obj['event_type'] === 'string' &&
    typeof obj['context_id'] === 'string' &&
    typeof obj['timestamp'] === 'number' &&
    typeof obj['signature'] === 'string'
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
}

export function recordReferenceResolverCacheStatsForTests(): {
  cached_file_count: number
  cached_record_hash_count: number
  full_file_scans: number
  append_file_scans: number
  reused_file_caches: number
} {
  return {
    cached_file_count: localMirrorFileCaches.size,
    cached_record_hash_count: localRecordHashCache?.size ?? 0,
    full_file_scans: localMirrorFullFileScansForTests,
    append_file_scans: localMirrorAppendFileScansForTests,
    reused_file_caches: localMirrorReusedFileCachesForTests,
  }
}
