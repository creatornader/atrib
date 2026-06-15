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

type LettaOperation = {
  operation: string
  executor: 'LettaCoreToolExecutor' | 'ExternalMCPToolExecutor'
  function_name: string
  status: 'success'
  args: unknown
  result: unknown
}

type LettaProof = {
  ok: true
  letta_version: string
  operations: LettaOperation[]
  summary: {
    core_memory_update_count: number
    archival_insert_count: number
    archival_search_count: number
    system_prompt_rebuild_count: number
    external_mcp_call_count: number
    final_core_memory: string
    final_core_memory_contains_private_phrase: boolean
    archival_search_contains_private_phrase: boolean
  }
}

type SmokeResult = {
  ok: true
  note: string
  letta: {
    package: 'letta'
    version: string
    core_executor: 'LettaCoreToolExecutor'
    external_executor: 'ExternalMCPToolExecutor'
    transient_python_packages: ['letta==0.16.8', 'asyncpg']
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  event_counts: LettaProof['summary']
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
const contextId = '6c657474612d65786163742d72656361'
const serverUrl = 'letta://memory'
const privatePhrase = 'cobalt cedar exact recall tier'
const baseTimestamp = 1_779_840_400_000

export async function runLettaMemorySmoke(): Promise<SmokeResult> {
  const proof = runLettaPythonProof()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const records: AtribRecord[] = []
  const sidecars: Array<{
    operation: string
    executor: string
    args: unknown
    result: unknown
    record_hash: string
  }> = []
  let lastRecordHashHex: string | undefined

  for (const [index, operation] of proof.operations.entries()) {
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: computeContentId(serverUrl, operation.operation),
      creator_key: creatorKey,
      chain_root: resolveChainRoot({
        contextId,
        autoChainTailHex: lastRecordHashHex,
      }),
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: contextId,
      timestamp: baseTimestamp + index,
      signature: '',
      args_hash: hashCanonical(operation.args),
      result_hash: hashCanonical({
        status: operation.status,
        result: operation.result,
      }),
      tool_name: operation.operation,
    }
    const signed = await signRecord(record, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
    lastRecordHashHex = recordHashHex
    records.push(signed)
    sidecars.push({
      operation: operation.operation,
      executor: operation.executor,
      args: operation.args,
      result: operation.result,
      record_hash: `sha256:${recordHashHex}`,
    })
  }

  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }
  if (records.length !== 6) {
    throw new Error(`expected six signed Letta records, got ${records.length}`)
  }
  if (proof.summary.final_core_memory_contains_private_phrase) {
    throw new Error('Letta memory patch left the private phrase in core memory')
  }
  if (!proof.summary.archival_search_contains_private_phrase) {
    throw new Error('Letta archival search result did not preserve the proof phrase')
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private Letta memory phrase')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable Letta memory material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  return {
    ok: true,
    note: 'Runs real Letta core-memory and external-MCP executor dispatch against fake managers, then signs hash-only atrib records from the host.',
    letta: {
      package: 'letta',
      version: proof.letta_version,
      core_executor: 'LettaCoreToolExecutor',
      external_executor: 'ExternalMCPToolExecutor',
      transient_python_packages: ['letta==0.16.8', 'asyncpg'],
    },
    context_id: contextId,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    record_hashes: recordHashes,
    event_counts: proof.summary,
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This imports the published Letta Python package and uses real Letta executor dispatch, but storage side effects are fake managers.',
      'It does not start the Letta server, call hosted Letta APIs, connect Postgres, connect a vector database, call an LLM provider, or run a real external MCP server.',
      'External review still needs a same-day Letta proof refresh.',
    ],
  }
}

function runLettaPythonProof(): LettaProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'letta-memory-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'letta==0.16.8', '--with', 'asyncpg', 'python', pythonScript],
    {
      cwd: exampleDir,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    },
  )

  if (result.status !== 0) {
    throw new Error(
      [
        'Letta memory proof failed.',
        'The smoke requires uv plus transient Python packages letta==0.16.8 and asyncpg.',
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
    throw new Error(`Letta memory proof did not print JSON: ${result.stdout}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as LettaProof
  if (!parsed.ok || parsed.operations.length !== 6) {
    throw new Error(`unexpected Letta memory proof output: ${result.stdout}`)
  }
  return parsed
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize Letta operation material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runLettaMemorySmoke()
  console.log(JSON.stringify(result, null, 2))
}
