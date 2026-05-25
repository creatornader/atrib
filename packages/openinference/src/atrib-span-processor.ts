// SPDX-License-Identifier: Apache-2.0

/**
 * `AtribSpanProcessor` -- consumes OpenInference-shaped OpenTelemetry
 * spans and emits signed atrib records.
 *
 * Mirrors the public ergonomics of `@arizeai/openinference-vercel`'s
 * `OpenInferenceSimpleSpanProcessor` so callers can swap or compose them
 * with minimal friction. Differences:
 *
 *   - atrib's processor is a producer: it transforms each TOOL span into
 *     a signed AtribRecord and forwards to a caller-supplied submission
 *     callback. The Arize processor is a consumer (forwards spans to an
 *     OTLP exporter).
 *   - atrib's processor requires an Ed25519 private key + creator_key +
 *     server_url at construction time. The Arize processor needs none.
 *   - atrib's processor never throws to the OTel pipeline. Per atrib §5.8
 *     degradation contract, all errors are caught and logged with the
 *     `atrib:` prefix; the original span continues unaffected.
 *
 * This is a "simple" processor: it processes each span on `onEnd` without
 * batching. A future `AtribBatchSpanProcessor` would batch submissions to
 * the log to reduce per-record HTTP overhead, mirroring the Arize batch
 * variant's role.
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
  readIoValues,
  readAgentName,
  readLlmOutputToolCallId,
  readToolCallId,
} from './span-to-record.js'
import { isOpenInferenceSpan } from './openinference-filter.js'
import { InformedByTracker, type InformedByTrackerOptions } from './informed-by-tracker.js'
import {
  deriveArgsResultHashFields,
  type ArgsResultHashPosture,
} from './args-result-hash.js'

export type AtribSpanSidecar = {
  /**
   * Span attributes the caller may want to capture in the local mirror
   * but not in the public record. The atrib spec §1.2 record format does
   * not carry args/result inline.
   */
  readonly input?: string
  readonly output?: string
  readonly agentName?: string
  /**
   * For LLM spans whose output is a tool call, the tool_call.id from
   * `llm.output_messages.<i>.message.tool_calls.<j>.tool_call.id`.
   * Matches the corresponding TOOL span's `tool_call.id` -- the
   * empirical seed for future `informed_by` derivation between LLM and
   * TOOL atrib records.
   */
  readonly llmOutputToolCallId?: string
  readonly traceId: string
  readonly spanId: string
}

export type AtribSubmission = (
  signed: AtribRecord,
  sidecar: AtribSpanSidecar,
) => void | Promise<void>

export type AtribSpanProcessorOptions = {
  /**
   * Base64url-encoded Ed25519 32-byte private key. Used to sign every
   * emitted record. Owned by the caller; never logged or surfaced.
   */
  readonly privateKey: Uint8Array
  /**
   * Base64url-encoded Ed25519 32-byte public key. Embedded in each
   * signed record's `creator_key` field. The caller is responsible for
   * deriving this from `privateKey` (e.g., via @atrib/mcp's
   * `getPublicKey`) and passing it explicitly to avoid one async call
   * per span.
   */
  readonly creatorKey: string
  /**
   * Server URL used in `content_id` derivation. Should reflect the agent
   * runtime's identity rather than an upstream tool server, since
   * OpenInference spans typically describe the agent's call into a tool
   * (the agent IS the local server).
   */
  readonly serverUrl: string
  /**
   * Submission callback invoked for each signed record. Caller routes to
   * the atrib log via @atrib/mcp's `createSubmissionQueue` or a custom
   * pipeline. Errors thrown from this callback are caught and logged;
   * they do NOT propagate to the OTel pipeline.
   */
  readonly submit: AtribSubmission
  /**
   * Optional: override the default span filter. Default is
   * `isOpenInferenceSpan`. Useful if the caller wants to additionally
   * filter on `agent.name`, `service.name`, or other attributes before
   * any signing work happens.
   */
  readonly filter?: (span: ReadableSpan) => boolean
  /**
   * Optional: override the chain_root resolver. Default uses the genesis
   * chain_root derived from the resolved context_id. Production callers
   * should typically supply a function that consults a chain-tail mirror
   * (e.g., @atrib/mcp's `resolveChainRoot`) to produce contiguous chains
   * across spans within the same context.
   */
  readonly resolveChainRoot?: (contextId: string) => string | Promise<string>
  /**
   * Optional: log diagnostic messages to stderr. Default false.
   * Per §5.8, atrib failures are caught silently to avoid affecting the
   * OTel pipeline; this flag surfaces them for development.
   */
  readonly debug?: boolean
  /**
   * Optional: enable automatic `informed_by` derivation between LLM and
   * TOOL records. When enabled, the processor maintains a per-trace
   * `tool_call.id -> record_hash` map. An LLM record whose output
   * contains a tool_call registers its record_hash under the tool_call.id;
   * the corresponding TOOL record (which carries the same tool_call.id)
   * inherits an `informed_by: [<llm_record_hash>]` edge before signing.
   * Defaults to false for backward compatibility; v0.1.0 callers should
   * enable. See `InformedByTrackerOptions` for memory bounds.
   */
  readonly autoInformedBy?: boolean
  /**
   * Optional: pass an existing InformedByTracker to share across multiple
   * processors (e.g. simple + batch composing). When omitted with
   * `autoInformedBy: true`, the processor creates a private tracker.
   */
  readonly informedByTracker?: InformedByTracker
  /**
   * Optional: tracker memory-bound config. Ignored when `informedByTracker`
   * is supplied (the supplied tracker's bounds win).
   */
  readonly informedByTrackerOptions?: InformedByTrackerOptions
  /**
   * Optional: args/result hash posture per spec §8.3 (D045). Default
   * 'none' preserves the §8.1 default privacy posture (no commitment to
   * args/result bytes). 'plain' emits sha256(canonical_args_bytes) and
   * sha256(canonical_result_bytes); 'salted' adds 16-byte random salts.
   * Verifiers given the salt + original bytes can re-derive the hash to
   * confirm what the agent committed to. Choose per threat model.
   */
  readonly argsResultHashPosture?: ArgsResultHashPosture
}

export class AtribSpanProcessor implements SpanProcessor {
  private readonly opts: AtribSpanProcessorOptions
  private readonly tracker: InformedByTracker | null
  private shutdownRequested = false

  constructor(opts: AtribSpanProcessorOptions) {
    this.opts = opts
    if (opts.autoInformedBy === true) {
      this.tracker =
        opts.informedByTracker ??
        new InformedByTracker(opts.informedByTrackerOptions ?? {})
    } else {
      this.tracker = null
    }
  }

  onStart(_span: Span, _parentContext: Context): void {
    // atrib emits at end-of-span (when input + output are both present).
    // No-op on start.
  }

  onEnd(span: ReadableSpan): void {
    if (this.shutdownRequested) return

    const filter = this.opts.filter ?? isOpenInferenceSpan
    if (!filter(span)) return

    // Fire-and-forget: any failure is caught and logged. Per §5.8 atrib
    // never affects the primary tool call. The OTel pipeline is the
    // primary; atrib is an attached observer.
    void this.process(span).catch((err) => this.logError('process', err))
  }

  shutdown(): Promise<void> {
    this.shutdownRequested = true
    return Promise.resolve()
  }

  forceFlush(): Promise<void> {
    // Simple processor has no buffer to flush. Batch variant would drain
    // pending submissions here.
    return Promise.resolve()
  }

  private async process(span: ReadableSpan): Promise<void> {
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

    // For TOOL spans with a tool_call.id matching a previously-tracked
    // LLM emission, derive the informed_by edge BEFORE signing (the
    // signature covers informed_by per JCS canonical form).
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

    const recordWithPlaceholder = {
      ...unsignedRecord,
      signature: '',
    } as AtribRecord
    const signed = await signRecord(recordWithPlaceholder, this.opts.privateKey)

    // For LLM spans whose output emitted a tool_call, register this
    // record's hash so the corresponding TOOL span (which fires next)
    // can pick it up as informed_by. The record_hash is sha256 of the
    // canonical signed record per spec §1.4.
    if (
      this.tracker !== null &&
      result.kind === 'LLM' &&
      llmOutputToolCallId !== undefined
    ) {
      const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(signed)))}`
      this.tracker.recordLlmToolCallEmission(traceId, llmOutputToolCallId, recordHash)
    }

    const io = readIoValues(span)
    const agentName = readAgentName(span)
    const sidecar: AtribSpanSidecar = {
      ...(io.input !== undefined ? { input: io.input } : {}),
      ...(io.output !== undefined ? { output: io.output } : {}),
      ...(agentName !== undefined ? { agentName } : {}),
      ...(llmOutputToolCallId !== undefined ? { llmOutputToolCallId } : {}),
      traceId,
      spanId: span.spanContext().spanId,
    }

    await this.opts.submit(signed, sidecar)
  }

  private logError(stage: string, err: unknown): void {
    if (!this.opts.debug) return
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`atrib:openinference:${stage} ${msg}`)
  }
}
