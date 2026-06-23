// SPDX-License-Identifier: Apache-2.0

import { performance } from 'node:perf_hooks'
import { hexEncode, sha256 } from '@atrib/mcp'
import { runA2aHandoffProof } from '../../../src/a2a-handoff.js'
import type { A2aHandoffProofResult, A2aHandoffTiming } from '../../../src/a2a-handoff.js'
import {
  buildGoogleEvidenceGate,
  type GoogleAgentAnalyticsRow,
  type GoogleEvidenceGate,
  type GoogleEvidencePacket,
  type RuntimeCheck,
} from '../../../src/google-evidence-runtime.js'
import { runGoogleAdkPythonDecisionLedgerAllowPath } from '../../google-adk-python/google-adk-python-decision-ledger-proof.js'

export type GoogleActiveRuntimeStepKey =
  | 'ap2_gate'
  | 'a2a_handoff'
  | 'adk_decision'
  | 'adk_tool_callback'
export type GoogleActiveRuntimeStatus = 'complete' | 'blocked'
export type GoogleActiveRuntimeTiming = A2aHandoffTiming

export interface GoogleActiveRuntimeStep {
  key: GoogleActiveRuntimeStepKey
  protocol: 'AP2' | 'A2A' | 'ADK Python'
  status: GoogleActiveRuntimeStatus
  label: string
  detail: string
  timestamp: string
  record_hash?: string
  content_id?: string | null
  informed_by?: string[]
  checks?: RuntimeCheck[]
  timings?: A2aHandoffTiming[]
}

export type GoogleActiveRuntimeEvent =
  | {
      type: 'run_started'
      run_id: string
      mode: 'replay' | 'provided_packet'
      prompt: string
      timestamp: string
    }
  | {
      type: 'step_started'
      key: GoogleActiveRuntimeStepKey
      protocol: GoogleActiveRuntimeStep['protocol']
      label: string
      timestamp: string
    }
  | {
      type: 'step_completed'
      step: GoogleActiveRuntimeStep
      timestamp: string
    }
  | {
      type: 'run_blocked'
      run: GoogleActiveRuntimeRun
      timestamp: string
    }
  | {
      type: 'run_completed'
      run: GoogleActiveRuntimeRun
      timestamp: string
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
    a2a_receiver_informs_adk_decision: boolean
    adk_decision_informs_adk_python: boolean
  }
  a2a?: A2aHandoffProofResult
  adk_python?: Awaited<ReturnType<typeof runGoogleAdkPythonDecisionLedgerAllowPath>>
  analytics_rows: GoogleAgentAnalyticsRow[]
  operation_timings?: GoogleActiveRuntimeTiming[]
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
  onEvent?: (event: GoogleActiveRuntimeEvent) => void | Promise<void>
}

interface RuntimeTimingRecorder {
  span<T>(key: string, label: string, operation: () => T | Promise<T>): Promise<T>
  markTotal(key: string, label: string): Promise<void>
  offsetNow(): number
  entries(): GoogleActiveRuntimeTiming[]
}

const DEFAULT_ACTIVE_PROMPT =
  'Continue only if the AP2 evidence verifies, then quote the next atlas-kit action.'

export async function createGoogleActiveRuntimeRun(
  options: GoogleActiveRuntimeRunOptions,
): Promise<GoogleActiveRuntimeRun> {
  const prompt = options.prompt ?? DEFAULT_ACTIVE_PROMPT
  const createdMs = options.nowMs ?? Date.now()
  const createdAt = new Date(createdMs).toISOString()
  const mode = options.mode ?? 'replay'
  const runtimeTimings = createRuntimeTimingRecorder()
  const emit = async (event: GoogleActiveRuntimeEvent): Promise<void> => {
    await options.onEvent?.(event)
  }

  await emit({
    type: 'run_started',
    run_id: options.runId,
    mode,
    prompt,
    timestamp: createdAt,
  })
  await emit({
    type: 'step_started',
    key: 'ap2_gate',
    protocol: 'AP2',
    label: 'AP2 evidence gate',
    timestamp: createdAt,
  })

  const gate = await runtimeTimings.span('ap2_gate_build', 'Build AP2 evidence gate', () =>
    buildGoogleEvidenceGate(options.packet),
  )
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
  await emit({
    type: 'step_completed',
    step: steps[0]!,
    timestamp: createdAt,
  })

  if (!gate.allowed) {
    await runtimeTimings.markTotal('google_active_runtime_total', 'Google active runtime total')
    const operationTimings = runtimeTimings.entries()
    const blockedRun: GoogleActiveRuntimeRun = {
      ok: false,
      run_id: options.runId,
      status: 'blocked',
      mode,
      prompt,
      created_at: createdAt,
      updated_at: createdAt,
      duration_ms: 0,
      gate,
      steps,
      chain: {
        ap2_informs_a2a_remote: false,
        a2a_remote_informs_receiver: false,
        a2a_receiver_informs_adk_decision: false,
        adk_decision_informs_adk_python: false,
      },
      analytics_rows: [gate.analytics_row],
      operation_timings: operationTimings,
      value_add: runtimeValueAdd(),
      caveats: runtimeCaveats(),
    }
    await emit({
      type: 'run_blocked',
      run: blockedRun,
      timestamp: createdAt,
    })
    return blockedRun
  }

  const a2aIds = idsForRun(options.runId)
  await emit({
    type: 'step_started',
    key: 'a2a_handoff',
    protocol: 'A2A',
    label: 'A2A verifier handoff',
    timestamp: new Date(createdMs + 1_000).toISOString(),
  })
  const a2aStartedOffsetMs = runtimeTimings.offsetNow()
  const a2a = await runtimeTimings.span('a2a_handoff_proof', 'Run A2A handoff proof', () =>
    runA2aHandoffProof({
      nowMs: createdMs + 1_000,
      remoteInformedBy: [gate.record_hash],
      remoteInformedByCandidates: [options.packet.transactionRecord],
      includeSignedRecords: true,
      captureTimings: true,
      ids: a2aIds,
    }),
  )
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
    ...(a2a.timings !== undefined ? { timings: a2a.timings } : {}),
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
  await emit({
    type: 'step_completed',
    step: steps[1]!,
    timestamp: new Date(createdMs + 1_000).toISOString(),
  })

  await emit({
    type: 'step_started',
    key: 'adk_decision',
    protocol: 'ADK Python',
    label: 'ADK allow decision',
    timestamp: new Date(createdMs + 2_000).toISOString(),
  })
  const adkPython = await runtimeTimings.span(
    'adk_python_decision_ledger',
    'Run ADK Python decision-ledger proof',
    () =>
      runGoogleAdkPythonDecisionLedgerAllowPath({
        contextId: digestHex(`adk-python-decision:${options.runId}`, 32),
        parentRecordHash: a2a.followup.record_hash,
        sessionId: `google-active-adk-session-${digestHex(options.runId, 12)}`,
        prompt,
        nowMs: createdMs + 2_000,
      }),
  )
  steps.push({
    key: 'adk_decision',
    protocol: 'ADK Python',
    status: 'complete',
    label: 'ADK allow decision',
    detail: 'ADK Python BasePlugin signed an allow decision before the FunctionTool executed.',
    timestamp: new Date(createdMs + 2_000).toISOString(),
    record_hash: adkPython.decision.record_hash,
    informed_by: [a2a.followup.record_hash],
    checks: [
      {
        key: 'adk_decision_parent_resolved',
        ok: adkPython.decision.record.informed_by?.includes(a2a.followup.record_hash) ?? false,
        detail: `ADK decision cites ${a2a.followup.record_hash}`,
      },
      {
        key: 'adk_decision_state_allowed',
        ok: adkPython.decision.entry.decision_state === 'allowed',
        detail: `Decision state ${adkPython.decision.entry.decision_state}`,
      },
    ],
  })
  await emit({
    type: 'step_completed',
    step: steps[2]!,
    timestamp: new Date(createdMs + 2_000).toISOString(),
  })

  await emit({
    type: 'step_started',
    key: 'adk_tool_callback',
    protocol: 'ADK Python',
    label: 'ADK tool callback',
    timestamp: new Date(createdMs + 3_000).toISOString(),
  })
  steps.push({
    key: 'adk_tool_callback',
    protocol: 'ADK Python',
    status: 'complete',
    label: 'ADK tool callback',
    detail: 'ADK Python InMemoryRunner executed a FunctionTool after the signed allow decision.',
    timestamp: new Date(createdMs + 3_000).toISOString(),
    record_hash: adkPython.outcome.record_hash,
    informed_by: [adkPython.decision.record_hash],
    checks: [
      {
        key: 'adk_callback_informed_by_decision',
        ok: adkPython.outcome.record.informed_by?.includes(adkPython.decision.record_hash) ?? false,
        detail: `ADK callback cites ${adkPython.decision.record_hash}`,
      },
      {
        key: 'adk_public_record_hash_only',
        ok: !JSON.stringify(adkPython.publicRecords).includes(
          'python decision ledger private tool note',
        ),
        detail: 'Public ADK record keeps tool payload material out of the log.',
      },
    ],
  })
  await emit({
    type: 'step_completed',
    step: steps[3]!,
    timestamp: new Date(createdMs + 3_000).toISOString(),
  })

  const analyticsRows = await runtimeTimings.span(
    'analytics_rows_build',
    'Build BigQuery-shaped analytics rows',
    () =>
      buildRuntimeAnalyticsRows({
        runId: options.runId,
        createdMs,
        gate,
        a2a,
        adkPython,
      }),
  )
  await runtimeTimings.markTotal('google_active_runtime_total', 'Google active runtime total')
  const operationTimings = [
    ...runtimeTimings.entries(),
    ...shiftA2aTimings(a2a.timings ?? [], a2aStartedOffsetMs),
  ].sort((left, right) => left.started_offset_ms - right.started_offset_ms)
  const updatedAt = new Date(createdMs + 3_000).toISOString()

  const run: GoogleActiveRuntimeRun = {
    ok: true,
    run_id: options.runId,
    status: 'complete',
    mode,
    prompt,
    created_at: createdAt,
    updated_at: updatedAt,
    duration_ms: 3_000,
    gate,
    steps,
    chain: {
      ap2_informs_a2a_remote: a2a.evidence.remote_informed_by_resolved.includes(gate.record_hash),
      a2a_remote_informs_receiver: a2a.followup.informed_by_resolved.includes(
        a2a.evidence.remote_record_hash,
      ),
      a2a_receiver_informs_adk_decision:
        adkPython.decision.record.informed_by?.includes(a2a.followup.record_hash) ?? false,
      adk_decision_informs_adk_python:
        adkPython.outcome.record.informed_by?.includes(adkPython.decision.record_hash) ?? false,
    },
    a2a,
    adk_python: adkPython,
    analytics_rows: analyticsRows,
    operation_timings: operationTimings,
    value_add: runtimeValueAdd(),
    caveats: runtimeCaveats(),
  }
  await emit({
    type: 'run_completed',
    run,
    timestamp: updatedAt,
  })
  return run
}

function buildRuntimeAnalyticsRows({
  runId,
  createdMs,
  gate,
  a2a,
  adkPython,
}: {
  runId: string
  createdMs: number
  gate: GoogleEvidenceGate
  a2a: A2aHandoffProofResult
  adkPython: Awaited<ReturnType<typeof runGoogleAdkPythonDecisionLedgerAllowPath>>
}): GoogleAgentAnalyticsRow[] {
  const traceId = digestHex(`google-active-runtime:${runId}:${gate.record_hash}`, 32)
  const ap2Span = digestHex(`${runId}:ap2`, 16)
  const a2aRemoteSpan = digestHex(`${runId}:a2a-remote`, 16)
  const a2aReceiverSpan = digestHex(`${runId}:a2a-receiver`, 16)
  const adkDecisionIds = adkPython.google_operational_ids[0]
  const adkOutcomeIds = adkPython.google_operational_ids[1]
  if (!adkDecisionIds || !adkOutcomeIds) {
    throw new Error('ADK Python proof did not expose decision and outcome operational ids')
  }

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
      event_type: 'atrib.adk_python.decision_allowed',
      agent: adkDecisionIds.adk_agent_name ?? '',
      session_id: adkDecisionIds.adk_session_id,
      invocation_id: adkDecisionIds.adk_invocation_id ?? '',
      user_id: 'google-stack-demo-operator',
      trace_id: traceId,
      span_id: adkDecisionIds.span_id,
      parent_span_id: a2aReceiverSpan,
      status: 'OK',
      error_message: '',
      is_truncated: false,
      atrib_record_hash: adkPython.decision.record_hash,
      atrib_parent_record_hashes: JSON.stringify([a2a.followup.record_hash]),
      protocol: 'ADK Python',
    },
    {
      timestamp: new Date(createdMs + 3_000).toISOString(),
      event_type: 'atrib.adk_python.tool_callback_signed',
      agent: adkOutcomeIds.adk_agent_name ?? '',
      session_id: adkOutcomeIds.adk_session_id,
      invocation_id: adkOutcomeIds.adk_invocation_id ?? '',
      user_id: 'google-stack-demo-operator',
      trace_id: traceId,
      span_id: adkOutcomeIds.span_id,
      parent_span_id: adkDecisionIds.span_id,
      status: 'OK',
      error_message: '',
      is_truncated: false,
      atrib_record_hash: adkPython.outcome.record_hash,
      atrib_parent_record_hashes: JSON.stringify([adkPython.decision.record_hash]),
      protocol: 'ADK Python',
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
      'The ADK allow decision receives verifier-resolved AP2 and A2A parent evidence before the tool runs.',
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
    'The ADK proof uses google-adk Python InMemoryRunner decision and callback hooks, not Agent Platform Runtime, Gemini Enterprise, or Memory Bank.',
  ]
}

function createRuntimeTimingRecorder(): RuntimeTimingRecorder {
  const baseMs = performance.now()
  const entries: GoogleActiveRuntimeTiming[] = []

  const record = (key: string, label: string, startedAtMs: number, endedAtMs: number): void => {
    entries.push({
      key,
      label,
      started_offset_ms: roundRuntimeMs(startedAtMs - baseMs),
      duration_ms: roundRuntimeMs(endedAtMs - startedAtMs),
    })
  }

  return {
    async span<T>(key: string, label: string, operation: () => T | Promise<T>): Promise<T> {
      const startedAtMs = performance.now()
      try {
        return await operation()
      } finally {
        record(key, label, startedAtMs, performance.now())
      }
    },
    async markTotal(key: string, label: string): Promise<void> {
      record(key, label, baseMs, performance.now())
    },
    offsetNow(): number {
      return roundRuntimeMs(performance.now() - baseMs)
    },
    entries(): GoogleActiveRuntimeTiming[] {
      return [...entries]
    },
  }
}

function shiftA2aTimings(
  timings: A2aHandoffTiming[],
  startedOffsetMs: number,
): GoogleActiveRuntimeTiming[] {
  return timings.map((timing) => ({
    ...timing,
    started_offset_ms: roundRuntimeMs(startedOffsetMs + timing.started_offset_ms),
    parent_key: timing.parent_key ?? 'a2a_handoff_proof',
  }))
}

function roundRuntimeMs(value: number): number {
  return Math.round(value * 1000) / 1000
}

function digestHex(value: string, length: number): string {
  return hexEncode(sha256(new TextEncoder().encode(value))).slice(0, length)
}
