// SPDX-License-Identifier: Apache-2.0

/**
 * `@atrib/log-dev` — public API.
 *
 * ⚠️ NOT FOR PRODUCTION USE. See README.md for the full warning.
 *
 * Single entry point: `startDevLog(options?)` returns a running dev log
 * with an HTTP submission endpoint, an inspection API for tests/demos,
 * and a `close()` method for cleanup. The package is `private: true` and
 * cannot be published to npm — it is a workspace-internal fixture only.
 */

import {
  createStorage,
  type StorageOptions,
  type StoredEntry,
  type SubmitListener,
} from './storage.js'
import { bindServer, type ServerHandle } from './server.js'

export type { StoredEntry, SubmitListener } from './storage.js'

/** Options for `startDevLog`. */
export interface StartDevLogOptions extends StorageOptions {
  /**
   * TCP port to bind. Pass `0` (default) to let the OS pick a free port.
   * Returned at `devLog.url` after startup.
   */
  port?: number
}

/**
 * The running dev log handle. Returned by `startDevLog()`.
 */
export interface DevLog {
  /**
   * Base URL the server is listening on (e.g. `http://127.0.0.1:54321`).
   * The submission endpoint is `${url}/v1/entries`.
   */
  readonly url: string

  /**
   * The submission endpoint URL — pass this to `@atrib/mcp`'s
   * `atrib({ logEndpoint: ... })` option, or to any other atrib client
   * that needs a log endpoint.
   */
  readonly submissionEndpoint: string

  /**
   * Snapshot of every record submitted to the log so far, in admission
   * order. Use for assertions in tests and for visualization in demos.
   */
  readonly entries: readonly StoredEntry[]

  /** Convenience: number of records in the log. */
  readonly size: number

  /** Number of submissions currently waiting for an admission slot. */
  readonly queued: number

  /** Number of submissions currently in flight. */
  readonly inFlight: number

  /**
   * Subscribe to admission events. The listener is fired synchronously
   * for every newly admitted entry, in admission order. Returns an
   * unsubscribe function. Listener errors are caught and ignored to
   * prevent one bad listener from breaking the log.
   */
  onSubmit(listener: SubmitListener): () => void

  /**
   * Reset the log to empty. Used by tests for isolation between cases.
   * Does not affect connected clients (they continue to be served from
   * the same HTTP endpoint).
   */
  clear(): void

  /** Stop the HTTP server and release the port. */
  close(): Promise<void>
}

/**
 * Start an in-memory development log with an HTTP submission endpoint.
 *
 * Usage:
 *
 *   const log = await startDevLog({ port: 0 })
 *   console.log(log.submissionEndpoint)  // → http://127.0.0.1:54321/v1/entries
 *
 *   const interceptor = atrib({
 *     creatorKey: process.env.ATRIB_PRIVATE_KEY!,
 *     logEndpoint: log.submissionEndpoint,
 *   })
 *
 *   // ... use the interceptor as normal ...
 *
 *   log.onSubmit((entry) => {
 *     console.log('record stored:', entry.record.event_type)
 *   })
 *
 *   await log.close()
 */
export async function startDevLog(options: StartDevLogOptions = {}): Promise<DevLog> {
  const storage = createStorage(options)
  const port = options.port ?? 0
  const handle: ServerHandle = await bindServer(storage, port)

  return {
    get url() {
      return handle.url
    },
    get submissionEndpoint() {
      return `${handle.url}/v1/entries`
    },
    get entries() {
      return storage.entries
    },
    get size() {
      return storage.size
    },
    get queued() {
      return storage.queued
    },
    get inFlight() {
      return storage.inFlight
    },
    onSubmit(listener) {
      return storage.onSubmit(listener)
    },
    clear() {
      storage.clear()
    },
    async close() {
      await handle.close()
    },
  }
}
