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

const TRACE_CONTEXT_ID = '74726163652d7265706169722d737573'
const DIAGNOSTIC_CONTEXT_ID = 'd'.repeat(32)
const TRACE_AGENT_SEED = new Uint8Array(32).fill(171)
const DIAGNOSTIC_AGENT_SEED = new Uint8Array(32).fill(172)
const MAX_AGE_MS = 60_000

export type TraceRepairRole = 'plan' | 'tool_action' | 'failure' | 'stale_prior'

export interface TraceRepairStepBody {
  role: TraceRepairRole
  label: string
  action: string
  status: 'ok' | 'failed' | 'superseded'
  observation: string
  error?: string
  repair_hint?: string
}

export interface TraceRepairPacketRejection {
  record_hash: string
  reasons: HandoffRejectionReason[]
}

export interface TraceRepairSuspect {
  rank: number
  record_hash: string
  label: string
  role: TraceRepairRole
  score: number
  reason_codes: string[]
}

export interface TraceRepairDiagnosticOutcome {
  record_hash: string
  signature_ok: boolean
  informed_by_resolved: string[]
  informed_by_dangling: string[]
  body_hash: string
  proof_log_index: number
}

export interface TraceRepairSuspectSummary {
  current_trace_accepts: boolean
  stale_packet_rejects: boolean
  top_suspect_is_failed_tool_action: boolean
  diagnostic_signature_ok: boolean
  diagnostic_links_failure_and_suspect: boolean
}

export interface TraceRepairSuspectResult {
  strategy: 'atrib-trace-repair-suspect-v1'
  log_url: string
  max_age_ms: number
  accepted_record_hashes: string[]
  rejected_stale_packet: TraceRepairPacketRejection[]
  ranked_suspects: TraceRepairSuspect[]
  diagnostic_outcome: TraceRepairDiagnosticOutcome
  summary: TraceRepairSuspectSummary
}

interface TraceRecordFixture {
  label: string
  body: TraceRepairStepBody
  record: AtribRecord
  record_hash: string
  proof: ProofBundle
}

interface TraceRepairFixture {
  plan: TraceRecordFixture
  tool: TraceRecordFixture
  failure: TraceRecordFixture
  stale: TraceRecordFixture
  trustedCreatorKey: string
  logPublicKey: Uint8Array
}

export interface RunTraceRepairSuspectOptions {
  nowMs?: number
}

export async function runTraceRepairSuspect(
  options: RunTraceRepairSuspectOptions = {},
): Promise<TraceRepairSuspectResult> {
  const nowMs = options.nowMs ?? Date.now()
  let logServer: LogServer | undefined
  try {
    logServer = await startLogServer({
      port: 0,
      logPrivateKey: ed.utils.randomSecretKey(),
    })
    const fixture = await createFixture(logServer, nowMs)
    const current = await verifyCurrentTracePacket(fixture, nowMs)
    const stale = await verifyStalePacket(fixture, nowMs)
    const accepted = new Set(current.accepted_record_hashes)
    const ranked = rankSuspects(
      [fixture.plan, fixture.tool, fixture.failure].filter((item) =>
        accepted.has(item.record_hash),
      ),
      fixture.failure.record_hash,
      fixture.failure.record,
    )
    const diagnostic = await signDiagnosticOutcome({
      topSuspect: ranked[0],
      failure: fixture.failure,
      stale: fixture.stale,
      fixture,
      logUrl: logServer.url,
      nowMs,
    })

    return {
      strategy: 'atrib-trace-repair-suspect-v1',
      log_url: logServer.url,
      max_age_ms: MAX_AGE_MS,
      accepted_record_hashes: current.accepted_record_hashes,
      rejected_stale_packet: stale.rejected.map((claim) => ({
        record_hash: claim.record_hash,
        reasons: claim.rejection_reasons,
      })),
      ranked_suspects: ranked,
      diagnostic_outcome: diagnostic,
      summary: {
        current_trace_accepts:
          current.accepted_record_hashes.length === 3 && current.rejected.length === 0,
        stale_packet_rejects: stale.rejected.some((claim) =>
          claim.rejection_reasons.includes('stale'),
        ),
        top_suspect_is_failed_tool_action: ranked[0]?.role === 'tool_action',
        diagnostic_signature_ok: diagnostic.signature_ok,
        diagnostic_links_failure_and_suspect:
          diagnostic.informed_by_resolved.includes(fixture.failure.record_hash) &&
          diagnostic.informed_by_resolved.includes(ranked[0]?.record_hash ?? ''),
      },
    }
  } finally {
    await logServer?.close()
  }
}

async function createFixture(logServer: LogServer, nowMs: number): Promise<TraceRepairFixture> {
  const trustedCreatorKey = await publicKey(TRACE_AGENT_SEED)
  const planBody: TraceRepairStepBody = {
    role: 'plan',
    label: 'plan-review',
    action: 'choose follow-up review path from current support notes',
    status: 'ok',
    observation: 'fresh evidence is required before any external claim',
    repair_hint: 'prefer a target-specific proof artifact over a broad release claim',
  }
  const plan = await makeFixtureRecord(logServer, 'plan-review', planBody, nowMs - 3_000)

  const toolBody: TraceRepairStepBody = {
    role: 'tool_action',
    label: 'read-stale-proof-draft',
    action: 'load prior proof draft before refreshing the target artifact',
    status: 'failed',
    observation: 'the draft still points at broad release wording before verifier proof',
    error: 'stale proof source selected',
    repair_hint: 'refresh the target-native artifact and rerun its proof before review',
  }
  const tool = await makeFixtureRecord(
    logServer,
    'read-stale-proof-draft',
    toolBody,
    nowMs - 2_000,
    [plan.record_hash],
    plan.record_hash,
  )

  const failureBody: TraceRepairStepBody = {
    role: 'failure',
    label: 'diagnose-stale-proof-risk',
    action: 'decide whether the proof artifact is safe to use',
    status: 'failed',
    observation: 'the action would cite stale evidence without rerunning the proof',
    repair_hint: 'block follow-up work and inspect the failed tool action first',
  }
  const failure = await makeFixtureRecord(
    logServer,
    'diagnose-stale-proof-risk',
    failureBody,
    nowMs - 1_000,
    [tool.record_hash],
    tool.record_hash,
  )

  const staleBody: TraceRepairStepBody = {
    role: 'stale_prior',
    label: 'old-release-advice',
    action: 'reuse old release-note guidance',
    status: 'superseded',
    observation: 'the old advice predates the current verifier proof',
    repair_hint: 'do not cite this packet for current review decisions',
  }
  const stale = await makeFixtureRecord(logServer, 'old-release-advice', staleBody, nowMs - 120_000)

  return {
    plan,
    tool,
    failure,
    stale,
    trustedCreatorKey,
    logPublicKey: logServer.logPublicKey,
  }
}

async function verifyCurrentTracePacket(fixture: TraceRepairFixture, nowMs: number) {
  return verifyHandoffClaims(
    handoffClaimsFromEvidencePacket(
      evidencePacket(
        [fixture.plan, fixture.tool, fixture.failure],
        [fixture.plan.record_hash, fixture.tool.record_hash, fixture.failure.record_hash],
      ),
    ),
    verificationOptions(fixture, nowMs),
  )
}

async function verifyStalePacket(fixture: TraceRepairFixture, nowMs: number) {
  return verifyHandoffClaims(
    handoffClaimsFromEvidencePacket(evidencePacket([fixture.stale], [fixture.stale.record_hash])),
    verificationOptions(fixture, nowMs),
  )
}

function verificationOptions(fixture: TraceRepairFixture, nowMs: number) {
  return {
    trusted_creator_keys: [fixture.trustedCreatorKey],
    allowed_context_ids: [TRACE_CONTEXT_ID],
    require_body: true,
    require_body_commitment: true,
    require_log_inclusion: true,
    log_public_key: fixture.logPublicKey,
    now_ms: nowMs,
    max_age_ms: MAX_AGE_MS,
  }
}

function rankSuspects(
  acceptedRecords: TraceRecordFixture[],
  failureHash: string,
  failureRecord: AtribRecord,
): TraceRepairSuspect[] {
  return acceptedRecords
    .filter((item) => item.record_hash !== failureHash)
    .map((item) => {
      const reasonCodes: string[] = []
      let score = 0
      if (failureRecord.informed_by?.includes(item.record_hash)) {
        score += 5
        reasonCodes.push('direct-parent-of-failure')
      }
      if (item.body.role === 'tool_action') {
        score += 4
        reasonCodes.push('tool-action-boundary')
      }
      if (item.body.status === 'failed') {
        score += 3
        reasonCodes.push('failed-step')
      }
      if (item.body.error) {
        score += 2
        reasonCodes.push('explicit-error')
      }
      if (item.body.repair_hint) {
        score += 1
        reasonCodes.push('repair-hint-present')
      }
      return {
        rank: 0,
        record_hash: item.record_hash,
        label: item.label,
        role: item.body.role,
        score,
        reason_codes: reasonCodes,
      }
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

async function signDiagnosticOutcome(args: {
  topSuspect: TraceRepairSuspect | undefined
  failure: TraceRecordFixture
  stale: TraceRecordFixture
  fixture: TraceRepairFixture
  logUrl: string
  nowMs: number
}): Promise<TraceRepairDiagnosticOutcome> {
  if (!args.topSuspect) throw new Error('cannot sign diagnostic outcome without a suspect')
  const body = {
    kind: 'trace_repair_diagnostic',
    result: 'repair_target_ranked',
    failure_hash: args.failure.record_hash,
    top_suspect_hash: args.topSuspect.record_hash,
    rejected_stale_hash: args.stale.record_hash,
    reason_codes: args.topSuspect.reason_codes,
    repair_guidance: 'refresh the target-native artifact and proof before retrying review',
    caveat: 'suspect ranking is derived analyzer output; base graph edges remain structural',
  }
  const bodyHash = hashMaterial(body)
  const record = await makeTraceRecord(
    'diagnostic-outcome',
    body,
    DIAGNOSTIC_AGENT_SEED,
    args.nowMs,
    [args.failure.record_hash, args.topSuspect.record_hash],
    args.failure.record_hash,
    DIAGNOSTIC_CONTEXT_ID,
  )
  const proof = await submitRecord(args.logUrl, record)
  const verification = await verifyAtribRecord(record, {
    informedByCandidates: [
      args.fixture.plan.record,
      args.fixture.tool.record,
      args.fixture.failure.record,
      args.fixture.stale.record,
    ],
  })
  return {
    record_hash: recordHash(record),
    signature_ok: verification.signatureOk,
    informed_by_resolved: verification.informed_by_resolution?.resolved ?? [],
    informed_by_dangling: verification.informed_by_resolution?.dangling ?? [],
    body_hash: bodyHash,
    proof_log_index: proof.log_index,
  }
}

function evidencePacket(
  records: TraceRecordFixture[],
  requiredRecordHashes: string[],
): HandoffEvidencePacket {
  return {
    kind: 'trace_repair_suspect',
    required_record_hashes: requiredRecordHashes,
    records: records.map((item) => ({
      record_hash: item.record_hash,
      record: item.record,
      proof: item.proof,
      _local: {
        producer: 'trace-repair-suspect-example',
        content: item.body,
      },
    })),
  }
}

async function makeFixtureRecord(
  logServer: LogServer,
  label: string,
  body: TraceRepairStepBody,
  timestamp: number,
  informedBy: string[] = [],
  chainRoot = 'sha256:' + '7'.repeat(64),
): Promise<TraceRecordFixture> {
  const record = await makeTraceRecord(
    label,
    body,
    TRACE_AGENT_SEED,
    timestamp,
    informedBy,
    chainRoot,
  )
  return {
    label,
    body,
    record,
    record_hash: recordHash(record),
    proof: await submitRecord(logServer.url, record),
  }
}

async function makeTraceRecord(
  label: string,
  body: unknown,
  seed: Uint8Array,
  timestamp: number,
  informedBy: string[] = [],
  chainRoot = 'sha256:' + '7'.repeat(64),
  contextId = TRACE_CONTEXT_ID,
): Promise<AtribRecord> {
  const creatorKey = await publicKey(seed)
  const record = {
    spec_version: 'atrib/1.0',
    content_id: hashText(`trace-repair-suspect:${label}:${hashMaterial(body)}`),
    creator_key: creatorKey,
    chain_root: chainRoot,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: contextId,
    timestamp,
    args_hash: hashMaterial(body),
    signature: '',
  } as AtribRecord
  if (informedBy.length > 0) record.informed_by = informedBy
  return signRecord(record, seed)
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
