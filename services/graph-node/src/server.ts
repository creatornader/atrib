// SPDX-License-Identifier: Apache-2.0

/**
 * Graph query service HTTP server (section 3.4).
 *
 * Serves 6 read endpoints + 1 ingestion endpoint:
 *   GET  /v1/graph/:context_id                Full graph
 *   GET  /v1/graph/:context_id/nodes          Nodes only
 *   GET  /v1/graph/:context_id/transaction    Transaction node
 *   GET  /v1/creators/:creator_key/sessions   Creator sessions (existing list)
 *   GET  /v1/creators/:creator_key/graph      Activity-map graph: composes records across context_ids
 *                                             for one creator into nodes + cross-session edges within
 *                                             a time window
 *   GET  /v1/trace/:record_hash               Provenance trace: backward walk via INFORMED_BY +
 *                                             PROVENANCE_OF (and optionally ANNOTATES + REVISES) from
 *                                             the starting record, returning the ancestor subgraph
 *   POST /v1/ingest                           Record ingestion
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { validateSubmission, verifyRecord, canonicalRecord, sha256, hexEncode } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { buildGraph } from './graph-builder.js'
import { createRecordStore, type RecordStore } from './store.js'
import { buildRevocationRegistry, graphLabelFromEventTypeUri } from '@atrib/verify'
import type { MinimalRecord } from '@atrib/verify'

// Normalize an event_type query parameter to the short label form used by
// graph-node nodes. Atrib normative URIs map via graphLabelFromEventTypeUri;
// extension URIs and short labels pass through unchanged so the caller can
// compare against either node.event_type (short label) or node.event_type_uri.
//
// Without this, queries like ?event_type=https://atrib.dev/v1/types/annotation
// silently returned zero results because the prior inline normalizer in
// handleNodes only covered tool_call / transaction / observation, missing
// directory_anchor (D056), annotation (D058), and revision (D059). Refactored
// to a shared helper to prevent recurrence of this drift on new endpoints.
function normalizeEventTypeFilter(filter: string): string {
  if (filter.startsWith('https://atrib.dev/v1/types/')) {
    return graphLabelFromEventTypeUri(filter)
  }
  return filter
}

interface ParsedTimeWindow {
  since: number | null
  until: number | null
  error: string | null
}

function parseTimeWindow(params: URLSearchParams): ParsedTimeWindow {
  const sinceRaw = params.get('since')
  const untilRaw = params.get('until')
  const since = sinceRaw === null ? null : Number(sinceRaw)
  const until = untilRaw === null ? null : Number(untilRaw)
  if (sinceRaw !== null && !Number.isFinite(since)) {
    return { since: null, until: null, error: '`since` must be a unix timestamp in milliseconds' }
  }
  if (untilRaw !== null && !Number.isFinite(until)) {
    return { since: null, until: null, error: '`until` must be a unix timestamp in milliseconds' }
  }
  if (since !== null && until !== null && since > until) {
    return { since: null, until: null, error: '`since` must be less than or equal to `until`' }
  }
  return { since, until, error: null }
}

export interface GraphServerHandle {
  url: string
  store: RecordStore
  close(): Promise<void>
}

export interface BindOptions {
  /**
   * Pre-existing store to bind to. When omitted, bindGraphServer creates
   * a fresh in-memory store. Callers that want to replay a durable archive
   * before accepting traffic create the store, replay into it, then pass
   * it here so the server inherits the rebuilt state.
   */
  store?: RecordStore

  /**
   * Optional hook invoked AFTER each successful /v1/ingest (post
   * validateSubmission + verifyRecord + store.addRecord). Used by
   * persistence.ts to mirror every accepted record to disk.
   *
   * Hook errors are logged but do not fail the ingest response, graph-node
   * is the source of truth for in-memory query state, the archive is a
   * recovery aid. A failed disk write means the next OOM loses that record;
   * the producer-local mirror file remains the ultimate fallback (Layer 3).
   */
  onRecordIngested?: (record: AtribRecord, logIndex: number | undefined) => void | Promise<void>
}

const CONTEXT_ID_RE = /^[0-9a-f]{32}$/

export async function bindGraphServer(
  port: number,
  host?: string,
  opts: BindOptions = {},
): Promise<GraphServerHandle> {
  const store = opts.store ?? createRecordStore()
  const onRecordIngested = opts.onRecordIngested

  const server = createServer((req, res) => {
    // CORS for browser-based dashboards (D054). Read endpoints serve public data per spec §3;
    // browser cross-origin reads are explicitly permitted.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type, x-atrib-log-index')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    handleRequest(req, res, store, onRecordIngested).catch((err) => {
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
  onRecordIngested?: (record: AtribRecord, logIndex: number | undefined) => void | Promise<void>,
): Promise<void> {
  const url = req.url ?? ''
  const method = req.method ?? ''

  // POST /v1/ingest
  if (method === 'POST' && url === '/v1/ingest') {
    return handleIngest(req, res, store, onRecordIngested)
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

  // GET /v1/creators/:creator_key/graph
  const creatorGraphMatch = url.match(/^\/v1\/creators\/([^/]+)\/graph(\?.*)?$/)
  if (method === 'GET' && creatorGraphMatch) {
    return handleCreatorGraph(
      res,
      store,
      decodeURIComponent(creatorGraphMatch[1]!),
      new URL(`http://localhost${url}`).searchParams,
    )
  }

  // GET /v1/trace/:record_hash
  // Accept both raw hex (64 chars) and the prefixed "sha256:<hex>" form. The
  // record store keys by raw hex (canonicalRecord -> sha256 -> hexEncode); the
  // dashboard URL convention uses the prefixed form. Normalize on the way in.
  const traceMatch = url.match(/^\/v1\/trace\/(?:sha256:)?([0-9a-f]{64})(\?.*)?$/)
  if (method === 'GET' && traceMatch) {
    return handleTrace(res, store, traceMatch[1]!, new URL(`http://localhost${url}`).searchParams)
  }

  // GET /v1/chain/:record_hash, substrate-derived causal chain walk per
  // spec §3.4.6 / D068. Walks CHAIN_PRECEDES backward from the starting
  // record, terminating at the session genesis (chain_root = SHA-256(context_id)).
  // Disjoint from /v1/trace which walks producer-claimed ancestry.
  const chainMatch = url.match(/^\/v1\/chain\/(?:sha256:)?([0-9a-f]{64})(\?.*)?$/)
  if (method === 'GET' && chainMatch) {
    return handleChain(res, store, chainMatch[1]!, new URL(`http://localhost${url}`).searchParams)
  }

  // Malformed context_id check
  const badGraphMatch = url.match(/^\/v1\/graph\/([^/]+)/)
  if (method === 'GET' && badGraphMatch && !CONTEXT_ID_RE.test(badGraphMatch[1]!)) {
    return sendProblem(res, 400, 'invalid-context-id', 'Invalid context_id', url)
  }

  sendJson(res, 404, { error: 'not found' })
}

/**
 * Build a §1.9 revocation registry from every record the store has seen.
 * key_revocation records can affect any session (a key revoked in one
 * session retires it for ALL sessions), so the scan must be global.
 */
function buildRegistry(store: RecordStore): ReturnType<typeof buildRevocationRegistry> {
  const all = store.getAllRecords()
  // The store holds AtribRecord objects, but key_revocation records
  // carry extra fields (revoked_key, revocation_reason, successor_key,
  // emergency_signed_by) that aren't on the standard AtribRecord type.
  // Cast to MinimalRecord shape for registry building.
  const minimal: MinimalRecord[] = all.map(({ record, log_index }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = record as any
    return {
      event_type_uri: r.event_type ?? null,
      creator_key: r.creator_key ?? null,
      log_index,
      revoked_key: r.revoked_key,
      revocation_reason: r.revocation_reason,
      successor_key: r.successor_key,
      emergency_signed_by: r.emergency_signed_by,
    }
  })
  return buildRevocationRegistry(minimal)
}

function logIndexLookup(store: RecordStore): (hashHex: string) => number | null {
  return (hashHex: string) => store.getLogIndex(hashHex)
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
    revocations: buildRegistry(store),
    logIndexLookup: logIndexLookup(store),
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
  const graph = await buildGraph(records, gapNodes, {
    revocations: buildRegistry(store),
    logIndexLookup: logIndexLookup(store),
  })

  let nodes = graph.nodes

  const eventTypeFilter = params.get('event_type')
  if (eventTypeFilter) {
    const normalized = normalizeEventTypeFilter(eventTypeFilter)
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
  const graph = await buildGraph(records, [], {
    revocations: buildRegistry(store),
    logIndexLookup: logIndexLookup(store),
  })
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

// Limits chosen to keep response payloads bounded. The activity-map view
// renders a force-directed graph in the browser; per-page caps trade
// recency-window vs render budget.
const ACTIVITY_MAP_DEFAULT_LIMIT = 500
const ACTIVITY_MAP_MAX_LIMIT = 2000

async function handleCreatorGraph(
  res: ServerResponse,
  store: RecordStore,
  creatorKey: string,
  params: URLSearchParams,
): Promise<void> {
  const window = parseTimeWindow(params)
  if (window.error) {
    return sendProblem(res, 400, 'invalid-time-window', window.error, `/v1/creators/${creatorKey}/graph`)
  }
  const rawLimit = parseInt(params.get('limit') ?? String(ACTIVITY_MAP_DEFAULT_LIMIT), 10)
  const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? ACTIVITY_MAP_DEFAULT_LIMIT : rawLimit, ACTIVITY_MAP_MAX_LIMIT))

  // Pull every record this creator signed across all sessions, then apply the
  // time window. The store already indexes by creator_key → context_ids; we
  // walk those.
  const sessions = store.getSessionsByCreatorKey(creatorKey)
  if (sessions.length === 0) {
    return sendProblem(
      res,
      404,
      'creator-not-found',
      `No records found for creator_key ${creatorKey}`,
      `/v1/creators/${creatorKey}/graph`,
    )
  }

  const allRecords: AtribRecord[] = []
  for (const s of sessions) {
    for (const r of store.getRecordsByContextId(s.context_id)) {
      if (r.creator_key !== creatorKey) continue
      if (window.since !== null && r.timestamp < window.since) continue
      if (window.until !== null && r.timestamp > window.until) continue
      allRecords.push(r)
    }
  }

  // Sort newest-first so a small `limit` retains the most recent activity.
  allRecords.sort((a, b) => b.timestamp - a.timestamp)
  const windowedRecords = allRecords.slice(0, limit)

  const eventTypeFilter = params.get('event_type')
  const filteredRecords = eventTypeFilter
    ? windowedRecords.filter((r) => {
        const normalized = normalizeEventTypeFilter(eventTypeFilter)
        const recordLabel = r.event_type.startsWith('https://atrib.dev/v1/types/')
          ? graphLabelFromEventTypeUri(r.event_type)
          : r.event_type
        return recordLabel === normalized || r.event_type === eventTypeFilter
      })
    : windowedRecords

  // Build the graph from the windowed record set. buildGraph handles edge
  // derivation across context_ids when CROSS_SESSION + INFORMED_BY +
  // PROVENANCE_OF data is present (§3.2.4 steps 5-7), so the activity-map
  // composition falls out of the existing derivation.
  const graph = await buildGraph(filteredRecords, [], {
    includeGapNodes: false,
    includeCrossSession: true,
    revocations: buildRegistry(store),
    logIndexLookup: logIndexLookup(store),
  })

  sendJson(res, 200, {
    creator_key: creatorKey,
    window: { since: window.since, until: window.until, limit },
    record_count: filteredRecords.length,
    truncated: allRecords.length > limit,
    graph,
  })
}

// Limits for backward provenance walk. Trace depth is bounded both by edge
// hops and total ancestor count so a degenerate fan-out doesn't return a
// multi-megabyte payload.
const TRACE_DEFAULT_DEPTH = 5
const TRACE_MAX_DEPTH = 20
const TRACE_MAX_NODES = 500

async function handleTrace(
  res: ServerResponse,
  store: RecordStore,
  recordHashHex: string,
  params: URLSearchParams,
): Promise<void> {
  const rawDepth = parseInt(params.get('depth') ?? String(TRACE_DEFAULT_DEPTH), 10)
  const depth = Math.max(1, Math.min(Number.isNaN(rawDepth) ? TRACE_DEFAULT_DEPTH : rawDepth, TRACE_MAX_DEPTH))
  // include_annotations: include ANNOTATES targets in the walk (default true:
  // annotations point at records the agent commented on, so they're part of
  // the cognitive provenance even though §3.2.4 derives them as forward edges
  // from annotation→target). Same for revisions.
  const includeAnnotations = params.get('include_annotations') !== 'false'
  const includeRevisions = params.get('include_revisions') !== 'false'

  // Index every record by its record_hash (canonicalRecord -> sha256 -> hex)
  // so we can walk by hash. The store doesn't expose this index directly;
  // build it here once per request. For a busy log this would move into the
  // store, but at current scale (low thousands of records) the per-request
  // build is fast enough.
  const allRecords = store.getAllRecords()
  const byHash = new Map<string, AtribRecord>()
  for (const { record } of allRecords) {
    const hashHex = hexEncode(sha256(canonicalRecord(record)))
    byHash.set(hashHex, record)
  }

  const startRecord = byHash.get(recordHashHex)
  if (!startRecord) {
    return sendProblem(
      res,
      404,
      'record-not-found',
      `No record with hash sha256:${recordHashHex}`,
      `/v1/trace/${recordHashHex}`,
    )
  }

  // BFS backward from start. At each step, collect the record's ancestors:
  //   - informed_by[] entries (sha256:<hex> strings)
  //   - provenance_token (genesis-only; truncated 16-byte ref)
  //   - annotates (if include_annotations and event_type=annotation)
  //   - revises (if include_revisions and event_type=revision)
  // For each resolved ancestor, recurse one hop deeper (up to `depth`). Track
  // visited hashes to prevent cycles (records are immutable, so a cycle would
  // indicate a malformed chain, defensive).
  const visited = new Set<string>([recordHashHex])
  const collected: AtribRecord[] = [startRecord]
  let frontier: string[] = [recordHashHex]
  let truncatedByDepth = false
  let truncatedByCount = false

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = []
    for (const hash of frontier) {
      const record = byHash.get(hash)
      if (!record) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = record as any

      const candidates: string[] = []
      if (Array.isArray(r.informed_by)) {
        for (const ref of r.informed_by) {
          if (typeof ref === 'string' && ref.startsWith('sha256:')) {
            candidates.push(ref.slice('sha256:'.length))
          }
        }
      }
      if (typeof r.annotates === 'string' && includeAnnotations && r.annotates.startsWith('sha256:')) {
        candidates.push(r.annotates.slice('sha256:'.length))
      }
      if (typeof r.revises === 'string' && includeRevisions && r.revises.startsWith('sha256:')) {
        candidates.push(r.revises.slice('sha256:'.length))
      }
      // provenance_token is the truncated-16-byte form per §1.2.6; we cannot
      // resolve it back to a full record_hash without scanning. Skip from the
      // walk but include in the response for downstream UI to display.

      for (const ancestorHash of candidates) {
        if (visited.has(ancestorHash)) continue
        visited.add(ancestorHash)
        const ancestor = byHash.get(ancestorHash)
        if (ancestor) {
          collected.push(ancestor)
          next.push(ancestorHash)
        }
        // If the ancestor is dangling (not in the store), still mark visited
        // so we don't try to resolve it again. The graph layer's dangling-
        // node mechanism (§3.2.4 step 6) will surface the unresolved ref.
        if (collected.length >= TRACE_MAX_NODES) {
          truncatedByCount = true
          break
        }
      }
      if (collected.length >= TRACE_MAX_NODES) break
    }
    if (collected.length >= TRACE_MAX_NODES) break
    if (next.length === 0) break
    frontier = next
    if (hop === depth - 1 && next.length > 0) {
      // We hit the depth ceiling but still had ancestors to walk; flag for
      // the caller so the dashboard can render a "depth truncated" affordance.
      truncatedByDepth = true
    }
  }

  // Build the graph from the collected ancestor set. This produces the same
  // node/edge shape as /v1/graph/:context_id, but the node set is restricted
  // to the trace ancestors rather than a single context_id.
  const graph = await buildGraph(collected, [], {
    includeGapNodes: false,
    includeCrossSession: true,
    revocations: buildRegistry(store),
    logIndexLookup: logIndexLookup(store),
  })

  sendJson(res, 200, {
    start_record_hash: `sha256:${recordHashHex}`,
    depth_requested: depth,
    depth_walked: depth - (truncatedByDepth ? 0 : 0),
    record_count: collected.length,
    truncated_by_depth: truncatedByDepth,
    truncated_by_count: truncatedByCount,
    graph,
  })
}

// /v1/chain/:record_hash, substrate-derived causal chain walk per §3.4.6.
// Walks CHAIN_PRECEDES backward from the starting record, resolving each step
// via record.chain_root (which carries the prior record's hex hash, prefixed
// with "sha256:"). Terminates at the session's genesis record where chain_root
// equals SHA-256(context_id) per §1.2.3. The walk is linear (each non-genesis
// record has exactly one chain_precedes ancestor) so truncation is depth-only.
async function handleChain(
  res: ServerResponse,
  store: RecordStore,
  recordHashHex: string,
  params: URLSearchParams,
): Promise<void> {
  const rawDepth = parseInt(params.get('depth') ?? String(TRACE_DEFAULT_DEPTH), 10)
  const depth = Math.max(1, Math.min(Number.isNaN(rawDepth) ? TRACE_DEFAULT_DEPTH : rawDepth, TRACE_MAX_DEPTH))

  // Build a hash index once per request so we can resolve chain_root references
  // back to records. Mirrors handleTrace's approach.
  const allRecords = store.getAllRecords()
  const byHash = new Map<string, AtribRecord>()
  for (const { record } of allRecords) {
    const hashHex = hexEncode(sha256(canonicalRecord(record)))
    byHash.set(hashHex, record)
  }

  const startRecord = byHash.get(recordHashHex)
  if (!startRecord) {
    return sendProblem(
      res,
      404,
      'record-not-found',
      `No record with hash sha256:${recordHashHex}`,
      `/v1/chain/${recordHashHex}`,
    )
  }

  const collected: AtribRecord[] = [startRecord]
  const visited = new Set<string>([recordHashHex])
  let truncatedByDepth = false
  let current: AtribRecord = startRecord

  for (let hop = 0; hop < depth; hop++) {
    // Genesis termination: chain_root === SHA-256(context_id). At genesis the
    // record has no further predecessor; the walk completes naturally.
    const expectedGenesis = `sha256:${hexEncode(sha256(new TextEncoder().encode(current.context_id)))}`
    if (current.chain_root === expectedGenesis) break

    if (!current.chain_root.startsWith('sha256:')) break
    const ancestorHash = current.chain_root.slice('sha256:'.length)
    if (visited.has(ancestorHash)) break
    visited.add(ancestorHash)

    const ancestor = byHash.get(ancestorHash)
    if (!ancestor) break // chain_root references a record outside the store
    collected.push(ancestor)
    current = ancestor

    if (hop === depth - 1) {
      // Hit the depth ceiling but the chain may extend further, flag for
      // the caller so the dashboard can offer "load more" affordance.
      const nextGenesis = `sha256:${hexEncode(sha256(new TextEncoder().encode(current.context_id)))}`
      if (current.chain_root !== nextGenesis) truncatedByDepth = true
    }
  }

  const graph = await buildGraph(collected, [], {
    includeGapNodes: false,
    includeCrossSession: false,
    revocations: buildRegistry(store),
    logIndexLookup: logIndexLookup(store),
  })

  sendJson(res, 200, {
    start_record_hash: `sha256:${recordHashHex}`,
    depth_requested: depth,
    record_count: collected.length,
    truncated_by_depth: truncatedByDepth,
    truncated_by_count: false, // linear walk; count truncation unreachable
    graph,
  })
}

async function handleIngest(
  req: IncomingMessage,
  res: ServerResponse,
  store: RecordStore,
  onRecordIngested?: (record: AtribRecord, logIndex: number | undefined) => void | Promise<void>,
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

  // x-atrib-log-index: optional, advisory. log-node sends it on fanout
  // (POST /v1/ingest). When present, graph-node uses it to apply
  // revocation logic per §1.9.3. When absent, the record's log_index
  // is null and revocation cannot be applied to records signed by
  // this creator_key.
  const headerIdx = req.headers['x-atrib-log-index']
  let logIndex: number | undefined
  if (typeof headerIdx === 'string' && /^\d+$/.test(headerIdx)) {
    logIndex = parseInt(headerIdx, 10)
  }
  store.addRecord(record, logIndex)

  // Persistence hook (optional). The archive append is best-effort: a
  // failure here means the record stays in the in-memory store but won't
  // survive a restart. Logged but not surfaced to the caller, log-node's
  // fanout retries on 5xx, and the producer-local mirror remains the ultimate
  // recovery source. Awaiting the hook serializes appends per ingest, which
  // is what we want (the order the in-memory store accepted records is the
  // order they're durably recorded).
  if (onRecordIngested) {
    try {
      await onRecordIngested(record, logIndex)
    } catch (err) {
      console.error('graph-node: persistence hook failed', err)
    }
  }

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
