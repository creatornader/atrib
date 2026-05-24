#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Diagnose: which records in the local mirror have empty indexable
// tokens under D086, and why? Helps the operator understand what's in
// the "non-indexable" residual.

import { discoverLoaded, aggregateAnnotationsByRecord } from '../dist/aggregations.js'
import { indexableTokensForRecord } from '../dist/scoring.js'

const { loaded } = discoverLoaded()
const ann = aggregateAnnotationsByRecord(loaded)
console.log(`Loaded ${loaded.length} records.`)

const buckets = new Map()
const samples = new Map()

for (const lr of loaded) {
  const tokens = indexableTokensForRecord(lr, ann.get(lr.record_hash))
  if (tokens.length > 0) continue
  const eventType = lr.record.event_type
  const tail = eventType.split('/').pop() || eventType
  const hasContent = lr.content !== undefined && lr.content !== null
  const isExtension = !eventType.startsWith('https://atrib.dev/v1/types/')
  const key = `${tail} (${hasContent ? 'with-content' : 'NO content'}${isExtension ? ', extension' : ''})`
  buckets.set(key, (buckets.get(key) ?? 0) + 1)
  if (!samples.has(key)) {
    samples.set(key, {
      event_type: eventType,
      has_content: hasContent,
      content_keys: hasContent && typeof lr.content === 'object' && lr.content !== null
        ? Object.keys(lr.content)
        : null,
      content_preview: hasContent ? JSON.stringify(lr.content).slice(0, 200) : null,
      tool_name: lr.record.tool_name,
    })
  }
}

const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])
console.log(`\nNon-indexable records by bucket (total ${sorted.reduce((s, [, n]) => s + n, 0)}):`)
for (const [k, n] of sorted) {
  console.log(`  ${String(n).padStart(5)}  ${k}`)
}

console.log(`\nSample per bucket:`)
for (const [k, s] of samples) {
  console.log(`\n  bucket: ${k}`)
  console.log(`    event_type: ${s.event_type}`)
  console.log(`    has_content: ${s.has_content}`)
  if (s.tool_name) console.log(`    tool_name: ${s.tool_name}`)
  if (s.content_keys) console.log(`    content keys: ${s.content_keys.join(', ')}`)
  if (s.content_preview) console.log(`    content preview: ${s.content_preview}`)
}
