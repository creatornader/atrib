// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP server for @atrib/log-node. production log with real Merkle proofs.
 *
 * Endpoints:
 *   POST /v1/entries    . submit a signed attribution record
 *   GET  /v1/checkpoint . return the latest signed checkpoint as text/plain
 *   GET  /v1/proof/:hex . return an inclusion proof for an included record
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
import {
  canonicalRecord,
  validateSubmission,
  verifyRecord,
  hexEncode,
  nodeHash,
  base64urlEncode,
} from '@atrib/mcp'
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

export interface GraphFanoutOptions {
  timeoutMs?: number
  maxAttempts?: number
  retryDelayMs?: number
}

interface NormalizedGraphFanoutOptions {
  timeoutMs: number
  maxAttempts: number
  retryDelayMs: number
}

const MAX_PROOF_CACHE = 100_000 // entries; ~30MB at ~300 bytes/entry
const FANOUT_DEFAULT_TIMEOUT_MS = 5000
const FANOUT_DEFAULT_MAX_ATTEMPTS = 3
const FANOUT_DEFAULT_RETRY_DELAY_MS = 100

function positiveIntOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function normalizeGraphFanoutOptions(
  options: GraphFanoutOptions | undefined,
): NormalizedGraphFanoutOptions {
  return {
    timeoutMs: positiveIntOr(options?.timeoutMs, FANOUT_DEFAULT_TIMEOUT_MS),
    maxAttempts: positiveIntOr(options?.maxAttempts, FANOUT_DEFAULT_MAX_ATTEMPTS),
    retryDelayMs: positiveIntOr(options?.retryDelayMs, FANOUT_DEFAULT_RETRY_DELAY_MS),
  }
}

/**
 * Bind an HTTP server that handles POST /v1/entries and GET /v1/checkpoint.
 */
export async function bindServer(
  tree: MerkleTree,
  signer: CheckpointSigner,
  port: number,
  host?: string,
  graphFanoutEndpoint?: string,
  graphFanoutOptions?: GraphFanoutOptions,
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
  const subscribers = new Set<LogStreamSubscriber>()
  const normalizedGraphFanoutOptions = normalizeGraphFanoutOptions(graphFanoutOptions)

  // Acquire the submit lock: waits for previous submission to finish,
  // returns a release function. This serializes the append→proof→sign
  // critical section so concurrent requests don't interleave.
  function acquireSubmitLock(): { wait: Promise<void>; release: () => void } {
    const prev = submitQueue
    let release!: () => void
    submitQueue = new Promise<void>((r) => {
      release = r
    })
    return { wait: prev, release }
  }

  const server = createServer((req, res) => {
    // CORS for browser-based dashboards (D054). All log read endpoints serve public data
    // per spec §0; browser cross-origin reads are explicitly permitted.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type, x-atrib-priority')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    handleRequest(
      req,
      res,
      tree,
      signer,
      proofCache,
      acquireSubmitLock,
      subscribers,
      graphFanoutEndpoint,
      normalizedGraphFanoutOptions,
    ).catch((err) => {
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
      for (const subscriber of subscribers) closeSubscriber(subscriber)
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

type AcquireLock = () => { wait: Promise<void>; release: () => void }

interface DecodedEntry {
  index: number
  record_hash: string
  creator_key: string
  context_id: string
  timestamp_ms: number
  event_type: string
  event_type_byte: number
}

interface LogEntryFilters {
  creatorKey?: string
  contextId?: string
  eventType?: string
  sinceMs?: number
}

interface LogStreamSubscriber {
  filters: LogEntryFilters
  heartbeat: ReturnType<typeof setInterval>
  res: ServerResponse
}

function isGetOrHead(method: string | undefined): boolean {
  return method === 'GET' || method === 'HEAD'
}

function isDashboardRoutePath(urlPath: string | undefined): boolean {
  if (!urlPath) return false
  if (
    urlPath === '/overview' ||
    urlPath === '/demo' ||
    urlPath === '/anchoring' ||
    urlPath === '/about'
  )
    return true
  return /^\/(?:identity|session|action|trace)\/[^/]+$/.test(urlPath)
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
  acquireLock: AcquireLock,
  subscribers: Set<LogStreamSubscriber>,
  graphFanoutEndpoint: string | undefined,
  graphFanoutOptions: NormalizedGraphFanoutOptions,
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
  const isExplorerHost = req.headers.host?.startsWith('explore.atrib.dev') === true
  const isHead = req.method === 'HEAD'
  if (
    isGetOrHead(req.method) &&
    isExplorerHost &&
    (urlPath === '/' || urlPath === '' || isDashboardRoutePath(urlPath))
  ) {
    return handleDashboard(res, isHead)
  }

  // Service-info index for the bare hostname when NOT served over
  // explore.atrib.dev (i.e. log.atrib.dev itself or any other host).
  // Without this, GET https://log.atrib.dev/ 404s, which is confusing
  // because READMEs and docs reference the bare hostname as if it were
  // browsable. Mirrors directory-node's /v6 index pattern and follows
  // the GitHub `api.github.com` / Stripe `api.stripe.com` convention of
  // returning a discovery JSON at the bare hostname rather than a 404
  // or auto-redirect to the latest version (auto-redirect breaks the
  // version-isolation contract on future major-version ships).
  //
  // Endpoint URLs are derived from current_version so a future major
  // version bump (when v2 ships) is a single CURRENT_VERSION change
  // plus appending to SUPPORTED_VERSIONS. The endpoint catalog stays
  // valid for the new version, and old `/v1/...` URLs keep resolving
  // until v1 is formally deprecated and removed.
  if (req.method === 'GET' && (urlPath === '/' || urlPath === '')) {
    const CURRENT_VERSION = 'v1'
    const SUPPORTED_VERSIONS = ['v1']
    const v = CURRENT_VERSION
    return sendJson(res, 200, {
      service: 'atrib-log-node',
      versions: SUPPORTED_VERSIONS,
      current_version: CURRENT_VERSION,
      origin: `log.atrib.dev/${v}`,
      spec: 'https://github.com/creatornader/atrib/blob/main/atrib-spec.md#2-merkle-log-protocol',
      endpoints: {
        submit: `POST /${v}/entries`,
        checkpoint: `GET /${v}/checkpoint`,
        log_pubkey: `GET /${v}/log-pubkey`,
        pubkey_json: `GET /${v}/pubkey`,
        stats: `GET /${v}/stats`,
        recent: `GET /${v}/recent`,
        lookup: `GET /${v}/lookup/<record_hash_hex>`,
        proof: `GET /${v}/proof/<record_hash_hex>`,
        by_context: `GET /${v}/by-context/<context_id_hex>`,
        by_creator: `GET /${v}/by-creator/<creator_key_b64url>`,
        stream: `GET /${v}/stream`,
        json_feed: `GET /${v}/feed.json`,
        tile: `GET /${v}/tile/<level>/<index>`,
        entry_bundle: `GET /${v}/tile/entries/<index>`,
      },
      explorer: 'https://explore.atrib.dev/',
      note: 'This base URL has no browsable UI. Use the endpoints listed above. The public explorer at https://explore.atrib.dev/ composes log + graph + directory reads into a unified surface.',
    })
  }

  if (req.method === 'POST' && req.url === '/v1/entries') {
    return handleSubmit(
      req,
      res,
      tree,
      signer,
      proofCache,
      acquireLock,
      subscribers,
      graphFanoutEndpoint,
      graphFanoutOptions,
    )
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
    res.end(
      JSON.stringify({
        type: 'https://atrib.dev/problems/append-only',
        title: 'Method Not Allowed',
        status: 405,
        detail:
          'The atrib log is append-only by design. Records cannot be deleted via the API. See ARCHITECTURE.md and §1.8.',
      }),
    )
    return
  }

  if (req.method === 'GET' && req.url === '/v1/checkpoint') {
    return handleCheckpoint(res, tree, signer)
  }

  // GET /v1/pubkey: return the log's Ed25519 public key + key_id so verifiers
  // can check the C2SP signed-note signature on /v1/checkpoint without an
  // out-of-band trust root. Without this endpoint, third parties have no way
  // to verify the checkpoint signature and must trust the log on the root.
  if (req.method === 'GET' && req.url === '/v1/pubkey') {
    return handlePubkey(res, signer)
  }

  // GET /v1/log-pubkey: same key as /v1/pubkey but in C2SP signed-note vkey
  // format (text/plain). Spec §2.4.2 commits to this path; tools like
  // golang.org/x/mod/sumdb/note.NewVerifier consume vkey strings directly,
  // so we serve it canonically rather than forcing those tools to JSON-parse.
  if (req.method === 'GET' && req.url === '/v1/log-pubkey') {
    return handleLogPubkey(res, signer)
  }

  // GET /v1/stats: aggregate counters over the current tree. Non-normative
  // operator-visibility convenience: tree size, distinct creator_keys,
  // timestamp range, and a count by event_type byte. Reads existing tree
  // state in a single pass; not part of spec §2.5.
  if (req.method === 'GET' && req.url === '/v1/stats') {
    return handleStats(res, tree)
  }

  if (req.method === 'GET' && urlPath === '/v1/stream') {
    const parsed = parseFilterParams(new URL(req.url ?? '', 'http://localhost').searchParams)
    if (!parsed.ok) return reject(res, 400, parsed.error)
    return handleStream(req, res, tree, parsed.filters, subscribers)
  }

  if (req.method === 'GET' && urlPath === '/v1/feed.json') {
    const url = new URL(req.url ?? '', 'http://localhost')
    const parsed = parseFilterParams(url.searchParams)
    if (!parsed.ok) return reject(res, 400, parsed.error)
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1),
      100,
    )
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0)
    return handleJsonFeed(req, res, tree, parsed.filters, limit, offset)
  }

  // GET /v1/recent: newest N decoded entries (default 20, max 100). Powers
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

  // GET /v1/lookup/<hex>: find an entry by its record_hash (32 bytes hex).
  // Returns the decoded entry. Linear scan; fine at current scale, indexed
  // lookup is a future optimization. Non-normative.
  const lookupMatch = req.url?.match(/^\/v1\/lookup\/([0-9a-fA-F]{64})$/)
  if (req.method === 'GET' && lookupMatch) {
    return handleLookup(res, tree, lookupMatch[1]!.toLowerCase())
  }

  // GET /v1/proof/<hex>: return a fresh proof bundle for an already
  // included entry. This lets proof-null mirrors recover evidence without
  // re-submitting a record and risking a duplicate append.
  const proofMatch = req.url?.match(/^\/v1\/proof\/([0-9a-fA-F]{64})$/)
  if (req.method === 'GET' && proofMatch) {
    return handleProofLookup(res, tree, signer, proofCache, proofMatch[1]!.toLowerCase())
  }

  // GET /v1/by-context/<hex>: list all entries for a context_id (16 bytes hex).
  // Returns entries newest-first. Linear scan; non-normative explorer convenience.
  // Lets the dashboard render a session view using log data alone when graph-node
  // is unreachable or hasn't ingested.
  const byContextMatch = req.url?.match(/^\/v1\/by-context\/([0-9a-fA-F]{32})$/)
  if (req.method === 'GET' && byContextMatch) {
    return handleByContext(res, tree, byContextMatch[1]!.toLowerCase())
  }

  // GET /v1/by-creator/<base64url>: list sessions for a creator_key (43 chars
  // base64url). Returns one entry per distinct context_id with node_count,
  // has_transaction, first_seen. Mirrors the shape of graph-node's
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
    isGetOrHead(req.method) &&
    (urlPath === '/dashboard' || urlPath === '/dashboard/' || urlPath === '/dashboard.html')
  ) {
    return handleDashboard(res, isHead)
  }

  // D054: dashboard static assets, favicon, apple-touch-icon, og image.
  // Bundled by the Dockerfile from apps/dashboard/static/. Served from both
  // explore.atrib.dev and log.atrib.dev so the HTML's <link> tags resolve
  // regardless of which hostname loads the explorer.
  if (isGetOrHead(req.method) && urlPath === '/favicon.ico') {
    return handleStaticAsset(res, 'favicon.ico', 'image/x-icon', 60, false, isHead)
  }
  const staticMatch = req.url?.match(/^\/static\/([A-Za-z0-9._-]+)$/)
  if (isGetOrHead(req.method) && staticMatch) {
    const name = staticMatch[1]!
    const contentType = name.endsWith('.svg')
      ? 'image/svg+xml'
      : name.endsWith('.png')
        ? 'image/png'
        : name.endsWith('.ico')
          ? 'image/x-icon'
          : 'application/octet-stream'
    return handleStaticAsset(res, name, contentType, 86400, true, isHead)
  }

  // YC demo recording surface. This is a dashboard-root artifact, not the
  // live /demo route. Keep it allowlisted so the explorer can host the
  // stable recording page without turning apps/dashboard into a file server.
  if (
    isGetOrHead(req.method) &&
    (urlPath === '/yc-demo' || urlPath === '/yc-demo/' || urlPath === '/yc-demo.html')
  ) {
    return handleDashboardRootFile(res, 'yc-demo.html', 'text/html; charset=utf-8', 60, isHead)
  }
  if (isGetOrHead(req.method) && urlPath === '/yc-demo-trace-bundle.json') {
    return handleDashboardRootFile(
      res,
      'yc-demo-trace-bundle.json',
      'application/json; charset=utf-8',
      60,
      isHead,
    )
  }

  // Sibling ES modules imported by index.html (e.g. graph-utils.mjs).
  // These live next to the HTML in apps/dashboard/ and are extracted
  // pure helpers that need to be unit-testable without a browser.
  // Restrict the regex to the dashboard-root level (no slashes) so we
  // can never accidentally serve files from anywhere else in the
  // image. .mjs Content-Type is the spec-correct value for ES modules.
  // Match the URL pathname only (urlPath is computed above) so cache-
  // bust query strings (./graph-utils.mjs?v=...) still resolve.
  const mjsMatch = (urlPath ?? '').match(/^\/([A-Za-z0-9_-]+\.mjs)$/)
  if (isGetOrHead(req.method) && mjsMatch) {
    return handleDashboardModule(res, mjsMatch[1]!, isHead)
  }

  sendJson(res, 404, {
    error: 'not found',
    hint: 'Available endpoints: POST /v1/entries, GET /v1/checkpoint, GET /v1/pubkey, GET /v1/log-pubkey, GET /v1/stats, GET /v1/recent, GET /v1/stream, GET /v1/feed.json, GET /v1/lookup/<hex>, GET /v1/proof/<hex>, GET /v1/by-context/<hex>, GET /v1/by-creator/<base64url>, GET /v1/tile/<L>/<N>, GET /v1/tile/entries/<N>, GET /dashboard, GET /<name>.mjs (dashboard sibling modules), GET /static/<name>, GET /favicon.ico',
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
 *     "distinct_signers": <int>,       // cumulative signer keys ever seen
 *     "active_signers_24h": <int>,     // signer keys with >=1 record in the last 24h
 *     "active_signers_7d": <int>,      // signer keys with >=1 record in the last 7d
 *     "oldest_timestamp_ms": <int> | null,
 *     "newest_timestamp_ms": <int> | null,
 *     "entries_by_event_type": {
 *       "tool_call": <int>,            // byte 0x01
 *       "transaction": <int>,          // byte 0x02
 *       "observation": <int>,          // byte 0x03
 *       "directory_anchor": <int>,     // byte 0x04 (D056)
 *       "annotation": <int>,           // byte 0x05 (D058)
 *       "revision": <int>,             // byte 0x06 (D059)
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

async function handleDashboard(res: ServerResponse, isHead = false): Promise<void> {
  const html = await loadDashboard()
  if (!html) {
    res.statusCode = 503
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    const body = `atrib explorer: dashboard not bundled (looked at ${DASHBOARD_PATH})\n`
    res.setHeader('content-length', Buffer.byteLength(body))
    res.end(isHead ? undefined : body)
    return
  }
  res.statusCode = 200
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('content-length', html.length)
  // Short cache so the operator can ship dashboard tweaks without a long stale
  // window, but long enough to make repeated visits cheap.
  res.setHeader('cache-control', 'public, max-age=60')
  res.end(isHead ? undefined : html)
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
/**
 * Serve a dashboard sibling ES module file (e.g. graph-utils.mjs).
 * Resolved relative to apps/dashboard/, NOT apps/dashboard/static/,
 * because these are real source files imported by index.html. Cached
 * after first read for the process lifetime, bundled with the image,
 * unchanged between deploys.
 */
const moduleCache = new Map<string, Buffer>()
const rootFileCache = new Map<string, Buffer>()

async function handleDashboardRootFile(
  res: ServerResponse,
  name: string,
  contentType: string,
  maxAgeSeconds: number,
  isHead = false,
): Promise<void> {
  let bytes = rootFileCache.get(name)
  if (!bytes) {
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      bytes = await readFile(join(here, '..', '..', '..', 'apps', 'dashboard', name))
      rootFileCache.set(name, bytes)
    } catch {
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      const body = `dashboard file not found: ${name}\n`
      res.setHeader('content-length', Buffer.byteLength(body))
      res.end(isHead ? undefined : body)
      return
    }
  }
  res.statusCode = 200
  res.setHeader('content-type', contentType)
  res.setHeader('content-length', bytes.length)
  res.setHeader('cache-control', `public, max-age=${maxAgeSeconds}`)
  res.end(isHead ? undefined : bytes)
}

async function handleDashboardModule(
  res: ServerResponse,
  name: string,
  isHead = false,
): Promise<void> {
  let bytes = moduleCache.get(name)
  if (!bytes) {
    try {
      // here = .../services/log-node/{src,dist}/  →  ../../../apps/dashboard/<name>
      const here = dirname(fileURLToPath(import.meta.url))
      bytes = await readFile(join(here, '..', '..', '..', 'apps', 'dashboard', name))
      moduleCache.set(name, bytes)
    } catch {
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      const body = `module not found: ${name}\n`
      res.setHeader('content-length', Buffer.byteLength(body))
      res.end(isHead ? undefined : body)
      return
    }
  }
  res.statusCode = 200
  res.setHeader('content-type', 'text/javascript; charset=utf-8')
  res.setHeader('content-length', bytes.length)
  // Modest cache so a hotfix to the .mjs is picked up after redeploy
  // within minutes; immutable would require a cache-bust query param.
  res.setHeader('cache-control', 'public, max-age=300')
  res.end(isHead ? undefined : bytes)
}

async function handleStaticAsset(
  res: ServerResponse,
  name: string,
  contentType: string,
  maxAgeSeconds = 86400,
  immutable = true,
  isHead = false,
): Promise<void> {
  let bytes = staticCache.get(name)
  if (!bytes) {
    try {
      bytes = await readFile(join(STATIC_DIR, name))
      staticCache.set(name, bytes)
    } catch {
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      const body = `asset not found: ${name}\n`
      res.setHeader('content-length', Buffer.byteLength(body))
      res.end(isHead ? undefined : body)
      return
    }
  }
  res.statusCode = 200
  res.setHeader('content-type', contentType)
  res.setHeader('content-length', bytes.length)
  // Static assets ship with the image. Bare browser probe paths stay short
  // cached because they cannot be cache-busted when a stale response leaks.
  const cacheControl = immutable
    ? `public, max-age=${maxAgeSeconds}, immutable`
    : `public, max-age=${maxAgeSeconds}`
  res.setHeader('cache-control', cacheControl)
  res.end(isHead ? undefined : bytes)
}

// Decode entry layout per spec §2.3.1:
//   [0]      version byte
//   [1-32]   record_hash (32 bytes)
//   [33-64]  creator_key (32 bytes)
//   [65-80]  context_id (16 bytes)
//   [81-88]  timestamp_ms (u64 big-endian)
//   [89]     event_type byte
function decodeEntry(bytes: Uint8Array, index: number): DecodedEntry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eventByte = bytes[89]!
  const eventLabel =
    eventByte === 0x01
      ? 'tool_call'
      : eventByte === 0x02
        ? 'transaction'
        : eventByte === 0x03
          ? 'observation'
          : eventByte === 0x04
            ? 'directory_anchor'
            : eventByte === 0x05
              ? 'annotation'
              : eventByte === 0x06
                ? 'revision'
                : eventByte === 0xff
                  ? 'extension'
                  : 'reserved'
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

async function handleProofLookup(
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
  hexHash: string,
): Promise<void> {
  const cached = proofCache.get(hexHash)
  if (cached !== undefined) {
    res.setHeader('cache-control', 'public, max-age=60')
    sendJson(res, 200, cached)
    return
  }

  const size = tree.size
  for (let i = 0; i < size; i++) {
    const e = tree.entryBytes(i)
    const recordHashHex = hexEncode(e.subarray(1, 33))
    if (recordHashHex !== hexHash) continue

    const proof = await makeProofBundle(tree, signer, i)
    if (proofCache.size >= MAX_PROOF_CACHE) {
      const oldest = proofCache.keys().next().value
      if (oldest !== undefined) proofCache.delete(oldest)
    }
    proofCache.set(hexHash, proof)
    res.setHeader('cache-control', 'public, max-age=60')
    sendJson(res, 200, proof)
    return
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

interface SessionSummary {
  context_id: string
  node_count: number
  /** Earliest record_timestamp_ms seen for this context_id from this creator. */
  first_seen: number
  /** Latest record_timestamp_ms seen, useful for activity-map recency sort and live-trace detection. */
  last_seen: number
  /**
   * Per-event-type record counts within the context_id. Surfaces the
   * diversity the older `has_transaction` boolean hid: clients need to
   * know whether a context_id contains annotations / revisions /
   * observations, not just whether commerce closed it. Keys mirror
   * decodeEntry's normalized labels ('tool_call', 'transaction',
   * 'observation', 'directory_anchor', 'annotation', 'revision',
   * 'extension', 'reserved'); zero-count types are omitted to keep the
   * response compact.
   */
  count_by_event_type: Record<string, number>
  /**
   * Retained for backward compatibility with dashboard code that already
   * reads it. Equivalent to `(count_by_event_type.transaction ?? 0) > 0`.
   */
  has_transaction: boolean
}

function handleByCreator(res: ServerResponse, tree: MerkleTree, creatorKey: string): void {
  const size = tree.size
  const sessions = new Map<string, SessionSummary>()
  for (let i = 0; i < size; i++) {
    const e = tree.entryBytes(i)
    const decoded = decodeEntry(e, i)
    if (decoded.creator_key !== creatorKey) continue
    const cur = sessions.get(decoded.context_id) ?? {
      context_id: decoded.context_id,
      node_count: 0,
      first_seen: decoded.timestamp_ms,
      last_seen: decoded.timestamp_ms,
      count_by_event_type: {},
      has_transaction: false,
    }
    cur.node_count += 1
    cur.count_by_event_type[decoded.event_type] =
      (cur.count_by_event_type[decoded.event_type] ?? 0) + 1
    if (decoded.event_type === 'transaction') cur.has_transaction = true
    if (decoded.timestamp_ms < cur.first_seen) cur.first_seen = decoded.timestamp_ms
    if (decoded.timestamp_ms > cur.last_seen) cur.last_seen = decoded.timestamp_ms
    sessions.set(decoded.context_id, cur)
  }
  const list = [...sessions.values()].sort((a, b) => b.last_seen - a.last_seen)
  res.setHeader('cache-control', 'public, max-age=10')
  sendJson(res, 200, { creator_key: creatorKey, count: list.length, sessions: list })
}

function handleRecent(
  res: ServerResponse,
  tree: MerkleTree,
  limit: number,
  offset: number = 0,
): void {
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

function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  filters: LogEntryFilters,
  subscribers: Set<LogStreamSubscriber>,
): void {
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream; charset=utf-8')
  res.setHeader('cache-control', 'no-cache, no-transform')
  res.setHeader('connection', 'keep-alive')
  res.flushHeaders()

  const subscriber: LogStreamSubscriber = {
    filters,
    heartbeat: setInterval(() => {
      if (!res.destroyed) res.write(': keep-alive\n\n')
    }, 25_000),
    res,
  }
  subscribers.add(subscriber)
  req.on('close', () => {
    subscribers.delete(subscriber)
    clearInterval(subscriber.heartbeat)
  })

  res.write(
    `event: ready\ndata: ${JSON.stringify({
      tree_size: tree.size,
      filters: publicFilterShape(filters),
    })}\n\n`,
  )

  if (filters.sinceMs !== undefined) {
    for (let i = 0; i < tree.size; i++) {
      const entry = decodeEntry(tree.entryBytes(i), i)
      if (matchesEntryFilters(entry, filters)) writeSseLogEntry(res, entry, tree.size)
    }
  }
}

function handleJsonFeed(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  filters: LogEntryFilters,
  limit: number,
  offset: number,
): void {
  const entries = collectNewestEntries(tree, filters, limit, offset)
  const baseUrl = requestBaseUrl(req)
  const feedPath = req.url ?? '/v1/feed.json'
  sendJsonWithContentType(
    res,
    200,
    {
      version: 'https://jsonfeed.org/version/1.1',
      title: 'atrib log entries',
      home_page_url: `${baseUrl}/`,
      feed_url: `${baseUrl}${feedPath}`,
      items: entries.map((entry) => jsonFeedItem(baseUrl, entry)),
      _atrib: {
        tree_size: tree.size,
        limit,
        offset,
        filters: publicFilterShape(filters),
      },
    },
    'application/feed+json; charset=utf-8',
  )
}

function notifySubscribers(
  subscribers: Set<LogStreamSubscriber>,
  entry: DecodedEntry,
  treeSize: number,
): void {
  for (const subscriber of subscribers) {
    if (!matchesEntryFilters(entry, subscriber.filters)) continue
    try {
      writeSseLogEntry(subscriber.res, entry, treeSize)
    } catch {
      subscribers.delete(subscriber)
      closeSubscriber(subscriber)
    }
  }
}

function closeSubscriber(subscriber: LogStreamSubscriber): void {
  clearInterval(subscriber.heartbeat)
  if (!subscriber.res.destroyed && !subscriber.res.writableEnded) subscriber.res.end()
}

function writeSseLogEntry(res: ServerResponse, entry: DecodedEntry, treeSize: number): void {
  res.write(`id: ${entry.index}\n`)
  res.write('event: log_entry\n')
  res.write(`data: ${JSON.stringify({ tree_size: treeSize, entry })}\n\n`)
}

function collectNewestEntries(
  tree: MerkleTree,
  filters: LogEntryFilters,
  limit: number,
  offset: number,
): DecodedEntry[] {
  const entries: DecodedEntry[] = []
  let skipped = 0
  for (let i = tree.size - 1; i >= 0; i--) {
    const entry = decodeEntry(tree.entryBytes(i), i)
    if (!matchesEntryFilters(entry, filters)) continue
    if (skipped < offset) {
      skipped += 1
      continue
    }
    entries.push(entry)
    if (entries.length >= limit) break
  }
  return entries
}

function matchesEntryFilters(entry: DecodedEntry, filters: LogEntryFilters): boolean {
  if (filters.creatorKey !== undefined && entry.creator_key !== filters.creatorKey) return false
  if (filters.contextId !== undefined && entry.context_id !== filters.contextId) return false
  if (filters.eventType !== undefined && entry.event_type !== filters.eventType) return false
  if (filters.sinceMs !== undefined && entry.timestamp_ms < filters.sinceMs) return false
  return true
}

function jsonFeedItem(baseUrl: string, entry: DecodedEntry): Record<string, unknown> {
  const hashHex = entry.record_hash.slice('sha256:'.length)
  return {
    id: entry.record_hash,
    url: `${baseUrl}/v1/lookup/${hashHex}`,
    title: `${entry.event_type} at log index ${entry.index}`,
    content_text: `atrib ${entry.event_type} entry ${entry.index} from ${entry.creator_key}`,
    date_published: new Date(entry.timestamp_ms).toISOString(),
    _atrib: entry,
  }
}

function requestBaseUrl(req: IncomingMessage): string {
  const proto = headerFirst(req.headers['x-forwarded-proto']) ?? 'http'
  const host = headerFirst(req.headers.host) ?? 'log.atrib.dev'
  return `${proto}://${host}`
}

function headerFirst(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return first?.split(',')[0]?.trim()
}

function parseFilterParams(
  params: URLSearchParams,
): { ok: true; filters: LogEntryFilters } | { ok: false; error: string } {
  for (const unsupported of ['topic', 'importance']) {
    if (params.has(unsupported)) {
      return {
        ok: false,
        error: `${unsupported} filter requires record-body indexing and is not supported by log-node subscriptions`,
      }
    }
  }

  const filters: LogEntryFilters = {}
  const creatorKey = params.get('creator_key')
  if (creatorKey !== null) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(creatorKey)) {
      return { ok: false, error: 'creator_key must be a 43-character base64url Ed25519 public key' }
    }
    filters.creatorKey = creatorKey
  }

  const contextId = params.get('context_id')
  if (contextId !== null) {
    if (!/^[0-9a-f]{32}$/.test(contextId)) {
      return { ok: false, error: 'context_id must be 32 lowercase hex characters' }
    }
    filters.contextId = contextId
  }

  const eventType = params.get('event_type')
  if (eventType !== null) {
    const normalized = normalizeEventTypeFilter(eventType)
    if (normalized === undefined) {
      return { ok: false, error: `unsupported event_type filter: ${eventType}` }
    }
    filters.eventType = normalized
  }

  const since = params.get('since')
  if (since !== null) {
    const parsed = parseSinceMs(since)
    if (parsed === undefined) {
      return {
        ok: false,
        error: 'since must be a non-negative millisecond timestamp or ISO timestamp',
      }
    }
    filters.sinceMs = parsed
  }

  return { ok: true, filters }
}

function normalizeEventTypeFilter(value: string): string | undefined {
  const byValue: Record<string, string> = {
    tool_call: 'tool_call',
    transaction: 'transaction',
    observation: 'observation',
    directory_anchor: 'directory_anchor',
    annotation: 'annotation',
    revision: 'revision',
    extension: 'extension',
    reserved: 'reserved',
    'https://atrib.dev/v1/types/tool_call': 'tool_call',
    'https://atrib.dev/v1/types/transaction': 'transaction',
    'https://atrib.dev/v1/types/observation': 'observation',
    'https://atrib.dev/v1/types/directory_anchor': 'directory_anchor',
    'https://atrib.dev/v1/types/annotation': 'annotation',
    'https://atrib.dev/v1/types/revision': 'revision',
  }
  return byValue[value]
}

function parseSinceMs(value: string): number | undefined {
  if (/^\d+$/.test(value)) {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : undefined
  }
  const t = Date.parse(value)
  return Number.isFinite(t) && t >= 0 ? t : undefined
}

function publicFilterShape(filters: LogEntryFilters): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  if (filters.creatorKey !== undefined) out.creator_key = filters.creatorKey
  if (filters.contextId !== undefined) out.context_id = filters.contextId
  if (filters.eventType !== undefined) out.event_type = filters.eventType
  if (filters.sinceMs !== undefined) out.since = filters.sinceMs
  return out
}

function handleStats(res: ServerResponse, tree: MerkleTree): void {
  const size = tree.size
  const signers = new Set<string>()
  const activeSigners24h = new Set<string>()
  const activeSigners7d = new Set<string>()
  let oldestTs: number | null = null
  let newestTs: number | null = null
  const eventTypeCounts = {
    tool_call: 0,
    transaction: 0,
    observation: 0,
    directory_anchor: 0,
    annotation: 0,
    revision: 0,
    extension: 0,
    reserved: 0,
  }
  const nowMs = Date.now()
  const cutoff24h = nowMs - 24 * 60 * 60 * 1000
  const cutoff7d = nowMs - 7 * 24 * 60 * 60 * 1000

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
    if (ts >= cutoff24h) activeSigners24h.add(creatorKeyHex)
    if (ts >= cutoff7d) activeSigners7d.add(creatorKeyHex)

    const eventType = e[89]!
    if (eventType === 0x01) eventTypeCounts.tool_call += 1
    else if (eventType === 0x02) eventTypeCounts.transaction += 1
    else if (eventType === 0x03) eventTypeCounts.observation += 1
    else if (eventType === 0x04) eventTypeCounts.directory_anchor += 1
    else if (eventType === 0x05) eventTypeCounts.annotation += 1
    else if (eventType === 0x06) eventTypeCounts.revision += 1
    else if (eventType === 0xff) eventTypeCounts.extension += 1
    else eventTypeCounts.reserved += 1
  }

  res.setHeader('cache-control', 'public, max-age=10')
  sendJson(res, 200, {
    tree_size: size,
    distinct_signers: signers.size,
    active_signers_24h: activeSigners24h.size,
    active_signers_7d: activeSigners7d.size,
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
  subscribers: Set<LogStreamSubscriber>,
  graphFanoutEndpoint: string | undefined,
  graphFanoutOptions: NormalizedGraphFanoutOptions,
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
    if (graphFanoutEndpoint) {
      fanoutToGraph(
        graphFanoutEndpoint,
        fullRecord,
        recordHashHex,
        cached.log_index,
        graphFanoutOptions,
      )
    }
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
  let appendedEntry: DecodedEntry | null = null
  try {
    // Re-check cache inside the lock. two concurrent requests for the same
    // record can both miss the fast-path check above, but only the first
    // should append. The second finds the proof cached by the first.
    const cachedInLock = proofCache.get(recordHashHex)
    if (cachedInLock !== undefined) {
      sendJson(res, 200, cachedInLock)
      if (graphFanoutEndpoint) {
        fanoutToGraph(
          graphFanoutEndpoint,
          fullRecord,
          recordHashHex,
          cachedInLock.log_index,
          graphFanoutOptions,
        )
      }
      return // finally block releases the lock
    }
    const logIndex = tree.append(entryBytes)
    appendedEntry = decodeEntry(entryBytes, logIndex)
    proof = await makeProofBundle(tree, signer, logIndex)

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
  if (appendedEntry) notifySubscribers(subscribers, appendedEntry, tree.size)

  // Fan out the full signed record to graph-node so the derived graph
  // stays in sync with the source-of-truth log. Fire-and-forget; failures
  // log a warning but never affect the submission. The fanout uses the
  // post-commit record bytes so any tampering between log and graph would
  // change the record_hash and be rejected by graph's verifyRecord step.
  if (graphFanoutEndpoint) {
    fanoutToGraph(
      graphFanoutEndpoint,
      fullRecord,
      recordHashHex,
      proof.log_index,
      graphFanoutOptions,
    )
  }
}

async function makeProofBundle(
  tree: MerkleTree,
  signer: CheckpointSigner,
  logIndex: number,
): Promise<ProofBundle> {
  const treeSize = tree.size
  const inclusionProof = tree.inclusionProof(logIndex)
  const leafHashBytes = tree.leafHash(logIndex)
  const rootHash = tree.root()
  const signedCheckpoint = await signer.sign(treeSize, rootHash)

  return {
    log_index: logIndex,
    checkpoint: signedCheckpoint,
    inclusion_proof: inclusionProof.map((h) => Buffer.from(h).toString('base64')),
    leaf_hash: Buffer.from(leafHashBytes).toString('base64'),
  }
}

function fanoutToGraph(
  endpoint: string,
  record: AtribRecord,
  recordHashHex: string,
  logIndex: number,
  options: NormalizedGraphFanoutOptions,
): void {
  void fanoutToGraphAttempt(endpoint, record, recordHashHex, logIndex, 1, options)
}

async function fanoutToGraphAttempt(
  endpoint: string,
  record: AtribRecord,
  recordHashHex: string,
  logIndex: number,
  attempt: number,
  options: NormalizedGraphFanoutOptions,
): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), options.timeoutMs)
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Carry the log_index so graph-node can apply revocation logic per §1.9.3.
        // graph-node treats this header as advisory; missing = log_index null.
        'x-atrib-log-index': String(logIndex),
      },
      body: JSON.stringify(record),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (r.ok) return
    if (attempt < options.maxAttempts) {
      await delay(options.retryDelayMs * attempt)
      return fanoutToGraphAttempt(endpoint, record, recordHashHex, logIndex, attempt + 1, options)
    }
    // eslint-disable-next-line no-console
    console.warn(
      `atrib-log: graph fanout for ${recordHashHex.slice(0, 12)}... returned ${r.status} after ${attempt} attempts`,
    )
  } catch (err: unknown) {
    clearTimeout(timer)
    if (attempt < options.maxAttempts) {
      await delay(options.retryDelayMs * attempt)
      return fanoutToGraphAttempt(endpoint, record, recordHashHex, logIndex, attempt + 1, options)
    }
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn(
      `atrib-log: graph fanout for ${recordHashHex.slice(0, 12)}... failed after ${attempt} attempts: ${msg}`,
    )
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
function handleTile(res: ServerResponse, tree: MerkleTree, level: number, index: number): void {
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
    const isFull = end - start === TILE_SIZE
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
  const isFull = end - start === TILE_SIZE
  sendBinary(res, data, isFull)
}

/**
 * §2.5.3: Serve an entry bundle (raw entry bytes with uint16 length prefixes).
 * Bundle N contains entries at positions [N*256, (N+1)*256).
 */
function handleEntryBundle(res: ServerResponse, tree: MerkleTree, index: number): void {
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
  const isFull = end - start === TILE_SIZE
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
  sendJsonWithContentType(res, status, body, 'application/json')
}

function sendJsonWithContentType(
  res: ServerResponse,
  status: number,
  body: unknown,
  contentType: string,
): void {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', contentType)
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
