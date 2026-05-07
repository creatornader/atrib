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

import { bindGraphServer } from './server.js'
import { createRecordStore } from './store.js'
import { createArchiveAppender, replayArchive } from './persistence.js'
import { statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AtribRecord } from '@atrib/mcp'

const port = parseInt(process.env.PORT ?? '3200', 10)
const host = process.env.HOST ?? '127.0.0.1'
const archivePath = process.env.ATRIB_RECORD_ARCHIVE

const store = createRecordStore()

let appender: Awaited<ReturnType<typeof createArchiveAppender>> | undefined

if (archivePath) {
  // eslint-disable-next-line no-console
  console.log(`atrib-graph: archive enabled at ${archivePath}`)
  const replayStart = Date.now()
  const result = await replayArchive(archivePath, (record, logIndex) =>
    store.addRecord(record, logIndex),
  )
  const replayMs = Date.now() - replayStart
  // eslint-disable-next-line no-console
  console.log(
    `atrib-graph: replayed ${result.ingested}/${result.total} records ` +
      `(${result.skipped} skipped) in ${replayMs}ms`,
  )

  // Open the appender AFTER the replay so we don't accidentally re-write
  // records during replay. The handle stays open for the process lifetime.
  appender = await createArchiveAppender(archivePath)
}

// Conditionally include onRecordIngested, TypeScript strict
// (`exactOptionalPropertyTypes`) rejects setting an optional property
// to `undefined` directly.
const bindOpts = appender
  ? { store, onRecordIngested: (record: AtribRecord, logIndex: number | undefined) => appender!.append(record, logIndex) }
  : { store }
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
