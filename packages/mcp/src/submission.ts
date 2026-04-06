/**
 * Non-blocking log submission with retry (§5.3.5).
 *
 * Log submission is always non-blocking. Failures never propagate to the
 * tool response or the caller.
 */

import { canonicalRecord } from './canon.js'
import { sha256, hexEncode } from './hash.js'
import type { AtribRecord } from './types.js'

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.io/v1/entries'
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000
const MAX_WINDOW_MS = 30_000

export interface ProofBundle {
  logIndex: number
  inclusionProof: unknown
  checkpoint: string
}

export interface SubmissionQueue {
  /** Submit a signed record to the log (non-blocking). */
  submit(record: AtribRecord, priority: 'high' | 'normal'): void
  /** Get a cached proof bundle by record_hash. */
  getProof(recordHash: string): ProofBundle | undefined
  /** Flush all pending submissions (for testing/shutdown). */
  flush(): Promise<void>
}

export function createSubmissionQueue(logEndpoint?: string): SubmissionQueue {
  const endpoint = logEndpoint ?? DEFAULT_LOG_ENDPOINT
  const proofCache = new Map<string, ProofBundle>()
  const pendingRecords = new Map<string, AtribRecord>()
  const pendingPromises: Promise<void>[] = []

  function recordHash(record: AtribRecord): string {
    const canonical = canonicalRecord(record)
    return hexEncode(sha256(canonical))
  }

  async function submitWithRetry(record: AtribRecord, priority: 'high' | 'normal'): Promise<void> {
    const hash = recordHash(record)
    const startTime = Date.now()
    let backoff = INITIAL_BACKOFF_MS

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (Date.now() - startTime > MAX_WINDOW_MS) break

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            record,
            priority,
          }),
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
          pendingRecords.set(hash, record)
          return
        }
      } catch {
        // Network error — retry
      }

      if (attempt < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, backoff))
        backoff *= 2
      }
    }

    // All retries failed — cache locally
    console.warn('atrib: log submission failed after retries', { record_hash: hash })
    pendingRecords.set(hash, record)
  }

  return {
    submit(record: AtribRecord, priority: 'high' | 'normal'): void {
      const promise = submitWithRetry(record, priority).catch(err => {
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

      // Retry any permanently-failed records one more time
      if (pendingRecords.size > 0) {
        const retries = [...pendingRecords.entries()]
        for (const [, record] of retries) {
          const promise = submitWithRetry(record, 'normal').catch(() => {})
          pendingPromises.push(promise)
        }
        await Promise.allSettled(pendingPromises)
        pendingPromises.length = 0
      }
    },
  }
}
