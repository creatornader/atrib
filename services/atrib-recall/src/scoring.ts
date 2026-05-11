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
import type { AnnotationSummary } from './aggregations.js'

/**
 * Exponential-decay recency score. timestamp is milliseconds; tau is in
 * days. Returns a value in (0, 1]; 1 when ts == now, decays toward 0 as
 * age increases. Half-life is ln(2) * tau ≈ 0.693 * tau days.
 */
export function recencyScore(
  recordTimestampMs: number,
  nowMs: number,
  tauDays: number,
): number {
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
export function buildBM25Index(
  corpus: BM25Doc[],
  k1 = 1.5,
  b = 0.75,
): BM25Index {
  const docs = new Map<string, { length: number; tf: Map<string, number> }>()
  const df = new Map<string, number>()
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
  return { docs, idf, avgdl, k1, b }
}

/**
 * Compute the BM25 score of one document against a query. The document
 * is identified by id; the index supplies its tf, length, and idf
 * lookups. Returns 0 for docs not in the index (rather than throwing)
 * since the recall flow may filter the corpus after indexing.
 */
export function bm25Score(
  index: BM25Index,
  docId: string,
  queryTokens: string[],
): number {
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
    const denominator =
      tf + index.k1 * (1 - index.b + index.b * (doc.length / index.avgdl))
    score += idf * (numerator / denominator)
  }
  return score
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
 * Build the indexed-text view of a record for BM25: concatenation of the
 * record's annotation summary (when present) and topic_tags (when
 * present). Records with no annotation produce an empty token list. The
 * indexed text is deliberately short, Layer 1 BM25 is meant as a
 * lightweight fallback, not a full-text-search engine.
 */
export function indexableTextFromAnnotation(
  summary: AnnotationSummary | undefined,
): string[] {
  if (!summary) return []
  const parts: string[] = []
  if (summary.summary) parts.push(summary.summary)
  if (summary.topics) parts.push(...summary.topics)
  return tokenize(parts.join(' '))
}

/**
 * Convenience type re-export so callers can import the canonical
 * ImportanceLabel shape without reaching into index.ts directly.
 */
export type { ImportanceLabel }
