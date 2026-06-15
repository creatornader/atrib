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

type LangGraphCheckpointEvent = {
  index: number
  operation: 'get_tuple' | 'put' | 'put_writes'
  config: Record<string, unknown>
  checkpoint_id?: string | null
  found?: boolean
  metadata?: unknown
  channel_keys?: string[]
  channel_values?: unknown
  new_version_keys?: string[]
  task_id?: string
  task_path?: string
  write_count?: number
  write_channels?: string[]
  writes?: unknown
}

type LangGraphPythonProof = {
  ok: true
  langgraph_version: string
  workflow: {
    graph: 'StateGraph'
    compile: 'compile(checkpointer=InMemorySaver())'
    nodes: ['draft', 'approve']
    thread_id: string
  }
  checkpointer: {
    class: 'InMemorySaver'
    operations: Array<'get_tuple' | 'put' | 'put_writes'>
  }
  events: LangGraphCheckpointEvent[]
  summary: {
    event_count: number
    get_tuple_count: number
    put_count: number
    put_writes_count: number
    private_phrase_in_events: boolean
    private_phrase_in_state: boolean
    workflow_completed: boolean
  }
  final_output: {
    answer: string
    steps: string[]
  }
}

type SmokeResult = {
  ok: true
  note: string
  langgraph_python: {
    python_package: 'langgraph'
    version: string
    graph: 'StateGraph'
    checkpointer: 'InMemorySaver'
    transient_python_packages: ['langgraph==1.2.4']
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  event_counts: LangGraphPythonProof['summary']
  chain: {
    first_record_is_genesis: true
    subsequent_records_chain: true
    subsequent_records_inform_by_previous: true
  }
  final_output: LangGraphPythonProof['final_output']
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

const privateKey = Buffer.from(
  '32435465768798a9bacbdcedfeef102132435465768798a9bacbdcedfeef1021',
  'hex',
)
const contextId = '6c6770792d636865636b70742d303031'
const serverUrl = 'langgraph-python://checkpointer'
const privatePhrase = 'quiet LangGraph Python checkpoint note'
const baseTimestamp = 1_779_841_000_000

export async function runLangGraphPythonCheckpointerSmoke(): Promise<SmokeResult> {
  const proof = runPythonProof()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const records: AtribRecord[] = []
  const sidecars: Array<{
    framework: 'langgraph-python'
    checkpointer: 'InMemorySaver'
    event: LangGraphCheckpointEvent
    operation: string
    record_hash: string
  }> = []
  let lastRecordHashHex: string | undefined
  let lastRecordHash: string | undefined

  for (const event of proof.events) {
    const operation = `langgraph.python.checkpointer.${event.operation}`
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
        package: 'langgraph',
        package_version: proof.langgraph_version,
        thread_id: proof.workflow.thread_id,
        operation: event.operation,
        config: event.config,
      }),
      result_hash: hashCanonical({
        operation: event.operation,
        event,
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
      framework: 'langgraph-python',
      checkpointer: 'InMemorySaver',
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
  if (records.length !== 9) {
    throw new Error(`expected nine signed LangGraph Python records, got ${records.length}`)
  }
  if (!proof.summary.workflow_completed) {
    throw new Error('LangGraph Python workflow did not complete')
  }
  if (!proof.summary.private_phrase_in_events || !proof.summary.private_phrase_in_state) {
    throw new Error('LangGraph Python proof did not retain private material in local state')
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private LangGraph Python payload')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable LangGraph Python material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )
  const subsequentRecords = records.slice(1)

  return {
    ok: true,
    note: 'Runs a real Python langgraph StateGraph with InMemorySaver checkpointing, then signs hash-only atrib records for each checkpointer event.',
    langgraph_python: {
      python_package: 'langgraph',
      version: proof.langgraph_version,
      graph: 'StateGraph',
      checkpointer: 'InMemorySaver',
      transient_python_packages: ['langgraph==1.2.4'],
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
      'This proves Python LangGraph StateGraph checkpointing with InMemorySaver, not a LangGraph Platform deployment.',
      'It signs the checkpointer boundary, not LangChain model calls, external tools, or hosted persistence.',
      'It does not prove Postgres checkpointer, Redis checkpointer, production storage, or external adoption.',
    ],
  }
}

function runPythonProof(): LangGraphPythonProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'langgraph-python-checkpointer-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'langgraph==1.2.4', 'python', pythonScript],
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
        'LangGraph Python checkpointer proof failed.',
        'The smoke requires uv plus transient Python package langgraph==1.2.4.',
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
    throw new Error(`LangGraph Python checkpointer proof did not print JSON: ${result.stdout}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as LangGraphPythonProof
  if (!parsed.ok || parsed.events.length !== 9) {
    throw new Error(`unexpected LangGraph Python checkpointer proof output: ${result.stdout}`)
  }
  return parsed
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize LangGraph Python material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runLangGraphPythonCheckpointerSmoke()
  console.log(JSON.stringify(result, null, 2))
}
