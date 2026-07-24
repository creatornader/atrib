// SPDX-License-Identifier: Apache-2.0

import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAtribClient, type AttestInput } from '@atrib/sdk'
import {
  OPERATING_EVENT_SCHEMA,
  parseOperatingEvent,
  projectOperatingView,
  searchOperatingEntries,
  type OperatingEntry,
  type OperatingViewQuery,
} from './model.js'
import { loadOperatingEntries, mirrorFingerprint } from './store.js'

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MIRROR_PATH = join(homedir(), '.atrib', 'records')
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8797
const MAX_BODY_BYTES = 1_000_000

interface Snapshot {
  revision: number
  fingerprint: string
  entries: OperatingEntry[]
  loaded_at_ms: number
}

export interface ServerConfig {
  mirrorPath: string
  host: string
  port: number
  writesEnabled: boolean
  writeToken?: string
  trustedCreatorKeys?: string[]
  pollMs: number
}

function configFromEnv(): ServerConfig {
  const trusted = (process.env['ATRIB_OPERATING_TRUSTED_CREATORS'] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    mirrorPath: process.env['ATRIB_OPERATING_MIRROR'] ?? DEFAULT_MIRROR_PATH,
    host: process.env['ATRIB_OPERATING_HOST'] ?? DEFAULT_HOST,
    port: Number(process.env['ATRIB_OPERATING_PORT'] ?? DEFAULT_PORT),
    writesEnabled: process.env['ATRIB_OPERATING_WRITES'] === 'enabled',
    ...(process.env['ATRIB_OPERATING_WRITE_TOKEN']
      ? { writeToken: process.env['ATRIB_OPERATING_WRITE_TOKEN'] }
      : {}),
    ...(trusted.length > 0 ? { trustedCreatorKeys: trusted } : {}),
    pollMs: Math.max(250, Number(process.env['ATRIB_OPERATING_POLL_MS'] ?? 1_000)),
  }
}

function json(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  })
  response.end(JSON.stringify(body))
}

function cors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', process.env['ATRIB_OPERATING_CORS'] ?? '*')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Last-Event-ID')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

function hasWriteAuthorization(request: IncomingMessage, config: ServerConfig): boolean {
  if (!config.writeToken) return false
  const supplied = request.headers.authorization
  if (!supplied?.startsWith('Bearer ')) return false
  const suppliedBytes = Buffer.from(supplied.slice('Bearer '.length))
  const expectedBytes = Buffer.from(config.writeToken)
  return (
    suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

function requireWriteAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServerConfig,
): boolean {
  if (hasWriteAuthorization(request, config)) return true
  json(
    response,
    401,
    { error: 'write authorization required' },
    { 'WWW-Authenticate': 'Bearer realm="atrib-operating-graph"' },
  )
  return false
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) throw new Error('request body exceeds 1 MB')
    chunks.push(bytes)
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function stringParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim()
  return value ? value : undefined
}

function integerParam(url: URL, name: string): number | undefined {
  const raw = stringParam(url, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function queryFromUrl(url: URL, config: ServerConfig): OperatingViewQuery {
  const workspaceId = stringParam(url, 'workspace_id')
  if (!workspaceId) throw new Error('workspace_id is required')
  const taskId = stringParam(url, 'task_id')
  const teamId = stringParam(url, 'team_id')
  const agentId = stringParam(url, 'agent_id')
  const cellLimit = integerParam(url, 'cell_limit')
  const headLimit = integerParam(url, 'head_limit')
  const eventLimit = integerParam(url, 'event_limit')
  return {
    workspace_id: workspaceId,
    ...(taskId ? { task_id: taskId } : {}),
    ...(teamId ? { team_id: teamId } : {}),
    ...(agentId ? { agent_id: agentId } : {}),
    ...(config.trustedCreatorKeys ? { trusted_creator_keys: config.trustedCreatorKeys } : {}),
    ...(cellLimit ? { cell_limit: cellLimit } : {}),
    ...(headLimit ? { head_limit: headLimit } : {}),
    ...(eventLimit ? { event_limit: eventLimit } : {}),
  }
}

function workspaceIndex(entries: OperatingEntry[]): Array<{ id: string; name: string }> {
  const workspaces = new Map<string, string>()
  for (const entry of entries) {
    if (entry.signature_verified) {
      workspaces.set(entry.event.workspace.id, entry.event.workspace.name)
    }
  }
  return [...workspaces]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function startOperatingGraphServer(
  config: ServerConfig = configFromEnv(),
): Promise<ReturnType<typeof createServer>> {
  if (config.writesEnabled && !config.writeToken) {
    throw new Error('ATRIB_OPERATING_WRITE_TOKEN is required when writes are enabled')
  }
  let snapshot: Snapshot = {
    revision: 0,
    fingerprint: '',
    entries: [],
    loaded_at_ms: 0,
  }
  const clients = new Set<ServerResponse>()
  const sdk = createAtribClient()

  const refresh = async (): Promise<boolean> => {
    const fingerprint = await mirrorFingerprint(config.mirrorPath).catch(() => '')
    if (fingerprint === snapshot.fingerprint && snapshot.loaded_at_ms !== 0) return false
    const entries = await loadOperatingEntries(config.mirrorPath)
    snapshot = {
      revision: snapshot.revision + 1,
      fingerprint,
      entries,
      loaded_at_ms: Date.now(),
    }
    for (const client of clients) {
      client.write(
        `id: ${snapshot.revision}\nevent: changed\ndata: ${JSON.stringify({
          revision: snapshot.revision,
          record_count: snapshot.entries.length,
        })}\n\n`,
      )
    }
    return true
  }
  await refresh()
  const poll = setInterval(() => void refresh().catch(() => {}), config.pollMs)
  poll.unref()

  const htmlPath = resolve(SOURCE_DIR, '..', 'index.html')
  const server = createServer(async (request, response) => {
    cors(response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        const html = await readFile(htmlPath, 'utf8')
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        response.end(html)
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/health') {
        json(response, 200, {
          status: 'ok',
          revision: snapshot.revision,
          records: snapshot.entries.length,
          writes_enabled: config.writesEnabled,
          write_auth: config.writesEnabled ? 'bearer' : 'disabled',
          mirror_path: config.mirrorPath,
          trust_policy:
            config.trustedCreatorKeys === undefined
              ? 'all-valid-signatures'
              : 'configured-creator-allowlist',
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/workspaces') {
        json(response, 200, {
          revision: snapshot.revision,
          workspaces: workspaceIndex(snapshot.entries),
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/view') {
        const query = queryFromUrl(url, config)
        json(response, 200, {
          revision: snapshot.revision,
          view: projectOperatingView(snapshot.entries, query),
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/search') {
        const query = queryFromUrl(url, config)
        const text = stringParam(url, 'q')
        if (!text) throw new Error('q is required')
        const limit = integerParam(url, 'limit')
        json(response, 200, {
          revision: snapshot.revision,
          results: searchOperatingEntries(snapshot.entries, {
            ...query,
            text,
            ...(limit ? { limit } : {}),
          }),
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/v1/stream') {
        const lastEventId = Number(
          request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0,
        )
        if (!Number.isSafeInteger(lastEventId) || lastEventId < 0) {
          json(response, 400, { error: 'invalid stream cursor' })
          return
        }
        if (lastEventId > snapshot.revision) {
          json(response, 409, {
            error: 'stream cursor is ahead of the current revision',
            current_revision: snapshot.revision,
          })
          return
        }
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        })
        response.write(
          `event: ready\ndata: ${JSON.stringify({
            revision: snapshot.revision,
            record_count: snapshot.entries.length,
          })}\n\n`,
        )
        clients.add(response)
        request.on('close', () => clients.delete(response))
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/events') {
        if (!config.writesEnabled) {
          json(response, 403, { error: 'writes are disabled' })
          return
        }
        if (!requireWriteAuthorization(request, response, config)) return
        const body = await readJsonBody(request)
        const event = parseOperatingEvent(body['event'])
        if (!event) throw new Error(`event must match ${OPERATING_EVENT_SCHEMA}`)
        const input: AttestInput = {
          content: event as unknown as Record<string, unknown>,
          ...(typeof body['context_id'] === 'string' ? { context_id: body['context_id'] } : {}),
          ...(Array.isArray(body['informed_by'])
            ? { informed_by: body['informed_by'].map(String) }
            : {}),
          ...(typeof body['revises'] === 'string'
            ? { ref: { kind: 'revises', record_hash: body['revises'] } }
            : {}),
        }
        const result = await sdk.attest(input)
        json(response, result.record_hash ? 201 : 503, result)
        return
      }
      if (request.method === 'POST' && url.pathname === '/v1/resolve') {
        if (!config.writesEnabled) {
          json(response, 403, { error: 'writes are disabled' })
          return
        }
        if (!requireWriteAuthorization(request, response, config)) return
        const body = await readJsonBody(request)
        const base = parseOperatingEvent(body['event'])
        if (
          !base ||
          base.kind !== 'resolution' ||
          !base.accepted_head ||
          !base.resolves ||
          base.resolves.length < 2
        ) {
          throw new Error('resolution event needs accepted_head and at least two resolves hashes')
        }
        const result = await sdk.attest({
          content: base as unknown as Record<string, unknown>,
          informed_by: base.resolves,
          allow_unresolved_informed_by: false,
          ...(typeof body['context_id'] === 'string' ? { context_id: body['context_id'] } : {}),
        })
        json(response, result.record_hash ? 201 : 503, result)
        return
      }
      json(response, 404, { error: 'not found' })
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  server.on('close', () => {
    clearInterval(poll)
    for (const client of clients) client.end()
    void sdk.close()
  })
  await new Promise<void>((resolveListen) => server.listen(config.port, config.host, resolveListen))
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = configFromEnv()
  startOperatingGraphServer(config)
    .then(() => {
      process.stdout.write(
        `atrib operating graph listening on http://${config.host}:${config.port}\n`,
      )
    })
    .catch((error) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    })
}
