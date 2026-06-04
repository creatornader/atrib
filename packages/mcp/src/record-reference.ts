// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { canonicalRecord } from './canon.js'
import { hexEncode, sha256 } from './hash.js'
import { SHA256_REF_PATTERN } from './refs.js'
import type { AtribRecord } from './types.js'

export type RecordReferenceResolution = 'found' | 'not-found' | 'unknown'

export type LocalRecordReferenceResolver = (
  recordHash: string,
) => RecordReferenceResolution | Promise<RecordReferenceResolution>

let localRecordHashCache: Set<string> | undefined

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
): Promise<RecordReferenceResolution> {
  if (!SHA256_REF_PATTERN.test(recordHash)) return 'not-found'

  try {
    if (await hasLocalRecordHash(recordHash)) return 'found'
  } catch {
    return 'unknown'
  }

  return lookupLogRecord(recordHash, logEndpoint)
}

async function hasLocalRecordHash(recordHash: string): Promise<boolean> {
  localRecordHashCache ??= await loadLocalRecordHashes()
  if (localRecordHashCache.has(recordHash)) return true

  localRecordHashCache = await loadLocalRecordHashes()
  return localRecordHashCache.has(recordHash)
}

async function loadLocalRecordHashes(): Promise<Set<string>> {
  const hashes = new Set<string>()
  const files = await localMirrorFiles()

  for (const file of files) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }

    for (const line of text.split('\n')) {
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
): Promise<RecordReferenceResolution> {
  const lookupUrl = `${logLookupBase(logEndpoint)}/lookup/${recordHash.slice('sha256:'.length)}`
  try {
    const response = await fetch(lookupUrl, {
      signal: AbortSignal.timeout(750),
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

export function clearRecordReferenceResolverCacheForTests(): void {
  localRecordHashCache = undefined
}
