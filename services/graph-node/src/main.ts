// SPDX-License-Identifier: Apache-2.0

/**
 * Standalone entry point for the atrib graph query service.
 *
 * Usage:
 *   pnpm --filter @atrib/graph-node start
 *
 * Environment variables:
 *   PORT                   TCP port to bind (default: 3200)
 *   HOST                   Bind address (default: 127.0.0.1)
 *   ATRIB_RECORD_ARCHIVE   Optional path to a JSONL append-only archive of
 *                          ingested records. When set, graph-node replays
 *                          the archive on cold-start (rebuilding its
 *                          in-memory store) AND mirrors every successful
 *                          /v1/ingest to the archive. Without this, an
 *                          OOM/restart loses all state, log-node only
 *                          persists 90-byte log entries per spec §2.3.1
 *                          and cannot reconstruct full record content,
 *                          so the producer-local mirror file is the only
 *                          recovery source. With this set, recovery is
 *                          local + automatic.
 */

import { bindGraphServer, type ServiceRuntimeInfo } from './server.js'
import { createRecordStore } from './store.js'
import { createArchiveAppender, replayArchive } from './persistence.js'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getHeapStatistics } from 'node:v8'
import {
  HEAP_ERROR_FRACTION,
  HEAP_WARN_FRACTION,
  heapAlertLevel,
  shouldLogHeapTransition,
  type HeapAlertLevel,
} from './heap-watchdog.js'
import type { AtribRecord } from '@atrib/mcp'

const port = parseInt(process.env.PORT ?? '3200', 10)
const host = process.env.HOST ?? '127.0.0.1'
const archivePath = process.env.ATRIB_RECORD_ARCHIVE

const store = createRecordStore()

let appender: Awaited<ReturnType<typeof createArchiveAppender>> | undefined

// Replay facts for /v1/stats. Replay happens here, before the server binds, so
// the server cannot measure it itself. Left undefined when no archive is set,
// which /v1/stats reports by omitting the `replay` block entirely.
let replayMs: number | undefined
let replayedRecords: number | undefined

if (archivePath) {
  // eslint-disable-next-line no-console
  console.log(`atrib-graph: archive enabled at ${archivePath}`)
  const replayStart = Date.now()
  const result = await replayArchive(archivePath, (record, logIndex) =>
    store.addRecord(record, logIndex),
  )
  replayMs = Date.now() - replayStart
  replayedRecords = result.ingested
  // eslint-disable-next-line no-console
  console.log(
    `atrib-graph: replayed ${result.ingested}/${result.total} records ` +
      `(${result.skipped} skipped) in ${replayMs}ms`,
  )

  // Open the appender AFTER the replay so we don't accidentally re-write
  // records during replay. The handle stays open for the process lifetime.
  appender = await createArchiveAppender(archivePath)
}

// Conditionally include onRecordIngested and the replay facts, TypeScript
// strict (`exactOptionalPropertyTypes`) rejects setting an optional property
// to `undefined` directly.
const runtimeInfo: ServiceRuntimeInfo =
  typeof replayMs === 'number'
    ? { replay_ms: replayMs, replayed_records: replayedRecords ?? 0 }
    : {}
const bindOpts = appender
  ? { store, runtimeInfo, onRecordIngested: (record: AtribRecord, logIndex: number | undefined) => appender!.append(record, logIndex) }
  : { store, runtimeInfo }
const server = await bindGraphServer(port, host, bindOpts)

// eslint-disable-next-line no-console
console.log(`atrib-graph listening on ${server.url}`)

// Periodic disk-utilization watchdog. The persistence archive grows linearly
// with ingest volume, so a slow Fly volume fill will silently degrade the
// service. Emit a structured-log warning at 80% utilization, an error at 95%.
// The check is stateful (last-emitted threshold) so a steady high-utilization
// state does not spam logs every minute. Disabled when no archive is set.
const DISK_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let lastDiskAlert: 'ok' | 'warn' | 'error' = 'ok'

async function checkDiskUtilization(target: string): Promise<void> {
  let stats
  try {
    stats = await statfs(target)
  } catch (e) {
    // statfs may fail on weird filesystems or restricted mounts; surface once
    // and bail without crashing the service.
    if (lastDiskAlert !== 'error') {
      // eslint-disable-next-line no-console
      console.error(`atrib-graph: disk-watchdog statfs failed on ${target}: ${(e as Error).message}`)
      lastDiskAlert = 'error'
    }
    return
  }
  const usedFraction = 1 - (stats.bavail * stats.bsize) / (stats.blocks * stats.bsize)
  const pct = (usedFraction * 100).toFixed(1)
  let level: 'ok' | 'warn' | 'error' = 'ok'
  if (usedFraction >= 0.95) level = 'error'
  else if (usedFraction >= 0.80) level = 'warn'

  if (level === 'ok') {
    // Log on recovery (was warn/error, now ok) so operators see the all-clear.
    if (lastDiskAlert !== 'ok') {
      // eslint-disable-next-line no-console
      console.log(`atrib-graph: disk-watchdog recovered on ${target} (${pct}% used)`)
    }
  } else if (level !== lastDiskAlert) {
    // Only log on threshold transition; steady state is silent to avoid spam.
    const msg = `atrib-graph: disk-watchdog ${level.toUpperCase()} on ${target}: ${pct}% used (threshold: ${level === 'error' ? '95%' : '80%'})`
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(msg)
    } else {
      // eslint-disable-next-line no-console
      console.warn(msg)
    }
  }
  lastDiskAlert = level
}

if (archivePath) {
  const target = dirname(archivePath)
  // Run once on startup, then on a fixed interval. The interval handle is
  // unref()'d so the process can exit cleanly without it.
  void checkDiskUtilization(target)
  const handle = setInterval(() => { void checkDiskUtilization(target) }, DISK_CHECK_INTERVAL_MS)
  handle.unref()
}

// Periodic heap-utilization watchdog. Mirrors the disk watchdog above, for the
// resource that actually takes this service down.
//
// graph-node keeps every record and every derived index in memory, so the live
// heap grows linearly and without bound as the log grows. On 2026-07-29 that
// live set reached the V8 heap ceiling at ~112k records and the process began
// aborting on any further allocation ("Ineffective mark-compacts near heap
// limit"), which Fly served as 502s. Nothing warned first: the service had a
// disk watchdog, but disk was never the constraint (the archive was 68MB on a
// 1GB volume) while the heap was at 91%.
//
// Thresholds are lower than the disk watchdog's 80/95 because heap has no
// graceful degradation. Crossing the V8 limit is an immediate process abort,
// per-request allocation sits on top of the live set so the usable ceiling is
// below 100%, and recovery costs a full archive replay during which the service
// serves errors. Warn early enough to act.
//
// record_count is in the message on purpose: heap headroom divided by growth in
// records per day is the runway, and runway is what decides when the in-memory
// store has to become the disk-backed store that persistence.ts describes.
const HEAP_CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
let lastHeapAlert: HeapAlertLevel = 'ok'

function heapUtilization(): { usedMb: number; limitMb: number; fraction: number } {
  const stats = getHeapStatistics()
  return {
    usedMb: Math.round(stats.used_heap_size / 1024 / 1024),
    limitMb: Math.round(stats.heap_size_limit / 1024 / 1024),
    fraction: stats.used_heap_size / stats.heap_size_limit,
  }
}

function checkHeapUtilization(): void {
  const { usedMb, limitMb, fraction } = heapUtilization()
  const pct = (fraction * 100).toFixed(1)
  const records = store.getRecordCount()
  const level = heapAlertLevel(fraction)

  if (!shouldLogHeapTransition(lastHeapAlert, level)) return

  if (level === 'ok') {
    // Reached only on a real transition, so this is a recovery from warn/error.
    // eslint-disable-next-line no-console
    console.log(
      `atrib-graph: heap-watchdog recovered (${usedMb}MB/${limitMb}MB, ${pct}%, ${records} records)`,
    )
  } else {
    const threshold = level === 'error' ? HEAP_ERROR_FRACTION : HEAP_WARN_FRACTION
    const msg =
      `atrib-graph: heap-watchdog ${level.toUpperCase()}: ${usedMb}MB/${limitMb}MB ` +
      `(${pct}%, ${records} records, threshold: ${(threshold * 100).toFixed(0)}%). ` +
      `Raise --max-old-space-size and the fly.toml [[vm]] memory together, ` +
      `or move to the disk-backed store described in src/persistence.ts.`
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(msg)
    } else {
      // eslint-disable-next-line no-console
      console.warn(msg)
    }
  }
  lastHeapAlert = level
}

{
  // One unconditional line per boot, so every restart leaves a heap datapoint
  // in the logs even while utilization is healthy. Trending these across
  // restarts is how the runway above gets measured.
  const { usedMb, limitMb, fraction } = heapUtilization()
  // eslint-disable-next-line no-console
  console.log(
    `atrib-graph: heap ${usedMb}MB/${limitMb}MB (${(fraction * 100).toFixed(1)}%) ` +
      `at ${store.getRecordCount()} records`,
  )
  const handle = setInterval(checkHeapUtilization, HEAP_CHECK_INTERVAL_MS)
  handle.unref()
}

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`atrib-graph: ${signal} received, shutting down`)
  await server.close()
  if (appender) {
    try {
      await appender.close()
    } catch {
      // Best-effort; the archive is append-only and OS-flushed per write.
    }
  }
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
