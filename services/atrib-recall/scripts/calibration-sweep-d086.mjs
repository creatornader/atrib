#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// D086 noise-floor empirical calibration sweep.
//
// Loads the operator's local mirror (~/.atrib/records/), builds the BM25
// corpus with the new D086 path (per-event_type record content +
// annotation augment), runs a battery of canned queries against it, and
// prints top_score distributions. Used to pick a defensible
// ATRIB_RECALL_NOISE_FLOOR for the new corpus shape.
//
// Run with: node services/atrib-recall/scripts/calibration-sweep-d086.mjs

import { discoverLoaded, aggregateAnnotationsByRecord } from '../dist/aggregations.js'
import {
  buildBM25Index,
  bm25Score,
  tokenize,
  recencyScore,
  importanceScore,
  parkScore,
  indexableTokensForRecord,
} from '../dist/scoring.js'

const ALPHA = 0.3
const BETA = 0.3
const GAMMA = 0.4
const TAU_DAYS = 7

const { loaded } = discoverLoaded()
const annotationsByRecord = aggregateAnnotationsByRecord(loaded)
console.log(`Loaded ${loaded.length} records from local mirror.`)

const corpus = loaded.map((lr) => ({
  id: lr.record_hash,
  tokens: indexableTokensForRecord(lr, annotationsByRecord.get(lr.record_hash)),
}))

const tokenCounts = corpus.map((d) => d.tokens.length)
const nonEmptyCount = tokenCounts.filter((n) => n > 0).length
const avgTokens = tokenCounts.reduce((a, b) => a + b, 0) / Math.max(corpus.length, 1)
console.log(
  `Corpus shape: ${nonEmptyCount}/${corpus.length} records have non-zero indexable tokens` +
  ` (avg ${avgTokens.toFixed(1)} tokens/doc).`,
)

const idx = buildBM25Index(corpus)

const REAL_QUERIES = [
  'validate email',
  'atrib recall',
  'phase 2 experiment',
  'noise floor calibration',
  'BM25 corpus',
  'tool call',
  'agent memory',
  'NIM API key',
  'Inspect AI react',
  'substrate intelligence',
]

const NONSENSE_QUERIES = [
  'qwxz prgz blix',
  'fjdkslp wernzx',
  'asdf qwer zxcv',
  'mlkj poiu hgfd',
  'qpwoeiruty',
  'flarp zonk wumple',
  'xqxqxq yyyzzzz',
  'random gibberish nonsense',
  'asdjkfhasdjkfhasdjkf',
  'kqkqkqkq rrrr',
]

function scoreCorpus(query) {
  const qt = tokenize(query)
  if (qt.length === 0) return { top_park: 0, top_bm25: 0, n_nonzero: 0 }
  const now = Date.now()
  let topPark = 0
  let topBm25 = 0
  let nNonzero = 0
  for (const lr of loaded) {
    const rawRel = bm25Score(idx, lr.record_hash, qt)
    if (rawRel > 0) nNonzero++
    const rel = Math.min(rawRel, 1)
    const r = recencyScore(lr.record.timestamp, now, TAU_DAYS)
    const i = importanceScore(annotationsByRecord.get(lr.record_hash))
    const p = parkScore(r, i, rel, ALPHA, BETA, GAMMA)
    if (p > topPark) topPark = p
    if (rawRel > topBm25) topBm25 = rawRel
  }
  return { top_park: topPark, top_bm25: topBm25, n_nonzero: nNonzero }
}

function runBucket(label, queries) {
  console.log(`\n=== ${label} ===`)
  console.log(`${'query'.padEnd(35)} ${'top_park'.padStart(10)} ${'top_bm25'.padStart(10)} ${'matches'.padStart(8)}`)
  const topParks = []
  for (const q of queries) {
    const r = scoreCorpus(q)
    topParks.push(r.top_park)
    console.log(
      `${q.padEnd(35)} ${r.top_park.toFixed(4).padStart(10)} ` +
      `${r.top_bm25.toFixed(2).padStart(10)} ${String(r.n_nonzero).padStart(8)}`,
    )
  }
  const min = Math.min(...topParks)
  const max = Math.max(...topParks)
  const avg = topParks.reduce((a, b) => a + b, 0) / topParks.length
  console.log(
    `${'(summary)'.padEnd(35)} min=${min.toFixed(4)} max=${max.toFixed(4)} avg=${avg.toFixed(4)}`,
  )
  return topParks
}

const realScores = runBucket('REAL queries (terms likely to match)', REAL_QUERIES)
const nonsenseScores = runBucket('NONSENSE queries (random gibberish)', NONSENSE_QUERIES)

console.log(`\n=== GAP ANALYSIS ===`)
const realMin = Math.min(...realScores)
const nonsenseMax = Math.max(...nonsenseScores)
console.log(`Real query min top_park:     ${realMin.toFixed(4)}`)
console.log(`Nonsense query max top_park: ${nonsenseMax.toFixed(4)}`)
const gap = realMin - nonsenseMax
console.log(`Gap (real_min - nonsense_max): ${gap.toFixed(4)}`)
if (gap > 0) {
  const suggested = (nonsenseMax + realMin) / 2
  console.log(
    `Suggested noise_floor (midpoint of gap): ${suggested.toFixed(4)}`,
  )
} else {
  console.log(`No clean gap — real and nonsense distributions overlap.`)
}
