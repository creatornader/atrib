// SPDX-License-Identifier: Apache-2.0

import { strict as assert } from 'node:assert'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { canonicalRecord, hexEncode, sha256, verifyRecord, type AtribRecord } from '@atrib/mcp'
import { Memory } from 'mem0ai/oss'
import { attributeMem0Memory } from '../../src/mem0-attribution.js'
import { runMem0MutationAssurance } from '../../src/mem0-mutation-assurance.js'

process.env.MEM0_TELEMETRY = 'false'

const privateKey = new Uint8Array(32).fill(53)
const contextId = '3df2ce19e6324eb49f557289f270aa54'
const runId = 'mem0-mutation-assurance'
const agentId = 'mem0-host-agent'
const tenantId = 'tenant-a'
const originalText = 'Customer prefers paper invoices.'
const updatedText = 'Customer prefers electronic invoices.'

const provider = await startLocalOpenAiProvider()

try {
  const mem0 = new Memory({
    version: 'v1.1',
    embedder: {
      provider: 'openai',
      config: {
        apiKey: 'atrib-local-mem0-assurance',
        baseURL: provider.baseUrl,
        model: 'text-embedding-3-small',
        embeddingDims: 2,
      },
    },
    vectorStore: {
      provider: 'memory',
      config: {
        collectionName: 'atrib_mem0_mutation_assurance',
        dimension: 2,
        dbPath: ':memory:',
      },
    },
    llm: {
      provider: 'openai',
      config: {
        apiKey: 'atrib-local-mem0-assurance',
        baseURL: provider.baseUrl,
        model: 'gpt-5-mini',
      },
    },
    disableHistory: false,
    historyDbPath: ':memory:',
  })

  const publicRecords: AtribRecord[] = []
  const attributed = attributeMem0Memory(mem0, {
    privateKey,
    contextId,
    logSubmission: 'disabled',
    onRecord: (record) => {
      publicRecords.push(record)
    },
  })

  const addResult = await attributed.add(originalText, {
    userId: tenantId,
    infer: false,
    metadata: { category: 'billing' },
  })
  const memoryId = addResult.results[0]?.id
  assert.ok(memoryId)
  const addRecordHash = attributed.getLastRecordHash()
  assert.match(addRecordHash ?? '', /^sha256:[0-9a-f]{64}$/)

  let blockedBodyExecuted = false
  const blocked = await runMem0MutationAssurance({
    privateKey,
    contextId,
    parentRecordHashes: [addRecordHash as `sha256:${string}`],
    runId,
    actionId: 'attempt-cross-tenant-update',
    agentId,
    operation: 'update',
    args: {
      memory_id: memoryId,
      update: { metadata: { user_id: 'tenant-b' } },
    },
    risk: ['memory_mutation', 'identity_scope_change'],
    execute: async () => {
      blockedBodyExecuted = true
      return mem0.update(memoryId, { metadata: { user_id: 'tenant-b' } })
    },
    verifyPostcondition: () => [],
    onRecord: (record) => {
      publicRecords.push(record)
    },
  })

  const afterBlocked = await mem0.get(memoryId)
  assert.equal(blocked.state, 'blocked')
  assert.equal(blockedBodyExecuted, false)
  assert.equal(readIdentity(afterBlocked, 'user_id'), tenantId)

  const allowed = await runMem0MutationAssurance({
    privateKey,
    contextId,
    parentRecordHashes: [blocked.outcome.record_hash],
    runId,
    actionId: 'update-billing-preference',
    agentId,
    operation: 'update',
    args: {
      memory_id: memoryId,
      update: { text: updatedText, metadata: { category: 'billing' } },
    },
    execute: () => mem0.update(memoryId, { text: updatedText, metadata: { category: 'billing' } }),
    summarizeResult: () => ({ mem0_reported_success: true }),
    verifyPostcondition: async () => {
      const current = await mem0.get(memoryId)
      return [
        { name: 'text_updated', passed: current.memory === updatedText },
        {
          name: 'identity_scope_preserved',
          passed: readIdentity(current, 'user_id') === tenantId,
        },
        {
          name: 'metadata_updated',
          passed: current.metadata?.category === 'billing',
        },
      ]
    },
    onRecord: (record) => {
      publicRecords.push(record)
    },
  })

  const deleted = await runMem0MutationAssurance({
    privateKey,
    contextId,
    parentRecordHashes: [allowed.outcome.record_hash],
    runId,
    actionId: 'delete-billing-preference',
    agentId,
    operation: 'delete',
    args: { memory_id: memoryId },
    execute: () => mem0.delete(memoryId),
    summarizeResult: () => ({ mem0_reported_success: true }),
    verifyPostcondition: async () => [
      { name: 'memory_absent', passed: await memoryIsAbsent(mem0, memoryId) },
    ],
    onRecord: (record) => {
      publicRecords.push(record)
    },
  })

  assert.equal(allowed.state, 'allowed')
  assert.equal(allowed.result?.postcondition.status, 'passed')
  assert.equal(deleted.state, 'allowed')
  assert.equal(deleted.result?.postcondition.status, 'passed')
  assert.equal(publicRecords.length, 7)
  assert.equal(JSON.stringify(publicRecords).includes(originalText), false)
  assert.equal(JSON.stringify(publicRecords).includes(updatedText), false)
  for (const record of publicRecords) {
    assert.equal(await verifyRecord(record), true)
  }
  const recordHashes = publicRecords.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        strategy: 'mem0-mutation-assurance-v1',
        mem0_package: 'mem0ai@3.1.0',
        context_id: contextId,
        real_mem0_oss_memory: true,
        operations: ['add', 'blocked_update', 'allowed_update', 'verified_delete'],
        signed_records: publicRecords.length,
        record_hashes: recordHashes,
        proof: {
          identity_scope_update_blocked_before_execution: !blockedBodyExecuted,
          identity_scope_preserved: readIdentity(afterBlocked, 'user_id') === tenantId,
          allowed_update_postcondition: allowed.result?.postcondition,
          delete_postcondition: deleted.result?.postcondition,
          all_action_gate_runs_valid:
            blocked.verification.valid && allowed.verification.valid && deleted.verification.valid,
          all_record_signatures_valid: true,
          public_records_hash_only: true,
        },
        boundaries: {
          mem0_owns: ['extraction', 'storage', 'history', 'retrieval'],
          atrib_owns: ['pre_action_policy_evidence', 'mutation_outcome', 'postcondition_evidence'],
          opentelemetry_remains_complementary: true,
        },
        caveats: [
          'This TypeScript proof detects false success through a read-back postcondition. It does not reproduce the Python Qdrant reset report.',
          'Identity and approval authority remain host-owned.',
        ],
      },
      null,
      2,
    ),
  )
} finally {
  await provider.close()
}

function readIdentity(
  memory: { metadata?: Record<string, unknown> } & Record<string, unknown>,
  key: string,
) {
  return memory[key] ?? memory.metadata?.[key]
}

async function memoryIsAbsent(memory: Memory, memoryId: string): Promise<boolean> {
  try {
    return (await memory.get(memoryId)) === null
  } catch (error) {
    return error instanceof Error && /not found/i.test(error.message)
  }
}

async function startLocalOpenAiProvider(): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const server: Server = createServer(async (req, res) => {
    const body = await readJson(req)
    if (req.url?.includes('/embeddings')) {
      const inputs = Array.isArray(body.input) ? body.input : [body.input]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          object: 'list',
          model: body.model ?? 'text-embedding-3-small',
          data: inputs.map((input: unknown, index: number) => ({
            object: 'embedding',
            index,
            embedding: encodeEmbedding(embeddingFor(String(input)), body.encoding_format),
          })),
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      )
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `unexpected path ${req.url}` } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

function embeddingFor(text: string): number[] {
  return text.toLowerCase().includes('invoice') ? [1, 0] : [0, 1]
}

function encodeEmbedding(vector: number[], format: unknown): number[] | string {
  if (format === 'base64') {
    return Buffer.from(new Float32Array(vector).buffer).toString('base64')
  }
  return vector
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length > 0 ? JSON.parse(raw) : {}
}
