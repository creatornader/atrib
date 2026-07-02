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
} from '@atrib/verify'

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
  | 'executed'
  | 'blocked'
  | 'escalated'
  | 'policy_error'
  | 'execution_error'

export interface ActionGateActionEnvelope {
  readonly run_id: string
  readonly action_id: string
  readonly agent_id: string
  readonly surface: string
  readonly tool_name: string
  readonly args?: unknown
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

export type ActionGateVerificationIssueCode =
  | 'decision_signature_invalid'
  | 'outcome_signature_invalid'
  | 'decision_sidecar_hash_mismatch'
  | 'outcome_sidecar_hash_mismatch'
  | 'outcome_missing_decision_parent'
  | 'decision_record_hash_mismatch'
  | 'decision_id_mismatch'
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
    args_digest: digestCanonical(action.args ?? {}),
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
  readonly error?: { readonly name: string; readonly message: string }
}): ActionGateOutcomeEntry {
  const entryWithoutId = {
    schema: ACTION_GATE_OUTCOME_SCHEMA,
    status,
    run_id,
    action_id,
    decision_id,
    decision_record_hash,
    executed,
    ...(result !== undefined ? { result_digest: digestCanonical(result) } : {}),
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
      args: snapshotCanonical(action.args ?? {}),
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
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId(serverUrl, `${OUTCOME_TOOL_NAME}.${entry.status}`),
    creator_key: creatorKey,
    chain_root: resolveChainRoot({ contextId, autoChainTailHex: chainTailHex }),
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

  const state = decision.entry.decision_state
  if (state === 'allowed' && !['executed', 'execution_error'].includes(outcome.entry.status)) {
    issues.push({
      code: 'allowed_action_missing_execution_status',
      message: 'allowed decisions must end in executed or execution_error',
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
   * signer keys drawn from this set (§1.7.6 trusted signer composition, D135).
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
 * Host-owned fail-closed policy for transaction actions (D133 + D135). This is
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
  return 'policy_error'
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
    return await evaluate({ action, timestamp })
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
