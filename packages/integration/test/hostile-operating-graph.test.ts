// SPDX-License-Identifier: Apache-2.0

import { beforeAll, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha256 as nobleSha256, sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlEncode,
  canonicalRecord,
  createJsonCommitment,
  getPublicKey,
  hexEncode,
  leafHash,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  analyzeCheckpointGossip,
  checkpointKeyId,
  checkpointRootFromLeafHashes,
  evaluateResultClaim,
  verifyHandoffClaims,
  type CheckpointGossipObservation,
} from '@atrib/verify'
import { createProtectedMcpExecutor, type ProtectedMcpActionContext } from '@atrib/action-gate'
import {
  createCoverageManifest,
  createLogWindowManifest,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  verifyCoverageManifest,
} from '@atrib/runtime-log'
import {
  OPERATING_EVENT_SCHEMA,
  projectOperatingView,
  type OperatingEntry,
} from '@atrib/operating-graph/model'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const LOG_NAME = 'log.hostile.fixture/v1'
const LOG_SEED = new Uint8Array(32).fill(51)
let logPublicKey: Uint8Array

beforeAll(async () => {
  logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
})

describe('adversarial operating-graph proofs', () => {
  it('BR-075 detects append rollback after a larger checkpoint was acknowledged', async () => {
    const observations = [
      await checkpointObservation('client-a', 100, leafHashes(1, 2, 3, 4)),
      await checkpointObservation('client-a', 101, leafHashes(1, 2, 3)),
    ]
    const report = await analyzeCheckpointGossip(observations, {
      name: LOG_NAME,
      publicKey: logPublicKey,
    })
    expect(report.status).toBe('conflict')
    expect(report.incidents.map((incident) => incident.kind)).toContain('source_rollback')
  })

  it('BR-076 rejects inconsistent result evidence and labels matching bytes uncorroborated', async () => {
    const claimed = { transfer: 'settled', cents: 500 }
    const commitment = createJsonCommitment(claimed, 'salted-sha256', () =>
      new Uint8Array(16).fill(3),
    )
    const record = await signedRecord(11, {
      result_hash: commitment.hash,
      result_salt: commitment.salt,
    })

    expect(evaluateResultClaim(record, { result: claimed })).toMatchObject({
      status: 'body_consistent_uncorroborated',
      truth_established: false,
    })
    expect(
      evaluateResultClaim(record, {
        result: { transfer: 'failed', cents: 500 },
      }),
    ).toMatchObject({
      status: 'evidence_inconsistent',
      truth_established: false,
    })
  })

  it('BR-077 blocks replayed permits and revoked delegation credentials', async () => {
    const action: ProtectedMcpActionContext = {
      run_id: 'run-1',
      action_id: 'action-1',
      agent_id: 'agent-1',
      risk: ['external_write'],
      credential: { run_key: 'run-key-1', principal_key: 'principal-key-1' },
    }
    const request = { name: 'payments.transfer', arguments: { cents: 500 } }
    let effects = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: '1'.repeat(32),
      createPermitId: () => 'permit-1',
      evaluate: () => ({ outcome: 'allow', policy_id: 'hostile-proof', policy_version: '1' }),
      executeUpstream: () => {
        effects += 1
        return { ok: true }
      },
    })
    const first = await executor.authorizeAndExecute({ action, request })
    expect(first.state).toBe('allowed')
    const replay = await executor.dispatch({ action, request, permit_id: 'permit-1' })
    expect(replay).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_consumed' },
    })

    const revoked = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(24),
      revokedKeys: new Set(['run-key-1']),
      evaluate: () => ({ outcome: 'allow', policy_id: 'hostile-proof', policy_version: '1' }),
      executeUpstream: () => {
        effects += 1
        return { ok: true }
      },
    })
    const revokedResult = await revoked.authorizeAndExecute({ action, request })
    expect(revokedResult.state).toBe('blocked')
    expect(effects).toBe(1)
  })

  it('BR-078 refuses a required record body that was withheld', async () => {
    const body = { result: 'private' }
    const commitment = createJsonCommitment(body, 'plain-sha256')
    const record = await signedRecord(12, { args_hash: commitment.hash })
    const hash = recordHash(record)
    const result = await verifyHandoffClaims([{ record_hash: hash, record }], {
      trusted_creator_keys: [record.creator_key],
      require_body: true,
      require_body_commitment: true,
    })
    expect(result.accepted_record_hashes).toEqual([])
    expect(result.rejected[0]?.rejection_reasons).toContain('body_missing')
  })

  it('BR-079 preserves conflicting memory heads without an application resolution', async () => {
    const first = operatingEntry('a', 'ready')
    const second = operatingEntry('b', 'blocked')
    const view = projectOperatingView([first, second], { workspace_id: 'workspace-1' })
    expect(view.cells[0]).toMatchObject({
      status: 'conflict',
      accepted_head: null,
      total_heads: 2,
    })
  })

  it('BR-080 detects a successful source action missing from event projections', () => {
    const sourceAction = {
      action_id: 'git-push-1',
      surface_id: 'git-projection',
      action_hash: hashRuntimeLogEvent({
        kind: 'git-push',
        result: 'success',
        commit: 'abc123',
      }),
    }
    const window = createLogWindowManifest({
      source: { id: 'git-runtime', kind: 'jsonl', version: '1' },
      runtime: { name: 'git-hook', version: '1' },
      session: {
        id: 'push-session',
        digest: hashSessionDefinition({ id: 'push-session' }),
      },
      window: { start: 1, end: 1 },
      events: [
        {
          event_id: sourceAction.action_id,
          position: 1,
          event_hash: sourceAction.action_hash,
        },
      ],
      privacy_posture: 'host-owned',
      verifier_policy: { require_event_root: true },
    })
    const coverage = createCoverageManifest({
      log_window_manifest: window,
      surfaces: [
        {
          id: sourceAction.surface_id,
          boundary: 'post-receive-hook',
          owner: 'git-host',
          required: true,
        },
      ],
      actions: [],
    })
    const verification = verifyCoverageManifest(
      coverage,
      { expected_actions: [sourceAction] },
      { require_expected_action_evidence: true },
    )
    expect(verification.valid).toBe(false)
    expect(verification.issues).toContainEqual(
      expect.objectContaining({
        code: 'expected_action_omitted',
        action_id: sourceAction.action_id,
      }),
    )
  })
})

async function signedRecord(
  seedByte: number,
  fields: Partial<AtribRecord> = {},
): Promise<AtribRecord> {
  const seed = new Uint8Array(32).fill(seedByte)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: `sha256:${'1'.repeat(64)}`,
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: `sha256:${'2'.repeat(64)}`,
      event_type: 'https://atrib.dev/v1/types/tool_call',
      context_id: '3'.repeat(32),
      timestamp: Date.now(),
      signature: '',
      ...fields,
    },
    seed,
  )
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(nobleSha256(canonicalRecord(record)))}`
}

function operatingEntry(character: string, value: string): OperatingEntry {
  return {
    record_hash: `sha256:${character.repeat(64)}`,
    record: {
      spec_version: 'atrib/1.0',
      content_id: `sha256:${'4'.repeat(64)}`,
      creator_key: 'creator',
      chain_root: `sha256:${'5'.repeat(64)}`,
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: '6'.repeat(32),
      timestamp: character.charCodeAt(0),
      signature: 'signature',
    },
    event: {
      schema: OPERATING_EVENT_SCHEMA,
      kind: 'accepted_state',
      workspace: { id: 'workspace-1', name: 'Apollo' },
      subject: 'launch',
      value,
    },
    signature_verified: true,
    proof_supplied: false,
    producer: 'hostile-test',
  }
}

function leafHashes(...values: number[]): Uint8Array[] {
  return values.map((value) => leafHash(Uint8Array.of(value)))
}

async function checkpointObservation(
  sourceId: string,
  observedAtMs: number,
  hashes: Uint8Array[],
): Promise<CheckpointGossipObservation> {
  const root = checkpointRootFromLeafHashes(hashes)
  const body = `${LOG_NAME}\n${hashes.length}\n${Buffer.from(root).toString('base64')}\n`
  const signature = await ed.signAsync(new TextEncoder().encode(body), LOG_SEED)
  const payload = Buffer.concat([
    Buffer.from(checkpointKeyId(LOG_NAME, logPublicKey)),
    Buffer.from(signature),
  ])
  return {
    source_id: sourceId,
    observed_at_ms: observedAtMs,
    checkpoint_note: `${body}\n\u2014 ${LOG_NAME} ${payload.toString('base64')}\n`,
    leaf_hashes: hashes,
  }
}
