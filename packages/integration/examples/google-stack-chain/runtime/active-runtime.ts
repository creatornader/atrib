// SPDX-License-Identifier: Apache-2.0

import { hexEncode, sha256 } from '@atrib/mcp'
import { runA2aHandoffProof } from '../../../src/a2a-handoff.js'
import type { A2aHandoffProofResult } from '../../../src/a2a-handoff.js'
import {
  buildGoogleEvidenceGate,
  type GoogleAgentAnalyticsRow,
  type GoogleEvidenceGate,
  type GoogleEvidencePacket,
  type RuntimeCheck,
} from '../../../src/google-evidence-runtime.js'
import { runGoogleAdkPluginSmoke } from '../../google-adk/google-adk-plugin-smoke.js'

export type GoogleActiveRuntimeStepKey = 'ap2_gate' | 'a2a_handoff' | 'adk_tool_callback'
export type GoogleActiveRuntimeStatus = 'complete' | 'blocked'

export interface GoogleActiveRuntimeStep {
  key: GoogleActiveRuntimeStepKey
  protocol: 'AP2' | 'A2A' | 'ADK JS'
  status: GoogleActiveRuntimeStatus
  label: string
  detail: string
  timestamp: string
  record_hash?: string
  content_id?: string | null
  informed_by?: string[]
  checks?: RuntimeCheck[]
}

export interface GoogleActiveRuntimeRun {
  ok: boolean
  run_id: string
  status: GoogleActiveRuntimeStatus
  mode: 'replay' | 'provided_packet'
  prompt: string
  created_at: string
  updated_at: string
  duration_ms: number
  gate: GoogleEvidenceGate
  steps: GoogleActiveRuntimeStep[]
  chain: {
    ap2_informs_a2a_remote: boolean
    a2a_remote_informs_receiver: boolean
    a2a_receiver_informs_adk_js: boolean
  }
  a2a?: A2aHandoffProofResult
  adk_js?: Awaited<ReturnType<typeof runGoogleAdkPluginSmoke>>
  analytics_rows: GoogleAgentAnalyticsRow[]
  value_add: {
    pre_action_trust_transfer: string
    runtime_gate: string
    analytics_join: string
  }
  caveats: string[]
}

export interface GoogleActiveRuntimeRunOptions {
  runId: string
  packet: GoogleEvidencePacket
  mode?: 'replay' | 'provided_packet'
  prompt?: string
  nowMs?: number
}

const DEFAULT_ACTIVE_PROMPT =
  'Continue only if the AP2 evidence verifies, then quote the next atlas-kit action.'

export async function createGoogleActiveRuntimeRun(
  options: GoogleActiveRuntimeRunOptions,
): Promise<GoogleActiveRuntimeRun> {
  const prompt = options.prompt ?? DEFAULT_ACTIVE_PROMPT
  const createdMs = options.nowMs ?? Date.now()
  const createdAt = new Date(createdMs).toISOString()
  const gate = await buildGoogleEvidenceGate(options.packet)
  const steps: GoogleActiveRuntimeStep[] = [
    {
      key: 'ap2_gate',
      protocol: 'AP2',
      status: gate.allowed ? 'complete' : 'blocked',
      label: 'AP2 evidence gate',
      detail: gate.reason,
      timestamp: createdAt,
      record_hash: gate.record_hash,
      content_id: gate.content_id,
      checks: gate.checks,
    },
  ]

  if (!gate.allowed) {
    return {
      ok: false,
      run_id: options.runId,
      status: 'blocked',
      mode: options.mode ?? 'replay',
      prompt,
      created_at: createdAt,
      updated_at: createdAt,
      duration_ms: 0,
      gate,
      steps,
      chain: {
        ap2_informs_a2a_remote: false,
        a2a_remote_informs_receiver: false,
        a2a_receiver_informs_adk_js: false,
      },
      analytics_rows: [gate.analytics_row],
      value_add: runtimeValueAdd(),
      caveats: runtimeCaveats(),
    }
  }

  const a2aIds = idsForRun(options.runId)
  const a2a = await runA2aHandoffProof({
    nowMs: createdMs + 1_000,
    remoteInformedBy: [gate.record_hash],
    remoteInformedByCandidates: [options.packet.transactionRecord],
    includeSignedRecords: true,
    ids: a2aIds,
  })
  if (!a2a.records?.followup) {
    throw new Error('A2A proof did not expose the signed receiving-agent follow-up record')
  }
  steps.push({
    key: 'a2a_handoff',
    protocol: 'A2A',
    status: 'complete',
    label: 'A2A verifier handoff',
    detail: 'A2A returned an atrib handoff packet and the receiver signed a follow-up.',
    timestamp: new Date(createdMs + 1_000).toISOString(),
    record_hash: a2a.followup.record_hash,
    informed_by: [a2a.evidence.remote_record_hash],
    checks: [
      {
        key: 'a2a_agent_card_signature_valid',
        ok: a2a.agent_card.signature_valid,
        detail: `${a2a.agent_card.signature_alg} signature ${a2a.agent_card.signature_kid}`,
      },
      {
        key: 'a2a_remote_informed_by_ap2',
        ok: a2a.evidence.remote_informed_by_resolved.includes(gate.record_hash),
        detail: `Remote A2A record cites ${gate.record_hash}`,
      },
      {
        key: 'a2a_receiver_informed_by_remote',
        ok: a2a.followup.informed_by_resolved.includes(a2a.evidence.remote_record_hash),
        detail: `Receiver follow-up cites ${a2a.evidence.remote_record_hash}`,
      },
    ],
  })

  const adkJs = await runGoogleAdkPluginSmoke({
    contextId: digestHex(`adk-js:${options.runId}`, 32),
    parentRecordHash: a2a.followup.record_hash,
    parentRecord: a2a.records.followup,
    prompt,
    nowMs: createdMs + 2_000,
  })
  const adkRecordHash = adkJs.record_hashes[0]
  if (!adkRecordHash) throw new Error('ADK JS proof did not sign a tool callback record')
  steps.push({
    key: 'adk_tool_callback',
    protocol: 'ADK JS',
    status: 'complete',
    label: 'ADK tool callback',
    detail: 'ADK JS InMemoryRunner executed a FunctionTool after the verified A2A handoff.',
    timestamp: new Date(createdMs + 2_000).toISOString(),
    record_hash: adkRecordHash,
    informed_by: [a2a.followup.record_hash],
    checks: [
      {
        key: 'adk_parent_informed_by_resolved',
        ok: adkJs.chain.parent_informed_by_resolved.includes(a2a.followup.record_hash),
        detail: `ADK record cites ${a2a.followup.record_hash}`,
      },
      {
        key: 'adk_public_record_hash_only',
        ok: adkJs.privacy.public_records_hash_only,
        detail: 'Public ADK record keeps tool payload material out of the log.',
      },
    ],
  })

  const analyticsRows = buildRuntimeAnalyticsRows({
    runId: options.runId,
    createdMs,
    gate,
    a2a,
    adkJs,
  })
  const updatedAt = new Date(createdMs + 2_000).toISOString()

  return {
    ok: true,
    run_id: options.runId,
    status: 'complete',
    mode: options.mode ?? 'replay',
    prompt,
    created_at: createdAt,
    updated_at: updatedAt,
    duration_ms: 2_000,
    gate,
    steps,
    chain: {
      ap2_informs_a2a_remote: a2a.evidence.remote_informed_by_resolved.includes(gate.record_hash),
      a2a_remote_informs_receiver: a2a.followup.informed_by_resolved.includes(
        a2a.evidence.remote_record_hash,
      ),
      a2a_receiver_informs_adk_js: adkJs.chain.parent_informed_by_resolved.includes(
        a2a.followup.record_hash,
      ),
    },
    a2a,
    adk_js: adkJs,
    analytics_rows: analyticsRows,
    value_add: runtimeValueAdd(),
    caveats: runtimeCaveats(),
  }
}

function buildRuntimeAnalyticsRows({
  runId,
  createdMs,
  gate,
  a2a,
  adkJs,
}: {
  runId: string
  createdMs: number
  gate: GoogleEvidenceGate
  a2a: A2aHandoffProofResult
  adkJs: Awaited<ReturnType<typeof runGoogleAdkPluginSmoke>>
}): GoogleAgentAnalyticsRow[] {
  const traceId = digestHex(`google-active-runtime:${runId}:${gate.record_hash}`, 32)
  const ap2Span = digestHex(`${runId}:ap2`, 16)
  const a2aRemoteSpan = digestHex(`${runId}:a2a-remote`, 16)
  const a2aReceiverSpan = digestHex(`${runId}:a2a-receiver`, 16)
  const adkIds = adkJs.google_operational_ids[0]
  if (!adkIds) throw new Error('ADK JS proof did not expose operational ids')

  return [
    {
      ...gate.analytics_row,
      invocation_id: runId,
      trace_id: traceId,
      span_id: ap2Span,
      parent_span_id: '',
      atrib_parent_record_hashes: JSON.stringify([]),
    },
    {
      timestamp: new Date(createdMs + 1_000).toISOString(),
      event_type: 'atrib.a2a.remote_evidence_accepted',
      agent: 'a2a-specialist-agent',
      session_id: a2a.a2a.request_context_id,
      invocation_id: idsForRun(runId).requestMessageId,
      user_id: 'google-stack-demo-operator',
      trace_id: traceId,
      span_id: a2aRemoteSpan,
      parent_span_id: ap2Span,
      status: 'OK',
      error_message: '',
      is_truncated: false,
      atrib_record_hash: a2a.evidence.remote_record_hash,
      atrib_parent_record_hashes: JSON.stringify([gate.record_hash]),
      protocol: 'A2A',
    },
    {
      timestamp: new Date(createdMs + 1_000).toISOString(),
      event_type: 'atrib.a2a.receiver_followup_signed',
      agent: 'a2a-receiving-agent',
      session_id: a2a.a2a.request_context_id,
      invocation_id: idsForRun(runId).responseMessageId,
      user_id: 'google-stack-demo-operator',
      trace_id: traceId,
      span_id: a2aReceiverSpan,
      parent_span_id: a2aRemoteSpan,
      status: 'OK',
      error_message: '',
      is_truncated: false,
      atrib_record_hash: a2a.followup.record_hash,
      atrib_parent_record_hashes: JSON.stringify([a2a.evidence.remote_record_hash]),
      protocol: 'A2A',
    },
    {
      timestamp: new Date(createdMs + 2_000).toISOString(),
      event_type: 'atrib.adk_js.tool_callback_signed',
      agent: adkIds.adk_agent_name,
      session_id: adkIds.adk_session_id,
      invocation_id: adkIds.adk_invocation_id,
      user_id: 'google-stack-demo-operator',
      trace_id: traceId,
      span_id: adkIds.span_id,
      parent_span_id: a2aReceiverSpan,
      status: 'OK',
      error_message: '',
      is_truncated: false,
      atrib_record_hash: adkJs.record_hashes[0]!,
      atrib_parent_record_hashes: JSON.stringify([a2a.followup.record_hash]),
      protocol: 'ADK JS',
    },
  ]
}

function idsForRun(runId: string): {
  requestMessageId: string
  responseMessageId: string
  taskId: string
  contextId: string
} {
  const suffix = digestHex(runId, 12)
  return {
    requestMessageId: `google-active-a2a-request-${suffix}`,
    responseMessageId: `google-active-a2a-response-${suffix}`,
    taskId: `google-active-a2a-task-${suffix}`,
    contextId: `google-active-a2a-context-${suffix}`,
  }
}

function runtimeValueAdd(): GoogleActiveRuntimeRun['value_add'] {
  return {
    pre_action_trust_transfer:
      'The ADK tool action receives verifier-resolved AP2 and A2A parent evidence before it runs.',
    runtime_gate:
      'The next action is blocked unless AP2 detection, AP2 / VI evidence, the atrib record, and counterparty attestation pass.',
    analytics_join:
      'Every runtime row carries the atrib record hash and parent hashes, so operational telemetry can join back to signed evidence.',
  }
}

function runtimeCaveats(): string[] {
  return [
    'The AP2 packet is still a committed replay fixture unless a merchant supplies live AP2 result and evidence JSON.',
    'The A2A exchange is in-process JSON-RPC, not a public A2A server or upstream TCK result.',
    'The ADK proof uses @google/adk InMemoryRunner, not Agent Platform Runtime, Gemini Enterprise, or Memory Bank.',
  ]
}

function digestHex(value: string, length: number): string {
  return hexEncode(sha256(new TextEncoder().encode(value))).slice(0, length)
}
