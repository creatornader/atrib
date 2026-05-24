#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// When were the non-indexable records written? Buckets the residual
// by month + by event_type + by producer to find the temporal pattern.

import { discoverLoaded, aggregateAnnotationsByRecord } from '../dist/aggregations.js'
import { indexableTokensForRecord } from '../dist/scoring.js'

const { loaded } = discoverLoaded()
const ann = aggregateAnnotationsByRecord(loaded)
console.log(`Loaded ${loaded.length} records.`)

function bucketByMonth(ts) {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const nonIndexable = []
for (const lr of loaded) {
  const tokens = indexableTokensForRecord(lr, ann.get(lr.record_hash))
  if (tokens.length === 0) {
    nonIndexable.push(lr)
  }
}
console.log(`Non-indexable: ${nonIndexable.length}`)

// By month
const byMonth = new Map()
for (const lr of nonIndexable) {
  const m = bucketByMonth(lr.record.timestamp)
  byMonth.set(m, (byMonth.get(m) ?? 0) + 1)
}
const months = [...byMonth.entries()].sort()
console.log(`\nNon-indexable records by month written:`)
for (const [m, n] of months) {
  console.log(`  ${m}: ${String(n).padStart(5)}`)
}

// By producer (when in content sidecar)
const byProducer = new Map()
for (const lr of nonIndexable) {
  const producer = lr.producer
    ?? (lr.content && typeof lr.content === 'object' && !Array.isArray(lr.content)
        ? lr.content.producer
        : null)
    ?? '(no producer / bare)'
  byProducer.set(producer, (byProducer.get(producer) ?? 0) + 1)
}
console.log(`\nNon-indexable records by producer label:`)
for (const [p, n] of [...byProducer.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${p}`)
}

// Cross-tab: producer × month for top producers
console.log(`\nTop producers × month:`)
const topProducers = [...byProducer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p)
for (const p of topProducers) {
  const monthsForP = new Map()
  for (const lr of nonIndexable) {
    const lp = lr.producer
      ?? (lr.content && typeof lr.content === 'object' && !Array.isArray(lr.content)
          ? lr.content.producer
          : null)
      ?? '(no producer / bare)'
    if (lp !== p) continue
    const m = bucketByMonth(lr.record.timestamp)
    monthsForP.set(m, (monthsForP.get(m) ?? 0) + 1)
  }
  console.log(`\n  ${p}:`)
  for (const [m, n] of [...monthsForP.entries()].sort()) {
    console.log(`    ${m}: ${n}`)
  }
}
