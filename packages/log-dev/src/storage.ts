// SPDX-License-Identifier: Apache-2.0

/**
 * In-memory append-only entry log for `@atrib/log-dev`.
 *
 * NOT a Merkle tree. NOT durable. NOT verifiable beyond a basic shape check.
 * Just a list of accepted records keyed by `record_hash` for deduplication
 * (per spec §2.6.1 Step 6: idempotent submission must return the existing
 * proof on duplicate, not 409 Conflict).
 *
 * The interesting behavior here is the **priority queue** that demonstrates
 * the second real consumer of `X-atrib-Priority` (see `submission.ts` in
 * `@atrib/mcp` for the rationale). When `maxConcurrent` is finite and the
 * in-flight submission count is at capacity, new submissions are placed in
 * a priority queue and high-priority records are admitted first when
 * capacity frees up. This faithfully models the admission-control behavior
 * a real Tessera-backed log would expose under load.
 */

import type { AtribRecord } from '@atrib/mcp'

export type Priority = 'high' | 'normal'

export interface StoredEntry {
  /** Hex-encoded SHA-256 of the canonical record bytes (with signature). */
  recordHash: string
  /** Zero-based index assigned at admission time. */
  logIndex: number
  /** The full attribution record as submitted. */
  record: AtribRecord
  /** The priority header value seen on the inbound request. */
  priority: Priority
  /** Wall-clock time when the entry was admitted (ms since epoch). */
  admittedAt: number
}

/** Listener fired for every newly admitted entry. */
export type SubmitListener = (entry: StoredEntry) => void

export interface StorageOptions {
  /**
   * Maximum number of submissions admitted concurrently. Submissions beyond
   * this cap are placed in a priority queue and admitted FIFO within their
   * priority bucket — high-priority records jump the line. Set to
   * `Infinity` (default) to disable admission control entirely; set to a
   * small number (1, 2) for tests and demos that want to observe priority
   * ordering under capacity pressure.
   */
  maxConcurrent?: number

  /**
   * Artificial per-submission processing delay in milliseconds. Used by
   * tests and demos to make the priority queue's behavior observable.
   * Default 0 (no delay).
   */
  processingDelayMs?: number
}

/**
 * Create an in-memory storage instance with optional admission control.
 */
export function createStorage(options: StorageOptions = {}) {
  const maxConcurrent = options.maxConcurrent ?? Infinity
  const processingDelayMs = options.processingDelayMs ?? 0

  const entries: StoredEntry[] = []
  const byRecordHash = new Map<string, StoredEntry>()
  const submitListeners = new Set<SubmitListener>()

  // Pending queue, split by priority. We drain `high` before `normal`.
  type Pending = {
    record: AtribRecord
    recordHash: string
    priority: Priority
    resolve: (entry: StoredEntry) => void
  }
  const highQueue: Pending[] = []
  const normalQueue: Pending[] = []
  let inFlight = 0

  function nextLogIndex(): number {
    return entries.length
  }

  function admit(pending: Pending): StoredEntry {
    // Idempotent submission per §2.6.1 Step 6: if the same record_hash is
    // already stored, return the existing entry instead of admitting a
    // duplicate. This must hold across both immediate and queued paths.
    const existing = byRecordHash.get(pending.recordHash)
    if (existing) {
      return existing
    }
    const entry: StoredEntry = {
      recordHash: pending.recordHash,
      logIndex: nextLogIndex(),
      record: pending.record,
      priority: pending.priority,
      admittedAt: Date.now(),
    }
    entries.push(entry)
    byRecordHash.set(pending.recordHash, entry)
    for (const listener of submitListeners) {
      try {
        listener(entry)
      } catch {
        // Listener errors must not break admission
      }
    }
    return entry
  }

  function drainNext(): void {
    // Always drain `high` first — this is the priority signal's whole job.
    if (inFlight >= maxConcurrent) return
    const next = highQueue.shift() ?? normalQueue.shift()
    if (!next) return

    inFlight++
    const proceed = (): void => {
      const entry = admit(next)
      next.resolve(entry)
      inFlight--
      // After releasing the slot, try to drain the next pending submission.
      // We use a microtask deferral so listeners and callers can settle
      // before the next admission fires.
      Promise.resolve().then(drainNext)
    }
    if (processingDelayMs > 0) {
      setTimeout(proceed, processingDelayMs)
    } else {
      // Even with no delay, defer one microtask so this admit() doesn't
      // recursively unwind during the caller's await.
      Promise.resolve().then(proceed)
    }
  }

  /**
   * Submit a record. Returns a promise that resolves when the record has
   * been admitted to the in-memory log (which respects `maxConcurrent` and
   * priority ordering).
   *
   * If the same `recordHash` is already stored, resolves immediately with
   * the existing entry — idempotent per §2.6.1 Step 6.
   */
  async function submit(
    record: AtribRecord,
    recordHash: string,
    priority: Priority,
  ): Promise<StoredEntry> {
    // Idempotent fast path: if we already stored this record, return the
    // existing entry without enqueuing.
    const existing = byRecordHash.get(recordHash)
    if (existing) return existing

    return new Promise((resolve) => {
      const pending: Pending = { record, recordHash, priority, resolve }
      if (priority === 'high') {
        highQueue.push(pending)
      } else {
        normalQueue.push(pending)
      }
      drainNext()
    })
  }

  function onSubmit(listener: SubmitListener): () => void {
    submitListeners.add(listener)
    return () => submitListeners.delete(listener)
  }

  function clear(): void {
    entries.length = 0
    byRecordHash.clear()
    highQueue.length = 0
    normalQueue.length = 0
    inFlight = 0
  }

  return {
    submit,
    onSubmit,
    clear,
    get entries(): readonly StoredEntry[] {
      return entries
    },
    get size(): number {
      return entries.length
    },
    /** Number of submissions currently waiting for an admission slot. */
    get queued(): number {
      return highQueue.length + normalQueue.length
    },
    /** Number of submissions currently in flight (pre-admission). */
    get inFlight(): number {
      return inFlight
    },
  }
}

export type Storage = ReturnType<typeof createStorage>
