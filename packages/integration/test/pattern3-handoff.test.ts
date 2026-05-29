// SPDX-License-Identifier: Apache-2.0

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  base64urlEncode,
  canonicalRecord,
  hexEncode,
  sha256,
  signRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { startLogServer, type LogServer } from '@atrib/log-node'
import {
  handoffClaimsFromEvidencePacket,
  verifyHandoffClaims,
  verifyRecord as verifyAtribRecord,
} from '@atrib/verify'

ed.hashes.sha512 = sha512

const AGENT_A_SEED = new Uint8Array(32).fill(121)
const AGENT_B_SEED = new Uint8Array(32).fill(122)

function hashText(value: string): string {
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(value)))}`
}

function hashJcsString(value: string): string {
  return hashText(JSON.stringify(value))
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function submitRecord(url: string, record: AtribRecord): Promise<ProofBundle> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as ProofBundle
}

async function makeAgentAClaim(body: string): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(AGENT_A_SEED))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`pattern3-claim:${body}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'a'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: 'b'.repeat(32),
      timestamp: Date.now() - 1_000,
      args_hash: hashJcsString(body),
      signature: '',
    } as AtribRecord,
    AGENT_A_SEED,
  )
}

async function makeStaleAgentAClaim(body: string): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(AGENT_A_SEED))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`pattern3-stale-claim:${body}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'a'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: 'b'.repeat(32),
      timestamp: Date.now() - 120_000,
      args_hash: hashJcsString(body),
      signature: '',
    } as AtribRecord,
    AGENT_A_SEED,
  )
}

async function makeAgentBFollowup(informedBy: string[]): Promise<AtribRecord> {
  const creatorKey = base64urlEncode(await ed.getPublicKeyAsync(AGENT_B_SEED))
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`pattern3-followup:${informedBy.join(',')}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'c'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: 'd'.repeat(32),
      timestamp: Date.now(),
      informed_by: informedBy,
      signature: '',
    } as AtribRecord,
    AGENT_B_SEED,
  )
}

async function agentBPublicKey(): Promise<string> {
  return base64urlEncode(await ed.getPublicKeyAsync(AGENT_B_SEED))
}

function tamperLeafHash(proof: ProofBundle): ProofBundle {
  const leaf = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
  leaf[0] = leaf[0]! ^ 0xff
  return { ...proof, leaf_hash: Buffer.from(leaf).toString('base64') }
}

describe('Pattern 3 verified handoff', () => {
  let logServer: LogServer

  beforeAll(async () => {
    logServer = await startLogServer({
      port: 0,
      logPrivateKey: ed.utils.randomSecretKey(),
    })
  })

  afterAll(async () => {
    await logServer.close()
  })

  it('verifies Agent A evidence before Agent B signs an informed_by followup', async () => {
    const claimBody = 'tenant=tenant_42 ticket=SUP-42 summary=confirmed log sequence'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)

    const handoff = await verifyHandoffClaims(
      [{ record_hash: agentAHash, record: agentARecord, body: claimBody, proof }],
      {
        trusted_creator_keys: [agentARecord.creator_key],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([agentAHash])
    expect(handoff.rejected).toEqual([])
    expect(handoff.accepted[0]?.proof?.inclusion_ok).toBe(true)
    expect(handoff.accepted[0]?.proof?.checkpoint_signature_ok).toBe(true)

    const agentBRecord = await makeAgentBFollowup(handoff.accepted_record_hashes)
    const agentBVerification = await verifyAtribRecord(agentBRecord, {
      informedByCandidates: [agentARecord],
    })

    expect(agentBVerification.signatureOk).toBe(true)
    expect(agentBVerification.informed_by_resolution?.resolved).toEqual([agentAHash])
    expect(agentBVerification.informed_by_resolution?.dangling).toEqual([])
  })

  it('verifies a continuation packet before Agent B signs an informed_by followup', async () => {
    const claimBody = 'tenant=tenant_42 ticket=SUP-47 summary=continuation packet ready'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)
    const packet = {
      kind: 'handoff_packet',
      required_record_hashes: [agentAHash],
      records: [
        {
          record_hash: agentAHash,
          record: agentARecord,
          proof,
          _local: {
            producer: 'agent-a',
            content: claimBody,
          },
        },
      ],
      archive_refs: [
        {
          record_hash: agentAHash,
          uri: `atrib-archive://tenant-42/${agentAHash}`,
        },
      ],
    }

    const handoff = await verifyHandoffClaims(handoffClaimsFromEvidencePacket(packet), {
      trusted_creator_keys: [agentARecord.creator_key],
      allowed_context_ids: [agentARecord.context_id],
      require_body: true,
      require_body_commitment: true,
      require_log_inclusion: true,
      log_public_key: logServer.logPublicKey,
      now_ms: Date.now(),
      max_age_ms: 60_000,
    })

    expect(handoff.accepted_record_hashes).toEqual([agentAHash])
    expect(handoff.rejected).toEqual([])

    const agentBRecord = await makeAgentBFollowup(handoff.accepted_record_hashes)
    const agentBVerification = await verifyAtribRecord(agentBRecord, {
      informedByCandidates: [agentARecord],
    })

    expect(agentBVerification.signatureOk).toBe(true)
    expect(agentBVerification.informed_by_resolution?.resolved).toEqual([agentAHash])
  })

  it('rejects a continuation packet with no private body material', async () => {
    const claimBody = 'ticket=SUP-48 summary=body omitted'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)

    const handoff = await verifyHandoffClaims(
      handoffClaimsFromEvidencePacket({
        kind: 'handoff_packet',
        required_record_hashes: [agentAHash],
        records: [{ record_hash: agentAHash, record: agentARecord, proof }],
      }),
      {
        trusted_creator_keys: [agentARecord.creator_key],
        allowed_context_ids: [agentARecord.context_id],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('body_missing')
  })

  it('rejects a continuation packet with no inclusion proof', async () => {
    const claimBody = 'ticket=SUP-49 summary=proof omitted'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)

    const handoff = await verifyHandoffClaims(
      handoffClaimsFromEvidencePacket({
        kind: 'handoff_packet',
        required_record_hashes: [agentAHash],
        records: [
          {
            record_hash: agentAHash,
            record: agentARecord,
            _local: { content: claimBody },
          },
        ],
      }),
      {
        trusted_creator_keys: [agentARecord.creator_key],
        allowed_context_ids: [agentARecord.context_id],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('proof_missing')
  })

  it('rejects a continuation packet from a different context', async () => {
    const claimBody = 'ticket=SUP-50 summary=wrong context'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)

    const handoff = await verifyHandoffClaims(
      handoffClaimsFromEvidencePacket({
        kind: 'handoff_packet',
        required_record_hashes: [agentAHash],
        records: [
          {
            record_hash: agentAHash,
            record: agentARecord,
            proof,
            _local: { content: claimBody },
          },
        ],
      }),
      {
        trusted_creator_keys: [agentARecord.creator_key],
        allowed_context_ids: ['e'.repeat(32)],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('wrong_context')
  })

  it('rejects wrong-signer evidence before Agent B links to it', async () => {
    const claimBody = 'ticket=SUP-43 summary=checked logs'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)

    const handoff = await verifyHandoffClaims(
      [{ record_hash: agentAHash, record: agentARecord, body: claimBody, proof }],
      {
        trusted_creator_keys: [await agentBPublicKey()],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('wrong_signer')
  })

  it('rejects stale evidence before Agent B links to it', async () => {
    const claimBody = 'ticket=SUP-44 summary=checked old logs'
    const agentARecord = await makeStaleAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)

    const handoff = await verifyHandoffClaims(
      [{ record_hash: agentAHash, record: agentARecord, body: claimBody, proof }],
      {
        trusted_creator_keys: [agentARecord.creator_key],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('stale')
  })

  it('rejects tampered body evidence before Agent B links to it', async () => {
    const claimBody = 'ticket=SUP-45 summary=checked logs'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = await submitRecord(logServer.url, agentARecord)

    const handoff = await verifyHandoffClaims(
      [
        {
          record_hash: agentAHash,
          record: agentARecord,
          body: 'ticket=SUP-45 summary=checked different logs',
          proof,
        },
      ],
      {
        trusted_creator_keys: [agentARecord.creator_key],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('body_hash_mismatch')
  })

  it('rejects tampered proof evidence before Agent B links to it', async () => {
    const claimBody = 'ticket=SUP-46 summary=checked logs'
    const agentARecord = await makeAgentAClaim(claimBody)
    const agentAHash = recordHash(agentARecord)
    const proof = tamperLeafHash(await submitRecord(logServer.url, agentARecord))

    const handoff = await verifyHandoffClaims(
      [{ record_hash: agentAHash, record: agentARecord, body: claimBody, proof }],
      {
        trusted_creator_keys: [agentARecord.creator_key],
        require_body: true,
        require_body_commitment: true,
        require_log_inclusion: true,
        log_public_key: logServer.logPublicKey,
        now_ms: Date.now(),
        max_age_ms: 60_000,
      },
    )

    expect(handoff.accepted_record_hashes).toEqual([])
    expect(handoff.rejected[0]?.rejection_reasons).toContain('proof_invalid')
  })
})
