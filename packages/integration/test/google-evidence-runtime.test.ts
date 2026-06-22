import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createGoogleActiveRuntimeRun } from '../examples/google-stack-chain/runtime/active-runtime.js'
import {
  DEFAULT_RUNTIME_CONTEXT_ID,
  buildGoogleEvidenceGate,
  buildReplayPacket,
  merchantAdapterContract,
} from '../src/google-evidence-runtime.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/ap2-vi-reference')

describe('Google evidence runtime', () => {
  it('allows the next action from replayed AP2 evidence', async () => {
    const packet = await buildReplayPacket({
      resultJson: join(fixtureDir, 'ap2-vi-reference-result.json'),
      evidenceJson: join(fixtureDir, 'ap2-vi-reference-evidence.json'),
    })

    const gate = await buildGoogleEvidenceGate(packet)

    expect(gate.allowed).toBe(true)
    expect(gate.decision).toBe('allow_next_action')
    expect(gate.packet_source).toBe('committed AP2 / VI replay fixture')
    expect(gate.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(gate.next_action_context.informed_by).toEqual([gate.record_hash])
    expect(gate.analytics_row).toMatchObject({
      event_type: 'atrib.ap2.next_action_allowed',
      agent: 'atrib-google-evidence-runtime',
      session_id: DEFAULT_RUNTIME_CONTEXT_ID,
      status: 'OK',
      atrib_record_hash: gate.record_hash,
      protocol: 'AP2',
    })
    expect(gate.checks.every((check) => check.ok)).toBe(true)
  })

  it('runs the active Google stack after AP2 verification', async () => {
    const packet = await buildReplayPacket({
      resultJson: join(fixtureDir, 'ap2-vi-reference-result.json'),
      evidenceJson: join(fixtureDir, 'ap2-vi-reference-evidence.json'),
    })

    const events: string[] = []
    const run = await createGoogleActiveRuntimeRun({
      runId: 'google-active-test-run',
      packet,
      prompt: 'Quote the next atlas-kit action after AP2 verification.',
      nowMs: 1_779_840_000_000,
      onEvent: (event) => {
        events.push('key' in event ? `${event.type}:${event.key}` : event.type)
      },
    })

    expect(run.ok).toBe(true)
    expect(run.status).toBe('complete')
    expect(run.steps.map((step) => step.key)).toEqual([
      'ap2_gate',
      'a2a_handoff',
      'adk_decision',
      'adk_tool_callback',
    ])
    expect(run.chain).toEqual({
      ap2_informs_a2a_remote: true,
      a2a_remote_informs_receiver: true,
      a2a_receiver_informs_adk_decision: true,
      adk_decision_informs_adk_js: true,
    })
    expect(run.a2a?.evidence.remote_informed_by_resolved).toEqual([run.gate.record_hash])
    expect(run.adk_js?.decision.record.informed_by).toEqual([run.a2a?.followup.record_hash])
    expect(run.adk_js?.outcome.record.informed_by).toEqual([run.adk_js?.decision.record_hash])
    expect(run.analytics_rows.map((row) => row.event_type)).toEqual([
      'atrib.ap2.next_action_allowed',
      'atrib.a2a.remote_evidence_accepted',
      'atrib.a2a.receiver_followup_signed',
      'atrib.adk_js.decision_allowed',
      'atrib.adk_js.tool_callback_signed',
    ])
    expect(run.analytics_rows.map((row) => row.atrib_record_hash)).toEqual([
      run.gate.record_hash,
      run.a2a?.evidence.remote_record_hash,
      run.a2a?.followup.record_hash,
      run.adk_js?.decision.record_hash,
      run.adk_js?.outcome.record_hash,
    ])
    expect(run.analytics_rows[3]?.protocol).toBe('ADK JS')
    expect(run.analytics_rows[4]?.protocol).toBe('ADK JS')
    expect(run.caveats.join(' ')).toContain('committed replay fixture')
    expect(events).toEqual([
      'run_started',
      'step_started:ap2_gate',
      'step_completed',
      'step_started:a2a_handoff',
      'step_completed',
      'step_started:adk_decision',
      'step_completed',
      'step_started:adk_tool_callback',
      'step_completed',
      'run_completed',
    ])
  }, 30000)

  it('documents the bring-your-AP2-merchant packet shape', () => {
    expect(merchantAdapterContract()).toMatchObject({
      endpoint: 'POST /v1/verify-ap2',
      accepted_body: {
        result: expect.any(String),
        evidence: expect.any(String),
        transactionRecord: expect.any(String),
      },
    })
  })
})
