import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalRecord,
  hexEncode,
  SHA256_REF_PATTERN,
  sha256,
  type AtribRecord,
} from '@atrib/mcp'

export type RecordReferenceResolution = 'found' | 'not-found' | 'unknown'

export type RecordReferenceResolver = (
  recordHash: string,
) => RecordReferenceResolution | Promise<RecordReferenceResolution>

interface FilterResolvableInformedByOptions {
  allowUnresolved?: boolean | undefined
  resolver?: RecordReferenceResolver | undefined
  logEndpoint?: string | undefined
  warnings: string[]
}

let localRecordHashCache: Set<string> | undefined

export async function filterResolvableInformedBy(
  refs: string[] | undefined,
  options: FilterResolvableInformedByOptions,
): Promise<string[] | undefined> {
  if (!refs || refs.length === 0) return undefined

  const unique = [...new Set(refs)]
  if (options.allowUnresolved) return unique

  const kept: string[] = []
  const resolver =
    options.resolver ??
    ((recordHash: string) => defaultRecordReferenceResolver(recordHash, options.logEndpoint))

  for (const ref of unique) {
    const resolution = await resolver(ref)
    if (resolution === 'found') {
      kept.push(ref)
      continue
    }
    if (resolution === 'unknown') {
      options.warnings.push(
        `dropped unvalidated informed_by reference ${shortHash(ref)}; validation unavailable`,
      )
      continue
    }
    options.warnings.push(
      `dropped unresolved informed_by reference ${shortHash(ref)}; not found in local mirrors or log lookup`,
    )
  }

  return kept.length > 0 ? kept : undefined
}

export async function defaultRecordReferenceResolver(
  recordHash: string,
  logEndpoint?: string | undefined,
): Promise<RecordReferenceResolution> {
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
  if (typeof directHash === 'string' && SHA256_REF_PATTERN.test(directHash)) hashes.add(directHash)

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

function shortHash(recordHash: string): string {
  return `${recordHash.slice(0, 19)}...${recordHash.slice(-8)}`
}

export function clearRecordReferenceResolverCacheForTests(): void {
  localRecordHashCache = undefined
}
