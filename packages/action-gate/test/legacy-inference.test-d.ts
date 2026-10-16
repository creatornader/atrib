// SPDX-License-Identifier: Apache-2.0
import {
  runGatedAction,
  createProtectedMcpExecutor,
  type ActionGateRunResult,
  type ProtectedMcpExecutor,
  type StrictCreateProtectedMcpExecutorInput,
  type StrictProtectedMcpExecutor,
} from '../src/index.js'
import type * as ActionGate from '../src/index.js'
import type { StrictMirrorRetention, StrictMirrorUnit } from '@atrib/mcp'

export function reserveSignedRequest(retention: StrictMirrorRetention, unit: StrictMirrorUnit) {
  retention.reserve(unit)
  // @ts-expect-error Reservation identity comes from the signed Request.
  retention.reserve('unsigned-key', unit)
}

interface LegacyEvidence {
  readonly execution: { readonly reported_success: true }
  readonly postcondition: { readonly status: 'passed' | 'failed' }
}

// Existing callers rely on contextual return types preserving nested literals.
export function contextualLegacyCaller(): Promise<ActionGateRunResult<LegacyEvidence>> {
  return runGatedAction({
    action: {
      run_id: 'run',
      action_id: 'action',
      agent_id: 'agent',
      surface: 'test',
      tool_name: 'test',
    },
    evaluate: () => ({ outcome: 'allow', policy_id: 'policy', policy_version: '1' }),
    execute: async () => ({
      execution: { reported_success: true },
      postcondition: { status: 'passed' },
    }),
  })
}

export function contextualProtectedCaller(): ProtectedMcpExecutor<LegacyEvidence> {
  return createProtectedMcpExecutor({
    evaluate: () => ({ outcome: 'allow', policy_id: 'policy', policy_version: '1' }),
    executeUpstream: async () => ({
      execution: { reported_success: true },
      postcondition: { status: 'passed' },
    }),
  })
}

export function strictVariableCaller(
  input: StrictCreateProtectedMcpExecutorInput<LegacyEvidence>,
): StrictProtectedMcpExecutor<LegacyEvidence> {
  return createProtectedMcpExecutor(input)
}

// @ts-expect-error Strict evidence is available only through the protected MCP executor.
export type RemovedGenericStrictInput = ActionGate.StrictRunGatedActionInput<unknown>
