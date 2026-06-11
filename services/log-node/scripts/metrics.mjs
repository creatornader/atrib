#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * metrics.mjs, Tier 1 atrib metric snapshot.
 *
 * Reads log.atrib.dev (or any deployed atrib log via LOG_ENDPOINT), computes
 * the Tier 1 metrics defined in METRICS.md, writes a dated JSON snapshot to
 * the metrics/ directory, and prints a human-readable summary. When previous
 * snapshots exist it also computes 7-day deltas.
 *
 * Each metric is defined as a self-contained entry in the METRICS array
 * below: { name, tier, status, run(ctx) }. Adding a new metric is a one-file
 * change, the rest of the pipeline (snapshot writing, history loading,
 * delta computation, summary printing) handles whatever shows up there.
 *
 * Usage:
 *   pnpm --filter @atrib/log-node metrics
 *   LOG_ENDPOINT=https://log.atrib.dev/v1 \
 *   METRICS_DIR=metrics \
 *   node scripts/metrics.mjs
 *
 * Output: metrics/YYYY-MM-DD.json (one per run, overwrites if same date).
 *
 * The evolution process for the metric set itself is documented in
 * METRICS.md ("Metric lifecycle" + "Evolution review process"). Status
 * values on each metric below should track that document.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Track whether this module is being executed as a script or imported by tests.
const IS_MAIN_MODULE = process.argv[1] === fileURLToPath(import.meta.url)

const LOG_ENDPOINT = (process.env.LOG_ENDPOINT ?? 'https://log.atrib.dev/v1').replace(/\/$/, '')

// METRICS_DIR defaults to <repo-root>/metrics so the script behaves the same
// whether invoked from the repo root or via pnpm --filter from log-node.
const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const METRICS_DIR = process.env.METRICS_DIR ?? join(REPO_ROOT, 'metrics')

// ---------------------------------------------------------------------------
// Wire-format helpers (deliberately self-contained; no @atrib/* imports so
// this script can run standalone outside the workspace).
// ---------------------------------------------------------------------------

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

async function fetchText(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return await r.text()
}
async function fetchBytes(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

function parseCheckpointBody(text) {
  const blank = text.indexOf('\n\n')
  if (blank < 0) throw new Error('checkpoint has no body/sig separator')
  const lines = text.slice(0, blank + 1).split('\n')
  return {
    origin: lines[0],
    treeSize: Number(lines[1]),
    rootHashB64: lines[2],
  }
}

function parseEntryBundle(bytes) {
  const out = []
  let off = 0
  while (off < bytes.length) {
    const len = (bytes[off] << 8) | bytes[off + 1]
    off += 2
    out.push(bytes.slice(off, off + len))
    off += len
  }
  return out
}

// §2.3.1: 90-byte log entry.
function parseEntry(b) {
  return {
    version: b[0],
    recordHash: b.slice(1, 33),
    creatorKey: b.slice(33, 65),
    contextId: b.slice(65, 81),
    ts: Number(new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(81, false)),
    eventType: b[89],
  }
}

async function fetchAllEntries(treeSize) {
  const entries = []
  let bundleIdx = 0
  while (entries.length < treeSize) {
    const url = `${LOG_ENDPOINT}/tile/entries/${String(bundleIdx).padStart(3, '0')}`
    const bytes = await fetchBytes(url)
    for (const e of parseEntryBundle(bytes)) entries.push(parseEntry(e))
    bundleIdx++
    if (bundleIdx > 10_000) throw new Error('runaway bundle fetch')
  }
  return entries.slice(0, treeSize)
}

// ---------------------------------------------------------------------------
// Metric definitions. Each metric is run against `ctx` and returns a JSON-
// serializable value. Status values are tracked here AND in METRICS.md.
// ---------------------------------------------------------------------------

const METRICS = [
  {
    name: 'tree_size',
    tier: 1,
    status: 'decision-tied',
    decisionSupported: 'is the substrate in use at all',
    run: (ctx) => ctx.treeSize,
  },
  {
    name: 'distinct_creator_keys',
    tier: 1,
    status: 'decision-tied',
    decisionSupported: 'how many signer keys have ever written to the public log',
    run: (ctx) => new Set(ctx.entries.map((e) => toHex(e.creatorKey))).size,
  },
  {
    name: 'active_creator_keys_24h',
    tier: 1,
    status: 'decision-tied',
    decisionSupported: 'how many signer keys wrote to the public log in the last 24h',
    run: (ctx) => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000
      return new Set(
        ctx.entries.filter((e) => e.ts >= cutoff).map((e) => toHex(e.creatorKey)),
      ).size
    },
  },
  {
    name: 'active_creator_keys_7d',
    tier: 1,
    status: 'decision-tied',
    decisionSupported: 'how many signer keys wrote to the public log in the last 7d',
    run: (ctx) => {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      return new Set(
        ctx.entries.filter((e) => e.ts >= cutoff).map((e) => toHex(e.creatorKey)),
      ).size
    },
  },
  {
    name: 'distinct_context_ids',
    tier: 1,
    status: 'tracked',
    decisionSupported: 'how many distinct sessions/traces use the log',
    run: (ctx) => new Set(ctx.entries.map((e) => toHex(e.contextId))).size,
  },
  {
    name: 'chain_depth',
    tier: 1,
    status: 'decision-tied',
    decisionSupported: 'do chains form (the thesis), or is each call standalone',
    run: (ctx) => {
      const byContext = new Map()
      for (const e of ctx.entries) {
        const k = toHex(e.contextId)
        byContext.set(k, (byContext.get(k) ?? 0) + 1)
      }
      const depths = [...byContext.values()].sort((a, b) => a - b)
      if (depths.length === 0) return { median: 0, p95: 0, max: 0, n: 0 }
      const pct = (p) => depths[Math.min(depths.length - 1, Math.floor(depths.length * p))]
      return {
        median: pct(0.5),
        p95: pct(0.95),
        max: depths[depths.length - 1],
        n: depths.length,
        distribution_buckets: bucketize(depths, [1, 2, 3, 5, 10, 25, 100]),
      }
    },
  },
  {
    name: 'event_type_ratio',
    tier: 1,
    status: 'decision-tied',
    decisionSupported: 'are real economic events flowing, or is it all chatter',
    run: (ctx) => {
      const tc = ctx.entries.filter((e) => e.eventType === 0x01).length
      const tx = ctx.entries.filter((e) => e.eventType === 0x02).length
      const ob = ctx.entries.filter((e) => e.eventType === 0x03).length
      const da = ctx.entries.filter((e) => e.eventType === 0x04).length
      const an = ctx.entries.filter((e) => e.eventType === 0x05).length
      const rv = ctx.entries.filter((e) => e.eventType === 0x06).length
      const ext = ctx.entries.filter((e) => e.eventType === 0xff).length
      return {
        tool_call: tc,
        transaction: tx,
        observation: ob,
        directory_anchor: da,
        annotation: an,
        revision: rv,
        extension: ext,
        total: ctx.entries.length,
        transaction_pct:
          ctx.entries.length === 0
            ? 0
            : Math.round((tx / ctx.entries.length) * 10000) / 100,
      }
    },
  },
  {
    name: 'log_age_days',
    tier: 1,
    status: 'provisional',
    decisionSupported: 'is the log surviving across redeploys (covered by Tier 0 too; useful for sanity)',
    run: (ctx) => {
      if (ctx.entries.length === 0) return null
      const tsMin = Math.min(...ctx.entries.map((e) => e.ts))
      const tsMax = Math.max(...ctx.entries.map((e) => e.ts))
      const days = (tsMax - tsMin) / (1000 * 60 * 60 * 24)
      return Math.round(days * 100) / 100
    },
  },
  {
    name: 'top_creator_share',
    tier: 1,
    status: 'provisional',
    decisionSupported: 'is one signer dominating, or is contribution distributed',
    run: (ctx) => {
      if (ctx.entries.length === 0) return 1
      const counts = new Map()
      for (const e of ctx.entries) {
        const k = toHex(e.creatorKey)
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const top = Math.max(...counts.values())
      return Math.round((top / ctx.entries.length) * 10000) / 100
    },
  },
]

function bucketize(values, edges) {
  const buckets = {}
  for (const e of edges) buckets[`<=${e}`] = 0
  buckets[`>${edges[edges.length - 1]}`] = 0
  for (const v of values) {
    let placed = false
    for (const e of edges) {
      if (v <= e) { buckets[`<=${e}`]++; placed = true; break }
    }
    if (!placed) buckets[`>${edges[edges.length - 1]}`]++
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Snapshot pipeline
// ---------------------------------------------------------------------------

async function gatherContext() {
  let cpText
  try {
    cpText = await fetchText(`${LOG_ENDPOINT}/checkpoint`)
  } catch (err) {
    if (/-> 404$/.test(String(err.message))) {
      return { empty: true, treeSize: 0, rootHashB64: '', entries: [] }
    }
    throw err
  }
  const cp = parseCheckpointBody(cpText)
  const entries = cp.treeSize > 0 ? await fetchAllEntries(cp.treeSize) : []
  return {
    empty: false,
    treeSize: cp.treeSize,
    rootHashB64: cp.rootHashB64,
    entries,
  }
}

function loadHistory() {
  if (!existsSync(METRICS_DIR)) return []
  return readdirSync(METRICS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(METRICS_DIR, f), 'utf8')) }
      catch { return null }
    })
    .filter(Boolean)
}

function computeDeltas(current, history) {
  if (history.length === 0) return null
  const targetMs = Date.parse(current.ts) - 7 * 24 * 3600 * 1000
  const candidates = history
    .filter((s) => Date.parse(s.ts) < Date.parse(current.ts))
    .sort((a, b) =>
      Math.abs(Date.parse(a.ts) - targetMs) - Math.abs(Date.parse(b.ts) - targetMs),
    )
  if (candidates.length === 0) return null
  const prev = candidates[0]
  const elapsed = (Date.parse(current.ts) - Date.parse(prev.ts)) / 1000
  const elapsedDays = elapsed / 86400
  const cur = current.metrics
  const old = prev.metrics ?? {}
  const delta = (key) => (cur[key] !== undefined && old[key] !== undefined ? cur[key] - old[key] : null)
  const recordsAdded = delta('tree_size')
  return {
    compared_to: prev.ts,
    elapsed_days: Math.round(elapsedDays * 100) / 100,
    records_added: recordsAdded,
    records_per_day: recordsAdded === null || elapsedDays === 0 ? null : Math.round((recordsAdded / elapsedDays) * 100) / 100,
    distinct_creator_keys_added: delta('distinct_creator_keys'),
    distinct_context_ids_added: delta('distinct_context_ids'),
  }
}

function writeSnapshot(snapshot) {
  mkdirSync(METRICS_DIR, { recursive: true })
  const stamp = snapshot.ts.slice(0, 10)
  const path = join(METRICS_DIR, `${stamp}.json`)
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n')
  return path
}

function printSummary(snapshot) {
  const m = snapshot.metrics
  console.log(`atrib metrics @ ${snapshot.ts}`)
  console.log(`  log:                    ${snapshot.log.endpoint}`)
  console.log(`  tree_size:              ${m.tree_size ?? '(empty)'}`)
  console.log(`  distinct_creator_keys:  ${m.distinct_creator_keys ?? 0}`)
  console.log(`  active_creator_keys_24h:${String(m.active_creator_keys_24h ?? 0).padStart(4)}`)
  console.log(`  active_creator_keys_7d: ${String(m.active_creator_keys_7d ?? 0).padStart(4)}`)
  console.log(`  distinct_context_ids:   ${m.distinct_context_ids ?? 0}`)
  if (m.chain_depth) {
    const cd = m.chain_depth
    console.log(`  chain_depth:            median=${cd.median} p95=${cd.p95} max=${cd.max} n=${cd.n}`)
  }
  if (m.event_type_ratio) {
    const er = m.event_type_ratio
    console.log(
      `  event_type_ratio:       ${er.tool_call} tool_call / ${er.transaction} transaction / ${er.observation ?? 0} observation / ${er.directory_anchor ?? 0} directory_anchor / ${er.annotation ?? 0} annotation / ${er.revision ?? 0} revision / ${er.extension ?? 0} extension (${er.transaction_pct}% tx)`,
    )
  }
  if (m.log_age_days !== null && m.log_age_days !== undefined) {
    console.log(`  log_age_days:           ${m.log_age_days}`)
  }
  if (m.top_creator_share !== undefined) {
    console.log(`  top_creator_share:      ${m.top_creator_share}%`)
  }
  if (snapshot.deltas) {
    const d = snapshot.deltas
    console.log()
    console.log(`  vs ${d.compared_to.slice(0, 10)} (${d.elapsed_days} days ago):`)
    console.log(`    records_added:        ${d.records_added}`)
    console.log(`    records_per_day:      ${d.records_per_day}`)
    console.log(`    new_creator_keys:     ${d.distinct_creator_keys_added}`)
    console.log(`    new_context_ids:      ${d.distinct_context_ids_added}`)
  }
}

async function main() {
  const ctx = await gatherContext()

  const metrics = {}
  const metricsMeta = {}
  for (const m of METRICS) {
    try {
      metrics[m.name] = ctx.empty && m.name !== 'tree_size' ? null : await m.run(ctx)
    } catch (err) {
      metrics[m.name] = { error: String(err.message ?? err) }
    }
    metricsMeta[m.name] = {
      tier: m.tier,
      status: m.status,
      decision_supported: m.decisionSupported,
    }
  }
  if (ctx.empty) metrics.tree_size = 0

  const snapshot = {
    schema_version: 'atrib-metrics/1',
    ts: new Date().toISOString(),
    log: { endpoint: LOG_ENDPOINT, root_hash_b64: ctx.rootHashB64 },
    metrics,
    metrics_meta: metricsMeta,
  }

  const history = loadHistory()
  snapshot.deltas = computeDeltas(snapshot, history)

  const path = writeSnapshot(snapshot)
  console.log(`wrote ${path}`)
  console.log()
  printSummary(snapshot)
}

if (IS_MAIN_MODULE) {
  main().catch((err) => {
    console.error('metrics: fatal', err)
    process.exit(1)
  })
}

// Pure helpers / data exposed for unit testing
// (services/log-node/test/metrics-helpers.test.ts).
export {
  METRICS,
  bucketize,
  parseCheckpointBody,
  parseEntryBundle,
  parseEntry,
  computeDeltas,
}
