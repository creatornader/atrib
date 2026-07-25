// SPDX-License-Identifier: Apache-2.0

import * as secp from '@noble/secp256k1'
import { describe, expect, it } from 'vitest'
import { deriveNostrEventId, type NostrEvent } from '@atrib/verify'
import { BuzzObserverRuntimeLogSource, type BuzzObserverTelemetry } from '@atrib/runtime-log/buzz'
import { hashLogWindowManifest } from '@atrib/runtime-log'
import { createRuntimeObservationBatch } from '@atrib/runtime-log/observation'
import {
  buildBuzzRuntimeObservation,
  buildBuzzSemanticPromotion,
  buildRuntimeObservation,
  buildRuntimeSemanticPromotion,
  parseBuzzRuntimeObservation,
  parseRuntimeObservation,
} from '../src/observations.js'
import { OPERATING_EVENT_SCHEMA, type OperatingEvent } from '../src/model.js'

const AGENT_SECRET = new Uint8Array(32).fill(0x02)
const OWNER_SECRET = new Uint8Array(32).fill(0x01)
const AGENT_PUBKEY = Buffer.from(secp.schnorr.getPublicKey(AGENT_SECRET)).toString('hex')
const OWNER_PUBKEY = Buffer.from(secp.schnorr.getPublicKey(OWNER_SECRET)).toString('hex')
const AUX_RAND = new Uint8Array(32).fill(0x42)

interface ObserverFixture {
  readonly event: NostrEvent
  readonly telemetry: BuzzObserverTelemetry
}

async function fixtureFrame(seq: number): Promise<ObserverFixture> {
  const telemetry: BuzzObserverTelemetry = {
    seq,
    timestamp: `2026-07-25T12:00:0${seq}.000Z`,
    kind: seq === 1 ? 'turn_started' : 'tool_result',
    agentIndex: 0,
    channelId: 'channel-1',
    sessionId: 'buzz-session-1',
    turnId: 'turn-1',
    startedAt: '2026-07-25T12:00:00.000Z',
    payload: { result: 'the observer reported success' },
  }
  const unsigned = {
    pubkey: AGENT_PUBKEY,
    created_at: 1_753_444_000 + seq,
    kind: 24_200,
    tags: [
      ['p', OWNER_PUBKEY],
      ['agent', AGENT_PUBKEY],
      ['frame', 'telemetry'],
    ],
    content: `ciphertext-${seq}`,
  }
  const id = deriveNostrEventId(unsigned)
  const sig = Buffer.from(
    await secp.schnorr.signAsync(Uint8Array.from(Buffer.from(id, 'hex')), AGENT_SECRET, AUX_RAND),
  ).toString('hex')
  return { event: { ...unsigned, id, sig }, telemetry }
}

async function fixtureSource(): Promise<BuzzObserverRuntimeLogSource> {
  const fixtures = await Promise.all([1, 3].map((seq) => fixtureFrame(seq)))
  const telemetry = new Map(fixtures.map((fixture) => [fixture.event.content, fixture.telemetry]))
  return new BuzzObserverRuntimeLogSource({
    load_events: () => fixtures.map((fixture) => fixture.event),
    owner_pubkey: OWNER_PUBKEY,
    capture_id: 'buzz-observer-process-1',
    sequence_policy: 'report-gaps',
    decrypt(event) {
      const value = telemetry.get(event.content)
      if (!value) throw new Error('fixture ciphertext not found')
      return value
    },
  })
}

describe('Buzz runtime observations', () => {
  it('builds a bounded observer body without promoting telemetry to semantic state', async () => {
    const source = await fixtureSource()
    const mapping = {
      workspace: { id: 'workspace-1', name: 'Apollo' },
      task: { id: 'task-1', name: 'Review runtime capture' },
      team: { id: 'team-1', name: 'Protocol' },
      mapped_agent: { id: 'application-agent', name: 'Application agent', role: 'reviewer' },
    }
    const request = { session_id: 'buzz-observer-process-1', start: 1, end: 3 }
    const [observation, bundle] = await Promise.all([
      buildBuzzRuntimeObservation(source, request, mapping),
      source.exportWindow(request),
    ])

    expect(observation.runtime_window.runtime_window_hash).toBe(
      hashLogWindowManifest(bundle.manifest),
    )
    expect(observation).toMatchObject({
      workspace: mapping.workspace,
      task: mapping.task,
      team: mapping.team,
      mapped_agent: mapping.mapped_agent,
      source: {
        owner_pubkey: OWNER_PUBKEY,
        observed_agent_pubkeys: [AGENT_PUBKEY],
        capture_id: 'buzz-observer-process-1',
      },
      coverage: {
        bounded_to_capture: true,
        sequence_complete: false,
        missing_ranges: [{ start: 2, end: 2 }],
      },
      trust: {
        recipient_owner_binding: 'verified-by-observer-adapter',
        owner_authorization: 'not-asserted',
        runtime_execution: 'observer-telemetry-only',
        result_truth: 'not-claimed',
      },
      execution_evidence: false,
      semantic_effects: {
        accepted_state: false,
        decision: false,
        outcome: false,
        handoff: false,
        resolution: false,
      },
      raw_payloads: 'omitted',
    })
    expect(JSON.stringify(observation)).not.toContain('the observer reported success')
    expect(parseBuzzRuntimeObservation(observation)).toEqual(observation)
    expect(parseBuzzRuntimeObservation({ ...observation, result: 'approved' })).toBeNull()
    expect(parseBuzzRuntimeObservation({ ...observation, task: null })).toBeNull()
    expect(
      parseBuzzRuntimeObservation({ ...observation, team: { id: '', name: 'Invalid' } }),
    ).toBeNull()
    expect(
      parseBuzzRuntimeObservation({
        ...observation,
        mapped_agent: { ...mapping.mapped_agent, role: '' },
      }),
    ).toBeNull()
  })

  it('rejects an invalid application placement before the host signs it', async () => {
    const source = await fixtureSource()
    await expect(
      buildBuzzRuntimeObservation(
        source,
        { session_id: 'buzz-observer-process-1', start: 1, end: 3 },
        {
          workspace: { id: '', name: 'Missing id' },
        },
      ),
    ).rejects.toThrow('Buzz observation mapping is invalid')
  })

  it('requires a signed application event to cite the observed record for promotion', () => {
    const event: OperatingEvent = {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'decision',
      workspace: { id: 'workspace-1', name: 'Apollo' },
      subject: 'deployment',
      value: 'approved by application policy',
    }
    const sourceObservation = `sha256:${'a'.repeat(64)}`
    expect(buildBuzzSemanticPromotion(sourceObservation, event)).toEqual({
      event: { ...event, source_observation: sourceObservation },
      informed_by: [sourceObservation],
    })
  })
})

describe('source-neutral runtime observations', () => {
  const cursor = { byte_offset: 0 }
  const mapping = {
    workspace: { id: 'workspace-1', name: 'Apollo' },
    task: { id: 'task-1', name: 'Review runtime capture' },
    team: { id: 'team-1', name: 'Protocol' },
    mapped_agent: { id: 'codex-agent', name: 'Codex', role: 'builder' },
  }
  const batch = createRuntimeObservationBatch({
    adapter: { id: 'codex-rollout-jsonl', version: '1' },
    source: {
      source_ref: `sha256:${'1'.repeat(64)}`,
      generation_ref: `sha256:${'2'.repeat(64)}`,
      runtime: { name: 'Codex', version: 'host-observed', environment: 'local' },
      session_id: '019f6a03-db2d-7040-ab13-0034852163eb',
    },
    status: 'ok',
    expected_cursor: cursor,
    proposed_cursor: { byte_offset: 128 },
    observations: [
      {
        schema: 'atrib.runtime-observation.codex-rollout.v1',
        observation_id: `sha256:${'3'.repeat(64)}`,
        kind: 'response_item',
        observer_ref: 'host:runtime-observer',
        subject_ref: 'runtime:codex',
        subject_runtime_session_id: '019f6a03-db2d-7040-ab13-0034852163eb',
        observed_at: '2026-07-25T12:00:01.000Z',
        source_occurred_at: '2026-07-25T12:00:00.000Z',
        source_frame: {
          source_ref: `sha256:${'1'.repeat(64)}`,
          generation_ref: `sha256:${'2'.repeat(64)}`,
          sequence: 1,
          event_hash: `sha256:${'4'.repeat(64)}`,
          framed_event_hash: `sha256:${'5'.repeat(64)}`,
        },
        capture_mode: 'attach-native',
        evidence_grade: 'runtime-captured',
        execution_evidence: false,
        semantic_state: 'not-inferred',
      },
    ],
    coverage: {
      history_completeness: 'bounded-backfill',
      parsing_status: 'ok',
      complete_event_count: 1,
      complete_window_eligible: true,
    },
    gaps: [],
    observed_at: '2026-07-25T12:00:01.000Z',
    profile_data: { compaction_count: 0 },
  })

  it('places a verified batch without copying transcript observations into the signed body', () => {
    const observation = buildRuntimeObservation(batch, cursor, mapping)

    expect(observation).toMatchObject({
      workspace: mapping.workspace,
      task: mapping.task,
      team: mapping.team,
      mapped_agent: mapping.mapped_agent,
      source: {
        adapter_id: 'codex-rollout-jsonl',
        source_ref: batch.source.source_ref,
        session_id: batch.source.session_id,
      },
      batch: {
        batch_id: batch.batch_id,
        observation_count: 1,
        history_completeness: 'bounded-backfill',
        parsing_status: 'ok',
        gap_kinds: [],
      },
      claim_boundary: {
        runtime_telemetry: 'host-observed',
        execution: 'not-established',
        accepted_state: 'not-inferred',
        effect_outcome: 'not-established',
      },
      execution_evidence: false,
      raw_observations: 'omitted',
    })
    expect(JSON.stringify(observation)).not.toContain(batch.observations[0]!.observation_id)
    expect(parseRuntimeObservation(observation)).toEqual(observation)
    expect(parseRuntimeObservation({ ...observation, execution_evidence: true })).toBeNull()
    expect(parseRuntimeObservation({ ...observation, observations: [] })).toBeNull()
  })

  it('rejects a batch that does not begin at the authoritative cursor', () => {
    expect(() => buildRuntimeObservation(batch, { byte_offset: 64 }, mapping)).toThrow(
      'authoritative_cursor_mismatch',
    )
  })

  it('uses the same explicit signed-promotion contract for every runtime source', () => {
    const event: OperatingEvent = {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'accepted_state',
      workspace: mapping.workspace,
      task: mapping.task,
      team: mapping.team,
      agent: mapping.mapped_agent,
      subject: 'task-status',
      value: { state: 'reviewed' },
    }
    const sourceObservation = `sha256:${'a'.repeat(64)}`
    expect(buildRuntimeSemanticPromotion(sourceObservation, event)).toEqual({
      event: { ...event, source_observation: sourceObservation },
      informed_by: [sourceObservation],
    })
  })
})
