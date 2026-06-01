// SPDX-License-Identifier: Apache-2.0

import { strict as assert } from 'node:assert'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { Memory } from 'mem0ai/oss'
import { attributeMem0Memory, type AtribMem0Sidecar } from '../../src/mem0-attribution.js'

const privateKey = new Uint8Array(32).fill(31)
const contextId = '5f3b74381c4c4ef4a5137d2bd8e77fb1'

const provider = await startLocalDenyingProvider()

try {
  const mem0 = new Memory({
    version: 'v1.1',
    disableHistory: true,
    embedder: {
      provider: 'openai',
      config: {
        apiKey: 'atrib-local-probe',
        baseURL: provider.baseUrl,
        model: 'text-embedding-3-small',
        embeddingDims: 1536,
      },
    },
    vectorStore: {
      provider: 'memory',
      config: {
        collectionName: 'atrib_mem0_oss_compat',
        dimension: 1536,
      },
    },
    llm: {
      provider: 'openai',
      config: {
        apiKey: 'atrib-local-probe',
        baseURL: provider.baseUrl,
        model: 'gpt-5-mini',
      },
    },
    historyDbPath: ':memory:',
  })

  const records: AtribRecord[] = []
  const sidecars: AtribMem0Sidecar[] = []
  const attributed = attributeMem0Memory(mem0, {
    privateKey,
    contextId,
    logSubmission: 'disabled',
    onRecord: (record, sidecar) => {
      records.push(record)
      sidecars.push(sidecar)
    },
  })

  const messages = [
    { role: 'user' as const, content: 'I like quiet sci-fi movies.' },
    { role: 'assistant' as const, content: 'I will remember that preference.' },
  ]

  const thrown = await captureError(() =>
    attributed.add(messages, {
      userId: 'alice',
      metadata: { category: 'movie_recommendations' },
    }),
  )

  assert(thrown instanceof Error)
  assert.match(thrown.message, /atrib local mem0 provider denied request/i)
  assert.equal(records.length, 1)
  assert.equal(sidecars.length, 1)
  assert.equal(records[0]!.tool_name, 'mem0.memory.add')
  assert.equal(sidecars[0]!.operation, 'add')
  assert.equal(sidecars[0]!.status, 'error')
  assert.equal(sidecars[0]!.status === 'error' ? sidecars[0]!.error.message : '', thrown.message)
  assert.equal(await verifyRecord(records[0]!), true)
  assert.equal(JSON.stringify(records).includes('sci-fi'), false)
  assert.equal(JSON.stringify(sidecars[0]!.args).includes('sci-fi'), true)
  assert.ok(provider.paths.some((path) => path.includes('/embeddings')))

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'Imports real mem0ai/oss Memory and proves atrib signs the add boundary when mem0 provider execution fails.',
        mem0_package: 'mem0ai@3.0.6',
        context_id: contextId,
        signed_records: records.length,
        operations: records.map((record) => record.tool_name),
        record_hashes: recordHashes,
        last_record_hash: attributed.getLastRecordHash(),
        mem0_error_preserved: true,
        provider_paths_seen: provider.paths,
        public_records_hash_only: true,
      },
      null,
      2,
    ),
  )
} finally {
  await provider.close()
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected mem0 provider call to fail')
}

async function startLocalDenyingProvider(): Promise<{
  baseUrl: string
  paths: string[]
  close: () => Promise<void>
}> {
  const paths: string[] = []
  const server: Server = createServer((req, res) => {
    paths.push(req.url ?? '')
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          message: 'atrib local mem0 provider denied request',
          type: 'invalid_request_error',
          code: 'atrib_local_probe',
        },
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    paths,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}
