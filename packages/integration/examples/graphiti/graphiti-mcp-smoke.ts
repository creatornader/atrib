// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRecord, hexEncode, sha256, verifyRecord, type AtribRecord } from '@atrib/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { snapshotWrapperMain } from '../mcp-wrap-runtime.js'

const EVENT_TYPE_TOOL_CALL = 'https://atrib.dev/v1/types/tool_call'

interface LocalLogServer {
  endpoint: string
  submissions: unknown[]
  close(): Promise<void>
}

async function startLocalLog(): Promise<LocalLogServer> {
  const submissions: unknown[] = []
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/entries') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
      return
    }

    let body = ''
    for await (const chunk of req) body += chunk
    submissions.push(JSON.parse(body) as unknown)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        log_index: submissions.length - 1,
        checkpoint: 'graphiti-mcp-smoke',
        inclusion_proof: [],
        leaf_hash: `sha256:${'0'.repeat(64)}`,
      }),
    )
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('local log did not bind to a TCP port')
  }

  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/entries`,
    submissions,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return { ...env, ...extra }
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function mirrorRecords(recordFile: string): AtribRecord[] {
  const raw = readFileSync(recordFile, 'utf8').trim()
  if (!raw) throw new Error('record mirror is empty')

  return raw.split('\n').map((line) => {
    const parsed = JSON.parse(line) as unknown
    const candidate =
      typeof parsed === 'object' &&
      parsed !== null &&
      'record' in parsed &&
      typeof (parsed as { record?: unknown }).record === 'object'
        ? (parsed as { record: AtribRecord }).record
        : (parsed as AtribRecord)

    if (
      typeof candidate.context_id !== 'string' ||
      typeof candidate.signature !== 'string' ||
      typeof candidate.creator_key !== 'string'
    ) {
      throw new Error('record mirror did not contain a signed atrib record')
    }

    return candidate
  })
}

function toolText(result: unknown): string {
  if (typeof result !== 'object' || result === null) return ''
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item !== 'object' || item === null) return ''
      const text = (item as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('\n')
}

async function main(): Promise<void> {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const fixtureServer = join(exampleDir, 'graphiti-fixture-mcp.ts')

  const tempDir = mkdtempSync(join(tmpdir(), 'atrib-graphiti-mcp-'))
  const configPath = join(tempDir, 'wrap-config.json')
  const recordFile = join(tempDir, 'records.jsonl')
  const logFile = join(tempDir, 'wrapper.log')
  const client = new Client({ name: 'graphiti-mcp-smoke-host', version: '0.1.0' })
  let localLog: LocalLogServer | undefined

  try {
    const wrapperMain = await snapshotWrapperMain({ integrationDir, tempDir })
    const activeLocalLog = await startLocalLog()
    localLog = activeLocalLog
    const config = {
      name: 'graphiti',
      agent: 'graphiti-smoke',
      upstream: {
        command: 'pnpm',
        args: ['exec', 'tsx', fixtureServer],
      },
      serverUrl: 'graphiti://mcp.local',
      logEndpoint: activeLocalLog.endpoint,
      recordFile,
      logFile,
      autoChain: true,
      autoChainFallback: 'fresh',
      disclosure: {
        tool_name: 'verbatim',
        args: 'plain-sha256',
        result: 'plain-sha256',
      },
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2))

    const transport = new StdioClientTransport({
      command: 'node',
      args: [wrapperMain, configPath],
      env: cleanEnv({ ATRIB_PRIVATE_KEY: randomBytes(32).toString('base64url') }),
    })

    await client.connect(transport)
    const tools = await client.listTools()
    const toolNames = new Set(tools.tools.map((tool) => tool.name))
    for (const expected of ['add_memory', 'search_memory_facts', 'get_episodes']) {
      if (!toolNames.has(expected)) {
        throw new Error(`expected ${expected} tool, saw: ${[...toolNames].join(', ')}`)
      }
    }

    const addResult = await client.callTool({
      name: 'add_memory',
      arguments: {
        name: 'Atrib proof note',
        episode_body: 'Alice prefers quiet sci-fi movies and wants verifiable memory updates.',
        group_id: 'atrib-demo',
        source: 'text',
        source_description: 'local Graphiti MCP fixture',
      },
    })
    if (!toolText(addResult).includes("Episode 'Atrib proof note' queued")) {
      throw new Error(`unexpected add_memory result: ${JSON.stringify(addResult)}`)
    }

    const searchResult = await client.callTool({
      name: 'search_memory_facts',
      arguments: {
        query: 'quiet sci-fi',
        group_ids: ['atrib-demo'],
        max_facts: 3,
      },
    })
    if (!toolText(searchResult).includes('Facts retrieved successfully')) {
      throw new Error(`unexpected search_memory_facts result: ${JSON.stringify(searchResult)}`)
    }

    const episodesResult = await client.callTool({
      name: 'get_episodes',
      arguments: { group_ids: ['atrib-demo'], max_episodes: 3 },
    })
    if (!toolText(episodesResult).includes('Atrib proof note')) {
      throw new Error(`unexpected get_episodes result: ${JSON.stringify(episodesResult)}`)
    }

    await waitFor(() => existsSync(recordFile), 'record mirror')
    await waitFor(() => activeLocalLog.submissions.length >= 3, 'local log submissions')

    const records = mirrorRecords(recordFile)
    const toolNamesSeen = records.map((record) => record.tool_name)
    if (records.length !== 3) {
      throw new Error(`expected 3 signed records, got ${records.length}`)
    }
    if (toolNamesSeen.join(',') !== 'add_memory,search_memory_facts,get_episodes') {
      throw new Error(`unexpected signed tool order: ${toolNamesSeen.join(',')}`)
    }

    for (const record of records) {
      if (record.event_type !== EVENT_TYPE_TOOL_CALL) {
        throw new Error(`expected tool_call record, got ${record.event_type}`)
      }
      if (!record.args_hash || !record.result_hash) {
        throw new Error(`expected args_hash and result_hash disclosures for ${record.tool_name}`)
      }
      if (!(await verifyRecord(record))) {
        throw new Error(`record signature failed verification for ${record.tool_name}`)
      }
    }

    const publicRecordJson = JSON.stringify(records)
    if (publicRecordJson.includes('quiet sci-fi')) {
      throw new Error('public records leaked episode body')
    }

    const recordHashes = records.map(
      (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
    )

    console.log(
      JSON.stringify(
        {
          ok: true,
          note: 'Wraps a Graphiti MCP-shaped upstream through @atrib/mcp-wrap and signs add_memory/search_memory_facts/get_episodes without changing Graphiti-shaped results.',
          upstream_shape:
            'getzep/graphiti MCP server tools add_memory, search_memory_facts, get_episodes',
          graphiti_source_commit_read: '34f56e65e0fe2096132c8d16f3a1a4ac9300a5f6',
          signed_records: records.length,
          operations: toolNamesSeen,
          record_hashes: recordHashes,
          last_record_hash: recordHashes.at(-1),
          submissions: activeLocalLog.submissions.length,
          public_records_hash_only: true,
        },
        null,
        2,
      ),
    )
  } finally {
    await client.close().catch(() => {})
    await localLog?.close().catch(() => {})
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
