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
