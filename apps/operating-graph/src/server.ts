// SPDX-License-Identifier: Apache-2.0

import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAtribClient, type AttestInput } from '@atrib/sdk'
import { canonicalRecord, hexEncode, sha256, verifyRecord, type AtribRecord } from '@atrib/mcp'
import {
  OPERATING_EVENT_SCHEMA,
  parseOperatingEvent,
  projectOperatingView,
  searchOperatingEntries,
  type OperatingEntry,
  type OperatingViewQuery,
} from './model.js'
import { buildArchiveBodyOpening, buildLocalBodyOpening } from './opening.js'
import { loadLocalRecordMaterial, loadOperatingEntries, mirrorFingerprint } from './store.js'
import { revisionRelation } from './stream.js'

const SOURCE_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_MIRROR_PATH = join(homedir(), '.atrib', 'records')
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8797
const MAX_BODY_BYTES = 1_000_000
const MAX_OPENING_RESPONSE_BYTES = 2_000_000

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
  bodyReadToken?: string
  archiveUrl?: string
  archiveToken?: string
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
    ...(process.env['ATRIB_OPERATING_BODY_TOKEN']
      ? { bodyReadToken: process.env['ATRIB_OPERATING_BODY_TOKEN'] }
      : {}),
    ...(process.env['ATRIB_OPERATING_ARCHIVE_URL']
      ? { archiveUrl: process.env['ATRIB_OPERATING_ARCHIVE_URL'] }
      : {}),
    ...(process.env['ATRIB_OPERATING_ARCHIVE_TOKEN']
      ? { archiveToken: process.env['ATRIB_OPERATING_ARCHIVE_TOKEN'] }
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

function hasBearerAuthorization(request: IncomingMessage, expected: string): boolean {
  const supplied = request.headers.authorization
  if (!supplied?.startsWith('Bearer ')) return false
  const suppliedBytes = Buffer.from(supplied.slice('Bearer '.length))
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

function requireBodyAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  config: ServerConfig,
): boolean {
  if (!config.bodyReadToken) {
    json(response, 403, { error: 'body retrieval is disabled' })
    return false
  }
  if (hasBearerAuthorization(request, config.bodyReadToken)) return true
  json(
    response,
    401,
    { error: 'body retrieval authorization required' },
    { 'WWW-Authenticate': 'Bearer realm="atrib-operating-body"' },
  )
  return false
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
  const archiveBaseUrl = config.archiveUrl ? parseArchiveBaseUrl(config.archiveUrl) : undefined
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
          body_retrieval: config.bodyReadToken ? 'bearer' : 'disabled',
          archive_retrieval: config.archiveUrl ? 'configured' : 'disabled',
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
      const bodyMatch = url.pathname.match(/^\/v1\/body\/([0-9a-f]{64})$/)
      if (request.method === 'GET' && bodyMatch) {
        if (!requireBodyAuthorization(request, response, config)) return
        const recordHash = `sha256:${bodyMatch[1]!}`
        const local = await loadLocalRecordMaterial(config.mirrorPath, recordHash)
        if (local) {
          const opening = await buildLocalBodyOpening(local)
          if (Buffer.byteLength(JSON.stringify(opening)) > MAX_OPENING_RESPONSE_BYTES) {
            json(response, 413, { error: 'opening material exceeds 2 MB' })
            return
          }
          json(response, opening.integrity.signature_verified ? 200 : 409, opening)
          return
        }
        if (archiveBaseUrl) {
          let archived: Awaited<ReturnType<typeof fetchArchiveRecord>>
          try {
            archived = await fetchArchiveRecord(config, archiveBaseUrl, bodyMatch[1]!)
          } catch {
            json(response, 502, { error: 'archive retrieval failed' })
            return
          }
          if (archived) {
            const opening = await buildArchiveBodyOpening(archived)
            json(
              response,
              opening.integrity.record_hash_verified && opening.integrity.signature_verified
                ? 200
                : 409,
              opening,
            )
            return
          }
        }
        json(response, 404, { error: 'record body not available' })
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
        const cursorRelation = revisionRelation(lastEventId, snapshot.revision)
        if (cursorRelation === 'out_of_order') {
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
        if (cursorRelation !== 'duplicate') {
          response.write(
            `id: ${snapshot.revision}\nevent: gap\ndata: ${JSON.stringify({
              after_revision: lastEventId,
              current_revision: snapshot.revision,
            })}\n\n`,
          )
        }
        response.write(
          `id: ${snapshot.revision}\nevent: ready\ndata: ${JSON.stringify({
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
      process.stderr.write(`atrib operating graph request failed: ${String(error)}\n`)
      json(response, 400, { error: 'invalid request' })
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

async function fetchArchiveRecord(
  config: ServerConfig,
  archiveBaseUrl: URL,
  hashHex: string,
): Promise<{
  record_hash: string
  record: AtribRecord
  log_proofs?: import('@atrib/mcp').ProofBundle[]
  archived_at_ms?: number
  retention_window_ms?: number
} | null> {
  const endpoint = new URL(`record/${hashHex}`, archiveBaseUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  try {
    // The operator owns the validated base URL. Request input supplies only a 64-character lowercase hex path segment.

    // codeql[js/request-forgery]
    const response = await fetch(endpoint, {
      signal: controller.signal,
      redirect: 'error',
      ...(config.archiveToken
        ? { headers: { Authorization: `Bearer ${config.archiveToken}` } }
        : {}),
    })
    if (response.status === 404 || response.status === 410) return null
    if (!response.ok) throw new Error(`archive returned HTTP ${response.status}`)
    const body = (await response.json()) as Record<string, unknown>
    if (!isAtribRecord(body['record'])) throw new Error('archive response has no signed record')
    const record = body['record']
    const computed = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
    const expected = `sha256:${hashHex}`
    if (computed !== expected || body['record_hash'] !== expected) {
      throw new Error('archive record hash mismatch')
    }
    if (!(await verifyRecord(record).catch(() => false))) {
      throw new Error('archive record signature invalid')
    }
    return {
      record_hash: expected,
      record,
      ...(Array.isArray(body['log_proofs'])
        ? { log_proofs: body['log_proofs'] as import('@atrib/mcp').ProofBundle[] }
        : {}),
      ...(typeof body['archived_at_ms'] === 'number'
        ? { archived_at_ms: body['archived_at_ms'] }
        : {}),
      ...(typeof body['retention_window_ms'] === 'number'
        ? { retention_window_ms: body['retention_window_ms'] }
        : {}),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function parseArchiveBaseUrl(value: string): URL {
  const base = new URL(value)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error('archive URL must use HTTP or HTTPS')
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('archive URL must not contain credentials, query parameters, or a fragment')
  }
  if (base.protocol === 'http:' && !isLoopbackHost(base.hostname)) {
    throw new Error('unencrypted archive URLs are allowed only for loopback hosts')
  }
  if (!base.pathname.endsWith('/')) base.pathname = `${base.pathname}/`
  return base
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function isAtribRecord(value: unknown): value is AtribRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)['spec_version'] === 'atrib/1.0' &&
    typeof (value as Record<string, unknown>)['signature'] === 'string'
  )
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
