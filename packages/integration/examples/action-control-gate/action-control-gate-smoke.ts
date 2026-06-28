// SPDX-License-Identifier: Apache-2.0

import {
  ACTION_GATE_DECISION_EVENT_TYPE_URI,
  ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
  runGatedAction,
  type ActionGateActionEnvelope,
  type ActionGatePolicyDecision,
} from '@atrib/action-gate'

const PRIVATE_KEY = new Uint8Array(32).fill(23)
const CONTEXT_ID = '8b13a745e2d94f5d8ff0bcf3ad574901'

export interface ActionControlGateSmokeResult {
  ok: true
  strategy: 'atrib-action-control-gate-proof-v1'
  contract: {
    package: '@atrib/action-gate'
    event_types: {
      decision: typeof ACTION_GATE_DECISION_EVENT_TYPE_URI
      outcome: typeof ACTION_GATE_OUTCOME_EVENT_TYPE_URI
    }
    states: ['allowed', 'blocked', 'escalated']
  }
  runs: Array<{
    action_id: string
    tool_name: string
    state: 'allowed' | 'blocked' | 'escalated'
    action_executed: boolean
    decision_record_hash: string
    outcome_record_hash: string
    outcome_status: string
    outcome_informed_by_decision: boolean
    verification_valid: boolean
  }>
  proof: {
    allowed_action_executed: boolean
    blocked_action_body_executed: boolean
    escalated_action_body_executed: boolean
    all_verifications_valid: boolean
    all_outcomes_cite_decisions: boolean
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
    raw_browser_payloads_omitted: true
  }
  caveats: string[]
}

export async function runActionControlGateSmoke(): Promise<ActionControlGateSmokeResult> {
  const executed = new Set<string>()
  const actions: ActionGateActionEnvelope[] = [
    {
      run_id: 'browser-gate-demo',
      action_id: 'observe-order-status',
      agent_id: 'browser-agent-fixture',
      surface: 'browser',
      tool_name: 'browser.observe',
      args: { selector: '#order-status' },
      risk: ['read_only'],
    },
    {
      run_id: 'browser-gate-demo',
      action_id: 'submit-refund',
      agent_id: 'browser-agent-fixture',
      surface: 'browser',
      tool_name: 'browser.submit',
      args: { form: 'refund', amount_cents: 11900 },
      risk: ['external_write', 'payment'],
    },
    {
      run_id: 'browser-gate-demo',
      action_id: 'send-customer-email',
      agent_id: 'browser-agent-fixture',
      surface: 'browser',
      tool_name: 'browser.act',
      args: { instruction: 'send the customer a resolution email' },
      risk: ['external_write', 'customer_message'],
    },
  ]

  let tick = 1_780_100_000_000
  const runs = []
  for (const action of actions) {
    const result = await runGatedAction({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      action,
      evaluate: ({ action: proposed }) => policyFor(proposed),
      execute: () => {
        executed.add(action.action_id)
        return { status: 'ok', action_id: action.action_id }
      },
      now: () => tick++,
    })
    runs.push({
      action_id: action.action_id,
      tool_name: action.tool_name,
      state: result.state as 'allowed' | 'blocked' | 'escalated',
      action_executed: result.action_executed,
      decision_record_hash: result.decision.record_hash,
      outcome_record_hash: result.outcome.record_hash,
      outcome_status: result.outcome.entry.status,
      outcome_informed_by_decision:
        result.outcome.record.informed_by?.includes(result.decision.record_hash) ?? false,
      verification_valid: result.verification.valid,
    })
  }

  return {
    ok: true,
    strategy: 'atrib-action-control-gate-proof-v1',
    contract: {
      package: '@atrib/action-gate',
      event_types: {
        decision: ACTION_GATE_DECISION_EVENT_TYPE_URI,
        outcome: ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
      },
      states: ['allowed', 'blocked', 'escalated'],
    },
    runs,
    proof: {
      allowed_action_executed: executed.has('observe-order-status'),
      blocked_action_body_executed: executed.has('submit-refund'),
      escalated_action_body_executed: executed.has('send-customer-email'),
      all_verifications_valid: runs.every((run) => run.verification_valid),
      all_outcomes_cite_decisions: runs.every((run) => run.outcome_informed_by_decision),
    },
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
      raw_browser_payloads_omitted: true,
    },
    caveats: [
      'This proof uses browser-shaped fixture actions, not a live Browserbase session.',
      'Host identity, auth, and approval UI remain host-owned.',
    ],
  }
}

function policyFor(action: ActionGateActionEnvelope): ActionGatePolicyDecision {
  const risk = new Set(action.risk ?? [])
  if (risk.has('customer_message')) {
    return {
      outcome: 'escalate',
      policy_id: 'browser-high-impact-action-policy',
      policy_version: '2026-06-28.1',
      reason: 'customer messages need review before execution',
      approval: {
        required: true,
        approval_id: `${action.run_id}:${action.action_id}:approval`,
        reviewer_hint: 'support-lead',
      },
    }
  }
  if (risk.has('payment') || risk.has('external_write')) {
    return {
      outcome: 'block',
      policy_id: 'browser-high-impact-action-policy',
      policy_version: '2026-06-28.1',
      reason: 'payment-impacting browser writes are blocked in fixture policy',
    }
  }
  return {
    outcome: 'allow',
    policy_id: 'browser-high-impact-action-policy',
    policy_version: '2026-06-28.1',
    reason: 'read-only browser observation is allowed',
  }
}

const result = await runActionControlGateSmoke()
console.log(JSON.stringify(result, null, 2))
