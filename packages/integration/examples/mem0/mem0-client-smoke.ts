// SPDX-License-Identifier: Apache-2.0

import { strict as assert } from 'node:assert'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { attributeMem0Memory, type AtribMem0Sidecar } from '../../src/mem0-attribution.js'

process.env.MEM0_TELEMETRY = 'false'

const { MemoryClient } = await import('mem0ai')

const privateKey = new Uint8Array(32).fill(41)
const contextId = 'ca1f4a3fb6c24d50a65f225a2fb30531'

const mem0Api = await startLocalMem0Api()

try {
  const client = new MemoryClient({
    apiKey: 'atrib-local-platform-key',
    host: mem0Api.baseUrl,
  })
  await client.ping()

  const records: AtribRecord[] = []
  const sidecars: AtribMem0Sidecar[] = []
  const attributed = attributeMem0Memory(client, {
    privateKey,
    contextId,
    serverUrl: 'mem0://platform-client',
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
    infer: true,
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
  assert.equal(addResult.length, 1)
  assert.match(addResult[0]!.memory ?? '', /sci-fi/i)
  assert.equal(searchResult.results.length, 1)
  assert.match(searchResult.results[0]!.memory ?? '', /sci-fi/i)
  assert.ok(mem0Api.requests.some((request) => request.path === '/v3/memories/add/'))
  assert.ok(mem0Api.requests.some((request) => request.path === '/v3/memories/search/'))

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
        note: 'Imports real mem0ai MemoryClient and proves atrib signs hosted-client add/search boundaries against a local Mem0-shaped API.',
        mem0_package: 'mem0ai@3.0.6',
        context_id: contextId,
        signed_records: records.length,
        operations: records.map((record) => record.tool_name),
        record_hashes: recordHashes,
        last_record_hash: attributed.getLastRecordHash(),
        mem0_add_results: addResult.length,
        mem0_search_results: searchResult.results.length,
        mem0_requests_seen: mem0Api.requests.map((request) => ({
          method: request.method,
          path: request.path,
        })),
        public_records_hash_only: true,
      },
      null,
      2,
    ),
  )
} finally {
  await mem0Api.close()
}

async function startLocalMem0Api(): Promise<{
  baseUrl: string
  requests: Array<{ method: string; path: string; body: unknown }>
  close: () => Promise<void>
}> {
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const server: Server = createServer(async (req, res) => {
    const path = req.url ?? ''
    const body = req.method === 'GET' ? undefined : await readJson(req)
    requests.push({ method: req.method ?? 'GET', path, body })

    if (req.method === 'GET' && path === '/v1/ping/') {
      assert.equal(req.headers.authorization, 'Token atrib-local-platform-key')
      writeJson(res, {
        status: 'ok',
        org_id: 'org-atrib-local',
        project_id: 'project-atrib-local',
        user_email: 'atrib-local@example.com',
      })
      return
    }

    if (req.method === 'POST' && path === '/v3/memories/add/') {
      assert.equal(req.headers.authorization, 'Token atrib-local-platform-key')
      assert.deepEqual((body as any).messages[0], {
        role: 'user',
        content: 'I prefer quiet sci-fi movies for weekends.',
      })
      assert.equal((body as any).user_id, 'alice')
      writeJson(res, [
        {
          id: 'mem-platform-1',
          memory: 'User prefers quiet sci-fi movies.',
          user_id: 'alice',
          metadata: { category: 'movie_recommendations' },
          created_at: '2026-06-02T03:30:00.000Z',
          updated_at: '2026-06-02T03:30:00.000Z',
        },
      ])
      return
    }

    if (req.method === 'POST' && path === '/v3/memories/search/') {
      assert.equal(req.headers.authorization, 'Token atrib-local-platform-key')
      assert.match((body as any).query, /movie preference/i)
      assert.deepEqual((body as any).filters, { user_id: 'alice' })
      writeJson(res, {
        results: [
          {
            id: 'mem-platform-1',
            memory: 'User prefers quiet sci-fi movies.',
            user_id: 'alice',
            score: 0.97,
            metadata: { category: 'movie_recommendations' },
            created_at: '2026-06-02T03:30:00.000Z',
            updated_at: '2026-06-02T03:30:00.000Z',
          },
        ],
      })
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `unexpected path ${path}` } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

function writeJson(res: import('node:http').ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length > 0 ? JSON.parse(raw) : {}
}
