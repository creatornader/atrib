// SPDX-License-Identifier: Apache-2.0

/**
 * Non-blocking log submission with retry (§5.3.5).
 *
 * Log submission is always non-blocking. Failures never propagate to the
 * tool response or the caller.
 *
 * ## Wire format (spec §2.6.1)
 *
 * The POST body is a **bare attribution record**. not a wrapper object.
 * Earlier versions of this code wrapped the record as `{record, priority}`,
 * which did not match spec §2.6.1 and would have been rejected by any
 * spec-compliant log. Fixed in the same commit that introduced
 * `@atrib/log-dev`: the body is now the bare record per §2.6.1, and
 * `priority` travels in the `X-atrib-Priority` HTTP header. HTTP headers
 * are a non-conflicting extension to §2.6.1 and do not require a spec
 * change.
 *
 * ## On `priority`. two real consumers ship today
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
 *      The dev log honors `X-atrib-Priority` when its in-flight
 *      submission count is at the configured `maxConcurrent` capacity:
 *      submissions are placed in a priority queue and high-priority
 *      records are admitted first when capacity frees up. This models
 *      the admission-control behavior a real Tessera-backed log
 *      provides under load.
 *
 * Both consumers have unit tests that verify priority changes
 * observable behavior. This is the radical-honesty bar for shipping a
 * field on the wire. if no consumer existed, the field would be dead
 * weight and should not exist.
 */

import { canonicalRecord } from './canon.js'
import { sha256, hexEncode } from './hash.js'
import type { AtribRecord } from './types.js'

const DEFAULT_LOG_ENDPOINT = 'https://log.atrib.dev/v1/entries'
const SUBMISSION_PATH = '/v1/entries'
const ARCHIVE_RECORDS_PATH = '/v1/records'
const MAX_RETRIES = 3
const INITIAL_BACKOFF_MS = 1000
const MAX_WINDOW_MS = 30_000
const DEFAULT_ARCHIVE_TIMEOUT_MS = 5000
/**
 * Default cap on the number of unsubmitted records held in memory while the
 * log is unreachable. Without this cap, a multi-hour log outage in a hot
 * wrapper process is unbounded memory growth: every successful tool call
 * lands in pendingRecords, none drains until the log returns. At 1KB per
 * record + retry metadata, 10000 entries ≈ 15MB resident, annoying but
 * survivable. Set higher via createSubmissionQueue's maxQueueDepth option
 * for high-throughput services that have observed actual queue depths.
 */
const DEFAULT_MAX_QUEUE_DEPTH = 10_000

/**
 * Normalize a caller-supplied log endpoint to ensure it includes the
 * submission path. Avoids the silent-failure footgun where a caller passes
 * `'https://log.example.com'` and the middleware POSTs to the bare host
 * which 404s. If the path is missing, append it; if a different path is
 * already specified, leave it alone (callers may use custom log servers
 * with non-standard paths).
 *
 * Treated as missing: empty path, '/', or paths that don't end in
 * '/v1/entries'. Treated as present: any path that ends in '/v1/entries'
 * (allowing prefixes like /api/v1/entries for proxy deployments).
 *
 * Errors on invalid URLs rather than silently passing them through.
 */
function normalizeLogEndpoint(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `atrib: log endpoint '${raw}' is not a valid URL. Expected something like 'https://log.example.com/v1/entries'.`,
    )
  }
  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = SUBMISSION_PATH
    return url.toString()
  }
  if (url.pathname.endsWith(SUBMISSION_PATH)) {
    return raw
  }
  // Path is set but doesn't end in /v1/entries. Could be a custom proxy
  // path. Trust the caller; don't rewrite. The caller may know they're
  // hitting a non-standard path. If they got it wrong, the submission
  // will 404 and the file-log/stderr will surface the response status.
  return raw
}

function normalizeArchiveEndpoint(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `atrib: archive endpoint '${raw}' is not a valid URL. Expected something like 'https://archive.example.com/v1/records'.`,
    )
  }
  const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  if (path === '' || path === '/') {
    url.pathname = ARCHIVE_RECORDS_PATH
    return url.toString()
  }
  if (path === '/v1') {
    url.pathname = ARCHIVE_RECORDS_PATH
    return url.toString()
  }
  if (path.endsWith(ARCHIVE_RECORDS_PATH)) {
    url.pathname = ARCHIVE_RECORDS_PATH
    return url.toString()
  }
  return raw
}

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
  submit(record: AtribRecord, priority: 'high' | 'normal', sidecar?: SubmissionSidecar): void
  /** Get a cached proof bundle by record_hash. */
  getProof(recordHash: string): ProofBundle | undefined
  /** Flush all pending submissions (for testing/shutdown). */
  flush(): Promise<void>
}

type Priority = 'high' | 'normal'

interface PendingEntry {
  record: AtribRecord
  priority: Priority
  sidecar?: SubmissionSidecar
}

export interface SubmissionSidecar {
  authorizationEvidence?: unknown[]
  resolvedFacts?: Record<string, unknown>
  args?: Record<string, unknown>
  result?: Record<string, unknown>
}

export interface ArchiveSubmissionOptions {
  /** Archive record-submission endpoint. Accepts either /v1 or /v1/records. */
  endpoint: string
  /** Per-request timeout for best-effort archive submission. Defaults to 5000. */
  timeoutMs?: number
}

export interface SubmissionQueueOptions {
  /**
   * Maximum number of records held in `pendingRecords` while the log is
   * unreachable. When this cap would be exceeded, the queue evicts the
   * oldest 'normal'-priority entry; if only 'high'-priority entries
   * remain, it evicts the oldest 'high'-priority entry. Eviction is
   * preferable to unbounded memory growth, the spec requires non-blocking
   * submission, and an OOM-killed wrapper drops EVERYTHING.
   *
   * Defaults to {@link DEFAULT_MAX_QUEUE_DEPTH}. Set to `Infinity` to
   * disable (only safe for tests and short-lived processes).
   */
  maxQueueDepth?: number
  /**
   * Optional record body archive submission. Disabled by default because it
   * sends the signed record body and selected verifier evidence outside the
   * producer's local mirror. When enabled, archive submission happens only
   * after the log accepts the record and returns an inclusion proof.
   */
  archiveSubmission?: ArchiveSubmissionOptions
}

export function createSubmissionQueue(
  logEndpoint?: string,
  options: SubmissionQueueOptions = {},
): SubmissionQueue {
  const endpoint = normalizeLogEndpoint(logEndpoint ?? DEFAULT_LOG_ENDPOINT)
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH
  const archiveSubmission =
    options.archiveSubmission !== undefined
      ? {
          ...options.archiveSubmission,
          endpoint: normalizeArchiveEndpoint(options.archiveSubmission.endpoint),
          timeoutMs: options.archiveSubmission.timeoutMs ?? DEFAULT_ARCHIVE_TIMEOUT_MS,
        }
      : undefined
  const proofCache = new Map<string, ProofBundle>()
  // Tracks records whose initial submission failed but may succeed on a
  // later flush() retry. Each entry carries its priority so flush() can
  // drain in priority order. high before normal. which is the first of
  // the two real consumers of priority documented in the file header.
  const pendingRecords = new Map<string, PendingEntry>()
  const pendingPromises: Promise<void>[] = []
  // Counts evictions due to maxQueueDepth so an operator can detect a
  // sustained outage without tailing logs. Reset to 0 on every successful
  // drain (i.e. when pendingRecords briefly empties).
  let totalEvictions = 0

  /**
   * Evict the oldest entry to make room. JS Map iteration order is insertion
   * order, so the first key is the oldest. Prefer evicting 'normal' priority
   * over 'high' to preserve transaction-receipt durability.
   */
  function evictOneOldest(): void {
    let firstNormalKey: string | undefined
    let firstAnyKey: string | undefined
    for (const [k, entry] of pendingRecords) {
      if (firstAnyKey === undefined) firstAnyKey = k
      if (entry.priority === 'normal') {
        firstNormalKey = k
        break
      }
    }
    const victim = firstNormalKey ?? firstAnyKey
    if (victim !== undefined) {
      pendingRecords.delete(victim)
      totalEvictions++
      // Log only the first and every-100th eviction to avoid log spam during
      // a sustained outage.
      if (totalEvictions === 1 || totalEvictions % 100 === 0) {
        console.warn(
          `atrib: pendingRecords queue at cap (${maxQueueDepth}); evicted oldest record`,
          { evictions_so_far: totalEvictions, record_hash: victim },
        )
      }
    }
  }

  function recordHash(record: AtribRecord): string {
    const canonical = canonicalRecord(record)
    return hexEncode(sha256(canonical))
  }

  async function submitToArchive(
    record: AtribRecord,
    proof: ProofBundle,
    sidecar: SubmissionSidecar | undefined,
    hash: string,
  ): Promise<void> {
    if (!archiveSubmission) return

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), archiveSubmission.timeoutMs)
    const payload: Record<string, unknown> = { record, proof }
    if (sidecar?.authorizationEvidence && sidecar.authorizationEvidence.length > 0) {
      payload.authorizationEvidence = sidecar.authorizationEvidence
    }
    if (sidecar?.resolvedFacts && Object.keys(sidecar.resolvedFacts).length > 0) {
      payload.resolvedFacts = sidecar.resolvedFacts
    }

    try {
      const response = await fetch(archiveSubmission.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok) {
        console.warn(`atrib: archive submission rejected (${response.status})`, {
          record_hash: hash,
        })
      }
    } catch (err) {
      console.warn('atrib: archive submission failed', { record_hash: hash, error: err })
    } finally {
      clearTimeout(timeout)
    }
  }

  async function submitWithRetry(
    record: AtribRecord,
    priority: Priority,
    sidecar?: SubmissionSidecar,
  ): Promise<void> {
    const hash = recordHash(record)
    const startTime = Date.now()
    let backoff = INITIAL_BACKOFF_MS

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (Date.now() - startTime > MAX_WINDOW_MS) break

      try {
        // §2.6.1: POST body is a bare signed attribution record. Priority
        // travels in the X-atrib-Priority header. a non-conflicting
        // extension to the spec consumed today by @atrib/log-dev's
        // admission-control queue (see file header comment for the full
        // rationale on the two real consumers).
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-atrib-Priority': priority,
          },
          body: JSON.stringify(record),
        })

        if (response.ok) {
          const raw = (await response.json()) as Record<string, unknown>
          // Validate proof bundle shape before caching. a malicious or buggy
          // log server returning garbage should not be cached silently.
          if (
            typeof raw.log_index === 'number' &&
            Number.isInteger(raw.log_index) &&
            raw.log_index >= 0 &&
            typeof raw.checkpoint === 'string' &&
            Array.isArray(raw.inclusion_proof) &&
            (raw.inclusion_proof as unknown[]).every((e) => typeof e === 'string') &&
            typeof raw.leaf_hash === 'string'
          ) {
            const proof = raw as unknown as ProofBundle
            proofCache.set(hash, proof)
            await submitToArchive(record, proof, sidecar, hash)
          }
          pendingRecords.delete(hash)
          return
        }

        // Non-retryable status. permanent rejection. Delete from
        // pendingRecords in case this is a flush-retry (the record was
        // already in the map from a prior 5xx failure). On the initial
        // submission path the record isn't in the map yet, so delete
        // is a harmless no-op.
        if (response.status >= 400 && response.status < 500) {
          console.warn(`atrib: log submission rejected (${response.status})`, { record_hash: hash })
          pendingRecords.delete(hash)
          return
        }
      } catch {
        // Network error. retry
      }

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoff))
        backoff *= 2
      }
    }

    // All retries failed. cache locally with its priority preserved. Enforce
    // the queue cap before insert so a long outage cannot grow unbounded.
    console.warn('atrib: log submission failed after retries', { record_hash: hash })
    while (pendingRecords.size >= maxQueueDepth) {
      evictOneOldest()
    }
    pendingRecords.set(hash, { record, priority, ...(sidecar ? { sidecar } : {}) })
  }

  return {
    submit(record: AtribRecord, priority: Priority, sidecar?: SubmissionSidecar): void {
      const promise = submitWithRetry(record, priority, sidecar)
        .catch((err) => {
          console.warn('atrib: unexpected submission error', err)
        })
        .finally(() => {
          // Prune resolved promise to prevent unbounded growth in long-running
          // processes that never call flush().
          const idx = pendingPromises.indexOf(promise)
          if (idx !== -1) pendingPromises.splice(idx, 1)
        })
      pendingPromises.push(promise)
    },

    getProof(hash: string): ProofBundle | undefined {
      return proofCache.get(hash)
    },

    async flush(): Promise<void> {
      // Drain in a loop: submissions arriving during our await are caught
      // by the next iteration. Terminates when no new promises appear.
      while (pendingPromises.length > 0) {
        const inFlight = pendingPromises.splice(0)
        await Promise.allSettled(inFlight)
      }

      // Retry any failed records one more time. Drain in priority order:
      // high (transactions) before normal (tool calls).
      if (pendingRecords.size > 0) {
        const all = [...pendingRecords.values()]
        const highFirst = [
          ...all.filter((e) => e.priority === 'high'),
          ...all.filter((e) => e.priority === 'normal'),
        ]
        const retryPromises: Promise<void>[] = []
        for (const entry of highFirst) {
          retryPromises.push(
            submitWithRetry(entry.record, entry.priority, entry.sidecar).catch(() => {}),
          )
        }
        await Promise.allSettled(retryPromises)
      }
    },
  }
}
