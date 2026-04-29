// SPDX-License-Identifier: Apache-2.0

/**
 * Graph query service HTTP server (section 3.4).
 *
 * Serves 4 REST endpoints + 1 ingestion endpoint:
 *   GET  /v1/graph/:context_id                Full graph
 *   GET  /v1/graph/:context_id/nodes          Nodes only
 *   GET  /v1/graph/:context_id/transaction    Transaction node
 *   GET  /v1/creators/:creator_key/sessions   Creator sessions
 *   POST /v1/ingest                           Record ingestion
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { validateSubmission, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { buildGraph } from './graph-builder.js'
import { createRecordStore, type RecordStore } from './store.js'

export interface GraphServerHandle {
  url: string
  store: RecordStore
  close(): Promise<void>
}

const CONTEXT_ID_RE = /^[0-9a-f]{32}$/

export async function bindGraphServer(
  port: number,
  host?: string,
): Promise<GraphServerHandle> {
  const store = createRecordStore()

  const server = createServer((req, res) => {
    // CORS for browser-based dashboards (D054). Read endpoints serve public data per spec §3;
    // browser cross-origin reads are explicitly permitted.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    handleRequest(req, res, store).catch((err) => {
      console.error('graph-node: request handler crashed', err)
      if (!res.headersSent) {
        sendProblem(res, 500, 'internal-error', 'Internal server error', '')
      }
    })
  })

  const bindHost = host ?? '127.0.0.1'
  await new Promise<void>((resolve) => {
    server.listen(port, bindHost, resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('graph-node: server.address() returned unexpected shape')
  }
  const url = `http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${address.port}`

  return {
    url,
    store,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: RecordStore,
): Promise<void> {
  const url = req.url ?? ''
  const method = req.method ?? ''

  // POST /v1/ingest
  if (method === 'POST' && url === '/v1/ingest') {
    return handleIngest(req, res, store)
  }

  // GET /v1/graph/:context_id/transaction
  const txMatch = url.match(/^\/v1\/graph\/([0-9a-f]{32})\/transaction$/)
  if (method === 'GET' && txMatch) {
    return handleTransaction(res, store, txMatch[1]!)
  }

  // GET /v1/graph/:context_id/nodes
  const nodesMatch = url.match(/^\/v1\/graph\/([0-9a-f]{32})\/nodes(\?.*)?$/)
  if (method === 'GET' && nodesMatch) {
    return handleNodes(res, store, nodesMatch[1]!, new URL(`http://localhost${url}`).searchParams)
  }

  // GET /v1/graph/:context_id
  const graphMatch = url.match(/^\/v1\/graph\/([0-9a-f]{32})(\?.*)?$/)
  if (method === 'GET' && graphMatch) {
    return handleGraph(res, store, graphMatch[1]!, new URL(`http://localhost${url}`).searchParams)
  }

  // GET /v1/creators/:creator_key/sessions
  const creatorsMatch = url.match(/^\/v1\/creators\/([^/]+)\/sessions(\?.*)?$/)
  if (method === 'GET' && creatorsMatch) {
    return handleCreatorSessions(res, store, decodeURIComponent(creatorsMatch[1]!), new URL(`http://localhost${url}`).searchParams)
  }

  // Malformed context_id check
  const badGraphMatch = url.match(/^\/v1\/graph\/([^/]+)/)
  if (method === 'GET' && badGraphMatch && !CONTEXT_ID_RE.test(badGraphMatch[1]!)) {
    return sendProblem(res, 400, 'invalid-context-id', 'Invalid context_id', url)
  }

  sendJson(res, 404, { error: 'not found' })
}

async function handleGraph(
  res: ServerResponse,
  store: RecordStore,
  contextId: string,
  params: URLSearchParams,
): Promise<void> {
  if (!store.hasContext(contextId)) {
    return sendProblem(res, 404, 'session-not-found', `No attribution records found for context_id ${contextId}`, `/v1/graph/${contextId}`)
  }

  const records = store.getRecordsByContextId(contextId)
  const gapNodes = store.getGapNodesByContextId(contextId)
  const graph = await buildGraph(records, gapNodes, {
    includeGapNodes: params.get('include_gap_nodes') !== 'false',
    includeCrossSession: params.get('include_cross_session') !== 'false',
  })

  sendJson(res, 200, graph)
}

async function handleNodes(
  res: ServerResponse,
  store: RecordStore,
  contextId: string,
  params: URLSearchParams,
): Promise<void> {
  if (!store.hasContext(contextId)) {
    return sendProblem(res, 404, 'session-not-found', `No attribution records found for context_id ${contextId}`, `/v1/graph/${contextId}/nodes`)
  }

  const records = store.getRecordsByContextId(contextId)
  const gapNodes = store.getGapNodesByContextId(contextId)
  const graph = await buildGraph(records, gapNodes)

  let nodes = graph.nodes

  const eventTypeFilter = params.get('event_type')
  if (eventTypeFilter) {
    // Accept both atrib normative URI form and the short-label form for
    // backward-compatible queries. Anything else is treated as an opaque URI
    // and matched against the node's event_type_uri (extension-typed nodes).
    const normalized =
      eventTypeFilter === 'https://atrib.dev/v1/types/tool_call'
        ? 'tool_call'
        : eventTypeFilter === 'https://atrib.dev/v1/types/transaction'
          ? 'transaction'
          : eventTypeFilter === 'https://atrib.dev/v1/types/observation'
            ? 'observation'
            : eventTypeFilter
    nodes = nodes.filter(
      (n) => n.event_type === normalized || n.event_type_uri === eventTypeFilter,
    )
  }
  const creatorKeyFilter = params.get('creator_key')
  if (creatorKeyFilter) {
    nodes = nodes.filter((n) => n.creator_key === creatorKeyFilter)
  }
  const vsFilter = params.get('verification_state')
  if (vsFilter) {
    nodes = nodes.filter((n) => n.verification_state === vsFilter)
  }

  sendJson(res, 200, { nodes })
}

async function handleTransaction(
  res: ServerResponse,
  store: RecordStore,
  contextId: string,
): Promise<void> {
  if (!store.hasContext(contextId)) {
    return sendProblem(res, 404, 'session-not-found', `No records for context_id ${contextId}`, `/v1/graph/${contextId}/transaction`)
  }

  const records = store.getRecordsByContextId(contextId)
  const graph = await buildGraph(records, [])
  const txNode = graph.nodes.find((n) => n.event_type === 'transaction')

  if (!txNode) {
    return sendProblem(res, 404, 'session-not-found', 'Session exists but no transaction record present', `/v1/graph/${contextId}/transaction`)
  }

  sendJson(res, 200, txNode)
}

function handleCreatorSessions(
  res: ServerResponse,
  store: RecordStore,
  creatorKey: string,
  params: URLSearchParams,
): void {
  const sessions = store.getSessionsByCreatorKey(creatorKey)
  const rawLimit = parseInt(params.get('limit') ?? '50', 10)
  const limit = Math.min(Number.isNaN(rawLimit) ? 50 : rawLimit, 200)

  let filtered = sessions
  const hasTx = params.get('has_transaction')
  if (hasTx === 'true') filtered = filtered.filter((s) => s.has_transaction)
  if (hasTx === 'false') filtered = filtered.filter((s) => !s.has_transaction)

  const paginated = filtered.slice(0, limit)

  sendJson(res, 200, {
    sessions: paginated,
    next_cursor: paginated.length < filtered.length ? 'next' : null,
  })
}

async function handleIngest(
  req: IncomingMessage,
  res: ServerResponse,
  store: RecordStore,
): Promise<void> {
  let body: string
  try {
    body = await readBody(req)
  } catch {
    return sendProblem(res, 413, 'body-too-large', 'Request body too large', '/v1/ingest')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return sendProblem(res, 400, 'invalid-json', 'Invalid JSON body', '/v1/ingest')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return sendProblem(res, 400, 'invalid-body', 'Body must be a JSON object', '/v1/ingest')
  }

  const record = parsed as AtribRecord
  const validation = validateSubmission(record)
  if (!validation.ok) {
    return sendProblem(res, 400, 'validation-failed', validation.error ?? 'Validation failed', '/v1/ingest')
  }

  const valid = await verifyRecord(record)
  if (!valid) {
    return sendProblem(res, 400, 'signature-invalid', 'Ed25519 signature verification failed', '/v1/ingest')
  }

  store.addRecord(record)
  sendJson(res, 200, { ok: true })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('content-length', Buffer.byteLength(json))
  res.end(json)
}

function sendProblem(
  res: ServerResponse,
  status: number,
  type: string,
  detail: string,
  instance: string,
): void {
  const body = {
    type: `https://atrib.dev/problems/${type}`,
    title: type.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
    status,
    detail,
    instance,
  }
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/problem+json')
  res.setHeader('content-length', Buffer.byteLength(json))
  res.end(json)
}

const MAX_BODY_BYTES = 64 * 1024

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      throw new Error('body too large')
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}
