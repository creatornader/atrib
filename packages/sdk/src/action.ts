// SPDX-License-Identifier: Apache-2.0

import { createJsonCommitment, createToolNameCommitment } from '@atrib/mcp'
import type { AttestInput, AttestResult } from './attest.js'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface ActionExecutionContext {
  /** Signed request record. Null record_hash means attribution degraded. */
  request: AttestResult
}

export interface ActionInput<TArgs extends JsonObject, TResult extends JsonValue> {
  /** Verbatim local action name. Only its SHA-256 commitment enters signed bytes. */
  name: string
  /** JSON arguments committed with a fresh 16-byte salt. */
  args: TArgs
  /** Application-owned execution boundary. */
  execute: (context: ActionExecutionContext) => Promise<TResult> | TResult
  context_id?: string
  informed_by?: string[]
  allow_unresolved_informed_by?: boolean
}

export interface ActionSuccess<TResult extends JsonValue> {
  ok: true
  result: TResult
  request: AttestResult
  outcome: AttestResult
}

export interface ActionFailure {
  ok: false
  error: unknown
  request: AttestResult
  outcome: AttestResult
}

export type ActionResult<TResult extends JsonValue> = ActionSuccess<TResult> | ActionFailure

export type AttestActionRecord = (input: AttestInput) => Promise<AttestResult>

function errorEnvelope(error: unknown): JsonObject {
  return {
    isError: true,
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/**
 * Run one application action through the recommended paired evidence path.
 *
 * The request is signed before execution. A linked terminal outcome is signed
 * for both success and failure. Attribution failures never block execution.
 */
export async function runVerifiableAction<TArgs extends JsonObject, TResult extends JsonValue>(
  attest: AttestActionRecord,
  input: ActionInput<TArgs, TResult>,
): Promise<ActionResult<TResult>> {
  if (input.name.trim() === '') {
    throw new TypeError('atrib: action name must not be empty')
  }

  const toolName = createToolNameCommitment(input.name)
  const argsCommitment = createJsonCommitment(input.args, 'salted-sha256')
  const request = await attest({
    event_type: 'tool_call',
    content: {
      action_phase: 'request',
      tool_name: input.name,
      args: input.args,
    },
    tool_name: toolName,
    args_hash: argsCommitment.hash,
    args_salt: argsCommitment.salt,
    ...(input.context_id !== undefined ? { context_id: input.context_id } : {}),
    ...(input.informed_by !== undefined ? { informed_by: input.informed_by } : {}),
    ...(input.allow_unresolved_informed_by !== undefined
      ? { allow_unresolved_informed_by: input.allow_unresolved_informed_by }
      : {}),
  })

  const linkedContext = request.context_id ?? input.context_id
  const linkedHash = request.record_hash
  const outcomeBase = {
    event_type: 'tool_call',
    tool_name: toolName,
    args_hash: argsCommitment.hash,
    args_salt: argsCommitment.salt,
    ...(linkedContext !== undefined && linkedContext !== null ? { context_id: linkedContext } : {}),
    ...(linkedHash !== null
      ? { chain_root: linkedHash, informed_by: [linkedHash] }
      : input.informed_by !== undefined
        ? { informed_by: input.informed_by }
        : {}),
  } satisfies Omit<AttestInput, 'content'>

  try {
    const result = await input.execute({ request })
    const resultCommitment = createJsonCommitment(result, 'salted-sha256')
    const outcome = await attest({
      ...outcomeBase,
      content: {
        action_phase: 'outcome',
        tool_name: input.name,
        args: input.args,
        result,
        is_error: false,
      },
      result_hash: resultCommitment.hash,
      result_salt: resultCommitment.salt,
    })
    return { ok: true, result, request, outcome }
  } catch (error) {
    const failure = errorEnvelope(error)
    const resultCommitment = createJsonCommitment(failure, 'salted-sha256')
    const outcome = await attest({
      ...outcomeBase,
      content: {
        action_phase: 'outcome',
        tool_name: input.name,
        args: input.args,
        result: failure,
        is_error: true,
      },
      result_hash: resultCommitment.hash,
      result_salt: resultCommitment.salt,
    })
    return { ok: false, error, request, outcome }
  }
}
