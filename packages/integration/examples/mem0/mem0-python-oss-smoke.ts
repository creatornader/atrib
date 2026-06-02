// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
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

type Mem0PythonOperation = {
  operation: string
  args: unknown
  result: unknown
}

type Mem0PythonProof = {
  ok: true
  mem0ai_python_version: string
  operations: Mem0PythonOperation[]
  summary: {
    add_result_count: number
    search_result_count: number
    add_contains_proof_phrase: boolean
    search_contains_proof_phrase: boolean
    provider_paths_seen: string[]
  }
}

const privateKey = randomBytes(32)
const contextId = 'ad04131321f54b5bae6984d5f2c7a38f'
const serverUrl = 'mem0://python-oss'

async function main(): Promise<void> {
  const proof = runMem0PythonProof()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const records: AtribRecord[] = []
  const sidecars: Array<{
    operation: string
    args: unknown
    result: unknown
    record_hash: string
  }> = []
  let lastRecordHashHex: string | undefined
  const now = Date.now()

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
      timestamp: now + index,
      signature: '',
      args_hash: hashCanonical(operation.args),
      result_hash: hashCanonical(operation.result),
      tool_name: operation.operation,
    }
    const signed = await signRecord(record, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
    lastRecordHashHex = recordHashHex
    records.push(signed)
    sidecars.push({
      operation: operation.operation,
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

  if (proof.operations.length !== 2) {
    throw new Error(`expected two mem0 Python operations, got ${proof.operations.length}`)
  }
  if (!proof.summary.add_contains_proof_phrase || !proof.summary.search_contains_proof_phrase) {
    throw new Error('mem0 Python proof did not preserve the proof phrase')
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes('quiet sci-fi')) {
    throw new Error('public records leaked the proof phrase')
  }
  if (!JSON.stringify(sidecars).includes('quiet sci-fi')) {
    throw new Error('local sidecars should keep inspectable mem0 payload material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'Runs real Python mem0 Memory add/search calls against a local provider and signs hash-only records from the host.',
        mem0ai_python_version: proof.mem0ai_python_version,
        context_id: contextId,
        signed_records: records.length,
        operations: records.map((record) => record.tool_name),
        record_hashes: recordHashes,
        last_record_hash: recordHashes.at(-1),
        mem0_add_results: proof.summary.add_result_count,
        mem0_search_results: proof.summary.search_result_count,
        provider_paths_seen: proof.summary.provider_paths_seen,
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      },
      null,
      2,
    ),
  )
}

function runMem0PythonProof(): Mem0PythonProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'mem0-python-oss-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'mem0ai==2.0.4', 'python', pythonScript],
    {
      cwd: exampleDir,
      env: { ...process.env, MEM0_TELEMETRY: 'false' },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    },
  )

  if (result.status !== 0) {
    throw new Error(
      [
        'mem0 Python OSS proof failed.',
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
    throw new Error(`mem0 Python proof did not print JSON: ${result.stdout}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Mem0PythonProof
  if (!parsed.ok || parsed.operations.length !== 2) {
    throw new Error(`unexpected mem0 Python proof output: ${result.stdout}`)
  }
  if (parsed.summary.add_result_count < 1 || parsed.summary.search_result_count < 1) {
    throw new Error('mem0 Python proof returned no add/search results')
  }
  if (!parsed.summary.provider_paths_seen.some((path) => path.includes('/chat/completions'))) {
    throw new Error('mem0 Python proof did not call the local chat provider')
  }
  if (!parsed.summary.provider_paths_seen.some((path) => path.includes('/embeddings'))) {
    throw new Error('mem0 Python proof did not call the local embedding provider')
  }
  return parsed
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize mem0 Python operation material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

await main()
