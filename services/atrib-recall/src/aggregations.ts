// SPDX-License-Identifier: Apache-2.0

/**
 * Layer 1 aggregation helpers for the recall semantic surface.
 *
 * Annotation records (D058, event_type = EVENT_TYPE_ANNOTATION_URI) carry
 * their importance + topic_tags + summary in `content.*`, with the target
 * record_hash in `content.annotates`. Per the §8.3 privacy posture the
 * public log carries only content_id (kind hash); the actual content body
 * lives in the local mirror's D062 envelope at `_local.content`. To compute
 * "what annotations does record X have?" the recall server must walk the
 * mirror, recover `_local.content` per envelope, and bin annotations by
 * their `content.annotates` target.
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
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportanceLabel } from './index.js'
import { IMPORTANCE_NUMERIC } from './index.js'

/**
 * A mirror record paired with its D062 sidecar content (when present) and
 * its content-addressable record_hash (computed at load time). The
 * record_hash form is `sha256:<64-hex>` per spec §2.3 — matches what the
 * log entries commit to and what `informed_by` / `content.annotates` /
 * `content.revises` reference.
 *
 * `content` is the deserialized `_local.content` from a D062 envelope mirror
 * line. Producers writing bare AtribRecord lines (legacy / non-envelope)
 * yield `content: undefined` here; annotation aggregation simply skips
 * those records (the §8.1 posture: no body disclosed). Code that wants to
 * read annotation importance / topics / summary MUST handle the undefined
 * case.
 */
export type LoadedRecord = {
  record: AtribRecord
  record_hash: string
  content?: unknown
}

/**
 * Compute the spec §2.3 record_hash for an AtribRecord: sha256 over the
 * JCS-canonical serialization including the signature field. Matches the
 * pattern in `packages/openinference-processor/test/informed-by.test.ts`
 * and the in-tree atrib-span-processor build output. Kept local to
 * atrib-recall for now — when a third caller appears, lift to `@atrib/mcp`.
 */
export function computeRecordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

/**
 * Pull the inner AtribRecord and the D062 `_local.content` out of one
 * parsed mirror line. Returns null when the line is neither shape or is
 * missing the required AtribRecord fields. The shape contract mirrors
 * `extractRecord` in `index.ts` exactly; the only addition is the optional
 * `content` field carried back. Kept as a separate function (rather than
 * augmenting `extractRecord`) so the existing recall flow's signature
 * stays AtribRecord[].
 */
function extractLoaded(
  parsed: unknown,
): { record: AtribRecord; content?: unknown } | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  const envelopeRecord = (typeof obj.record === 'object' && obj.record !== null)
    ? (obj.record as Record<string, unknown>)
    : null
  const candidate = envelopeRecord ?? obj
  if (
    typeof candidate.spec_version !== 'string' ||
    typeof candidate.event_type !== 'string' ||
    typeof candidate.context_id !== 'string' ||
    typeof candidate.creator_key !== 'string' ||
    typeof candidate.chain_root !== 'string' ||
    typeof candidate.signature !== 'string'
  ) {
    return null
  }
  const record = candidate as unknown as AtribRecord
  if (envelopeRecord !== null) {
    const local = (obj._local as Record<string, unknown> | undefined) ?? undefined
    if (local && 'content' in local) {
      return { record, content: local.content }
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
  const out: LoadedRecord[] = []
  const raw = readFileSync(path, 'utf8')
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
    })
  }
  return out
}

/**
 * Mirror-discovery variant of `loadLoaded` that scans a directory of
 * `*.jsonl` files. Files that don't exist or aren't readable are silently
 * skipped (a file rotated mid-scan shouldn't error the whole call).
 * Returns the union of loaded entries plus the list of files scanned.
 */
export function loadLoadedFromDir(
  dir: string,
): { loaded: LoadedRecord[]; files: string[] } {
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

/**
 * Per-record annotation summary: max importance across all annotations
 * pointing at the record (or undefined if none), the union of all
 * topic_tags arrays carried by those annotations, and the most-recent
 * summary string. "Most recent" here means the last annotation by
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
 * `content.annotates` target. Returns Map<target_record_hash,
 * AnnotationSummary>. Records with no annotations pointing at them
 * receive no entry (callers should default to undefined).
 *
 * Annotation records WITHOUT a `_local.content` sidecar (legacy bare
 * mirrors that didn't preserve content) are skipped entirely; the §8.1
 * privacy posture means the annotation's importance / topics / summary
 * are not knowable from the public AtribRecord alone.
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
    if (lr.content === undefined || lr.content === null) continue
    if (typeof lr.content !== 'object') continue
    const c = lr.content as {
      annotates?: unknown
      importance?: unknown
      topic_tags?: unknown
      summary?: unknown
    }
    if (typeof c.annotates !== 'string' || c.annotates.length === 0) continue

    const target = c.annotates
    const bin = bins.get(target) ?? {
      importances: [],
      topics: new Set<string>(),
      summary_ts: -Infinity,
    }

    if (typeof c.importance === 'string' && c.importance in IMPORTANCE_NUMERIC) {
      bin.importances.push(c.importance as ImportanceLabel)
    }
    if (Array.isArray(c.topic_tags)) {
      for (const t of c.topic_tags) {
        if (typeof t === 'string' && t.length > 0) bin.topics.add(t)
      }
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
        : bin.importances.reduce((a, b) =>
            IMPORTANCE_NUMERIC[a] >= IMPORTANCE_NUMERIC[b] ? a : b,
          )
    const summary: AnnotationSummary = {}
    if (max_importance !== undefined) summary.max_importance = max_importance
    if (bin.topics.size > 0) summary.topics = [...bin.topics].sort()
    if (bin.summary !== undefined) summary.summary = bin.summary
    out.set(target, summary)
  }
  return out
}
