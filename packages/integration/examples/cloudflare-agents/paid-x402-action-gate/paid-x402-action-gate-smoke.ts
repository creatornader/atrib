// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import {
  ACTION_GATE_DECISION_EVENT_TYPE_URI,
  ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
  runGatedAction,
  type ActionGateActionEnvelope,
  type ActionGatePolicyDecision,
  type Sha256Uri,
} from '@atrib/action-gate'

const PRIVATE_KEY = new Uint8Array(32).fill(42)
const CONTEXT_ID = '83cf8d4891a3cda4a2c64ffa74dceb09'
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00'

export interface CloudflareX402PaidAgentProofResult {
  ok: true
  strategy: 'cloudflare-x402-paid-agent-action-gate-proof-v1'
  scope: {
    cloudflare_runtime: 'workers-agents'
    x402_mode: 'fixture-over-current-worker-primitives'
    gateway_beta_access: false
    gateway_ingest_slot: 'future-lifecycle-export'
  }
  contract: {
    package: '@atrib/action-gate'
    event_types: {
      decision: typeof ACTION_GATE_DECISION_EVENT_TYPE_URI
      outcome: typeof ACTION_GATE_OUTCOME_EVENT_TYPE_URI
    }
  }
  paid_action: {
    run_id: string
    action_id: string
    agent_id: string
    surface: string
    tool_name: string
    risk: readonly string[]
    price: string
    network: string
    asset: string
    route_id: string
    rule_id: string
  }
  signed_records: {
    decision_record_hash: Sha256Uri
    outcome_record_hash: Sha256Uri
    decision_state: 'allowed'
    outcome_status: 'executed'
    outcome_informed_by_decision: boolean
    verification_valid: boolean
  }
  payment_lifecycle: {
    schema: 'atrib.cloudflare-x402-paid-request-lifecycle.v1'
    source: 'cloudflare_x402_worker_fixture'
    stage: 'origin_response'
    request_id: string
    payment_attempt_id: string
    route_id: string
    rule_id: string
    method: 'POST'
    url_hash: Sha256Uri
    price: string
    network: string
    asset: string
    payer_hash: Sha256Uri
    payee_hash: Sha256Uri
    challenge_hash: Sha256Uri
    payment_response_hash: Sha256Uri
    settlement_reference_hash: Sha256Uri
    origin_response_hash: Sha256Uri
    traceparent: string
    atrib_context_id: string
    agent_session_id: string
    decision_record_hash: Sha256Uri
    outcome_record_hash: Sha256Uri
    verify_status: 'verified'
    settle_status: 'settled'
  }
  proof: {
    paid_action_allowed_by_policy: boolean
    action_executed: boolean
    outcome_cites_decision: boolean
    lifecycle_bound_to_decision: boolean
    lifecycle_bound_to_outcome: boolean
    lifecycle_uses_hash_only_payment_artifacts: boolean
    verification_valid: boolean
  }
  privacy: {
    public_records_hash_only: true
    raw_payment_headers_omitted: true
    raw_wallet_material_omitted: true
    raw_origin_payload_omitted: true
    gateway_logs_omitted: true
  }
  caveats: string[]
}

const paidAction: ActionGateActionEnvelope = {
  run_id: 'cloudflare-x402-paid-agent-demo',
  action_id: 'call-paid-mcp-dataset',
  agent_id: 'cloudflare-agent-fixture',
  surface: 'cloudflare-agents',
  tool_name: 'mcp.paid-dataset.lookup',
  args: {
    method: 'POST',
    url_hash: hashJson({ url: 'https://worker.example/mcp/paid-dataset' }),
    query_hash: hashJson({ query: 'revenue benchmark by segment' }),
  },
  risk: ['payment', 'paid_mcp_tool', 'external_read'],
  refs: {
    traceparent: TRACEPARENT,
    atrib_context_id: CONTEXT_ID,
  },
}

const lifecycleSeed = {
  request_id: 'cf-x402-req-public-fixture-001',
  payment_attempt_id: 'pay-attempt-public-fixture-001',
  route_id: 'route-paid-mcp-dataset',
  rule_id: 'rule-price-cap-usdc-cent',
  price: '0.01',
  network: 'base-sepolia',
  asset: 'USDC',
  url_hash: hashJson({ url: 'https://worker.example/mcp/paid-dataset' }),
  payer_hash: hashJson({ payer: '0xagent-public-fixture' }),
  payee_hash: hashJson({ payee: '0xmerchant-public-fixture' }),
  challenge_hash: hashJson({ status: 402, x402: 'challenge-public-fixture' }),
  payment_response_hash: hashJson({ header: 'PAYMENT-RESPONSE public fixture' }),
  settlement_reference_hash: hashJson({ settlement: 'facilitator-settled-public-fixture' }),
  origin_response_hash: hashJson({ result: 'paid dataset fixture response' }),
}

export async function runCloudflareX402PaidAgentProof(): Promise<CloudflareX402PaidAgentProofResult> {
  let tick = 1_780_400_000_000
  const result = await runGatedAction({
    privateKey: PRIVATE_KEY,
    contextId: CONTEXT_ID,
    action: paidAction,
    evaluate: ({ action }) => policyFor(action),
    execute: () => ({
      status: 'ok',
      request_id: lifecycleSeed.request_id,
      payment_attempt_id: lifecycleSeed.payment_attempt_id,
      origin_response_hash: lifecycleSeed.origin_response_hash,
    }),
    now: () => tick++,
  })

  const outcomeCitesDecision =
    result.outcome.record.informed_by?.includes(result.decision.record_hash) ?? false
  const paymentLifecycle = {
    schema: 'atrib.cloudflare-x402-paid-request-lifecycle.v1' as const,
    source: 'cloudflare_x402_worker_fixture' as const,
    stage: 'origin_response' as const,
    request_id: lifecycleSeed.request_id,
    payment_attempt_id: lifecycleSeed.payment_attempt_id,
    route_id: lifecycleSeed.route_id,
    rule_id: lifecycleSeed.rule_id,
    method: 'POST' as const,
    url_hash: lifecycleSeed.url_hash,
    price: lifecycleSeed.price,
    network: lifecycleSeed.network,
    asset: lifecycleSeed.asset,
    payer_hash: lifecycleSeed.payer_hash,
    payee_hash: lifecycleSeed.payee_hash,
    challenge_hash: lifecycleSeed.challenge_hash,
    payment_response_hash: lifecycleSeed.payment_response_hash,
    settlement_reference_hash: lifecycleSeed.settlement_reference_hash,
    origin_response_hash: lifecycleSeed.origin_response_hash,
    traceparent: TRACEPARENT,
    atrib_context_id: CONTEXT_ID,
    agent_session_id: 'cloudflare-agent-session-public-fixture',
    decision_record_hash: result.decision.record_hash,
    outcome_record_hash: result.outcome.record_hash,
    verify_status: 'verified' as const,
    settle_status: 'settled' as const,
  }

  return {
    ok: true,
    strategy: 'cloudflare-x402-paid-agent-action-gate-proof-v1',
    scope: {
      cloudflare_runtime: 'workers-agents',
      x402_mode: 'fixture-over-current-worker-primitives',
      gateway_beta_access: false,
      gateway_ingest_slot: 'future-lifecycle-export',
    },
    contract: {
      package: '@atrib/action-gate',
      event_types: {
        decision: ACTION_GATE_DECISION_EVENT_TYPE_URI,
        outcome: ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
      },
    },
    paid_action: {
      run_id: paidAction.run_id,
      action_id: paidAction.action_id,
      agent_id: paidAction.agent_id,
      surface: paidAction.surface,
      tool_name: paidAction.tool_name,
      risk: paidAction.risk ?? [],
      price: lifecycleSeed.price,
      network: lifecycleSeed.network,
      asset: lifecycleSeed.asset,
      route_id: lifecycleSeed.route_id,
      rule_id: lifecycleSeed.rule_id,
    },
    signed_records: {
      decision_record_hash: result.decision.record_hash,
      outcome_record_hash: result.outcome.record_hash,
      decision_state: 'allowed',
      outcome_status: 'executed',
      outcome_informed_by_decision: outcomeCitesDecision,
      verification_valid: result.verification.valid,
    },
    payment_lifecycle: paymentLifecycle,
    proof: {
      paid_action_allowed_by_policy: result.state === 'allowed',
      action_executed: result.action_executed,
      outcome_cites_decision: outcomeCitesDecision,
      lifecycle_bound_to_decision:
        paymentLifecycle.decision_record_hash === result.decision.record_hash,
      lifecycle_bound_to_outcome:
        paymentLifecycle.outcome_record_hash === result.outcome.record_hash,
      lifecycle_uses_hash_only_payment_artifacts: [
        paymentLifecycle.url_hash,
        paymentLifecycle.payer_hash,
        paymentLifecycle.payee_hash,
        paymentLifecycle.challenge_hash,
        paymentLifecycle.payment_response_hash,
        paymentLifecycle.settlement_reference_hash,
        paymentLifecycle.origin_response_hash,
      ].every(isSha256Uri),
      verification_valid: result.verification.valid,
    },
    privacy: {
      public_records_hash_only: true,
      raw_payment_headers_omitted: true,
      raw_wallet_material_omitted: true,
      raw_origin_payload_omitted: true,
      gateway_logs_omitted: true,
    },
    caveats: [
      'This proof uses local x402 lifecycle fixtures over current Cloudflare Workers and Agents integration shapes.',
      'It does not call Cloudflare Monetization Gateway beta APIs.',
      'Gateway lifecycle ids and signed exports should replace the fixture source when beta access exposes them.',
    ],
  }
}

function policyFor(action: ActionGateActionEnvelope): ActionGatePolicyDecision {
  const risk = new Set(action.risk ?? [])
  if (!risk.has('payment') || action.tool_name !== 'mcp.paid-dataset.lookup') {
    return {
      outcome: 'block',
      policy_id: 'cloudflare-x402-paid-agent-policy',
      policy_version: '2026-07-08.1',
      reason: 'only the fixed paid MCP fixture is allowed in this proof',
    }
  }
  return {
    outcome: 'allow',
    policy_id: 'cloudflare-x402-paid-agent-policy',
    policy_version: '2026-07-08.1',
    reason: 'paid MCP read is inside the fixture price cap and has hash-only x402 evidence',
    authority: {
      mode: 'host-policy',
      principal_hash: hashJson({ host: 'cloudflare-worker-fixture' }),
    },
    evidence: {
      price: `${lifecycleSeed.price} ${lifecycleSeed.asset}`,
      network: lifecycleSeed.network,
      route_id: lifecycleSeed.route_id,
      rule_id: lifecycleSeed.rule_id,
      challenge_hash: lifecycleSeed.challenge_hash,
      payment_response_hash: lifecycleSeed.payment_response_hash,
    },
  }
}

function hashJson(value: unknown): Sha256Uri {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    )
  }
  return value
}

function isSha256Uri(value: string): value is Sha256Uri {
  return /^sha256:[0-9a-f]{64}$/u.test(value)
}

const result = await runCloudflareX402PaidAgentProof()
console.log(JSON.stringify(result, null, 2))
