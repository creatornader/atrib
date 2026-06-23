// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
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

type PythonCommand = {
  command: string
  args: string[]
}

type PythonCommandResult = {
  status: number | null
  stdout: string
  stderr: string
}

type PythonWorkerEnvelope =
  | {
      ok: true
      result: unknown
    }
  | {
      ok: false
      error: string
      error_type?: string
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

let sharedPythonWorker: PythonDecisionWorker | undefined
let sharedPythonWorkerPrime: Promise<void> | undefined

export async function runGoogleAdkPythonDecisionLedgerProof(): Promise<PythonProofResult> {
  const result = await runPythonDecisionProof<PythonProofResult>({ mode: 'proof' })
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
  const result = await runPythonDecisionProof<PythonAllowPathResult>({
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

async function runPythonDecisionProof<T>(options: Record<string, unknown>): Promise<T> {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'google-adk-python-decision-ledger-proof.py')
  const command = pythonDecisionCommand(pythonScript)
  if (process.env.ATRIB_GOOGLE_ADK_PYTHON_WORKER === '1') {
    const result = await pythonWorker(command, exampleDir).request(options)
    return result as T
  }
  const result = await runPythonCommand(command, exampleDir, options)

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

export function warmGoogleAdkPythonDecisionLedgerWorker(): void {
  if (process.env.ATRIB_GOOGLE_ADK_PYTHON_WORKER !== '1') return
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'google-adk-python-decision-ledger-proof.py')
  pythonWorker(pythonDecisionCommand(pythonScript), exampleDir).start()
}

export function primeGoogleAdkPythonDecisionLedgerWorker(): Promise<void> {
  if (process.env.ATRIB_GOOGLE_ADK_PYTHON_WORKER !== '1') return Promise.resolve()
  sharedPythonWorkerPrime ??= runGoogleAdkPythonDecisionLedgerAllowPath({
    contextId: '676f6f676c652d61646b2d70792d3130',
    parentRecordHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    sessionId: 'google-adk-python-worker-warmup',
    prompt: 'Prime the Google ADK Python decision worker.',
    nowMs: 1779846060000,
  }).then(() => undefined)
  return sharedPythonWorkerPrime
}

export function stopGoogleAdkPythonDecisionLedgerWorker(): void {
  sharedPythonWorker?.stop()
  sharedPythonWorker = undefined
  sharedPythonWorkerPrime = undefined
}

function pythonDecisionCommand(pythonScript: string): PythonCommand {
  if (process.env.ATRIB_GOOGLE_ADK_PYTHON_DIRECT === '1') {
    return {
      command: process.env.PYTHON ?? 'python3',
      args: [pythonScript],
    }
  }
  return {
    command: 'uv',
    args: [
      'run',
      '--quiet',
      '--with',
      'google-adk==2.3.0',
      '--with',
      'cryptography',
      'python',
      pythonScript,
    ],
  }
}

function runPythonCommand(
  command: PythonCommand,
  cwd: string,
  options: Record<string, unknown>,
): Promise<PythonCommandResult> {
  const maxBuffer = 1024 * 1024 * 20
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd,
      env: {
        ...process.env,
        ATRIB_GOOGLE_ADK_PYTHON_WORKER: '0',
        PYTHONWARNINGS: 'ignore',
        ATRIB_GOOGLE_ADK_PYTHON_DECISION_OPTIONS: JSON.stringify(options),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const append = (streamName: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (streamName === 'stdout') {
        stdout += chunk.toString('utf8')
      } else {
        stderr += chunk.toString('utf8')
      }
      if (stdout.length + stderr.length > maxBuffer && !settled) {
        settled = true
        child.kill('SIGTERM')
        reject(new Error('Google ADK Python decision-ledger proof exceeded output buffer'))
      }
    }

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (status) => {
      if (settled) return
      settled = true
      resolve({ status, stdout, stderr })
    })
  })
}

function pythonWorker(command: PythonCommand, cwd: string): PythonDecisionWorker {
  sharedPythonWorker ??= new PythonDecisionWorker(command, cwd)
  return sharedPythonWorker
}

class PythonDecisionWorker {
  private child: ReturnType<typeof spawn> | undefined
  private pending:
    | {
        resolve: (value: unknown) => void
        reject: (reason: unknown) => void
      }
    | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private stdoutBuffer = ''
  private stderrTail = ''

  constructor(
    private readonly command: PythonCommand,
    private readonly cwd: string,
  ) {}

  start(): void {
    this.ensureChild()
  }

  stop(): void {
    const child = this.child
    this.child = undefined
    if (child === undefined) return
    const stdin = child.stdin
    if (stdin !== null) stdin.end()
    child.kill('SIGTERM')
  }

  request(options: Record<string, unknown>): Promise<unknown> {
    const run = (): Promise<unknown> => this.requestOnce(options)
    const next = this.queue.then(run, run)
    this.queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private requestOnce(options: Record<string, unknown>): Promise<unknown> {
    const child = this.ensureChild()
    return new Promise((resolve, reject) => {
      const stdin = child.stdin
      if (stdin === null) {
        reject(new Error('Google ADK Python worker stdin is unavailable'))
        return
      }
      this.pending = { resolve, reject }
      stdin.write(`${JSON.stringify(options)}\n`, (error) => {
        if (error === null || error === undefined) return
        if (this.pending?.reject === reject) this.pending = undefined
        reject(error)
      })
    })
  }

  private ensureChild(): ReturnType<typeof spawn> {
    if (this.child !== undefined && !this.child.killed) return this.child
    const child = spawn(this.command.command, this.command.args, {
      cwd: this.cwd,
      env: {
        ...process.env,
        ATRIB_GOOGLE_ADK_PYTHON_WORKER: '1',
        PYTHONWARNINGS: 'ignore',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.stdoutBuffer = ''
    this.stderrTail = ''

    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk: Buffer) => this.rememberStderr(chunk))
    child.on('error', (error) => this.failPending(error))
    child.on('close', (status) => {
      const error = new Error(
        `Google ADK Python worker exited with status ${String(status)}${this.stderrTail ? `: ${this.stderrTail}` : ''}`,
      )
      this.child = undefined
      this.failPending(error)
    })
    return child
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8')
    let newlineIndex = this.stdoutBuffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line.length > 0) this.handleLine(line)
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    const pending = this.pending
    this.pending = undefined
    if (pending === undefined) return
    let envelope: PythonWorkerEnvelope
    try {
      envelope = JSON.parse(line) as PythonWorkerEnvelope
    } catch (error) {
      pending.reject(error)
      return
    }
    if (envelope.ok) {
      pending.resolve(envelope.result)
      return
    }
    pending.reject(
      new Error(
        `Google ADK Python worker failed${envelope.error_type ? ` (${envelope.error_type})` : ''}: ${envelope.error}`,
      ),
    )
  }

  private rememberStderr(chunk: Buffer): void {
    this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-4000)
  }

  private failPending(error: unknown): void {
    const pending = this.pending
    this.pending = undefined
    pending?.reject(error)
  }
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
    .finally(() => {
      stopGoogleAdkPythonDecisionLedgerWorker()
    })
}
