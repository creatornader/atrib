// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  EVENT_TYPE_TOOL_CALL_URI,
  getPublicKey,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

type AgentFrameworkEvent = {
  index: number
  type: string
  executor_id?: string
  iteration?: number
  data?: unknown
}

type AgentFrameworkProof = {
  ok: true
  agent_framework_core_version: string
  workflow: {
    name: string
    builder: 'WorkflowBuilder'
    execution: 'Workflow.run'
    executors: ['ProposalExecutor', 'ApprovalExecutor']
    edge_count: number
  }
  events: AgentFrameworkEvent[]
  summary: {
    event_count: number
    output_count: number
    executor_invoked_count: number
    executor_completed_count: number
    output_contains_private_phrase: boolean
    workflow_completed: boolean
  }
  final_output: {
    status: 'approved'
    sku: string
    quantity: number
    approved_by: string
  }
}

type SmokeResult = {
  ok: true
  note: string
  microsoft_agent_framework: {
    python_package: 'agent-framework-core'
    version: string
    workflow: 'WorkflowBuilder'
    execution: 'Workflow.run'
    executors: ['ProposalExecutor', 'ApprovalExecutor']
    transient_python_packages: ['agent-framework-core==1.7.0']
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  event_counts: AgentFrameworkProof['summary']
  chain: {
    first_record_is_genesis: true
    subsequent_records_chain: true
    subsequent_records_inform_by_previous: true
  }
  final_output: AgentFrameworkProof['final_output']
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

const privateKey = Buffer.from(
  '2132435465768798a9bacbdcedfeef102132435465768798a9bacbdcedfeef10',
  'hex',
)
const contextId = '6d7361662d776f726b666c6f772d3031'
const serverUrl = 'microsoft-agent-framework://python-workflow'
const privatePhrase = 'silver Microsoft Agent Framework workflow note'
const baseTimestamp = 1_779_840_500_000

export async function runMicrosoftAgentFrameworkSmoke(): Promise<SmokeResult> {
  const proof = runPythonProof()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const records: AtribRecord[] = []
  const sidecars: Array<{
    framework: 'microsoft-agent-framework'
    workflow_name: string
    event: AgentFrameworkEvent
    operation: string
    record_hash: string
  }> = []
  let lastRecordHashHex: string | undefined
  let lastRecordHash: string | undefined

  for (const event of proof.events) {
    const operation = operationName(proof.workflow.name, event)
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: computeContentId(serverUrl, operation),
      creator_key: creatorKey,
      chain_root: resolveChainRoot({
        contextId,
        autoChainTailHex: lastRecordHashHex,
      }),
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: contextId,
      timestamp: baseTimestamp + event.index,
      signature: '',
      args_hash: hashCanonical({
        workflow_name: proof.workflow.name,
        package: 'agent-framework-core',
        package_version: proof.agent_framework_core_version,
        event,
      }),
      result_hash: hashCanonical({
        observed: true,
        event_type: event.type,
        executor_id: event.executor_id,
        iteration: event.iteration,
      }),
      tool_name: operation,
      ...(lastRecordHash ? { informed_by: [lastRecordHash] } : {}),
    }
    const signed = await signRecord(record, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
    const recordHash = `sha256:${recordHashHex}`
    lastRecordHashHex = recordHashHex
    lastRecordHash = recordHash
    records.push(signed)
    sidecars.push({
      framework: 'microsoft-agent-framework',
      workflow_name: proof.workflow.name,
      event,
      operation,
      record_hash: recordHash,
    })
  }

  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }
  if (records.length !== 7) {
    throw new Error(
      `expected seven signed Microsoft Agent Framework records, got ${records.length}`,
    )
  }
  if (!proof.summary.workflow_completed) {
    throw new Error('Microsoft Agent Framework workflow did not complete')
  }
  if (!proof.summary.output_contains_private_phrase) {
    throw new Error('Microsoft Agent Framework output did not carry the private proof phrase')
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private Microsoft Agent Framework payload')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable Microsoft Agent Framework material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )
  const subsequentRecords = records.slice(1)

  return {
    ok: true,
    note: 'Runs a real Microsoft Agent Framework Python WorkflowBuilder graph with two Executor nodes, then signs hash-only atrib records for every emitted WorkflowEvent.',
    microsoft_agent_framework: {
      python_package: 'agent-framework-core',
      version: proof.agent_framework_core_version,
      workflow: 'WorkflowBuilder',
      execution: 'Workflow.run',
      executors: proof.workflow.executors,
      transient_python_packages: ['agent-framework-core==1.7.0'],
    },
    context_id: contextId,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    record_hashes: recordHashes,
    event_counts: proof.summary,
    chain: {
      first_record_is_genesis: records[0]?.chain_root === resolveChainRoot({ contextId }),
      subsequent_records_chain: subsequentRecords.every(
        (record, index) => record.chain_root === recordHashes[index],
      ),
      subsequent_records_inform_by_previous: subsequentRecords.every(
        (record, index) => record.informed_by?.[0] === recordHashes[index],
      ),
    },
    final_output: proof.final_output,
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This uses agent-framework-core, not the full agent-framework meta-package with every optional Azure integration.',
      'It proves a local Python WorkflowBuilder and Executor path, not Azure AI Foundry Agent Service or a hosted Microsoft control plane.',
      'It does not cover C# workflows, Durable Task hosting, model providers, MCP servers, memory stores, or production deployment.',
    ],
  }
}

function runPythonProof(): AgentFrameworkProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'microsoft-agent-framework-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'agent-framework-core==1.7.0', 'python', pythonScript],
    {
      cwd: exampleDir,
      env: { ...process.env, PYTHONWARNINGS: 'ignore' },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    },
  )

  if (result.status !== 0) {
    throw new Error(
      [
        'Microsoft Agent Framework proof failed.',
        'The smoke requires uv plus transient Python package agent-framework-core==1.7.0.',
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
    throw new Error(`Microsoft Agent Framework proof did not print JSON: ${result.stdout}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as AgentFrameworkProof
  if (!parsed.ok || parsed.events.length !== 7) {
    throw new Error(`unexpected Microsoft Agent Framework proof output: ${result.stdout}`)
  }
  return parsed
}

function operationName(workflowName: string, event: AgentFrameworkEvent): string {
  const executor = event.executor_id ? `.${event.executor_id}` : ''
  return `microsoft.agent_framework.workflow.${workflowName}.${event.type}${executor}`
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize Microsoft Agent Framework material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runMicrosoftAgentFrameworkSmoke()
  console.log(JSON.stringify(result, null, 2))
}
