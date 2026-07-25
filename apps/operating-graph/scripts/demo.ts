// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as secp from '@noble/secp256k1'
import {
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  createJsonCommitment,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { BuzzObserverRuntimeLogSource, type BuzzObserverTelemetry } from '@atrib/runtime-log/buzz'
import { deriveNostrEventId, type NostrEvent } from '@atrib/verify'
import { OPERATING_EVENT_SCHEMA, type OperatingEvent } from '../src/model.js'
import { buildBuzzRuntimeObservation, type BuzzRuntimeObservation } from '../src/observations.js'
import { startOperatingGraphServer } from '../src/server.js'

const directory = mkdtempSync(join(tmpdir(), 'atrib-operating-demo-'))
const mirrorFile = join(directory, 'demo.jsonl')
const workspace = { id: 'workspace-apollo', name: 'Apollo' }
const task = { id: 'task-reference-client', name: 'Ship reference client' }
const team = { id: 'team-protocol', name: 'Protocol' }
const alice = { id: 'agent-alice', name: 'Alice', role: 'builder' }
const bob = { id: 'agent-bob', name: 'Bob', role: 'reviewer' }
const contextId = 'd'.repeat(32)
const rows: string[] = []
let chainRoot = genesisChainRoot(contextId)

async function append(
  seedByte: number,
  event: OperatingEvent | BuzzRuntimeObservation,
  informedBy: string[] = [],
): Promise<string> {
  const seed = new Uint8Array(32).fill(seedByte)
  const contentCommitment = createJsonCommitment(event, 'salted-sha256', () =>
    new Uint8Array(16).fill(seedByte),
  )
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: computeContentId('mcp://atrib-operating-demo', event.kind),
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: chainRoot,
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: contextId,
      timestamp: Date.now() + rows.length,
      args_hash: contentCommitment.hash,
      args_salt: contentCommitment.salt,
      signature: '',
      ...(informedBy.length > 0 ? { informed_by: informedBy } : {}),
    } as AtribRecord,
    seed,
  )
  const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  chainRoot = recordHash
  rows.push(
    JSON.stringify({
      record,
      proof: null,
      written_at: Date.now(),
      _local: { content: event, producer: 'operating-graph-demo' },
    }),
  )
  return recordHash
}

const readyHead = await append(11, {
  schema: OPERATING_EVENT_SCHEMA,
  kind: 'accepted_state',
  workspace,
  task,
  team,
  agent: alice,
  subject: 'release-status',
  value: 'ready',
  source: 'builder',
})
const blockedHead = await append(12, {
  schema: OPERATING_EVENT_SCHEMA,
  kind: 'accepted_state',
  workspace,
  task,
  team,
  agent: bob,
  subject: 'release-status',
  value: { state: 'blocked', reason: 'review required' },
  source: 'reviewer',
})
await append(11, {
  schema: OPERATING_EVENT_SCHEMA,
  kind: 'decision',
  workspace,
  task,
  team,
  agent: alice,
  subject: 'deployment',
  value: { target: 'container', writes: 'disabled' },
  source: 'builder',
})
const resolution = await append(
  12,
  {
    schema: OPERATING_EVENT_SCHEMA,
    kind: 'resolution',
    workspace,
    task,
    team,
    agent: bob,
    subject: 'release-status',
    accepted_head: blockedHead,
    resolves: [readyHead, blockedHead],
    source: 'reviewer',
  },
  [readyHead, blockedHead],
)
await append(
  11,
  {
    schema: OPERATING_EVENT_SCHEMA,
    kind: 'handoff',
    workspace,
    task,
    team,
    agent: alice,
    from_agent: alice,
    to_agent: bob,
    subject: 'verify-container',
    source: 'builder',
  },
  [resolution],
)
await append(
  12,
  {
    schema: OPERATING_EVENT_SCHEMA,
    kind: 'outcome',
    workspace,
    task,
    team,
    agent: bob,
    subject: 'container-review',
    value: { status: 'accepted', remaining: 'enable independent witness' },
    source: 'reviewer',
  },
  [resolution],
)
const agentSecret = new Uint8Array(32).fill(2)
const ownerSecret = new Uint8Array(32).fill(1)
const agentPubkey = Buffer.from(secp.schnorr.getPublicKey(agentSecret)).toString('hex')
const ownerPubkey = Buffer.from(secp.schnorr.getPublicKey(ownerSecret)).toString('hex')
const observerFixtures = await Promise.all(
  [1, 2].map(async (seq) => {
    const telemetry: BuzzObserverTelemetry = {
      seq,
      timestamp: `2026-07-25T12:00:0${seq}.000Z`,
      kind: seq === 1 ? 'turn_started' : 'tool_result',
      agentIndex: 0,
      channelId: 'channel-demo',
      sessionId: 'buzz-session-demo',
      turnId: 'turn-demo',
      startedAt: '2026-07-25T12:00:00.000Z',
      payload: { status: seq === 2 ? 'reported-success' : 'started' },
    }
    const unsigned = {
      pubkey: agentPubkey,
      created_at: 1_753_444_000 + seq,
      kind: 24_200,
      tags: [
        ['p', ownerPubkey],
        ['agent', agentPubkey],
        ['frame', 'telemetry'],
      ],
      content: `demo-ciphertext-${seq}`,
    }
    const id = deriveNostrEventId(unsigned)
    const sig = Buffer.from(
      await secp.schnorr.signAsync(
        Uint8Array.from(Buffer.from(id, 'hex')),
        agentSecret,
        new Uint8Array(32).fill(66),
      ),
    ).toString('hex')
    return { event: { ...unsigned, id, sig } as NostrEvent, telemetry }
  }),
)
const telemetryByCiphertext = new Map(
  observerFixtures.map(({ event, telemetry }) => [event.content, telemetry]),
)
const observerSource = new BuzzObserverRuntimeLogSource({
  load_events: () => observerFixtures.map(({ event }) => event),
  owner_pubkey: ownerPubkey,
  capture_id: 'buzz-observer-demo',
  decrypt(event) {
    const telemetry = telemetryByCiphertext.get(event.content)
    if (!telemetry) throw new Error('demo observer ciphertext not found')
    return telemetry
  },
})
const runtimeObservation = await buildBuzzRuntimeObservation(
  observerSource,
  { session_id: 'buzz-observer-demo', start: 1, end: 2 },
  { workspace, task, team, mapped_agent: alice },
)
await append(13, runtimeObservation)
writeFileSync(mirrorFile, `${rows.join('\n')}\n`)

const server = await startOperatingGraphServer({
  mirrorPath: mirrorFile,
  host: process.env['ATRIB_OPERATING_HOST'] ?? '127.0.0.1',
  port: Number(process.env['ATRIB_OPERATING_PORT'] ?? 8797),
  writesEnabled: false,
  pollMs: 1_000,
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('demo server did not bind TCP')
process.stdout.write(`atrib operating graph demo: http://127.0.0.1:${address.port}\n`)
process.stdout.write(`temporary signed mirror: ${mirrorFile}\n`)

const close = (): void => {
  server.closeAllConnections()
  server.close(() => {
    rmSync(directory, { recursive: true, force: true })
    process.exit(0)
  })
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
