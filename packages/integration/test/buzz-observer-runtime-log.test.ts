// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import { deriveNostrEventId, type NostrEvent } from '@atrib/verify'
import {
  BUZZ_OBSERVER_SEQUENCE_PROJECTION,
  BuzzObserverRuntimeLogSource,
  type BuzzObserverTelemetry,
} from '../src/buzz-observer-runtime-log.js'

const AGENT_SECRET = new Uint8Array(32).fill(0x02)
const OWNER_SECRET = new Uint8Array(32).fill(0x01)
const AGENT_PUBKEY = bytesToHex(secp.schnorr.getPublicKey(AGENT_SECRET))
const OWNER_PUBKEY = bytesToHex(secp.schnorr.getPublicKey(OWNER_SECRET))
const AUX_RAND = new Uint8Array(32).fill(0x42)

interface ObserverFixture {
  readonly event: NostrEvent
  readonly telemetry: BuzzObserverTelemetry
}

async function fixtureFrame(seq: number, sessionId = 'buzz-session-1'): Promise<ObserverFixture> {
  const telemetry: BuzzObserverTelemetry = {
    seq,
    timestamp: `2026-07-24T12:00:0${seq}.000Z`,
    kind: seq === 1 ? 'turn_started' : seq === 3 ? 'session_resolved' : 'acp_write',
    agentIndex: 0,
    channelId: 'channel-1',
    sessionId,
    turnId: 'turn-1',
    payload: { method: seq === 2 ? 'session/prompt' : 'lifecycle' },
  }
  const unsigned = {
    pubkey: AGENT_PUBKEY,
    created_at: 1_774_353_600 + seq,
    kind: 24_200,
    tags: [
      ['p', OWNER_PUBKEY],
      ['agent', AGENT_PUBKEY],
      ['frame', 'telemetry'],
    ],
    content: `ciphertext-${seq}`,
  }
  const id = deriveNostrEventId(unsigned)
  const sig = bytesToHex(await secp.schnorr.signAsync(hexToBytes(id), AGENT_SECRET, AUX_RAND))
  return { event: { ...unsigned, id, sig }, telemetry }
}

async function fixtureSource(
  name: string,
  sequence: readonly (number | readonly [number, string])[],
  sequencePolicy: 'require-contiguous' | 'report-gaps' = 'require-contiguous',
): Promise<BuzzObserverRuntimeLogSource> {
  const fixtures = await Promise.all(
    sequence.map((entry) =>
      Array.isArray(entry) ? fixtureFrame(entry[0]!, entry[1]!) : fixtureFrame(entry as number),
    ),
  )
  const dir = await mkdtemp(join(tmpdir(), `atrib-buzz-observer-${name}-`))
  const path = join(dir, 'observer-events.jsonl')
  await writeFile(
    path,
    fixtures.map(({ event }) => JSON.stringify(event)).join('\n') + '\n',
    'utf8',
  )
  const telemetryByCiphertext = new Map(
    fixtures.map(({ event, telemetry }) => [event.content, telemetry]),
  )
  return new BuzzObserverRuntimeLogSource({
    path,
    owner_pubkey: OWNER_PUBKEY,
    capture_id: 'buzz-observer-process-1',
    capture_kind: 'desktop-local-archive',
    sequence_policy: sequencePolicy,
    decrypt(event) {
      const telemetry = telemetryByCiphertext.get(event.content)
      if (!telemetry) throw new Error('fixture ciphertext not found')
      return telemetry
    },
  })
}

describe('Buzz observer runtime-log source', () => {
  it('manifests a contiguous signed observer window without publishing bodies', async () => {
    const source = await fixtureSource('complete', [1, 2, 3])
    const bundle = await source.exportWindow({
      session_id: 'buzz-observer-process-1',
      start: 1,
      end: 3,
    })

    expect(bundle.verification.valid).toBe(true)
    expect(bundle.sequence_audit).toMatchObject({
      sequence_complete: true,
      sequence_scope: 'process-local',
      duplicate_seq: [],
      duplicate_event_ids: [],
      out_of_order: [],
      missing_ranges: [],
      basis: 'complete-captured-window',
    })
    expect(bundle.manifest.projections?.[0]?.name).toBe(BUZZ_OBSERVER_SEQUENCE_PROJECTION)
    expect(bundle.frames.every((frame) => frame.event_verification.valid)).toBe(true)
    const publicManifest = JSON.stringify(bundle.manifest)
    expect(publicManifest).not.toContain('ciphertext-')
    expect(publicManifest).not.toContain('session/prompt')
  })

  it('fails closed on a missing observer sequence by default', async () => {
    const source = await fixtureSource('strict-gap', [1, 3])
    await expect(
      source.exportWindow({
        session_id: 'buzz-observer-process-1',
        start: 1,
        end: 3,
      }),
    ).rejects.toThrow('sequence_gap')
  })

  it('can commit an incomplete capture without claiming sequence completeness', async () => {
    const source = await fixtureSource('reported-gap', [1, 3], 'report-gaps')
    const bundle = await source.exportWindow({
      session_id: 'buzz-observer-process-1',
      start: 1,
      end: 3,
    })

    expect(bundle.verification.valid).toBe(true)
    expect(bundle.sequence_audit).toMatchObject({
      sequence_complete: false,
      missing_ranges: [{ start: 2, end: 2 }],
      basis: 'incomplete-captured-window',
    })
  })

  it('detects out-of-order capture even when logical event refs can be sorted', async () => {
    const source = await fixtureSource('out-of-order', [1, 3, 2], 'report-gaps')
    const bundle = await source.exportWindow({
      session_id: 'buzz-observer-process-1',
      start: 1,
      end: 3,
    })

    expect(bundle.verification.valid).toBe(true)
    expect(bundle.events.map((event) => event.position)).toEqual([1, 2, 3])
    expect(bundle.sequence_audit.sequence_complete).toBe(false)
    expect(bundle.sequence_audit.out_of_order).toEqual([
      { previous: 3, current: 2, capture_line: 3 },
    ])
  })

  it('does not misclassify an interleaved ACP session as a capture gap', async () => {
    const source = await fixtureSource('interleaved', [
      [1, 'buzz-session-1'],
      [2, 'buzz-session-2'],
      [3, 'buzz-session-1'],
    ])
    const bundle = await source.exportWindow({
      session_id: 'buzz-observer-process-1',
      start: 1,
      end: 3,
    })

    expect(bundle.sequence_audit.sequence_complete).toBe(true)
    expect(bundle.frames.map((frame) => frame.telemetry.sessionId)).toEqual([
      'buzz-session-1',
      'buzz-session-2',
      'buzz-session-1',
    ])
  })

  it('rejects a validly signed frame addressed to a different owner', async () => {
    const fixture = await fixtureFrame(1)
    const dir = await mkdtemp(join(tmpdir(), 'atrib-buzz-observer-owner-'))
    const path = join(dir, 'observer-events.jsonl')
    await writeFile(path, JSON.stringify(fixture.event) + '\n', 'utf8')
    const source = new BuzzObserverRuntimeLogSource({
      path,
      owner_pubkey: '03'.repeat(32),
      decrypt: () => fixture.telemetry,
    })

    await expect(source.readFrames()).rejects.toThrow(
      'observer frame recipient does not match owner',
    )
  })
})
