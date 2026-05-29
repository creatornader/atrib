// SPDX-License-Identifier: Apache-2.0

/**
 * `AtribBatchSpanProcessor` -- batched variant of `AtribSpanProcessor`.
 *
 * Signing is done per-span (cheap, in-process Ed25519). Submission to
 * the log is batched: signed records + sidecars accumulate in an
 * in-memory queue and are flushed to the caller's submit callback either
 * when the queue reaches `maxExportBatchSize` or when
 * `scheduledDelayMillis` elapses since the last flush.
 *
 * Mirrors `@arizeai/openinference-vercel`'s `OpenInferenceBatchSpanProcessor`
 * ergonomics + buffer-config semantics. Differs from the simple variant
 * in two ways:
 *   1. The `submit` callback receives an ARRAY of signed records (matching
 *      OTel exporter convention), not a single one.
 *   2. The processor maintains an internal queue + flush timer; consumers
 *      MUST call `shutdown()` (or `forceFlush()`) to drain pending
 *      submissions before exit, otherwise records may be lost.
 *
 * Use cases:
 *   - Production agent pipelines emitting many spans/sec where per-span
 *     HTTP submission overhead is unacceptable.
 *   - Pipelines submitting to the atrib log over high-latency networks
 *     where batched POSTs dominate per-record POSTs.
 *   - Long-running agents that prefer fewer-larger-requests over many-
 *     smaller-requests for cost or rate-limit reasons.
 *
 * For low-throughput interactive agents, the simple variant remains
 * preferred (lower latency between span end and record submission).
 */

import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import type { Context } from '@opentelemetry/api'
import {
  type AtribRecord,
  signRecord,
  canonicalRecord,
  sha256,
  hexEncode,
} from '@atrib/mcp'
import {
  spanToUnsignedRecord,
  readLlmOutputToolCallId,
  readToolCallId,
  readIoValues,
} from './span-to-record.js'
import { isOpenInferenceSpan } from './openinference-filter.js'
import {
  buildAtribSpanSidecar,
  type AtribSpanSidecar,
} from './sidecar.js'
import { InformedByTracker, type InformedByTrackerOptions } from './informed-by-tracker.js'
import {
  deriveArgsResultHashFields,
  type ArgsResultHashPosture,
} from './args-result-hash.js'

export type AtribBatchEntry = {
  readonly signed: AtribRecord
  readonly sidecar: AtribSpanSidecar
}

export type AtribBatchSubmission = (
  batch: readonly AtribBatchEntry[],
) => void | Promise<void>

export type AtribBatchBufferConfig = {
  /**
   * Maximum number of records the queue will hold before dropping the
   * oldest. Default 2048. Records are dropped (oldest-first) rather than
   * the processor blocking the OTel pipeline -- per atrib §5.8 the
   * substrate must never affect the primary tool call.
   */
  readonly maxQueueSize?: number
  /**
   * Maximum number of records per submit() call. When the queue reaches
   * this size, an immediate flush is scheduled. Default 512.
   */
  readonly maxExportBatchSize?: number
  /**
   * Maximum delay (ms) between flushes when the queue is non-empty.
   * Default 5000 (5 seconds).
   */
  readonly scheduledDelayMillis?: number
  /**
   * Timeout (ms) for a single submit() invocation. If the callback hangs
   * past this, the processor logs a warning and continues with the next
   * batch. Default 30000 (30 seconds).
   */
  readonly exportTimeoutMillis?: number
}

const DEFAULT_MAX_QUEUE_SIZE = 2048
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 512
const DEFAULT_SCHEDULED_DELAY_MILLIS = 5000
const DEFAULT_EXPORT_TIMEOUT_MILLIS = 30000

export type AtribBatchSpanProcessorOptions = {
  /**
   * Base64url Ed25519 32-byte private key. Used to sign every emitted
   * record. Owned by the caller; never logged or surfaced.
   */
  readonly privateKey: Uint8Array
  /**
   * Base64url Ed25519 public key. Embedded as `creator_key` on each
   * signed record.
   */
  readonly creatorKey: string
  /**
   * Server URL used in `content_id` derivation.
   */
  readonly serverUrl: string
  /**
   * Submission callback invoked with each batch of signed records. Errors
   * thrown from this callback are caught and logged; the OTel pipeline
   * is never affected.
   */
  readonly submit: AtribBatchSubmission
  /**
   * Optional: override the default span filter. Default
   * `isOpenInferenceSpan`.
   */
  readonly filter?: (span: ReadableSpan) => boolean
  /**
   * Optional: override the chain_root resolver. Same semantics as the
   * simple variant.
   */
  readonly resolveChainRoot?: (contextId: string) => string | Promise<string>
  /**
   * Buffer-config knobs (queue size, batch size, flush interval, export
   * timeout). All have safe defaults.
   */
  readonly config?: AtribBatchBufferConfig
  /**
   * Optional: log diagnostic messages to stderr. Default false.
   */
  readonly debug?: boolean
  /**
   * Optional: enable automatic `informed_by` derivation. Same semantics
   * as `AtribSpanProcessor.autoInformedBy`. When sharing across simple
   * + batch processors, pass the same `informedByTracker` instance to
   * both.
   */
  readonly autoInformedBy?: boolean
  /** Optional shared tracker (see AtribSpanProcessor docs). */
  readonly informedByTracker?: InformedByTracker
  /** Optional tracker memory bounds (ignored when informedByTracker is supplied). */
  readonly informedByTrackerOptions?: InformedByTrackerOptions
  /**
   * Optional: args/result hash posture per spec §8.3 (D045). See
   * `AtribSpanProcessorOptions.argsResultHashPosture`.
   */
  readonly argsResultHashPosture?: ArgsResultHashPosture
}

export class AtribBatchSpanProcessor implements SpanProcessor {
  private readonly opts: AtribBatchSpanProcessorOptions
  private readonly maxQueueSize: number
  private readonly maxExportBatchSize: number
  private readonly scheduledDelayMillis: number
  private readonly exportTimeoutMillis: number
  private readonly tracker: InformedByTracker | null

  private queue: AtribBatchEntry[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private inflightSigning: Set<Promise<void>> = new Set()
  private inflightSubmissions: Set<Promise<void>> = new Set()
  private shutdownRequested = false
  private droppedRecords = 0

  constructor(opts: AtribBatchSpanProcessorOptions) {
    this.opts = opts
    const cfg = opts.config ?? {}
    this.maxQueueSize = cfg.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE
    this.maxExportBatchSize = cfg.maxExportBatchSize ?? DEFAULT_MAX_EXPORT_BATCH_SIZE
    this.scheduledDelayMillis = cfg.scheduledDelayMillis ?? DEFAULT_SCHEDULED_DELAY_MILLIS
    this.exportTimeoutMillis = cfg.exportTimeoutMillis ?? DEFAULT_EXPORT_TIMEOUT_MILLIS
    if (opts.autoInformedBy === true) {
      this.tracker =
        opts.informedByTracker ??
        new InformedByTracker(opts.informedByTrackerOptions ?? {})
    } else {
      this.tracker = null
    }
  }

  onStart(_span: Span, _parentContext: Context): void {
    // No-op. atrib emits at end-of-span.
  }

  onEnd(span: ReadableSpan): void {
    if (this.shutdownRequested) return
    const filter = this.opts.filter ?? isOpenInferenceSpan
    if (!filter(span)) return

    const signing = this.processOne(span).catch((err) => this.logError('processOne', err))
    this.inflightSigning.add(signing)
    void signing.finally(() => this.inflightSigning.delete(signing))
  }

  shutdown(): Promise<void> {
    this.shutdownRequested = true
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    return this.forceFlush()
  }

  async forceFlush(): Promise<void> {
    // Wait for any in-flight signing work to finish so its records reach
    // the queue before we attempt to drain. Without this, forceFlush
    // called immediately after onEnd would race the async signing path.
    while (this.inflightSigning.size > 0) {
      await Promise.allSettled([...this.inflightSigning])
    }
    // Drain queue: keep flushing batches until empty.
    while (this.queue.length > 0) {
      await this.flushOnce()
    }
    if (this.inflightSubmissions.size > 0) {
      await Promise.allSettled([...this.inflightSubmissions])
    }
  }

  /**
   * Diagnostic counter. Records dropped due to queue overflow.
   */
  getDroppedRecordCount(): number {
    return this.droppedRecords
  }

  private async processOne(span: ReadableSpan): Promise<void> {
    const mappingCtx = {
      creatorKey: this.opts.creatorKey,
      serverUrl: this.opts.serverUrl,
      ...(this.opts.resolveChainRoot
        ? { chainRoot: await this.opts.resolveChainRoot(span.spanContext().traceId) }
        : {}),
    }
    const result = spanToUnsignedRecord(span, mappingCtx)
    if (!result.ok) {
      if (this.opts.debug) this.logError('skip', new Error(result.reason))
      return
    }

    const traceId = span.spanContext().traceId
    const toolCallId = readToolCallId(span)
    const llmOutputToolCallId = readLlmOutputToolCallId(span)

    let unsignedRecord = result.record
    if (
      this.tracker !== null &&
      result.kind === 'TOOL' &&
      toolCallId !== undefined
    ) {
      const llmRecordHash = this.tracker.lookup(traceId, toolCallId)
      if (llmRecordHash !== undefined) {
        unsignedRecord = { ...unsignedRecord, informed_by: [llmRecordHash] }
      }
    }

    if (
      this.opts.argsResultHashPosture !== undefined &&
      this.opts.argsResultHashPosture !== 'none'
    ) {
      const ioForHash = readIoValues(span)
      const hashFields = deriveArgsResultHashFields(
        this.opts.argsResultHashPosture,
        ioForHash,
      )
      unsignedRecord = { ...unsignedRecord, ...hashFields }
    }

    const recordWithPlaceholder = { ...unsignedRecord, signature: '' } as AtribRecord
    const signed = await signRecord(recordWithPlaceholder, this.opts.privateKey)

    if (
      this.tracker !== null &&
      result.kind === 'LLM' &&
      llmOutputToolCallId !== undefined
    ) {
      const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(signed)))}`
      this.tracker.recordLlmToolCallEmission(traceId, llmOutputToolCallId, recordHash)
    }

    const sidecar = buildAtribSpanSidecar(span, result.kind)

    this.enqueue({ signed, sidecar })
  }

  private enqueue(entry: AtribBatchEntry): void {
    this.queue.push(entry)
    if (this.queue.length > this.maxQueueSize) {
      // Drop oldest. Per §5.8, atrib must never affect the primary
      // pipeline; backpressuring the OTel pipeline would do exactly that.
      this.queue.shift()
      this.droppedRecords += 1
      if (this.opts.debug) {
        this.logError(
          'overflow',
          new Error(
            `queue exceeded maxQueueSize=${this.maxQueueSize}; dropped 1 oldest record (total dropped=${this.droppedRecords})`,
          ),
        )
      }
    }
    if (this.queue.length >= this.maxExportBatchSize) {
      void this.flushOnce().catch((err) => this.logError('flush', err))
    } else if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        void this.flushOnce().catch((err) => this.logError('flush', err))
      }, this.scheduledDelayMillis)
      // Allow the process to exit even if the timer is the only pending work.
      if (typeof this.flushTimer === 'object' && this.flushTimer !== null && 'unref' in this.flushTimer) {
        (this.flushTimer as { unref: () => void }).unref()
      }
    }
  }

  private async flushOnce(): Promise<void> {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0, this.maxExportBatchSize)
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    const submission = this.runSubmit(batch)
    this.inflightSubmissions.add(submission)
    try {
      await submission
    } finally {
      this.inflightSubmissions.delete(submission)
    }
  }

  private async runSubmit(batch: readonly AtribBatchEntry[]): Promise<void> {
    try {
      await this.withTimeout(Promise.resolve(this.opts.submit(batch)))
    } catch (err) {
      this.logError('submit', err)
    }
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`submit timed out after ${this.exportTimeoutMillis}ms`))
      }, this.exportTimeoutMillis)
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        (timer as { unref: () => void }).unref()
      }
      promise.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (err) => {
          clearTimeout(timer)
          reject(err instanceof Error ? err : new Error(String(err)))
        },
      )
    })
  }

  private logError(stage: string, err: unknown): void {
    if (!this.opts.debug) return
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`atrib:openinference:batch:${stage} ${msg}`)
  }
}
