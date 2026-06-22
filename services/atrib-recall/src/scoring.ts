// SPDX-License-Identifier: Apache-2.0

/**
 * Park et al. 2023 ("Generative Agents") retrieval scoring for the recall
 * semantic surface. Weighted sum of three signals:
 *
 *   parkScore = alpha * recencyScore + beta * importanceScore + gamma * relevanceScore
 *
 * - recencyScore: exponential decay in time-since-record. Newer records score
 *   higher. Tunable via ATRIB_RECALL_TAU_DAYS (default 7 days).
 * - importanceScore: derived from annotation-derived max_importance (D058).
 *   Normalized to [0, 1] over the five-level IMPORTANCE_NUMERIC scale.
 *   Records with no annotation pointing at them score 0.
 * - relevanceScore: BM25 over (summary ∪ topics) when a query is supplied.
 *   When no query is supplied, this component is 0. Layer 2 (sqlite-vec
 *   sidecar, separate ship) extends with embedding similarity.
 *
 * Alpha/beta/gamma weights are imported from index.ts (env-tunable for
 * per-axis sensitivity studies). The implementation does not enforce that
 * weights sum to 1.0; the operator-facing default does.
 *
 * Spec references:
 *   - D058: annotation event_type byte 0x05, supplies importance signal
 *   - §3.6: fact/policy separation (this is a recall-side policy, not a
 *     graph-side fact, the graph does not weight by importance)
 *   - Park et al. 2023, "Generative Agents: Interactive Simulacra of Human
 *     Behavior", original recency × importance × relevance retrieval design
 */

import type { ImportanceLabel } from './index.js'
import { IMPORTANCE_NUMERIC } from './index.js'
import type { AnnotationSummary, LoadedRecord } from './aggregations.js'
import { EVENT_TYPE_TOOL_CALL_URI, extractIndexableText } from '@atrib/mcp'

/**
 * Exponential-decay recency score. timestamp is milliseconds; tau is in
 * days. Returns a value in (0, 1]; 1 when ts == now, decays toward 0 as
 * age increases. Half-life is ln(2) * tau ≈ 0.693 * tau days.
 */
export function recencyScore(recordTimestampMs: number, nowMs: number, tauDays: number): number {
  if (tauDays <= 0) return 1
  const ageDays = Math.max(0, (nowMs - recordTimestampMs) / 86400000)
  return Math.exp(-ageDays / tauDays)
}

/**
 * Importance score normalized to [0, 1]. Records with no annotation
 * (summary undefined or max_importance undefined) score 0. Records with
 * an annotation score (importance_numeric - 1) / 4, so noise=0,
 * low=0.25, medium=0.5, high=0.75, critical=1.0.
 */
export function importanceScore(summary: AnnotationSummary | undefined): number {
  if (!summary || !summary.max_importance) return 0
  const numeric = IMPORTANCE_NUMERIC[summary.max_importance]
  return (numeric - 1) / 4
}

/**
 * Tokenize for BM25. Lowercase, ASCII-only word characters split, drop
 * empties. Deliberately simple, not stemmed, not stop-worded. The
 * indexed text (summary + topics) is typically short and the cost of
 * heuristic preprocessing exceeds the benefit at Layer 1 scale.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

const LIFECYCLE_COMPACTION_PRODUCER = 'claude-hooks-lifecycle-precompact'
const LIFECYCLE_SESSIONEND_PRODUCER = 'claude-hooks-lifecycle-sessionend'
const LIFECYCLE_QUERY_TOKENS = new Set([
  'compact',
  'compaction',
  'lifecycle',
  'precompact',
  'sessionend',
])
const LIFECYCLE_EVENTS = new Set(['precompact', 'sessionend'])
const LIFECYCLE_HOOK_EVENTS = new Set(['PreCompact', 'SessionEnd'])
const RAW_TOOL_CALL_SCORE_FACTOR = 0.15

/**
 * Lifecycle records are session anchors, not decision memories.
 * Keep them searchable for explicit lifecycle debugging, but do not let
 * their high importance and query-rich topics dominate normal content recall.
 */
export function shouldSuppressLifecycleAnchorForQuery(
  loaded: LoadedRecord,
  annotation: AnnotationSummary | undefined,
  queryTokens: string[],
): boolean {
  if (queryMentionsLifecycle(queryTokens)) return false
  return hasLifecycleSignal(loaded, annotation)
}

export function queryMentionsLifecycle(queryTokens: string[]): boolean {
  return queryTokens.some((token) => LIFECYCLE_QUERY_TOKENS.has(token))
}

function hasLifecycleSignal(
  loaded: LoadedRecord,
  annotation: AnnotationSummary | undefined,
): boolean {
  if (loaded.producer === LIFECYCLE_COMPACTION_PRODUCER) return true
  if (loaded.producer === LIFECYCLE_SESSIONEND_PRODUCER) return true
  if (summaryLooksLikeLifecycleAnchor(annotation?.summary)) return true

  const content = objectFromUnknown(loaded.content)
  if (!content) return false

  const triggerEnvelope = objectFromUnknown(content.trigger_envelope)
  const producer = stringField(content, 'producer')
  const lifecycleEvent = stringField(content, 'lifecycle_event')
  const hookEventName = stringField(triggerEnvelope, 'hook_event_name')
  return (
    producer === LIFECYCLE_COMPACTION_PRODUCER ||
    producer === LIFECYCLE_SESSIONEND_PRODUCER ||
    (lifecycleEvent !== undefined && LIFECYCLE_EVENTS.has(lifecycleEvent)) ||
    (hookEventName !== undefined && LIFECYCLE_HOOK_EVENTS.has(hookEventName)) ||
    summaryLooksLikeLifecycleAnchor(stringField(content, 'summary'))
  )
}

function summaryLooksLikeLifecycleAnchor(summary: string | undefined): boolean {
  if (typeof summary !== 'string') return false
  const normalized = summary.toLowerCase()
  return (
    normalized.startsWith('session compaction at ') || normalized.startsWith('session ended at ')
  )
}

function objectFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringField(obj: Record<string, unknown> | undefined, field: string): string | undefined {
  const value = obj?.[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * Raw tool calls are audit evidence. They often repeat the user's query in
 * args, so a recent recall/search/edit wrapper can look like the best answer
 * to "what do I know about X?" Keep annotated calls at full weight because
 * curation turns the call into semantic memory.
 */
export function operationalToolCallScoreFactor(
  loaded: LoadedRecord,
  annotation: AnnotationSummary | undefined,
): number {
  if (loaded.record.event_type !== EVENT_TYPE_TOOL_CALL_URI) return 1
  if (hasSemanticAnnotation(annotation)) return 1
  return RAW_TOOL_CALL_SCORE_FACTOR
}

function hasSemanticAnnotation(annotation: AnnotationSummary | undefined): boolean {
  if (!annotation) return false
  return Boolean(
    annotation.summary ||
    (annotation.topics && annotation.topics.length > 0) ||
    annotation.max_importance,
  )
}

/**
 * Indexed view of one record for BM25 retrieval. `id` is the record_hash
 * (used as opaque key by callers). `tokens` is the bag-of-words.
 */
export type BM25Doc = {
  id: string
  tokens: string[]
}

/**
 * Build the BM25 inverted index over a corpus. The result is a stateless
 * data structure that bm25Score consumes; expensive operations (idf,
 * avgdl, df) are computed once at index time.
 */
export type BM25Index = {
  docs: Map<string, { length: number; tf: Map<string, number> }>
  postings: Map<string, Map<string, number>>
  idf: Map<string, number>
  avgdl: number
  k1: number
  b: number
}

/**
 * Construct a BM25 index. k1 and b are the standard knobs:
 *   - k1 ~ 1.2-2.0 (term-frequency saturation; higher = more weight to
 *     repeated terms). Default 1.5.
 *   - b ~ 0-1 (length normalization; 1 = full, 0 = none). Default 0.75.
 *
 * Returns an index ready for `bm25Score`. Time-complexity is linear in
 * total token count across the corpus.
 */
export function buildBM25Index(corpus: BM25Doc[], k1 = 1.5, b = 0.75): BM25Index {
  const docs = new Map<string, { length: number; tf: Map<string, number> }>()
  const df = new Map<string, number>()
  const postings = new Map<string, Map<string, number>>()
  let totalLength = 0
  for (const d of corpus) {
    const tf = new Map<string, number>()
    for (const tok of d.tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1)
    }
    docs.set(d.id, { length: d.tokens.length, tf })
    totalLength += d.tokens.length
    for (const tok of new Set(d.tokens)) {
      df.set(tok, (df.get(tok) ?? 0) + 1)
    }
    for (const [tok, count] of tf) {
      const posting = postings.get(tok) ?? new Map<string, number>()
      posting.set(d.id, count)
      postings.set(tok, posting)
    }
  }
  const N = corpus.length
  const avgdl = N > 0 ? totalLength / N : 0
  const idf = new Map<string, number>()
  for (const [tok, count] of df) {
    // Standard Robertson-Sparck-Jones idf with the +1 smoothing that
    // prevents negative idf when a term appears in more than half the
    // corpus. Returns ln((N - df + 0.5) / (df + 0.5) + 1).
    idf.set(tok, Math.log((N - count + 0.5) / (count + 0.5) + 1))
  }
  return { docs, postings, idf, avgdl, k1, b }
}

/**
 * Compute the BM25 score of one document against a query. The document
 * is identified by id; the index supplies its tf, length, and idf
 * lookups. Returns 0 for docs not in the index (rather than throwing)
 * since the recall flow may filter the corpus after indexing.
 */
export function bm25Score(index: BM25Index, docId: string, queryTokens: string[]): number {
  const doc = index.docs.get(docId)
  if (!doc) return 0
  if (queryTokens.length === 0) return 0
  if (index.avgdl === 0) return 0
  let score = 0
  for (const qt of queryTokens) {
    const tf = doc.tf.get(qt)
    if (!tf) continue
    const idf = index.idf.get(qt) ?? 0
    const numerator = tf * (index.k1 + 1)
    const denominator = tf + index.k1 * (1 - index.b + index.b * (doc.length / index.avgdl))
    score += idf * (numerator / denominator)
  }
  return score
}

/**
 * Normalize raw BM25 into the bounded Park relevance component. Raw BM25 can
 * saturate from one rare token in a long query, which makes a single overlap
 * look as relevant as a full topic match. Scale the clamped raw score by the
 * share of unique query tokens present in the document.
 */
export function normalizedBm25Relevance(
  index: BM25Index,
  docId: string,
  queryTokens: string[],
  rawScore = bm25Score(index, docId, queryTokens),
): number {
  if (rawScore <= 0) return 0
  const coverage = queryTokenCoverage(index, docId, queryTokens)
  return Math.min(rawScore, 1) * coverage
}

export function queryTokenCoverage(index: BM25Index, docId: string, queryTokens: string[]): number {
  const doc = index.docs.get(docId)
  if (!doc) return 0
  const uniqueQueryTokens = Array.from(new Set(queryTokens))
  if (uniqueQueryTokens.length === 0) return 0
  let matched = 0
  for (const token of uniqueQueryTokens) {
    if (doc.tf.has(token)) matched += 1
  }
  return matched / uniqueQueryTokens.length
}

/**
 * Compute BM25 scores for every document that contains at least one query
 * token. This walks the inverted postings lists for the query terms instead
 * of scanning every document in the corpus, which keeps interactive content
 * search bounded once local mirrors grow past the original few-hundred-record
 * Layer 1 assumption.
 */
export function bm25ScoresForQuery(index: BM25Index, queryTokens: string[]): Map<string, number> {
  const scores = new Map<string, number>()
  if (queryTokens.length === 0 || index.avgdl === 0) return scores
  for (const qt of new Set(queryTokens)) {
    const posting = index.postings.get(qt)
    if (!posting) continue
    const idf = index.idf.get(qt) ?? 0
    for (const [docId, tf] of posting) {
      const doc = index.docs.get(docId)
      if (!doc) continue
      const numerator = tf * (index.k1 + 1)
      const denominator = tf + index.k1 * (1 - index.b + index.b * (doc.length / index.avgdl))
      scores.set(docId, (scores.get(docId) ?? 0) + idf * (numerator / denominator))
    }
  }
  return scores
}

/**
 * Park et al. weighted-sum score. Caller supplies the three component
 * scores plus the alpha/beta/gamma weights; this function just combines.
 * Kept as a separate function (rather than inlining the multiplication
 * in the recall path) so test harnesses can exercise the combination
 * logic without setting up a full mirror.
 */
export function parkScore(
  recency: number,
  importance: number,
  relevance: number,
  alpha: number,
  beta: number,
  gamma: number,
): number {
  return alpha * recency + beta * importance + gamma * relevance
}

/**
 * Build BM25 tokens from an aggregated annotation (summary + topics).
 * Kept for callers that only have annotation data and need the legacy
 * shape. The current BM25 build path (`indexableTokensForRecord`) calls
 * this internally as the annotation-augment step on top of the per-event_
 * type record content extracted via `@atrib/mcp` `extractIndexableText`.
 *
 * Records with no annotation produce an empty token list. This helper
 * deliberately does NOT touch record content; for the full corpus shape
 * use `indexableTokensForRecord`.
 */
export function indexableTextFromAnnotation(summary: AnnotationSummary | undefined): string[] {
  if (!summary) return []
  const parts: string[] = []
  if (summary.summary) parts.push(summary.summary)
  if (summary.topics) parts.push(...summary.topics)
  return tokenize(parts.join(' '))
}

/**
 * Build BM25 tokens for one loaded record. Per D086, the indexable
 * corpus combines two sources:
 *
 *   1. Per-event_type record content from the D062 sidecar, extracted
 *      via @atrib/mcp `extractIndexableText` against the record's
 *      `event_type` URI. For observation: what + why_noted + intent +
 *      rationale + topics.
 *      For tool_call: tool_name + args excerpt + result excerpt. For
 *      annotation: summary + topics. Etc. See @atrib/mcp/content-shapes
 *      for the per-shape contract.
 *
 *   2. Any annotation summary + topics pointing at this record, when
 *      present. Annotations act as a curation lift on top of raw
 *      content; the same record indexed twice doesn't matter for BM25
 *      term-frequency saturation (k1 controls the lift). Records with
 *      no annotation still produce non-empty tokens from source (1) — the
 *      pre-D086 floor was zero, which left most emits un-searchable.
 *
 * Source (1) tokens are deduplicated against source (2) at the token
 * level by simple union: BM25's tf saturation makes a few extra
 * duplicates harmless.
 */
export function indexableTokensForRecord(
  loaded: LoadedRecord,
  annotation: AnnotationSummary | undefined,
): string[] {
  const contentText = extractIndexableText(loaded.record.event_type, loaded.content)
  const annotationTokens = indexableTextFromAnnotation(annotation)
  if (!contentText) return annotationTokens
  const contentTokens = tokenize(contentText)
  return annotationTokens.length === 0 ? contentTokens : contentTokens.concat(annotationTokens)
}

/**
 * Convenience type re-export so callers can import the canonical
 * ImportanceLabel shape without reaching into index.ts directly.
 */
export type { ImportanceLabel }
