// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { RuntimeLogPosition, RuntimeLogRuntimeRef, Sha256Uri } from './index.js'

export const RUNTIME_OBSERVATION_BATCH_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/observation-batch/v0' as const

export type RuntimeObservationHistoryCompleteness = 'tail-only' | 'bounded-backfill' | 'continuous'

export type RuntimeObservationParsingStatus = 'ok' | 'degraded' | 'blocked'

export interface RuntimeObservationAdapterProfile {
  readonly id: string
  readonly version: string
}

export interface RuntimeObservationSourceBinding {
  readonly source_ref: string
  readonly generation_ref: string
  readonly runtime: RuntimeLogRuntimeRef
  readonly session_id: string
}

export interface RuntimeObservationFrameRef {
  readonly source_ref: string
  readonly generation_ref: string
  readonly sequence: number
  readonly position?: RuntimeLogPosition
  readonly event_hash: Sha256Uri
  readonly framed_event_hash: Sha256Uri
}

export interface RuntimeObservationClaim {
  readonly schema: string
  readonly observation_id: Sha256Uri
  readonly kind: string
  readonly observer_ref: string
  readonly subject_ref: string
  readonly subject_runtime_session_id: string
  readonly observed_at: string
  readonly source_occurred_at?: string
  readonly source_frame: RuntimeObservationFrameRef
  readonly capture_mode: 'attach-native'
  readonly evidence_grade: 'runtime-captured'
  readonly execution_evidence: false
  readonly semantic_state: 'not-inferred'
}

export interface RuntimeObservationCoverage {
  readonly history_completeness: RuntimeObservationHistoryCompleteness
  readonly parsing_status: RuntimeObservationParsingStatus
  readonly complete_event_count: number
  readonly complete_window_eligible: boolean
}

export interface RuntimeObservationGap {
  readonly kind: string
  readonly position?: RuntimeLogPosition
}

export interface RuntimeObservationClaimBoundary {
  readonly runtime_telemetry: 'host-observed'
  readonly execution: 'not-established'
  readonly capture_completeness: 'coverage-reported'
  readonly runtime_vendor_provenance: 'not-established'
  readonly accepted_state: 'not-inferred'
  readonly effect_outcome: 'not-established'
}

export const RUNTIME_OBSERVATION_CLAIM_BOUNDARY = {
  runtime_telemetry: 'host-observed',
  execution: 'not-established',
  capture_completeness: 'coverage-reported',
  runtime_vendor_provenance: 'not-established',
  accepted_state: 'not-inferred',
  effect_outcome: 'not-established',
} as const satisfies RuntimeObservationClaimBoundary

export interface RuntimeObservationBatch<
  Cursor extends object,
  Observation extends RuntimeObservationClaim,
  Coverage extends RuntimeObservationCoverage,
  Gap extends RuntimeObservationGap,
  ProfileData extends object = Record<string, never>,
> {
  readonly schema: typeof RUNTIME_OBSERVATION_BATCH_SCHEMA
  readonly batch_id: string
  readonly adapter: RuntimeObservationAdapterProfile
  readonly source: RuntimeObservationSourceBinding
  readonly status: 'ok' | 'gap'
  readonly expected_cursor: Cursor
  readonly proposed_cursor: Cursor
  readonly observations: readonly Observation[]
  readonly coverage: Coverage
  readonly gaps: readonly Gap[]
  readonly observed_at: string
  readonly claim_boundary: RuntimeObservationClaimBoundary
  readonly profile_data?: ProfileData
}

export type RuntimeObservationBatchInput<
  Cursor extends object,
  Observation extends RuntimeObservationClaim,
  Coverage extends RuntimeObservationCoverage,
  Gap extends RuntimeObservationGap,
  ProfileData extends object = Record<string, never>,
> = Omit<
  RuntimeObservationBatch<Cursor, Observation, Coverage, Gap, ProfileData>,
  'schema' | 'batch_id' | 'claim_boundary'
>

export interface RuntimeObservationAdapter<
  Cursor extends object,
  Observation extends RuntimeObservationClaim,
  Coverage extends RuntimeObservationCoverage,
  Gap extends RuntimeObservationGap,
  ProfileData extends object = Record<string, never>,
> {
  readonly profile: RuntimeObservationAdapterProfile
  readonly source: RuntimeObservationSourceBinding
  readBatch(
    expectedCursor: Cursor,
  ): Promise<RuntimeObservationBatch<Cursor, Observation, Coverage, Gap, ProfileData>>
}

export interface RuntimeObservationTransitionIssue {
  readonly code:
    | 'batch_id_mismatch'
    | 'authoritative_cursor_mismatch'
    | 'source_binding_mismatch'
    | 'observation_count_mismatch'
    | 'observation_claim_mismatch'
    | 'claim_boundary_mismatch'
    | 'duplicate_observation_id'
    | 'blocked_cursor_advanced'
    | 'gap_status_mismatch'
    | 'non_portable_value'
  readonly message: string
}

export interface RuntimeObservationTransitionResult {
  readonly valid: boolean
  readonly issues: readonly RuntimeObservationTransitionIssue[]
}

export function createRuntimeObservationBatch<
  Cursor extends object,
  Observation extends RuntimeObservationClaim,
  Coverage extends RuntimeObservationCoverage,
  Gap extends RuntimeObservationGap,
  ProfileData extends object = Record<string, never>,
>(
  input: RuntimeObservationBatchInput<Cursor, Observation, Coverage, Gap, ProfileData>,
): RuntimeObservationBatch<Cursor, Observation, Coverage, Gap, ProfileData> {
  const withoutId = {
    schema: RUNTIME_OBSERVATION_BATCH_SCHEMA,
    ...input,
    claim_boundary: RUNTIME_OBSERVATION_CLAIM_BOUNDARY,
  }
  assertPortableObservationValue(withoutId)
  return {
    ...withoutId,
    batch_id: observationBatchId(withoutId),
  }
}

export function verifyRuntimeObservationBatchTransition<
  Cursor extends object,
  Observation extends RuntimeObservationClaim,
  Coverage extends RuntimeObservationCoverage,
  Gap extends RuntimeObservationGap,
  ProfileData extends object,
>(
  batch: RuntimeObservationBatch<Cursor, Observation, Coverage, Gap, ProfileData>,
  authoritativeCursor: Cursor,
): RuntimeObservationTransitionResult {
  const issues: RuntimeObservationTransitionIssue[] = []
  const add = (code: RuntimeObservationTransitionIssue['code'], message: string): void => {
    issues.push({ code, message })
  }

  const { batch_id: _batchId, ...withoutId } = batch
  if (batch.batch_id !== observationBatchId(withoutId)) {
    add('batch_id_mismatch', 'batch_id does not commit to the complete observation batch')
  }
  if (canonicalJson(batch.expected_cursor) !== canonicalJson(authoritativeCursor)) {
    add(
      'authoritative_cursor_mismatch',
      'expected_cursor does not match the caller-supplied authoritative cursor',
    )
  }
  if (batch.coverage.complete_event_count !== batch.observations.length) {
    add(
      'observation_count_mismatch',
      'coverage.complete_event_count does not match observations.length',
    )
  }
  if (canonicalJson(batch.claim_boundary) !== canonicalJson(RUNTIME_OBSERVATION_CLAIM_BOUNDARY)) {
    add('claim_boundary_mismatch', 'batch claim_boundary exceeds the observation contract')
  }
  if (
    batch.coverage.parsing_status === 'blocked' &&
    canonicalJson(batch.expected_cursor) !== canonicalJson(batch.proposed_cursor)
  ) {
    add('blocked_cursor_advanced', 'a blocked batch cannot advance its cursor')
  }
  if (
    (batch.status === 'gap' && batch.gaps.length === 0) ||
    (batch.status === 'ok' && batch.gaps.some((gap) => gap.kind !== 'partial-tail'))
  ) {
    add('gap_status_mismatch', 'batch status does not match its reported gaps')
  }

  const observationIds = new Set<string>()
  for (const observation of batch.observations) {
    if (observationIds.has(observation.observation_id)) {
      add(
        'duplicate_observation_id',
        `observation ${observation.observation_id} appears more than once`,
      )
    }
    observationIds.add(observation.observation_id)
    if (
      observation.source_frame.source_ref !== batch.source.source_ref ||
      observation.source_frame.generation_ref !== batch.source.generation_ref ||
      observation.subject_runtime_session_id !== batch.source.session_id
    ) {
      add(
        'source_binding_mismatch',
        `observation ${observation.observation_id} does not match the batch source`,
      )
    }
    if (
      observation.capture_mode !== 'attach-native' ||
      observation.evidence_grade !== 'runtime-captured' ||
      observation.execution_evidence !== false ||
      observation.semantic_state !== 'not-inferred'
    ) {
      add(
        'observation_claim_mismatch',
        `observation ${observation.observation_id} exceeds the observation claim boundary`,
      )
    }
  }

  try {
    assertPortableObservationValue(batch)
  } catch (error) {
    add('non_portable_value', error instanceof Error ? error.message : String(error))
  }
  return { valid: issues.length === 0, issues }
}

export function assertPortableObservationValue(value: unknown): void {
  const visit = (item: unknown, key = ''): void => {
    if (typeof item === 'string') {
      if (item.startsWith('/') || /^[A-Za-z]:[\\/]/.test(item) || item.startsWith('file://')) {
        throw new Error('portable runtime observation cannot contain an absolute path')
      }
      return
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry, key)
      return
    }
    if (!isRecord(item)) return
    for (const [childKey, child] of Object.entries(item)) {
      if (
        [
          'path',
          'rollout_path',
          'cursor_path',
          'raw',
          'raw_body',
          'body',
          'device',
          'inode',
        ].includes(childKey)
      ) {
        throw new Error(`portable runtime observation cannot contain ${childKey}`)
      }
      visit(child, childKey)
    }
  }
  visit(value)
}

function observationBatchId(value: unknown): string {
  return `observation-batch:sha256:${bytesToHex(nobleSha256(new TextEncoder().encode(canonicalJson(value))))}`
}

function canonicalJson(value: unknown): string {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('runtime observation value is not JCS-serializable')
  return encoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
