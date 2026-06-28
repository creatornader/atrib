// SPDX-License-Identifier: Apache-2.0

import type {
  PacketPolicyGateDecision,
  PacketPolicyGateInput,
} from '../wrapped-mcp-proof-runner.js'
import {
  decideBrowserbaseActionControl,
  type BrowserbaseActionPolicyOptions,
} from './action-control.js'

export {
  BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
  BROWSERBASE_ACTION_POLICY_SCHEMA,
  BROWSERBASE_ACTION_POLICY_VERSION,
  browserbaseAllowedOrigins,
  hashBrowserbasePolicyText,
  normalizeBrowserbaseActionPolicyMode,
} from './action-control.js'
export type {
  BrowserbaseActionControlDecision,
  BrowserbaseActionControlInput,
  BrowserbaseActionPolicyDecisionContent,
  BrowserbaseActionPolicyMode,
  BrowserbaseActionPolicyOptions,
} from './action-control.js'

export function createBrowserbaseActionPolicyGate(options: BrowserbaseActionPolicyOptions) {
  return (input: PacketPolicyGateInput): PacketPolicyGateDecision | undefined => {
    if (input.call.name !== 'act') return undefined
    return decideBrowserbaseActionPolicy(input, options)
  }
}

export function decideBrowserbaseActionPolicy(
  input: PacketPolicyGateInput,
  options: BrowserbaseActionPolicyOptions,
): PacketPolicyGateDecision {
  const observed = [...input.previous_results].reverse().find((result) => result.name === 'observe')
  const observedRecordFallback = [...input.previous_records]
    .reverse()
    .find((entry) => entry.record.tool_name === 'observe')
  const observedRecordHash = observed?.record_hash ?? observedRecordFallback?.record_hash ?? null
  return decideBrowserbaseActionControl({
    ...options,
    packet: input.packet,
    toolName: input.call.name,
    observedStateHash: observed?.text_hash ?? null,
    observedRecordHash,
  })
}
