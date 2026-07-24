// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { deriveNostrEventId, type NostrEvent } from '@atrib/verify'
import {
  BuzzObserverRuntimeLogSource,
  type BuzzObserverTelemetry,
} from '../../src/buzz-observer-runtime-log.js'

const agentSecret = new Uint8Array(32).fill(0x02)
const ownerSecret = new Uint8Array(32).fill(0x01)
const agentPubkey = bytesToHex(secp.schnorr.getPublicKey(agentSecret))
const ownerPubkey = bytesToHex(secp.schnorr.getPublicKey(ownerSecret))
const auxRand = new Uint8Array(32).fill(0x42)

async function observerEvent(
  seq: number,
): Promise<{ event: NostrEvent; telemetry: BuzzObserverTelemetry }> {
  const telemetry: BuzzObserverTelemetry = {
    seq,
    timestamp: `2026-07-24T12:00:0${seq}.000Z`,
    kind: seq === 1 ? 'turn_started' : seq === 3 ? 'session_resolved' : 'acp_write',
    agentIndex: 0,
    channelId: 'channel-1',
    sessionId: 'buzz-session-1',
    turnId: 'turn-1',
    payload: { phase: seq },
  }
  const unsigned = {
    pubkey: agentPubkey,
    created_at: 1_774_353_600 + seq,
    kind: 24_200,
    tags: [
      ['p', ownerPubkey],
      ['agent', agentPubkey],
      ['frame', 'telemetry'],
    ],
    content: `fixture-ciphertext-${seq}`,
  }
  const id = deriveNostrEventId(unsigned)
  const sig = bytesToHex(await secp.schnorr.signAsync(hexToBytes(id), agentSecret, auxRand))
  return { event: { ...unsigned, id, sig }, telemetry }
}

const fixtures = await Promise.all([1, 2, 3].map(observerEvent))
const captureDir = await mkdtemp(join(tmpdir(), 'atrib-buzz-observer-smoke-'))
const capturePath = join(captureDir, 'observer-events.jsonl')
await writeFile(
  capturePath,
  fixtures.map(({ event }) => JSON.stringify(event)).join('\n') + '\n',
  'utf8',
)
const telemetryByCiphertext = new Map(
  fixtures.map(({ event, telemetry }) => [event.content, telemetry]),
)
const source = new BuzzObserverRuntimeLogSource({
  path: capturePath,
  owner_pubkey: ownerPubkey,
  capture_id: 'buzz-observer-process-1',
  capture_kind: 'desktop-local-archive',
  decrypt(event) {
    const telemetry = telemetryByCiphertext.get(event.content)
    if (!telemetry) throw new Error('fixture ciphertext not found')
    return telemetry
  },
})
const bundle = await source.exportWindow({
  session_id: 'buzz-observer-process-1',
  start: 1,
  end: 3,
})

process.stdout.write(
  `${JSON.stringify({
    ok: bundle.verification.valid && bundle.sequence_audit.sequence_complete,
    strategy: 'buzz-observer-runtime-log-v0',
    manifest_hash: bundle.verification.manifest_hash,
    event_count: bundle.manifest.event_count,
    source: bundle.manifest.source,
    window: bundle.manifest.window,
    sequence: bundle.sequence_audit,
    checks: bundle.verification.checks,
    privacy: {
      raw_events: 'host-owned',
      decrypted_payloads: 'local-only',
      public_manifest: 'hashes-and-refs',
    },
    claims_not_made: [
      'relay_admission',
      'relay_persistence',
      'audit_inclusion',
      'tool_execution',
      'result_truth',
    ],
  })}\n`,
)
