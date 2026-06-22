// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import { verifyRecord as verifyMcpRecord } from '@atrib/mcp'

type GoogleAdkPythonDecisionState =
  | 'allowed'
  | 'refused'
  | 'confirmation_required'
  | 'confirmation_resolved'
  | 'stale_or_mismatched'
  | 'policy_error'

type GoogleAdkPythonDecisionEntry = {
  schema: 'atrib.google-adk.decision-ledger.entry.v1'
  decision_id: string
  decision_state: GoogleAdkPythonDecisionState
  invocation_id: string
  session_id: string
  step: number
  tool_call_id: string
  tool_name: string
  canonical_args_digest: string
  authority: {
    mode: 'agent-auth' | 'user-auth'
    principal_hash: string
  }
  policy: {
    source: 'plugin' | 'tool_context' | 'confirmation'
    rule: string
    version: string
    outcome: 'allow' | 'deny' | 'escalate' | 'error'
    reason?: string
  }
  confirmation: {
    required: boolean
    confirmation_id?: string
    response_payload_digest?: string
    binding_hash?: string
    expires_at?: string
  }
  model_rationale: {
    text: string
    trust: 'untrusted_generated'
  }
  timestamp: string
  parent_record_hashes: string[]
  result_digest?: string
}

export type GoogleAdkPythonDecisionSidecar = {
  framework: 'google-adk-python'
  plugin_name: 'atrib_google_adk_python_decision_ledger'
  record_kind: 'decision' | 'tool_outcome'
  decision_entry?: GoogleAdkPythonDecisionEntry
  operation: string
  tool_name: string
  invocation_id: string
  session_id: string
  user_id: string
  agent_name: string
  function_call_id?: string | null
  args?: unknown
  result?: unknown
  error?: { name: string; message: string }
  principal?: string
  record_hash: string
  informed_by: string[]
}

type SignedPythonDecision = {
  record: AtribRecord
  record_hash: string
  entry: GoogleAdkPythonDecisionEntry
  sidecar: GoogleAdkPythonDecisionSidecar
}

type SignedPythonOutcome = {
  record: AtribRecord
  record_hash: string
  decision_record_hash: string
  sidecar: GoogleAdkPythonDecisionSidecar
}

type PythonLiveRunSummary = {
  decision_state: 'allowed' | 'refused' | 'policy_error'
  decision_record_hash: string
  outcome_record_hash: string | null
  tool_body_executed: boolean
  yielded_events: number
  function_call_events: number
  function_response_events: number
}

type GoogleAdkPythonDecisionOperationalIds = {
  trace_id: string
  span_id: string
  adk_invocation_id: string | null
  adk_session_id: string
  adk_function_call_id: string | null
  adk_agent_name: string | null
  source: 'local-adk-python-decision-sidecar'
  trace_projection: 'deterministic-local'
}

type PythonProofResult = {
  ok: true
  strategy: 'atrib-google-adk-python-decision-ledger-proof-v1'
  adk: {
    python_package: 'google-adk'
    version: string
    runner: 'InMemoryRunner'
    plugin: 'BasePlugin'
    tool: 'FunctionTool'
    model: 'BaseLlm'
  }
  contract: {
    schema: 'atrib.google-adk.decision-ledger.entry.v1'
    event_type: 'https://google-adk-decision-ledger.example/v1'
    decision_states: GoogleAdkPythonDecisionState[]
    framework_attested_fields: string[]
    derived_commitments: string[]
    untrusted_fields: string[]
  }
  live_adk: {
    allowed: PythonLiveRunSummary
    refused: PythonLiveRunSummary
    policy_error: PythonLiveRunSummary
  }
  confirmation: {
    required: DecisionSummary
    resolved: DecisionSummary
    stale_or_mismatched: DecisionSummary
    binding_reasons: string[]
    fail_closed: true
  }
  record_hashes: Record<string, string>
  proof: {
    allowed_execution_informed_by_decision: boolean
    refused_tool_body_executed: boolean
    policy_error_tool_body_executed: boolean
    confirmation_binding_covers: string[]
    stale_mismatch_detected: boolean
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
    public_records_omit_private_phrase: true
    public_records_omit_raw_principal: true
  }
  publicRecords: AtribRecord[]
  sidecars: GoogleAdkPythonDecisionSidecar[]
  caveats: string[]
}

type DecisionSummary = {
  decision_state: GoogleAdkPythonDecisionState
  record_hash: string
  canonical_args_digest: string
  confirmation_binding_hash: string | null
}

type PythonAllowPathResult = {
  ok: true
  strategy: 'atrib-google-adk-python-decision-ledger-allow-path-v1'
  adk: PythonProofResult['adk']
  summary: PythonLiveRunSummary
  decision: SignedPythonDecision
  outcome: SignedPythonOutcome
  publicRecords: AtribRecord[]
  sidecars: GoogleAdkPythonDecisionSidecar[]
  google_operational_ids: GoogleAdkPythonDecisionOperationalIds[]
}

export interface GoogleAdkPythonDecisionLedgerPathOptions {
  contextId?: string
  parentRecordHash?: string
  sessionId?: string
  nowMs?: number
  prompt?: string
  sku?: string
}

export type GoogleAdkPythonDecisionLedgerProofResult = PythonProofResult
export type GoogleAdkPythonDecisionLedgerAllowPathResult = PythonAllowPathResult

export async function runGoogleAdkPythonDecisionLedgerProof(): Promise<PythonProofResult> {
  const result = runPythonDecisionProof<PythonProofResult>({ mode: 'proof' })
  await validatePythonResult(result.publicRecords)
  if (result.live_adk.allowed.outcome_record_hash === null) {
    throw new Error('Python ADK allowed decision did not sign a tool outcome')
  }
  if (result.live_adk.refused.outcome_record_hash !== null) {
    throw new Error('Python ADK refused path signed a tool outcome')
  }
  if (result.live_adk.policy_error.outcome_record_hash !== null) {
    throw new Error('Python ADK policy_error path signed a tool outcome')
  }
  return result
}

export async function runGoogleAdkPythonDecisionLedgerAllowPath(
  options: GoogleAdkPythonDecisionLedgerPathOptions = {},
): Promise<PythonAllowPathResult> {
  const result = runPythonDecisionProof<PythonAllowPathResult>({
    mode: 'allow_path',
    ...(options.contextId ? { context_id: options.contextId } : {}),
    ...(options.parentRecordHash ? { parent_record_hash: options.parentRecordHash } : {}),
    ...(options.sessionId ? { session_id: options.sessionId } : {}),
    ...(options.nowMs !== undefined ? { now_ms: options.nowMs } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.sku ? { sku: options.sku } : {}),
  })
  await validatePythonResult(result.publicRecords)
  if (result.outcome.record.informed_by?.[0] !== result.decision.record_hash) {
    throw new Error('Python ADK tool outcome does not cite the decision record')
  }
  return result
}

function runPythonDecisionProof<T>(options: Record<string, unknown>): T {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'google-adk-python-decision-ledger-proof.py')
  const result = spawnSync(
    'uv',
    [
      'run',
      '--quiet',
      '--with',
      'google-adk==2.3.0',
      '--with',
      'cryptography',
      'python',
      pythonScript,
    ],
    {
      cwd: exampleDir,
      env: {
        ...process.env,
        PYTHONWARNINGS: 'ignore',
        ATRIB_GOOGLE_ADK_PYTHON_DECISION_OPTIONS: JSON.stringify(options),
      },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    },
  )

  if (result.status !== 0) {
    throw new Error(
      [
        'Google ADK Python decision-ledger proof failed.',
        'The proof requires uv plus transient Python packages google-adk==2.3.0 and cryptography.',
        'stdout:',
        result.stdout.trim(),
        'stderr:',
        result.stderr.trim(),
      ].join('\n'),
    )
  }

  const raw = result.stdout.trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Google ADK Python decision-ledger proof did not print JSON: ${raw}`)
  }
  return JSON.parse(raw.slice(start, end + 1)) as T
}

async function validatePythonResult(records: AtribRecord[]): Promise<void> {
  if (records.length === 0) throw new Error('Python ADK decision proof returned no records')
  for (const record of records) {
    if (!(await verifyMcpRecord(record))) {
      throw new Error(`invalid Python ADK decision record: ${record.tool_name ?? 'unknown'}`)
    }
    const hash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    if (!/^sha256:[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`invalid Python ADK decision hash: ${hash}`)
    }
  }
  const serialized = JSON.stringify(records)
  if (serialized.includes('python decision ledger private tool note')) {
    throw new Error('Python ADK public records leaked private tool material')
  }
  if (serialized.includes('user:atlas-buyer@example.test')) {
    throw new Error('Python ADK public records leaked raw principal material')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAdkPythonDecisionLedgerProof()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error('google-adk Python decision ledger proof failed:', err)
      process.exitCode = 1
    })
}
