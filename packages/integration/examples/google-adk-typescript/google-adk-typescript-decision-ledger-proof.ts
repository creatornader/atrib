// SPDX-License-Identifier: Apache-2.0

import {
  BaseLlm,
  FunctionTool,
  getFunctionCalls,
  getFunctionResponses,
  InMemoryRunner,
  LlmAgent,
  setLogger,
  version as adkVersion,
} from '@google/adk'
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk'
import { hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import {
  AtribAdkDecisionLedgerPlugin,
  buildConfirmationBindingHash,
  buildDecisionLedgerEntry,
  checkAuthorizedExecutionBinding,
  digestCanonical,
  GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI,
  GOOGLE_ADK_DECISION_LEDGER_SCHEMA,
  hashPrincipal,
  signDecisionEntry,
  verifySignedGoogleAdkDecision,
} from '../../src/google-adk-typescript-decision-ledger.js'
import type {
  GoogleAdkDecisionAuthority,
  GoogleAdkDecisionLedgerEntry,
  GoogleAdkDecisionLocalSidecar,
  SignedGoogleAdkDecision,
  SignedGoogleAdkOutcome,
} from '../../src/google-adk-typescript-decision-ledger.js'

const privateKey = Buffer.from(
  '5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344',
  'hex',
)
const contextId = '676f6f676c652d61646b2d6465633130'
const baseTimestamp = 1_779_846_000_000
const privatePhrase = 'decision ledger private tool note'
const parentRecordHash = `sha256:${'a'.repeat(64)}`

type DecisionLedgerProofResult = {
  ok: true
  strategy: 'atrib-google-adk-typescript-decision-ledger-proof-v1'
  adk: {
    package: '@google/adk'
    version: string
    runner: 'InMemoryRunner'
    plugin: 'BasePlugin'
    tool: 'FunctionTool'
  }
  contract: {
    schema: typeof GOOGLE_ADK_DECISION_LEDGER_SCHEMA
    event_type: typeof GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI
    decision_states: string[]
    framework_attested_fields: string[]
    derived_commitments: string[]
    untrusted_fields: string[]
  }
  live_adk: {
    allowed: LiveRunSummary
    refused: LiveRunSummary
    policy_error: LiveRunSummary
  }
  confirmation: {
    required: DecisionSummary
    resolved: DecisionSummary
    stale_or_mismatched: DecisionSummary
    binding_reasons: string[]
    fail_closed: true
  }
  record_hashes: {
    allowed_decision: string
    allowed_tool_outcome: string
    refused_decision: string
    policy_error_decision: string
    confirmation_required: string
    confirmation_resolved: string
    stale_or_mismatched: string
  }
  proof: {
    allowed_execution_informed_by_decision: true
    refused_tool_body_executed: false
    policy_error_tool_body_executed: false
    confirmation_binding_covers: string[]
    stale_mismatch_detected: true
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
    public_records_omit_private_phrase: true
    public_records_omit_raw_principal: true
  }
  caveats: string[]
}

type LiveRunSummary = {
  decision_state: 'allowed' | 'refused' | 'policy_error'
  decision_record_hash: string
  outcome_record_hash: string | null
  tool_body_executed: boolean
  yielded_events: number
  function_call_events: number
  function_response_events: number
}

export type GoogleAdkDecisionOperationalIds = {
  trace_id: string
  span_id: string
  adk_invocation_id: string
  adk_session_id: string
  adk_function_call_id: string | null
  adk_agent_name: string
  source: 'local-adk-decision-sidecar'
  trace_projection: 'deterministic-local'
}

export interface GoogleAdkDecisionLedgerPathOptions {
  contextId?: string
  parentRecordHash?: string
  sessionId?: string
  deterministicRandomSeed?: number
  nowMs?: number
  prompt?: string
  sku?: string
}

export interface GoogleAdkDecisionLedgerPathResult {
  summary: LiveRunSummary
  decision: SignedGoogleAdkDecision
  outcome: SignedGoogleAdkOutcome
  publicRecords: AtribRecord[]
  sidecars: GoogleAdkDecisionLocalSidecar[]
  google_operational_ids: GoogleAdkDecisionOperationalIds[]
}

type DecisionSummary = {
  decision_state: GoogleAdkDecisionLedgerEntry['decision_state']
  record_hash: string
  canonical_args_digest: string
  confirmation_binding_hash: string | null
}

class SingleToolCallModel extends BaseLlm {
  private calls = 0

  constructor(private readonly args: Record<string, unknown>) {
    super({ model: 'atrib-scripted-adk-decision-ledger-model' })
  }

  override async *generateContentAsync(
    _llmRequest: LlmRequest,
    _stream?: boolean,
    _abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    this.calls += 1
    if (this.calls === 1) {
      yield {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: `adk-decision-call-${this.args.sku}`,
                name: 'quote_price',
                args: this.args,
              },
            },
          ],
        },
      }
      return
    }

    yield {
      content: {
        role: 'model',
        parts: [{ text: `Decision path complete for ${String(this.args.sku)}.` }],
      },
    }
  }

  override async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('google-adk decision ledger proof does not use live model connections')
  }
}

export async function runGoogleAdkTypeScriptDecisionLedgerProof(): Promise<DecisionLedgerProofResult> {
  setLogger(null)

  const allowed = await runLiveDecisionPath({
    sku: 'atlas-kit',
    policyOutcome: 'allow',
    nowMs: baseTimestamp,
  })
  const refused = await runLiveDecisionPath({
    sku: 'denied-kit',
    policyOutcome: 'deny',
    nowMs: baseTimestamp + 10_000,
  })
  const policyError = await runLiveDecisionPath({
    sku: 'policy-error-kit',
    policyOutcome: 'error',
    nowMs: baseTimestamp + 15_000,
  })
  const confirmation = await buildConfirmationProof({
    chainTailHex: policyError.summary.decision_record_hash.slice('sha256:'.length),
    startTimestampMs: baseTimestamp + 20_000,
  })

  const publicRecordsJson = JSON.stringify([
    ...allowed.publicRecords,
    ...refused.publicRecords,
    ...policyError.publicRecords,
    ...confirmation.publicRecords,
  ])
  const sidecarsJson = JSON.stringify([
    ...allowed.sidecars,
    ...refused.sidecars,
    ...policyError.sidecars,
  ])
  if (publicRecordsJson.includes(privatePhrase)) {
    throw new Error('public decision ledger records leaked private tool material')
  }
  if (!sidecarsJson.includes(privatePhrase)) {
    throw new Error('decision ledger sidecars should keep inspectable tool material')
  }
  if (publicRecordsJson.includes('user:atlas-buyer@example.test')) {
    throw new Error('public decision ledger records leaked the raw principal')
  }

  return {
    ok: true,
    strategy: 'atrib-google-adk-typescript-decision-ledger-proof-v1',
    adk: {
      package: '@google/adk',
      version: adkVersion,
      runner: 'InMemoryRunner',
      plugin: 'BasePlugin',
      tool: 'FunctionTool',
    },
    contract: {
      schema: GOOGLE_ADK_DECISION_LEDGER_SCHEMA,
      event_type: GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI,
      decision_states: [
        'allowed',
        'refused',
        'confirmation_required',
        'confirmation_resolved',
        'stale_or_mismatched',
        'policy_error',
      ],
      framework_attested_fields: [
        'invocation_id',
        'session_id',
        'tool_call_id',
        'tool_name',
        'authority.mode',
        'authority.principal_hash',
        'policy.source',
        'policy.version',
        'policy.outcome',
        'decision_state',
      ],
      derived_commitments: [
        'canonical_args_digest',
        'confirmation.binding_hash',
        'result_digest',
      ],
      untrusted_fields: ['model_rationale.text'],
    },
    live_adk: {
      allowed: allowed.summary,
      refused: refused.summary,
      policy_error: policyError.summary,
    },
    confirmation: {
      required: summarizeDecision(confirmation.required),
      resolved: summarizeDecision(confirmation.resolved),
      stale_or_mismatched: summarizeDecision(confirmation.stale),
      binding_reasons: confirmation.binding.reasons,
      fail_closed: true,
    },
    record_hashes: {
      allowed_decision: allowed.summary.decision_record_hash,
      allowed_tool_outcome: allowed.summary.outcome_record_hash!,
      refused_decision: refused.summary.decision_record_hash,
      policy_error_decision: policyError.summary.decision_record_hash,
      confirmation_required: confirmation.required.record_hash,
      confirmation_resolved: confirmation.resolved.record_hash,
      stale_or_mismatched: confirmation.stale.record_hash,
    },
    proof: {
      allowed_execution_informed_by_decision: true,
      refused_tool_body_executed: false,
      policy_error_tool_body_executed: false,
      confirmation_binding_covers: [
        'tool_name',
        'canonical_args_digest',
        'authority.mode',
        'authority.principal_hash',
        'policy.version',
        'expires_at',
      ],
      stale_mismatch_detected: true,
    },
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
      public_records_omit_private_phrase: true,
      public_records_omit_raw_principal: true,
    },
    caveats: [
      'The allowed, refused, and policy_error states run through real @google/adk TypeScript InMemoryRunner BasePlugin callbacks.',
      'The confirmation states are contract fixtures because ADK ToolConfirmation does not expose a native binding tag today.',
      'This proof does not claim Agent Platform Runtime, Gemini Enterprise, BigQuery export, or Google adoption.',
    ],
  }
}

export async function runGoogleAdkTypeScriptDecisionLedgerAllowPath(
  options: GoogleAdkDecisionLedgerPathOptions = {},
): Promise<GoogleAdkDecisionLedgerPathResult> {
  const path = await runLiveDecisionPath({
    sku: options.sku ?? 'atlas-kit',
    policyOutcome: 'allow',
    nowMs: options.nowMs ?? baseTimestamp,
    runContextId: options.contextId ?? contextId,
    rootParentRecordHash: options.parentRecordHash ?? parentRecordHash,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.deterministicRandomSeed !== undefined
      ? { deterministicRandomSeed: options.deterministicRandomSeed }
      : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
  })
  if (!path.outcome) throw new Error('allowed ADK decision did not sign a tool outcome')
  return {
    ...path,
    outcome: path.outcome,
  }
}

async function runLiveDecisionPath({
  sku,
  policyOutcome,
  nowMs,
  runContextId = contextId,
  rootParentRecordHash = parentRecordHash,
  sessionId,
  deterministicRandomSeed,
  prompt,
}: {
  sku: string
  policyOutcome: 'allow' | 'deny' | 'error'
  nowMs: number
  runContextId?: string
  rootParentRecordHash?: string
  sessionId?: string
  deterministicRandomSeed?: number
  prompt?: string
}): Promise<{
  summary: LiveRunSummary
  decision: SignedGoogleAdkDecision
  outcome?: SignedGoogleAdkOutcome
  publicRecords: AtribRecord[]
  sidecars: GoogleAdkDecisionLocalSidecar[]
  google_operational_ids: GoogleAdkDecisionOperationalIds[]
}> {
  setLogger(null)
  let clock = nowMs
  let toolBodyExecutions = 0
  const principal = 'user:atlas-buyer@example.test'
  const plugin = new AtribAdkDecisionLedgerPlugin({
    privateKey,
    contextId: runContextId,
    serverUrl: 'google-adk-typescript-decision-ledger://proof',
    parentRecordHashes: [rootParentRecordHash],
    now: () => clock++,
    policy: ({ tool }) => ({
      decision_state:
        policyOutcome === 'allow'
          ? 'allowed'
          : policyOutcome === 'deny'
            ? 'refused'
            : 'policy_error',
      authority: {
        mode: 'user-auth',
        principal_hash: hashPrincipal(principal),
      },
      principal,
      policy: {
        source: 'plugin',
        rule: `${tool.name}:atlas-policy`,
        version: 'atlas-policy-v1',
        outcome: policyOutcome,
        ...(policyOutcome === 'deny'
          ? { reason: 'sku denied by local policy' }
          : policyOutcome === 'error'
            ? { reason: 'policy evaluator failed closed before dispatch' }
            : {}),
      },
      model_rationale: `scripted request for ${sku}`,
    }),
  })

  const quotePrice = new FunctionTool({
    name: 'quote_price',
    description: 'Return a deterministic quote for a catalog item.',
    execute: (input) => {
      toolBodyExecutions += 1
      const args = input as { sku?: string; quantity?: number; internal_note?: string }
      return {
        sku: args.sku,
        quantity: args.quantity,
        total_cents: 8400,
        private_note: args.internal_note,
      }
    },
  })

  const agent = new LlmAgent({
    name: `google_adk_decision_${policyOutcome}_agent`,
    model: new SingleToolCallModel({
      sku,
      quantity: 2,
      internal_note: privatePhrase,
    }),
    instruction: 'Quote catalog items with the quote_price tool.',
    tools: [quotePrice],
  })

  const runner = new InMemoryRunner({
    appName: `atrib-google-adk-decision-${policyOutcome}`,
    agent,
    plugins: [plugin],
  })

  const userId = 'atrib-decision-ledger-user'
  const runSessionId = sessionId ?? `adk-decision-session-${policyOutcome}-${sku}`
  type GoogleAdkEvent = Parameters<typeof getFunctionCalls>[0]
  const runAdk = async (): Promise<GoogleAdkEvent[]> => {
    const events: GoogleAdkEvent[] = []
    await runner.sessionService.createSession({
      appName: runner.appName,
      userId,
      sessionId: runSessionId,
    })
    try {
      for await (const event of runner.runAsync({
        userId,
        sessionId: runSessionId,
        newMessage: {
          role: 'user',
          parts: [{ text: prompt ?? `Quote ${sku}.` }],
        },
      })) {
        events.push(event)
      }
    } finally {
      await runner.sessionService.deleteSession({
        appName: runner.appName,
        userId,
        sessionId: runSessionId,
      })
    }
    return events
  }
  const events =
    deterministicRandomSeed === undefined
      ? await runAdk()
      : await withDeterministicMathRandom(deterministicRandomSeed, runAdk)

  const records = plugin.getSignedRecords()
  for (const record of records) {
    if (!(await verifySignedGoogleAdkDecision(record))) {
      throw new Error(`invalid decision ledger record: ${record.tool_name ?? 'unknown'}`)
    }
  }
  const decisions = plugin.getDecisions()
  const outcomes = plugin.getOutcomes()
  const decision = decisions[0]
  if (!decision) throw new Error('decision ledger plugin did not sign a decision')
  const outcome = outcomes[0]
  if (policyOutcome === 'allow') {
    if (!outcome) throw new Error('allowed decision did not sign the tool outcome')
    if (outcome.record.informed_by?.[0] !== decision.record_hash) {
      throw new Error('allowed tool outcome does not cite the decision record')
    }
  }
  if (policyOutcome !== 'allow' && toolBodyExecutions !== 0) {
    throw new Error(`${policyOutcome} decision still executed the tool body`)
  }

  return {
    summary: {
      decision_state:
        policyOutcome === 'allow'
          ? 'allowed'
          : policyOutcome === 'deny'
            ? 'refused'
            : 'policy_error',
      decision_record_hash: decision.record_hash,
      outcome_record_hash: outcome?.record_hash ?? null,
      tool_body_executed: toolBodyExecutions > 0,
      yielded_events: events.length,
      function_call_events: events.filter((event) => getFunctionCalls(event).length > 0).length,
      function_response_events: events.filter((event) => getFunctionResponses(event).length > 0)
        .length,
    },
    decision,
    ...(outcome ? { outcome } : {}),
    publicRecords: records,
    sidecars: plugin.getSidecars(),
    google_operational_ids: buildOperationalIds(runContextId, plugin.getSidecars()),
  }
}

async function buildConfirmationProof({
  chainTailHex,
  startTimestampMs,
}: {
  chainTailHex: string
  startTimestampMs: number
}): Promise<{
  required: SignedGoogleAdkDecision
  resolved: SignedGoogleAdkDecision
  stale: SignedGoogleAdkDecision
  binding: ReturnType<typeof checkAuthorizedExecutionBinding>
  publicRecords: unknown[]
}> {
  const authority: GoogleAdkDecisionAuthority = {
    mode: 'user-auth',
    principal_hash: hashPrincipal('user:atlas-buyer@example.test'),
  }
  const args = { sku: 'atlas-kit', quantity: 2 }
  const canonicalArgsDigest = digestCanonical(args)
  const expiresAt = new Date(startTimestampMs + 60_000).toISOString()
  const bindingHash = buildConfirmationBindingHash({
    tool_name: 'quote_price',
    canonical_args_digest: canonicalArgsDigest,
    authority,
    policy_version: 'atlas-policy-v1',
    expires_at: expiresAt,
  })

  const requiredEntry = buildDecisionLedgerEntry({
    decision_state: 'confirmation_required',
    invocation_id: 'adk-confirmation-invocation-1',
    session_id: 'adk-confirmation-session-1',
    step: 1,
    tool_call_id: 'adk-confirmation-call-1',
    tool_name: 'quote_price',
    canonical_args_digest: canonicalArgsDigest,
    authority,
    policy: {
      source: 'confirmation',
      rule: 'quote_price:requires-user-confirmation',
      version: 'atlas-policy-v1',
      outcome: 'escalate',
    },
    confirmation: {
      required: true,
      confirmation_id: 'confirm-atlas-1',
      binding_hash: bindingHash,
      expires_at: expiresAt,
    },
    model_rationale: 'scripted model asked for a payment-impacting quote',
    timestamp: new Date(startTimestampMs).toISOString(),
    parent_record_hashes: [parentRecordHash],
  })
  const required = await signDecisionEntry({
    entry: requiredEntry,
    privateKey,
    contextId,
    serverUrl: 'google-adk-typescript-decision-ledger://proof',
    chainTailHex,
    informedBy: [parentRecordHash],
    timestampMs: startTimestampMs,
  })

  const resolvedEntry = buildDecisionLedgerEntry({
    decision_state: 'confirmation_resolved',
    invocation_id: requiredEntry.invocation_id,
    session_id: requiredEntry.session_id,
    step: 2,
    tool_call_id: requiredEntry.tool_call_id,
    tool_name: requiredEntry.tool_name,
    canonical_args_digest: canonicalArgsDigest,
    authority,
    policy: {
      source: 'confirmation',
      rule: 'quote_price:requires-user-confirmation',
      version: 'atlas-policy-v1',
      outcome: 'allow',
    },
    confirmation: {
      required: true,
      confirmation_id: 'confirm-atlas-1',
      response_payload_digest: digestCanonical({ approved: true, approver: 'operator' }),
      binding_hash: bindingHash,
      expires_at: expiresAt,
    },
    model_rationale: 'operator confirmation resolved the pending call',
    timestamp: new Date(startTimestampMs + 1_000).toISOString(),
    parent_record_hashes: [required.record_hash],
  })
  const resolved = await signDecisionEntry({
    entry: resolvedEntry,
    privateKey,
    contextId,
    serverUrl: 'google-adk-typescript-decision-ledger://proof',
    chainTailHex: required.record_hash.slice('sha256:'.length),
    informedBy: [required.record_hash],
    timestampMs: startTimestampMs + 1_000,
  })

  const binding = checkAuthorizedExecutionBinding({
    decision: resolved.entry,
    toolName: 'quote_price',
    args: { sku: 'atlas-kit', quantity: 3 },
    authority,
    policyVersion: 'atlas-policy-v1',
    expiresAt,
    now: new Date(startTimestampMs + 2_000).toISOString(),
  })
  if (binding.ok || !binding.reasons.includes('args_mismatch')) {
    throw new Error('confirmation mismatch proof did not fail closed on changed args')
  }

  const staleEntry = buildDecisionLedgerEntry({
    decision_state: binding.decision_state,
    invocation_id: resolvedEntry.invocation_id,
    session_id: resolvedEntry.session_id,
    step: 3,
    tool_call_id: resolvedEntry.tool_call_id,
    tool_name: resolvedEntry.tool_name,
    args: { sku: 'atlas-kit', quantity: 3 },
    authority,
    policy: {
      source: 'confirmation',
      rule: 'quote_price:binding-check',
      version: 'atlas-policy-v1',
      outcome: 'deny',
      reason: binding.reasons.join(','),
    },
    confirmation: {
      required: true,
      confirmation_id: 'confirm-atlas-1',
      binding_hash: binding.actual_binding_hash,
      expires_at: expiresAt,
    },
    model_rationale: 'executor rejected a stale or mismatched confirmation binding',
    timestamp: new Date(startTimestampMs + 2_000).toISOString(),
    parent_record_hashes: [resolved.record_hash],
  })
  const stale = await signDecisionEntry({
    entry: staleEntry,
    privateKey,
    contextId,
    serverUrl: 'google-adk-typescript-decision-ledger://proof',
    chainTailHex: resolved.record_hash.slice('sha256:'.length),
    informedBy: [resolved.record_hash],
    timestampMs: startTimestampMs + 2_000,
  })

  return {
    required,
    resolved,
    stale,
    binding,
    publicRecords: [required.record, resolved.record, stale.record],
  }
}

function summarizeDecision(decision: SignedGoogleAdkDecision): DecisionSummary {
  return {
    decision_state: decision.entry.decision_state,
    record_hash: decision.record_hash,
    canonical_args_digest: decision.entry.canonical_args_digest,
    confirmation_binding_hash: decision.entry.confirmation.binding_hash ?? null,
  }
}

function buildOperationalIds(
  runContextId: string,
  sidecars: GoogleAdkDecisionLocalSidecar[],
): GoogleAdkDecisionOperationalIds[] {
  return sidecars.map((sidecar) => ({
    trace_id: digestHex(`${runContextId}:${sidecar.invocation_id}`, 32),
    span_id: digestHex(`${sidecar.record_hash}:span`, 16),
    adk_invocation_id: sidecar.invocation_id,
    adk_session_id: sidecar.session_id,
    adk_function_call_id: sidecar.function_call_id ?? null,
    adk_agent_name: sidecar.agent_name,
    source: 'local-adk-decision-sidecar' as const,
    trace_projection: 'deterministic-local' as const,
  }))
}

function digestHex(value: string, length: number): string {
  return hexEncode(sha256(new TextEncoder().encode(value))).slice(0, length)
}

async function withDeterministicMathRandom<T>(
  seed: number,
  run: () => Promise<T>,
): Promise<T> {
  const originalRandom = Math.random
  let state = seed >>> 0
  if (state === 0) state = 1
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  try {
    return await run()
  } finally {
    Math.random = originalRandom
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAdkTypeScriptDecisionLedgerProof()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error('google-adk decision ledger proof failed:', err)
      process.exitCode = 1
    })
}
