// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  ACTION_GATE_DECISION_EVENT_TYPE_URI,
  ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
  buildActionGateOutcomeEntry,
  runGatedAction,
  signActionGateOutcome,
  verifyActionGateRun,
  type ActionGateActionEnvelope,
  type ActionGatePolicyOutcome,
} from '../src/index.js'

const PRIVATE_KEY = new Uint8Array(32).fill(7)
const CONTEXT_ID = '5f9a8a2b68f94a5cb7f9361b2c8d4e10'

function browserAction(
  overrides: Partial<ActionGateActionEnvelope> = {},
): ActionGateActionEnvelope {
  return {
    run_id: 'browser-run-1',
    action_id: 'action-1',
    agent_id: 'browser-agent',
    surface: 'browser',
    tool_name: 'browser.act',
    args: { instruction: 'read order status' },
    risk: ['credentialed_action'],
    ...overrides,
  }
}

async function runOutcome(outcome: ActionGatePolicyOutcome) {
  let executed = 0
  const result = await runGatedAction({
    privateKey: PRIVATE_KEY,
    contextId: CONTEXT_ID,
    action: browserAction({
      action_id: `action-${outcome}`,
      args: { instruction: `${outcome} fixture` },
      risk: outcome === 'allow' ? ['read_only'] : ['external_write'],
    }),
    evaluate: () => ({
      outcome,
      policy_id: 'browser-risk-policy',
      policy_version: '2026-06-28.1',
      reason: `fixture ${outcome}`,
    }),
    execute: () => {
      executed += 1
      return { ok: true }
    },
    now: (() => {
      let tick = 1_780_000_000_000
      return () => tick++
    })(),
  })
  return { result, executed }
}

describe('@atrib/action-gate', () => {
  it('allows an action and binds the executed outcome to the decision', async () => {
    const { result, executed } = await runOutcome('allow')

    expect(executed).toBe(1)
    expect(result.state).toBe('allowed')
    expect(result.action_executed).toBe(true)
    expect(result.result).toEqual({ ok: true })
    expect(result.decision.record.event_type).toBe(ACTION_GATE_DECISION_EVENT_TYPE_URI)
    expect(result.outcome.record.event_type).toBe(ACTION_GATE_OUTCOME_EVENT_TYPE_URI)
    expect(result.outcome.record.informed_by).toEqual([result.decision.record_hash])
    expect(result.outcome.entry.status).toBe('executed')
    expect(result.verification.valid).toBe(true)
  })

  it('blocks an action before execution and proves the closed gate', async () => {
    const { result, executed } = await runOutcome('block')

    expect(executed).toBe(0)
    expect(result.state).toBe('blocked')
    expect(result.action_executed).toBe(false)
    expect(result.outcome.entry.status).toBe('blocked')
    expect(result.verification.valid).toBe(true)
  })

  it('escalates an action before execution and proves the approval gate', async () => {
    const { result, executed } = await runOutcome('escalate')

    expect(executed).toBe(0)
    expect(result.state).toBe('escalated')
    expect(result.outcome.entry.status).toBe('escalated')
    expect(result.decision.entry.policy.approval).toEqual({ required: true })
    expect(result.verification.valid).toBe(true)
  })

  it('fails closed when policy evaluation returns an error outcome', async () => {
    const { result, executed } = await runOutcome('error')

    expect(executed).toBe(0)
    expect(result.state).toBe('policy_error')
    expect(result.outcome.entry.status).toBe('policy_error')
    expect(result.verification.valid).toBe(true)
  })

  it('fails closed with signed evidence when policy evaluation throws', async () => {
    let executed = 0
    const result = await runGatedAction({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      action: browserAction({
        action_id: 'action-policy-throw',
        args: { instruction: 'send customer email' },
        risk: ['external_write', 'customer_message'],
      }),
      evaluate: () => {
        throw new Error('policy service unavailable')
      },
      execute: () => {
        executed += 1
        return { ok: true }
      },
      now: (() => {
        let tick = 1_780_000_000_100
        return () => tick++
      })(),
    })

    expect(executed).toBe(0)
    expect(result.state).toBe('policy_error')
    expect(result.action_executed).toBe(false)
    expect(result.decision.entry.policy).toMatchObject({
      outcome: 'error',
      policy_id: 'action-gate-policy-evaluator',
      version: 'error',
    })
    expect(result.decision.entry.policy.reason).toContain('policy service unavailable')
    expect(result.outcome.entry.status).toBe('policy_error')
    expect(result.outcome.record.informed_by).toEqual([result.decision.record_hash])
    expect(result.verification.valid).toBe(true)
  })

  it('keeps the decision/outcome proof intact when record delivery fails', async () => {
    let executed = 0
    const result = await runGatedAction({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      action: browserAction({
        action_id: 'action-delivery-failure',
        args: { instruction: 'read customer tier' },
        risk: ['read_only'],
      }),
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'browser-risk-policy',
        policy_version: '2026-06-28.1',
        reason: 'read-only action is allowed',
      }),
      execute: () => {
        executed += 1
        return { ok: true }
      },
      onRecord: (_record, sidecar) => {
        throw new Error(`mirror write failed for ${sidecar.record_kind}`)
      },
      now: (() => {
        let tick = 1_780_000_000_200
        return () => tick++
      })(),
    })

    expect(executed).toBe(1)
    expect(result.state).toBe('allowed')
    expect(result.action_executed).toBe(true)
    expect(result.outcome.record.informed_by).toEqual([result.decision.record_hash])
    expect(result.verification.valid).toBe(true)
    expect(result.record_delivery_errors).toEqual([
      {
        record_kind: 'decision',
        record_hash: result.decision.record_hash,
        name: 'Error',
        message: 'mirror write failed for decision',
      },
      {
        record_kind: 'outcome',
        record_hash: result.outcome.record_hash,
        name: 'Error',
        message: 'mirror write failed for outcome',
      },
    ])
  })

  it('rejects an outcome that points at the wrong decision hash', async () => {
    const { result } = await runOutcome('allow')
    const badEntry = buildActionGateOutcomeEntry({
      status: 'blocked',
      run_id: result.outcome.entry.run_id,
      action_id: result.outcome.entry.action_id,
      decision_id: result.outcome.entry.decision_id,
      decision_record_hash:
        'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      executed: false,
      timestamp: '2026-06-28T00:00:00.000Z',
    })
    const badOutcome = await signActionGateOutcome({
      entry: badEntry,
      action: browserAction({ action_id: 'action-allow' }),
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      decisionRecordHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      timestampMs: 1_780_000_000_010,
    })
    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome: badOutcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_missing_decision_parent',
    )
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_record_hash_mismatch',
    )
  })
})
