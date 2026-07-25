// SPDX-License-Identifier: Apache-2.0

import * as secp from '@noble/secp256k1'
import { describe, expect, it } from 'vitest'
import { deriveNostrEventId, type NostrEvent } from '@atrib/verify'
import { BuzzObserverRuntimeLogSource, type BuzzObserverTelemetry } from '@atrib/runtime-log/buzz'
import { hashLogWindowManifest } from '@atrib/runtime-log'
import {
  buildBuzzRuntimeObservation,
  buildBuzzSemanticPromotion,
  parseBuzzRuntimeObservation,
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
