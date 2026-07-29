// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-console --
 * This is a CLI check script: stdout IS its output surface, and the run log is
 * where an operator reads the heap headroom. Disabled file-wide rather than
 * raising the repo's `--max-warnings 809` ratchet, which exists to stop warning
 * counts drifting up.
 */

/**
 * Post-deploy smoke check for graph-node's /v1/stats.
 *
 * Two things it is here to catch:
 *
 *  1. Contract regressions. /v1/stats is the Fly health-check target, so if its
 *     shape drifts the liveness signal silently degrades with it.
 *
 *  2. The runway. graph-node holds every record in memory, so heap headroom is
 *     how much room the current machine size has left. Before 2026-07-29 that
 *     number existed only in Fly logs; the live set reached the V8 ceiling and
 *     the process began aborting with nothing watching. See P059 in
 *     DECISIONS.md.
 *
 * Deliberately separate from check-log-smoke.mjs. That script runs in the
 * log-node deploy job, and folding graph checks into it would re-couple a
 * log-node deploy to graph-node's health, which is the coupling the graph
 * canary was moved out of deploy-log-node to remove.
 *
 * Failure policy: contract violations always fail. Heap only fails past
 * GRAPH_SMOKE_FAIL_HEAP_PCT (default 95), high enough that it will not block
 * the very deploy that fixes a memory problem, while still refusing to report
 * green on a service that is about to abort. Warn/error thresholds below mirror
 * the in-process watchdog in services/graph-node/src/heap-watchdog.ts.
 *
 * Env:
 *   GRAPH_SMOKE_ORIGIN          default https://graph.atrib.dev
 *   GRAPH_SMOKE_MAX_TOTAL_MS    default 5000
 *   GRAPH_SMOKE_FETCH_TIMEOUT_MS default 15000
 *   GRAPH_SMOKE_ATTEMPTS        default 3
 *   GRAPH_SMOKE_RETRY_DELAY_MS  default 2000
 *   GRAPH_SMOKE_FAIL_HEAP_PCT   default 95
 */

const origin = (process.env.GRAPH_SMOKE_ORIGIN ?? 'https://graph.atrib.dev').replace(/\/$/, '')
const maxTotalMs = readPositiveInt('GRAPH_SMOKE_MAX_TOTAL_MS', 5000)
const timeoutMs = readPositiveInt('GRAPH_SMOKE_FETCH_TIMEOUT_MS', 15000)
const maxAttempts = readPositiveInt('GRAPH_SMOKE_ATTEMPTS', 3)
const retryDelayMs = readPositiveInt('GRAPH_SMOKE_RETRY_DELAY_MS', 2000)
const failHeapPct = readPositiveInt('GRAPH_SMOKE_FAIL_HEAP_PCT', 95)

// Mirror services/graph-node/src/heap-watchdog.ts.
const WARN_PCT = 70
const ERROR_PCT = 85

function readPositiveInt(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return parsed
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchStatsOnce(attempt) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${origin}/v1/stats`, { signal: controller.signal })
    const body = await response.text()
    const totalMs = Date.now() - started
    if (!response.ok) {
      throw new Error(`attempt ${attempt}: /v1/stats returned ${response.status}`)
    }
    return { body, totalMs }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchStats() {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchStatsOnce(attempt)
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) await sleep(retryDelayMs)
    }
  }
  throw lastError
}

/** Contract checks. These are regressions, so they always fail the run. */
function validateShape(parsed) {
  const problems = []
  if (parsed.service !== 'atrib-graph-node') {
    problems.push(`service was ${JSON.stringify(parsed.service)}`)
  }
  for (const field of ['record_count', 'context_count', 'uptime_s']) {
    if (!Number.isInteger(parsed[field]) || parsed[field] < 0) {
      problems.push(`${field} was ${JSON.stringify(parsed[field])}`)
    }
  }
  const heap = parsed.heap
  if (typeof heap !== 'object' || heap === null) {
    problems.push('heap block missing')
    return problems
  }
  for (const field of ['used_mb', 'limit_mb', 'used_pct']) {
    if (typeof heap[field] !== 'number' || !Number.isFinite(heap[field])) {
      problems.push(`heap.${field} was ${JSON.stringify(heap[field])}`)
    }
  }
  if (typeof heap.used_mb === 'number' && typeof heap.limit_mb === 'number') {
    if (heap.limit_mb <= 0) problems.push(`heap.limit_mb was ${heap.limit_mb}`)
    if (heap.used_mb > heap.limit_mb) {
      problems.push(`heap.used_mb ${heap.used_mb} exceeds limit_mb ${heap.limit_mb}`)
    }
  }
  // A deployed graph-node with zero records means the archive did not replay,
  // which is data loss rather than a fresh start.
  if (parsed.record_count === 0) {
    problems.push('record_count is 0; the archive did not replay')
  }
  return problems
}

// Below this, per-record heap attribution is meaningless: Node's own baseline
// (~25MB) dominates a small store, so dividing total heap by record count
// reports tens of KB per record and a wildly wrong headroom. Headroom in MB is
// exact at any size, so that is always reported; the record-denominated view is
// gated on having enough records for the baseline to be noise.
const MIN_RECORDS_FOR_PER_RECORD_ESTIMATE = 10_000

function reportRunway(parsed) {
  const { used_mb: used, limit_mb: limit, used_pct: pct } = parsed.heap
  const records = parsed.record_count
  const toMb = (targetPct) => Math.max(0, Math.round(limit * (targetPct / 100) - used))

  console.log(`graph-node /v1/stats @ ${origin}`)
  console.log(`  records      ${records.toLocaleString()} across ${parsed.context_count.toLocaleString()} contexts`)
  console.log(`  heap         ${used}MB / ${limit}MB (${pct}%)`)
  console.log(`  headroom     ${toMb(WARN_PCT)}MB to ${WARN_PCT}% warn, ${toMb(ERROR_PCT)}MB to ${ERROR_PCT}% error`)

  if (records >= MIN_RECORDS_FOR_PER_RECORD_ESTIMATE) {
    // Attributes all heap to records, so it absorbs Node's fixed baseline and
    // slightly overstates cost per record. That biases the headroom estimate
    // low, which is the safe direction for a runway number. Divide by your own
    // records/day to get days.
    const kbPerRecord = (used * 1024) / records
    const toRecords = (targetPct) => Math.max(0, Math.round((toMb(targetPct) * 1024) / kbPerRecord))
    console.log(`  per record   ~${kbPerRecord.toFixed(2)} KB (incl. fixed overhead, so conservative)`)
    console.log(`  runway       ~${toRecords(WARN_PCT).toLocaleString()} records to warn, ~${toRecords(ERROR_PCT).toLocaleString()} to error`)
  } else {
    console.log(`  runway       not estimated below ${MIN_RECORDS_FOR_PER_RECORD_ESTIMATE.toLocaleString()} records (fixed overhead dominates)`)
  }

  console.log(`  uptime       ${parsed.uptime_s}s`)
  if (parsed.replay) {
    console.log(`  last replay  ${parsed.replay.records.toLocaleString()} records in ${parsed.replay.ms}ms`)
  }
}

async function main() {
  const { body, totalMs } = await fetchStats()

  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(`/v1/stats did not return JSON: ${body.slice(0, 200)}`)
  }

  const problems = validateShape(parsed)
  if (problems.length > 0) {
    throw new Error(`/v1/stats contract violations:\n  - ${problems.join('\n  - ')}`)
  }

  reportRunway(parsed)

  // A slow /v1/stats is itself the signal. This endpoint is O(1); when the
  // process is thrashing GC it stays up but stops answering promptly, which is
  // exactly how the 2026-07-29 outage presented.
  if (totalMs > maxTotalMs) {
    throw new Error(`/v1/stats took ${totalMs}ms, over the ${maxTotalMs}ms budget`)
  }

  const pct = parsed.heap.used_pct
  if (pct >= failHeapPct) {
    throw new Error(
      `heap at ${pct}% is at or over the ${failHeapPct}% fail threshold. ` +
        `Raise NODE_OPTIONS --max-old-space-size AND fly.toml [[vm]] memory together, ` +
        `or act on P059. Override for a remediation deploy with GRAPH_SMOKE_FAIL_HEAP_PCT.`,
    )
  }
  if (pct >= ERROR_PCT) {
    console.error(`::error::graph-node heap at ${pct}%, over the ${ERROR_PCT}% error threshold. See P059.`)
  } else if (pct >= WARN_PCT) {
    console.warn(`::warning::graph-node heap at ${pct}%, over the ${WARN_PCT}% warn threshold. See P059.`)
  }

  console.log(`ok: /v1/stats healthy in ${totalMs}ms`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
