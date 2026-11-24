// SPDX-License-Identifier: Apache-2.0

import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { recordHashExistsInMirror } from './mirror.js'
import {
  clearRecordHashIndexForTests,
  loadMirrorFileHashEntries,
  recordHashIndexStatsForTests,
} from './record-hash-index.js'
import { SHA256_REF_PATTERN } from './refs.js'

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

let localRecordHashCache: Set<string> | undefined
let localRecordHashCacheLoad: Promise<Set<string>> | undefined

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

// Process-wide discovery accepts rows that only declare a hash, as it did
// before the per-file cache existed.
async function loadLocalRecordHashes(): Promise<Set<string>> {
  const hashes = new Set<string>()
  for (const entry of await loadMirrorFileHashEntries(await localMirrorFiles())) {
    for (const hash of entry.hashes) hashes.add(hash)
    for (const hash of entry.declared) hashes.add(hash)
  }
  return hashes
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
  clearRecordHashIndexForTests()
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
    ...recordHashIndexStatsForTests(),
    cached_record_hash_count: localRecordHashCache?.size ?? 0,
  }
}
