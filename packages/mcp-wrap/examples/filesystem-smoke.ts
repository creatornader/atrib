import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

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

    try {
      submissions.push(JSON.parse(body) as unknown)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          log_index: submissions.length - 1,
          checkpoint: 'mcp-wrap-filesystem-smoke',
          inclusion_proof: [],
          leaf_hash: `sha256:${'0'.repeat(64)}`,
        }),
      )
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_json' }))
    }
  })

  await listen(server)
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

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
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

function latestMirrorRecord(recordFile: string): AtribRecord {
  const raw = readFileSync(recordFile, 'utf8').trim()
  if (!raw) throw new Error('record mirror is empty')
  const parsed = JSON.parse(raw.split('\n').at(-1)!) as unknown
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
  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
  const wrapperMain = join(packageDir, 'dist', 'main.js')
  if (!existsSync(wrapperMain)) {
    throw new Error('missing dist/main.js. Run `pnpm --filter @atrib/mcp-wrap build` first.')
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'atrib-mcp-wrap-filesystem-'))
  const fixtureDir = join(tempDir, 'fixture')
  let upstreamDir = fixtureDir
  let notePath = join(fixtureDir, 'note.txt')
  const configPath = join(tempDir, 'wrap-config.json')
  const recordFile = join(tempDir, 'records.jsonl')
  const logFile = join(tempDir, 'wrapper.log')
  const localLog = await startLocalLog()
  const client = new Client({ name: 'mcp-wrap-smoke-host', version: '0.1.0' })

  try {
    mkdirSync(fixtureDir, { recursive: true })
    upstreamDir = realpathSync(fixtureDir)
    notePath = join(upstreamDir, 'note.txt')
    writeFileSync(notePath, 'atrib mcp-wrap smoke fixture\n', { flag: 'wx' })
  } catch (err) {
    await localLog.close()
    rmSync(tempDir, { recursive: true, force: true })
    throw err
  }

  const config = {
    name: 'filesystem',
    agent: 'mcp-wrap-smoke',
    upstream: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', upstreamDir],
    },
    serverUrl: 'mcp://filesystem.local',
    logEndpoint: localLog.endpoint,
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

  try {
    await client.connect(transport)
    const tools = await client.listTools()
    const toolNames = new Set(tools.tools.map((tool) => tool.name))
    if (!toolNames.has('read_file')) {
      throw new Error(`expected read_file tool, saw: ${[...toolNames].join(', ')}`)
    }

    const result = await client.callTool({
      name: 'read_file',
      arguments: { path: notePath },
    })
    if (!toolText(result).includes('atrib mcp-wrap smoke fixture')) {
      throw new Error(`unexpected read_file result: ${JSON.stringify(result)}`)
    }

    await waitFor(() => existsSync(recordFile), 'record mirror')
    await waitFor(() => localLog.submissions.length > 0, 'local log submission')

    const record = latestMirrorRecord(recordFile)
    if (record.event_type !== EVENT_TYPE_TOOL_CALL) {
      throw new Error(`expected tool_call record, got ${record.event_type}`)
    }
    if (record.tool_name !== 'read_file') {
      throw new Error(`expected signed tool_name read_file, got ${record.tool_name}`)
    }
    if (!record.args_hash || !record.result_hash) {
      throw new Error('expected args_hash and result_hash disclosures')
    }

    const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    console.log(
      JSON.stringify(
        {
          status: 'ok',
          upstream: '@modelcontextprotocol/server-filesystem',
          tool_name: record.tool_name,
          record_hash: recordHash,
          submissions: localLog.submissions.length,
          record_file: recordFile,
        },
        null,
        2,
      ),
    )
  } finally {
    await client.close().catch(() => {})
    await localLog.close().catch(() => {})
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
