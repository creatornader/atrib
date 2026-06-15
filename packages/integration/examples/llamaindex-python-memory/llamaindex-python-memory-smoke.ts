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

type LlamaIndexPythonMemoryOperation = {
  index: number
  method: 'put' | 'put_messages' | 'get' | 'get_all' | 'set' | 'reset'
  status: 'success'
  args: unknown
  result: unknown
}

type LlamaIndexPythonProof = {
  ok: true
  llamaindex_version: string
  memory: {
    class: 'Memory'
    session_id: string
    memory_blocks: ['StaticMemoryBlock']
    static_block_names: ['OperatorProfile']
  }
  operations: LlamaIndexPythonMemoryOperation[]
  summary: {
    operation_count: number
    put_count: number
    put_messages_count: number
    get_count: number
    get_all_count: number
    set_count: number
    reset_count: number
    static_block_returned: boolean
    private_phrase_in_get_result: boolean
    private_phrase_in_operations: boolean
    reset_cleared_active_history: boolean
  }
}

type SmokeResult = {
  ok: true
  note: string
  llamaindex_python: {
    python_package: 'llama-index'
    version: string
    memory_class: 'Memory'
    memory_blocks: ['StaticMemoryBlock']
    transient_python_packages: ['llama-index==0.14.22']
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  event_counts: LlamaIndexPythonProof['summary']
  chain: {
    first_record_is_genesis: true
    subsequent_records_chain: true
    subsequent_records_inform_by_previous: true
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

const privateKey = Buffer.from(
  '435465768798a9bacbdcedfeef102132435465768798a9bacbdcedfeef102132',
  'hex',
)
const contextId = '6c6c616d612d707974686f6e6d656d31'
const serverUrl = 'llamaindex-python://memory'
const privatePhrase = 'quiet LlamaIndex Python memory note'
const baseTimestamp = 1_779_841_700_000

export async function runLlamaIndexPythonMemorySmoke(): Promise<SmokeResult> {
  const proof = runLlamaIndexPythonProof()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const records: AtribRecord[] = []
  const sidecars: Array<{
    framework: 'llamaindex-python'
    memory_class: 'Memory'
    operation: LlamaIndexPythonMemoryOperation
    record_hash: string
  }> = []
  let lastRecordHashHex: string | undefined
  let lastRecordHash: string | undefined

  for (const operation of proof.operations) {
    const toolName = `llamaindex.python.memory.${operation.method}`
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: computeContentId(serverUrl, toolName),
      creator_key: creatorKey,
      chain_root: resolveChainRoot({
        contextId,
        autoChainTailHex: lastRecordHashHex,
      }),
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: contextId,
      timestamp: baseTimestamp + operation.index,
      signature: '',
      args_hash: hashCanonical({
        package: 'llama-index',
        package_version: proof.llamaindex_version,
        session_id: proof.memory.session_id,
        method: operation.method,
        args: operation.args,
      }),
      result_hash: hashCanonical({
        method: operation.method,
        status: operation.status,
        result: operation.result,
      }),
      tool_name: toolName,
      ...(lastRecordHash ? { informed_by: [lastRecordHash] } : {}),
    }
    const signed = await signRecord(record, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
    const recordHash = `sha256:${recordHashHex}`
    lastRecordHashHex = recordHashHex
    lastRecordHash = recordHash
    records.push(signed)
    sidecars.push({
      framework: 'llamaindex-python',
      memory_class: 'Memory',
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
  if (records.length !== 8) {
    throw new Error(`expected eight signed LlamaIndex Python records, got ${records.length}`)
  }
  if (!proof.summary.static_block_returned) {
    throw new Error('LlamaIndex Python proof did not return StaticMemoryBlock content')
  }
  if (!proof.summary.private_phrase_in_get_result || !proof.summary.private_phrase_in_operations) {
    throw new Error('LlamaIndex Python proof did not preserve private memory material')
  }
  if (!proof.summary.reset_cleared_active_history) {
    throw new Error('LlamaIndex Python reset did not clear active history')
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private LlamaIndex Python memory phrase')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable LlamaIndex Python memory material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )
  const subsequentRecords = records.slice(1)

  return {
    ok: true,
    note: 'Runs a real Python llama_index.core.memory.Memory instance, then signs hash-only atrib records for each memory command.',
    llamaindex_python: {
      python_package: 'llama-index',
      version: proof.llamaindex_version,
      memory_class: 'Memory',
      memory_blocks: ['StaticMemoryBlock'],
      transient_python_packages: ['llama-index==0.14.22'],
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
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This proves Python llama_index.core.memory.Memory with StaticMemoryBlock, not VectorMemoryBlock retrieval or an external vector database.',
      'It does not call an LLM, run a full LlamaIndex agent workflow, persist SQL history outside the default local store, or prove external adoption.',
      'External review still needs a same-day LlamaIndex proof refresh.',
    ],
  }
}

function runLlamaIndexPythonProof(): LlamaIndexPythonProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'llamaindex-python-memory-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'llama-index==0.14.22', 'python', pythonScript],
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
        'LlamaIndex Python memory proof failed.',
        'The smoke requires uv plus transient Python package llama-index==0.14.22.',
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
    throw new Error(`LlamaIndex Python memory proof did not print JSON: ${result.stdout}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as LlamaIndexPythonProof
  if (!parsed.ok || parsed.operations.length !== 8) {
    throw new Error(`unexpected LlamaIndex Python memory proof output: ${result.stdout}`)
  }
  return parsed
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize LlamaIndex Python memory material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runLlamaIndexPythonMemorySmoke()
  console.log(JSON.stringify(result, null, 2))
}
