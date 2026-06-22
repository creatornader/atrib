// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { BasePlugin } from '@google/adk'
import type { BaseTool, Context } from '@google/adk'
import canonicalize from 'canonicalize'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  EVENT_TYPE_TOOL_CALL_URI,
  getPublicKey,
  hexDecode,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

export const GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI =
  'https://google-adk-decision-ledger.example/v1'
export const GOOGLE_ADK_DECISION_LEDGER_SCHEMA =
  'atrib.google-adk.decision-ledger.entry.v1'

const DEFAULT_PLUGIN_NAME = 'atrib_google_adk_decision_ledger'
const DEFAULT_SERVER_URL = 'google-adk-decision-ledger://runner'
const encoder = new TextEncoder()

export type GoogleAdkDecisionState =
  | 'allowed'
  | 'refused'
  | 'confirmation_required'
  | 'confirmation_resolved'
  | 'stale_or_mismatched'
  | 'policy_error'

export type GoogleAdkAuthorityMode = 'agent-auth' | 'user-auth'
export type GoogleAdkPolicyOutcome = 'allow' | 'deny' | 'escalate' | 'error'

export interface GoogleAdkDecisionAuthority {
  mode: GoogleAdkAuthorityMode
  principal_hash: string
}

export interface GoogleAdkDecisionPolicy {
  source: 'plugin' | 'tool_context' | 'confirmation'
  rule: string
  version: string
  outcome: GoogleAdkPolicyOutcome
  reason?: string
}

export interface GoogleAdkDecisionConfirmation {
  required: boolean
  confirmation_id?: string
  response_payload_digest?: string
  binding_hash?: string
  expires_at?: string
}

export interface GoogleAdkDecisionLedgerEntry {
  schema: typeof GOOGLE_ADK_DECISION_LEDGER_SCHEMA
  decision_id: string
  decision_state: GoogleAdkDecisionState
  invocation_id: string
  session_id: string
  step: number
  tool_call_id: string
  tool_name: string
  canonical_args_digest: string
  authority: GoogleAdkDecisionAuthority
  policy: GoogleAdkDecisionPolicy
  confirmation: GoogleAdkDecisionConfirmation
  model_rationale: {
    text: string
    trust: 'untrusted_generated'
  }
  timestamp: string
  parent_record_hashes: string[]
  result_digest?: string
}

export interface GoogleAdkDecisionLocalSidecar {
  framework: 'google-adk'
  plugin_name: string
  record_kind: 'decision' | 'tool_outcome'
  decision_entry?: GoogleAdkDecisionLedgerEntry
  operation: string
  tool_name: string
  invocation_id: string
  session_id: string
  user_id: string
  agent_name: string
  function_call_id?: string
  args?: unknown
  result?: unknown
  error?: { name: string; message: string }
  principal?: string
  record_hash: string
  informed_by: string[]
}

export interface GoogleAdkDecisionPolicyInput {
  tool: BaseTool
  toolArgs: Record<string, unknown>
  toolContext: Context
}

export interface GoogleAdkDecisionPolicyResult {
  decision_state: 'allowed' | 'refused' | 'policy_error'
  authority: GoogleAdkDecisionAuthority
  principal?: string
  policy: GoogleAdkDecisionPolicy
  model_rationale?: string
  response?: Record<string, unknown>
}

export interface GoogleAdkDecisionLedgerPluginOptions {
  privateKey?: Uint8Array | string
  contextId?: string
  serverUrl?: string
  parentRecordHashes?: string[]
  now?: () => number
  policy?: (input: GoogleAdkDecisionPolicyInput) => GoogleAdkDecisionPolicyResult
  onRecord?: (
    record: AtribRecord,
    sidecar: GoogleAdkDecisionLocalSidecar,
  ) => void | Promise<void>
  pluginName?: string
}

export interface SignedGoogleAdkDecision {
  record: AtribRecord
  record_hash: string
  entry: GoogleAdkDecisionLedgerEntry
  sidecar: GoogleAdkDecisionLocalSidecar
}

export interface SignedGoogleAdkOutcome {
  record: AtribRecord
  record_hash: string
  decision_record_hash: string
  sidecar: GoogleAdkDecisionLocalSidecar
}

export interface GoogleAdkConfirmationBindingInput {
  tool_name: string
  canonical_args_digest: string
  authority: GoogleAdkDecisionAuthority
  policy_version: string
  expires_at: string
}

export interface GoogleAdkExecutionBindingCheck {
  ok: boolean
  decision_state: 'confirmation_resolved' | 'stale_or_mismatched'
  reasons: string[]
  expected_binding_hash: string
  actual_binding_hash: string
}

type PendingDecision = {
  decision: SignedGoogleAdkDecision
  principal?: string
}

type ToolOutcome =
  | { status: 'ok'; result: unknown }
  | { status: 'error'; error: { name: string; message: string } }

export class AtribAdkDecisionLedgerPlugin extends BasePlugin {
  readonly contextId: string
  creatorKey = ''

  private readonly privateKey: Uint8Array | undefined
  private readonly serverUrl: string
  private readonly parentRecordHashes: string[]
  private readonly now: () => number
  private readonly onRecord: GoogleAdkDecisionLedgerPluginOptions['onRecord']
  private readonly policy: (input: GoogleAdkDecisionPolicyInput) => GoogleAdkDecisionPolicyResult
  private readonly records: AtribRecord[] = []
  private readonly sidecars: GoogleAdkDecisionLocalSidecar[] = []
  private readonly decisions: SignedGoogleAdkDecision[] = []
  private readonly outcomes: SignedGoogleAdkOutcome[] = []
  private readonly pending = new Map<string, PendingDecision>()
  private lastRecordHashHex: string | undefined
  private step = 0
  private initPromise: Promise<void> | undefined

  constructor(options: GoogleAdkDecisionLedgerPluginOptions = {}) {
    super(options.pluginName ?? DEFAULT_PLUGIN_NAME)
    this.privateKey = tryResolvePrivateKey(options.privateKey)
    this.contextId = options.contextId ?? randomContextId()
    this.serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL
    this.parentRecordHashes = normalizeRecordHashes(options.parentRecordHashes ?? [])
    this.now = options.now ?? Date.now
    this.policy = options.policy ?? defaultAllowPolicy
    this.onRecord = options.onRecord
  }

  override async beforeToolCallback({
    tool,
    toolArgs,
    toolContext,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
  }): Promise<Record<string, unknown> | undefined> {
    const privateKey = this.privateKey
    if (!privateKey) return undefined

    const policy = this.policy({ tool, toolArgs, toolContext })
    const decision = await this.signDecision({
      tool,
      toolArgs,
      toolContext,
      decisionState: policy.decision_state,
      authority: policy.authority,
      policy: policy.policy,
      timestampMs: this.now(),
      ...(policy.model_rationale ? { modelRationale: policy.model_rationale } : {}),
      ...(policy.principal ? { principal: policy.principal } : {}),
    })
    this.pending.set(toolCallMarker(tool, toolContext), {
      decision,
      ...(policy.principal ? { principal: policy.principal } : {}),
    })

    if (policy.decision_state === 'allowed') return undefined
    return (
      policy.response ?? {
        atrib_decision: policy.decision_state,
        decision_record_hash: decision.record_hash,
        reason: policy.policy.reason ?? policy.policy.outcome,
      }
    )
  }

  override async afterToolCallback({
    tool,
    toolArgs,
    toolContext,
    result,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    result: Record<string, unknown>
  }): Promise<Record<string, unknown> | undefined> {
    const pending = this.pending.get(toolCallMarker(tool, toolContext))
    if (!pending || pending.decision.entry.decision_state !== 'allowed') return undefined
    await this.signToolOutcome(tool, toolArgs, toolContext, pending, {
      status: 'ok',
      result,
    })
    return undefined
  }

  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    error: Error
  }): Promise<Record<string, unknown> | undefined> {
    const pending = this.pending.get(toolCallMarker(tool, toolContext))
    if (!pending) return undefined
    await this.signToolOutcome(tool, toolArgs, toolContext, pending, {
      status: 'error',
      error: normalizeError(error),
    })
    return undefined
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): GoogleAdkDecisionLocalSidecar[] {
    return [...this.sidecars]
  }

  getDecisions(): SignedGoogleAdkDecision[] {
    return [...this.decisions]
  }

  getOutcomes(): SignedGoogleAdkOutcome[] {
    return [...this.outcomes]
  }

  private async signDecision({
    tool,
    toolArgs,
    toolContext,
    decisionState,
    authority,
    policy,
    modelRationale,
    principal,
    timestampMs,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    decisionState: 'allowed' | 'refused' | 'policy_error'
    authority: GoogleAdkDecisionAuthority
    policy: GoogleAdkDecisionPolicy
    modelRationale?: string
    principal?: string
    timestampMs: number
  }): Promise<SignedGoogleAdkDecision> {
    await this.init()
    const step = ++this.step
    const parentRecordHashes = this.lastRecordHashHex
      ? [`sha256:${this.lastRecordHashHex}`]
      : this.parentRecordHashes
    const timestamp = new Date(timestampMs).toISOString()
    const entry = buildDecisionLedgerEntry({
      decision_state: decisionState,
      invocation_id: toolContext.invocationId,
      session_id: toolContext.sessionId,
      step,
      tool_call_id: toolContext.functionCallId ?? `${tool.name}:no-call-id:${step}`,
      tool_name: tool.name,
      args: toolArgs,
      authority,
      policy,
      confirmation: { required: false },
      model_rationale: modelRationale ?? '',
      timestamp,
      parent_record_hashes: parentRecordHashes,
    })
    const operation = `google.adk.decision.${decisionState}`
    const signed = await signDecisionEntry({
      entry,
      privateKey: this.privateKey!,
      creatorKey: this.creatorKey,
      contextId: this.contextId,
      serverUrl: this.serverUrl,
      operation,
      informedBy: parentRecordHashes,
      timestampMs,
      ...(this.lastRecordHashHex ? { chainTailHex: this.lastRecordHashHex } : {}),
    })
    this.lastRecordHashHex = signed.record_hash.slice('sha256:'.length)
    this.records.push(signed.record)
    const decisionSidecar: GoogleAdkDecisionLocalSidecar = {
      ...signed.sidecar,
      plugin_name: this.name,
      user_id: toolContext.userId,
      agent_name: toolContext.agentName,
      ...(toolContext.functionCallId ? { function_call_id: toolContext.functionCallId } : {}),
      args: snapshotCanonical(toolArgs),
      ...(principal ? { principal } : {}),
    }
    this.sidecars.push(decisionSidecar)
    this.decisions.push({
      ...signed,
      sidecar: decisionSidecar,
    })
    await this.onRecord?.(signed.record, this.sidecars[this.sidecars.length - 1]!)
    return this.decisions[this.decisions.length - 1]!
  }

  private async signToolOutcome(
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    toolContext: Context,
    pending: PendingDecision,
    outcome: ToolOutcome,
  ): Promise<SignedGoogleAdkOutcome | undefined> {
    const privateKey = this.privateKey
    if (!privateKey) return undefined
    await this.init()

    const argsSnapshot = snapshotCanonical(toolArgs)
    const outcomeSnapshot = snapshotCanonical(outcome)
    if (argsSnapshot === undefined || outcomeSnapshot === undefined) return undefined

    const operation = `google.adk.tool.${tool.name}`
    const informedBy = [pending.decision.record_hash]
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: computeContentId(this.serverUrl, operation),
      creator_key: this.creatorKey,
      chain_root: resolveChainRoot({
        contextId: this.contextId,
        autoChainTailHex: this.lastRecordHashHex,
      }),
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: this.contextId,
      timestamp: this.now(),
      signature: '',
      args_hash: hashCanonical(argsSnapshot),
      result_hash: hashCanonical(outcomeSnapshot),
      tool_name: operation,
      informed_by: informedBy,
    }
    const signed = await signRecord(record, privateKey)
    const recordHash = recordHashFor(signed)
    const sidecar: GoogleAdkDecisionLocalSidecar = {
      framework: 'google-adk',
      plugin_name: this.name,
      record_kind: 'tool_outcome',
      operation,
      tool_name: tool.name,
      invocation_id: toolContext.invocationId,
      session_id: toolContext.sessionId,
      user_id: toolContext.userId,
      agent_name: toolContext.agentName,
      ...(toolContext.functionCallId ? { function_call_id: toolContext.functionCallId } : {}),
      args: argsSnapshot,
      ...(outcome.status === 'ok' ? { result: outcome.result } : { error: outcome.error }),
      ...(pending.principal ? { principal: pending.principal } : {}),
      record_hash: recordHash,
      informed_by: informedBy,
    }
    this.lastRecordHashHex = recordHash.slice('sha256:'.length)
    this.records.push(signed)
    this.sidecars.push(sidecar)
    const result = {
      record: signed,
      record_hash: recordHash,
      decision_record_hash: pending.decision.record_hash,
      sidecar,
    }
    this.outcomes.push(result)
    await this.onRecord?.(signed, sidecar)
    return result
  }

  private async init(): Promise<void> {
    if (!this.privateKey || this.creatorKey) return
    this.initPromise ??= getPublicKey(this.privateKey).then((pubkey) => {
      this.creatorKey = base64urlEncode(pubkey)
    })
    await this.initPromise
  }
}

export function buildDecisionLedgerEntry(params: {
  decision_state: GoogleAdkDecisionState
  invocation_id: string
  session_id: string
  step: number
  tool_call_id: string
  tool_name: string
  args?: unknown
  canonical_args_digest?: string
  authority: GoogleAdkDecisionAuthority
  policy: GoogleAdkDecisionPolicy
  confirmation: GoogleAdkDecisionConfirmation
  model_rationale?: string
  timestamp: string
  parent_record_hashes?: string[]
  result?: unknown
  result_digest?: string
}): GoogleAdkDecisionLedgerEntry {
  const canonicalArgsDigest = params.canonical_args_digest ?? digestCanonical(params.args ?? {})
  const entryWithoutId: Omit<GoogleAdkDecisionLedgerEntry, 'decision_id'> = {
    schema: GOOGLE_ADK_DECISION_LEDGER_SCHEMA,
    decision_state: params.decision_state,
    invocation_id: params.invocation_id,
    session_id: params.session_id,
    step: params.step,
    tool_call_id: params.tool_call_id,
    tool_name: params.tool_name,
    canonical_args_digest: canonicalArgsDigest,
    authority: params.authority,
    policy: params.policy,
    confirmation: params.confirmation,
    model_rationale: {
      text: params.model_rationale ?? '',
      trust: 'untrusted_generated' as const,
    },
    timestamp: params.timestamp,
    parent_record_hashes: normalizeRecordHashes(params.parent_record_hashes ?? []),
    ...(params.result_digest || params.result !== undefined
      ? { result_digest: params.result_digest ?? digestCanonical(params.result) }
      : {}),
  }
  return {
    ...entryWithoutId,
    decision_id: digestCanonical(entryWithoutId),
  }
}

export async function signDecisionEntry({
  entry,
  privateKey,
  creatorKey,
  contextId,
  serverUrl = DEFAULT_SERVER_URL,
  operation = `google.adk.decision.${entry.decision_state}`,
  chainTailHex,
  informedBy = entry.parent_record_hashes,
  timestampMs,
}: {
  entry: GoogleAdkDecisionLedgerEntry
  privateKey: Uint8Array
  creatorKey?: string
  contextId: string
  serverUrl?: string
  operation?: string
  chainTailHex?: string
  informedBy?: string[]
  timestampMs: number
}): Promise<SignedGoogleAdkDecision> {
  const normalizedInformedBy = normalizeRecordHashes(informedBy)
  const resolvedCreatorKey = creatorKey || base64urlEncode(await getPublicKey(privateKey))
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: computeContentId(serverUrl, operation),
    creator_key: resolvedCreatorKey,
    chain_root: resolveChainRoot({
      contextId,
      autoChainTailHex: chainTailHex,
    }),
    event_type: GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI,
    context_id: contextId,
    timestamp: timestampMs,
    signature: '',
    args_hash: hashCanonical(decisionSubject(entry)),
    result_hash: hashCanonical(decisionResult(entry)),
    tool_name: operation,
    ...(normalizedInformedBy.length > 0 ? { informed_by: normalizedInformedBy } : {}),
  }
  const signed = await signRecord(record, privateKey)
  const recordHash = recordHashFor(signed)
  const sidecar: GoogleAdkDecisionLocalSidecar = {
    framework: 'google-adk',
    plugin_name: DEFAULT_PLUGIN_NAME,
    record_kind: 'decision',
    decision_entry: entry,
    operation,
    tool_name: entry.tool_name,
    invocation_id: entry.invocation_id,
    session_id: entry.session_id,
    user_id: 'unknown',
    agent_name: 'unknown',
    function_call_id: entry.tool_call_id,
    record_hash: recordHash,
    informed_by: normalizedInformedBy,
  }
  return { record: signed, record_hash: recordHash, entry, sidecar }
}

export function buildConfirmationBindingHash(input: GoogleAdkConfirmationBindingInput): string {
  return digestCanonical({
    tool_name: input.tool_name,
    canonical_args_digest: input.canonical_args_digest,
    authority: input.authority,
    policy_version: input.policy_version,
    expires_at: input.expires_at,
  })
}

export function checkAuthorizedExecutionBinding({
  decision,
  toolName,
  args,
  authority,
  policyVersion,
  expiresAt,
  now,
}: {
  decision: GoogleAdkDecisionLedgerEntry
  toolName: string
  args: unknown
  authority: GoogleAdkDecisionAuthority
  policyVersion: string
  expiresAt: string
  now: string
}): GoogleAdkExecutionBindingCheck {
  const canonicalArgsDigest = digestCanonical(args)
  const actualBindingHash = buildConfirmationBindingHash({
    tool_name: toolName,
    canonical_args_digest: canonicalArgsDigest,
    authority,
    policy_version: policyVersion,
    expires_at: expiresAt,
  })
  const expectedBindingHash = decision.confirmation.binding_hash ?? ''
  const reasons = []
  if (decision.decision_state !== 'confirmation_resolved') reasons.push('decision_not_resolved')
  if (decision.tool_name !== toolName) reasons.push('tool_mismatch')
  if (decision.canonical_args_digest !== canonicalArgsDigest) reasons.push('args_mismatch')
  if (decision.authority.mode !== authority.mode) reasons.push('authority_mode_mismatch')
  if (decision.authority.principal_hash !== authority.principal_hash) {
    reasons.push('principal_mismatch')
  }
  if (decision.policy.version !== policyVersion) reasons.push('policy_version_mismatch')
  if (expectedBindingHash !== actualBindingHash) reasons.push('confirmation_binding_mismatch')
  if (Date.parse(now) > Date.parse(expiresAt)) reasons.push('confirmation_expired')
  return {
    ok: reasons.length === 0,
    decision_state: reasons.length === 0 ? 'confirmation_resolved' : 'stale_or_mismatched',
    reasons,
    expected_binding_hash: expectedBindingHash,
    actual_binding_hash: actualBindingHash,
  }
}

export function hashPrincipal(principal: string): string {
  return digestCanonical({ principal })
}

export function digestCanonical(value: unknown): string {
  return hashCanonical(value)
}

export function recordHashFor(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

export async function verifySignedGoogleAdkDecision(record: AtribRecord): Promise<boolean> {
  return verifyRecord(record)
}

export function resolveAdkDecisionPrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) throw new Error('ADK decision ledger privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) throw new Error('ADK decision ledger privateKey must be 32 bytes')
  return decoded
}

function defaultAllowPolicy({
  tool,
}: GoogleAdkDecisionPolicyInput): GoogleAdkDecisionPolicyResult {
  const principal = 'agent:google-adk-local-smoke'
  return {
    decision_state: 'allowed',
    authority: { mode: 'agent-auth', principal_hash: hashPrincipal(principal) },
    principal,
    policy: {
      source: 'plugin',
      rule: `${tool.name}:default-allow`,
      version: 'local-policy-v1',
      outcome: 'allow',
    },
    model_rationale: 'scripted model requested the tool',
  }
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveAdkDecisionPrivateKey(raw)
  } catch {
    return undefined
  }
}

function decisionSubject(entry: GoogleAdkDecisionLedgerEntry): unknown {
  return {
    schema: entry.schema,
    decision_id: entry.decision_id,
    invocation_id: entry.invocation_id,
    session_id: entry.session_id,
    step: entry.step,
    tool_call_id: entry.tool_call_id,
    tool_name: entry.tool_name,
    canonical_args_digest: entry.canonical_args_digest,
  }
}

function decisionResult(entry: GoogleAdkDecisionLedgerEntry): unknown {
  return {
    decision_state: entry.decision_state,
    authority: entry.authority,
    policy: entry.policy,
    confirmation: entry.confirmation,
    result_digest: entry.result_digest ?? null,
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) throw new Error('failed to canonicalize Google ADK decision material')
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
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

function normalizeRecordHashes(values: string[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
      throw new Error('record hashes must be sha256:<64 lowercase hex>')
    }
    unique.add(value)
  }
  return [...unique].sort()
}

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}

function toolCallMarker(tool: BaseTool, toolContext: Context): string {
  return `${tool.name}:${toolContext.functionCallId ?? 'no-call-id'}`
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}
