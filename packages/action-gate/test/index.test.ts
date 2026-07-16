// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  ACTION_GATE_DECISION_EVENT_TYPE_URI,
  ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
  buildActionGateDecisionEntry,
  buildActionGateOutcomeEntry,
  hashCanonical,
  runGatedAction,
  signActionGateDecision,
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

  it('fails closed when policy evaluation returns an unknown runtime outcome', async () => {
    let executed = 0
    const result = await runGatedAction({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      action: browserAction({
        action_id: 'action-policy-invalid-outcome',
        args: { instruction: 'refund order' },
        risk: ['external_write', 'payment'],
      }),
      evaluate: () =>
        ({
          outcome: 'unexpected_runtime_value',
          policy_id: 'browser-risk-policy',
          policy_version: '2026-06-28.1',
        }) as never,
      execute: () => {
        executed += 1
        return { ok: true }
      },
      now: (() => {
        let tick = 1_780_000_000_050
        return () => tick++
      })(),
    })

    expect(executed).toBe(0)
    expect(result.state).toBe('policy_error')
    expect(result.decision.entry.policy).toMatchObject({
      outcome: 'error',
      policy_id: 'action-gate-policy-evaluator',
      version: 'error',
    })
    expect(result.decision.entry.policy.reason).toContain(
      'policy outcome has an invalid value',
    )
    expect(result.verification).toEqual({ valid: true, issues: [] })
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

  it('accepts a caller-supplied args digest without raw action arguments', () => {
    const argsDigest = hashCanonical({
      orderId: '1042',
      refundAmount: '284.00',
      cancelFulfillment: true,
    })
    const entry = buildActionGateDecisionEntry({
      action: browserAction({
        action_id: 'action-hash-only',
        args: undefined,
        args_digest: argsDigest,
      }),
      policy: {
        outcome: 'allow',
        policy_id: 'refund-exception-policy',
        policy_version: 'refund_exception_v1',
      },
      timestamp: '2026-07-16T14:00:00.000Z',
    })

    expect(entry.args_digest).toBe(argsDigest)
  })

  it('rejects raw action arguments that contradict a caller-supplied digest', () => {
    expect(() =>
      buildActionGateDecisionEntry({
        action: browserAction({
          action_id: 'action-contradictory-args',
          args: { orderId: '1042', refundAmount: '284.00' },
          args_digest: hashCanonical({ orderId: 'different' }),
        }),
        policy: {
          outcome: 'allow',
          policy_id: 'refund-exception-policy',
          policy_version: 'refund_exception_v1',
        },
        timestamp: '2026-07-16T14:00:00.000Z',
      }),
    ).toThrow('args_digest does not match action args')
  })

  it('accepts a caller-supplied result digest without raw outcome material', () => {
    const resultDigest = hashCanonical({
      executionState: 'executed',
      resultHash: hashCanonical({ status: 'accepted' }),
      outcomeHash: hashCanonical({ refundId: 're_1042' }),
    })
    const entry = buildActionGateOutcomeEntry({
      status: 'executed',
      run_id: 'refund-run-1042',
      action_id: 'refund-order',
      decision_id:
        'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      decision_record_hash:
        'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      executed: true,
      timestamp: '2026-07-16T14:01:00.000Z',
      result_digest: resultDigest,
    })

    expect(entry.result_digest).toBe(resultDigest)
  })

  it('rejects raw outcome material that contradicts a caller-supplied digest', () => {
    expect(() =>
      buildActionGateOutcomeEntry({
        status: 'executed',
        run_id: 'refund-run-1042',
        action_id: 'refund-order',
        decision_id:
          'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        decision_record_hash:
          'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        executed: true,
        timestamp: '2026-07-16T14:01:00.000Z',
        result: { refundId: 're_1042', status: 'succeeded' },
        result_digest: hashCanonical({ refundId: 'different' }),
      }),
    ).toThrow('result_digest does not match result')
  })

  it('rejects a malformed caller-supplied result digest', () => {
    expect(() =>
      buildActionGateOutcomeEntry({
        status: 'executed',
        run_id: 'refund-run-1042',
        action_id: 'refund-order',
        decision_id:
          'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        decision_record_hash:
          'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        executed: true,
        timestamp: '2026-07-16T14:01:00.000Z',
        result_digest: 'sha256:not-a-valid-digest' as never,
      }),
    ).toThrow('result_digest must be sha256:<64 lowercase hex>')
  })

  it('rejects a non-boolean executed flag while building an outcome', () => {
    expect(() =>
      buildActionGateOutcomeEntry({
        status: 'executed',
        run_id: 'refund-run-1042',
        action_id: 'refund-order',
        decision_id:
          'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        decision_record_hash:
          'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        executed: 'false' as never,
        timestamp: '2026-07-16T14:01:00.000Z',
        result_digest: hashCanonical({ refundId: 're_1042' }),
      }),
    ).toThrow('executed must be a boolean')
  })

  it('rejects an unknown outcome status while building an outcome', () => {
    expect(() =>
      buildActionGateOutcomeEntry({
        status: 'unexpected_runtime_value' as never,
        run_id: 'refund-run-1042',
        action_id: 'refund-order',
        decision_id:
          'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        decision_record_hash:
          'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        executed: false,
        timestamp: '2026-07-16T14:01:00.000Z',
      }),
    ).toThrow('outcome status has an invalid value')
  })

  it('rejects a decision sidecar whose policy no longer matches its commitments', async () => {
    const { result } = await runOutcome('allow')
    const tamperedDecision = {
      ...result.decision,
      entry: {
        ...result.decision.entry,
        policy: {
          ...result.decision.entry.policy,
          reason: 'tampered after signing',
        },
      },
    }

    const verification = await verifyActionGateRun({
      decision: tamperedDecision,
      outcome: result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_entry_id_mismatch',
    )
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_result_commitment_mismatch',
    )
  })

  it('rejects an outcome sidecar whose result digest changed after signing', async () => {
    const { result } = await runOutcome('allow')
    const tamperedOutcome = {
      ...result.outcome,
      entry: {
        ...result.outcome.entry,
        result_digest: hashCanonical({ ok: false }),
      },
    }

    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome: tamperedOutcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_entry_id_mismatch',
    )
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_result_commitment_mismatch',
    )
  })

  it('rejects a decision whose state contradicts its committed policy outcome', async () => {
    const { result } = await runOutcome('allow')
    const contradictoryDecision = {
      ...result.decision,
      entry: {
        ...result.decision.entry,
        policy: {
          ...result.decision.entry.policy,
          outcome: 'block' as const,
        },
      },
    }
    const verification = await verifyActionGateRun({
      decision: contradictoryDecision,
      outcome: result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_state_policy_mismatch',
    )
  })

  it('rejects a decision with an unknown committed policy outcome', async () => {
    const { result } = await runOutcome('allow')
    const invalidWithoutId = {
      ...result.decision.entry,
      policy: {
        ...result.decision.entry.policy,
        outcome: 'unexpected_runtime_value',
      },
    }
    const { decision_id: _, ...canonicalFields } = invalidWithoutId
    const invalidDecision = {
      ...result.decision,
      entry: {
        ...canonicalFields,
        decision_id: hashCanonical(canonicalFields),
      },
    }

    const verification = await verifyActionGateRun({
      decision: invalidDecision as typeof result.decision,
      outcome: result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_policy_outcome_invalid',
    )
  })

  it('rejects an executed status that claims the action did not execute', async () => {
    const { result } = await runOutcome('allow')
    const contradictoryOutcome = {
      ...result.outcome,
      entry: {
        ...result.outcome.entry,
        executed: false,
      },
    }
    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome: contradictoryOutcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_status_execution_mismatch',
    )
  })

  it('rejects a local decision sidecar that no longer describes the signed action', async () => {
    const { result } = await runOutcome('allow')
    const contradictoryDecision = {
      ...result.decision,
      sidecar: {
        ...result.decision.sidecar,
        action: {
          ...result.decision.sidecar.action,
          tool_name: 'browser.tampered',
        },
      },
    }
    const verification = await verifyActionGateRun({
      decision: contradictoryDecision,
      outcome: result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_sidecar_action_mismatch',
    )
  })

  it('rejects duplicated raw args that drift from the signed decision digest', async () => {
    const { result } = await runOutcome('allow')
    const contradictoryDecision = {
      ...result.decision,
      sidecar: {
        ...result.decision.sidecar,
        args: { instruction: 'tampered sidecar payload' },
      },
    }
    const verification = await verifyActionGateRun({
      decision: contradictoryDecision,
      outcome: result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'decision_sidecar_args_mismatch',
    )
  })

  it('refuses to sign a manually constructed decision with contradictory semantics', async () => {
    const action = browserAction({ action_id: 'action-manual-contradiction' })
    const validEntry = buildActionGateDecisionEntry({
      action,
      policy: {
        outcome: 'allow',
        policy_id: 'browser-risk-policy',
        policy_version: '2026-06-28.1',
      },
      timestamp: '2026-07-16T14:00:00.000Z',
    })
    const contradictoryWithoutId = {
      ...validEntry,
      policy: {
        ...validEntry.policy,
        outcome: 'block' as const,
      },
    }
    const { decision_id: _, ...canonicalFields } = contradictoryWithoutId
    const contradictoryEntry = {
      ...canonicalFields,
      decision_id: hashCanonical(canonicalFields),
    }

    await expect(
      signActionGateDecision({
        entry: contradictoryEntry,
        action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        timestampMs: 1_752_672_000_000,
      }),
    ).rejects.toThrow('decision state does not match policy outcome')
  })

  it('refuses to sign a manually constructed decision with an unknown policy outcome', async () => {
    const action = browserAction({ action_id: 'action-manual-invalid-policy' })
    const validEntry = buildActionGateDecisionEntry({
      action,
      policy: {
        outcome: 'allow',
        policy_id: 'browser-risk-policy',
        policy_version: '2026-06-28.1',
      },
      timestamp: '2026-07-16T14:00:00.000Z',
    })
    const invalidWithoutId = {
      ...validEntry,
      policy: {
        ...validEntry.policy,
        outcome: 'unexpected_runtime_value',
      },
    }
    const { decision_id: _, ...canonicalFields } = invalidWithoutId
    const invalidEntry = {
      ...canonicalFields,
      decision_id: hashCanonical(canonicalFields),
    }

    await expect(
      signActionGateDecision({
        entry: invalidEntry as typeof validEntry,
        action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        timestampMs: 1_752_672_000_000,
      }),
    ).rejects.toThrow('policy outcome has an invalid value')
  })

  it('refuses to sign manually constructed entries with the wrong schema', async () => {
    const action = browserAction({ action_id: 'action-wrong-schema' })
    const validDecision = buildActionGateDecisionEntry({
      action,
      policy: {
        outcome: 'allow',
        policy_id: 'browser-risk-policy',
        policy_version: '2026-06-28.1',
      },
      timestamp: '2026-07-16T14:00:00.000Z',
    })
    const wrongDecisionFields = {
      ...validDecision,
      schema: 'wrong.decision.schema',
    }
    const { decision_id: _, ...decisionFields } = wrongDecisionFields
    const wrongDecision = {
      ...decisionFields,
      decision_id: hashCanonical(decisionFields),
    }

    await expect(
      signActionGateDecision({
        entry: wrongDecision as typeof validDecision,
        action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        timestampMs: 1_752_672_000_000,
      }),
    ).rejects.toThrow('decision entry uses the wrong schema')
  })

  it('refuses outcome status payloads with contradictory error material', async () => {
    const { result } = await runOutcome('allow')
    const invalidExecutedFields = {
      ...result.outcome.entry,
      error: { name: 'Error', message: 'cannot coexist with executed' },
    }
    const { outcome_id: _, ...outcomeFields } = invalidExecutedFields
    const invalidExecuted = {
      ...outcomeFields,
      outcome_id: hashCanonical(outcomeFields),
    }

    await expect(
      signActionGateOutcome({
        entry: invalidExecuted,
        action: result.decision.sidecar.action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        decisionRecordHash: result.decision.record_hash,
        timestampMs: 1_752_672_060_000,
      }),
    ).rejects.toThrow('outcome status contradicts result or error material')

    const missingError = buildActionGateOutcomeEntry({
      status: 'execution_error',
      run_id: result.decision.entry.run_id,
      action_id: result.decision.entry.action_id,
      decision_id: result.decision.entry.decision_id,
      decision_record_hash: result.decision.record_hash,
      executed: true,
      timestamp: '2026-07-16T14:01:00.000Z',
    })
    await expect(
      signActionGateOutcome({
        entry: missingError,
        action: result.decision.sidecar.action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        decisionRecordHash: result.decision.record_hash,
        timestampMs: 1_752_672_060_000,
      }),
    ).rejects.toThrow('outcome status contradicts result or error material')
  })

  it('refuses to sign an outcome whose action identity drifted', async () => {
    const { result } = await runOutcome('allow')

    await expect(
      signActionGateOutcome({
        entry: result.outcome.entry,
        action: browserAction({
          run_id: 'different-run',
          action_id: result.outcome.entry.action_id,
        }),
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        decisionRecordHash: result.decision.record_hash,
        timestampMs: 1_752_672_060_000,
      }),
    ).rejects.toThrow('action does not match outcome entry')
  })

  it('refuses to sign an outcome against a contradictory decision record hash', async () => {
    const { result } = await runOutcome('allow')

    await expect(
      signActionGateOutcome({
        entry: result.outcome.entry,
        action: result.decision.sidecar.action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        decisionRecordHash:
          'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        timestampMs: 1_752_672_060_000,
      }),
    ).rejects.toThrow(
      'decisionRecordHash does not match outcome entry decision_record_hash',
    )
  })

  it('refuses to sign a manually constructed outcome with a malformed result digest', async () => {
    const { result } = await runOutcome('allow')
    const invalidWithoutId = {
      ...result.outcome.entry,
      result_digest: 'sha256:not-a-valid-digest',
    }
    const { outcome_id: _, ...canonicalFields } = invalidWithoutId
    const invalidEntry = {
      ...canonicalFields,
      outcome_id: hashCanonical(canonicalFields),
    }

    await expect(
      signActionGateOutcome({
        entry: invalidEntry as typeof result.outcome.entry,
        action: result.decision.sidecar.action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        decisionRecordHash: result.decision.record_hash,
        timestampMs: 1_752_672_060_000,
      }),
    ).rejects.toThrow('result_digest must be sha256:<64 lowercase hex>')
  })

  it('refuses to sign a manually constructed outcome with a non-boolean executed flag', async () => {
    const { result } = await runOutcome('allow')
    const invalidWithoutId = {
      ...result.outcome.entry,
      executed: 'false',
    }
    const { outcome_id: _, ...canonicalFields } = invalidWithoutId
    const invalidEntry = {
      ...canonicalFields,
      outcome_id: hashCanonical(canonicalFields),
    }

    await expect(
      signActionGateOutcome({
        entry: invalidEntry as typeof result.outcome.entry,
        action: result.decision.sidecar.action,
        privateKey: PRIVATE_KEY,
        contextId: CONTEXT_ID,
        decisionRecordHash: result.decision.record_hash,
        timestampMs: 1_752_672_060_000,
      }),
    ).rejects.toThrow('executed must be a boolean')
  })

  it('rejects a verified outcome entry with a malformed result digest', async () => {
    const { result } = await runOutcome('allow')
    const invalidWithoutId = {
      ...result.outcome.entry,
      result_digest: 'sha256:not-a-valid-digest',
    }
    const { outcome_id: _, ...canonicalFields } = invalidWithoutId
    const invalidOutcome = {
      ...result.outcome,
      entry: {
        ...canonicalFields,
        outcome_id: hashCanonical(canonicalFields),
      },
    }

    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome: invalidOutcome as typeof result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_result_digest_invalid',
    )
  })

  it('rejects a verified outcome entry with a non-boolean executed flag', async () => {
    const { result } = await runOutcome('allow')
    const invalidWithoutId = {
      ...result.outcome.entry,
      executed: 'false',
    }
    const { outcome_id: _, ...canonicalFields } = invalidWithoutId
    const invalidOutcome = {
      ...result.outcome,
      entry: {
        ...canonicalFields,
        outcome_id: hashCanonical(canonicalFields),
      },
    }

    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome: invalidOutcome as typeof result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_executed_invalid',
    )
  })

  it('rejects a verified outcome entry with an unknown status', async () => {
    const { result } = await runOutcome('allow')
    const invalidWithoutId = {
      ...result.outcome.entry,
      status: 'unexpected_runtime_value',
      executed: false,
    }
    const { outcome_id: _, ...canonicalFields } = invalidWithoutId
    const invalidOutcome = {
      ...result.outcome,
      entry: {
        ...canonicalFields,
        outcome_id: hashCanonical(canonicalFields),
      },
    }

    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome: invalidOutcome as typeof result.outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_status_invalid',
    )
  })

  it('rejects an outcome signed under a different context', async () => {
    const { result } = await runOutcome('allow')
    const outcome = await signActionGateOutcome({
      entry: result.outcome.entry,
      action: result.decision.sidecar.action,
      privateKey: PRIVATE_KEY,
      contextId: '6f9a8a2b68f94a5cb7f9361b2c8d4e10',
      decisionRecordHash: result.decision.record_hash,
      chainTailHex: result.decision.record_hash.slice('sha256:'.length),
      timestampMs: 1_752_672_060_000,
      result: result.result,
    })
    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'context_id_mismatch',
    )
  })

  it('rejects an outcome signed by a different host identity', async () => {
    const { result } = await runOutcome('allow')
    const outcome = await signActionGateOutcome({
      entry: result.outcome.entry,
      action: result.decision.sidecar.action,
      privateKey: new Uint8Array(32).fill(8),
      contextId: CONTEXT_ID,
      decisionRecordHash: result.decision.record_hash,
      chainTailHex: result.decision.record_hash.slice('sha256:'.length),
      timestampMs: 1_752_672_060_000,
      result: result.result,
    })
    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'creator_key_mismatch',
    )
  })

  it('rejects an outcome outside the decision chronology chain', async () => {
    const { result } = await runOutcome('allow')
    const outcome = await signActionGateOutcome({
      entry: result.outcome.entry,
      action: result.decision.sidecar.action,
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      decisionRecordHash: result.decision.record_hash,
      chainTailHex:
        '3333333333333333333333333333333333333333333333333333333333333333',
      timestampMs: 1_752_672_060_000,
      result: result.result,
    })
    const verification = await verifyActionGateRun({
      decision: result.decision,
      outcome,
    })

    expect(verification.valid).toBe(false)
    expect(verification.issues.map((issue) => issue.code)).toContain(
      'outcome_chain_root_mismatch',
    )
  })

  it('keeps raw args absent from a hash-only decision sidecar', async () => {
    const action = browserAction({
      action_id: 'action-hash-only-sidecar',
      args: undefined,
      args_digest: hashCanonical({ orderId: '1042', refundAmount: '284.00' }),
    })
    const entry = buildActionGateDecisionEntry({
      action,
      policy: {
        outcome: 'allow',
        policy_id: 'refund-exception-policy',
        policy_version: 'refund_exception_v1',
      },
      timestamp: '2026-07-16T14:00:00.000Z',
    })
    const decision = await signActionGateDecision({
      entry,
      action,
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      timestampMs: 1_752_672_000_000,
    })

    expect(decision.sidecar).not.toHaveProperty('args')
  })

  it('verifies a split-phase allowed decision that the runtime reports as not executed', async () => {
    const action = browserAction({
      action_id: 'action-not-executed',
      args: undefined,
      args_digest: hashCanonical({ orderId: '1042', refundAmount: '284.00' }),
    })
    const decisionEntry = buildActionGateDecisionEntry({
      action,
      policy: {
        outcome: 'allow',
        policy_id: 'refund-exception-policy',
        policy_version: 'refund_exception_v1',
      },
      timestamp: '2026-07-16T14:00:00.000Z',
    })
    const decision = await signActionGateDecision({
      entry: decisionEntry,
      action,
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      timestampMs: 1_752_672_000_000,
    })
    const outcomeEntry = buildActionGateOutcomeEntry({
      status: 'not_executed',
      run_id: decision.entry.run_id,
      action_id: decision.entry.action_id,
      decision_id: decision.entry.decision_id,
      decision_record_hash: decision.record_hash,
      executed: false,
      timestamp: '2026-07-16T14:01:00.000Z',
      result: { reason: 'runtime declined after approval' },
    })
    const outcome = await signActionGateOutcome({
      entry: outcomeEntry,
      action,
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      decisionRecordHash: decision.record_hash,
      chainTailHex: decision.record_hash.slice('sha256:'.length),
      timestampMs: 1_752_672_060_000,
      result: { reason: 'runtime declined after approval' },
    })

    const verification = await verifyActionGateRun({ decision, outcome })

    expect(verification).toEqual({ valid: true, issues: [] })
  })
})
