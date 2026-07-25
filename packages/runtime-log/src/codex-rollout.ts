// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import canonicalize from 'canonicalize'
import {
  assertPortableObservationValue,
  createRuntimeObservationBatch,
  verifyRuntimeObservationBatchTransition,
  type RuntimeObservationAdapter,
  type RuntimeObservationBatch,
  type RuntimeObservationClaim,
  type RuntimeObservationCoverage,
  type RuntimeObservationFrameRef,
  type RuntimeObservationGap,
  type RuntimeObservationHistoryCompleteness,
  type RuntimeObservationSourceBinding,
} from './observation.js'
import type { Sha256Uri } from './index.js'

export const CODEX_ROLLOUT_OBSERVATION_PROFILE = {
  id: 'codex-rollout-jsonl',
  version: 'v1',
} as const
export const CODEX_ROLLOUT_CURSOR_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/codex-rollout-cursor/v0' as const
export const CODEX_ROLLOUT_OBSERVATION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/codex-rollout-observation/v0' as const
export const CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES = 64 * 1024 * 1024

const DEFAULT_HEADER_BYTES = 64 * 1024
const DEFAULT_EVENT_BYTES = 16 * 1024 * 1024
const SEARCH_CHUNK_BYTES = 64 * 1024

export type CodexRolloutGapKind =
  | 'source-missing'
  | 'source-replaced'
  | 'source-truncated'
  | 'source-anchor-mismatch'
  | 'malformed-event'
  | 'oversized-event'
  | 'partial-tail'

export interface CodexRolloutLineAnchor {
  readonly start_byte: number
  readonly end_byte: number
  readonly event_hash: Sha256Uri
  readonly framed_event_hash: Sha256Uri
}

export interface CodexRolloutCursor {
  readonly schema: typeof CODEX_ROLLOUT_CURSOR_SCHEMA
  readonly source_ref: string
  readonly generation_ref: string
  readonly session_id: string
  readonly runtime_id: string
  readonly observer_ref: string
  readonly subject_ref: string
  readonly subject_runtime_session_id: string
  readonly history_completeness: RuntimeObservationHistoryCompleteness
  readonly next_byte: number
  readonly sequence: number
  readonly prior_line_anchor?: CodexRolloutLineAnchor
  readonly last_source_event_hash?: Sha256Uri
  readonly pending_compaction?: CodexRolloutCompactionRef
  readonly observed_at: string
}

export interface CodexRolloutFrameRef extends RuntimeObservationFrameRef {
  readonly start_byte: number
  readonly end_byte: number
}

export interface CodexRolloutObservation extends RuntimeObservationClaim {
  readonly schema: typeof CODEX_ROLLOUT_OBSERVATION_SCHEMA
  readonly event_type: string
  readonly payload_type?: string
  readonly role?: string
  readonly item_id_hash?: Sha256Uri
  readonly source_frame: CodexRolloutFrameRef
}

export interface CodexRolloutCoverage extends RuntimeObservationCoverage {
  readonly scanned_start_byte: number
  readonly scanned_end_byte: number
  readonly complete_bytes: number
  readonly malformed_event_count: number
  readonly oversized_event_count: number
  readonly partial_tail_bytes: number
  readonly event_policy_bytes: number
  readonly hard_ceiling_bytes: typeof CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES
}

export interface CodexRolloutGap extends RuntimeObservationGap {
  readonly kind: CodexRolloutGapKind
  readonly position: number
  readonly event_bytes?: number
  readonly limit_bytes?: number
}

export interface CodexRolloutWindowRef {
  readonly start_sequence: number
  readonly end_sequence: number
  readonly start_byte: number
  readonly end_byte: number
  readonly ordered_event_commitment: Sha256Uri
}

export interface CodexRolloutCompactionRef {
  readonly kind: 'codex-context-compaction'
  readonly marker_sequence: number
  readonly marker_frame: CodexRolloutFrameRef
  readonly marker_event_hash: Sha256Uri
  readonly pre_window?: CodexRolloutWindowRef
  readonly post_continuation?: CodexRolloutWindowRef
  readonly accepted_state_inferred: false
}

export interface CodexRolloutBatchData {
  readonly window_refs: readonly CodexRolloutWindowRef[]
  readonly compaction_refs: readonly CodexRolloutCompactionRef[]
}

export type CodexRolloutObservationBatch = RuntimeObservationBatch<
  CodexRolloutCursor,
  CodexRolloutObservation,
  CodexRolloutCoverage,
  CodexRolloutGap,
  CodexRolloutBatchData
>

export interface CodexRolloutObservationSourceOptions {
  readonly path: string
  /** Opaque host-owned identifier. The local path never enters portable output. */
  readonly source_handle: string
  readonly session_id: string
  readonly runtime_id: string
  readonly runtime_version?: string
  readonly observer_ref: string
  readonly subject_ref: string
  readonly now?: () => string
  readonly max_event_bytes?: number
  readonly max_poll_bytes?: number
  readonly header_bytes?: number
  /** Omit for tail-first binding. */
  readonly initial_backfill_bytes?: number
}

export interface BoundCodexRolloutObservationSource {
  readonly adapter: CodexRolloutObservationAdapter
  readonly cursor: CodexRolloutCursor
}

interface CompleteLine {
  readonly eventBytes: Buffer
  readonly framedLine: Buffer
  readonly value: Record<string, unknown>
  readonly sequence: number
  readonly startByte: number
  readonly endByte: number
}

interface SplitCompleteLinesResult {
  readonly lines: readonly CompleteLine[]
  readonly completeBytes: number
  readonly malformed?: { readonly atByte: number; readonly eventBytes: number }
  readonly oversized?: { readonly atByte: number; readonly eventBytes: number }
}

export class CodexRolloutObservationAdapter implements RuntimeObservationAdapter<
  CodexRolloutCursor,
  CodexRolloutObservation,
  CodexRolloutCoverage,
  CodexRolloutGap,
  CodexRolloutBatchData
> {
  readonly profile = CODEX_ROLLOUT_OBSERVATION_PROFILE
  readonly source: RuntimeObservationSourceBinding

  constructor(
    private readonly options: CodexRolloutObservationSourceOptions,
    source: RuntimeObservationSourceBinding,
  ) {
    validateOptions(options)
    this.source = source
  }

  async readBatch(expectedCursor: CodexRolloutCursor): Promise<CodexRolloutObservationBatch> {
    validateCursor(expectedCursor, this.options, this.source)
    let handle
    try {
      handle = await openRollout(this.options.path)
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return finishBatch(
          gapBatch('source-missing', expectedCursor, this.source, this.options),
          expectedCursor,
          this.options,
          this.source,
        )
      }
      throw error
    }

    try {
      const stat = await handle.stat()
      if (expectedCursor.generation_ref !== generationRef(this.options.source_handle, stat)) {
        return finishBatch(
          gapBatch('source-replaced', expectedCursor, this.source, this.options),
          expectedCursor,
          this.options,
          this.source,
        )
      }
      if (stat.size < expectedCursor.next_byte) {
        return finishBatch(
          gapBatch('source-truncated', expectedCursor, this.source, this.options),
          expectedCursor,
          this.options,
          this.source,
        )
      }
      if (!(await verifyAnchor(handle, expectedCursor.prior_line_anchor))) {
        return finishBatch(
          gapBatch('source-anchor-mismatch', expectedCursor, this.source, this.options),
          expectedCursor,
          this.options,
          this.source,
        )
      }

      const available = stat.size - expectedCursor.next_byte
      const readLength = Math.min(available, maxPollBytes(this.options))
      const bytes = await positionalRead(handle, expectedCursor.next_byte, readLength)
      const split = splitCompleteLines(
        bytes,
        expectedCursor.next_byte,
        expectedCursor.sequence + 1,
        maxEventBytes(this.options),
      )
      if (split.oversized) {
        return finishBatch(
          blockedFrameBatch(
            'oversized-event',
            expectedCursor,
            this.source,
            this.options,
            split.oversized,
            expectedCursor.next_byte + bytes.length,
          ),
          expectedCursor,
          this.options,
          this.source,
        )
      }
      if (split.malformed) {
        return finishBatch(
          blockedFrameBatch(
            'malformed-event',
            expectedCursor,
            this.source,
            this.options,
            split.malformed,
            expectedCursor.next_byte + bytes.length,
          ),
          expectedCursor,
          this.options,
          this.source,
        )
      }

      const observedAt = (this.options.now ?? isoNow)()
      const observations = split.lines.map((line) =>
        projectObservation(this.options, this.source, line, observedAt),
      )
      const compaction = compactionStateFor(
        expectedCursor.pending_compaction,
        split.lines,
        observations,
      )
      const last = split.lines.at(-1)
      const partialTailBytes = bytes.length - split.completeBytes
      const proposedCursor: CodexRolloutCursor = {
        ...expectedCursor,
        ...(last
          ? {
              next_byte: last.endByte,
              sequence: last.sequence,
              prior_line_anchor: anchorFor(last),
              last_source_event_hash: eventHash(last.eventBytes),
            }
          : {}),
        ...(compaction.pending ? { pending_compaction: compaction.pending } : {}),
        observed_at: observedAt,
      }
      if (!compaction.pending)
        delete (proposedCursor as { pending_compaction?: unknown }).pending_compaction
      const gaps: CodexRolloutGap[] =
        partialTailBytes > 0
          ? [
              {
                kind: 'partial-tail',
                position: proposedCursor.next_byte,
                event_bytes: partialTailBytes,
              },
            ]
          : []
      const windowRefs = windowRefsFor(observations)
      const batch = createRuntimeObservationBatch({
        adapter: this.profile,
        source: this.source,
        status: 'ok',
        expected_cursor: expectedCursor,
        proposed_cursor: proposedCursor,
        observations,
        coverage: coverage({
          cursor: expectedCursor,
          scannedEndByte: expectedCursor.next_byte + bytes.length,
          completeBytes: split.completeBytes,
          completeEventCount: observations.length,
          partialTailBytes,
          parsingStatus: partialTailBytes > 0 ? 'degraded' : 'ok',
          completeWindowEligible: partialTailBytes === 0,
          malformedEventCount: 0,
          oversizedEventCount: 0,
          options: this.options,
        }),
        gaps,
        observed_at: observedAt,
        profile_data: {
          window_refs: windowRefs,
          compaction_refs: compaction.refs,
        },
      })
      return finishBatch(batch, expectedCursor, this.options, this.source)
    } finally {
      await handle.close()
    }
  }
}

export async function bindCodexRolloutObservationSource(
  options: CodexRolloutObservationSourceOptions,
): Promise<BoundCodexRolloutObservationSource> {
  validateOptions(options)
  const handle = await openRollout(options.path)
  try {
    const stat = await handle.stat()
    await validateSessionIdentity(handle, stat.size, options)
    const completeBoundary = await findLastNewline(handle, stat.size, maxEventBytes(options) + 1)
    const backfill = options.initial_backfill_bytes ?? 0
    const nextByte =
      backfill > 0 ? await backfillBoundary(handle, completeBoundary, backfill) : completeBoundary
    const historyCompleteness: RuntimeObservationHistoryCompleteness =
      backfill === 0 ? 'tail-only' : 'bounded-backfill'
    const observedAt = (options.now ?? isoNow)()
    const source: RuntimeObservationSourceBinding = {
      source_ref: sourceRef(options.source_handle),
      generation_ref: generationRef(options.source_handle, stat),
      runtime: {
        name: 'Codex',
        version: options.runtime_version ?? 'unknown',
        environment: 'rollout JSONL',
      },
      session_id: options.session_id,
    }
    const cursor: CodexRolloutCursor = {
      schema: CODEX_ROLLOUT_CURSOR_SCHEMA,
      source_ref: source.source_ref,
      generation_ref: source.generation_ref,
      session_id: options.session_id,
      runtime_id: options.runtime_id,
      observer_ref: options.observer_ref,
      subject_ref: options.subject_ref,
      subject_runtime_session_id: options.session_id,
      history_completeness: historyCompleteness,
      next_byte: nextByte,
      sequence: 0,
      ...(await anchorBefore(handle, nextByte, maxEventBytes(options)).then((anchor) =>
        anchor ? { prior_line_anchor: anchor } : {},
      )),
      observed_at: observedAt,
    }
    assertPortableObservationValue({ source, cursor })
    return {
      adapter: new CodexRolloutObservationAdapter(options, source),
      cursor,
    }
  } finally {
    await handle.close()
  }
}

function assertCodexBatch(
  batch: CodexRolloutObservationBatch,
  expectedCursor: CodexRolloutCursor,
  options: CodexRolloutObservationSourceOptions,
  source: RuntimeObservationSourceBinding,
): void {
  const generic = verifyRuntimeObservationBatchTransition(batch, expectedCursor)
  if (!generic.valid) {
    throw new Error(generic.issues.map((issue) => issue.message).join('; '))
  }
  validateCursor(batch.proposed_cursor, options, source)
  if (
    batch.proposed_cursor.next_byte - batch.expected_cursor.next_byte !==
      batch.coverage.complete_bytes ||
    batch.proposed_cursor.sequence - batch.expected_cursor.sequence !== batch.observations.length
  ) {
    throw new Error('Codex rollout proposed cursor does not match complete source frames')
  }
  let priorEnd = batch.expected_cursor.next_byte
  let sequence = batch.expected_cursor.sequence + 1
  const observationIds = new Set<string>()
  for (const observation of batch.observations) {
    if (
      observation.source_frame.sequence !== sequence++ ||
      observation.source_frame.start_byte !== priorEnd ||
      observation.source_frame.end_byte <= observation.source_frame.start_byte ||
      observation.observer_ref !== options.observer_ref ||
      observation.subject_ref !== options.subject_ref ||
      observation.subject_runtime_session_id !== options.session_id ||
      observationIds.has(observation.observation_id) ||
      !isSha256Uri(observation.observation_id) ||
      !isSha256Uri(observation.source_frame.event_hash) ||
      !isSha256Uri(observation.source_frame.framed_event_hash)
    ) {
      throw new Error('Codex rollout observation sequence is invalid')
    }
    observationIds.add(observation.observation_id)
    priorEnd = observation.source_frame.end_byte
  }
  if (batch.observations.length > 0 && priorEnd !== batch.proposed_cursor.next_byte) {
    throw new Error('Codex rollout source frames do not end at proposed cursor')
  }
}

function finishBatch(
  batch: CodexRolloutObservationBatch,
  expectedCursor: CodexRolloutCursor,
  options: CodexRolloutObservationSourceOptions,
  source: RuntimeObservationSourceBinding,
): CodexRolloutObservationBatch {
  assertCodexBatch(batch, expectedCursor, options, source)
  return batch
}

function gapBatch(
  kind: Exclude<CodexRolloutGapKind, 'malformed-event' | 'oversized-event' | 'partial-tail'>,
  cursor: CodexRolloutCursor,
  source: RuntimeObservationSourceBinding,
  options: CodexRolloutObservationSourceOptions,
): CodexRolloutObservationBatch {
  return createRuntimeObservationBatch({
    adapter: CODEX_ROLLOUT_OBSERVATION_PROFILE,
    source,
    status: 'gap',
    expected_cursor: cursor,
    proposed_cursor: cursor,
    observations: [],
    coverage: coverage({
      cursor,
      scannedEndByte: cursor.next_byte,
      completeBytes: 0,
      completeEventCount: 0,
      partialTailBytes: 0,
      parsingStatus: 'blocked',
      completeWindowEligible: false,
      malformedEventCount: 0,
      oversizedEventCount: 0,
      options,
    }),
    gaps: [{ kind, position: cursor.next_byte }],
    observed_at: (options.now ?? isoNow)(),
    profile_data: { window_refs: [], compaction_refs: [] },
  })
}

function blockedFrameBatch(
  kind: 'malformed-event' | 'oversized-event',
  cursor: CodexRolloutCursor,
  source: RuntimeObservationSourceBinding,
  options: CodexRolloutObservationSourceOptions,
  frame: { readonly atByte: number; readonly eventBytes: number },
  scannedEndByte: number,
): CodexRolloutObservationBatch {
  return createRuntimeObservationBatch({
    adapter: CODEX_ROLLOUT_OBSERVATION_PROFILE,
    source,
    status: 'gap',
    expected_cursor: cursor,
    proposed_cursor: cursor,
    observations: [],
    coverage: coverage({
      cursor,
      scannedEndByte,
      completeBytes: 0,
      completeEventCount: 0,
      partialTailBytes: 0,
      parsingStatus: 'blocked',
      completeWindowEligible: false,
      malformedEventCount: kind === 'malformed-event' ? 1 : 0,
      oversizedEventCount: kind === 'oversized-event' ? 1 : 0,
      options,
    }),
    gaps: [
      {
        kind,
        position: frame.atByte,
        event_bytes: frame.eventBytes,
        ...(kind === 'oversized-event' ? { limit_bytes: maxEventBytes(options) } : {}),
      },
    ],
    observed_at: (options.now ?? isoNow)(),
    profile_data: { window_refs: [], compaction_refs: [] },
  })
}

function coverage(input: {
  readonly cursor: CodexRolloutCursor
  readonly scannedEndByte: number
  readonly completeBytes: number
  readonly completeEventCount: number
  readonly partialTailBytes: number
  readonly parsingStatus: CodexRolloutCoverage['parsing_status']
  readonly completeWindowEligible: boolean
  readonly malformedEventCount: number
  readonly oversizedEventCount: number
  readonly options: CodexRolloutObservationSourceOptions
}): CodexRolloutCoverage {
  return {
    history_completeness: input.cursor.history_completeness,
    parsing_status: input.parsingStatus,
    complete_event_count: input.completeEventCount,
    complete_window_eligible: input.completeWindowEligible,
    scanned_start_byte: input.cursor.next_byte,
    scanned_end_byte: input.scannedEndByte,
    complete_bytes: input.completeBytes,
    malformed_event_count: input.malformedEventCount,
    oversized_event_count: input.oversizedEventCount,
    partial_tail_bytes: input.partialTailBytes,
    event_policy_bytes: maxEventBytes(input.options),
    hard_ceiling_bytes: CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES,
  }
}

function projectObservation(
  options: CodexRolloutObservationSourceOptions,
  source: RuntimeObservationSourceBinding,
  line: CompleteLine,
  observedAt: string,
): CodexRolloutObservation {
  const payload = asRecord(line.value.payload)
  const sourceOccurredAt = boundedString(line.value.timestamp)
  const itemId = boundedString(payload?.id)
  const payloadType = allowlistedPayloadType(payload?.type)
  const role = allowlistedRole(payload?.role)
  const hash = eventHash(line.eventBytes)
  const observationId = sha256Canonical({
    profile: CODEX_ROLLOUT_OBSERVATION_PROFILE,
    source_ref: source.source_ref,
    generation_ref: source.generation_ref,
    sequence: line.sequence,
    event_hash: hash,
  })
  return {
    schema: CODEX_ROLLOUT_OBSERVATION_SCHEMA,
    observation_id: observationId,
    kind: 'transcript-event',
    event_type: allowlistedEventType(line.value.type),
    ...(payloadType ? { payload_type: payloadType } : {}),
    ...(role ? { role } : {}),
    ...(itemId ? { item_id_hash: sha256Uri(Buffer.from(itemId)) } : {}),
    observer_ref: options.observer_ref,
    subject_ref: options.subject_ref,
    subject_runtime_session_id: options.session_id,
    observed_at: observedAt,
    ...(sourceOccurredAt && validTimestamp(sourceOccurredAt)
      ? { source_occurred_at: sourceOccurredAt }
      : {}),
    source_frame: {
      source_ref: source.source_ref,
      generation_ref: source.generation_ref,
      sequence: line.sequence,
      position: line.startByte,
      start_byte: line.startByte,
      end_byte: line.endByte,
      event_hash: hash,
      framed_event_hash: sha256Uri(line.framedLine),
    },
    capture_mode: 'attach-native',
    evidence_grade: 'runtime-captured',
    execution_evidence: false,
    semantic_state: 'not-inferred',
  }
}

function splitCompleteLines(
  bytes: Buffer,
  baseByte: number,
  firstSequence: number,
  eventLimit: number,
): SplitCompleteLinesResult {
  const lines: CompleteLine[] = []
  let start = 0
  let sequence = firstSequence
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] !== 0x0a) continue
    let contentEnd = index
    if (contentEnd > start && bytes[contentEnd - 1] === 0x0d) contentEnd--
    const eventBytes = bytes.subarray(start, contentEnd)
    const framedLine = bytes.subarray(start, index + 1)
    if (eventBytes.length > eventLimit) {
      return {
        lines: [],
        completeBytes: 0,
        oversized: { atByte: baseByte + start, eventBytes: eventBytes.length },
      }
    }
    if (eventBytes.length === 0) {
      return {
        lines: [],
        completeBytes: 0,
        malformed: { atByte: baseByte + start, eventBytes: 0 },
      }
    }
    let value: unknown
    try {
      value = JSON.parse(eventBytes.toString('utf8'))
    } catch {
      return {
        lines: [],
        completeBytes: 0,
        malformed: { atByte: baseByte + start, eventBytes: eventBytes.length },
      }
    }
    const record = asRecord(value)
    if (!record) {
      return {
        lines: [],
        completeBytes: 0,
        malformed: { atByte: baseByte + start, eventBytes: eventBytes.length },
      }
    }
    lines.push({
      eventBytes,
      framedLine,
      value: record,
      sequence: sequence++,
      startByte: baseByte + start,
      endByte: baseByte + index + 1,
    })
    start = index + 1
  }
  if (start === 0 && bytes.length > eventLimit + 1) {
    return {
      lines: [],
      completeBytes: 0,
      oversized: { atByte: baseByte, eventBytes: bytes.length },
    }
  }
  return { lines, completeBytes: start }
}

function windowRefsFor(observations: readonly CodexRolloutObservation[]): CodexRolloutWindowRef[] {
  const first = observations[0]?.source_frame
  const last = observations.at(-1)?.source_frame
  if (!first || !last) return []
  return [
    {
      start_sequence: first.sequence,
      end_sequence: last.sequence,
      start_byte: first.start_byte,
      end_byte: last.end_byte,
      ordered_event_commitment: sha256Canonical(
        observations.map((observation) => observation.observation_id),
      ),
    },
  ]
}

function compactionStateFor(
  pending: CodexRolloutCompactionRef | undefined,
  lines: readonly CompleteLine[],
  observations: readonly CodexRolloutObservation[],
): {
  readonly refs: CodexRolloutCompactionRef[]
  readonly pending?: CodexRolloutCompactionRef
} {
  const refs: CodexRolloutCompactionRef[] = []
  const markerIndexes = lines.flatMap((line, index) => (isCompactionLine(line) ? [index] : []))
  if (pending && observations.length > 0) {
    const firstMarker = markerIndexes[0] ?? observations.length
    const continuation = windowRefsFor(observations.slice(0, firstMarker))[0]
    refs.push({
      ...pending,
      ...(continuation ? { post_continuation: continuation } : {}),
    })
  }
  for (let markerIndex = 0; markerIndex < markerIndexes.length; markerIndex++) {
    const index = markerIndexes[markerIndex]!
    const marker = observations[index]!
    const previousMarker = markerIndexes[markerIndex - 1] ?? -1
    const nextMarker = markerIndexes[markerIndex + 1] ?? observations.length
    const preWindow = windowRefsFor(observations.slice(previousMarker + 1, index))[0]
    const postContinuation = windowRefsFor(observations.slice(index + 1, nextMarker))[0]
    refs.push({
      kind: 'codex-context-compaction',
      marker_sequence: marker.source_frame.sequence,
      marker_frame: marker.source_frame,
      marker_event_hash: marker.source_frame.event_hash,
      ...(preWindow ? { pre_window: preWindow } : {}),
      ...(postContinuation ? { post_continuation: postContinuation } : {}),
      accepted_state_inferred: false,
    })
  }
  const lastRef = refs.at(-1)
  return {
    refs,
    ...(lastRef && !lastRef.post_continuation
      ? { pending: lastRef }
      : pending && observations.length === 0
        ? { pending }
        : {}),
  }
}

function isCompactionLine(line: CompleteLine): boolean {
  if (line.value.type === 'compacted') return true
  return (
    line.value.type === 'event_msg' && asRecord(line.value.payload)?.type === 'context_compacted'
  )
}

function validateOptions(options: CodexRolloutObservationSourceOptions): void {
  if (!options.path || !options.source_handle || !options.session_id || !options.runtime_id) {
    throw new Error('Codex rollout path, source_handle, session_id, and runtime_id are required')
  }
  if (!options.observer_ref || !options.subject_ref) {
    throw new Error('Codex rollout observer_ref and subject_ref are required')
  }
  const eventLimit = maxEventBytes(options)
  if (
    !Number.isSafeInteger(eventLimit) ||
    eventLimit <= 0 ||
    eventLimit > CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES
  ) {
    throw new Error('max_event_bytes must be within the Codex rollout hard ceiling')
  }
  const pollLimit = maxPollBytes(options)
  if (
    !Number.isSafeInteger(pollLimit) ||
    pollLimit < eventLimit + 2 ||
    pollLimit > CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES + 2
  ) {
    throw new Error('max_poll_bytes must cover one allowed event and stay within the hard ceiling')
  }
  const headerLimit = options.header_bytes ?? DEFAULT_HEADER_BYTES
  if (
    !Number.isSafeInteger(headerLimit) ||
    headerLimit <= 0 ||
    headerLimit > CODEX_ROLLOUT_EVENT_HARD_CEILING_BYTES
  ) {
    throw new Error('header_bytes must be a positive safe integer within the hard ceiling')
  }
  const backfillLimit = options.initial_backfill_bytes ?? 0
  if (!Number.isSafeInteger(backfillLimit) || backfillLimit < 0) {
    throw new Error('initial_backfill_bytes must be a non-negative safe integer')
  }
}

function validateCursor(
  cursor: CodexRolloutCursor,
  options: CodexRolloutObservationSourceOptions,
  source: RuntimeObservationSourceBinding,
): void {
  if (
    cursor.schema !== CODEX_ROLLOUT_CURSOR_SCHEMA ||
    cursor.source_ref !== source.source_ref ||
    cursor.generation_ref !== source.generation_ref ||
    cursor.session_id !== options.session_id ||
    cursor.runtime_id !== options.runtime_id ||
    cursor.observer_ref !== options.observer_ref ||
    cursor.subject_ref !== options.subject_ref ||
    cursor.subject_runtime_session_id !== options.session_id ||
    !['tail-only', 'bounded-backfill'].includes(cursor.history_completeness) ||
    !safeOffset(cursor.next_byte) ||
    !safeOffset(cursor.sequence) ||
    !validTimestamp(cursor.observed_at) ||
    (cursor.last_source_event_hash !== undefined && !isSha256Uri(cursor.last_source_event_hash)) ||
    !validLineAnchor(cursor.prior_line_anchor) ||
    !validPendingCompaction(cursor.pending_compaction) ||
    (cursor.pending_compaction !== undefined &&
      (cursor.pending_compaction.marker_sequence !== cursor.sequence ||
        cursor.pending_compaction.marker_frame.source_ref !== cursor.source_ref ||
        cursor.pending_compaction.marker_frame.generation_ref !== cursor.generation_ref ||
        cursor.pending_compaction.marker_frame.end_byte !== cursor.next_byte ||
        cursor.last_source_event_hash !== cursor.pending_compaction.marker_event_hash))
  ) {
    throw new Error('invalid Codex rollout cursor')
  }
}

function validLineAnchor(anchor: CodexRolloutLineAnchor | undefined): boolean {
  return (
    anchor === undefined ||
    (safeOffset(anchor.start_byte) &&
      safeOffset(anchor.end_byte) &&
      anchor.end_byte > anchor.start_byte &&
      isSha256Uri(anchor.event_hash) &&
      isSha256Uri(anchor.framed_event_hash))
  )
}

function validPendingCompaction(ref: CodexRolloutCompactionRef | undefined): boolean {
  return (
    ref === undefined ||
    (ref.kind === 'codex-context-compaction' &&
      safeOffset(ref.marker_sequence) &&
      validFrameRef(ref.marker_frame) &&
      ref.marker_frame.sequence === ref.marker_sequence &&
      isSha256Uri(ref.marker_event_hash) &&
      ref.marker_frame.event_hash === ref.marker_event_hash &&
      validWindowRef(ref.pre_window) &&
      ref.accepted_state_inferred === false &&
      ref.post_continuation === undefined)
  )
}

function validFrameRef(frame: CodexRolloutFrameRef): boolean {
  return (
    safeOffset(frame.sequence) &&
    safeOffset(frame.start_byte) &&
    safeOffset(frame.end_byte) &&
    frame.end_byte > frame.start_byte &&
    isSha256Uri(frame.event_hash) &&
    isSha256Uri(frame.framed_event_hash)
  )
}

function validWindowRef(ref: CodexRolloutWindowRef | undefined): boolean {
  return (
    ref === undefined ||
    (safeOffset(ref.start_sequence) &&
      safeOffset(ref.end_sequence) &&
      ref.end_sequence >= ref.start_sequence &&
      safeOffset(ref.start_byte) &&
      safeOffset(ref.end_byte) &&
      ref.end_byte > ref.start_byte &&
      isSha256Uri(ref.ordered_event_commitment))
  )
}

async function openRollout(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  const stat = await handle.stat()
  if (!stat.isFile()) {
    await handle.close()
    throw new Error('Codex rollout source must be a regular file')
  }
  return handle
}

async function positionalRead(
  handle: Awaited<ReturnType<typeof open>>,
  position: number,
  length: number,
): Promise<Buffer> {
  if (length === 0) return Buffer.alloc(0)
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

async function findLastNewline(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  searchLimit: number,
): Promise<number> {
  let end = size
  const floor = Math.max(0, size - searchLimit)
  while (end > floor) {
    const start = Math.max(floor, end - SEARCH_CHUNK_BYTES)
    const bytes = await positionalRead(handle, start, end - start)
    const index = bytes.lastIndexOf(0x0a)
    if (index >= 0) return start + index + 1
    end = start
  }
  if (size === 0) return 0
  throw new Error('no complete Codex rollout line within max_event_bytes of the tail')
}

async function anchorBefore(
  handle: Awaited<ReturnType<typeof open>>,
  endByte: number,
  eventLimit: number,
): Promise<CodexRolloutLineAnchor | undefined> {
  if (endByte === 0) return undefined
  const searchEnd = endByte - 1
  const startBoundary = await findPreviousNewline(handle, searchEnd, eventLimit + 1)
  const startByte = startBoundary ?? 0
  const framed = await positionalRead(handle, startByte, endByte - startByte)
  let eventBytes = framed.subarray(0, framed.length - 1)
  if (eventBytes.at(-1) === 0x0d) eventBytes = eventBytes.subarray(0, eventBytes.length - 1)
  if (eventBytes.length > eventLimit)
    throw new Error('Codex rollout anchor exceeds max_event_bytes')
  return {
    start_byte: startByte,
    end_byte: endByte,
    event_hash: eventHash(eventBytes),
    framed_event_hash: sha256Uri(framed),
  }
}

async function findPreviousNewline(
  handle: Awaited<ReturnType<typeof open>>,
  before: number,
  searchLimit: number,
): Promise<number | undefined> {
  let end = before
  const floor = Math.max(0, before - searchLimit)
  while (end > floor) {
    const start = Math.max(floor, end - SEARCH_CHUNK_BYTES)
    const bytes = await positionalRead(handle, start, end - start)
    const index = bytes.lastIndexOf(0x0a)
    if (index >= 0) return start + index + 1
    end = start
  }
  if (floor === 0) return undefined
  throw new Error('Codex rollout line exceeds max_event_bytes')
}

async function verifyAnchor(
  handle: Awaited<ReturnType<typeof open>>,
  anchor: CodexRolloutLineAnchor | undefined,
): Promise<boolean> {
  if (!anchor) return true
  const bytes = await positionalRead(handle, anchor.start_byte, anchor.end_byte - anchor.start_byte)
  if (bytes.length !== anchor.end_byte - anchor.start_byte || bytes.at(-1) !== 0x0a) {
    return false
  }
  let eventBytes = bytes.subarray(0, bytes.length - 1)
  if (eventBytes.at(-1) === 0x0d) eventBytes = eventBytes.subarray(0, eventBytes.length - 1)
  return (
    eventHash(eventBytes) === anchor.event_hash && sha256Uri(bytes) === anchor.framed_event_hash
  )
}

async function backfillBoundary(
  handle: Awaited<ReturnType<typeof open>>,
  endByte: number,
  backfillBytes: number,
): Promise<number> {
  const requestedStart = Math.max(0, endByte - backfillBytes)
  if (requestedStart === 0) return 0
  const bytes = await positionalRead(handle, requestedStart, endByte - requestedStart)
  const newline = bytes.indexOf(0x0a)
  return newline < 0 ? endByte : requestedStart + newline + 1
}

async function validateSessionIdentity(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  options: CodexRolloutObservationSourceOptions,
): Promise<void> {
  const filenameId = rolloutFilenameId(options.path)
  const header = await positionalRead(
    handle,
    0,
    Math.min(size, options.header_bytes ?? DEFAULT_HEADER_BYTES),
  )
  const complete = header.lastIndexOf(0x0a)
  const lines =
    complete >= 0
      ? splitCompleteLines(header.subarray(0, complete + 1), 0, 1, maxEventBytes(options)).lines
      : []
  const headerId = rolloutIdFromLines(lines)
  if (filenameId && headerId && filenameId !== headerId) {
    throw new Error(`Codex rollout filename id ${filenameId} conflicts with header id ${headerId}`)
  }
  const selectedId = headerId ?? filenameId
  if (!selectedId) {
    throw new Error('cannot validate Codex rollout from bounded header or filename')
  }
  if (selectedId !== options.session_id) {
    throw new Error(
      `selected Codex session ${options.session_id} does not match rollout id ${selectedId}`,
    )
  }
}

function rolloutFilenameId(path: string): string | undefined {
  return /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(
    basename(path),
  )?.[1]
}

function rolloutIdFromLines(lines: readonly CompleteLine[]): string | undefined {
  for (const line of lines) {
    if (line.value.type !== 'session_meta') continue
    const payload = asRecord(line.value.payload)
    const id = boundedString(payload?.id)
    if (id) return id
  }
  return undefined
}

function anchorFor(line: CompleteLine): CodexRolloutLineAnchor {
  return {
    start_byte: line.startByte,
    end_byte: line.endByte,
    event_hash: eventHash(line.eventBytes),
    framed_event_hash: sha256Uri(line.framedLine),
  }
}

function sourceRef(handle: string): string {
  return `codex-rollout:sha256:${sha256Hex(Buffer.from(`source:${handle}`))}`
}

function generationRef(
  handle: string,
  stat: { dev: number | bigint; ino: number | bigint },
): string {
  return `codex-generation:sha256:${sha256Hex(
    Buffer.from(`generation:${handle}:${String(stat.dev)}:${String(stat.ino)}`),
  )}`
}

function eventHash(value: Buffer): Sha256Uri {
  return sha256Uri(value)
}

function sha256Uri(value: Buffer): Sha256Uri {
  return `sha256:${sha256Hex(value)}`
}

function sha256Canonical(value: unknown): Sha256Uri {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('Codex rollout value is not JCS-serializable')
  return sha256Uri(Buffer.from(encoded))
}

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function maxEventBytes(options: CodexRolloutObservationSourceOptions): number {
  return options.max_event_bytes ?? DEFAULT_EVENT_BYTES
}

function maxPollBytes(options: CodexRolloutObservationSourceOptions): number {
  return options.max_poll_bytes ?? maxEventBytes(options) + 2
}

function safeOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isSha256Uri(value: string): value is Sha256Uri {
  return /^sha256:[0-9a-f]{64}$/.test(value)
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && Date.parse(value) >= 0
}

function isoNow(): string {
  return new Date().toISOString()
}

function boundedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 256) : undefined
}

function allowlistedEventType(value: unknown): string {
  const candidate = boundedString(value)
  return candidate &&
    ['compacted', 'event_msg', 'response_item', 'session_meta', 'turn_context'].includes(candidate)
    ? candidate
    : 'unknown'
}

function allowlistedPayloadType(value: unknown): string | undefined {
  const candidate = boundedString(value)
  return candidate &&
    [
      'agent_message',
      'context_compacted',
      'item_completed',
      'item_started',
      'task_complete',
      'task_started',
      'token_count',
      'turn_aborted',
      'user_message',
    ].includes(candidate)
    ? candidate
    : undefined
}

function allowlistedRole(value: unknown): string | undefined {
  const candidate = boundedString(value)
  return candidate && ['assistant', 'developer', 'system', 'tool', 'user'].includes(candidate)
    ? candidate
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
