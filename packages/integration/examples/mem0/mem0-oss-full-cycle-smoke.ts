// SPDX-License-Identifier: Apache-2.0

import { strict as assert } from 'node:assert'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { attributeMem0Memory, type AtribMem0Sidecar } from '../../src/mem0-attribution.js'

process.env.MEM0_TELEMETRY = 'false'

const { Memory } = await import('mem0ai/oss')

const privateKey = new Uint8Array(32).fill(37)
const contextId = '1b70d41d33f04db08a3fc3d43a13905e'

const provider = await startLocalOpenAiProvider()

try {
  const mem0 = new Memory({
    version: 'v1.1',
    embedder: {
      provider: 'openai',
      config: {
        apiKey: 'atrib-local-success',
        baseURL: provider.baseUrl,
        model: 'text-embedding-3-small',
        embeddingDims: 2,
      },
    },
    vectorStore: {
      provider: 'memory',
      config: {
        collectionName: 'atrib_mem0_oss_full_cycle',
        dimension: 2,
        dbPath: ':memory:',
      },
    },
    llm: {
      provider: 'openai',
      config: {
        apiKey: 'atrib-local-success',
        baseURL: provider.baseUrl,
        model: 'gpt-5-mini',
      },
    },
    disableHistory: true,
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
    { role: 'user' as const, content: 'I prefer quiet sci-fi movies for weekends.' },
    { role: 'assistant' as const, content: 'I will remember that movie preference.' },
  ]

  const addResult = await attributed.add(messages, {
    userId: 'alice',
    metadata: { category: 'movie_recommendations' },
  })
  const searchResult = await attributed.search('What movie preference should I remember?', {
    filters: { user_id: 'alice' },
    topK: 3,
    threshold: 0,
  })

  assert.equal(records.length, 2)
  assert.equal(sidecars.length, 2)
  assert.deepEqual(
    records.map((record) => record.tool_name),
    ['mem0.memory.add', 'mem0.memory.search'],
  )
  assert.equal(sidecars[0]!.status, 'ok')
  assert.equal(sidecars[1]!.status, 'ok')
  assert.ok(addResult.results.length > 0)
  assert.match(addResult.results[0]!.memory, /sci-fi/i)
  assert.ok(searchResult.results.length > 0)
  assert.match(searchResult.results[0]!.memory, /sci-fi/i)
  assert.ok(provider.paths.some((path) => path.includes('/chat/completions')))
  assert.ok(provider.paths.some((path) => path.includes('/embeddings')))

  for (const record of records) {
    assert.equal(await verifyRecord(record), true)
  }

  const publicRecordJson = JSON.stringify(records)
  assert.equal(publicRecordJson.includes('quiet sci-fi'), false)
  assert.equal(JSON.stringify(sidecars[0]!.args).includes('quiet sci-fi'), true)

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        note: 'Imports real mem0ai/oss Memory and proves atrib signs a successful add/search cycle through a local OpenAI-compatible provider.',
        mem0_package: 'mem0ai@3.0.6',
        context_id: contextId,
        signed_records: records.length,
        operations: records.map((record) => record.tool_name),
        record_hashes: recordHashes,
        last_record_hash: attributed.getLastRecordHash(),
        mem0_add_results: addResult.results.length,
        mem0_search_results: searchResult.results.length,
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

async function startLocalOpenAiProvider(): Promise<{
  baseUrl: string
  paths: string[]
  close: () => Promise<void>
}> {
  const paths: string[] = []
  const server: Server = createServer(async (req, res) => {
    paths.push(req.url ?? '')
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

    if (req.url?.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-atrib-local-mem0',
          object: 'chat.completion',
          created: 1_780_354_200,
          model: body.model ?? 'gpt-5-mini',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  memory: [{ id: '0', text: 'User prefers quiet sci-fi movies.' }],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
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

function embeddingFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (normalized.includes('sci-fi') || normalized.includes('movie')) {
    return [1, 0]
  }
  return [0, 1]
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
