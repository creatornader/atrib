// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP server for @atrib/log-node. production log with real Merkle proofs.
 *
 * Endpoints:
 *   POST /v1/entries    . submit a signed attribution record
 *   GET  /v1/checkpoint . return the latest signed checkpoint as text/plain
 *
 * Validation follows §2.6.1 Steps 1-6.
 *
 * All hashes in the JSON response are standard base64 (RFC 4648 §4, with
 * padding), matching the tlog-tiles checkpoint format.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalRecord, validateSubmission, verifyRecord, hexEncode, nodeHash, base64urlEncode } from '@atrib/mcp'
import type { AtribRecord, ProofBundle } from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'
import { serializeEntry } from './entry.js'

const TILE_SIZE = 256 // hashes per tile (C2SP tlog-tiles standard)
import type { MerkleTree } from './tree.js'
import type { CheckpointSigner } from './checkpoint.js'
import { formatVkey } from './checkpoint.js'

export interface ServerHandle {
  url: string
  close(): Promise<void>
}

const MAX_PROOF_CACHE = 100_000 // entries; ~30MB at ~300 bytes/entry

/**
 * Bind an HTTP server that handles POST /v1/entries and GET /v1/checkpoint.
 */
export async function bindServer(
  tree: MerkleTree,
  signer: CheckpointSigner,
  port: number,
  host?: string,
  graphFanoutEndpoint?: string,
): Promise<ServerHandle> {
  // Serialization lock: the append→proof→sign sequence must not be
  // interleaved by concurrent requests, because signer.sign is async
  // (ed.signAsync) and yields the event loop. Without this, concurrent
  // submissions produce proof bundles where the checkpoint tree size
  // doesn't match the tree size the inclusion proof was computed against.
  let submitQueue = Promise.resolve<void>(undefined)

  // Dedup cache: record_hash hex → proof bundle
  // Bounded to MAX_PROOF_CACHE entries (~30MB at ~300 bytes/entry).
  // NOTE: Idempotency is best-effort. After cache eviction, re-submission
  // of the same record will append a new entry with a different log_index
  // and a fresh proof. Both proofs are independently valid. The spec allows
  // this: §2.6.1 Step 6 says "return the existing inclusion proof" as a
  // SHOULD, not a MUST, for implementations with bounded caches.
  const proofCache = new Map<string, ProofBundle>()

  // Acquire the submit lock: waits for previous submission to finish,
  // returns a release function. This serializes the append→proof→sign
  // critical section so concurrent requests don't interleave.
  function acquireSubmitLock(): { wait: Promise<void>; release: () => void } {
    const prev = submitQueue
    let release!: () => void
    submitQueue = new Promise<void>((r) => { release = r })
    return { wait: prev, release }
  }

  const server = createServer((req, res) => {
    // CORS for browser-based dashboards (D054). All log read endpoints serve public data
    // per spec §0; browser cross-origin reads are explicitly permitted.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type, x-atrib-priority')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    handleRequest(req, res, tree, signer, proofCache, acquireSubmitLock, graphFanoutEndpoint).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('atrib-log-node: request handler crashed', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'internal error' }))
      }
    })
  })

  // Protect against Slowloris and slow-request DoS attacks
  server.headersTimeout = 5_000 // 5 seconds to receive headers
  server.requestTimeout = 30_000 // 30 seconds for full request

  const bindHost = host ?? '127.0.0.1'
  await new Promise<void>((resolve) => {
    server.listen(port, bindHost, resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('atrib-log-node: server.address() returned unexpected shape')
  }
  const url = `http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${address.port}`

  return {
    url,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

type AcquireLock = () => { wait: Promise<void>; release: () => void }

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
  acquireLock: AcquireLock,
  graphFanoutEndpoint: string | undefined,
): Promise<void> {
  // D054: when accessed via the explore.atrib.dev hostname, serve the
  // dashboard HTML at the root path. log.atrib.dev keeps API behavior at /;
  // explore.atrib.dev gets the explorer at / so the URL is just the bare host.
  // Both hostnames still expose /dashboard for direct access.
  //
  // Strip query string before path equality so cache-bust suffixes like
  // /?v=2026-05-01 (commonly used to bypass browser/CDN caches) still hit
  // the dashboard route rather than falling through to a 404.
  const urlPath = (req.url ?? '').split('?')[0]
  if (
    req.method === 'GET' &&
    (urlPath === '/' || urlPath === '') &&
    req.headers.host?.startsWith('explore.atrib.dev')
  ) {
    return handleDashboard(res)
  }

  if (req.method === 'POST' && req.url === '/v1/entries') {
    return handleSubmit(req, res, tree, signer, proofCache, acquireLock, graphFanoutEndpoint)
  }

  // §1.8 / T8: the log is append-only by design. DELETE is rejected
  // explicitly with 405 and an Allow header so consumers don't mistake
  // silence for "this might work later." GDPR requests for record
  // removal cannot be served by the log; the immutable design is the
  // protocol's correctness property and is documented in ARCHITECTURE.md.
  if (req.method === 'DELETE' && req.url?.startsWith('/v1/entries')) {
    res.statusCode = 405
    res.setHeader('allow', 'POST')
    res.setHeader('content-type', 'application/problem+json')
    res.end(JSON.stringify({
      type: 'https://atrib.dev/problems/append-only',
      title: 'Method Not Allowed',
      status: 405,
      detail: 'The atrib log is append-only by design. Records cannot be deleted via the API. See ARCHITECTURE.md and §1.8.',
    }))
    return
  }

  if (req.method === 'GET' && req.url === '/v1/checkpoint') {
    return handleCheckpoint(res, tree, signer)
  }

  // GET /v1/pubkey, return the log's Ed25519 public key + key_id so verifiers
  // can check the C2SP signed-note signature on /v1/checkpoint without an
  // out-of-band trust root. Without this endpoint, third parties have no way
  // to verify the checkpoint signature and must trust the log on the root.
  if (req.method === 'GET' && req.url === '/v1/pubkey') {
    return handlePubkey(res, signer)
  }

  // GET /v1/log-pubkey, same key as /v1/pubkey but in C2SP signed-note vkey
  // format (text/plain). Spec §2.4.2 commits to this path; tools like
  // golang.org/x/mod/sumdb/note.NewVerifier consume vkey strings directly,
  // so we serve it canonically rather than forcing those tools to JSON-parse.
  if (req.method === 'GET' && req.url === '/v1/log-pubkey') {
    return handleLogPubkey(res, signer)
  }

  // GET /v1/stats, aggregate counters over the current tree. Non-normative
  // operator-visibility convenience: tree size, distinct creator_keys,
  // timestamp range, and a count by event_type byte. Reads existing tree
  // state in a single pass; not part of spec §2.5.
  if (req.method === 'GET' && req.url === '/v1/stats') {
    return handleStats(res, tree)
  }

  // GET /v1/recent, newest N decoded entries (default 20, max 100). Powers
  // the public explorer's activity feed. Non-normative operator-visibility
  // helper, parallel to /v1/stats; not part of spec §2.5.
  // ?offset=N skips the N most-recent entries, lets the dashboard paginate
  // backward via repeated calls without re-shaping the API.
  if (req.method === 'GET' && req.url?.startsWith('/v1/recent')) {
    const params = new URL(req.url, 'http://localhost').searchParams
    const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '20', 10) || 20, 1), 100)
    const offset = Math.max(parseInt(params.get('offset') ?? '0', 10) || 0, 0)
    return handleRecent(res, tree, limit, offset)
  }

  // GET /v1/lookup/<hex>, find an entry by its record_hash (32 bytes hex).
  // Returns the decoded entry. Linear scan; fine at current scale, indexed
  // lookup is a future optimization. Non-normative.
  const lookupMatch = req.url?.match(/^\/v1\/lookup\/([0-9a-fA-F]{64})$/)
  if (req.method === 'GET' && lookupMatch) {
    return handleLookup(res, tree, lookupMatch[1]!.toLowerCase())
  }

  // GET /v1/by-context/<hex>, list all entries for a context_id (16 bytes hex).
  // Returns entries newest-first. Linear scan; non-normative explorer convenience.
  // Lets the dashboard render a session view using log data alone when graph-node
  // is unreachable or hasn't ingested.
  const byContextMatch = req.url?.match(/^\/v1\/by-context\/([0-9a-fA-F]{32})$/)
  if (req.method === 'GET' && byContextMatch) {
    return handleByContext(res, tree, byContextMatch[1]!.toLowerCase())
  }

  // GET /v1/by-creator/<base64url>, list sessions for a creator_key (43 chars
  // base64url). Returns one entry per distinct context_id with node_count,
  // has_transaction, first_seen_ms. Mirrors the shape of graph-node's
  // /v1/creators/<key>/sessions so the dashboard can fall back transparently.
  const byCreatorMatch = req.url?.match(/^\/v1\/by-creator\/([A-Za-z0-9_-]{43})$/)
  if (req.method === 'GET' && byCreatorMatch) {
    return handleByCreator(res, tree, byCreatorMatch[1]!)
  }

  // §2.5.2: Tile endpoints. GET /v1/tile/<level>/<index>
  const tileMatch = req.url?.match(/^\/v1\/tile\/(\d+)\/(\d+)$/)
  if (req.method === 'GET' && tileMatch) {
    const level = parseInt(tileMatch[1]!, 10)
    const index = parseInt(tileMatch[2]!, 10)
    return handleTile(res, tree, level, index)
  }

  // §2.5.3: Entry bundle endpoint. GET /v1/tile/entries/<index>
  const entryMatch = req.url?.match(/^\/v1\/tile\/entries\/(\d+)$/)
  if (req.method === 'GET' && entryMatch) {
    const index = parseInt(entryMatch[1]!, 10)
    return handleEntryBundle(res, tree, index)
  }

  // D054: serve the public explorer (option 1) inline. The HTML lives at
  // apps/dashboard/index.html in the repo and is bundled into the image by
  // the Dockerfile. /dashboard, /dashboard/, /dashboard.html all alias.
  if (
    req.method === 'GET' &&
    (urlPath === '/dashboard' || urlPath === '/dashboard/' || urlPath === '/dashboard.html')
  ) {
    return handleDashboard(res)
  }

  // D054: dashboard static assets, favicon, apple-touch-icon, og image.
  // Bundled by the Dockerfile from apps/dashboard/static/. Served from both
  // explore.atrib.dev and log.atrib.dev so the HTML's <link> tags resolve
  // regardless of which hostname loads the explorer.
  if (req.method === 'GET' && req.url === '/favicon.ico') {
    return handleStaticAsset(res, 'icon.svg', 'image/svg+xml')
  }
  const staticMatch = req.url?.match(/^\/static\/([A-Za-z0-9._-]+)$/)
  if (req.method === 'GET' && staticMatch) {
    const name = staticMatch[1]!
    const contentType =
      name.endsWith('.svg') ? 'image/svg+xml' :
      name.endsWith('.png') ? 'image/png' :
      name.endsWith('.ico') ? 'image/x-icon' :
      'application/octet-stream'
    return handleStaticAsset(res, name, contentType)
  }

  sendJson(res, 404, {
    error: 'not found',
    hint: 'Available endpoints: POST /v1/entries, GET /v1/checkpoint, GET /v1/pubkey, GET /v1/log-pubkey, GET /v1/stats, GET /v1/recent, GET /v1/lookup/<hex>, GET /v1/by-context/<hex>, GET /v1/by-creator/<base64url>, GET /v1/tile/<L>/<N>, GET /v1/tile/entries/<N>, GET /dashboard, GET /static/<name>, GET /favicon.ico',
  })
}

/**
 * GET /v1/pubkey, expose the log's Ed25519 public key and 4-byte key_id.
 *
 * Returned shape:
 *   {
 *     "origin": "log.atrib.dev/v1",
 *     "public_key": "<base64url 32B>",   // raw Ed25519 public key
 *     "key_id": "<hex 4B>",              // SHA-256(origin || 0x0A || 0x01 || pubkey)[:4]
 *     "algorithm": "Ed25519"
 *   }
 *
 * The key_id is what appears as the leading hex prefix in the signed-note
 * signature line, allowing a verifier to confirm "the signature was made by
 * the same key whose pubkey is published here" before doing the full
 * Ed25519 verify.
 */
function handlePubkey(res: ServerResponse, signer: CheckpointSigner): void {
  const publicKeyB64Url = Buffer.from(signer.publicKey).toString('base64url')
  const keyIdHex = Buffer.from(signer.keyId).toString('hex')
  sendJson(res, 200, {
    origin: signer.origin,
    public_key: publicKeyB64Url,
    key_id: keyIdHex,
    algorithm: 'Ed25519',
  })
}

/**
 * GET /v1/log-pubkey, expose the log's Ed25519 public key in the C2SP
 * signed-note vkey format (c2sp.org/signed-note). This is the canonical
 * key-publication format expected by tlog/witness tooling. Spec §2.4.2.
 *
 * Returns the same key as /v1/pubkey, just text-encoded:
 *   <origin>+<hex(key_id)>+<base64(0x01 || public_key)>
 */
function handleLogPubkey(res: ServerResponse, signer: CheckpointSigner): void {
  const vkey = formatVkey(signer.origin, signer.keyId, signer.publicKey)
  res.statusCode = 200
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(vkey))
  res.setHeader('cache-control', 'public, max-age=300')
  res.end(vkey)
}

/**
 * GET /v1/stats, aggregate counters over the current tree.
 *
 * Non-normative; spec §2.5 does not require this endpoint. Useful for
 * operators who want a one-call summary of the log's state without
 * fetching tile entries and parsing 90-byte records by hand.
 *
 * Response shape:
 *   {
 *     "tree_size": <int>,
 *     "distinct_signers": <int>,
 *     "oldest_timestamp_ms": <int> | null,
 *     "newest_timestamp_ms": <int> | null,
 *     "entries_by_event_type": {
 *       "tool_call": <int>,            // byte 0x01
 *       "transaction": <int>,          // byte 0x02
 *       "observation": <int>,          // byte 0x03
 *       "directory_anchor": <int>,     // byte 0x04 (D056)
 *       "extension": <int>,            // byte 0xFF
 *       "reserved": <int>              // any other byte (should be 0)
 *     }
 *   }
 *
 * Reads tree state in a single linear pass over entries. O(n) in tree size.
 * For very large logs the operator should expect a slower response; cache
 * is set to a short TTL so repeated polls are cheap.
 */
// D054 dashboard loader. Resolves apps/dashboard/index.html relative to this
// module so it works in src/ (tsx), dist/ (built), and the Docker image where
// `apps/dashboard/` is COPYed into /app. Cached after first read.
const DASHBOARD_PATH = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  // here = .../services/log-node/{src,dist}/  →  ../../../apps/dashboard/index.html
  const envOverride = process.env.ATRIB_DASHBOARD_PATH
  if (envOverride) return envOverride
  return join(here, '..', '..', '..', 'apps', 'dashboard', 'index.html')
})()
let dashboardCache: Buffer | null = null
async function loadDashboard(): Promise<Buffer | null> {
  if (dashboardCache) return dashboardCache
  try {
    dashboardCache = await readFile(DASHBOARD_PATH)
    return dashboardCache
  } catch {
    return null
  }
}

async function handleDashboard(res: ServerResponse): Promise<void> {
  const html = await loadDashboard()
  if (!html) {
    res.statusCode = 503
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(`atrib explorer: dashboard not bundled (looked at ${DASHBOARD_PATH})\n`)
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('content-length', html.length)
  // Short cache so the operator can ship dashboard tweaks without a long stale
  // window, but long enough to make repeated visits cheap.
  res.setHeader('cache-control', 'public, max-age=60')
  res.end(html)
}

// Static-asset cache: small set of files (favicon, apple-touch-icon, etc.),
// resolved relative to apps/dashboard/static/. Read once per file at first
// request, cached for process lifetime, they ship with the image and don't
// change between deploys.
const STATIC_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url))
  const envOverride = process.env.ATRIB_DASHBOARD_STATIC_PATH
  if (envOverride) return envOverride
  return join(here, '..', '..', '..', 'apps', 'dashboard', 'static')
})()
const staticCache = new Map<string, Buffer>()
async function handleStaticAsset(res: ServerResponse, name: string, contentType: string): Promise<void> {
  let bytes = staticCache.get(name)
  if (!bytes) {
    try {
      bytes = await readFile(join(STATIC_DIR, name))
      staticCache.set(name, bytes)
    } catch {
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(`asset not found: ${name}\n`)
      return
    }
  }
  res.statusCode = 200
  res.setHeader('content-type', contentType)
  res.setHeader('content-length', bytes.length)
  // Long cache: static assets ship with the image; new versions deploy with new image.
  res.setHeader('cache-control', 'public, max-age=86400, immutable')
  res.end(bytes)
}

// Decode entry layout per spec §2.3.1:
//   [0]      version byte
//   [1-32]   record_hash (32 bytes)
//   [33-64]  creator_key (32 bytes)
//   [65-80]  context_id (16 bytes)
//   [81-88]  timestamp_ms (u64 big-endian)
//   [89]     event_type byte
function decodeEntry(bytes: Uint8Array, index: number): {
  index: number
  record_hash: string
  creator_key: string
  context_id: string
  timestamp_ms: number
  event_type: string
  event_type_byte: number
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eventByte = bytes[89]!
  const eventLabel =
    eventByte === 0x01 ? 'tool_call' :
    eventByte === 0x02 ? 'transaction' :
    eventByte === 0x03 ? 'observation' :
    eventByte === 0x04 ? 'directory_anchor' :
    eventByte === 0xff ? 'extension' :
    'reserved'
  return {
    index,
    record_hash: 'sha256:' + hexEncode(bytes.subarray(1, 33)),
    creator_key: base64urlEncode(bytes.subarray(33, 65)),
    context_id: hexEncode(bytes.subarray(65, 81)),
    timestamp_ms: Number(view.getBigUint64(81, false)),
    event_type: eventLabel,
    event_type_byte: eventByte,
  }
}

function handleLookup(res: ServerResponse, tree: MerkleTree, hexHash: string): void {
  const size = tree.size
  for (let i = 0; i < size; i++) {
    const e = tree.entryBytes(i)
    const recordHashHex = hexEncode(e.subarray(1, 33))
    if (recordHashHex === hexHash) {
      res.setHeader('cache-control', 'public, max-age=60')
      sendJson(res, 200, decodeEntry(e, i))
      return
    }
  }
  sendJson(res, 404, { error: 'not found', record_hash: `sha256:${hexHash}` })
}

function handleByContext(res: ServerResponse, tree: MerkleTree, contextHex: string): void {
  const size = tree.size
  const matches: ReturnType<typeof decodeEntry>[] = []
  for (let i = size - 1; i >= 0; i--) {
    const e = tree.entryBytes(i)
    const ctxHex = hexEncode(e.subarray(65, 81))
    if (ctxHex === contextHex) matches.push(decodeEntry(e, i))
  }
  res.setHeader('cache-control', 'public, max-age=10')
  sendJson(res, matches.length === 0 ? 404 : 200, {
    context_id: contextHex,
    count: matches.length,
    entries: matches,
  })
}

function handleByCreator(res: ServerResponse, tree: MerkleTree, creatorKey: string): void {
  const size = tree.size
  const sessions = new Map<string, { context_id: string; node_count: number; has_transaction: boolean; first_seen_ms: number }>()
  for (let i = 0; i < size; i++) {
    const e = tree.entryBytes(i)
    const decoded = decodeEntry(e, i)
    if (decoded.creator_key !== creatorKey) continue
    const cur = sessions.get(decoded.context_id) ?? {
      context_id: decoded.context_id,
      node_count: 0,
      has_transaction: false,
      first_seen_ms: decoded.timestamp_ms,
    }
    cur.node_count += 1
    if (decoded.event_type === 'transaction') cur.has_transaction = true
    if (decoded.timestamp_ms < cur.first_seen_ms) cur.first_seen_ms = decoded.timestamp_ms
    sessions.set(decoded.context_id, cur)
  }
  const list = [...sessions.values()].sort((a, b) => b.first_seen_ms - a.first_seen_ms)
  res.setHeader('cache-control', 'public, max-age=10')
  sendJson(res, 200, { creator_key: creatorKey, count: list.length, sessions: list })
}

function handleRecent(res: ServerResponse, tree: MerkleTree, limit: number, offset: number = 0): void {
  const size = tree.size
  // Newest-first window: skip the `offset` most-recent entries, then take `limit`.
  const end = Math.max(0, size - offset)
  const start = Math.max(0, end - limit)
  const entries: ReturnType<typeof decodeEntry>[] = []
  for (let i = end - 1; i >= start; i--) {
    entries.push(decodeEntry(tree.entryBytes(i), i))
  }
  res.setHeader('cache-control', 'public, max-age=10')
  sendJson(res, 200, {
    tree_size: size,
    offset,
    returned: entries.length,
    entries,
  })
}

function handleStats(res: ServerResponse, tree: MerkleTree): void {
  const size = tree.size
  const signers = new Set<string>()
  let oldestTs: number | null = null
  let newestTs: number | null = null
  const eventTypeCounts = { tool_call: 0, transaction: 0, observation: 0, directory_anchor: 0, extension: 0, reserved: 0 }

  for (let i = 0; i < size; i++) {
    const e = tree.entryBytes(i)
    // Layout per spec §2.3.1:
    //   [33-64]  creator_key (32 bytes)
    //   [81-88]  timestamp_ms (u64 big-endian)
    //   [89]     event_type byte
    const creatorKeyHex = hexEncode(e.subarray(33, 65))
    signers.add(creatorKeyHex)

    const view = new DataView(e.buffer, e.byteOffset, e.byteLength)
    const ts = Number(view.getBigUint64(81, false))
    if (oldestTs === null || ts < oldestTs) oldestTs = ts
    if (newestTs === null || ts > newestTs) newestTs = ts

    const eventType = e[89]!
    if (eventType === 0x01) eventTypeCounts.tool_call += 1
    else if (eventType === 0x02) eventTypeCounts.transaction += 1
    else if (eventType === 0x03) eventTypeCounts.observation += 1
    else if (eventType === 0x04) eventTypeCounts.directory_anchor += 1
    else if (eventType === 0xff) eventTypeCounts.extension += 1
    else eventTypeCounts.reserved += 1
  }

  res.setHeader('cache-control', 'public, max-age=10')
  sendJson(res, 200, {
    tree_size: size,
    distinct_signers: signers.size,
    oldest_timestamp_ms: oldestTs,
    newest_timestamp_ms: newestTs,
    entries_by_event_type: eventTypeCounts,
  })
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
  acquireLock: AcquireLock,
  graphFanoutEndpoint: string | undefined,
): Promise<void> {
  let body: string
  try {
    body = await readBody(req)
  } catch {
    return reject(res, 413, 'request body too large')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return reject(res, 400, 'invalid json body')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return reject(res, 400, 'body must be a json object. the bare attribution record per §2.6.1')
  }

  const record = parsed as Partial<AtribRecord>

  // §2.6.1 Steps 2–5 + required-field presence checks.
  // Step 6 (idempotency) is handled by the proof cache below.
  const validation = validateSubmission(record)
  if (!validation.ok) {
    return reject(res, validation.status!, validation.error!)
  }

  const fullRecord = record as AtribRecord

  // §2.6.1 Step 1: verify Ed25519 signature
  const sigValid = await verifyRecord(fullRecord)
  if (!sigValid) {
    return reject(res, 400, 'Ed25519 signature verification failed (§2.6.1 Step 1)')
  }

  // Compute record_hash: SHA-256 of JCS canonical bytes
  const canonBytes = canonicalRecord(fullRecord)
  const recordHashBytes = sha256(canonBytes)
  const recordHashHex = hexEncode(recordHashBytes)

  // §2.6.1 Step 6: idempotency. return existing proof if already submitted
  const cached = proofCache.get(recordHashHex)
  if (cached !== undefined) {
    sendJson(res, 200, cached)
    return
  }

  // Serialize into 90-byte entry
  const entryBytes = serializeEntry({
    record_hash_hex: recordHashHex,
    creator_key_b64url: fullRecord.creator_key,
    context_id: fullRecord.context_id,
    timestamp: fullRecord.timestamp,
    event_type: fullRecord.event_type,
  })

  // Critical section: append→proof→sign must be atomic. signer.sign is
  // async (ed.signAsync yields the event loop), so without serialization
  // a concurrent request could tree.append() between our append and sign,
  // producing a checkpoint whose tree size doesn't match our proof.
  const lock = acquireLock()
  await lock.wait
  let proof: ProofBundle
  try {
    // Re-check cache inside the lock. two concurrent requests for the same
    // record can both miss the fast-path check above, but only the first
    // should append. The second finds the proof cached by the first.
    const cachedInLock = proofCache.get(recordHashHex)
    if (cachedInLock !== undefined) {
      sendJson(res, 200, cachedInLock)
      return // finally block releases the lock
    }
    const logIndex = tree.append(entryBytes)
    const inclusionProof = tree.inclusionProof(logIndex)
    const leafHashBytes = tree.leafHash(logIndex)
    const rootHash = tree.root()
    const signedCheckpoint = await signer.sign(tree.size, rootHash)

    proof = {
      log_index: logIndex,
      checkpoint: signedCheckpoint,
      inclusion_proof: inclusionProof.map((h) => Buffer.from(h).toString('base64')),
      leaf_hash: Buffer.from(leafHashBytes).toString('base64'),
    }

    // Cache for idempotency. evict oldest entry if at capacity
    if (proofCache.size >= MAX_PROOF_CACHE) {
      const oldest = proofCache.keys().next().value
      if (oldest !== undefined) proofCache.delete(oldest)
    }
    proofCache.set(recordHashHex, proof)
  } finally {
    lock.release()
  }

  sendJson(res, 200, proof)

  // Fan out the full signed record to graph-node so the derived graph
  // stays in sync with the source-of-truth log. Fire-and-forget; failures
  // log a warning but never affect the submission. The fanout uses the
  // post-commit record bytes so any tampering between log and graph would
  // change the record_hash and be rejected by graph's verifyRecord step.
  if (graphFanoutEndpoint) {
    fanoutToGraph(graphFanoutEndpoint, fullRecord, recordHashHex, proof.log_index)
  }
}

const FANOUT_TIMEOUT_MS = 5000

function fanoutToGraph(endpoint: string, record: AtribRecord, recordHashHex: string, logIndex: number): void {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FANOUT_TIMEOUT_MS)
  fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Carry the log_index so graph-node can apply revocation logic per §1.9.3.
      // graph-node treats this header as advisory; missing = log_index null.
      'x-atrib-log-index': String(logIndex),
    },
    body: JSON.stringify(record),
    signal: ctrl.signal,
  }).then((r) => {
    clearTimeout(timer)
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`atrib-log: graph fanout for ${recordHashHex.slice(0, 12)}… returned ${r.status}`)
    }
  }).catch((err: unknown) => {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(`atrib-log: graph fanout for ${recordHashHex.slice(0, 12)}… failed: ${msg}`)
  })
}

async function handleCheckpoint(
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
): Promise<void> {
  if (tree.size === 0) {
    sendJson(res, 404, { error: 'no entries yet' })
    return
  }

  // Snapshot both values synchronously before the async sign call.
  // Without this, a concurrent POST /v1/entries can tree.append()
  // between root() and the tree.size read inside signer.sign,
  // producing a checkpoint where treeSize doesn't match rootHash.
  const treeSize = tree.size
  const rootHash = tree.root()
  const signedCheckpoint = await signer.sign(treeSize, rootHash)

  const checkpointBytes = Buffer.byteLength(signedCheckpoint)
  res.statusCode = 200
  res.setHeader('content-type', 'text/plain')
  res.setHeader('content-length', checkpointBytes)
  res.end(signedCheckpoint)
}

/**
 * §2.5.2: Serve a tile of Merkle tree hashes.
 * Level 0 = leaf hashes, higher levels = internal node hashes.
 * Each tile contains up to TILE_SIZE (256) concatenated 32-byte hashes.
 */
function handleTile(
  res: ServerResponse,
  tree: MerkleTree,
  level: number,
  index: number,
): void {
  if (tree.size === 0) {
    sendJson(res, 404, { error: 'no entries yet' })
    return
  }

  if (level === 0) {
    // Level 0: leaf hashes
    const start = index * TILE_SIZE
    const end = Math.min(start + TILE_SIZE, tree.size)
    if (start >= tree.size) {
      sendJson(res, 404, { error: 'tile index out of range' })
      return
    }
    const hashes: Uint8Array[] = []
    for (let i = start; i < end; i++) {
      hashes.push(tree.leafHash(i))
    }
    const data = concatBytes(hashes)
    const isFull = (end - start) === TILE_SIZE
    sendBinary(res, data, isFull)
    return
  }

  // Higher levels: compute internal node hashes from the level below.
  // Level L tile N contains hashes for nodes at positions [N*256, (N+1)*256) at level L.
  // Each node at level L is nodeHash(left, right) of two nodes at level L-1.
  const leafCount = tree.size
  // Number of nodes at the requested level
  const nodesAtLevel = Math.ceil(leafCount / Math.pow(2, level))
  const start = index * TILE_SIZE
  const end = Math.min(start + TILE_SIZE, nodesAtLevel)

  if (start >= nodesAtLevel) {
    sendJson(res, 404, { error: 'tile index out of range' })
    return
  }

  // Build up from leaf hashes
  let currentLevel: Uint8Array[] = []
  for (let i = 0; i < leafCount; i++) {
    currentLevel.push(tree.leafHash(i))
  }
  for (let l = 0; l < level; l++) {
    const nextLevel: Uint8Array[] = []
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(nodeHash(currentLevel[i]!, currentLevel[i + 1]!))
      } else {
        nextLevel.push(currentLevel[i]!)
      }
    }
    currentLevel = nextLevel
  }

  const hashes = currentLevel.slice(start, end)
  const data = concatBytes(hashes)
  const isFull = (end - start) === TILE_SIZE
  sendBinary(res, data, isFull)
}

/**
 * §2.5.3: Serve an entry bundle (raw entry bytes with uint16 length prefixes).
 * Bundle N contains entries at positions [N*256, (N+1)*256).
 */
function handleEntryBundle(
  res: ServerResponse,
  tree: MerkleTree,
  index: number,
): void {
  if (tree.size === 0) {
    sendJson(res, 404, { error: 'no entries yet' })
    return
  }

  const start = index * TILE_SIZE
  const end = Math.min(start + TILE_SIZE, tree.size)
  if (start >= tree.size) {
    sendJson(res, 404, { error: 'entry bundle index out of range' })
    return
  }

  // Build length-prefixed entry bundle
  const chunks: Uint8Array[] = []
  for (let i = start; i < end; i++) {
    const entry = tree.entryBytes(i)
    // uint16 big-endian length prefix
    const lenBuf = new Uint8Array(2)
    const dv = new DataView(lenBuf.buffer)
    dv.setUint16(0, entry.length, false) // big-endian
    chunks.push(lenBuf)
    chunks.push(entry)
  }

  const data = concatBytes(chunks)
  const isFull = (end - start) === TILE_SIZE
  sendBinary(res, data, isFull)
}

/** Concatenate Uint8Arrays into a single buffer. */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0
  for (const a of arrays) totalLen += a.length
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

/** Send binary response with appropriate cache headers. */
function sendBinary(res: ServerResponse, data: Uint8Array, isFull: boolean): void {
  res.statusCode = 200
  res.setHeader('content-type', 'application/octet-stream')
  res.setHeader('content-length', data.length)
  // Full tiles are immutable. partial tiles (at the edge) may grow.
  if (isFull) {
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  } else {
    res.setHeader('cache-control', 'public, max-age=60')
  }
  res.end(Buffer.from(data))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('content-length', Buffer.byteLength(json))
  res.end(json)
}

function reject(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

const MAX_BODY_BYTES = 64 * 1024 // 64 KB. an AtribRecord is always small

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > MAX_BODY_BYTES) {
      req.destroy()
      throw new Error('request body too large')
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}
