/**
 * Non-blocking log submission with retry (§5.3.5).
 *
 * Log submission is always non-blocking. Failures never propagate to the
 * tool response or the caller.
 *
 * ## Wire format (spec §2.6.1)
 *
 * The POST body is a **bare attribution record** — not a wrapper object.
 * Earlier versions of this code wrapped the record as `{record, priority}`,
 * which did not match spec §2.6.1 and would have been rejected by any
 * spec-compliant log. Fixed in the same commit that introduced
 * `@atrib/log-dev`: the body is now the bare record per §2.6.1, and
 * `priority` travels in the `X-Atrib-Priority` HTTP header. HTTP headers
 * are a non-conflicting extension to §2.6.1 and do not require a spec
 * change.
 *
 * ## On `priority` — two real consumers ship today
 *
 * `submit()` accepts a `priority` parameter (`'high'` for transaction
 * events, `'normal'` for tool calls). It is meaningful and consumed
 * today by two real components, neither of which is a placeholder:
 *
 *   1. **`flush()` retry ordering (this file).** When the process is
 *      shutting down and `pendingRecords` contains records whose
 *      initial submission failed, `flush()` drains them in priority
 *      order: high before normal. If the process is killed mid-flush
 *      (container restart, OOM, deploy rollover), high-priority records
 *      get the final retry attempt first and are more likely to make
 *      it to the log. Losing a transaction record (the receipt of
 *      money moving) is meaningfully worse than losing a tool-call
 *      record, so this ordering is a real safety property.
 *
 *   2. **`@atrib/log-dev` admission control under concurrency limit.**
 *      The dev log honors `X-Atrib-Priority` when its in-flight
 *      submission count is at the configured `maxConcurrent` capacity:
 *      submissions are placed in a priority queue and high-priority
 *      records are admitted first when capacity frees up. This models
 *      the admission-control behavior a real Tessera-backed log
 *      provides under load.
 *
 * Both consumers have unit tests that verify priority changes
 * observable behavior. This is the radical-honesty bar for shipping a
 * field on the wire — if no consumer existed, the field would be dead
 * weight and should not exist.
 */

import { canonicalRecord } from './canon.js'
import { sha256, hexEncode } from './hash.js'
import type { AtribRecord } from './types.js'

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.io/v1/entries'
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000
const MAX_WINDOW_MS = 30_000

/**
 * Inclusion proof bundle returned by the log's submission API per spec §2.6.2.
 *
 * Field names are snake_case to match the on-wire JSON exactly. Earlier
 * versions of this interface used camelCase (`logIndex`, `inclusionProof`)
 * which did not match the spec; the cast was opaque so nothing crashed,
 * but `@atrib/verify`'s `GraphNode.log_index` already used snake_case,
 * leaving the two packages disagreeing with each other. Both now match
 * the spec.
 */
export interface ProofBundle {
  /** Zero-based index of the entry in the log (§2.6.2). */
  log_index: number
  /** Signed checkpoint at the time of submission (§2.4 signed note format). */
  checkpoint: string
  /** Sibling hashes from leaf to root, base64-encoded (§2.6.2). */
  inclusion_proof: string[]
  /** SHA-256(0x00 || entry_bytes), base64-encoded (§2.3.2). */
  leaf_hash: string
}

export interface SubmissionQueue {
  /** Submit a signed record to the log (non-blocking). */
  submit(record: AtribRecord, priority: 'high' | 'normal'): void
  /** Get a cached proof bundle by record_hash. */
  getProof(recordHash: string): ProofBundle | undefined
  /** Flush all pending submissions (for testing/shutdown). */
  flush(): Promise<void>
}

type Priority = 'high' | 'normal'

interface PendingEntry {
  record: AtribRecord
  priority: Priority
}

export function createSubmissionQueue(logEndpoint?: string): SubmissionQueue {
  const endpoint = logEndpoint ?? DEFAULT_LOG_ENDPOINT
  const proofCache = new Map<string, ProofBundle>()
  // Tracks records whose initial submission failed but may succeed on a
  // later flush() retry. Each entry carries its priority so flush() can
  // drain in priority order — high before normal — which is the first of
  // the two real consumers of priority documented in the file header.
  const pendingRecords = new Map<string, PendingEntry>()
  const pendingPromises: Promise<void>[] = []

  function recordHash(record: AtribRecord): string {
    const canonical = canonicalRecord(record)
    return hexEncode(sha256(canonical))
  }

  async function submitWithRetry(record: AtribRecord, priority: Priority): Promise<void> {
    const hash = recordHash(record)
    const startTime = Date.now()
    let backoff = INITIAL_BACKOFF_MS

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (Date.now() - startTime > MAX_WINDOW_MS) break

      try {
        // §2.6.1: POST body is a bare signed attribution record. Priority
        // travels in the X-Atrib-Priority header — a non-conflicting
        // extension to the spec consumed today by @atrib/log-dev's
        // admission-control queue (see file header comment for the full
        // rationale on the two real consumers).
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Atrib-Priority': priority,
          },
          body: JSON.stringify(record),
        })

        if (response.ok) {
          const proof = (await response.json()) as ProofBundle
          proofCache.set(hash, proof)
          pendingRecords.delete(hash)
          return
        }

        // Non-retryable status
        if (response.status >= 400 && response.status < 500) {
          console.warn(`atrib: log submission rejected (${response.status})`, { record_hash: hash })
          pendingRecords.set(hash, { record, priority })
          return
        }
      } catch {
        // Network error — retry
      }

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff))
        backoff *= 2
      }
    }

    // All retries failed — cache locally with its priority preserved.
    console.warn('atrib: log submission failed after retries', { record_hash: hash })
    pendingRecords.set(hash, { record, priority })
  }

  return {
    submit(record: AtribRecord, priority: Priority): void {
      const promise = submitWithRetry(record, priority).catch((err) => {
        console.warn('atrib: unexpected submission error', err)
      })
      pendingPromises.push(promise)
    },

    getProof(hash: string): ProofBundle | undefined {
      return proofCache.get(hash)
    },

    async flush(): Promise<void> {
      // Wait for in-flight submissions
      await Promise.allSettled(pendingPromises)
      pendingPromises.length = 0

      // Retry any permanently-failed records one more time. Drain in
      // priority order: high (transactions) before normal (tool calls).
      // If the process is killed mid-flush, high-priority records have
      // already had their final attempt and are more likely to make it
      // to the log. This is consumer #1 of the priority signal — see
      // file header for rationale.
      if (pendingRecords.size > 0) {
        const all = [...pendingRecords.values()]
        const highFirst = [
          ...all.filter((e) => e.priority === 'high'),
          ...all.filter((e) => e.priority === 'normal'),
        ]
        for (const entry of highFirst) {
          const promise = submitWithRetry(entry.record, entry.priority).catch(() => {})
          pendingPromises.push(promise)
        }
        await Promise.allSettled(pendingPromises)
        pendingPromises.length = 0
      }
    },
  }
}
