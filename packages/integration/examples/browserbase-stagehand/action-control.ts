// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'

export const BROWSERBASE_ACTION_POLICY_SCHEMA = 'atrib.browserbase.action_policy_decision.v1'
export const BROWSERBASE_ACTION_POLICY_EVENT_TYPE =
  'https://browserbase-action-gate.atrib.dev/v1/decision'
export const BROWSERBASE_ACTION_POLICY_VERSION = 'browserbase-action-gate-v0'

export type BrowserbaseActionPolicyMode = 'allow' | 'block' | 'escalate'

export type BrowserbaseActionPolicyOptions = {
  mode: BrowserbaseActionPolicyMode
  targetUrl: string
  action: string
  allowedOrigins: string[]
}

export type BrowserbaseActionControlInput = BrowserbaseActionPolicyOptions & {
  packet: string
  toolName: string
  observedStateHash: string | null
  observedRecordHash: string | null
}

export type BrowserbaseActionPolicyDecisionContent = {
  schema: typeof BROWSERBASE_ACTION_POLICY_SCHEMA
  packet: string
  tool_name: string
  decision_boundary: 'pre_action'
  action_class: 'browser_act'
  risk_class: 'browser_state_change'
  target_url_hash: string
  proposed_action_hash: string
  observed_state_hash: string | null
  observed_record_hash: string | null
  allowed_origin_hashes: string[]
}

export type BrowserbaseActionControlDecision = {
  decision: BrowserbaseActionPolicyMode
  policy_version: typeof BROWSERBASE_ACTION_POLICY_VERSION
  reason_codes: string[]
  content: BrowserbaseActionPolicyDecisionContent
}

export function hashBrowserbasePolicyText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

export function normalizeBrowserbaseActionPolicyMode(
  value: string | undefined,
): BrowserbaseActionPolicyMode {
  if (value === 'block' || value === 'escalate') return value
  return 'allow'
}

export function browserbaseAllowedOrigins(env: NodeJS.ProcessEnv, targetUrl: string): string[] {
  const configured = env.ATRIB_BROWSERBASE_ALLOWED_ORIGINS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  if (configured && configured.length > 0) return configured

  try {
    return [new URL(targetUrl).origin]
  } catch {
    return []
  }
}

export function decideBrowserbaseActionControl(
  input: BrowserbaseActionControlInput,
): BrowserbaseActionControlDecision {
  const reasonCodes: string[] = []
  let decision: BrowserbaseActionPolicyMode = input.mode

  if (!input.observedStateHash || !input.observedRecordHash) {
    decision = 'block'
    reasonCodes.push('missing_observed_state')
  }

  if (!targetOriginAllowed(input.targetUrl, input.allowedOrigins)) {
    decision = 'block'
    reasonCodes.push('target_origin_not_allowed')
  }

  if (input.mode === 'block') {
    decision = 'block'
    reasonCodes.push('operator_policy_block')
  }
  if (input.mode === 'escalate' && decision !== 'block') {
    decision = 'escalate'
    reasonCodes.push('human_approval_required')
  }
  if (reasonCodes.length === 0) {
    reasonCodes.push('policy_allow')
  }

  return {
    decision,
    policy_version: BROWSERBASE_ACTION_POLICY_VERSION,
    reason_codes: reasonCodes,
    content: {
      schema: BROWSERBASE_ACTION_POLICY_SCHEMA,
      packet: input.packet,
      tool_name: input.toolName,
      decision_boundary: 'pre_action',
      action_class: 'browser_act',
      risk_class: 'browser_state_change',
      target_url_hash: hashBrowserbasePolicyText(input.targetUrl),
      proposed_action_hash: hashBrowserbasePolicyText(input.action),
      observed_state_hash: input.observedStateHash,
      observed_record_hash: input.observedRecordHash,
      allowed_origin_hashes: input.allowedOrigins.map((origin) =>
        hashBrowserbasePolicyText(origin),
      ),
    },
  }
}

function targetOriginAllowed(targetUrl: string, allowedOrigins: string[]): boolean {
  try {
    const origin = new URL(targetUrl).origin
    return allowedOrigins.includes(origin)
  } catch {
    return false
  }
}
