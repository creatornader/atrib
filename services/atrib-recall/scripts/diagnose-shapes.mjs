#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// For each non-indexable observation/revision, what content field names
// is the producer using? Tells us what shape vocabulary the producer
// is emitting (canonical vs. drift).

import { discoverLoaded, aggregateAnnotationsByRecord } from '../dist/aggregations.js'
import { indexableTokensForRecord } from '../dist/scoring.js'

const { loaded } = discoverLoaded()
const ann = aggregateAnnotationsByRecord(loaded)

const buckets = new Map() // event_type → producer → field-key-pattern → count

for (const lr of loaded) {
  const tokens = indexableTokensForRecord(lr, ann.get(lr.record_hash))
  if (tokens.length > 0) continue
  const eventType = lr.record.event_type.split('/').pop() || lr.record.event_type
  const c = lr.content
  const innerProducer = (c && typeof c === 'object' && !Array.isArray(c)) ? c.producer ?? null : null
  const producer = innerProducer ?? lr.producer ?? '(bare)'
  const keys = (c && typeof c === 'object' && !Array.isArray(c))
    ? Object.keys(c).filter((k) => k !== 'producer').sort().join(',')
    : '(no content)'
  if (!buckets.has(eventType)) buckets.set(eventType, new Map())
  const byProducer = buckets.get(eventType)
  if (!byProducer.has(producer)) byProducer.set(producer, new Map())
  const byKeys = byProducer.get(producer)
  byKeys.set(keys, (byKeys.get(keys) ?? 0) + 1)
}

for (const [eventType, byProducer] of buckets) {
  console.log(`\n=== ${eventType} ===`)
  const flat = []
  for (const [producer, byKeys] of byProducer) {
    for (const [keys, n] of byKeys) {
      flat.push({ producer, keys, n })
    }
  }
  flat.sort((a, b) => b.n - a.n)
  for (const { producer, keys, n } of flat.slice(0, 10)) {
    console.log(`  ${String(n).padStart(5)}  producer=${producer}`)
    console.log(`         content keys: ${keys}`)
  }
}
