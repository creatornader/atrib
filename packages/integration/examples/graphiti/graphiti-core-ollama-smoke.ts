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

type GraphitiOperation = {
  operation: string
  args: unknown
  result: unknown
}

type GraphitiProof = {
  ok: true
  graphiti_core_version: string
  group_id: string
  llm_model: string
  embed_model: string
  falkordb_uri: string
  operations: GraphitiOperation[]
  summary: {
    episode_count: number
    search_result_count: number
    episode_contains_proof_phrase: boolean
    search_facts: Array<{ name: string | null; fact: string | null }>
  }
}

const privateKey = randomBytes(32)
const contextId = '6b726a1b9b5147229ec089d3f02b2f37'
const serverUrl = 'graphiti://core'

async function main(): Promise<void> {
  const proof = runGraphitiProof()
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

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes('cobalt ledger')) {
    throw new Error('public records leaked the proof phrase')
  }
  if (!JSON.stringify(sidecars).includes('cobalt ledger')) {
    throw new Error('local sidecar should keep inspectable Graphiti payload material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'Runs real graphiti-core against FalkorDB and local Ollama, then signs hash-only add/search/read records from the host.',
        graphiti_core_version: proof.graphiti_core_version,
        llm_model: proof.llm_model,
        embed_model: proof.embed_model,
        falkordb_uri: proof.falkordb_uri,
        context_id: contextId,
        signed_records: records.length,
        operations: records.map((record) => record.tool_name),
        record_hashes: recordHashes,
        last_record_hash: recordHashes.at(-1),
        graphiti_episode_count: proof.summary.episode_count,
        graphiti_search_result_count: proof.summary.search_result_count,
        graphiti_search_facts: proof.summary.search_facts,
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      },
      null,
      2,
    ),
  )
}

function runGraphitiProof(): GraphitiProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'graphiti-core-ollama-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'graphiti-core[falkordb]==0.29.1', 'python', pythonScript],
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
        'Graphiti core Ollama proof failed.',
        'Required services: Ollama at GRAPHITI_OLLAMA_BASE_URL and FalkorDB at FALKORDB_URI.',
        'stdout:',
        result.stdout.trim(),
        'stderr:',
        result.stderr.trim(),
      ].join('\n'),
    )
  }

  const parsed = JSON.parse(result.stdout) as GraphitiProof
  if (!parsed.ok || parsed.operations.length !== 3) {
    throw new Error(`unexpected Graphiti proof output: ${result.stdout}`)
  }
  if (!parsed.summary.episode_contains_proof_phrase) {
    throw new Error('Graphiti episode retrieval did not contain the proof phrase')
  }
  if (parsed.summary.search_result_count < 1) {
    throw new Error('Graphiti search returned no facts')
  }
  return parsed
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize Graphiti operation material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

await main()
