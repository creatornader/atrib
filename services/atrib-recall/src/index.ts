#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/recall - local signed-record recall MCP server.
 *
 * Exposes the base recall tool plus sibling query-shape tools to the host agent.
 * Reads signed-record jsonl mirrors (per spec §5.9), VERIFIES the Ed25519
 * signature on each record before returning it, and tags every entry with
 * signature_verified so the agent can distinguish provable past from tampered
 * or partial mirror state.
 *
 * Mirror discovery (in priority order):
 *   1. ATRIB_RECORD_FILE - single explicit jsonl file. Back-compat with
 *      pre-0.4.0 callers that pinned a specific producer's mirror.
 *   2. ATRIB_MIRROR_DIR - directory; recall reads every `*.jsonl` inside.
 *      Default: ~/.atrib/records (the spec §5.9 well-known mirror namespace).
 *
 * Two on-disk shapes are accepted, matching D062 / spec §5.9:
 *   - Bare AtribRecord (legacy producers):           {spec_version, ...}
 *   - Envelope (D062 sidecar form):                  {record: {...}, proof?, _local?}
 * Both round-trip through verifyRecord; the parser picks the right inner shape.
 *
 * Trust scope: signature verification is local-only. A passing signature_verified
 * proves the record was signed by the named creator_key; it does NOT prove the
 * record was committed to log.atrib.dev. To confirm log inclusion, the caller
 * should fetch the inclusion proof from the log API.
 *
 * Configuration via environment variables:
 *   ATRIB_RECORD_FILE - single explicit file (overrides directory scan).
 *   ATRIB_MIRROR_DIR - directory to scan. Default: ~/.atrib/records.
 *   ATRIB_LOG_ORIGIN - origin used in human-readable messages.
 *                        Default: log.atrib.dev
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  verifyRecord,
  EVENT_TYPE_SHORT_NAMES,
  isValidEventTypeUri,
  normalizeEventType,
  resolveEnvContextId,
  logReadPrimitiveCall,
} from '@atrib/mcp'
import type { AtribRecord, EventTypeShortName } from '@atrib/mcp'

const EventTypeFilterSchema = z.union([
  z.enum(EVENT_TYPE_SHORT_NAMES),
  z.string().refine((value) => isValidEventTypeUri(value), {
    message: 'event_type must be an atrib shorthand alias or a syntactically valid absolute URI',
  }),
])

// Layer 1 importance grading (per the recall semantic surface design). The five
// canonical importance levels carried in annotation content per D058. The
// numeric scale (linear 5..1) is the Park et al. weighting input; the
// string form is what annotators actually emit. Exported so subsequent
// commits implementing aggregation + ranking can import the same scale
// without re-declaring it.
export type ImportanceLabel = 'critical' | 'high' | 'medium' | 'low' | 'noise'
export const IMPORTANCE_NUMERIC: Record<ImportanceLabel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  noise: 1,
}

// Layer 1 ranking weights per the recall semantic surface design. Park et al. 2023
// Weight defaults inspired by Park et al. 2023 "Generative Agents"
// (recency + importance + relevance composition). Values sum to 1.0;
// the implementation does not enforce this, but the operator-facing
// default does. Tunable per experiment via env vars; exported so future
// releases can import the same defaults.
//
// The recency weight (0.3) matches CrewAI's recency_weight=0.3 in their
// composite memory scorer (the only normalized-weights peer found in a
// 2026-05-23 survey of OSS implementations; LangChain + LlamaIndex use
// unweighted additive composition, which silently couples scales). Beta
// and gamma split the remaining 0.7 with relevance favored over
// importance (0.4 vs 0.3) because annotation-derived importance is
// already a sparse signal: most records carry none, so a higher beta
// would amplify noise from the few that do. See ADR D085 for the
// survey-grounded rationale.
export const ATRIB_RECALL_ALPHA = parseFloat(process.env.ATRIB_RECALL_ALPHA ?? '0.3')
export const ATRIB_RECALL_BETA = parseFloat(process.env.ATRIB_RECALL_BETA ?? '0.3')
export const ATRIB_RECALL_GAMMA = parseFloat(process.env.ATRIB_RECALL_GAMMA ?? '0.4')

// Recency time constant (in days) for the exponential-decay scoring
// component, applied as exp(-age_days / tau). 7-day default produces a
// half-life of tau * ln(2) ~= 4.85 days, close to Park et al.'s
// 0.995/hour decay (half-life ~5.75 days) and inside the OSS-survey
// range (LangChain ~3 days, CrewAI 30 days). Tunable per experiment.
// See ADR D085 for survey context.
export const ATRIB_RECALL_TAU_DAYS = parseFloat(process.env.ATRIB_RECALL_TAU_DAYS ?? '7')

// Layer 1 v2 anti-noise threshold for rank_by='relevance'. When the top
// Park score is below this floor, recall returns empty records + a
// "below_threshold" quality signal rather than a low-confidence top-K.
//
// Default 0.6 derivation (D086 recalibration):
//   - Pre-D086 the BM25 corpus was annotation-summary-only, leaving 99%+
//     of records un-indexable for content queries. The previous floor of
//     0.15 was derived as "alpha * 0.5 = recency-only median-aged
//     record" under the assumption Park components stay in [0, 1].
//   - D086 extends the BM25 corpus to per-event_type record content via
//     `extractIndexableText` from @atrib/mcp. Empirically against the
//     2026-05-24 operator mirror (14,363 records), 84.6% of records now
//     produce non-zero indexable tokens (avg 75.6 tokens/doc), and the
//     parkScore site clamps raw BM25 to [0, 1] so the documented Park-
//     component bound is honored.
//   - Calibration sweep (scripts/calibration-sweep-d086.mjs) measured:
//       real-query top_park    min=0.6985  max=0.9549  avg=0.7971
//       nonsense-query top_park min=0.5572  max=0.6895  avg=0.5704
//     Recent + annotated records baseline at ~0.55 from alpha*1.0 +
//     beta*importance alone (no BM25 needed). Pre-D086 floor of 0.15 is
//     a no-op against the new corpus — every record passes.
//   - 0.6 sits between the recent+annotated-only baseline (~0.55) and the
//     real-query minimum (0.6985). It filters the "active mirror, no
//     meaningful relevance" case while preserving real recall results.
//     Some nonsense queries with incidental BM25 hits (up to 0.6895) will
//     still pass; the tight ~0.01 empirical gap between real-min and
//     nonsense-max means a higher floor would also kill the lowest-
//     scoring real query. Final calibration deferred to the gold-standard
//     sweep (queued post-D085).
//
// NOVEL IN FIELD: the 2026-05-23 survey of comparable systems (Park et
// al., MemGPT/Letta, A-MEM, MemoryBank, Mem0, LangChain, LlamaIndex,
// CrewAI, Haystack, AutoGen) found no published or OSS implementation
// that returns "empty + quality:below_threshold" rather than top-K. The
// field convention is "always return something, let the agent decide
// it's noise." atrib's inversion is a deliberate protocol choice (lower
// hallucination risk from low-confidence context); it should be
// defended as innovation, not assumed convention. See ADR D085 + D086.
// Set the env var to 0 to disable entirely.
export const ATRIB_RECALL_NOISE_FLOOR = parseFloat(process.env.ATRIB_RECALL_NOISE_FLOOR ?? '0.6')
export const ATRIB_RECALL_CONTENT_MAX_RECORDS = parseInt(
  process.env.ATRIB_RECALL_CONTENT_MAX_RECORDS ?? '5000',
  10,
)
const ATRIB_RECALL_CONTENT_COVERAGE_VERSION = 'coverage-v1'
const ATRIB_RECALL_CONTENT_INDEX_VERSION = 'content-index-v1'
const ATRIB_RECALL_CONTENT_INDEX_ENABLED = process.env.ATRIB_RECALL_CONTENT_INDEX !== '0'
const ATRIB_RECALL_CONTENT_INDEX_DIR =
  process.env.ATRIB_RECALL_CONTENT_INDEX_DIR ?? join(homedir(), '.atrib', 'cache')
const ATRIB_RECALL_CONTENT_INDEX_FILE = process.env.ATRIB_RECALL_CONTENT_INDEX_FILE
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import {
  aggregateAnnotationsByRecord,
  aggregateRevisionsByRecord,
  discoverLoaded,
  loadLoaded,
  loadLoadedAppend,
  loadNewestLoadedFromDir,
} from './aggregations.js'
import type { AnnotationSummary as AggAnnotationSummary, LoadedRecord } from './aggregations.js'
import {
  recencyScore,
  importanceScore,
  parkScore,
  buildBM25Index,
  bm25Score,
  bm25ScoresForQuery,
  normalizedBm25Relevance,
  operationalToolCallScoreFactor,
  tokenize,
  indexableTokensForRecord,
  shouldSuppressLifecycleAnchorForQuery,
  queryMentionsLifecycle,
} from './scoring.js'
import type { BM25Index } from './scoring.js'
import { buildLocalGraph, shortestDistances, walkFrom } from './graph.js'
import type { EdgeType } from './graph.js'
import { synthesizeDisplaySummary, resolveDisplayProducer, formatAge } from './legibility.js'

const ATRIB_RECORD_FILE = process.env.ATRIB_RECORD_FILE
const ATRIB_MIRROR_DIR = process.env.ATRIB_MIRROR_DIR ?? join(homedir(), '.atrib', 'records')
const ATRIB_LOG_ORIGIN = process.env.ATRIB_LOG_ORIGIN ?? 'log.atrib.dev'

// Resolved once at module-init via @atrib/mcp's resolveEnvContextId
// (D078 ATRIB_CONTEXT_ID + D083 harness-discovery precedence). Per-run
// declaration; changing the env mid-process is not supported.
const ATRIB_CONTEXT_ID_DEFAULT = resolveEnvContextId()
const ATRIB_RECALL_PACKAGE_VERSION = readPackageVersion()

function recallRuntimeMetadata(): Record<string, unknown> {
  return {
    package: '@atrib/recall',
    version: ATRIB_RECALL_PACKAGE_VERSION,
    coverage_version: ATRIB_RECALL_CONTENT_COVERAGE_VERSION,
    content_index_version: ATRIB_RECALL_CONTENT_INDEX_VERSION,
  }
}

export function getAtribRecallRuntimeContract(): Record<string, unknown> {
  return recallRuntimeMetadata()
}

type MirrorFileStat = {
  path: string
  size: number
  mtimeMs: number
}

type MirrorFingerprint = {
  files: string[]
  stats: MirrorFileStat[]
  signature: string
}

type LoadedMirrorSnapshot = {
  signature: string
  stats: MirrorFileStat[]
  loaded: LoadedRecord[]
  loadedByHash: Map<string, LoadedRecord>
  newestLoaded: LoadedRecord[]
  files: string[]
  annotationsByRecord: Map<string, AggAnnotationSummary>
  revisionsByRecord: Map<string, string[]>
  bm25IndexesByNewestLimit: Map<number, BM25Index>
  maxLoadedRecords?: number
  partial: boolean
}

type ContentIndexEntry = {
  record_hash: string
  event_type: string
  context_id: string
  timestamp: number
  tool_name?: string
  producer?: string
  annotations?: AggAnnotationSummary
  display_summary: string
  display_producer?: string
  tokens: string[]
  lifecycle_anchor: boolean
  tool_call_score_factor: number
}

type ContentIndexFile = {
  schema_version: typeof ATRIB_RECALL_CONTENT_INDEX_VERSION
  coverage_version: typeof ATRIB_RECALL_CONTENT_COVERAGE_VERSION
  mirror_signature: string
  mirror_high_watermark: string
  mirror_file_count: number
  mirror_files: string[]
  mirror_stats: MirrorFileStat[]
  total_records: number
  created_at: string
  entries: ContentIndexEntry[]
}

type ContentIndexStatus = {
  version: typeof ATRIB_RECALL_CONTENT_INDEX_VERSION
  enabled: boolean
  status: 'disabled' | 'hit' | 'rebuilt' | 'memory_only' | 'invalid' | 'write_failed'
  path?: string
  reason?: string
}

type ContentSearchSnapshot = {
  signature: string
  stats: MirrorFileStat[]
  files: string[]
  totalRecords: number | null
  entries: ContentIndexEntry[]
  newestEntries: ContentIndexEntry[]
  entryByHash: Map<string, ContentIndexEntry>
  bm25IndexesByNewestLimit: Map<number, BM25Index>
  maxLoadedRecords?: number
  partial: boolean
  index: ContentIndexStatus
}

let loadedMirrorSnapshot: LoadedMirrorSnapshot | undefined
let contentSearchMirrorSnapshot: LoadedMirrorSnapshot | undefined
let contentSearchIndexSnapshot: ContentSearchSnapshot | undefined

export function clearRecallMirrorCache(): void {
  loadedMirrorSnapshot = undefined
  contentSearchMirrorSnapshot = undefined
  contentSearchIndexSnapshot = undefined
}

function readMirrorFingerprint(recordFile?: string): MirrorFingerprint {
  const envFile = process.env.ATRIB_RECORD_FILE
  const envDir = process.env.ATRIB_MIRROR_DIR ?? join(process.env.HOME ?? '', '.atrib', 'records')
  const explicit = recordFile ?? envFile
  if (explicit) {
    const stat = statMirrorFile(explicit)
    return {
      files: [explicit],
      stats: stat ? [stat] : [],
      signature: JSON.stringify({
        mode: 'file',
        file: explicit,
        stat,
      }),
    }
  }

  if (!existsSync(envDir)) {
    return {
      files: [],
      stats: [],
      signature: JSON.stringify({ mode: 'dir', dir: envDir, missing: true }),
    }
  }

  let entries: string[] = []
  try {
    entries = readdirSync(envDir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
  } catch {
    return {
      files: [],
      stats: [],
      signature: JSON.stringify({ mode: 'dir', dir: envDir, unreadable: true }),
    }
  }

  const stats: MirrorFileStat[] = []
  for (const name of entries) {
    const full = join(envDir, name)
    const stat = statMirrorFile(full)
    if (stat) stats.push(stat)
  }
  return {
    files: stats.map((stat) => stat.path),
    stats,
    signature: JSON.stringify({ mode: 'dir', dir: envDir, stats }),
  }
}

function statMirrorFile(path: string): MirrorFileStat | null {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return null
    return { path, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

function getLoadedMirrorSnapshot(recordFile?: string): LoadedMirrorSnapshot {
  const fingerprint = readMirrorFingerprint(recordFile)
  if (loadedMirrorSnapshot?.signature === fingerprint.signature) return loadedMirrorSnapshot
  const refreshed = tryAppendRefreshLoadedMirrorSnapshot(loadedMirrorSnapshot, fingerprint)
  if (refreshed) return refreshed

  const { loaded, files } = discoverLoaded(recordFile)
  const annotationsByRecord = aggregateAnnotationsByRecord(loaded)
  const revisionsByRecord = aggregateRevisionsByRecord(loaded)
  loadedMirrorSnapshot = {
    signature: fingerprint.signature,
    stats: fingerprint.stats,
    loaded,
    loadedByHash: new Map(loaded.map((lr) => [lr.record_hash, lr])),
    newestLoaded: loaded.slice().sort((a, b) => b.record.timestamp - a.record.timestamp),
    files,
    annotationsByRecord,
    revisionsByRecord,
    bm25IndexesByNewestLimit: new Map(),
    partial: false,
  }
  return loadedMirrorSnapshot
}

function getContentSearchMirrorSnapshot(maxRecords: number): LoadedMirrorSnapshot {
  const fingerprint = readMirrorFingerprint()
  if (loadedMirrorSnapshot?.signature === fingerprint.signature) return loadedMirrorSnapshot
  if (
    contentSearchMirrorSnapshot?.signature === fingerprint.signature &&
    contentSearchMirrorSnapshot.maxLoadedRecords === maxRecords
  ) {
    return contentSearchMirrorSnapshot
  }
  const refreshed = tryAppendRefreshLoadedMirrorSnapshot(
    contentSearchMirrorSnapshot,
    fingerprint,
    maxRecords,
  )
  if (refreshed) return refreshed

  const { loaded, files } = discoverNewestLoaded(maxRecords)
  const partial = loaded.length >= maxRecords
  const annotationsByRecord = aggregateAnnotationsByRecord(loaded)
  const revisionsByRecord = aggregateRevisionsByRecord(loaded)
  contentSearchMirrorSnapshot = {
    signature: fingerprint.signature,
    stats: fingerprint.stats,
    loaded,
    loadedByHash: new Map(loaded.map((lr) => [lr.record_hash, lr])),
    newestLoaded: loaded.slice().sort((a, b) => b.record.timestamp - a.record.timestamp),
    files,
    annotationsByRecord,
    revisionsByRecord,
    bm25IndexesByNewestLimit: new Map(),
    maxLoadedRecords: maxRecords,
    partial,
  }
  return contentSearchMirrorSnapshot
}

function discoverNewestLoaded(maxRecords: number): { loaded: LoadedRecord[]; files: string[] } {
  const envFile = process.env.ATRIB_RECORD_FILE
  const envDir = process.env.ATRIB_MIRROR_DIR ?? join(process.env.HOME ?? '', '.atrib', 'records')
  if (envFile) {
    return {
      loaded: loadLoaded(envFile)
        .sort((a, b) => b.record.timestamp - a.record.timestamp)
        .slice(0, maxRecords),
      files: [envFile],
    }
  }
  return loadNewestLoadedFromDir(envDir, maxRecords)
}

function getContentSearchSnapshotForRecall(
  evidenceMode: 'bounded' | 'require_complete',
  boundedLimit: number,
): ContentSearchSnapshot {
  const requireComplete = evidenceMode === 'require_complete'
  const fingerprint = readMirrorFingerprint()
  const cached = contentSearchIndexSnapshot
  if (
    cached?.signature === fingerprint.signature &&
    (!requireComplete || !cached.partial) &&
    (requireComplete || !cached.maxLoadedRecords || cached.maxLoadedRecords >= boundedLimit)
  ) {
    return cached
  }

  const durable = tryLoadDurableContentIndex(fingerprint)
  if (durable) {
    contentSearchIndexSnapshot = durable
    return durable
  }

  const loadedSnapshot = requireComplete
    ? getLoadedMirrorSnapshot()
    : getContentSearchMirrorSnapshot(boundedLimit)

  if (!requireComplete) {
    contentSearchIndexSnapshot = contentSearchSnapshotFromLoaded(
      loadedSnapshot,
      contentIndexStatus('memory_only', contentIndexPath(fingerprint)),
    )
    return contentSearchIndexSnapshot
  }

  const indexPath = contentIndexPath(fingerprint)
  if (!ATRIB_RECALL_CONTENT_INDEX_ENABLED) {
    contentSearchIndexSnapshot = contentSearchSnapshotFromLoaded(
      loadedSnapshot,
      contentIndexStatus('disabled', indexPath, 'ATRIB_RECALL_CONTENT_INDEX=0'),
    )
    return contentSearchIndexSnapshot
  }

  const indexFile = contentIndexFileFromLoaded(loadedSnapshot)
  const writeStatus = writeContentIndex(indexPath, indexFile)
  contentSearchIndexSnapshot = contentSearchSnapshotFromIndexFile(
    indexFile,
    fingerprint,
    writeStatus,
  )
  return contentSearchIndexSnapshot
}

function tryLoadDurableContentIndex(
  fingerprint: MirrorFingerprint,
): ContentSearchSnapshot | undefined {
  if (!ATRIB_RECALL_CONTENT_INDEX_ENABLED) return undefined
  const path = contentIndexPath(fingerprint)
  if (!path) return undefined
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
  const indexFile = validateContentIndexFile(parsed, fingerprint)
  if (!indexFile) return undefined
  return contentSearchSnapshotFromIndexFile(indexFile, fingerprint, contentIndexStatus('hit', path))
}

function contentIndexPath(fingerprint: MirrorFingerprint): string | undefined {
  if (!ATRIB_RECALL_CONTENT_INDEX_ENABLED) return undefined
  if (ATRIB_RECALL_CONTENT_INDEX_FILE) return ATRIB_RECALL_CONTENT_INDEX_FILE
  const hash = createHash('sha256').update(fingerprint.signature).digest('hex')
  return join(ATRIB_RECALL_CONTENT_INDEX_DIR, `recall-content-${hash}.json`)
}

function contentIndexStatus(
  status: ContentIndexStatus['status'],
  path?: string,
  reason?: string,
): ContentIndexStatus {
  return {
    version: ATRIB_RECALL_CONTENT_INDEX_VERSION,
    enabled: ATRIB_RECALL_CONTENT_INDEX_ENABLED,
    status,
    ...(path ? { path } : {}),
    ...(reason ? { reason } : {}),
  }
}

function writeContentIndex(
  path: string | undefined,
  indexFile: ContentIndexFile,
): ContentIndexStatus {
  if (!path) return contentIndexStatus('memory_only', undefined, 'no content index path resolved')
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmpPath, JSON.stringify(indexFile))
    renameSync(tmpPath, path)
    return contentIndexStatus('rebuilt', path)
  } catch (error) {
    return contentIndexStatus(
      'write_failed',
      path,
      error instanceof Error ? error.message : String(error),
    )
  }
}

function contentIndexFileFromLoaded(snapshot: LoadedMirrorSnapshot): ContentIndexFile {
  return {
    schema_version: ATRIB_RECALL_CONTENT_INDEX_VERSION,
    coverage_version: ATRIB_RECALL_CONTENT_COVERAGE_VERSION,
    mirror_signature: snapshot.signature,
    mirror_high_watermark: mirrorHighWatermark(snapshot),
    mirror_file_count: snapshot.files.length,
    mirror_files: snapshot.files,
    mirror_stats: snapshot.stats,
    total_records: snapshot.loaded.length,
    created_at: new Date().toISOString(),
    entries: snapshot.loaded.map((lr) => contentIndexEntryFromLoaded(lr, snapshot)),
  }
}

function contentIndexEntryFromLoaded(
  lr: LoadedRecord,
  snapshot: LoadedMirrorSnapshot,
): ContentIndexEntry {
  const annotations = snapshot.annotationsByRecord.get(lr.record_hash)
  const toolName = (lr.record as AtribRecord & { tool_name?: string }).tool_name
  const displayProducer = resolveDisplayProducer(lr.record, lr.producer)
  return {
    record_hash: lr.record_hash,
    event_type: lr.record.event_type,
    context_id: lr.record.context_id,
    timestamp: lr.record.timestamp,
    ...(toolName ? { tool_name: toolName } : {}),
    ...(lr.producer ? { producer: lr.producer } : {}),
    ...(annotations ? { annotations } : {}),
    display_summary: synthesizeDisplaySummary(lr.record, lr.content, annotations),
    ...(displayProducer ? { display_producer: displayProducer } : {}),
    tokens: indexableTokensForRecord(lr, annotations),
    lifecycle_anchor: shouldSuppressLifecycleAnchorForQuery(lr, annotations, []),
    tool_call_score_factor: operationalToolCallScoreFactor(lr, annotations),
  }
}

function contentSearchSnapshotFromLoaded(
  snapshot: LoadedMirrorSnapshot,
  index: ContentIndexStatus,
): ContentSearchSnapshot {
  const entries = snapshot.loaded.map((lr) => contentIndexEntryFromLoaded(lr, snapshot))
  return {
    signature: snapshot.signature,
    stats: snapshot.stats,
    files: snapshot.files,
    totalRecords: snapshot.partial ? null : snapshot.loaded.length,
    entries,
    newestEntries: entries.slice().sort((a, b) => b.timestamp - a.timestamp),
    entryByHash: new Map(entries.map((entry) => [entry.record_hash, entry])),
    bm25IndexesByNewestLimit: new Map(),
    maxLoadedRecords: snapshot.maxLoadedRecords,
    partial: snapshot.partial,
    index,
  }
}

function contentSearchSnapshotFromIndexFile(
  indexFile: ContentIndexFile,
  fingerprint: MirrorFingerprint,
  index: ContentIndexStatus,
): ContentSearchSnapshot {
  return {
    signature: fingerprint.signature,
    stats: fingerprint.stats,
    files: indexFile.mirror_files,
    totalRecords: indexFile.total_records,
    entries: indexFile.entries,
    newestEntries: indexFile.entries.slice().sort((a, b) => b.timestamp - a.timestamp),
    entryByHash: new Map(indexFile.entries.map((entry) => [entry.record_hash, entry])),
    bm25IndexesByNewestLimit: new Map(),
    partial: false,
    index,
  }
}

function validateContentIndexFile(
  parsed: unknown,
  fingerprint: MirrorFingerprint,
): ContentIndexFile | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  if (obj.schema_version !== ATRIB_RECALL_CONTENT_INDEX_VERSION) return undefined
  if (obj.coverage_version !== ATRIB_RECALL_CONTENT_COVERAGE_VERSION) return undefined
  if (obj.mirror_signature !== fingerprint.signature) return undefined
  if (obj.mirror_high_watermark !== mirrorHighWatermarkFromSignature(fingerprint.signature)) {
    return undefined
  }
  if (typeof obj.total_records !== 'number' || !Number.isFinite(obj.total_records)) {
    return undefined
  }
  if (!Array.isArray(obj.entries) || obj.entries.length !== obj.total_records) return undefined
  if (!Array.isArray(obj.mirror_files) || !obj.mirror_files.every((v) => typeof v === 'string')) {
    return undefined
  }
  if (!Array.isArray(obj.mirror_stats)) return undefined
  if (typeof obj.created_at !== 'string') return undefined
  const entries = obj.entries.map(normalizeContentIndexEntry)
  if (entries.some((entry) => entry === undefined)) return undefined
  return {
    schema_version: ATRIB_RECALL_CONTENT_INDEX_VERSION,
    coverage_version: ATRIB_RECALL_CONTENT_COVERAGE_VERSION,
    mirror_signature: fingerprint.signature,
    mirror_high_watermark: obj.mirror_high_watermark as string,
    mirror_file_count:
      typeof obj.mirror_file_count === 'number' ? obj.mirror_file_count : fingerprint.files.length,
    mirror_files: obj.mirror_files as string[],
    mirror_stats: fingerprint.stats,
    total_records: obj.total_records,
    created_at: obj.created_at,
    entries: entries as ContentIndexEntry[],
  }
}

function normalizeContentIndexEntry(value: unknown): ContentIndexEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  if (typeof obj.record_hash !== 'string') return undefined
  if (typeof obj.event_type !== 'string') return undefined
  if (typeof obj.context_id !== 'string') return undefined
  if (typeof obj.timestamp !== 'number' || !Number.isFinite(obj.timestamp)) return undefined
  if (typeof obj.display_summary !== 'string') return undefined
  if (!Array.isArray(obj.tokens) || !obj.tokens.every((token) => typeof token === 'string')) {
    return undefined
  }
  const entry: ContentIndexEntry = {
    record_hash: obj.record_hash,
    event_type: obj.event_type,
    context_id: obj.context_id,
    timestamp: obj.timestamp,
    display_summary: obj.display_summary,
    tokens: obj.tokens,
    lifecycle_anchor: obj.lifecycle_anchor === true,
    tool_call_score_factor:
      typeof obj.tool_call_score_factor === 'number' && Number.isFinite(obj.tool_call_score_factor)
        ? obj.tool_call_score_factor
        : 1,
  }
  if (typeof obj.tool_name === 'string') entry.tool_name = obj.tool_name
  if (typeof obj.producer === 'string') entry.producer = obj.producer
  if (typeof obj.display_producer === 'string') entry.display_producer = obj.display_producer
  if (obj.annotations && typeof obj.annotations === 'object') {
    entry.annotations = obj.annotations as AggAnnotationSummary
  }
  return entry
}

function tryAppendRefreshLoadedMirrorSnapshot(
  previous: LoadedMirrorSnapshot | undefined,
  fingerprint: MirrorFingerprint,
  maxLoadedRecords?: number,
): LoadedMirrorSnapshot | undefined {
  if (!previous) return undefined
  if (
    maxLoadedRecords !== undefined &&
    previous.maxLoadedRecords !== undefined &&
    previous.maxLoadedRecords !== maxLoadedRecords
  ) {
    return undefined
  }
  if (!sameMirrorFiles(previous.stats, fingerprint.stats)) return undefined

  const previousByPath = new Map(previous.stats.map((stat) => [stat.path, stat]))
  const appended: LoadedRecord[] = []
  for (const current of fingerprint.stats) {
    const prior = previousByPath.get(current.path)
    if (!prior) return undefined
    if (current.size < prior.size) return undefined
    if (current.size > prior.size) {
      appended.push(...loadLoadedAppend(current.path, prior.size))
    }
  }

  if (appended.length === 0) {
    previous.signature = fingerprint.signature
    previous.stats = fingerprint.stats
    return previous
  }

  let loaded = previous.loaded.concat(appended)
  let partial = previous.partial
  if (maxLoadedRecords !== undefined) {
    partial = previous.partial || loaded.length > maxLoadedRecords
    loaded = loaded
      .sort((a, b) => b.record.timestamp - a.record.timestamp)
      .slice(0, maxLoadedRecords)
  }
  const loadedByHash = new Map(loaded.map((lr) => [lr.record_hash, lr]))
  const annotationsByRecord = aggregateAnnotationsByRecord(loaded)
  const revisionsByRecord = aggregateRevisionsByRecord(loaded)
  const refreshed: LoadedMirrorSnapshot = {
    signature: fingerprint.signature,
    stats: fingerprint.stats,
    loaded,
    loadedByHash,
    newestLoaded: loaded.slice().sort((a, b) => b.record.timestamp - a.record.timestamp),
    files: fingerprint.files,
    annotationsByRecord,
    revisionsByRecord,
    bm25IndexesByNewestLimit: new Map(),
    maxLoadedRecords,
    partial,
  }
  if (previous.partial) {
    contentSearchMirrorSnapshot = refreshed
  } else {
    loadedMirrorSnapshot = refreshed
  }
  return refreshed
}

function sameMirrorFiles(a: MirrorFileStat[], b: MirrorFileStat[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]!.path !== b[i]!.path) return false
  }
  return true
}

function getBm25IndexForNewestLimit(snapshot: LoadedMirrorSnapshot, limit: number): BM25Index {
  const boundedLimit = Math.max(1, Math.min(snapshot.newestLoaded.length, limit))
  const cached = snapshot.bm25IndexesByNewestLimit.get(boundedLimit)
  if (cached) return cached
  const corpus = snapshot.newestLoaded.slice(0, boundedLimit).map((lr) => ({
    id: lr.record_hash,
    tokens: indexableTokensForRecord(lr, snapshot.annotationsByRecord.get(lr.record_hash)),
  }))
  const index = buildBM25Index(corpus)
  snapshot.bm25IndexesByNewestLimit.set(boundedLimit, index)
  return index
}

function getContentBm25IndexForNewestLimit(
  snapshot: ContentSearchSnapshot,
  limit: number,
): BM25Index {
  const boundedLimit = Math.max(1, Math.min(snapshot.newestEntries.length, limit))
  const cached = snapshot.bm25IndexesByNewestLimit.get(boundedLimit)
  if (cached) return cached
  const corpus = snapshot.newestEntries.slice(0, boundedLimit).map((entry) => ({
    id: entry.record_hash,
    tokens: entry.tokens,
  }))
  const index = buildBM25Index(corpus)
  snapshot.bm25IndexesByNewestLimit.set(boundedLimit, index)
  return index
}

function effectiveToolCallScoreFactor(
  entry: ContentIndexEntry,
  includeToolCallArgs: boolean,
): number {
  if (includeToolCallArgs && entry.tool_call_score_factor < 1) return 1
  return entry.tool_call_score_factor
}

function hasExplicitRecordLimit(requested: unknown): requested is number {
  return typeof requested === 'number' && Number.isFinite(requested)
}

function resolvePositiveRecordLimit(requested: unknown, fallback: number): number {
  const raw = typeof requested === 'number' && Number.isFinite(requested) ? requested : fallback
  return Math.max(1, Math.floor(raw))
}

function resolveBoundedContentSearchLimit(requested: unknown, totalRecords: number): number {
  return Math.min(
    totalRecords,
    resolvePositiveRecordLimit(requested, ATRIB_RECALL_CONTENT_MAX_RECORDS),
  )
}

function resolveCompleteContentSearchLimit(requested: unknown, totalRecords: number): number {
  if (totalRecords <= 0) return 0
  return Math.min(totalRecords, resolvePositiveRecordLimit(requested, totalRecords))
}

function mirrorHighWatermark(snapshot: LoadedMirrorSnapshot): string {
  return mirrorHighWatermarkFromSignature(snapshot.signature)
}

function mirrorHighWatermarkFromSignature(signature: string): string {
  return `sha256:${createHash('sha256').update(signature).digest('hex')}`
}

function recallCoverage(
  snapshot: { signature: string; files: string[] },
  strategy: 'bounded_newest_first' | 'complete_full_scan' | 'incomplete_explicit_limit',
  searchedRecords: number,
  index?: ContentIndexStatus,
): Record<string, unknown> {
  const coverage: Record<string, unknown> = {
    version: ATRIB_RECALL_CONTENT_COVERAGE_VERSION,
    strategy,
    corpus: 'local_mirror',
    mirror_high_watermark: mirrorHighWatermarkFromSignature(snapshot.signature),
    mirror_file_count: snapshot.files.length,
    searched_records: searchedRecords,
  }
  if (index) coverage.index = index
  return coverage
}

/**
 * Pull the inner AtribRecord out of either on-disk shape (D062 envelope or
 * legacy bare record). Returns null when the line is neither shape or is
 * missing required fields. Same shape contract as the wrapper-side
 * normalizeMirrorLine in @atrib/mcp-wrap.
 */
function extractRecord(parsed: unknown): AtribRecord | null {
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  // D062 envelope: { record: {...}, proof?, _local?, written_at? }.
  // Legacy bare: the AtribRecord fields sit at the top level.
  const candidate =
    typeof obj.record === 'object' && obj.record !== null
      ? (obj.record as Record<string, unknown>)
      : obj
  if (
    typeof candidate.spec_version === 'string' &&
    typeof candidate.event_type === 'string' &&
    typeof candidate.context_id === 'string' &&
    typeof candidate.creator_key === 'string' &&
    typeof candidate.chain_root === 'string' &&
    typeof candidate.signature === 'string'
  ) {
    return candidate as unknown as AtribRecord
  }
  return null
}

export function loadRecords(path: string): AtribRecord[] {
  if (!existsSync(path)) return []
  const out: AtribRecord[] = []
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = extractRecord(JSON.parse(trimmed))
      if (rec) out.push(rec)
    } catch {
      // Malformed JSON; skip.
    }
  }
  return out
}

/**
 * Load every `*.jsonl` file in `dir` and merge their records. Files that
 * don't exist or aren't readable are silently skipped (a file rotated out
 * mid-scan shouldn't error the whole call). Returns the union of records;
 * de-duplication and ordering are caller responsibilities.
 *
 * Spec §5.9 establishes `~/.atrib/records/` as the well-known per-agent
 * mirror namespace; every producer running under one identity writes a
 * file there with the convention `<producer>-<agent>.jsonl`. Scanning the
 * directory unifies recall across producers without recall having to know
 * the naming scheme - any producer that follows §5.9 just shows up.
 */
export function loadRecordsFromDir(dir: string): { records: AtribRecord[]; files: string[] } {
  if (!existsSync(dir)) return { records: [], files: [] }
  let entries: string[]
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return { records: [], files: [] }
  }
  const records: AtribRecord[] = []
  const files: string[] = []
  for (const name of entries) {
    const full = join(dir, name)
    try {
      const stat = statSync(full)
      if (!stat.isFile()) continue
    } catch {
      continue
    }
    const loaded = loadRecords(full)
    if (loaded.length > 0) {
      records.push(...loaded)
      files.push(full)
    } else {
      // Surface empty/unreadable files too so the operator can see them in
      // the response if they care, but only if the file existed (which it
      // does - readdirSync returned it).
      files.push(full)
    }
  }
  return { records, files }
}

type ContextScope = 'all' | 'env'

interface RecallArgs {
  context_id?: string
  /**
   * Controls whether omitted context_id means cross-context recall or the
   * D078/D083 env-derived current context. Base recall defaults to `all`
   * because it is the cross-session memory lookup surface. Harnesses that
   * need per-arm isolation without plumbing context_id can pass `env`.
   * Explicit context_id always wins.
   */
  context_scope?: ContextScope
  /**
   * Optional exact match on `record.creator_key` (Ed25519 public key,
   * base64url-encoded). Filters the local mirror to records signed by
   * one specific creator. The tool's name says "my attribution history"
   * but the local mirror may hold records from other signers (multi-
   * agent flows, transactions with counterparty signatures, etc.). Use
   * this filter to scope strictly to your own past.
   */
  creator_key?: string
  event_type?: EventTypeShortName | string
  /**
   * Optional exact match on `record.content_id` (`sha256:<64-hex>`). Per spec
   * §1.2.2, content_id is `sha256(serverUrl + ":" + toolName)`. Filtering by
   * content_id groups all records emitted by the same tool on the same MCP
   * server. Useful for "all calls to this tool, ever." Coarser than tool_name
   * because two tools on different servers share no content_id even if their
   * names match.
   */
  content_id?: string
  /**
   * Optional exact match on the §8.2 disclosed `tool_name`. Records that did
   * NOT opt in to tool-name disclosure (the §8.1 default posture) carry no
   * tool_name field and are excluded from results when this filter is set.
   * Use this to query by human-readable name (e.g. tool_name="Edit") across
   * MCP servers, when the producer disclosed it.
   */
  tool_name?: string
  /**
   * Optional exact match on `record.args_hash` (`sha256:<64-hex>`). Per spec
   * §8.3, args_hash commits to canonical args bytes. Salted (D045) and plain
   * forms hash identically on the wire; this filter does not distinguish
   * them. Most useful for replay detection (same args, same hash) and for
   * agent-side keyed lookup when the agent computes a probe hash over a
   * normalized {tool, target} dict.
   */
  args_hash?: string
  /**
   * Layer 1 filter (NEW in 0.5.0): minimum annotation importance. Records
   * are ranked by max(annotation.importance) where annotations are D058
   * records pointing at this record. Records with no annotations at all
   * have importance=0 and are EXCLUDED from results when min_importance is
   * set. Use this to surface only records the agent or its critique loop
   * has marked as worth attention.
   */
  min_importance?: ImportanceLabel
  /**
   * Layer 1 filter (NEW in 0.5.0): OR-match against annotation topic tags.
   * Records are kept if AT LEAST ONE annotation pointing at them carries
   * AT LEAST ONE of the listed topics. Records with no annotations or no
   * topic-overlap are excluded. Topics come from D058 annotation content.
   */
  topic_tags?: string[]
  /**
   * Layer 1 filter (NEW in 0.5.0): hide records superseded by D059 revision
   * records. Default false (records remain visible even if a later revision
   * supersedes them; the response carries `superseded_by` so the agent can
   * see). Set true to filter superseded records out of the response entirely.
   */
  include_revised?: boolean
  /**
   * Layer 1 filter (NEW in 0.5.0): minimum count of distinct cross-attesting
   * signers per D052. Useful for transaction records that must carry >= 2
   * signers; also useful as a credibility filter when querying multi-agent
   * substrate. Records below the threshold are excluded.
   */
  min_signers?: number
  /**
   * Layer 1 ranking (NEW in 0.5.0): how to order results before paging.
   * 'timestamp' (default, backward-compatible): newest first.
   * 'relevance': Park et al. 2023 weighted-sum scoring with annotation-derived
   * importance (NO embedding component until Layer 2 ships; falls back to BM25
   * over summary+topics if rank_anchor query is provided).
   * 'causal_distance': BFS shortest path in the §3.2.4 derived graph from
   * `rank_anchor` (which must be a record_hash). Edge weights per design.
   */
  rank_by?: 'timestamp' | 'relevance' | 'causal_distance'
  /**
   * Layer 1 ranking (NEW in 0.5.0): the anchor for non-timestamp rank_by
   * modes. For rank_by='causal_distance', this MUST be a record_hash
   * (`sha256:<64-hex>`); records are ranked by BFS shortest path from
   * the anchor. For rank_by='relevance' with an optional query string,
   * pass the query here as a free-form text string (Layer 2 will use it
   * for embedding similarity; Layer 1 falls back to BM25-style scoring
   * over summary+topics).
   */
  rank_anchor?: string
  /**
   * New in 0.5.0: table-of-contents response shape. When true,
   * each record returned is a one-line entry shape (record_hash, tool_name,
   * summary, importance, topic_tags, timestamp, superseded_by). Cheap to
   * scan, ~40-80 tokens per entry; agent expands on demand via
   * `recall(content_id=..., compact=false)` or `recall_walk(...)`. Used at
   * SessionStart for the auto-injected scaffold.
   */
  toc?: boolean
  limit?: number
  offset?: number
  /**
   * When true (the default), the response omits signature/content_id/
   * chain_root/spec_version. Set verbose=true to include them.
   */
  compact?: boolean
  /**
   * When true (the default), the response includes only records whose
   * Ed25519 signature verified locally. Set include_unverified=true to also
   * include tampered/unverified records (always with signature_verified=false
   * so the agent can decide).
   */
  include_unverified?: boolean
}

/**
 * Aggregated annotation summary attached to a record per Layer 1. Same
 * shape as the canonical AnnotationSummary exported from aggregations.ts;
 * aliased here so the response types in this file don't have to drag the
 * aggregations module into their import surface.
 */
type AnnotationSummary = AggAnnotationSummary

/**
 * The shape returned to the agent. Each record is annotated with
 * signature_verified - true if the local Ed25519 signature check passed.
 * In compact mode the heavy fields (signature, content_id, chain_root,
 * spec_version) are dropped; the verified status is preserved.
 *
 * Layer 1 (0.5.0) adds optional `annotations` (max_importance + topics from
 * any D058 annotations pointing at this record) and `superseded_by` (record
 * hashes of any D059 revision records whose `revises` field equals this
 * record's hash).
 */
type RecallRecordCompact = {
  /**
   * Record identifier: sha256:<64-hex>. Always included so callers can
   * re-query (recall_walk, recall_annotations, recall_revisions, trace) or
   * cite the result without recomputing the hash. Surface 6 instrumentation
   * also samples this for fires.jsonl correlation.
   */
  record_hash: string
  event_type: AtribRecord['event_type']
  context_id: string
  creator_key: string
  timestamp: number
  signature_verified: boolean
  session_token?: string
  /**
   * §8.2 disclosed tool name. Included in compact mode when present so a
   * caller filtering by tool_name sees the value back in the response (the
   * common pattern: filter by tool_name -> render results, want the name
   * visible). Records without tool_name disclosure (the §8.1 default
   * posture) omit this field as they always do.
   */
  tool_name?: string
  /** New in 0.5.0: aggregated annotation summary. */
  annotations?: AnnotationSummary
  /** New in 0.5.0: record hashes of D059 revisions superseding this record. */
  superseded_by?: string[]
  /**
   * New in 0.8.0 (Layer 1 v2 legibility): one-line human-legible
   * description. Annotation summary if present, else per-event_type
   * synthesis from record fields + _local.content, else generic
   * fallback. Derived via legibility.synthesizeDisplaySummary.
   */
  display_summary?: string
  /**
   * New in 0.8.0 (Layer 1 v2 legibility): friendly producer label from
   * _local.producer (e.g. "atrib-emit-cli"), else "key:<8hex>" fallback
   * signaling raw key. Derived via legibility.resolveDisplayProducer.
   */
  display_producer?: string
  /**
   * New in 0.8.0 (Layer 1 v2 legibility): relative time string
   * ("just now", "5m ago", "3d ago", absolute date for older than 30d).
   * Computed at response time from record.timestamp. Derived via
   * legibility.formatAge.
   */
  age?: string
}

/**
 * TOC entry: the smallest cheap-to-scan shape (~40-80 tokens). Used at
 * SessionStart auto-inject to surface a candidate set the agent can
 * expand on demand via recall(content_id=...) or recall_walk.
 */
export type RecallRecordToc = {
  record_hash?: string
  tool_name?: string
  summary?: string
  importance?: ImportanceLabel
  topic_tags?: string[]
  timestamp: number
  superseded_by?: string[]
}

type RecallRecordFull = AtribRecord & {
  signature_verified: boolean
  annotations?: AnnotationSummary
  superseded_by?: string[]
  local_content?: unknown
  local_producer?: string
}

export interface RecallResult {
  total: number
  returned: number
  /**
   * Count of records dropped because their Ed25519 signature did not verify.
   * Always 0 when include_unverified=true was passed.
   */
  filtered_out_by_verification: number
  /**
   * Mirror files actually scanned. When ATRIB_RECORD_FILE was set, this is
   * a single-element list (back-compat). Otherwise it lists every `*.jsonl`
   * found in ATRIB_MIRROR_DIR.
   */
  record_files: string[]
  /**
   * @deprecated Use `record_files`. Preserved as the first entry of
   * `record_files` for callers still reading this field.
   */
  record_file: string
  log_origin: string
  pagination_caveat: string
  records: RecallRecordFull[] | RecallRecordCompact[] | RecallRecordToc[]
  /**
   * New in 0.8.0 (Layer 1 v2 anti-noise): present when rank_by='relevance'
   * returned empty results because the top Park score was below
   * ATRIB_RECALL_NOISE_FLOOR. Lets the caller distinguish "no records
   * matched the filters" (returned=0, no quality field) from "records
   * matched but none scored high enough to be useful" (returned=0,
   * quality='below_threshold'). Omitted when results were returned.
   */
  quality?: 'below_threshold'
  /**
   * New in 0.8.0 (Layer 1 v2 anti-noise): the top Park score observed
   * during this relevance ranking, present only when quality is set so
   * the caller can see how close to the threshold the best result was.
   */
  top_score?: number
}

/**
 * Sort `filtered` in-place by Park et al. parkScore descending. Builds
 * the BM25 index over each loaded record's annotation summary + topics
 * (the indexable Layer 1 text per the design); when rank_anchor is a
 * non-empty string, treats it as the query and adds the relevance
 * component. When rank_anchor is empty or a record_hash (the
 * causal_distance shape), relevance is 0 for every record and the score
 * collapses to alpha*recency + beta*importance.
 *
 * Uses now=Date.now() inside the function so the recall response reflects
 * the moment of evaluation. Determinism is preserved at the per-call
 * level (two recall() calls in the same millisecond produce identical
 * scores given identical input).
 */
function rankByRelevance(
  filtered: LoadedRecord[],
  annotationsByRecord: Map<string, AnnotationSummary>,
  rankAnchor: string | undefined,
  bm25Index?: BM25Index,
): number {
  const now = Date.now()
  // Treat rank_anchor as a free-form query unless it parses as a record_hash
  // (sha256:<64-hex>). Future: when rank_by='causal_distance' wires up,
  // record_hash anchors go to the BFS path; here, record_hash anchors
  // contribute 0 relevance (recency + importance only).
  const looksLikeRecordHash =
    typeof rankAnchor === 'string' && /^sha256:[0-9a-f]{64}$/.test(rankAnchor)
  const queryTokens = rankAnchor && !looksLikeRecordHash ? tokenize(rankAnchor) : []

  const idx =
    bm25Index ??
    buildBM25Index(
      filtered.map((lr) => ({
        id: lr.record_hash,
        tokens: indexableTokensForRecord(lr, annotationsByRecord.get(lr.record_hash)),
      })),
    )

  const scores = new Map<string, number>()
  let topScore = 0
  for (const lr of filtered) {
    const ann = annotationsByRecord.get(lr.record_hash)
    const suppressLifecycleAnchor = shouldSuppressLifecycleAnchorForQuery(lr, ann, queryTokens)
    const toolCallScoreFactor = operationalToolCallScoreFactor(lr, ann)
    const r = recencyScore(lr.record.timestamp, now, ATRIB_RECALL_TAU_DAYS) * toolCallScoreFactor
    const i = suppressLifecycleAnchor ? 0 : importanceScore(ann)
    // Raw BM25 is unbounded and can saturate from one rare term in a long
    // query. Convert it to the bounded Park relevance component by clamping
    // the raw score and scaling it by unique query-token coverage.
    const rawRel =
      !suppressLifecycleAnchor && queryTokens.length > 0
        ? bm25Score(idx, lr.record_hash, queryTokens)
        : 0
    const rel =
      !suppressLifecycleAnchor && queryTokens.length > 0
        ? normalizedBm25Relevance(idx, lr.record_hash, queryTokens, rawRel) * toolCallScoreFactor
        : 0
    const s = parkScore(r, i, rel, ATRIB_RECALL_ALPHA, ATRIB_RECALL_BETA, ATRIB_RECALL_GAMMA)
    scores.set(lr.record_hash, s)
    if (s > topScore) topScore = s
  }
  filtered.sort((a, b) => {
    const sa = scores.get(a.record_hash) ?? 0
    const sb = scores.get(b.record_hash) ?? 0
    if (sb !== sa) return sb - sa
    // Stable tie-break on timestamp newest-first.
    return b.record.timestamp - a.record.timestamp
  })
  // Return the top score so the caller can apply the anti-noise threshold
  // (Layer 1 v2: suppress low-confidence top-K rather than train the agent
  // to ignore recall results). Each Park component is in [0, 1] and the
  // weights are operator-configured to sum to 1.0 by default, so topScore
  // also lives in [0, 1] under normal config.
  return topScore
}

/**
 * Sort `filtered` in-place by BFS shortest-path distance from rank_anchor.
 * The graph is built from the FULL `all` set (not just filtered) so the
 * BFS can traverse through records that the post-filter pipeline would
 * later drop, the agent's question is "what's causally near this
 * anchor", not "what's causally near and also matches my filters".
 *
 * Records unreachable from rank_anchor are sorted to the end (Infinity
 * distance) with a stable timestamp tie-break newest-first.
 *
 * If rank_anchor is missing or doesn't parse as a record_hash, the
 * function leaves `filtered` in input order. (Callers passing a free-form
 * query meant rank_by='relevance' instead; we don't second-guess.)
 */
function rankByCausalDistance(
  filtered: LoadedRecord[],
  all: LoadedRecord[],
  rankAnchor: string | undefined,
): void {
  if (!rankAnchor || !/^sha256:[0-9a-f]{64}$/.test(rankAnchor)) {
    // Fall back to timestamp newest-first when the anchor is unusable;
    // matches the existing pre-Layer-1 default rather than leaving an
    // arbitrary order.
    filtered.sort((a, b) => b.record.timestamp - a.record.timestamp)
    return
  }
  const graph = buildLocalGraph(all)
  const dist = shortestDistances(graph, rankAnchor)
  filtered.sort((a, b) => {
    const da = dist.get(a.record_hash) ?? Number.POSITIVE_INFINITY
    const db = dist.get(b.record_hash) ?? Number.POSITIVE_INFINITY
    if (da !== db) return da - db
    return b.record.timestamp - a.record.timestamp
  })
}

/**
 * Verified-record bundle carried through the pipeline. The flat
 * AtribRecord-shaped `record` lets compactify + toc projection read all
 * fields; `record_hash` is preserved separately so the toc shape can
 * surface it without re-canonicalizing (and getting the wrong hash from
 * the annotations / superseded_by fields).
 */
type VerifiedBundle = {
  record: AtribRecord
  record_hash: string
  signature_verified: boolean
  annotations?: AnnotationSummary
  superseded_by?: string[]
  /** D062 `_local.content` carried through for Layer 1 v2 legibility. */
  content?: unknown
  /** D062 `_local.producer` carried through for Layer 1 v2 legibility. */
  producer?: string
}

async function annotateVerification(
  loaded: { record: AtribRecord; record_hash: string; content?: unknown; producer?: string }[],
  annotationsByRecord: Map<string, AnnotationSummary>,
  revisionsByRecord: Map<string, string[]>,
): Promise<VerifiedBundle[]> {
  return Promise.all(
    loaded.map(async (lr) => {
      let ok: boolean
      try {
        ok = await verifyRecord(lr.record)
      } catch {
        ok = false
      }
      const out: VerifiedBundle = {
        record: lr.record,
        record_hash: lr.record_hash,
        signature_verified: ok,
      }
      const ann = annotationsByRecord.get(lr.record_hash)
      if (ann) out.annotations = ann
      const supers = revisionsByRecord.get(lr.record_hash)
      if (supers && supers.length > 0) out.superseded_by = supers
      if (lr.content !== undefined) out.content = lr.content
      if (lr.producer !== undefined) out.producer = lr.producer
      return out
    }),
  )
}

function compactify(bundles: VerifiedBundle[], now: number = Date.now()): RecallRecordCompact[] {
  return bundles.map((b) => {
    const r = b.record
    const out: RecallRecordCompact = {
      record_hash: b.record_hash,
      event_type: r.event_type,
      context_id: r.context_id,
      creator_key: r.creator_key,
      timestamp: r.timestamp,
      signature_verified: b.signature_verified,
    }
    const sessionToken = (r as AtribRecord & { session_token?: string }).session_token
    const toolName = (r as AtribRecord & { tool_name?: string }).tool_name
    if (sessionToken) out.session_token = sessionToken
    if (toolName) out.tool_name = toolName
    if (b.annotations) out.annotations = b.annotations
    if (b.superseded_by) out.superseded_by = b.superseded_by
    // Layer 1 v2 legibility fields. Always populated (the helpers fall
    // back to sentinels when source data is missing). Cheap to compute
    // and the agent-side cost of opaque hashes is non-trivial.
    out.display_summary = synthesizeDisplaySummary(r, b.content, b.annotations)
    out.display_producer = resolveDisplayProducer(r, b.producer)
    out.age = formatAge(r.timestamp, now)
    return out
  })
}

function fullify(bundles: VerifiedBundle[]): RecallRecordFull[] {
  return bundles.map((b) => {
    const out = { ...b.record, signature_verified: b.signature_verified } as RecallRecordFull
    if (b.annotations) out.annotations = b.annotations
    if (b.superseded_by) out.superseded_by = b.superseded_by
    if (b.content !== undefined) out.local_content = b.content
    if (b.producer !== undefined) out.local_producer = b.producer
    return out
  })
}

function extractRecordHashFieldsFromMcpResult(result: unknown): string[] {
  const seen = new Set<string>()
  const pattern = /^sha256:[0-9a-f]{64}$/
  const content = (result as { content?: unknown })?.content
  const text =
    Array.isArray(content) &&
    typeof (content[0] as { text?: unknown } | undefined)?.text === 'string'
      ? (content[0] as { text: string }).text
      : undefined
  let root: unknown = result
  if (text) {
    try {
      root = JSON.parse(text)
    } catch {
      root = result
    }
  }
  walk(root)
  return Array.from(seen)

  function walk(node: unknown): void {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    if (typeof obj.record_hash === 'string' && pattern.test(obj.record_hash)) {
      seen.add(obj.record_hash)
    }
    for (const value of Object.values(obj)) walk(value)
  }
}

/**
 * Discover and load records per the mirror-discovery contract:
 *   - If `recordFile` is provided, load just that file.
 *   - Else if ATRIB_RECORD_FILE is set, load just that file (back-compat).
 *   - Else scan ATRIB_MIRROR_DIR (default ~/.atrib/records).
 *
 * Returns the union of records and the list of files scanned. Callers that
 * dedupe should key on `record.signature` (signatures are unique per record
 * per spec §1.4); the same record present in two mirrors will appear twice
 * here unless the caller dedupes.
 */
export function discoverRecords(recordFile?: string): { records: AtribRecord[]; files: string[] } {
  const explicit = recordFile ?? ATRIB_RECORD_FILE
  if (explicit) {
    return { records: loadRecords(explicit), files: [explicit] }
  }
  return loadRecordsFromDir(ATRIB_MIRROR_DIR)
}

export async function recall(args: RecallArgs, recordFile?: string): Promise<RecallResult> {
  // Defaults: compact=true (small responses) and include_unverified=false
  // (no tampered records). The verbose+include-tampered combo is opt-in.
  // Rationale: a poorly-written agent that doesn't check signature_verified
  // would otherwise treat tampered records as provable. Default to safe.
  const compact = args.compact !== false
  const includeUnverified = args.include_unverified === true

  const snapshot = getLoadedMirrorSnapshot(recordFile)
  const { loaded: all, files, annotationsByRecord, revisionsByRecord } = snapshot

  // Base recall is the broad "what do I know about X?" surface, so omitted
  // context_id defaults to cross-context history. D078/D083 env scoping remains
  // available for harness isolation via context_scope='env'. Explicit
  // context_id always wins.
  const effectiveContextId =
    args.context_id ?? (args.context_scope === 'env' ? ATRIB_CONTEXT_ID_DEFAULT : undefined)

  let filtered = all
  if (effectiveContextId)
    filtered = filtered.filter((lr) => lr.record.context_id === effectiveContextId)
  if (args.creator_key) {
    filtered = filtered.filter((lr) => lr.record.creator_key === args.creator_key)
  }
  if (args.event_type) {
    // Schema accepts short form ('tool_call'|'transaction'|'observation'|...);
    // records carry full URI form, so normalize before comparison.
    const targetUri = normalizeEventType(args.event_type)
    filtered = filtered.filter((lr) => lr.record.event_type === targetUri)
  }
  if (args.content_id) filtered = filtered.filter((lr) => lr.record.content_id === args.content_id)
  if (args.tool_name) filtered = filtered.filter((lr) => lr.record.tool_name === args.tool_name)
  if (args.args_hash) filtered = filtered.filter((lr) => lr.record.args_hash === args.args_hash)

  // Layer 1 filters (consume the annotation + revision aggregations).
  if (args.min_importance) {
    const minScore = IMPORTANCE_NUMERIC[args.min_importance]
    filtered = filtered.filter((lr) => {
      const ann = annotationsByRecord.get(lr.record_hash)
      if (!ann || !ann.max_importance) return false
      return IMPORTANCE_NUMERIC[ann.max_importance] >= minScore
    })
  }
  if (args.topic_tags && args.topic_tags.length > 0) {
    const wanted = new Set(args.topic_tags)
    filtered = filtered.filter((lr) => {
      const ann = annotationsByRecord.get(lr.record_hash)
      return !!ann?.topics?.some((t) => wanted.has(t))
    })
  }
  // include_revised is misnamed: `true` HIDES records that have revisions
  // pointing at them. `false` / undefined keeps them visible (the default;
  // they appear with superseded_by populated). See the schema description.
  if (args.include_revised === true) {
    filtered = filtered.filter((lr) => !revisionsByRecord.has(lr.record_hash))
  }
  // min_signers: distinct-signer count is signers?.length (transaction records
  // per D052) or 1 (the implicit creator's single signature on every other
  // event_type). Records below the threshold are excluded.
  if (typeof args.min_signers === 'number') {
    const min = args.min_signers
    filtered = filtered.filter((lr) => {
      const signersField = (lr.record as AtribRecord & { signers?: unknown[] }).signers
      const count = Array.isArray(signersField) ? signersField.length : 1
      return count >= min
    })
  }

  // Sort: timestamp (default, newest first), Park et al. relevance, or
  // BFS shortest-path causal distance from rank_anchor.
  let relevanceTopScore: number | undefined
  if (args.rank_by === 'relevance') {
    relevanceTopScore = rankByRelevance(filtered, annotationsByRecord, args.rank_anchor)
  } else if (args.rank_by === 'causal_distance') {
    rankByCausalDistance(filtered, all, args.rank_anchor)
  } else {
    // Newest first - the agent typically wants its most-recent provable
    // actions, not the genesis of the log.
    filtered.sort((a, b) => b.record.timestamp - a.record.timestamp)
  }

  // Layer 1 v2 anti-noise threshold: when rank_by='relevance' and the
  // top Park score falls below ATRIB_RECALL_NOISE_FLOOR (default 0.6 per
  // D086), return empty records + a "below_threshold" quality signal
  // instead of a low-confidence top-K. The 0.6 default sits between the
  // recent+annotated-only baseline (~0.55) and the real-query minimum
  // (~0.70) observed empirically against the 2026-05-24 operator mirror.
  // Below that, results are effectively noise and training the agent to
  // scan + dismiss them costs more than returning nothing. See ADR D086
  // for the full derivation + the constant declaration above for the
  // calibration sweep details.
  if (
    args.rank_by === 'relevance' &&
    relevanceTopScore !== undefined &&
    relevanceTopScore < ATRIB_RECALL_NOISE_FLOOR
  ) {
    return {
      total: filtered.length,
      returned: 0,
      filtered_out_by_verification: 0,
      record_files: files,
      record_file: files[0] ?? '',
      log_origin: ATRIB_LOG_ORIGIN,
      pagination_caveat:
        'offset is not stable when new records are appended. For consistent paging, capture the' +
        ' first-page timestamps and re-page using a context_id or event_type filter instead.',
      records: [],
      quality: 'below_threshold',
      top_score: relevanceTopScore,
    }
  }

  const offset = Math.max(0, args.offset ?? 0)
  // Default limit 10 matches the field convention (Haystack, AutoGen,
  // mem0, Letta all default top_k=10). Was 25 before D085; changed to
  // reduce default token weight in agent context windows.
  const limit = Math.max(1, Math.min(200, args.limit ?? 10))
  const page = filtered.slice(offset, offset + limit)
  let verified = await annotateVerification(page, annotationsByRecord, revisionsByRecord)

  // Apply verification filter post-paging so `total` reflects the unfiltered
  // count (matches user expectation of "how many records exist that match
  // your context_id+event_type filters?"). filtered_out distinguishes the
  // verification-rejection count.
  let filteredOutByVerification = 0
  if (!includeUnverified) {
    const before = verified.length
    verified = verified.filter((r) => r.signature_verified === true)
    filteredOutByVerification = before - verified.length
  }

  // toc=true: ~40-80-token-per-entry shape suitable for SessionStart
  // auto-injection. Pulls the cheap-to-scan fields and drops everything
  // else. Implicit signature_verified is preserved-by-omission (only
  // records that passed the verification filter make it here, unless
  // the caller also set include_unverified=true).
  const toc = args.toc === true
  let records: RecallRecordFull[] | RecallRecordCompact[] | RecallRecordToc[]
  if (toc) {
    records = verified.map((b) => {
      const out: RecallRecordToc = { timestamp: b.record.timestamp }
      out.record_hash = b.record_hash
      const toolName = (b.record as AtribRecord & { tool_name?: string }).tool_name
      if (toolName) out.tool_name = toolName
      if (b.annotations?.summary) out.summary = b.annotations.summary
      if (b.annotations?.max_importance) out.importance = b.annotations.max_importance
      if (b.annotations?.topics) out.topic_tags = b.annotations.topics
      if (b.superseded_by) out.superseded_by = b.superseded_by
      return out
    })
  } else if (compact) {
    records = compactify(verified)
  } else {
    records = fullify(verified)
  }

  return {
    total: filtered.length,
    returned: verified.length,
    filtered_out_by_verification: filteredOutByVerification,
    record_files: files,
    record_file: files[0] ?? '',
    log_origin: ATRIB_LOG_ORIGIN,
    pagination_caveat:
      'offset is not stable when new records are appended. For consistent paging, capture the' +
      ' first-page timestamps and re-page using a context_id or event_type filter instead.',
    records,
  }
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export interface AtribRecallServer {
  mcp: McpServer
}

// The recall semantic surface (as defined in the public protocol specification).
// Eight distinct MCP tools: recall_my_attribution_history is the base
// filter-and-page tool; recall_annotations + recall_revisions return
// aggregated annotation summaries / revision chains for a specific
// record_hash; recall_walk traverses the local Layer 1 derived graph;
// recall_by_content runs BM25 free-form retrieval; recall_session_chain,
// recall_orphans, and recall_by_signer cover common agent lookup shapes.
export function registerAtribRecallTools(server: McpServer): void {
  server.registerTool(
    'recall_my_attribution_history',
    {
      description:
        "Return signed atrib records from the local mirror. The agent's own past, with each record's " +
        'Ed25519 signature verified locally. By default the response is compact (no signature bytes) and ' +
        'includes only records that passed signature verification; both can be opted out of with ' +
        'compact=false and include_unverified=true respectively. Local signature verification proves ' +
        '"this record was signed by that creator_key"; it does NOT prove log inclusion (fetch a log ' +
        'inclusion proof to confirm). Filter by context_id (specific trace), context_scope ' +
        "('all' by default, or 'env' to honor D078/D083 env scoping), event_type " +
        '(tool_call|transaction|observation|annotation|revision|directory_anchor or a full URI), content_id (specific tool on specific server), tool_name (disclosed ' +
        'name per §8.2), or args_hash (canonical-args commitment per §8.3). Filters are AND-combined; ' +
        'omit all of them for cross-trace history. Results are sorted newest-first. Pagination uses ' +
        'offset; new records appended between calls invalidate offset stability. See the ' +
        'pagination_caveat in the response. The filtered_out_by_verification field reports how many ' +
        'records were dropped due to signature failures (always 0 when include_unverified=true).',
      inputSchema: {
        context_id: z
          .string()
          .optional()
          .describe(
            'Optional trace identifier (32 hex chars). Limits results to records signed within this trace. ' +
              'Omit for cross-trace recall.',
          ),
        context_scope: z
          .enum(['all', 'env'])
          .optional()
          .describe(
            "How to treat an omitted context_id. Default 'all' searches cross-context history. " +
              "'env' applies the D078/D083 env-derived current context. Explicit context_id wins.",
          ),
        creator_key: z
          .string()
          .optional()
          .describe(
            'Optional exact match on record.creator_key (base64url-encoded Ed25519 public key, 43 chars). ' +
              'Filters the local mirror to records signed by this specific creator. Omit to see all signers ' +
              "present in the mirror; the tool name says 'my attribution history' but the mirror may contain " +
              'records from other creators when multi-agent flows ship records into a shared mirror. Use ' +
              'your own creator_key (resolvable from the @atrib/cli key-show output, or `getPublicKey()` ' +
              'called on your seed) when you want to scope strictly to your own past.',
          ),
        event_type: EventTypeFilterSchema.optional().describe(
          'Optional filter to a single event kind. Accepts atrib shorthand aliases ' +
            '(tool_call, transaction, observation, annotation, revision, directory_anchor) ' +
            'or a full event_type URI. Most calls leave this unset.',
        ),
        content_id: z
          .string()
          .optional()
          .describe(
            'Optional exact match on record.content_id (sha256:<64-hex>). Per spec §1.2.2, content_id ' +
              'is sha256(serverUrl + ":" + toolName), so filtering groups all records emitted by the same ' +
              'tool on the same MCP server. Coarser than tool_name (different servers, same name -> ' +
              'different content_id).',
          ),
        tool_name: z
          .string()
          .optional()
          .describe(
            'Optional exact match on the §8.2 disclosed tool_name. Records that did NOT opt in to ' +
              'tool-name disclosure (the §8.1 default posture) carry no tool_name field and are excluded ' +
              'from results when this filter is set.',
          ),
        args_hash: z
          .string()
          .optional()
          .describe(
            'Optional exact match on record.args_hash (sha256:<64-hex>). Per spec §8.3, args_hash commits ' +
              'to canonical args bytes (salted or plain; both forms hash identically on the wire). Most ' +
              'useful for replay detection or agent-side keyed lookup over a normalized probe hash.',
          ),
        limit: z.number().optional().describe('Page size, default 10, max 200.'),
        offset: z
          .number()
          .optional()
          .describe(
            'Pagination offset, default 0. Note: not stable when new records land between calls - see ' +
              'pagination_caveat in the response.',
          ),
        compact: z
          .boolean()
          .optional()
          .describe(
            'Default true. When true, omit signature/content_id/chain_root/spec_version fields. ' +
              'signature_verified is still included. Set to false (or use the equivalent verbose=true) ' +
              'when you need the full record bytes for re-verification or downstream processing.',
          ),
        include_unverified: z
          .boolean()
          .optional()
          .describe(
            'Default false. When false, records with signature_verified=false are dropped from the ' +
              'response (their count is reported in filtered_out_by_verification). Set to true to ' +
              'include them - useful when investigating tampered or partial mirror state.',
          ),
        // Layer 1 semantic filters. These are enforced in the handler below and
        // share the same response metadata path as the base filters.
        min_importance: z
          .enum(['critical', 'high', 'medium', 'low', 'noise'])
          .optional()
          .describe(
            'Filter to records whose maximum annotation importance is at least this level. Annotation ' +
              'importance comes from annotation records pointing at the record. Records with no ' +
              'annotations at all are excluded when this filter is set.',
          ),
        topic_tags: z
          .array(z.string())
          .optional()
          .describe(
            'OR-match against annotation topic tags. Records are kept if at least one annotation pointing ' +
              'at them carries at least one of the listed topics. Records with no annotations or no ' +
              'topic overlap are excluded.',
          ),
        include_revised: z
          .boolean()
          .optional()
          .describe(
            'Default false: revised records remain visible with superseded_by populated. Set true to hide ' +
              'records that have been superseded by a revision record (revises field equals this record).',
          ),
        min_signers: z
          .number()
          .optional()
          .describe(
            'Minimum count of distinct signers. Transaction records carry a signers[] array (cross- ' +
              'attestation); the count is its length. Non-transaction records have a single signature; ' +
              'their count is 1. Records below the threshold are excluded.',
          ),
        rank_by: z
          .enum(['timestamp', 'relevance', 'causal_distance'])
          .optional()
          .describe(
            'Result ordering. timestamp (default): newest first. relevance: Park et al. weighted-sum ' +
              'scoring over recency + annotation-derived importance + BM25 relevance against rank_anchor ' +
              '(treated as a free-form query when not a record_hash; otherwise relevance component is 0). ' +
              'causal_distance: BFS shortest path in the local derived graph from rank_anchor (a record_hash). ' +
              'Records unreachable from the anchor sort to the end.',
          ),
        rank_anchor: z
          .string()
          .optional()
          .describe(
            'Anchor for non-timestamp rank_by modes. For rank_by=relevance: free-form text query for the ' +
              'BM25 component (matched against annotation summary + topics of each candidate). For ' +
              'rank_by=causal_distance: record_hash to BFS from (sha256:<64-hex>); falls back to timestamp ' +
              'newest-first when not a valid record_hash.',
          ),
        toc: z
          .boolean()
          .optional()
          .describe(
            'Default false. When true, each returned record is the table-of-contents entry shape ' +
              '(record_hash, tool_name, summary, importance, topic_tags, timestamp, superseded_by) at ' +
              '~40-80 tokens per entry. Designed for SessionStart auto-injected scaffold and any other ' +
              'cheap-to-scan candidate set the agent expands on demand via recall(content_id=...) or ' +
              'recall_walk.',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_my_attribution_history',
        args,
        async () => {
          // All Layer 1 surface parameters are enforced by recall() above:
          // min_importance, topic_tags, include_revised, min_signers,
          // rank_by, rank_anchor, and toc.
          const result = await recall(args as RecallArgs)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  // ─── Layer 1 sibling tools ───
  // Sibling tools expose common agent lookup shapes beyond the base
  // filter-and-page tool.

  server.registerTool(
    'recall_walk',
    {
      description:
        'Walk the local derived graph from a starting record_hash. Returns records reachable via the requested edge types up to the given hop depth, ordered by ascending weighted distance. Layer 1 covers four edge types: CHAIN_PRECEDES (weight 1), INFORMED_BY (weight 1), ANNOTATES (weight 2), REVISES (weight 2). SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, and PROVENANCE_OF are deferred to subsequent releases. Useful for tracing the local causal neighborhood of a record before re-attempting a similar action.',
      inputSchema: {
        from_record_hash: z
          .string()
          .describe(
            'Starting record hash (sha256:<64-hex>). The walk begins here and expands through the local derived graph.',
          ),
        edge_types: z
          .array(z.enum(['CHAIN_PRECEDES', 'INFORMED_BY', 'ANNOTATES', 'REVISES']))
          .optional()
          .describe(
            'Optional list of Layer 1 edge types to follow. Default: all four. Unknown values are rejected by the schema.',
          ),
        depth: z
          .number()
          .optional()
          .describe(
            'Maximum hop count (NOT cumulative weight). Default 3. Higher values may return many records; paginate downstream if needed.',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_walk',
        args,
        async () => {
          const { loaded, annotationsByRecord } = getLoadedMirrorSnapshot()
          const graph = buildLocalGraph(loaded)
          const edgeTypes = args.edge_types ? new Set(args.edge_types as EdgeType[]) : undefined
          const depth = typeof args.depth === 'number' ? args.depth : 3
          const walk = walkFrom(graph, args.from_record_hash, edgeTypes, depth)
          // Layer 1 v2 legibility: join walked hashes back to their loaded
          // records so each step in the walk carries a readable label
          // instead of just a hash + distance. Builds the index once for
          // O(N) lookup across the walk; for typical walks (depth=3, k<50)
          // this is fast.
          const byHash = new Map(loaded.map((lr) => [lr.record_hash, lr]))
          const now = Date.now()
          const enriched = walk.map((step) => {
            // walk derives from graph (built from `loaded`); byHash always has a hit.
            const lr = byHash.get(step.record_hash)!
            const ann = annotationsByRecord.get(step.record_hash)
            return {
              record_hash: step.record_hash,
              distance: step.distance,
              event_type: lr.record.event_type,
              timestamp: lr.record.timestamp,
              display_summary: synthesizeDisplaySummary(lr.record, lr.content, ann),
              display_producer: resolveDisplayProducer(lr.record, lr.producer),
              age: formatAge(lr.record.timestamp, now),
            }
          })
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    from_record_hash: args.from_record_hash,
                    edge_types: args.edge_types ?? [
                      'CHAIN_PRECEDES',
                      'INFORMED_BY',
                      'ANNOTATES',
                      'REVISES',
                    ],
                    depth,
                    count: enriched.length,
                    walk: enriched,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  server.registerTool(
    'recall_annotations',
    {
      description:
        "Return the aggregated annotation summary for a record: maximum annotation importance across all D058 annotation records pointing at it, the union of their topic tags, and the most recent summary string. Useful for surfacing the agent's prior critique on a record before re-attempting a similar action. Returns null annotations field when no annotation points at the record.",
      inputSchema: {
        record_hash: z
          .string()
          .describe(
            'Record hash (sha256:<64-hex>) of the record whose annotations should be retrieved. Annotations are D058 records whose signed annotates field equals this hash.',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_annotations',
        args,
        async () => {
          const { annotationsByRecord } = getLoadedMirrorSnapshot()
          const summary = annotationsByRecord.get(args.record_hash) ?? null
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { record_hash: args.record_hash, annotations: summary },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  server.registerTool(
    'recall_revisions',
    {
      description:
        "Return the D059 revision chain for a record, with per-entry content + sibling-fan-out awareness. Walks revises edges forward from the given record_hash, surfacing each revision in turn. Each entry carries the revision's record_hash, timestamp, and content (`new_position`, `reason`, `importance`) so the agent can read the chain inline without follow-up recall calls per entry. When more than one revision targets the same record, the chain follows the first-by-timestamp branch and lists the other branch heads as `sibling_hashes` on that entry so the agent learns about parallel revision branches (common in multi-agent flows). Useful for checking whether a position the agent previously held has been revised before acting on it. Returns an empty chain when no revision points at the record.",
      inputSchema: {
        record_hash: z
          .string()
          .describe(
            'Record hash (sha256:<64-hex>) of the record whose revision chain should be retrieved. Revisions are D059 records whose signed revises field equals this hash (or chain back to it).',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_revisions',
        args,
        async () => {
          const { loaded, revisionsByRecord } = getLoadedMirrorSnapshot()
          const byHash = new Map<string, LoadedRecord>()
          for (const lr of loaded) byHash.set(lr.record_hash, lr)
          // Walk the chain forward: the input record may be revised by R1;
          // R1 may be revised by R2; collect them in order. Bounded by the
          // mirror size (no cycles since timestamps are monotonic per
          // signer; defensive seen-set anyway). Each entry enriches the
          // bare record_hash with the revision's per-event_type content
          // fields (D086-normative: new_position, reason, importance), so
          // the agent can read the chain without a separate recall call
          // per revision.
          type ChainEntry = {
            record_hash: string
            timestamp?: number
            new_position?: string
            reason?: string
            importance?: string
            /**
             * Hashes of OTHER revisions pointing at the same target as this
             * entry's parent step (sibling fan-out). Present only when more
             * than one revision targeted the same record; the chain follows
             * the first-by-timestamp branch and lists the rest here so the
             * agent learns about parallel revision branches that exist but
             * weren't traversed. Agents wanting to read a sibling chain
             * should call `recall_revisions` recursively on the sibling's
             * record_hash.
             */
            sibling_hashes?: string[]
          }
          const chain: ChainEntry[] = []
          const seen = new Set<string>()
          let current = args.record_hash
          while (!seen.has(current)) {
            seen.add(current)
            const next = revisionsByRecord.get(current)
            if (!next || next.length === 0) break
            // Each entry in the map's value array is a revision pointing at
            // `current`. The chain follows the first-by-timestamp revision;
            // the remaining entries are surfaced as `sibling_hashes` so the
            // agent learns that branches exist without the chain shape
            // having to explode into a tree.
            const revHash = next[0]!
            const siblings = next.slice(1)
            const revLr = byHash.get(revHash)
            const entry: ChainEntry = { record_hash: revHash }
            if (revLr) {
              entry.timestamp = revLr.record.timestamp
              const c = revLr.content
              if (c && typeof c === 'object' && !Array.isArray(c)) {
                const cObj = c as Record<string, unknown>
                if (typeof cObj.new_position === 'string') entry.new_position = cObj.new_position
                if (typeof cObj.reason === 'string') entry.reason = cObj.reason
                if (typeof cObj.importance === 'string') entry.importance = cObj.importance
              }
            }
            if (siblings.length > 0) {
              entry.sibling_hashes = siblings
            }
            chain.push(entry)
            current = revHash
          }
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { record_hash: args.record_hash, revision_chain: chain },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  server.registerTool(
    'recall_by_content',
    {
      description:
        "Free-form text search over the agent's signed past. Returns top-k records by hybrid retrieval: BM25 over each record's per-event_type indexable text (observation `what + why_noted + intent + rationale + topics`; tool_call `tool_name + args + result`; annotation `summary + topics`; revision `prior_position + new_position + reason + topics`; transaction counterparty + memo; directory_anchor tree_root; extension URIs via generic recursive string-walk per D086/D118) plus the annotation summary + topics when present as a curator-quality lift. Reranked by Park et al. weighted-sum scoring with annotation-derived importance and recency signals. Raw unannotated tool_call records are score-demoted so operation logs do not dominate substantive memory. BM25 contribution is clamped to [0, 1] before coverage scaling so the documented Park-component bound is honored. Responses include runtime metadata plus coverage.index, so callers can detect stale MCP processes and whether the durable content-token sidecar was hit, rebuilt, disabled, or bypassed. Useful when the agent has no specific filter and needs to ask 'what do I know about X?'.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "Free-form text query. Matches against each record's per-event_type content plus annotation summary and topics via BM25. Records with no indexable text contribute no relevance signal and only surface through the recency or importance fallback.",
          ),
        k: z
          .number()
          .optional()
          .describe(
            'Top-k results to return (default 10, max 50). Final ordering uses Park et al. weighted-sum scoring: alpha*recency + beta*importance + gamma*BM25_relevance. Weights are tunable via ATRIB_RECALL_ALPHA/BETA/GAMMA env vars.',
          ),
        max_records: z
          .number()
          .optional()
          .describe(
            'Maximum newest-first records to search before BM25 candidate scoring. Default ATRIB_RECALL_CONTENT_MAX_RECORDS or 5000. In require_complete mode, omit this for full loaded-mirror coverage; an explicit value below total_records is treated as partial evidence.',
          ),
        evidence_mode: z
          .enum(['bounded', 'require_complete'])
          .optional()
          .describe(
            'Default bounded keeps recall_by_content fast by searching the newest max_records window. ' +
              'Use require_complete for critical-path audits: it loads the full mirror, searches every ' +
              'loaded record, and refuses partial results with evidence_status=incomplete plus ' +
              'fallback_required=true when max_records is explicitly below total_records.',
          ),
        include_tool_call_args: z
          .boolean()
          .optional()
          .describe(
            'Lift the operational tool_call score suppression for this query so unannotated tool_call records, including their indexed args and result excerpts, rank by ordinary recency and relevance. The default keeps them down-weighted so operational noise does not dominate conversational recall.',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_by_content',
        args,
        async () => {
          const evidenceMode =
            args.evidence_mode === 'require_complete' ? 'require_complete' : 'bounded'
          const includeToolCallArgs = args.include_tool_call_args === true
          const boundedLimit = resolveBoundedContentSearchLimit(
            args.max_records,
            Number.MAX_SAFE_INTEGER,
          )
          const snapshot = getContentSearchSnapshotForRecall(evidenceMode, boundedLimit)
          const { entryByHash } = snapshot
          const totalRecords = snapshot.totalRecords
          const loadedLength = snapshot.entries.length
          const searchLimit =
            evidenceMode === 'require_complete'
              ? resolveCompleteContentSearchLimit(args.max_records, loadedLength)
              : Math.min(boundedLimit, loadedLength)
          const explicitLimit = hasExplicitRecordLimit(args.max_records)
          if (evidenceMode === 'require_complete' && explicitLimit && searchLimit < loadedLength) {
            const k = Math.max(1, Math.min(50, args.k ?? 10))
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      query: args.query,
                      k,
                      runtime: recallRuntimeMetadata(),
                      ...(includeToolCallArgs ? { include_tool_call_args: true } : {}),
                      evidence_mode: evidenceMode,
                      evidence_status: 'incomplete',
                      fallback_required: true,
                      fallback_reason:
                        `require_complete refused a partial corpus: search_cap=${searchLimit}, ` +
                        `total_records=${loadedLength}.`,
                      fallback:
                        'Rerun without max_records for full loaded-mirror coverage, or pass an explicit ' +
                        'partition filter through a caller-owned audit plan and treat each partition as its own coverage claim.',
                      total_records: loadedLength,
                      searched_records: 0,
                      search_cap: searchLimit,
                      coverage: recallCoverage(
                        snapshot,
                        'incomplete_explicit_limit',
                        0,
                        snapshot.index,
                      ),
                      candidate_records: 0,
                      truncated_corpus: true,
                      count: 0,
                      results: [],
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }
          const bm25Index = getContentBm25IndexForNewestLimit(snapshot, searchLimit)
          const queryTokens = tokenize(args.query)
          const relevanceByHash = bm25ScoresForQuery(bm25Index, queryTokens)
          const now = Date.now()
          const searchPool =
            queryTokens.length > 0
              ? Array.from(relevanceByHash.keys())
                  .map((hash) => entryByHash.get(hash))
                  .filter((entry): entry is ContentIndexEntry => entry !== undefined)
              : snapshot.newestEntries.slice(0, searchLimit)
          const filteredSearchPool = searchPool.filter(
            (entry) => !(entry.lifecycle_anchor && !queryMentionsLifecycle(queryTokens)),
          )
          const scored = filteredSearchPool.map((entry) => {
            const ann = entry.annotations
            const suppressLifecycleAnchor =
              entry.lifecycle_anchor && !queryMentionsLifecycle(queryTokens)
            const toolCallScoreFactor = effectiveToolCallScoreFactor(entry, includeToolCallArgs)
            const r =
              recencyScore(entry.timestamp, now, ATRIB_RECALL_TAU_DAYS) * toolCallScoreFactor
            const i = suppressLifecycleAnchor ? 0 : importanceScore(ann)
            const rawRel =
              !suppressLifecycleAnchor && queryTokens.length > 0
                ? (relevanceByHash.get(entry.record_hash) ?? 0)
                : 0
            const rel =
              !suppressLifecycleAnchor && queryTokens.length > 0
                ? normalizedBm25Relevance(bm25Index, entry.record_hash, queryTokens, rawRel) *
                  toolCallScoreFactor
                : 0
            const score = parkScore(
              r,
              i,
              rel,
              ATRIB_RECALL_ALPHA,
              ATRIB_RECALL_BETA,
              ATRIB_RECALL_GAMMA,
            )
            return { entry, score, recency: r, importance: i, relevance: rel }
          })
          scored.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            return b.entry.timestamp - a.entry.timestamp
          })
          const k = Math.max(1, Math.min(50, args.k ?? 10))
          const top = scored.slice(0, k)
          const completeCoverage = !snapshot.partial && searchLimit >= loadedLength
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    query: args.query,
                    k,
                    runtime: recallRuntimeMetadata(),
                    ...(includeToolCallArgs ? { include_tool_call_args: true } : {}),
                    evidence_mode: evidenceMode,
                    evidence_status: completeCoverage ? 'complete' : 'bounded',
                    fallback_required: false,
                    total_records: totalRecords,
                    searched_records: searchLimit,
                    coverage: recallCoverage(
                      snapshot,
                      completeCoverage ? 'complete_full_scan' : 'bounded_newest_first',
                      searchLimit,
                      snapshot.index,
                    ),
                    candidate_records: filteredSearchPool.length,
                    truncated_corpus: !completeCoverage,
                    count: top.length,
                    results: top.map(({ entry, score, recency, importance, relevance }) => {
                      return {
                        record_hash: entry.record_hash,
                        event_type: entry.event_type,
                        context_id: entry.context_id,
                        timestamp: entry.timestamp,
                        tool_name: entry.tool_name,
                        annotations: entry.annotations,
                        // Layer 1 v2 legibility fields (parity with compactify).
                        display_summary: entry.display_summary,
                        display_producer: entry.display_producer,
                        age: formatAge(entry.timestamp, now),
                        score,
                        components: { recency, importance, relevance },
                      }
                    }),
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  // recall_session_chain: records in a context_id, ordered chronologically
  // (the natural traversal of the CHAIN_PRECEDES topology). Doable via
  // recall_my_attribution_history({context_id}) + a manual timestamp sort,
  // but agents naturally think "what happened in this session?" and this
  // gives them one call.
  server.registerTool(
    'recall_session_chain',
    {
      description:
        "Return all records in a context_id, ordered chronologically (oldest-first). The natural traversal of the CHAIN_PRECEDES topology for a single session/trace. Each entry carries record_hash, event_type, timestamp, display_summary (per-event_type human-readable text from D086), and producer label. Useful for 'what happened in this session?' without manually sorting filter results. Sibling tool to recall_my_attribution_history with built-in context_id scoping + chain-ascending order.",
      inputSchema: {
        context_id: z
          .string()
          .optional()
          .describe(
            "32-hex context_id. When omitted, falls back to @atrib/mcp's resolveEnvContextId (ATRIB_CONTEXT_ID env or D083-registered harness env like CLAUDE_CODE_SESSION_ID).",
          ),
        limit: z
          .number()
          .optional()
          .describe(
            "Maximum records to return (default 50, max 500). Truncated from the END of the chain (oldest-first ordering preserves the chain's start).",
          ),
        include_content: z
          .boolean()
          .optional()
          .describe(
            'When true, include D062 local mirror body as local_content on each returned record. Defaults false to keep the session chain cheap.',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_session_chain',
        args,
        async () => {
          const ctx = args.context_id ?? resolveEnvContextId()
          if (!ctx) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      context_id: null,
                      count: 0,
                      records: [],
                      warning: 'no context_id supplied or resolvable via env',
                    },
                    null,
                    2,
                  ),
                },
              ],
            }
          }
          const { loaded, annotationsByRecord } = getLoadedMirrorSnapshot()
          const filtered = loaded
            .filter((lr) => lr.record.context_id === ctx)
            .sort((a, b) => a.record.timestamp - b.record.timestamp)
          const limit = Math.max(1, Math.min(500, args.limit ?? 50))
          const sliced = filtered.slice(0, limit)
          const now = Date.now()
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    context_id: ctx,
                    total: filtered.length,
                    returned: sliced.length,
                    truncated: filtered.length > sliced.length,
                    records: sliced.map((lr) => {
                      const ann = annotationsByRecord.get(lr.record_hash)
                      const entry: {
                        record_hash: string
                        event_type: AtribRecord['event_type']
                        timestamp: number
                        display_summary: string
                        display_producer: string
                        age: string
                        informed_by?: string[]
                        tool_name?: string
                        args_hash?: string
                        result_hash?: string
                        local_content?: unknown
                        local_producer?: string
                      } = {
                        record_hash: lr.record_hash,
                        event_type: lr.record.event_type,
                        timestamp: lr.record.timestamp,
                        display_summary: synthesizeDisplaySummary(lr.record, lr.content, ann),
                        display_producer: resolveDisplayProducer(lr.record, lr.producer),
                        age: formatAge(lr.record.timestamp, now),
                      }
                      const informedBy = (lr.record as AtribRecord & { informed_by?: string[] })
                        .informed_by
                      const toolName = (lr.record as AtribRecord & { tool_name?: string }).tool_name
                      const argsHash = (lr.record as AtribRecord & { args_hash?: string }).args_hash
                      const resultHash = (lr.record as AtribRecord & { result_hash?: string })
                        .result_hash
                      if (Array.isArray(informedBy) && informedBy.length > 0) {
                        entry.informed_by = informedBy
                      }
                      if (toolName) entry.tool_name = toolName
                      if (argsHash) entry.args_hash = argsHash
                      if (resultHash) entry.result_hash = resultHash
                      if (args.include_content === true && lr.content !== undefined) {
                        entry.local_content = lr.content
                      }
                      if (args.include_content === true && lr.producer !== undefined) {
                        entry.local_producer = lr.producer
                      }
                      return entry
                    }),
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  // recall_orphans: records nothing else cites via informed_by. Useful for
  // "what decisions did I make and never act on?": loose-end discovery.
  server.registerTool(
    'recall_orphans',
    {
      description:
        "Return records that are NOT cited by any other record via informed_by (loose ends: decisions or observations the agent made but never followed up on). Surfaces records whose record_hash does NOT appear in any other record's informed_by[] array within the local mirror. Optionally scoped to one context_id, one event_type, or one creator_key. Useful for the agent to discover dropped balls (e.g. 'I noted X but never built on it').",
      inputSchema: {
        context_id: z
          .string()
          .optional()
          .describe('Optional 32-hex context_id to scope orphan-discovery to one session/trace.'),
        event_type: EventTypeFilterSchema.optional().describe(
          "Optional filter to one event_type alias or full URI. Most useful with 'observation' to find unfollowed noting/discovery events.",
        ),
        creator_key: z
          .string()
          .optional()
          .describe(
            'Optional exact match on record.creator_key (base64url). Filters orphan-discovery to records signed by one creator.',
          ),
        limit: z
          .number()
          .optional()
          .describe('Maximum records to return (default 50, max 500), newest-first.'),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_orphans',
        args,
        async () => {
          const { loaded, annotationsByRecord } = getLoadedMirrorSnapshot()
          // Build the set of all record_hashes that appear in any record's
          // informed_by field. Anything in `loaded` whose record_hash is
          // NOT in this set is an orphan.
          const cited = new Set<string>()
          for (const lr of loaded) {
            const ib = lr.record.informed_by
            if (Array.isArray(ib)) {
              for (const h of ib) if (typeof h === 'string') cited.add(h)
            }
          }
          let orphans = loaded.filter((lr) => !cited.has(lr.record_hash))
          if (args.context_id) {
            orphans = orphans.filter((lr) => lr.record.context_id === args.context_id)
          }
          if (args.creator_key) {
            orphans = orphans.filter((lr) => lr.record.creator_key === args.creator_key)
          }
          if (args.event_type) {
            const targetUri = normalizeEventType(args.event_type)
            orphans = orphans.filter((lr) => lr.record.event_type === targetUri)
          }
          orphans.sort((a, b) => b.record.timestamp - a.record.timestamp)
          const limit = Math.max(1, Math.min(500, args.limit ?? 50))
          const sliced = orphans.slice(0, limit)
          const now = Date.now()
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    total: orphans.length,
                    returned: sliced.length,
                    truncated: orphans.length > sliced.length,
                    records: sliced.map((lr) => {
                      const ann = annotationsByRecord.get(lr.record_hash)
                      return {
                        record_hash: lr.record_hash,
                        event_type: lr.record.event_type,
                        context_id: lr.record.context_id,
                        timestamp: lr.record.timestamp,
                        display_summary: synthesizeDisplaySummary(lr.record, lr.content, ann),
                        display_producer: resolveDisplayProducer(lr.record, lr.producer),
                        age: formatAge(lr.record.timestamp, now),
                      }
                    }),
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )

  // recall_by_signer: aggregate the mirror by creator_key. Lets the agent
  // ask "who else is in this mirror?" before deciding whether to scope
  // queries with creator_key filters. Useful when the mirror is shared
  // across multi-agent flows (transactions with counterparty signers,
  // peer-shared records, etc.).
  server.registerTool(
    'recall_by_signer',
    {
      description:
        "Aggregate the local mirror by creator_key. Returns the distinct creators present + per-creator record count + latest record timestamp. Useful when the mirror is multi-signer (multi-agent flows, transactions with counterparty signers) and the agent wants to discover who else's records are in scope before deciding whether to filter with creator_key. Pure aggregation; no records returned directly. Use recall_my_attribution_history with the creator_key filter to drill into one creator's records.",
      inputSchema: {
        min_records: z
          .number()
          .optional()
          .describe(
            'Optional minimum record count to include a creator in the result. Default 1 (include all).',
          ),
      },
    },
    async (args) =>
      logReadPrimitiveCall(
        'recall_by_signer',
        args,
        async () => {
          const { loaded } = getLoadedMirrorSnapshot()
          type SignerStat = {
            creator_key: string
            count: number
            latest_timestamp: number
            earliest_timestamp: number
          }
          const byKey = new Map<string, SignerStat>()
          for (const lr of loaded) {
            const key = lr.record.creator_key
            const existing = byKey.get(key)
            if (existing) {
              existing.count++
              if (lr.record.timestamp > existing.latest_timestamp)
                existing.latest_timestamp = lr.record.timestamp
              if (lr.record.timestamp < existing.earliest_timestamp)
                existing.earliest_timestamp = lr.record.timestamp
            } else {
              byKey.set(key, {
                creator_key: key,
                count: 1,
                latest_timestamp: lr.record.timestamp,
                earliest_timestamp: lr.record.timestamp,
              })
            }
          }
          const minRecords = Math.max(1, args.min_records ?? 1)
          const stats = [...byKey.values()]
            .filter((s) => s.count >= minRecords)
            .sort((a, b) => b.count - a.count)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    total_signers: stats.length,
                    total_records: loaded.length,
                    signers: stats,
                  },
                  null,
                  2,
                ),
              },
            ],
          }
        },
        extractRecordHashFieldsFromMcpResult,
      ),
  )
}

export function createAtribRecallServer(): AtribRecallServer {
  const mcp = new McpServer({
    name: 'atrib-recall',
    version: readPackageVersion(),
  })
  registerAtribRecallTools(mcp)
  return { mcp }
}

async function main(): Promise<void> {
  const { mcp } = createAtribRecallServer()
  const transport = new StdioServerTransport()
  await mcp.connect(transport)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
