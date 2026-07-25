// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  createRuntimeObservationBatch,
  verifyRuntimeObservationBatchTransition,
  type RuntimeObservationClaim,
  type RuntimeObservationCoverage,
  type RuntimeObservationGap,
} from '../src/observation.js'

interface Cursor {
  readonly source_ref: string
  readonly generation_ref: string
  readonly sequence: number
}

const SOURCE = {
  source_ref: 'fixture:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  generation_ref:
    'fixture-generation:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  runtime: { name: 'fixture', version: '1' },
  session_id: 'session-1',
}

const CURSOR: Cursor = {
  source_ref: SOURCE.source_ref,
  generation_ref: SOURCE.generation_ref,
  sequence: 0,
}

const OBSERVATION: RuntimeObservationClaim = {
  schema: 'fixture.observation.v1',
  observation_id: `sha256:${'c'.repeat(64)}`,
  kind: 'fixture_event',
  observer_ref: 'host:observer',
  subject_ref: 'runtime:fixture',
  subject_runtime_session_id: 'session-1',
  observed_at: '2026-07-25T12:00:00.000Z',
  source_frame: {
    source_ref: SOURCE.source_ref,
    generation_ref: SOURCE.generation_ref,
    sequence: 1,
    event_hash: `sha256:${'d'.repeat(64)}`,
    framed_event_hash: `sha256:${'e'.repeat(64)}`,
  },
  capture_mode: 'attach-native',
  evidence_grade: 'runtime-captured',
  execution_evidence: false,
  semantic_state: 'not-inferred',
}

const COVERAGE: RuntimeObservationCoverage = {
  history_completeness: 'continuous',
  parsing_status: 'ok',
  complete_event_count: 1,
  complete_window_eligible: true,
}

describe('runtime observation adapter contract', () => {
  it('binds a batch to an authoritative cursor without promoting observation claims', () => {
    const batch = createRuntimeObservationBatch<
      Cursor,
      RuntimeObservationClaim,
      RuntimeObservationCoverage,
      RuntimeObservationGap
    >({
      adapter: { id: 'fixture', version: '1' },
      source: SOURCE,
      status: 'ok',
      expected_cursor: CURSOR,
      proposed_cursor: { ...CURSOR, sequence: 1 },
      observations: [OBSERVATION],
      coverage: COVERAGE,
      gaps: [],
      observed_at: '2026-07-25T12:00:00.000Z',
    })

    expect(verifyRuntimeObservationBatchTransition(batch, CURSOR)).toEqual({
      valid: true,
      issues: [],
    })
    expect(batch.claim_boundary).toEqual({
      runtime_telemetry: 'host-observed',
      execution: 'not-established',
      capture_completeness: 'coverage-reported',
      runtime_vendor_provenance: 'not-established',
      accepted_state: 'not-inferred',
      effect_outcome: 'not-established',
    })
  })

  it('rejects cursor-before-commit and semantic promotion attempts', () => {
    const batch = createRuntimeObservationBatch({
      adapter: { id: 'fixture', version: '1' },
      source: SOURCE,
      status: 'ok' as const,
      expected_cursor: CURSOR,
      proposed_cursor: { ...CURSOR, sequence: 1 },
      observations: [OBSERVATION],
      coverage: COVERAGE,
      gaps: [] as RuntimeObservationGap[],
      observed_at: '2026-07-25T12:00:00.000Z',
    })
    const tampered = {
      ...batch,
      observations: [{ ...OBSERVATION, semantic_state: 'accepted' }],
    } as unknown as typeof batch

    const result = verifyRuntimeObservationBatchTransition(tampered, {
      ...CURSOR,
      sequence: 1,
    })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'batch_id_mismatch',
        'authoritative_cursor_mismatch',
        'observation_claim_mismatch',
      ]),
    )
  })

  it('rejects claim-boundary changes and duplicate observations', () => {
    const batch = createRuntimeObservationBatch({
      adapter: { id: 'fixture', version: '1' },
      source: SOURCE,
      status: 'ok' as const,
      expected_cursor: CURSOR,
      proposed_cursor: { ...CURSOR, sequence: 2 },
      observations: [OBSERVATION, OBSERVATION],
      coverage: { ...COVERAGE, complete_event_count: 2 },
      gaps: [] as RuntimeObservationGap[],
      observed_at: '2026-07-25T12:00:00.000Z',
    })
    const tampered = {
      ...batch,
      claim_boundary: { ...batch.claim_boundary, execution: 'established' },
    } as unknown as typeof batch

    const result = verifyRuntimeObservationBatchTransition(tampered, CURSOR)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'batch_id_mismatch',
        'claim_boundary_mismatch',
        'duplicate_observation_id',
      ]),
    )
  })

  it('rejects local paths from portable observation state', () => {
    expect(() =>
      createRuntimeObservationBatch({
        adapter: { id: 'fixture', version: '1' },
        source: SOURCE,
        status: 'ok' as const,
        expected_cursor: CURSOR,
        proposed_cursor: CURSOR,
        observations: [] as RuntimeObservationClaim[],
        coverage: { ...COVERAGE, complete_event_count: 0 },
        gaps: [] as RuntimeObservationGap[],
        observed_at: '2026-07-25T12:00:00.000Z',
        profile_data: { path: '/private/session.jsonl' },
      }),
    ).toThrow('portable runtime observation cannot contain path')
  })
})
