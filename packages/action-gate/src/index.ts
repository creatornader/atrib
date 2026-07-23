// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import canonicalize from 'canonicalize'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  getPublicKey,
  hexDecode,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
  verifyRecord,
  EVENT_TYPE_TRANSACTION_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  verifyRecord as verifyRecordAnnotated,
  isTrustedCrossAttested,
  resolveAttestationCorroboration,
  isCorroborated,
  type AttestationInput,
} from '@atrib/verify'

export { evaluateElevation } from './elevation.js'
export type {
  ActionBoundToken,
  Corroborator,
  ElevationDecision,
  ElevationInput,
  ElevationOutcome,
} from './elevation.js'
export {
  checkAndConsumeToken,
  computeActionBinding,
  createMemoryConsumptionStore,
  issueActionToken,
} from './token.js'
export type {
  ActionBindingInput,
  IssuedActionToken,
  TokenCheckInput,
  TokenCheckReason,
  TokenCheckResult,
  TokenConsumptionStore,
} from './token.js'

export const ACTION_GATE_DECISION_EVENT_TYPE_URI =
  'https://atrib.dev/v1/extensions/action-gate/decision' as const
export const ACTION_GATE_OUTCOME_EVENT_TYPE_URI =
  'https://atrib.dev/v1/extensions/action-gate/outcome' as const
export const ACTION_GATE_DECISION_SCHEMA = 'atrib.action-gate.decision.v1' as const
export const ACTION_GATE_OUTCOME_SCHEMA = 'atrib.action-gate.outcome.v1' as const
export const DEFAULT_ACTION_GATE_SERVER_URL = 'action-gate://local' as const

const DECISION_TOOL_NAME = 'atrib.action_gate.decision'
const OUTCOME_TOOL_NAME = 'atrib.action_gate.outcome'
const encoder = new TextEncoder()

type MaybePromise<T> = T | Promise<T>

export type Sha256Uri = `sha256:${string}`
export type ActionGatePolicyOutcome = 'allow' | 'block' | 'escalate' | 'error'
export type ActionGateDecisionState = 'allowed' | 'blocked' | 'escalated' | 'policy_error'
export type ActionGateOutcomeStatus =
  'executed' | 'not_executed' | 'blocked' | 'escalated' | 'policy_error' | 'execution_error'

export interface ActionGateActionEnvelope {
  readonly run_id: string
  readonly action_id: string
  readonly agent_id: string
  readonly surface: string
  readonly tool_name: string
  readonly args?: unknown
  readonly args_digest?: Sha256Uri
  readonly risk?: readonly string[]
  readonly parent_record_hashes?: readonly Sha256Uri[]
  readonly refs?: Record<string, string>
}

export interface ActionGateAuthority {
  readonly mode: 'host-policy' | 'agent-auth' | 'user-auth' | 'service-auth'
  readonly principal_hash?: Sha256Uri
}

export interface ActionGateApproval {
  readonly required: boolean
  readonly approval_id?: string
  readonly reviewer_hint?: string
}

export interface ActionGatePolicyDecision {
  readonly outcome: ActionGatePolicyOutcome
  readonly policy_id: string
  readonly policy_version: string
  readonly reason?: string
  readonly authority?: ActionGateAuthority
  readonly approval?: ActionGateApproval
  readonly evidence?: Record<string, string>
}

export interface ActionGatePolicyInput {
  readonly action: ActionGateActionEnvelope
  readonly timestamp: string
}

export interface ActionGateDecisionPolicy {
  readonly policy_id: string
  readonly version: string
  readonly outcome: ActionGatePolicyOutcome
  readonly reason?: string
  readonly authority: ActionGateAuthority
  readonly approval: ActionGateApproval
  readonly evidence?: Record<string, string>
}

export interface ActionGateDecisionEntry {
  readonly schema: typeof ACTION_GATE_DECISION_SCHEMA
  readonly decision_id: Sha256Uri
  readonly decision_state: ActionGateDecisionState
  readonly run_id: string
  readonly action_id: string
  readonly agent_id: string
  readonly surface: string
  readonly tool_name: string
  readonly args_digest: Sha256Uri
  readonly risk: readonly string[]
  readonly policy: ActionGateDecisionPolicy
  readonly timestamp: string
  readonly parent_record_hashes: readonly Sha256Uri[]
  readonly refs?: Record<string, string>
}

export interface ActionGateOutcomeEntry {
  readonly schema: typeof ACTION_GATE_OUTCOME_SCHEMA
  readonly outcome_id: Sha256Uri
  readonly status: ActionGateOutcomeStatus
  readonly run_id: string
  readonly action_id: string
  readonly decision_id: Sha256Uri
  readonly decision_record_hash: Sha256Uri
  readonly executed: boolean
  readonly result_digest?: Sha256Uri
  readonly error?: { readonly name: string; readonly message: string }
  readonly timestamp: string
}

export interface ActionGateLocalSidecar {
  readonly package: '@atrib/action-gate'
  readonly record_kind: 'decision' | 'outcome'
  readonly record_hash: Sha256Uri
  readonly action: ActionGateActionEnvelope
  readonly decision?: ActionGateDecisionEntry
  readonly outcome?: ActionGateOutcomeEntry
  readonly args?: unknown
  readonly result?: unknown
  readonly informed_by: readonly Sha256Uri[]
}

export interface SignedActionGateDecision {
  readonly record: AtribRecord
  readonly record_hash: Sha256Uri
  readonly entry: ActionGateDecisionEntry
  readonly sidecar: ActionGateLocalSidecar
}

export interface SignedActionGateOutcome {
  readonly record: AtribRecord
  readonly record_hash: Sha256Uri
  readonly entry: ActionGateOutcomeEntry
  readonly sidecar: ActionGateLocalSidecar
}

export interface RunGatedActionInput<TResult> {
  readonly privateKey?: Uint8Array | string
  readonly contextId?: string
  readonly serverUrl?: string
  readonly parentRecordHashes?: readonly Sha256Uri[]
  readonly action: ActionGateActionEnvelope
  readonly evaluate: (input: ActionGatePolicyInput) => MaybePromise<ActionGatePolicyDecision>
  readonly execute: () => MaybePromise<TResult>
  readonly now?: () => number
  readonly onRecord?: (record: AtribRecord, sidecar: ActionGateLocalSidecar) => MaybePromise<void>
}

export interface ActionGateRunResult<TResult> {
  readonly state: ActionGateDecisionState
  readonly action_executed: boolean
  readonly decision: SignedActionGateDecision
  readonly outcome: SignedActionGateOutcome
  readonly signed_records: readonly AtribRecord[]
  readonly sidecars: readonly ActionGateLocalSidecar[]
  readonly verification: ActionGateVerificationResult
  readonly record_delivery_errors: readonly ActionGateRecordDeliveryError[]
  readonly result?: TResult
  readonly error?: { readonly name: string; readonly message: string }
}

export interface ProtectedMcpToolCall {
  readonly name: string
  readonly arguments?: unknown
}

export interface ProtectedMcpActionContext {
  readonly run_id: string
  readonly action_id: string
  readonly agent_id: string
  readonly risk?: readonly string[]
  readonly parent_record_hashes?: readonly Sha256Uri[]
  readonly refs?: Record<string, string>
  readonly credential?: {
    readonly run_key: string
    readonly principal_key?: string
  }
}

export interface ProtectedMcpPermit {
  readonly permit_id: string
  readonly binding: Sha256Uri
  readonly issued_at_ms: number
  readonly expires_at_ms: number
}

export type ProtectedMcpAuthorizationReason =
  | 'ok'
  | 'authorization_missing'
  | 'authorization_unknown'
  | 'authorization_binding_mismatch'
  | 'authorization_expired'
  | 'authorization_consumed'
  | 'authorization_credential_missing'
  | 'authorization_credential_revoked'
  | 'authorization_revocation_check_failed'

export type ProtectedMcpAuthorizationResult =
  | { readonly ok: true; readonly reason: 'ok' }
  | {
      readonly ok: false
      readonly reason: Exclude<ProtectedMcpAuthorizationReason, 'ok'>
    }

export interface ProtectedMcpPermitStore {
  readonly issue: (permit: ProtectedMcpPermit) => MaybePromise<void>
  readonly consume: (input: {
    readonly permit_id: string
    readonly binding: Sha256Uri
    readonly now_ms: number
  }) => MaybePromise<ProtectedMcpAuthorizationResult>
}

export type ProtectedMcpDispatchResult<TResult> =
  | {
      readonly ok: true
      readonly authorization: { readonly reason: 'ok' }
      readonly result: TResult
    }
  | {
      readonly ok: false
      readonly authorization: {
        readonly reason: Exclude<ProtectedMcpAuthorizationReason, 'ok'>
      }
      readonly bypass_evidence?: ActionGateRunResult<never>
      readonly evidence_error?: { readonly name: string; readonly message: string }
    }

export interface ProtectedMcpExecutor<TResult> {
  /**
   * The public action path. It signs the policy decision before issuing a
   * one-time permit and invokes the protected dispatch boundary only for an
   * allowed action.
   */
  readonly authorizeAndExecute: (input: {
    readonly action: ProtectedMcpActionContext
    readonly request: ProtectedMcpToolCall
  }) => Promise<ActionGateRunResult<TResult>>
  /**
   * The protected raw execution boundary. A host may mount this behind an
   * internal MCP transport, but must not expose the unwrapped upstream
   * handler. Calls without the one-time permit are rejected before execution.
   */
  readonly dispatch: (input: {
    readonly action: ProtectedMcpActionContext
    readonly request: ProtectedMcpToolCall
    readonly permit_id?: string
  }) => Promise<ProtectedMcpDispatchResult<TResult>>
}

export interface CreateProtectedMcpExecutorInput<TResult> {
  readonly privateKey?: Uint8Array | string
  readonly contextId?: string
  readonly serverUrl?: string
  readonly surface?: string
  readonly evaluate: (input: ActionGatePolicyInput) => MaybePromise<ActionGatePolicyDecision>
  readonly executeUpstream: (request: ProtectedMcpToolCall) => MaybePromise<TResult>
  readonly permitStore?: ProtectedMcpPermitStore
  readonly permitMaxAgeMs?: number
  readonly now?: () => number
  readonly createPermitId?: () => string
  /**
   * Current revocation view. Supplying this enables fail-closed credential
   * checks before policy evaluation and again at the dispatch boundary.
   */
  readonly revokedKeys?: ReadonlySet<string> | (() => MaybePromise<ReadonlySet<string>>)
  readonly onRecord?: (record: AtribRecord, sidecar: ActionGateLocalSidecar) => MaybePromise<void>
}

export type ActionGateVerificationIssueCode =
  | 'decision_signature_invalid'
  | 'outcome_signature_invalid'
  | 'decision_sidecar_hash_mismatch'
  | 'outcome_sidecar_hash_mismatch'
  | 'outcome_missing_decision_parent'
  | 'decision_record_hash_mismatch'
  | 'decision_id_mismatch'
  | 'decision_entry_id_mismatch'
  | 'outcome_entry_id_mismatch'
  | 'decision_event_type_mismatch'
  | 'outcome_event_type_mismatch'
  | 'decision_tool_name_mismatch'
  | 'outcome_tool_name_mismatch'
  | 'decision_args_commitment_mismatch'
  | 'decision_result_commitment_mismatch'
  | 'outcome_args_commitment_mismatch'
  | 'outcome_result_commitment_mismatch'
  | 'decision_schema_mismatch'
  | 'outcome_schema_mismatch'
  | 'decision_policy_outcome_invalid'
  | 'decision_state_policy_mismatch'
  | 'outcome_result_digest_invalid'
  | 'outcome_status_invalid'
  | 'outcome_executed_invalid'
  | 'outcome_status_execution_mismatch'
  | 'outcome_status_payload_mismatch'
  | 'decision_sidecar_record_hash_mismatch'
  | 'outcome_sidecar_record_hash_mismatch'
  | 'decision_sidecar_entry_mismatch'
  | 'outcome_sidecar_entry_mismatch'
  | 'decision_sidecar_action_mismatch'
  | 'outcome_sidecar_action_mismatch'
  | 'decision_sidecar_args_mismatch'
  | 'outcome_sidecar_result_mismatch'
  | 'context_id_mismatch'
  | 'creator_key_mismatch'
  | 'outcome_chain_root_mismatch'
  | 'run_id_mismatch'
  | 'action_id_mismatch'
  | 'blocked_action_executed'
  | 'escalated_action_executed'
  | 'policy_error_action_executed'
  | 'allowed_action_missing_execution_status'
  | 'closed_decision_status_mismatch'

export interface ActionGateVerificationIssue {
  readonly code: ActionGateVerificationIssueCode
  readonly message: string
}

export interface ActionGateVerificationResult {
  readonly valid: boolean
  readonly issues: readonly ActionGateVerificationIssue[]
}

export interface ActionGateRecordDeliveryError {
  readonly record_kind: 'decision' | 'outcome'
  readonly record_hash: Sha256Uri
  readonly name: string
  readonly message: string
}

export async function runGatedAction<TResult>(
  input: RunGatedActionInput<TResult>,
): Promise<ActionGateRunResult<TResult>> {
  const recordDeliveryErrors: ActionGateRecordDeliveryError[] = []
  const privateKey = resolveActionGatePrivateKey(input.privateKey)
  const now = input.now ?? Date.now
  const contextId = input.contextId ?? randomContextId()
  const serverUrl = input.serverUrl ?? DEFAULT_ACTION_GATE_SERVER_URL
  const timestampMs = now()
  const timestamp = new Date(timestampMs).toISOString()
  const parentRecordHashes = normalizeRecordHashes([
    ...(input.parentRecordHashes ?? []),
    ...(input.action.parent_record_hashes ?? []),
  ])
  const policy = await resolvePolicyDecision({
    evaluate: input.evaluate,
    action: input.action,
    timestamp,
  })
  const decisionEntry = buildActionGateDecisionEntry({
    action: input.action,
    policy,
    timestamp,
    parent_record_hashes: parentRecordHashes,
  })
  const decision = await signActionGateDecision({
    entry: decisionEntry,
    action: input.action,
    privateKey,
    contextId,
    serverUrl,
    timestampMs,
  })
  await notifyRecord(input.onRecord, decision.record, decision.sidecar, recordDeliveryErrors)

  const outcomeInput = await resolveOutcomeInput({
    state: decisionEntry.decision_state,
    execute: input.execute,
  })
  const outcomeEntry = buildActionGateOutcomeEntry({
    status: outcomeInput.status,
    run_id: input.action.run_id,
    action_id: input.action.action_id,
    decision_id: decisionEntry.decision_id,
    decision_record_hash: decision.record_hash,
    executed: outcomeInput.executed,
    timestamp: new Date(now()).toISOString(),
    ...(outcomeInput.result !== undefined ? { result: outcomeInput.result } : {}),
    ...(outcomeInput.error ? { error: outcomeInput.error } : {}),
  })
  const outcome = await signActionGateOutcome({
    entry: outcomeEntry,
    action: input.action,
    privateKey,
    contextId,
    serverUrl,
    decisionRecordHash: decision.record_hash,
    chainTailHex: decision.record_hash.slice('sha256:'.length),
    timestampMs: now(),
  })
  await notifyRecord(input.onRecord, outcome.record, outcome.sidecar, recordDeliveryErrors)

  const verification = await verifyActionGateRun({ decision, outcome })
  const base = {
    state: decisionEntry.decision_state,
    action_executed: outcomeEntry.executed,
    decision,
    outcome,
    signed_records: [decision.record, outcome.record],
    sidecars: [decision.sidecar, outcome.sidecar],
    verification,
    record_delivery_errors: recordDeliveryErrors,
  } satisfies Omit<ActionGateRunResult<TResult>, 'result' | 'error'>

  if (outcomeInput.status === 'executed') {
    return { ...base, result: outcomeInput.result as TResult }
  }
  if (outcomeInput.status === 'execution_error' && outcomeInput.error) {
    return { ...base, error: outcomeInput.error }
  }
  return base
}

/**
 * In-memory reference store for protected MCP permits. A production adapter
 * spanning processes or replicas must supply a shared atomic store.
 */
export function createMemoryProtectedMcpPermitStore(): ProtectedMcpPermitStore {
  const permits = new Map<string, ProtectedMcpPermit & { consumed: boolean }>()
  return {
    issue(permit) {
      if (permits.has(permit.permit_id)) {
        throw new Error('action-gate: protected MCP permit id already exists')
      }
      permits.set(permit.permit_id, { ...permit, consumed: false })
    },
    consume({ permit_id, binding, now_ms }) {
      const permit = permits.get(permit_id)
      if (permit === undefined) {
        return { ok: false, reason: 'authorization_unknown' }
      }
      if (permit.binding !== binding) {
        return { ok: false, reason: 'authorization_binding_mismatch' }
      }
      if (now_ms < permit.issued_at_ms || now_ms > permit.expires_at_ms) {
        return { ok: false, reason: 'authorization_expired' }
      }
      if (permit.consumed) {
        return { ok: false, reason: 'authorization_consumed' }
      }
      permit.consumed = true
      return { ok: true, reason: 'ok' }
    },
  }
}

export function computeProtectedMcpBinding({
  action,
  request,
}: {
  readonly action: ProtectedMcpActionContext
  readonly request: ProtectedMcpToolCall
}): Sha256Uri {
  return protectedMcpBinding({ action, request, surface: 'mcp' })
}

function protectedMcpBinding({
  action,
  request,
  surface,
}: {
  readonly action: ProtectedMcpActionContext
  readonly request: ProtectedMcpToolCall
  readonly surface: string
}): Sha256Uri {
  return hashCanonical({
    run_id: action.run_id,
    action_id: action.action_id,
    agent_id: action.agent_id,
    ...(action.credential !== undefined ? { credential: action.credential } : {}),
    surface,
    tool_name: request.name,
    args_digest: hashCanonical(request.arguments ?? {}),
  })
}

/**
 * Create an MCP execution boundary where policy evaluation, signed decision,
 * and one-time authorization precede the upstream side effect.
 *
 * The raw upstream handler remains inside this closure. The returned
 * `dispatch` method rejects missing, unknown, mismatched, expired, and replayed
 * permits before invoking it.
 */
export function createProtectedMcpExecutor<TResult>(
  input: CreateProtectedMcpExecutorInput<TResult>,
): ProtectedMcpExecutor<TResult> {
  const store = input.permitStore ?? createMemoryProtectedMcpPermitStore()
  const now = input.now ?? Date.now
  const surface = input.surface ?? 'mcp'
  const permitMaxAgeMs = input.permitMaxAgeMs ?? 30_000
  if (!Number.isSafeInteger(permitMaxAgeMs) || permitMaxAgeMs < 0) {
    throw new TypeError('action-gate: permitMaxAgeMs must be a non-negative safe integer')
  }
  const createPermitId = input.createPermitId ?? (() => base64urlEncode(randomBytes(32)))

  const actionEnvelopeFor = (
    action: ProtectedMcpActionContext,
    request: ProtectedMcpToolCall,
    extra?: {
      readonly risk?: readonly string[]
      readonly refs?: Record<string, string>
    },
  ): ActionGateActionEnvelope => ({
    run_id: action.run_id,
    action_id: action.action_id,
    agent_id: action.agent_id,
    surface,
    tool_name: request.name,
    ...(request.arguments !== undefined ? { args: request.arguments } : {}),
    ...((extra?.risk ?? action.risk) !== undefined ? { risk: extra?.risk ?? action.risk } : {}),
    ...(action.parent_record_hashes !== undefined
      ? { parent_record_hashes: action.parent_record_hashes }
      : {}),
    ...((extra?.refs ?? action.refs) !== undefined ? { refs: extra?.refs ?? action.refs } : {}),
  })

  const rejectBypass = async ({
    action,
    request,
    reason,
  }: {
    readonly action: ProtectedMcpActionContext
    readonly request: ProtectedMcpToolCall
    readonly reason: Exclude<ProtectedMcpAuthorizationReason, 'ok'>
  }): Promise<ProtectedMcpDispatchResult<TResult>> => {
    try {
      const bypassEvidence = await runGatedAction<never>({
        ...(input.privateKey !== undefined ? { privateKey: input.privateKey } : {}),
        ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
        ...(input.serverUrl !== undefined ? { serverUrl: input.serverUrl } : {}),
        action: actionEnvelopeFor(action, request, {
          risk: [...new Set([...(action.risk ?? []), 'direct_bypass'])].sort(),
          refs: {
            ...(action.refs ?? {}),
            authorization_reason: reason,
          },
        }),
        evaluate: () => ({
          outcome: 'block',
          policy_id: 'atrib.protected-mcp.authorization',
          policy_version: '1',
          reason: `protected MCP dispatch rejected: ${reason}`,
          evidence: { authorization_reason: reason },
        }),
        execute: () => {
          throw new Error('action-gate: bypass rejection executed an unreachable action body')
        },
        now,
        ...(input.onRecord !== undefined ? { onRecord: input.onRecord } : {}),
      })
      return {
        ok: false,
        authorization: { reason },
        bypass_evidence: bypassEvidence,
      }
    } catch (error) {
      return {
        ok: false,
        authorization: { reason },
        evidence_error: normalizeError(error),
      }
    }
  }

  const credentialAuthorization = async (
    action: ProtectedMcpActionContext,
  ): Promise<ProtectedMcpAuthorizationResult> => {
    if (input.revokedKeys === undefined) return { ok: true, reason: 'ok' }
    if (action.credential === undefined) {
      return { ok: false, reason: 'authorization_credential_missing' }
    }
    let revokedKeys: ReadonlySet<string>
    try {
      revokedKeys =
        typeof input.revokedKeys === 'function' ? await input.revokedKeys() : input.revokedKeys
    } catch {
      return { ok: false, reason: 'authorization_revocation_check_failed' }
    }
    if (
      revokedKeys.has(action.credential.run_key) ||
      (action.credential.principal_key !== undefined &&
        revokedKeys.has(action.credential.principal_key))
    ) {
      return { ok: false, reason: 'authorization_credential_revoked' }
    }
    return { ok: true, reason: 'ok' }
  }

  const blockedCredentialResult = async (
    action: ProtectedMcpActionContext,
    request: ProtectedMcpToolCall,
    reason: Exclude<ProtectedMcpAuthorizationReason, 'ok'>,
  ): Promise<ActionGateRunResult<TResult>> =>
    runGatedAction<TResult>({
      ...(input.privateKey !== undefined ? { privateKey: input.privateKey } : {}),
      ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
      ...(input.serverUrl !== undefined ? { serverUrl: input.serverUrl } : {}),
      action: actionEnvelopeFor(action, request, {
        risk: [...new Set([...(action.risk ?? []), 'credential_rejected'])].sort(),
        refs: {
          ...(action.refs ?? {}),
          authorization_reason: reason,
          ...(action.credential?.run_key ? { credential_run_key: action.credential.run_key } : {}),
        },
      }),
      evaluate: () => ({
        outcome: 'block',
        policy_id: 'atrib.protected-mcp.revocation',
        policy_version: '1',
        reason: `protected MCP credential rejected: ${reason}`,
        evidence: { authorization_reason: reason },
      }),
      execute: () => {
        throw new Error('action-gate: credential rejection executed an unreachable action body')
      },
      now,
      ...(input.onRecord !== undefined ? { onRecord: input.onRecord } : {}),
    })

  const dispatch: ProtectedMcpExecutor<TResult>['dispatch'] = async ({
    action,
    request,
    permit_id,
  }) => {
    const credential = await credentialAuthorization(action)
    if (!credential.ok) {
      return rejectBypass({ action, request, reason: credential.reason })
    }
    if (permit_id === undefined || permit_id.length === 0) {
      return rejectBypass({ action, request, reason: 'authorization_missing' })
    }
    const authorization = await store.consume({
      permit_id,
      binding: protectedMcpBinding({ action, request, surface }),
      now_ms: now(),
    })
    if (!authorization.ok) {
      return rejectBypass({ action, request, reason: authorization.reason })
    }
    return {
      ok: true,
      authorization: { reason: 'ok' },
      result: await input.executeUpstream(request),
    }
  }

  return {
    dispatch,
    async authorizeAndExecute({ action, request }) {
      const credential = await credentialAuthorization(action)
      if (!credential.ok) {
        return blockedCredentialResult(action, request, credential.reason)
      }
      return runGatedAction({
        ...(input.privateKey !== undefined ? { privateKey: input.privateKey } : {}),
        ...(input.contextId !== undefined ? { contextId: input.contextId } : {}),
        ...(input.serverUrl !== undefined ? { serverUrl: input.serverUrl } : {}),
        action: actionEnvelopeFor(action, request),
        evaluate: input.evaluate,
        execute: async () => {
          const issuedAtMs = now()
          const permitId = createPermitId()
          if (permitId.length === 0) {
            throw new Error('action-gate: createPermitId returned an empty id')
          }
          await store.issue({
            permit_id: permitId,
            binding: protectedMcpBinding({ action, request, surface }),
            issued_at_ms: issuedAtMs,
            expires_at_ms: issuedAtMs + permitMaxAgeMs,
          })
          const dispatched = await dispatch({
            action,
            request,
            permit_id: permitId,
          })
          if (!dispatched.ok) {
            throw new Error(
              `action-gate: protected MCP dispatch rejected internal permit (${dispatched.authorization.reason})`,
            )
          }
          return dispatched.result
        },
        now,
        ...(input.onRecord !== undefined ? { onRecord: input.onRecord } : {}),
      })
    },
  }
}

export function buildActionGateDecisionEntry({
  action,
  policy,
  timestamp,
  parent_record_hashes = [],
}: {
  readonly action: ActionGateActionEnvelope
  readonly policy: ActionGatePolicyDecision
  readonly timestamp: string
  readonly parent_record_hashes?: readonly Sha256Uri[]
}): ActionGateDecisionEntry {
  const decisionState = decisionStateFromPolicy(policy.outcome)
  const entryWithoutId = {
    schema: ACTION_GATE_DECISION_SCHEMA,
    decision_state: decisionState,
    run_id: action.run_id,
    action_id: action.action_id,
    agent_id: action.agent_id,
    surface: action.surface,
    tool_name: action.tool_name,
    args_digest: actionArgsDigest(action),
    risk: [...(action.risk ?? [])].sort(),
    policy: {
      policy_id: policy.policy_id,
      version: policy.policy_version,
      outcome: policy.outcome,
      ...(policy.reason ? { reason: policy.reason } : {}),
      authority: policy.authority ?? { mode: 'host-policy' },
      approval: policy.approval ?? { required: policy.outcome === 'escalate' },
      ...(policy.evidence ? { evidence: sortedRecord(policy.evidence) } : {}),
    },
    timestamp,
    parent_record_hashes: normalizeRecordHashes(parent_record_hashes),
    ...(action.refs ? { refs: sortedRecord(action.refs) } : {}),
  } satisfies Omit<ActionGateDecisionEntry, 'decision_id'>

  return {
    ...entryWithoutId,
    decision_id: digestCanonical(entryWithoutId),
  }
}

export function buildActionGateOutcomeEntry({
  status,
  run_id,
  action_id,
  decision_id,
  decision_record_hash,
  executed,
  timestamp,
  result,
  result_digest,
  error,
}: {
  readonly status: ActionGateOutcomeStatus
  readonly run_id: string
  readonly action_id: string
  readonly decision_id: Sha256Uri
  readonly decision_record_hash: Sha256Uri
  readonly executed: boolean
  readonly timestamp: string
  readonly result?: unknown
  readonly result_digest?: Sha256Uri
  readonly error?: { readonly name: string; readonly message: string }
}): ActionGateOutcomeEntry {
  assertActionGateOutcomeStatus(status)
  assertExecutedFlag(executed)
  const entryWithoutId = {
    schema: ACTION_GATE_OUTCOME_SCHEMA,
    status,
    run_id,
    action_id,
    decision_id,
    decision_record_hash,
    executed,
    ...(result_digest !== undefined || result !== undefined
      ? {
          result_digest: outcomeResultDigest({
            result,
            ...(result_digest !== undefined ? { result_digest } : {}),
          }),
        }
      : {}),
    ...(error ? { error } : {}),
    timestamp,
  } satisfies Omit<ActionGateOutcomeEntry, 'outcome_id'>

  return {
    ...entryWithoutId,
    outcome_id: digestCanonical(entryWithoutId),
  }
}

export async function signActionGateDecision({
  entry,
  action,
  privateKey,
  contextId,
  serverUrl = DEFAULT_ACTION_GATE_SERVER_URL,
  chainTailHex,
  timestampMs,
}: {
  readonly entry: ActionGateDecisionEntry
  readonly action: ActionGateActionEnvelope
  readonly privateKey: Uint8Array
  readonly contextId: string
  readonly serverUrl?: string
  readonly chainTailHex?: string
  readonly timestampMs: number
}): Promise<SignedActionGateDecision> {
  assertDecisionEntry(entry)
  if (!actionMatchesDecisionEntry(action, entry)) {
    throw new Error('action does not match decision entry')
  }
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId(serverUrl, `${DECISION_TOOL_NAME}.${entry.decision_state}`),
    creator_key: creatorKey,
    chain_root: resolveChainRoot({ contextId, autoChainTailHex: chainTailHex }),
    event_type: ACTION_GATE_DECISION_EVENT_TYPE_URI,
    context_id: contextId,
    timestamp: timestampMs,
    signature: '',
    args_hash: hashCanonical(decisionSubject(entry)),
    result_hash: hashCanonical(decisionResult(entry)),
    tool_name: `${DECISION_TOOL_NAME}.${entry.decision_state}`,
    ...(entry.parent_record_hashes.length > 0
      ? { informed_by: [...entry.parent_record_hashes] }
      : {}),
  }
  const signed = await signRecord(record, privateKey)
  const recordHash = recordHashFor(signed)
  return {
    record: signed,
    record_hash: recordHash,
    entry,
    sidecar: {
      package: '@atrib/action-gate',
      record_kind: 'decision',
      record_hash: recordHash,
      action,
      decision: entry,
      ...(action.args !== undefined ? { args: snapshotCanonical(action.args) } : {}),
      informed_by: entry.parent_record_hashes,
    },
  }
}

export async function signActionGateOutcome({
  entry,
  action,
  privateKey,
  contextId,
  decisionRecordHash,
  serverUrl = DEFAULT_ACTION_GATE_SERVER_URL,
  chainTailHex,
  timestampMs,
  result,
}: {
  readonly entry: ActionGateOutcomeEntry
  readonly action: ActionGateActionEnvelope
  readonly privateKey: Uint8Array
  readonly contextId: string
  readonly decisionRecordHash: Sha256Uri
  readonly serverUrl?: string
  readonly chainTailHex?: string
  readonly timestampMs: number
  readonly result?: unknown
}): Promise<SignedActionGateOutcome> {
  assertOutcomeEntry(entry)
  if (action.run_id !== entry.run_id || action.action_id !== entry.action_id) {
    throw new Error('action does not match outcome entry')
  }
  const normalizedDecisionRecordHash = normalizeSha256Uri(decisionRecordHash, 'decisionRecordHash')
  const entryDecisionRecordHash = normalizeSha256Uri(
    entry.decision_record_hash,
    'decision_record_hash',
  )
  if (normalizedDecisionRecordHash !== entryDecisionRecordHash) {
    throw new Error('decisionRecordHash does not match outcome entry decision_record_hash')
  }
  if (result !== undefined && entry.result_digest !== digestCanonical(result)) {
    throw new Error('result does not match outcome entry result_digest')
  }
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId(serverUrl, `${OUTCOME_TOOL_NAME}.${entry.status}`),
    creator_key: creatorKey,
    chain_root: resolveChainRoot({
      contextId,
      autoChainTailHex: chainTailHex ?? decisionRecordHash.slice('sha256:'.length),
    }),
    event_type: ACTION_GATE_OUTCOME_EVENT_TYPE_URI,
    context_id: contextId,
    timestamp: timestampMs,
    signature: '',
    args_hash: hashCanonical(outcomeSubject(entry)),
    result_hash: hashCanonical(outcomeResult(entry)),
    tool_name: `${OUTCOME_TOOL_NAME}.${entry.status}`,
    informed_by: [decisionRecordHash],
  }
  const signed = await signRecord(record, privateKey)
  const recordHash = recordHashFor(signed)
  return {
    record: signed,
    record_hash: recordHash,
    entry,
    sidecar: {
      package: '@atrib/action-gate',
      record_kind: 'outcome',
      record_hash: recordHash,
      action,
      outcome: entry,
      ...(result !== undefined ? { result: snapshotCanonical(result) } : {}),
      informed_by: [decisionRecordHash],
    },
  }
}

export async function verifyActionGateRun({
  decision,
  outcome,
}: {
  readonly decision: SignedActionGateDecision
  readonly outcome: SignedActionGateOutcome
}): Promise<ActionGateVerificationResult> {
  const issues: ActionGateVerificationIssue[] = []
  const decisionOk = await verifyRecord(decision.record)
  const outcomeOk = await verifyRecord(outcome.record)
  if (!decisionOk) {
    issues.push({
      code: 'decision_signature_invalid',
      message: 'decision record signature failed verification',
    })
  }
  if (!outcomeOk) {
    issues.push({
      code: 'outcome_signature_invalid',
      message: 'outcome record signature failed verification',
    })
  }
  if (decision.record_hash !== recordHashFor(decision.record)) {
    issues.push({
      code: 'decision_sidecar_hash_mismatch',
      message: 'decision record_hash does not match signed bytes',
    })
  }
  if (outcome.record_hash !== recordHashFor(outcome.record)) {
    issues.push({
      code: 'outcome_sidecar_hash_mismatch',
      message: 'outcome record_hash does not match signed bytes',
    })
  }
  if (!outcome.record.informed_by?.includes(decision.record_hash)) {
    issues.push({
      code: 'outcome_missing_decision_parent',
      message: 'outcome record does not cite the decision record',
    })
  }
  if (outcome.entry.decision_record_hash !== decision.record_hash) {
    issues.push({
      code: 'decision_record_hash_mismatch',
      message: 'outcome entry points at a different decision record hash',
    })
  }
  if (outcome.entry.decision_id !== decision.entry.decision_id) {
    issues.push({
      code: 'decision_id_mismatch',
      message: 'outcome entry points at a different decision id',
    })
  }
  if (outcome.entry.run_id !== decision.entry.run_id) {
    issues.push({ code: 'run_id_mismatch', message: 'run id drifted between records' })
  }
  if (outcome.entry.action_id !== decision.entry.action_id) {
    issues.push({
      code: 'action_id_mismatch',
      message: 'action id drifted between records',
    })
  }
  if (outcome.record.context_id !== decision.record.context_id) {
    issues.push({
      code: 'context_id_mismatch',
      message: 'outcome record uses a different context id than the decision',
    })
  }
  if (outcome.record.creator_key !== decision.record.creator_key) {
    issues.push({
      code: 'creator_key_mismatch',
      message: 'outcome record uses a different host identity than the decision',
    })
  }
  if (outcome.record.chain_root !== decision.record_hash) {
    issues.push({
      code: 'outcome_chain_root_mismatch',
      message: 'outcome record does not extend the decision chronology chain',
    })
  }
  if (decision.entry.schema !== ACTION_GATE_DECISION_SCHEMA) {
    issues.push({
      code: 'decision_schema_mismatch',
      message: 'decision entry uses the wrong schema',
    })
  }
  if (outcome.entry.schema !== ACTION_GATE_OUTCOME_SCHEMA) {
    issues.push({
      code: 'outcome_schema_mismatch',
      message: 'outcome entry uses the wrong schema',
    })
  }
  const policyOutcome = decision.entry.policy.outcome as unknown
  if (!isActionGatePolicyOutcome(policyOutcome)) {
    issues.push({
      code: 'decision_policy_outcome_invalid',
      message: 'decision policy outcome is outside the action-gate schema',
    })
  } else if (decision.entry.decision_state !== decisionStateFromPolicy(policyOutcome)) {
    issues.push({
      code: 'decision_state_policy_mismatch',
      message: 'decision state does not match its policy outcome',
    })
  }
  if (outcome.entry.result_digest !== undefined && !isSha256Uri(outcome.entry.result_digest)) {
    issues.push({
      code: 'outcome_result_digest_invalid',
      message: 'outcome result digest is not a canonical SHA-256 URI',
    })
  }
  const outcomeStatus = outcome.entry.status as unknown
  const outcomeExecuted = outcome.entry.executed as unknown
  const outcomeStatusValid = isActionGateOutcomeStatus(outcomeStatus)
  const outcomeExecutedValid = typeof outcomeExecuted === 'boolean'
  if (!outcomeStatusValid) {
    issues.push({
      code: 'outcome_status_invalid',
      message: 'outcome status is outside the action-gate schema',
    })
  }
  if (!outcomeExecutedValid) {
    issues.push({
      code: 'outcome_executed_invalid',
      message: 'outcome executed flag is not a boolean',
    })
  }
  if (
    outcomeStatusValid &&
    outcomeExecutedValid &&
    !outcomeStatusMatchesExecution(outcomeStatus, outcomeExecuted)
  ) {
    issues.push({
      code: 'outcome_status_execution_mismatch',
      message: 'outcome status contradicts whether the action executed',
    })
  }
  if (outcomeStatusValid && !outcomeStatusPayloadValid(outcome.entry)) {
    issues.push({
      code: 'outcome_status_payload_mismatch',
      message: 'outcome status contradicts its result or error material',
    })
  }

  if (decision.entry.decision_id !== decisionEntryIdFor(decision.entry)) {
    issues.push({
      code: 'decision_entry_id_mismatch',
      message: 'decision entry id does not match its canonical entry fields',
    })
  }
  if (outcome.entry.outcome_id !== outcomeEntryIdFor(outcome.entry)) {
    issues.push({
      code: 'outcome_entry_id_mismatch',
      message: 'outcome entry id does not match its canonical entry fields',
    })
  }
  if (decision.record.event_type !== ACTION_GATE_DECISION_EVENT_TYPE_URI) {
    issues.push({
      code: 'decision_event_type_mismatch',
      message: 'decision record uses the wrong event type',
    })
  }
  if (outcome.record.event_type !== ACTION_GATE_OUTCOME_EVENT_TYPE_URI) {
    issues.push({
      code: 'outcome_event_type_mismatch',
      message: 'outcome record uses the wrong event type',
    })
  }
  if (decision.record.tool_name !== `${DECISION_TOOL_NAME}.${decision.entry.decision_state}`) {
    issues.push({
      code: 'decision_tool_name_mismatch',
      message: 'decision record tool name does not match its decision state',
    })
  }
  if (outcome.record.tool_name !== `${OUTCOME_TOOL_NAME}.${outcome.entry.status}`) {
    issues.push({
      code: 'outcome_tool_name_mismatch',
      message: 'outcome record tool name does not match its outcome status',
    })
  }
  if (decision.record.args_hash !== hashCanonical(decisionSubject(decision.entry))) {
    issues.push({
      code: 'decision_args_commitment_mismatch',
      message: 'decision record args commitment does not match its entry',
    })
  }
  if (decision.record.result_hash !== hashCanonical(decisionResult(decision.entry))) {
    issues.push({
      code: 'decision_result_commitment_mismatch',
      message: 'decision record result commitment does not match its entry',
    })
  }
  if (outcome.record.args_hash !== hashCanonical(outcomeSubject(outcome.entry))) {
    issues.push({
      code: 'outcome_args_commitment_mismatch',
      message: 'outcome record args commitment does not match its entry',
    })
  }
  if (outcome.record.result_hash !== hashCanonical(outcomeResult(outcome.entry))) {
    issues.push({
      code: 'outcome_result_commitment_mismatch',
      message: 'outcome record result commitment does not match its entry',
    })
  }
  if (decision.sidecar.record_hash !== decision.record_hash) {
    issues.push({
      code: 'decision_sidecar_record_hash_mismatch',
      message: 'decision sidecar record hash does not match the signed artifact',
    })
  }
  if (outcome.sidecar.record_hash !== outcome.record_hash) {
    issues.push({
      code: 'outcome_sidecar_record_hash_mismatch',
      message: 'outcome sidecar record hash does not match the signed artifact',
    })
  }
  if (!canonicalEqual(decision.sidecar.decision, decision.entry)) {
    issues.push({
      code: 'decision_sidecar_entry_mismatch',
      message: 'decision sidecar entry does not match the signed artifact entry',
    })
  }
  if (!canonicalEqual(outcome.sidecar.outcome, outcome.entry)) {
    issues.push({
      code: 'outcome_sidecar_entry_mismatch',
      message: 'outcome sidecar entry does not match the signed artifact entry',
    })
  }
  if (!actionMatchesDecisionEntry(decision.sidecar.action, decision.entry)) {
    issues.push({
      code: 'decision_sidecar_action_mismatch',
      message: 'decision sidecar action does not match the committed decision',
    })
  }
  if (!actionMatchesDecisionEntry(outcome.sidecar.action, decision.entry)) {
    issues.push({
      code: 'outcome_sidecar_action_mismatch',
      message: 'outcome sidecar action does not match the committed decision',
    })
  }
  if (
    decision.sidecar.args !== undefined &&
    digestCanonical(decision.sidecar.args) !== decision.entry.args_digest
  ) {
    issues.push({
      code: 'decision_sidecar_args_mismatch',
      message: 'decision sidecar args do not match the committed args digest',
    })
  }
  if (
    outcome.sidecar.result !== undefined &&
    outcome.entry.result_digest !== digestCanonical(outcome.sidecar.result)
  ) {
    issues.push({
      code: 'outcome_sidecar_result_mismatch',
      message: 'outcome sidecar result does not match the committed result digest',
    })
  }

  const state = decision.entry.decision_state
  if (
    state === 'allowed' &&
    !['executed', 'not_executed', 'execution_error'].includes(outcome.entry.status)
  ) {
    issues.push({
      code: 'allowed_action_missing_execution_status',
      message: 'allowed decisions must end in executed, not_executed, or execution_error',
    })
  }
  if (state === 'allowed' && outcome.entry.status === 'not_executed' && outcome.entry.executed) {
    issues.push({
      code: 'allowed_action_missing_execution_status',
      message: 'not_executed outcomes cannot report executed=true',
    })
  }
  if (state === 'blocked') {
    if (outcome.entry.executed) {
      issues.push({ code: 'blocked_action_executed', message: 'blocked action executed' })
    }
    if (outcome.entry.status !== 'blocked') {
      issues.push({
        code: 'closed_decision_status_mismatch',
        message: 'blocked decision did not produce blocked outcome',
      })
    }
  }
  if (state === 'escalated') {
    if (outcome.entry.executed) {
      issues.push({
        code: 'escalated_action_executed',
        message: 'escalated action executed before approval',
      })
    }
    if (outcome.entry.status !== 'escalated') {
      issues.push({
        code: 'closed_decision_status_mismatch',
        message: 'escalated decision did not produce escalated outcome',
      })
    }
  }
  if (state === 'policy_error') {
    if (outcome.entry.executed) {
      issues.push({
        code: 'policy_error_action_executed',
        message: 'policy-error action executed',
      })
    }
    if (outcome.entry.status !== 'policy_error') {
      issues.push({
        code: 'closed_decision_status_mismatch',
        message: 'policy-error decision did not produce policy_error outcome',
      })
    }
  }

  return { valid: issues.length === 0, issues }
}

/** Options for {@link requireTrustedTransaction}. */
export interface RequireTrustedTransactionOptions {
  /** The transaction `AtribRecord` the host is deciding whether to authorize. */
  readonly record: AtribRecord
  /**
   * Base64url Ed25519 public keys the host trusts as independent attesting
   * principals. Non-malleable authority requires at least two DISTINCT verified
   * signer keys drawn from this set (§1.7.6 trusted signer composition, D149).
   * An empty or absent trust set fails closed.
   */
  readonly trustedCreatorKeys?: readonly string[]
  /**
   * Outcome when the transaction is not trusted-cross-attested. Default
   * `'block'` (fail closed). Use `'escalate'` to route to human review instead.
   */
  readonly onUntrusted?: 'block' | 'escalate'
  readonly policyId?: string
  readonly policyVersion?: string
  readonly authority?: ActionGateAuthority
  readonly approval?: ActionGateApproval
}

/**
 * Host-owned fail-closed policy for transaction actions (D133 + D149). This is
 * where §1.7.6 trusted signer composition becomes a REQUIREMENT rather than a
 * signal: `verifyRecord` only surfaces the trust posture (signal-not-block), so
 * a consumer that reads `signers_valid >= 2` can still be Sybil-fooled. This
 * policy refuses to authorize a transaction unless it is trusted-cross-attested,
 * i.e. `isTrustedCrossAttested` holds (>= 2 distinct verified signer keys in the
 * caller's trust set).
 *
 * Returns `allow` only when the record is a transaction, its signature verifies,
 * and it is trusted-cross-attested. Every other case fails closed: no trust set,
 * a non-transaction record, an invalid signature, or a merely-verified (untrusted
 * or Sybil) signer set all return `onUntrusted` (default `'block'`). The reason
 * and `evidence` carry the cross-attestation posture so the signed decision
 * records why authority was granted or withheld.
 */
export async function requireTrustedTransaction(
  opts: RequireTrustedTransactionOptions,
): Promise<ActionGatePolicyDecision> {
  const policy_id = opts.policyId ?? 'atrib-trusted-transaction-gate'
  const policy_version = opts.policyVersion ?? '1'
  const untrusted = opts.onUntrusted ?? 'block'
  const base = {
    policy_id,
    policy_version,
    ...(opts.authority ? { authority: opts.authority } : {}),
    ...(opts.approval ? { approval: opts.approval } : {}),
  }
  const fail = (reason: string, evidence?: Record<string, string>): ActionGatePolicyDecision => ({
    ...base,
    outcome: untrusted,
    reason,
    ...(evidence ? { evidence } : {}),
  })

  if (opts.record.event_type !== EVENT_TYPE_TRANSACTION_URI) {
    return fail('action is not a transaction record; trusted cross-attestation does not apply')
  }
  if (!opts.trustedCreatorKeys || opts.trustedCreatorKeys.length === 0) {
    return fail('no trust set supplied; cannot establish trusted cross-attestation')
  }

  const result = await verifyRecordAnnotated(opts.record, {
    trustedCreatorKeys: [...opts.trustedCreatorKeys],
  })
  const attestation = result.cross_attestation
  const evidence: Record<string, string> = {
    signature_ok: String(result.signatureOk),
    signers_valid: String(attestation?.signers_valid ?? 0),
    signers_trusted: String(attestation?.signers_trusted ?? 0),
    sybil_suspected: String(attestation?.sybil_suspected ?? false),
    trust_evaluated: String(attestation?.trust_evaluated ?? false),
  }

  if (!result.signatureOk) {
    return fail('transaction record signature did not verify', evidence)
  }
  if (!isTrustedCrossAttested(attestation)) {
    return fail(
      'transaction is not trusted-cross-attested (fewer than 2 distinct verified signer keys in the trust set)',
      evidence,
    )
  }
  return {
    ...base,
    outcome: 'allow',
    reason: 'transaction is trusted-cross-attested',
    evidence,
  }
}

/** Options for {@link requireCorroborated}. */
export interface RequireCorroboratedOptions {
  /** `'sha256:<64-hex>'` record_hash of the record whose corroboration is required. */
  readonly targetRecordHash: string
  /** creator_key of the target, so self-attestation is rejected. Recommended. */
  readonly targetCreatorKey?: string
  /** Attestation records vouching for the target. */
  readonly attestations: readonly AttestationInput[]
  /** Trust set: base64url keys the host trusts as independent attestors. Empty/absent fails closed. */
  readonly trustedCreatorKeys?: readonly string[]
  /** Corroboration minimum. Default 2. */
  readonly minCorroborators?: number
  /** Outcome when not corroborated. Default `'block'` (fail closed). */
  readonly onUncorroborated?: 'block' | 'escalate'
  readonly policyId?: string
  readonly policyVersion?: string
  readonly authority?: ActionGateAuthority
  readonly approval?: ActionGateApproval
}

/**
 * Host-owned fail-closed policy requiring trusted corroboration of a target
 * record before an action proceeds (D133 + D150). The verifier aggregation
 * (`resolveAttestationCorroboration`) is signal-not-block; this policy turns it
 * into a requirement. Returns `allow` only when the target is corroborated by at
 * least `minCorroborators` (default 2) distinct verified attestors in the trust
 * set (`isCorroborated`). Fails closed on no trust set or too few trusted
 * attestors, blocking by default or escalating on request. The signed decision's
 * `evidence` carries the corroboration posture.
 */
export async function requireCorroborated(
  opts: RequireCorroboratedOptions,
): Promise<ActionGatePolicyDecision> {
  const policy_id = opts.policyId ?? 'atrib-corroboration-gate'
  const policy_version = opts.policyVersion ?? '1'
  const min = opts.minCorroborators ?? 2
  const uncorroborated = opts.onUncorroborated ?? 'block'
  const base = {
    policy_id,
    policy_version,
    ...(opts.authority ? { authority: opts.authority } : {}),
    ...(opts.approval ? { approval: opts.approval } : {}),
  }

  if (!opts.trustedCreatorKeys || opts.trustedCreatorKeys.length === 0) {
    return {
      ...base,
      outcome: uncorroborated,
      reason: 'no trust set supplied; cannot establish trusted corroboration',
    }
  }

  const result = await resolveAttestationCorroboration({
    targetRecordHash: opts.targetRecordHash,
    ...(opts.targetCreatorKey ? { targetCreatorKey: opts.targetCreatorKey } : {}),
    attestations: [...opts.attestations],
    trustedCreatorKeys: [...opts.trustedCreatorKeys],
    minCorroborators: min,
  })
  const evidence: Record<string, string> = {
    attestors_valid: String(result.attestors_valid),
    attestors_trusted: String(result.attestors_trusted ?? 0),
    under_corroborated: String(result.under_corroborated ?? false),
    trust_evaluated: String(result.trust_evaluated),
    min_corroborators: String(min),
  }
  if (!isCorroborated(result, min)) {
    return {
      ...base,
      outcome: uncorroborated,
      reason: `target not corroborated by ${min} distinct trusted attestors`,
      evidence,
    }
  }
  return { ...base, outcome: 'allow', reason: 'target is trusted-corroborated', evidence }
}

export function digestCanonical(value: unknown): Sha256Uri {
  return hashCanonical(value)
}

export function hashCanonical(value: unknown): Sha256Uri {
  const json = canonicalize(value)
  if (json === undefined) throw new Error('failed to canonicalize action-gate material')
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

export function recordHashFor(record: AtribRecord): Sha256Uri {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

export function resolveActionGatePrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) throw new Error('Action Gate privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/u.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) throw new Error('Action Gate privateKey must be 32 bytes')
  return decoded
}

function decisionStateFromPolicy(outcome: ActionGatePolicyOutcome): ActionGateDecisionState {
  if (outcome === 'allow') return 'allowed'
  if (outcome === 'block') return 'blocked'
  if (outcome === 'escalate') return 'escalated'
  if (outcome === 'error') return 'policy_error'
  throw new Error('policy outcome has an invalid value')
}

async function resolveOutcomeInput<TResult>({
  state,
  execute,
}: {
  readonly state: ActionGateDecisionState
  readonly execute: () => MaybePromise<TResult>
}): Promise<{
  readonly status: ActionGateOutcomeStatus
  readonly executed: boolean
  readonly result?: TResult
  readonly error?: { readonly name: string; readonly message: string }
}> {
  if (state === 'blocked') return { status: 'blocked', executed: false }
  if (state === 'escalated') return { status: 'escalated', executed: false }
  if (state === 'policy_error') return { status: 'policy_error', executed: false }
  try {
    return { status: 'executed', executed: true, result: await execute() }
  } catch (error) {
    return { status: 'execution_error', executed: true, error: normalizeError(error) }
  }
}

async function resolvePolicyDecision({
  evaluate,
  action,
  timestamp,
}: {
  readonly evaluate: (input: ActionGatePolicyInput) => MaybePromise<ActionGatePolicyDecision>
  readonly action: ActionGateActionEnvelope
  readonly timestamp: string
}): Promise<ActionGatePolicyDecision> {
  try {
    const decision = await evaluate({ action, timestamp })
    if (!isActionGatePolicyOutcome(decision.outcome)) {
      throw new Error('policy outcome has an invalid value')
    }
    return decision
  } catch (error) {
    const normalized = normalizeError(error)
    return {
      outcome: 'error',
      policy_id: 'action-gate-policy-evaluator',
      policy_version: 'error',
      reason: `policy evaluator failed: ${normalized.name}: ${normalized.message}`,
      authority: { mode: 'host-policy' },
      approval: { required: false },
    }
  }
}

function decisionSubject(entry: ActionGateDecisionEntry): unknown {
  return {
    schema: entry.schema,
    decision_id: entry.decision_id,
    run_id: entry.run_id,
    action_id: entry.action_id,
    agent_id: entry.agent_id,
    surface: entry.surface,
    tool_name: entry.tool_name,
    args_digest: entry.args_digest,
  }
}

function decisionResult(entry: ActionGateDecisionEntry): unknown {
  return {
    decision_state: entry.decision_state,
    risk: entry.risk,
    policy: entry.policy,
    parent_record_hashes: entry.parent_record_hashes,
    refs: entry.refs ?? {},
  }
}

function outcomeSubject(entry: ActionGateOutcomeEntry): unknown {
  return {
    schema: entry.schema,
    outcome_id: entry.outcome_id,
    run_id: entry.run_id,
    action_id: entry.action_id,
    decision_id: entry.decision_id,
    decision_record_hash: entry.decision_record_hash,
  }
}

function outcomeResult(entry: ActionGateOutcomeEntry): unknown {
  return {
    status: entry.status,
    executed: entry.executed,
    result_digest: entry.result_digest ?? null,
    error: entry.error ?? null,
  }
}

function snapshotCanonical(value: unknown): unknown | undefined {
  try {
    const json = canonicalize(value)
    if (json === undefined) return undefined
    return JSON.parse(json) as unknown
  } catch {
    return undefined
  }
}

async function notifyRecord(
  onRecord: RunGatedActionInput<unknown>['onRecord'],
  record: AtribRecord,
  sidecar: ActionGateLocalSidecar,
  errors: ActionGateRecordDeliveryError[],
): Promise<void> {
  if (!onRecord) return
  try {
    await onRecord(record, sidecar)
  } catch (error) {
    errors.push({
      record_kind: sidecar.record_kind,
      record_hash: sidecar.record_hash,
      ...normalizeError(error),
    })
  }
}

function sortedRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function decisionEntryIdFor(entry: ActionGateDecisionEntry): Sha256Uri {
  const { decision_id: _, ...entryWithoutId } = entry
  return hashCanonical(entryWithoutId)
}

function outcomeEntryIdFor(entry: ActionGateOutcomeEntry): Sha256Uri {
  const { outcome_id: _, ...entryWithoutId } = entry
  return hashCanonical(entryWithoutId)
}

function actionArgsDigest(action: ActionGateActionEnvelope): Sha256Uri {
  const supplied =
    action.args_digest === undefined
      ? undefined
      : normalizeSha256Uri(action.args_digest, 'args_digest')
  if (action.args !== undefined) {
    const computed = digestCanonical(action.args)
    if (supplied !== undefined && supplied !== computed) {
      throw new Error('args_digest does not match action args')
    }
    return supplied ?? computed
  }
  return supplied ?? digestCanonical({})
}

function outcomeResultDigest({
  result,
  result_digest,
}: {
  readonly result?: unknown
  readonly result_digest?: Sha256Uri
}): Sha256Uri {
  const supplied =
    result_digest === undefined ? undefined : normalizeSha256Uri(result_digest, 'result_digest')
  if (result !== undefined) {
    const computed = digestCanonical(result)
    if (supplied !== undefined && supplied !== computed) {
      throw new Error('result_digest does not match result')
    }
    return supplied ?? computed
  }
  if (supplied === undefined) {
    throw new Error('result or result_digest is required')
  }
  return supplied
}

function actionMatchesDecisionEntry(
  action: ActionGateActionEnvelope,
  entry: ActionGateDecisionEntry,
): boolean {
  try {
    return (
      action.run_id === entry.run_id &&
      action.action_id === entry.action_id &&
      action.agent_id === entry.agent_id &&
      action.surface === entry.surface &&
      action.tool_name === entry.tool_name &&
      actionArgsDigest(action) === entry.args_digest &&
      canonicalEqual([...(action.risk ?? [])].sort(), entry.risk) &&
      canonicalEqual(action.refs ? sortedRecord(action.refs) : undefined, entry.refs)
    )
  } catch {
    return false
  }
}

function outcomeStatusMatchesExecution(
  status: ActionGateOutcomeStatus,
  executed: boolean,
): boolean {
  if (!isActionGateOutcomeStatus(status) || typeof executed !== 'boolean') {
    return false
  }
  if (status === 'executed' || status === 'execution_error') return executed
  return !executed
}

function outcomeStatusPayloadValid(entry: ActionGateOutcomeEntry): boolean {
  if (entry.status === 'execution_error') {
    return entry.error !== undefined && entry.result_digest === undefined
  }
  return entry.error === undefined
}

function assertDecisionEntry(entry: ActionGateDecisionEntry): void {
  if (entry.schema !== ACTION_GATE_DECISION_SCHEMA) {
    throw new Error('decision entry uses the wrong schema')
  }
  if (entry.decision_id !== decisionEntryIdFor(entry)) {
    throw new Error('decision entry id does not match canonical fields')
  }
  if (!isActionGatePolicyOutcome(entry.policy.outcome)) {
    throw new Error('policy outcome has an invalid value')
  }
  if (entry.decision_state !== decisionStateFromPolicy(entry.policy.outcome)) {
    throw new Error('decision state does not match policy outcome')
  }
}

function assertOutcomeEntry(entry: ActionGateOutcomeEntry): void {
  if (entry.schema !== ACTION_GATE_OUTCOME_SCHEMA) {
    throw new Error('outcome entry uses the wrong schema')
  }
  if (entry.outcome_id !== outcomeEntryIdFor(entry)) {
    throw new Error('outcome entry id does not match canonical fields')
  }
  assertActionGateOutcomeStatus(entry.status)
  assertExecutedFlag(entry.executed)
  if (entry.result_digest !== undefined) {
    normalizeSha256Uri(entry.result_digest, 'result_digest')
  }
  if (!outcomeStatusMatchesExecution(entry.status, entry.executed)) {
    throw new Error('outcome status contradicts executed')
  }
  if (!outcomeStatusPayloadValid(entry)) {
    throw new Error('outcome status contradicts result or error material')
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right)
}

function normalizeSha256Uri(value: string, field: string): Sha256Uri {
  if (!isSha256Uri(value)) {
    throw new Error(`${field} must be sha256:<64 lowercase hex>`)
  }
  return value as Sha256Uri
}

function isSha256Uri(value: unknown): value is Sha256Uri {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value)
}

function isActionGatePolicyOutcome(value: unknown): value is ActionGatePolicyOutcome {
  return value === 'allow' || value === 'block' || value === 'escalate' || value === 'error'
}

function isActionGateOutcomeStatus(value: unknown): value is ActionGateOutcomeStatus {
  return (
    value === 'executed' ||
    value === 'not_executed' ||
    value === 'blocked' ||
    value === 'escalated' ||
    value === 'policy_error' ||
    value === 'execution_error'
  )
}

function assertActionGateOutcomeStatus(value: unknown): asserts value is ActionGateOutcomeStatus {
  if (!isActionGateOutcomeStatus(value)) {
    throw new Error('outcome status has an invalid value')
  }
}

function assertExecutedFlag(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error('executed must be a boolean')
  }
}

function normalizeRecordHashes(values: readonly string[]): Sha256Uri[] {
  const unique = new Set<Sha256Uri>()
  for (const value of values) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
      throw new Error('record hashes must be sha256:<64 lowercase hex>')
    }
    unique.add(value as Sha256Uri)
  }
  return [...unique].sort()
}

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}
