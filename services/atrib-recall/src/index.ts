#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/recall - recall_my_attribution_history MCP server.
 *
 * Exposes a single tool to the host agent: recall_my_attribution_history.
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
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_REVISION_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

// Short-form event_type names accepted by the recall MCP schema map onto
// their atrib-normative URI form (spec §1.2.4). Records sign the URI form
// per §1.4.5 + isValidEventTypeUri; without this mapping, a recall caller
// passing `event_type: 'tool_call'` would silently get zero results because
// the raw equality compare against `r.event_type` would never match the URI.
const EVENT_TYPE_SHORT_TO_URI: Record<string, string> = {
  tool_call: EVENT_TYPE_TOOL_CALL_URI,
  transaction: EVENT_TYPE_TRANSACTION_URI,
  annotation: EVENT_TYPE_ANNOTATION_URI,
  revision: EVENT_TYPE_REVISION_URI,
}

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
// "Generative Agents" defaults; tunable via env for experiment-time
// per-axis sensitivity studies. Values must sum to 1.0; the implementation
// does not enforce this but the operator-facing default does. Exported so
// future releases implementing the parkScore function can import them.
export const ATRIB_RECALL_ALPHA = parseFloat(process.env.ATRIB_RECALL_ALPHA ?? '0.3')
export const ATRIB_RECALL_BETA = parseFloat(process.env.ATRIB_RECALL_BETA ?? '0.3')
export const ATRIB_RECALL_GAMMA = parseFloat(process.env.ATRIB_RECALL_GAMMA ?? '0.4')

// Recency time constant (in days) for the exponential-decay scoring
// component. 7-day default per design; longer windows favor older records,
// shorter windows favor very-recent records. Tunable per experiment.
export const ATRIB_RECALL_TAU_DAYS = parseFloat(process.env.ATRIB_RECALL_TAU_DAYS ?? '7')
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  aggregateAnnotationsByRecord,
  aggregateRevisionsByRecord,
  discoverLoaded,
} from './aggregations.js'
import type { AnnotationSummary as AggAnnotationSummary, LoadedRecord } from './aggregations.js'
import {
  recencyScore,
  importanceScore,
  parkScore,
  buildBM25Index,
  bm25Score,
  tokenize,
  indexableTextFromAnnotation,
} from './scoring.js'
import {
  buildLocalGraph,
  shortestDistances,
  walkFrom,
} from './graph.js'
import type { EdgeType } from './graph.js'

const ATRIB_RECORD_FILE = process.env.ATRIB_RECORD_FILE
const ATRIB_MIRROR_DIR = process.env.ATRIB_MIRROR_DIR ?? join(
  homedir(),
  '.atrib',
  'records',
)
const ATRIB_LOG_ORIGIN = process.env.ATRIB_LOG_ORIGIN ?? 'log.atrib.dev'

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
  const candidate = (typeof obj.record === 'object' && obj.record !== null)
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
  let entries: string[] = []
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

interface RecallArgs {
  context_id?: string
  event_type?: 'tool_call' | 'transaction' | 'annotation' | 'revision'
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
}

/**
 * TOC entry: the smallest cheap-to-scan shape (~40-80 tokens). Used at
 * SessionStart auto-inject to surface a candidate set the agent can
 * expand on demand via recall(content_id=...) or recall_walk. Exported
 * for future releases that wire `toc=true` through the recall handler.
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
  records: RecallRecordFull[] | RecallRecordCompact[]
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
): void {
  const now = Date.now()
  // Treat rank_anchor as a free-form query unless it parses as a record_hash
  // (sha256:<64-hex>). Future: when rank_by='causal_distance' wires up,
  // record_hash anchors go to the BFS path; here, record_hash anchors
  // contribute 0 relevance (recency + importance only).
  const looksLikeRecordHash =
    typeof rankAnchor === 'string' && /^sha256:[0-9a-f]{64}$/.test(rankAnchor)
  const queryTokens =
    rankAnchor && !looksLikeRecordHash ? tokenize(rankAnchor) : []

  // Build the BM25 index over the filtered set's indexable text. Index
  // construction is O(total token count); for Layer 1 corpus sizes this
  // is negligible (a few hundred records × tens of tokens each).
  const corpus = filtered.map((lr) => ({
    id: lr.record_hash,
    tokens: indexableTextFromAnnotation(annotationsByRecord.get(lr.record_hash)),
  }))
  const idx = buildBM25Index(corpus)

  const scores = new Map<string, number>()
  for (const lr of filtered) {
    const r = recencyScore(lr.record.timestamp, now, ATRIB_RECALL_TAU_DAYS)
    const i = importanceScore(annotationsByRecord.get(lr.record_hash))
    const rel = queryTokens.length > 0
      ? bm25Score(idx, lr.record_hash, queryTokens)
      : 0
    scores.set(
      lr.record_hash,
      parkScore(r, i, rel, ATRIB_RECALL_ALPHA, ATRIB_RECALL_BETA, ATRIB_RECALL_GAMMA),
    )
  }
  filtered.sort((a, b) => {
    const sa = scores.get(a.record_hash) ?? 0
    const sb = scores.get(b.record_hash) ?? 0
    if (sb !== sa) return sb - sa
    // Stable tie-break on timestamp newest-first.
    return b.record.timestamp - a.record.timestamp
  })
}

/**
 * Sort `filtered` in-place by BFS shortest-path distance from rank_anchor.
 * The graph is built from the FULL `all` set (not just filtered) so the
 * BFS can traverse through records that the post-filter pipeline would
 * later drop — the agent's question is "what's causally near this
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

async function annotateVerification(
  loaded: { record: AtribRecord; record_hash: string }[],
  annotationsByRecord: Map<string, AnnotationSummary>,
  revisionsByRecord: Map<string, string[]>,
): Promise<RecallRecordFull[]> {
  return Promise.all(
    loaded.map(async (lr) => {
      let ok = false
      try {
        ok = await verifyRecord(lr.record)
      } catch {
        ok = false
      }
      const out: RecallRecordFull = { ...lr.record, signature_verified: ok }
      const ann = annotationsByRecord.get(lr.record_hash)
      if (ann) out.annotations = ann
      const supers = revisionsByRecord.get(lr.record_hash)
      if (supers && supers.length > 0) out.superseded_by = supers
      return out
    }),
  )
}

function compactify(records: RecallRecordFull[]): RecallRecordCompact[] {
  return records.map((r) => {
    const out: RecallRecordCompact = {
      event_type: r.event_type,
      context_id: r.context_id,
      creator_key: r.creator_key,
      timestamp: r.timestamp,
      signature_verified: r.signature_verified,
    }
    if (r.session_token) out.session_token = r.session_token
    if (r.tool_name) out.tool_name = r.tool_name
    if (r.annotations) out.annotations = r.annotations
    if (r.superseded_by) out.superseded_by = r.superseded_by
    return out
  })
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
export function discoverRecords(
  recordFile?: string,
): { records: AtribRecord[]; files: string[] } {
  const explicit = recordFile ?? ATRIB_RECORD_FILE
  if (explicit) {
    return { records: loadRecords(explicit), files: [explicit] }
  }
  return loadRecordsFromDir(ATRIB_MIRROR_DIR)
}

export async function recall(
  args: RecallArgs,
  recordFile?: string,
): Promise<RecallResult> {
  // Defaults: compact=true (small responses) and include_unverified=false
  // (no tampered records). The verbose+include-tampered combo is opt-in.
  // Rationale: a poorly-written agent that doesn't check signature_verified
  // would otherwise treat tampered records as provable. Default to safe.
  const compact = args.compact !== false
  const includeUnverified = args.include_unverified === true

  const { loaded: all, files } = discoverLoaded(recordFile)
  const annotationsByRecord = aggregateAnnotationsByRecord(all)
  const revisionsByRecord = aggregateRevisionsByRecord(all)

  let filtered = all
  if (args.context_id) filtered = filtered.filter((lr) => lr.record.context_id === args.context_id)
  if (args.event_type) {
    // Schema accepts short form ('tool_call'|'transaction'); records carry
    // the URI form. Normalize before comparison; pass URIs through as-is so
    // a forward-compatible caller passing the URI directly still matches.
    const targetUri = EVENT_TYPE_SHORT_TO_URI[args.event_type] ?? args.event_type
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
  if (args.rank_by === 'relevance') {
    rankByRelevance(filtered, annotationsByRecord, args.rank_anchor)
  } else if (args.rank_by === 'causal_distance') {
    rankByCausalDistance(filtered, all, args.rank_anchor)
  } else {
    // Newest first - the agent typically wants its most-recent provable
    // actions, not the genesis of the log.
    filtered.sort((a, b) => b.record.timestamp - a.record.timestamp)
  }

  const offset = Math.max(0, args.offset ?? 0)
  const limit = Math.max(1, Math.min(200, args.limit ?? 25))
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

  const records = compact ? compactify(verified) : verified

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

const server = new McpServer({
  name: 'atrib-recall',
  // Keep in sync with package.json. The Layer 1 stub scaffolding ships
  // under the 0.4.0 surface (additive optional schema params + 4 stub
  // tools that return "Layer 1 in progress" notice); the version bump
  // happens via the queued changeset on next publication run.
  version: '0.4.0',
})

// The recall semantic surface (as defined in the public protocol specification).
// Five distinct MCP tools; only `recall_my_attribution_history` is the
// existing 0.4.0 tool with backward-compatible additive optional params.
// The four new tools below are STUBBED in the current ship: they register
// with full schemas so callers see the surface, but their handlers
// return a "Layer 1 in progress" message until future releases land
// the underlying annotation aggregation, BFS, and BM25 fallback. This
// staging keeps the current single-tool flow working while the design
// surface is published for downstream wiring.
const LAYER_1_IN_PROGRESS_MESSAGE = (toolName: string) =>
  JSON.stringify(
    {
      status: 'layer-1-in-progress',
      tool: toolName,
      message:
        'This tool is registered as part of Layer 1 of the recall semantic surface. The schema is stable; the handler implementation lands in upcoming releases. Until then, this tool returns this notice. Use `recall_my_attribution_history` for now; that tool retains full functionality and is gaining additive Layer 1 filters (min_importance, topic_tags, include_revised, min_signers, rank_by, rank_anchor, toc) on the same release cadence.',
      design_reference:
        'the recall semantic surface as specified in the public ATRIB protocol documentation',
    },
    null,
    2,
  )

server.registerTool(
  'recall_my_attribution_history',
  {
    description:
      "Return signed atrib records from the local mirror. The agent's own past, with each record's " +
      'Ed25519 signature verified locally. By default the response is compact (no signature bytes) and ' +
      'includes only records that passed signature verification; both can be opted out of with ' +
      'compact=false and include_unverified=true respectively. Local signature verification proves ' +
      '"this record was signed by that creator_key"; it does NOT prove log inclusion (fetch a log ' +
      'inclusion proof to confirm). Filter by context_id (specific trace), event_type ' +
      '(tool_call|transaction), content_id (specific tool on specific server), tool_name (disclosed ' +
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
      event_type: z
        .enum(['tool_call', 'transaction'])
        .optional()
        .describe('Optional filter to a single event kind. Most calls leave this unset.'),
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
      limit: z.number().optional().describe('Page size, default 25, max 200.'),
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
      // ─── New schema params: accepted now; enforcement in flight. Each ───
      //    of the seven params below is currently STUB-ACCEPTED: the schema
      //    validates the value and the handler ignores it (returns the same
      //    results it would return without the param). The response payload
      //    includes a layer_1_warnings array listing which stub-accepted
      //    params were silently ignored, so callers can detect the pre-impl
      //    state without having to read source. Full enforcement implementation
      //    lands in upcoming releases.
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
          'Stub-accepted (current ship): schema validates; handler returns the standard compact response ' +
            'shape. Future release returns the table-of-contents entry shape (record_hash, tool_name, ' +
            'summary, importance, topic_tags, timestamp, superseded_by) at ~40-80 tokens per entry, ' +
            'designed for SessionStart auto-injected scaffold.',
        ),
    },
  },
  async (args) => {
    // Layer 1 stub-acceptance: detect newly-accepted Layer 1 params, run the
    // existing 0.4.0 recall path (which ignores them), and return the
    // result with a layer_1_warnings array listing exactly which stub-
    // accepted params were silently ignored. Callers can detect the
    // pre-implementation state without having to read source.
    // Stub-accepted params: schema validates; handler doesn't fully enforce.
    // Each entry here will be removed when the underlying behavior ships.
    // rank_by='relevance' is enforced (Park et al. weighted sum over
    // recency + annotation-derived importance + BM25 over annotation
    // summary+topics). rank_by='causal_distance' is also enforced (BFS
    // shortest path over Layer 1's derived graph). toc still needs the
    // compact response shape.
    const a = args as RecallArgs & Record<string, unknown>
    const ignored: string[] = []
    if (a.toc !== undefined) ignored.push('toc')
    const result = await recall(args as RecallArgs)
    const augmented = ignored.length > 0
      ? {
          ...result,
          layer_1_warnings: ignored.map((k) => ({
            param: k,
            status: 'stub-accepted',
            note: `Layer 1 param '${k}' was supplied; handler ignored it (full enforcement lands in upcoming release). Result reflects 0.4.0 behavior as if the param was not set.`,
          })),
        }
      : result
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(augmented, null, 2),
        },
      ],
    }
  },
)

// ─── Layer 1 stub tools (current ship; full impl lands in upcoming releases) ───
//
// All four tools below register with full schemas so callers can wire against
// the surface NOW. Their handlers return LAYER_1_IN_PROGRESS_MESSAGE until
// future releases land the underlying annotation aggregation, BFS, and
// BM25 fallback logic. The schemas are stable; the handlers are stubs.

server.registerTool(
  'recall_walk',
  {
    description:
      "Walk the local derived graph from a starting record_hash. Returns records reachable via the requested edge types up to the given hop depth, ordered by ascending weighted distance. Layer 1 covers four edge types: CHAIN_PRECEDES (weight 1), INFORMED_BY (weight 1), ANNOTATES (weight 2), REVISES (weight 2). SESSION_PRECEDES, SESSION_PARALLEL, CONVERGES_ON, CROSS_SESSION, and PROVENANCE_OF are deferred to subsequent releases. Useful for tracing the local causal neighborhood of a record before re-attempting a similar action.",
    inputSchema: {
      from_record_hash: z
        .string()
        .describe(
          "Starting record hash (sha256:<64-hex>). The walk begins here and expands through the local derived graph.",
        ),
      edge_types: z
        .array(z.enum(['CHAIN_PRECEDES', 'INFORMED_BY', 'ANNOTATES', 'REVISES']))
        .optional()
        .describe(
          "Optional list of Layer 1 edge types to follow. Default: all four. Unknown values are rejected by the schema.",
        ),
      depth: z
        .number()
        .optional()
        .describe(
          "Maximum hop count (NOT cumulative weight). Default 3. Higher values may return many records; paginate downstream if needed.",
        ),
    },
  },
  async (args) => {
    const { loaded } = discoverLoaded()
    const graph = buildLocalGraph(loaded)
    const edgeTypes = args.edge_types
      ? new Set(args.edge_types as EdgeType[])
      : undefined
    const depth = typeof args.depth === 'number' ? args.depth : 3
    const walk = walkFrom(graph, args.from_record_hash, edgeTypes, depth)
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
              count: walk.length,
              walk,
            },
            null,
            2,
          ),
        },
      ],
    }
  },
)

server.registerTool(
  'recall_annotations',
  {
    description:
      "Return the aggregated annotation summary for a record: maximum annotation importance across all D058 annotation records pointing at it, the union of their topic_tags, and the most recent summary string. Useful for surfacing the agent's prior critique on a record before re-attempting a similar action. Returns null annotations field when no annotation points at the record.",
    inputSchema: {
      record_hash: z
        .string()
        .describe(
          "Record hash (sha256:<64-hex>) of the record whose annotations should be retrieved. Annotations are D058 records whose content.annotates field equals this hash.",
        ),
    },
  },
  async (args) => {
    const { loaded } = discoverLoaded()
    const annotationsByRecord = aggregateAnnotationsByRecord(loaded)
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
)

server.registerTool(
  'recall_revisions',
  {
    description:
      "Return the D059 revision chain for a record. Walks revises edges forward from the given record_hash, surfacing each revision in turn. The chain is the linked list of revisions where each revision's revises field points at the prior entry. Useful for checking whether a position the agent previously held has been revised before acting on it. Returns an empty chain when no revision points at the record.",
    inputSchema: {
      record_hash: z
        .string()
        .describe(
          "Record hash (sha256:<64-hex>) of the record whose revision chain should be retrieved. Revisions are D059 records whose content.revises field equals this hash (or chain back to it).",
        ),
    },
  },
  async (args) => {
    const { loaded } = discoverLoaded()
    const revisionsByRecord = aggregateRevisionsByRecord(loaded)
    // Walk the chain forward: the input record may be revised by R1;
    // R1 may be revised by R2; collect them in order. Bounded by the
    // mirror size (no cycles since timestamps are monotonic per
    // signer; defensive seen-set anyway).
    const chain: string[] = []
    const seen = new Set<string>()
    let current = args.record_hash
    while (!seen.has(current)) {
      seen.add(current)
      const next = revisionsByRecord.get(current)
      if (!next || next.length === 0) break
      // Each entry in the map's value array is a revision pointing at
      // `current`. Convention: the chain follows the first-by-timestamp
      // revision; agents wanting the full sibling fan-out (parallel
      // revisions at the same target) should call recall_my_attribution_history
      // with event_type=revision and inspect their revises field manually.
      const revHash = next[0]!
      chain.push(revHash)
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
)

// recall_walk + recall_by_content remain stubs (need BFS over §3.2.4 derived
// graph and BM25 over summary+topics respectively).
server.registerTool(
  'recall_by_content',
  {
    description:
      "Free-form text search over the agent's signed past. Returns top-k records by hybrid retrieval (BM25 over summary+topics in Layer 1; sqlite-vec embedding similarity in Layer 2 once shipped), reranked by Layer 1's annotation-derived importance and recency signals. Useful when the agent has no specific filter and needs to ask 'what do I know about X?'. Initial schema registration; full implementation will be delivered in a future release.",
    inputSchema: {
      query: z
        .string()
        .describe(
          "Free-form text query. Layer 1 matches against record summaries and topic tags via BM25; Layer 2 (sqlite-vec sidecar, separate ship) adds embedding similarity over the same indexed text.",
        ),
      k: z
        .number()
        .optional()
        .describe("Top-k results to return (default 10). Final ordering uses Park et al. weighted-sum scoring with annotation-derived importance."),
    },
  },
  async () => ({
    content: [{ type: 'text', text: LAYER_1_IN_PROGRESS_MESSAGE('recall_by_content') }],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
