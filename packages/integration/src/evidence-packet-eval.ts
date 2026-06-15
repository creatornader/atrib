// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
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
  type HandoffEvidencePacket,
  type HandoffRejectionReason,
} from '@atrib/verify'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const AGENT_A_SEED = new Uint8Array(32).fill(151)
const AGENT_B_SEED = new Uint8Array(32).fill(152)
const CONTEXT_ID = '65766964656e63652d7061636b65742d'
const FOLLOWUP_CONTEXT_ID = 'f'.repeat(32)
const MAX_AGE_MS = 60_000

const CURRENT_BODY = {
  task: 'Classify a support review target from current proof evidence.',
  target: 'trace eval reviewer',
  finding: 'current-packet-says-use-public-verifier-example',
  decision: 'share artifact after proof review passes',
}

const STALE_BODY = {
  task: 'Classify a support review target from stale release evidence.',
  target: 'generic release list',
  finding: 'stale-packet-says-use-broad-release-post',
  decision: 'do not use for current review',
}

export type EvidencePacketEvalArm =
  | 'packet_on'
  | 'stale_packet'
  | 'wrong_signer'
  | 'tampered_body'
  | 'packet_off'

export interface EvidencePacketEvalRejectedClaim {
  record_hash: string
  reasons: HandoffRejectionReason[]
}

export interface EvidencePacketEvalFollowup {
  record_hash: string
  signature_ok: boolean
  informed_by_resolved: string[]
  informed_by_dangling: string[]
}

export interface EvidencePacketEvalArmResult {
  arm: EvidencePacketEvalArm
  expected: 'accept' | 'reject'
  passed: boolean
  accepted_record_hashes: string[]
  rejected: EvidencePacketEvalRejectedClaim[]
  expected_rejection_reasons: HandoffRejectionReason[]
  followup?: EvidencePacketEvalFollowup
}

export interface EvidencePacketEvalSummary {
  passed_arms: number
  total_arms: number
  packet_on_accepts: boolean
  controls_reject: boolean
}

export interface EvidencePacketEvalResult {
  strategy: 'atrib-evidence-packet-eval-v1'
  log_url: string
  max_age_ms: number
  arms: EvidencePacketEvalArmResult[]
  summary: EvidencePacketEvalSummary
}

export interface RunEvidencePacketEvalOptions {
  nowMs?: number
}

interface EvalFixture {
  currentRecord: AtribRecord
  currentHash: string
  currentProof: ProofBundle
  staleRecord: AtribRecord
  staleHash: string
  staleProof: ProofBundle
  trustedCreatorKey: string
  wrongCreatorKey: string
  logPublicKey: Uint8Array
}

interface ArmSpec {
  arm: EvidencePacketEvalArm
  expected: 'accept' | 'reject'
  packet: HandoffEvidencePacket
  trustedCreatorKeys: string[]
  expectedRejectionReasons: HandoffRejectionReason[]
}

export async function runEvidencePacketEval(
  options: RunEvidencePacketEvalOptions = {},
): Promise<EvidencePacketEvalResult> {
  const nowMs = options.nowMs ?? Date.now()
  let logServer: LogServer | undefined
  try {
    logServer = await startLogServer({
      port: 0,
      logPrivateKey: ed.utils.randomSecretKey(),
    })
    const fixture = await createFixture(logServer, nowMs)
    const arms: EvidencePacketEvalArmResult[] = []
    for (const spec of armSpecs(fixture)) {
      arms.push(await evaluateArm(spec, fixture, nowMs))
    }
    const packetOn = arms.find((arm) => arm.arm === 'packet_on')
    const controls = arms.filter((arm) => arm.arm !== 'packet_on')
    return {
      strategy: 'atrib-evidence-packet-eval-v1',
      log_url: logServer.url,
      max_age_ms: MAX_AGE_MS,
      arms,
      summary: {
        passed_arms: arms.filter((arm) => arm.passed).length,
        total_arms: arms.length,
        packet_on_accepts: packetOn?.accepted_record_hashes.length === 1,
        controls_reject: controls.every((arm) => arm.rejected.length > 0),
      },
    }
  } finally {
    await logServer?.close()
  }
}

async function createFixture(logServer: LogServer, nowMs: number): Promise<EvalFixture> {
  const trustedCreatorKey = await publicKey(AGENT_A_SEED)
  const wrongCreatorKey = await publicKey(AGENT_B_SEED)
  const currentRecord = await makeClaimRecord(CURRENT_BODY, AGENT_A_SEED, nowMs - 1_000)
  const currentHash = recordHash(currentRecord)
  const currentProof = await submitRecord(logServer.url, currentRecord)
  const staleRecord = await makeClaimRecord(STALE_BODY, AGENT_A_SEED, nowMs - 120_000)
  const staleHash = recordHash(staleRecord)
  const staleProof = await submitRecord(logServer.url, staleRecord)
  return {
    currentRecord,
    currentHash,
    currentProof,
    staleRecord,
    staleHash,
    staleProof,
    trustedCreatorKey,
    wrongCreatorKey,
    logPublicKey: logServer.logPublicKey,
  }
}

function armSpecs(fixture: EvalFixture): ArmSpec[] {
  return [
    {
      arm: 'packet_on',
      expected: 'accept',
      packet: evidencePacket(
        fixture.currentHash,
        fixture.currentRecord,
        fixture.currentProof,
        CURRENT_BODY,
      ),
      trustedCreatorKeys: [fixture.trustedCreatorKey],
      expectedRejectionReasons: [],
    },
    {
      arm: 'stale_packet',
      expected: 'reject',
      packet: evidencePacket(
        fixture.staleHash,
        fixture.staleRecord,
        fixture.staleProof,
        STALE_BODY,
      ),
      trustedCreatorKeys: [fixture.trustedCreatorKey],
      expectedRejectionReasons: ['stale'],
    },
    {
      arm: 'wrong_signer',
      expected: 'reject',
      packet: evidencePacket(
        fixture.currentHash,
        fixture.currentRecord,
        fixture.currentProof,
        CURRENT_BODY,
      ),
      trustedCreatorKeys: [fixture.wrongCreatorKey],
      expectedRejectionReasons: ['wrong_signer'],
    },
    {
      arm: 'tampered_body',
      expected: 'reject',
      packet: evidencePacket(fixture.currentHash, fixture.currentRecord, fixture.currentProof, {
        ...CURRENT_BODY,
        decision: 'share broad release post without proof review',
      }),
      trustedCreatorKeys: [fixture.trustedCreatorKey],
      expectedRejectionReasons: ['body_hash_mismatch'],
    },
    {
      arm: 'packet_off',
      expected: 'reject',
      packet: {
        kind: 'evidence_packet_eval',
        required_record_hashes: [fixture.currentHash],
        records: [],
      },
      trustedCreatorKeys: [fixture.trustedCreatorKey],
      expectedRejectionReasons: ['record_missing'],
    },
  ]
}

async function evaluateArm(
  spec: ArmSpec,
  fixture: EvalFixture,
  nowMs: number,
): Promise<EvidencePacketEvalArmResult> {
  const handoff = await verifyHandoffClaims(handoffClaimsFromEvidencePacket(spec.packet), {
    trusted_creator_keys: spec.trustedCreatorKeys,
    allowed_context_ids: [CONTEXT_ID],
    require_body: true,
    require_body_commitment: true,
    require_log_inclusion: true,
    log_public_key: fixture.logPublicKey,
    now_ms: nowMs,
    max_age_ms: MAX_AGE_MS,
  })
  const rejected = handoff.rejected.map((claim) => ({
    record_hash: claim.record_hash,
    reasons: claim.rejection_reasons,
  }))
  const expectedMet =
    spec.expected === 'accept'
      ? handoff.accepted_record_hashes.length === 1 && rejected.length === 0
      : handoff.accepted_record_hashes.length === 0 &&
        spec.expectedRejectionReasons.every((reason) =>
          rejected.some((claim) => claim.reasons.includes(reason)),
        )
  const result: EvidencePacketEvalArmResult = {
    arm: spec.arm,
    expected: spec.expected,
    passed: expectedMet,
    accepted_record_hashes: handoff.accepted_record_hashes,
    rejected,
    expected_rejection_reasons: spec.expectedRejectionReasons,
  }
  if (handoff.accepted_record_hashes.length > 0) {
    result.followup = await makeVerifiedFollowup(handoff.accepted_record_hashes, fixture, nowMs)
  }
  return result
}

async function makeVerifiedFollowup(
  informedBy: string[],
  fixture: EvalFixture,
  nowMs: number,
): Promise<EvidencePacketEvalFollowup> {
  const record = await makeAgentBFollowup(informedBy, nowMs)
  const verification = await verifyAtribRecord(record, {
    informedByCandidates: [fixture.currentRecord, fixture.staleRecord],
  })
  return {
    record_hash: recordHash(record),
    signature_ok: verification.signatureOk,
    informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
    informed_by_dangling: verification.informed_by_resolution?.dangling ?? [],
  }
}

function evidencePacket(
  recordHashValue: string,
  record: AtribRecord,
  proof: ProofBundle,
  body: unknown,
): HandoffEvidencePacket {
  return {
    kind: 'evidence_packet_eval',
    required_record_hashes: [recordHashValue],
    records: [
      {
        record_hash: recordHashValue,
        record,
        proof,
        _local: {
          producer: 'agent-a',
          content: body,
        },
      },
    ],
  }
}

async function makeClaimRecord(
  body: unknown,
  seed: Uint8Array,
  timestamp: number,
): Promise<AtribRecord> {
  const creatorKey = await publicKey(seed)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`evidence-packet-eval:${hashMaterial(body)}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'e'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: CONTEXT_ID,
      timestamp,
      args_hash: hashMaterial(body),
      signature: '',
    } as AtribRecord,
    seed,
  )
}

async function makeAgentBFollowup(informedBy: string[], timestamp: number): Promise<AtribRecord> {
  const creatorKey = await publicKey(AGENT_B_SEED)
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: hashText(`evidence-packet-eval-followup:${informedBy.join(',')}`),
      creator_key: creatorKey,
      chain_root: 'sha256:' + 'f'.repeat(64),
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: FOLLOWUP_CONTEXT_ID,
      timestamp,
      informed_by: informedBy,
      signature: '',
    } as AtribRecord,
    AGENT_B_SEED,
  )
}

async function submitRecord(url: string, record: AtribRecord): Promise<ProofBundle> {
  const res = await fetch(`${url}/v1/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  if (!res.ok) {
    throw new Error(`log submission failed with HTTP ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as ProofBundle
}

async function publicKey(seed: Uint8Array): Promise<string> {
  return base64urlEncode(await ed.getPublicKeyAsync(seed))
}

function hashText(value: string): string {
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(value)))}`
}

function hashMaterial(value: unknown): string {
  const encoded = canonicalize(value)
  if (encoded === undefined) throw new Error('body is not JSON-canonicalizable')
  return hashText(encoded)
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}
