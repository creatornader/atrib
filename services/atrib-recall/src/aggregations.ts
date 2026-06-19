// SPDX-License-Identifier: Apache-2.0

/**
 * Layer 1 aggregation helpers for the recall semantic surface.
 *
 * Annotation records (D058, event_type = EVENT_TYPE_ANNOTATION_URI) carry
 * their target record_hash in signed top-level `record.annotates`.
 * Importance + topics + summary live in the D062 `_local.content` sidecar.
 * Legacy mirrors may also carry `content.annotates`, so readers accept it
 * as a fallback. To compute "what annotations does record X have?" the
 * recall server walks the mirror, recovers `_local.content` per envelope,
 * and bins annotations by the signed target.
 *
 * This module isolates that walk + bin step plus the record_hash helper
 * needed to key the result map. The existing `loadRecords` / `recall` paths
 * in `index.ts` deal in bare AtribRecord[] and stay unchanged; the Layer 1
 * filter / ranking wire-up will compose `loadLoaded` ->
 * `aggregateAnnotationsByRecord` -> filter alongside the existing recall
 * flow.
 *
 * Revision aggregation (D059) is a near-identical shape that will land
 * alongside; the structure here is designed to extend.
 */

import {
  canonicalRecord,
  sha256,
  hexEncode,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
  deriveLocalContentFromSidecar,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ImportanceLabel } from './index.js'
import { IMPORTANCE_NUMERIC } from './index.js'

/**
 * A mirror record paired with its D062 sidecar content (when present) and
 * its content-addressable record_hash (computed at load time). The
 * record_hash form is `sha256:<64-hex>` per spec §2.3, matches what the
 * log entries commit to and what `informed_by` / `annotates` / `revises`
 * reference.
 *
 * `content` is the deserialized `_local.content` from a D062 envelope mirror
 * line, or a derived equivalent from known legacy sidecar fields such as
 * `_local.toolName`, `_local.args`, `_local.result`, `_local.input`, and
 * `_local.output`. Producers writing bare AtribRecord lines yield
 * `content: undefined` here. Code that wants to read annotation
 * importance / topics / summary MUST handle the undefined case.
 */
export type LoadedRecord = {
  record: AtribRecord
  record_hash: string
  content?: unknown
  /**
   * D062 `_local.producer` from the sidecar when present (e.g.
   * "atrib-emit-cli", "claude-hooks-builtin-2b", "claude-code"). Used by
   * Layer 1 v2 legibility to render a friendly creator label instead of
   * the raw creator_key. Undefined when the line is bare (no envelope)
   * or the producer field was not stamped at sign time.
   */
  producer?: string
}

/**
 * Compute the spec §2.3 record_hash for an AtribRecord: sha256 over the
 * JCS-canonical serialization including the signature field. Matches the
 * pattern in `packages/openinference/test/informed-by.test.ts`
 * and the in-tree atrib-span-processor build output. Kept local to
 * atrib-recall for now, when a third caller appears, lift to `@atrib/mcp`.
 */
export function computeRecordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function isRecordRef(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

function objectContent(content: unknown): Record<string, unknown> | null {
  return content && typeof content === 'object' ? (content as Record<string, unknown>) : null
}

function targetRef(lr: LoadedRecord, field: 'annotates' | 'revises'): string | undefined {
  const topLevel = (lr.record as AtribRecord & { annotates?: unknown; revises?: unknown })[field]
  if (isRecordRef(topLevel)) return topLevel
  const c = objectContent(lr.content)
  const legacy = c?.[field]
  return isRecordRef(legacy) ? legacy : undefined
}

function contentStrings(
  content: Record<string, unknown>,
  primary: 'topics' | 'topic_tags',
): string[] {
  const values = content[primary]
  if (!Array.isArray(values)) return []
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * Pull the inner AtribRecord and recall-readable local content out of one
 * parsed mirror line. Returns null when the line is neither shape or is
 * missing the required AtribRecord fields. The shape contract mirrors
 * `extractRecord` in `index.ts` exactly; the only addition is the optional
 * `content` field carried back. Kept as a separate function (rather than
 * augmenting `extractRecord`) so the existing recall flow's signature
 * stays AtribRecord[].
 */
function extractLoaded(
  parsed: unknown,
): { record: AtribRecord; content?: unknown; producer?: string } | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const envelopeRecord =
    typeof obj.record === 'object' && obj.record !== null
      ? (obj.record as Record<string, unknown>)
      : null
  const candidate = envelopeRecord ?? obj
  if (
    typeof candidate.spec_version !== 'string' ||
    typeof candidate.event_type !== 'string' ||
    typeof candidate.context_id !== 'string' ||
    typeof candidate.creator_key !== 'string' ||
    typeof candidate.chain_root !== 'string' ||
    typeof candidate.timestamp !== 'number' ||
    !Number.isFinite(candidate.timestamp) ||
    typeof candidate.signature !== 'string'
  ) {
    return null
  }
  const record = candidate as unknown as AtribRecord
  if (envelopeRecord !== null) {
    const local = (obj._local as Record<string, unknown> | undefined) ?? undefined
    if (local) {
      const producer = typeof local.producer === 'string' ? local.producer : undefined
      const content = deriveLocalContentFromSidecar(record.event_type, local)
      if (content !== undefined || producer !== undefined) {
        return {
          record,
          ...(content !== undefined && { content }),
          ...(producer !== undefined && { producer }),
        }
      }
    }
  }
  return { record }
}

/**
 * Load a single jsonl mirror file as LoadedRecord[]. Each line's
 * record_hash is computed once at load; subsequent lookups are O(1).
 * Malformed lines are silently skipped (same contract as `loadRecords`).
 */
export function loadLoaded(path: string): LoadedRecord[] {
  if (!existsSync(path)) return []
  return parseLoadedJsonl(readFileSync(path, 'utf8'))
}

export function loadLoadedAppend(path: string, startOffset: number): LoadedRecord[] {
  if (!existsSync(path)) return []
  let size = 0
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return []
    size = stat.size
  } catch {
    return []
  }
  if (startOffset >= size) return []
  const readStart = startOffset > 0 ? startOffset - 1 : 0
  const length = size - readStart
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const bytesRead = readSync(fd, buffer, 0, length, readStart)
    let raw = buffer.subarray(0, bytesRead).toString('utf8')
    if (readStart > 0) {
      const firstNewline = raw.indexOf('\n')
      if (firstNewline < 0) return []
      raw = raw.slice(firstNewline + 1)
    }
    return parseLoadedJsonl(raw)
  } catch {
    return []
  } finally {
    closeSync(fd)
  }
}

export function loadLoadedTail(path: string, maxRecords: number): LoadedRecord[] {
  if (maxRecords <= 0 || !existsSync(path)) return []
  let size = 0
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return []
    size = stat.size
  } catch {
    return []
  }
  if (size === 0) return []

  const fd = openSync(path, 'r')
  try {
    const chunks: Buffer[] = []
    const chunkSize = 64 * 1024
    let position = size
    let newlineCount = 0
    while (position > 0 && newlineCount <= maxRecords) {
      const readSize = Math.min(chunkSize, position)
      position -= readSize
      const buffer = Buffer.allocUnsafe(readSize)
      const bytesRead = readSync(fd, buffer, 0, readSize, position)
      const chunk = buffer.subarray(0, bytesRead)
      chunks.unshift(chunk)
      for (let i = 0; i < chunk.length; i += 1) {
        if (chunk[i] === 10) newlineCount += 1
      }
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(-maxRecords)
    return parseLoadedJsonl(lines.join('\n'))
  } catch {
    return []
  } finally {
    closeSync(fd)
  }
}

function parseLoadedJsonl(raw: string): LoadedRecord[] {
  const out: LoadedRecord[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const extracted = extractLoaded(parsed)
    if (!extracted) continue
    out.push({
      record: extracted.record,
      record_hash: computeRecordHash(extracted.record),
      content: extracted.content,
      producer: extracted.producer,
    })
  }
  return out
}

/**
 * Mirror-discovery variant of `loadLoaded` that scans a directory of
 * `*.jsonl` files. See loadRecordsFromDir in index.ts for the bare
 * AtribRecord equivalent. Files that don't exist or aren't readable are silently
 * skipped (a file rotated mid-scan shouldn't error the whole call).
 * Returns the union of loaded entries plus the list of files scanned.
 */
export function loadLoadedFromDir(dir: string): { loaded: LoadedRecord[]; files: string[] } {
  if (!existsSync(dir)) return { loaded: [], files: [] }
  let entries: string[] = []
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return { loaded: [], files: [] }
  }
  const loaded: LoadedRecord[] = []
  const files: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    const partial = loadLoaded(full)
    files.push(full)
    if (partial.length > 0) loaded.push(...partial)
  }
  return { loaded, files }
}

export function loadNewestLoadedFromDir(
  dir: string,
  maxRecords: number,
): { loaded: LoadedRecord[]; files: string[] } {
  if (!existsSync(dir)) return { loaded: [], files: [] }
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
  } catch {
    return { loaded: [], files: [] }
  }
  const loaded: LoadedRecord[] = []
  const files: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    files.push(full)
    const partial = loadLoadedTail(full, maxRecords)
    if (partial.length > 0) loaded.push(...partial)
  }
  loaded.sort((a, b) => b.record.timestamp - a.record.timestamp)
  return { loaded: loaded.slice(0, maxRecords), files }
}

/**
 * LoadedRecord variant of `discoverRecords` in index.ts. Same priority
 * order: explicit `recordFile` arg > ATRIB_RECORD_FILE env > ATRIB_MIRROR_DIR
 * scan. Re-evaluates env vars on each call so test harnesses that mutate
 * process.env per-test get the value they set.
 */
export function discoverLoaded(recordFile?: string): { loaded: LoadedRecord[]; files: string[] } {
  const envFile = process.env.ATRIB_RECORD_FILE
  const envDir = process.env.ATRIB_MIRROR_DIR ?? join(process.env.HOME ?? '', '.atrib', 'records')
  const explicit = recordFile ?? envFile
  if (explicit) {
    return { loaded: loadLoaded(explicit), files: [explicit] }
  }
  return loadLoadedFromDir(envDir)
}

/**
 * Per-record annotation summary: max importance across all annotations
 * pointing at the record (or undefined if none), the union of all
 * topics / topic_tags arrays carried by those annotations, and the
 * most-recent summary string. "Most recent" here means the last annotation by
 * timestamp; ties (rare in practice) resolve to the last array index
 * (mirror order).
 *
 * Matches the AnnotationSummary type declared in `index.ts`. Kept as a
 * separate exported type so future callers (e.g. the public
 * recall_annotations handler) can return this shape without depending
 * on the recall server's internal types.
 */
export type AnnotationSummary = {
  max_importance?: ImportanceLabel
  topics?: string[]
  summary?: string
}

/**
 * Walk loaded records, identify D058 annotation records, and bin them by
 * signed `record.annotates` target. Returns Map<target_record_hash,
 * AnnotationSummary>. Records with no annotations pointing at them
 * receive no entry (callers should default to undefined).
 *
 * Annotation records WITHOUT a `_local.content` sidecar can still add graph
 * edges elsewhere because the signed target is top-level, but they cannot
 * contribute importance / topics / summary here. This aggregation skips
 * body-less annotations so callers do not mistake an empty object for a
 * usable semantic summary.
 *
 * Spec references:
 *   - D058: annotation event_type byte 0x05, URI form annotation
 *   - §8.3: salted-commitment posture (body lives in _local; log has only content_id)
 *   - §1.2.4: event_type URI form (required for annotation records)
 */
export function aggregateAnnotationsByRecord(
  loaded: LoadedRecord[],
): Map<string, AnnotationSummary> {
  type Bin = {
    importances: ImportanceLabel[]
    topics: Set<string>
    summary?: string
    summary_ts: number
  }
  const bins = new Map<string, Bin>()

  for (const lr of loaded) {
    if (lr.record.event_type !== EVENT_TYPE_ANNOTATION_URI) continue
    const target = targetRef(lr, 'annotates')
    if (!target) continue
    const c = objectContent(lr.content)
    if (!c) continue

    const bin = bins.get(target) ?? {
      importances: [],
      topics: new Set<string>(),
      summary_ts: -Infinity,
    }

    if (typeof c.importance === 'string' && c.importance in IMPORTANCE_NUMERIC) {
      bin.importances.push(c.importance as ImportanceLabel)
    }
    for (const t of [...contentStrings(c, 'topics'), ...contentStrings(c, 'topic_tags')]) {
      bin.topics.add(t)
    }
    if (typeof c.summary === 'string' && lr.record.timestamp >= bin.summary_ts) {
      bin.summary = c.summary
      bin.summary_ts = lr.record.timestamp
    }

    bins.set(target, bin)
  }

  const out = new Map<string, AnnotationSummary>()
  for (const [target, bin] of bins) {
    const max_importance =
      bin.importances.length === 0
        ? undefined
        : bin.importances.reduce((a, b) => (IMPORTANCE_NUMERIC[a] >= IMPORTANCE_NUMERIC[b] ? a : b))
    const summary: AnnotationSummary = {}
    if (max_importance !== undefined) summary.max_importance = max_importance
    if (bin.topics.size > 0) summary.topics = [...bin.topics].sort()
    if (bin.summary !== undefined) summary.summary = bin.summary
    out.set(target, summary)
  }
  return out
}

/**
 * Walk loaded records, identify D059 revision records, and bin them by
 * signed `record.revises` target. Returns Map<target_record_hash,
 * revision_record_hashes[]>. The value array contains the record_hashes
 * of every revision pointing at the target (immediate revisions only;
 * chain traversal is the caller's responsibility, the recall_revisions
 * handler walks the chain by recursing on each revision's own hash).
 *
 * The returned value array is ordered by revision timestamp ascending so
 * the caller sees revisions in the order they were issued. Ties resolve
 * to mirror-iteration order.
 *
 * Revision records WITHOUT a `_local.content` sidecar still carry their
 * target at signed top level, so they remain structurally traversable.
 * Revision records with no top-level or legacy sidecar target are skipped.
 *
 * Spec references:
 *   - D059: revision event_type byte 0x06, URI form revision
 *   - §8.3: salted-commitment posture (body lives in _local; log has only content_id)
 *   - §1.2.4: event_type URI form (required for revision records)
 */
export function aggregateRevisionsByRecord(loaded: LoadedRecord[]): Map<string, string[]> {
  type Entry = { hash: string; ts: number }
  const bins = new Map<string, Entry[]>()

  for (const lr of loaded) {
    if (lr.record.event_type !== EVENT_TYPE_REVISION_URI) continue
    const target = targetRef(lr, 'revises')
    if (!target) continue
    const list = bins.get(target) ?? []
    list.push({ hash: lr.record_hash, ts: lr.record.timestamp })
    bins.set(target, list)
  }

  const out = new Map<string, string[]>()
  for (const [target, entries] of bins) {
    entries.sort((a, b) => a.ts - b.ts)
    out.set(
      target,
      entries.map((e) => e.hash),
    )
  }
  return out
}
