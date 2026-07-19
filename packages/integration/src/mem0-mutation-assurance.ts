// SPDX-License-Identifier: Apache-2.0

import {
  runGatedAction,
  type ActionGateActionEnvelope,
  type ActionGateLocalSidecar,
  type ActionGatePolicyDecision,
  type ActionGatePolicyInput,
  type ActionGateRunResult,
  type Sha256Uri,
} from '@atrib/action-gate'
import type { AtribRecord } from '@atrib/mcp'

type MaybePromise<T> = T | Promise<T>

export const MEM0_IDENTITY_METADATA_KEYS = ['actor_id', 'user_id', 'agent_id', 'run_id'] as const

export type Mem0MutationOperation = 'update' | 'delete' | 'delete_all' | 'reset'

export interface Mem0PostconditionCheck {
  readonly name: string
  readonly passed: boolean
}

export interface Mem0MutationEvidence {
  readonly operation: Mem0MutationOperation
  readonly execution: {
    readonly reported_success: true
    readonly summary?: Record<string, string | number | boolean | null>
  }
  readonly postcondition: {
    readonly status: 'passed' | 'failed'
    readonly checks: readonly Mem0PostconditionCheck[]
    readonly error?: { readonly name: string }
  }
}

export interface RunMem0MutationAssuranceInput<TResult> {
  readonly privateKey?: Uint8Array | string
  readonly contextId?: string
  readonly serverUrl?: string
  readonly parentRecordHashes?: readonly Sha256Uri[]
  readonly runId: string
  readonly actionId: string
  readonly agentId: string
  readonly operation: Mem0MutationOperation
  readonly args?: unknown
  readonly risk?: readonly string[]
  readonly refs?: Record<string, string>
  readonly evaluate?: (input: ActionGatePolicyInput) => MaybePromise<ActionGatePolicyDecision>
  readonly execute: () => MaybePromise<TResult>
  readonly summarizeResult?: (
    result: TResult,
  ) => Record<string, string | number | boolean | null> | undefined
  readonly verifyPostcondition: () => MaybePromise<readonly Mem0PostconditionCheck[]>
  readonly now?: () => number
  readonly onRecord?: (record: AtribRecord, sidecar: ActionGateLocalSidecar) => MaybePromise<void>
}

export type Mem0MutationAssuranceResult = ActionGateRunResult<Mem0MutationEvidence>

export async function runMem0MutationAssurance<TResult>(
  input: RunMem0MutationAssuranceInput<TResult>,
): Promise<Mem0MutationAssuranceResult> {
  const action: ActionGateActionEnvelope = {
    run_id: input.runId,
    action_id: input.actionId,
    agent_id: input.agentId,
    surface: 'mem0.memory',
    tool_name: `mem0.memory.${input.operation}`,
    ...(input.args !== undefined ? { args: input.args } : {}),
    risk: input.risk ?? ['memory_mutation'],
    ...(input.parentRecordHashes !== undefined
      ? { parent_record_hashes: input.parentRecordHashes }
      : {}),
    ...(input.refs !== undefined ? { refs: input.refs } : {}),
  }

  return runGatedAction({
    ...(input.privateKey !== undefined ? { privateKey: input.privateKey } : {}),
    ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
    ...(input.serverUrl !== undefined ? { serverUrl: input.serverUrl } : {}),
    ...(input.parentRecordHashes !== undefined
      ? { parentRecordHashes: input.parentRecordHashes }
      : {}),
    action,
    evaluate: input.evaluate ?? mem0IdentityScopePolicy,
    execute: async () => {
      const result = await input.execute()
      let checks: Mem0PostconditionCheck[]
      let postconditionError: { name: string } | undefined
      try {
        checks = [...(await input.verifyPostcondition())]
        if (checks.length === 0) {
          checks.push({ name: 'postcondition_defined', passed: false })
        }
      } catch (error) {
        checks = [{ name: 'postcondition_check_completed', passed: false }]
        postconditionError = { name: normalizeErrorName(error) }
      }
      let summary: Record<string, string | number | boolean | null> | undefined
      if (input.summarizeResult) {
        try {
          summary = input.summarizeResult(result)
        } catch (error) {
          summary = {
            summary_completed: false,
            summary_error_name: normalizeErrorName(error),
          }
        }
      }
      return {
        operation: input.operation,
        execution: {
          reported_success: true,
          ...(summary !== undefined ? { summary } : {}),
        },
        postcondition: {
          status: checks.every((check) => check.passed) ? 'passed' : 'failed',
          checks,
          ...(postconditionError !== undefined ? { error: postconditionError } : {}),
        },
      }
    },
    ...(input.now !== undefined ? { now: input.now } : {}),
    ...(input.onRecord !== undefined ? { onRecord: input.onRecord } : {}),
  })
}

export function mem0IdentityScopePolicy({
  action,
}: ActionGatePolicyInput): ActionGatePolicyDecision {
  const protectedKeys = findProtectedIdentityKeys(action.args)
  if (protectedKeys.length > 0) {
    return {
      outcome: 'block',
      policy_id: 'mem0-identity-scope-policy',
      policy_version: '2026-07-19.1',
      reason: `freeform metadata cannot set identity scope: ${protectedKeys.join(', ')}`,
      authority: { mode: 'host-policy' },
    }
  }

  return {
    outcome: 'allow',
    policy_id: 'mem0-identity-scope-policy',
    policy_version: '2026-07-19.1',
    reason: 'the mutation does not set identity scope through freeform metadata',
    authority: { mode: 'host-policy' },
  }
}

export function findProtectedIdentityKeys(args: unknown): string[] {
  if (!isObject(args)) return []
  const update = isObject(args.update) ? args.update : args
  const metadata = isObject(update.metadata) ? update.metadata : undefined
  if (!metadata) return []

  return MEM0_IDENTITY_METADATA_KEYS.filter((key) =>
    Object.prototype.hasOwnProperty.call(metadata, key),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'Error'
}
