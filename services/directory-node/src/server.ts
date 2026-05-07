// services/directory-node — HTTP server
//
// Implements spec §6.2 directory operations:
//   POST   /v6/publish       — publish a signed identity claim
//   GET    /v6/lookup/:key   — lookup current claim for a creator_key
//   GET    /v6/history/:key  — full version chain for a creator_key
//   GET    /v6/anchor        — latest anchored snapshot (epoch + root_hash)
//   GET    /v6/audit-proof   — append-only consistency proof between epochs
//
// Per §6.2.4 per-operation anchoring (D034 + D050 sibling): every successful
// publish triggers a `directory_anchor` record submission to the configured
// atrib log endpoint, so the directory state at each epoch is provable
// against the log's witness-cosigned checkpoints.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { AtribDirectory } from '@atrib/directory'
import type { IdentityClaim } from '@atrib/directory'
import { verifyClaimSignature } from '@atrib/directory'
import { emitDirectoryAnchor, type AnchorRecord } from './anchor.js'

/**
 * In-memory anchor history. Each successful `emitDirectoryAnchor` adds
 * the signed body to this map keyed by record_hash, plus to a parallel
 * timestamp-ordered array for `/v6/anchors?since=&limit=` queries.
 *
 * Spec §6.3 step 1 verifiers need anchor BODIES (the body holds
 * directory_root + directory_epoch); the log retains only commitments
 * (90-byte hash + metadata). Until the §2.12 record-body archive layer
 * ships (D070 placeholder ADR), each producer hosts its own bodies.
 *
 * Transition plan when §2.12 ships: this in-memory map stays useful
 * for directory-specific queries (e.g., "all anchors from epoch N to
 * M") but the plain body retrieval path moves to the standard archive
 * endpoint. Verifier callers swap the body-fetch endpoint URL; the
 * record shape stays identical.
 *
 * Persistence: in-memory only. Lost on restart (same as the AKD state).
 * Production durability would store these alongside `persistencePath`
 * but that's not yet implemented.
 */
class AnchorHistory {
  private byHash = new Map<string, AnchorRecord>()
  private chronological: AnchorRecord[] = []

  add(record: AnchorRecord, recordHash: string): void {
    if (this.byHash.has(recordHash)) return
    this.byHash.set(recordHash, record)
    this.chronological.push(record)
  }

  getByHash(recordHash: string): AnchorRecord | undefined {
    return this.byHash.get(recordHash)
  }

  /**
   * Return anchors in newest-first order. `since` filters to anchors
   * whose timestamp is strictly greater than the cutoff. `limit` caps
   * the response (default 100, max 1000).
   */
  recent(since?: number, limit = 100): AnchorRecord[] {
    const cap = Math.min(Math.max(1, limit), 1000)
    const filtered = typeof since === 'number'
      ? this.chronological.filter(r => r.timestamp > since)
      : this.chronological
    return [...filtered].reverse().slice(0, cap)
  }

  size(): number {
    return this.chronological.length
  }
}

export interface DirectoryServerConfig {
  /** Operator's Ed25519 32-byte seed for signing directory checkpoints. */
  operatorPrivateKey: Uint8Array
  /** Public origin string for this directory (e.g., `directory.atrib.dev/v6`). */
  origin: string
  /** atrib log endpoint to anchor checkpoints into. When undefined, anchoring is skipped (dev only). */
  logEndpoint?: string
  /**
   * Path to an append-only JSONL of every successful publish (one signed
   * IdentityClaim per line). When set, on startup the server reads the file
   * and replays each publish into a fresh in-memory AKD; the replay produces
   * identical epoch numbers and root hashes because AKD publish is
   * deterministic given the same input sequence. Without this, a restart
   * loses all prior claims.
   *
   * For per-operation anchoring to remain coherent across restarts the file
   * MUST be on a persistent volume (e.g., a Fly mount). Without persistence,
   * anchoring still emits, but lookups for previously-published keys fail
   * after restart.
   */
  persistencePath?: string
}

export interface DirectoryServerHandle {
  url: string
  directory: AtribDirectory
  close(): Promise<void>
}

const CREATOR_KEY_RE = /^[A-Za-z0-9_-]{43}$/  // base64url Ed25519 pubkey (no padding)

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function problemResponse(res: ServerResponse, status: number, type: string, title: string, detail: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/problem+json')
  res.end(JSON.stringify({ type: `https://atrib.dev/problems/${type}`, title, status, detail }))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(text)
}

async function replayPersistedClaims(directory: AtribDirectory, path: string): Promise<number> {
  if (!existsSync(path)) return 0
  const text = await readFile(path, 'utf-8')
  let count = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let claim: IdentityClaim
    try {
      claim = JSON.parse(trimmed) as IdentityClaim
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`directory-node: skipping unparsable persistence line`)
      continue
    }
    // Defensive: re-verify the signature on replay. A persistence-file tamper
    // shouldn't be able to inject claims; the AKD root would diverge anyway.
    if (!(await verifyClaimSignature(claim))) {
      // eslint-disable-next-line no-console
      console.warn(`directory-node: skipping persisted claim with invalid signature for ${claim.creator_key}`)
      continue
    }
    await directory.publishSigned(claim)
    count += 1
  }
  return count
}

export async function bindDirectoryServer(
  port: number,
  host: string,
  config: DirectoryServerConfig,
): Promise<DirectoryServerHandle> {
  const directory = await AtribDirectory.create(config.operatorPrivateKey)
  const anchorHistory = new AnchorHistory()

  if (config.persistencePath) {
    await mkdir(dirname(config.persistencePath), { recursive: true })
    const replayed = await replayPersistedClaims(directory, config.persistencePath)
    if (replayed > 0) {
      // eslint-disable-next-line no-console
      console.log(`directory-node: replayed ${replayed} persisted claim${replayed === 1 ? '' : 's'} from ${config.persistencePath}`)
    }
  }

  const server = createServer((req, res) => {
    // CORS for browser-based dashboards (D054). Read endpoints serve public data per spec §6;
    // browser cross-origin reads are explicitly permitted. Write endpoints (POST /v6/publish)
    // also accept cross-origin since the operator-key signature on the claim is the only auth.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    void handle(req, res, url, directory, config, anchorHistory).catch((e) => {
      problemResponse(res, 500, 'internal-error', 'Internal Server Error', String(e))
    })
  })

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
  const addr = server.address()
  const boundPort = typeof addr === 'object' && addr ? addr.port : port

  return {
    url: `http://${host}:${boundPort}`,
    directory,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  directory: AtribDirectory,
  config: DirectoryServerConfig,
  anchorHistory: AnchorHistory,
): Promise<void> {
  // Service-info index. Both the bare hostname (/) and the version-scoped
  // base (/v6) return the same discovery JSON. Without this handler, GET
  // https://directory.atrib.dev/ and /v6 both 404, which is confusing
  // because READMEs and the CLI default both write the URL as if browsable.
  // Mirrors the pattern in log-node and graph-node so all three services
  // share a uniform discovery surface. Endpoint URLs are derived from
  // CURRENT_VERSION; a future major version bump (e.g. v7) is a single
  // constant change plus an append to SUPPORTED_VERSIONS.
  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '' ||
     url.pathname === '/v6' || url.pathname === '/v6/')
  ) {
    const CURRENT_VERSION = 'v6'
    const SUPPORTED_VERSIONS = ['v6']
    const v = CURRENT_VERSION
    jsonResponse(res, 200, {
      service: 'atrib-directory-node',
      versions: SUPPORTED_VERSIONS,
      current_version: CURRENT_VERSION,
      origin: config.origin,
      spec: 'https://github.com/creatornader/atrib/blob/main/atrib-spec.md#6-key-directory',
      endpoints: {
        publish: `POST /${v}/publish`,
        lookup: `GET /${v}/lookup/<creator_key>`,
        history: `GET /${v}/history/<creator_key>`,
        anchor: `GET /${v}/anchor`,
        anchors: `GET /${v}/anchors?since=<ms>&limit=<n>`,
        anchor_by_hash: `GET /${v}/anchors/<record_hash>`,
        audit_proof: `GET /${v}/audit-proof?from=N&to=M`,
      },
      explorer: 'https://explore.atrib.dev/',
      note: 'This base URL has no browsable UI. Use the endpoints listed above. The public explorer at https://explore.atrib.dev/ composes log + graph + directory reads into a unified surface.',
    })
    return
  }

  // POST /v6/publish
  if (req.method === 'POST' && url.pathname === '/v6/publish') {
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      problemResponse(res, 400, 'malformed-json', 'Bad Request', 'request body is not valid JSON')
      return
    }
    const claim = body as IdentityClaim
    if (!claim || typeof claim !== 'object' || !claim.creator_key || !claim.signature) {
      problemResponse(res, 400, 'invalid-claim', 'Bad Request', 'claim missing required fields')
      return
    }
    if (!CREATOR_KEY_RE.test(claim.creator_key)) {
      problemResponse(res, 400, 'invalid-creator-key', 'Bad Request', 'creator_key must be base64url Ed25519 pubkey')
      return
    }
    if (!(await verifyClaimSignature(claim))) {
      problemResponse(res, 400, 'invalid-claim-signature', 'Bad Request', 'claim signature does not verify')
      return
    }

    const { epoch } = await directory.publishSigned(claim)
    const snapshot = await directory.currentSnapshot()

    // Append to persistence log AFTER successful publish. Order matters: AKD
    // replay on restart depends on the persisted sequence matching the live
    // sequence. If the append fails (disk full, etc.) we still respond 200 —
    // the in-memory state is correct, but a restart will lose this claim.
    if (config.persistencePath) {
      try {
        await appendFile(config.persistencePath, JSON.stringify(claim) + '\n', { mode: 0o600 })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`directory-node: persistence append failed for ${claim.creator_key}:`, e)
      }
    }

    // §6.2.4 per-operation anchoring: emit directory_anchor record after each publish.
    let anchor: { record_hash?: string; submitted: boolean; error?: string } = { submitted: false }
    if (config.logEndpoint) {
      const result = await emitDirectoryAnchor({
        logEndpoint: config.logEndpoint,
        directoryOrigin: config.origin,
        operatorPrivateKey: config.operatorPrivateKey,
        epoch: snapshot.epoch,
        rootHash: snapshot.root_hash,
      })
      if (result.record && result.record_hash) {
        anchorHistory.add(result.record, result.record_hash)
      }
      anchor = { record_hash: result.record_hash, submitted: result.submitted, ...(result.error ? { error: result.error } : {}) }
    }

    jsonResponse(res, 200, {
      epoch,
      root_hash: snapshot.root_hash,
      anchor,
    })
    return
  }

  // GET /v6/lookup/:creator_key
  if (req.method === 'GET' && url.pathname.startsWith('/v6/lookup/')) {
    const key = url.pathname.slice('/v6/lookup/'.length)
    if (!CREATOR_KEY_RE.test(key)) {
      problemResponse(res, 400, 'invalid-creator-key', 'Bad Request', 'creator_key must be base64url Ed25519 pubkey')
      return
    }
    const result = await directory.lookup(key)
    if (!result.claim) {
      jsonResponse(res, 404, { found: false, label: key, absence_proof: null })
      return
    }
    const snapshot = await directory.currentSnapshot()
    jsonResponse(res, 200, {
      found: true,
      claim: result.claim,
      version: result.version,
      proof: Buffer.from(result.proof).toString('base64url'),
      epoch: snapshot.epoch,
      directory_root: snapshot.root_hash,
    })
    return
  }

  // GET /v6/history/:creator_key
  if (req.method === 'GET' && url.pathname.startsWith('/v6/history/')) {
    const key = url.pathname.slice('/v6/history/'.length)
    if (!CREATOR_KEY_RE.test(key)) {
      problemResponse(res, 400, 'invalid-creator-key', 'Bad Request', 'creator_key must be base64url Ed25519 pubkey')
      return
    }
    const history = await directory.history(key)
    const snapshot = await directory.currentSnapshot()
    jsonResponse(res, 200, {
      versions: history.versions,
      proof: Buffer.from(history.proof).toString('base64url'),
      epoch: snapshot.epoch,
      directory_root: snapshot.root_hash,
    })
    return
  }

  // GET /v6/anchor
  if (req.method === 'GET' && url.pathname === '/v6/anchor') {
    const snapshot = await directory.currentSnapshot()
    jsonResponse(res, 200, {
      epoch: snapshot.epoch,
      root_hash: snapshot.root_hash,
      directory_origin: config.origin,
    })
    return
  }

  // GET /v6/anchors/<record_hash> — point lookup of an anchor body by hash.
  // The record_hash format mirrors the `sha256:<64hex>` shape stored in the
  // log + carried in canonical record fields. Used by spec §6.3 step 1
  // verifiers after they discover an anchor commitment on the log via
  // `GET /v1/by-context/...` on log-node — the verifier reads the body
  // here to recover directory_root + directory_epoch + signature.
  //
  // Transitional path. When the §2.12 record-body archive layer ships
  // (D070 placeholder), plain body retrieval moves to the standard
  // archive endpoint; this endpoint stays as a directory-specific
  // surface but is no longer the only way to reach the body.
  const anchorByHashMatch = url.pathname.match(/^\/v6\/anchors\/(sha256:[0-9a-f]{64})$/)
  if (req.method === 'GET' && anchorByHashMatch) {
    const recordHash = anchorByHashMatch[1]!
    const record = anchorHistory.getByHash(recordHash)
    if (!record) {
      problemResponse(res, 404, 'anchor-not-found', 'Not Found', `no anchor with record_hash ${recordHash}`)
      return
    }
    res.setHeader('cache-control', 'public, max-age=60')
    jsonResponse(res, 200, { record_hash: recordHash, record })
    return
  }

  // GET /v6/anchors?since=<ms>&limit=<n> — recent anchors in newest-first
  // order. Used by §6.3 step 1 verifiers walking back to find the anchor
  // closest to (but not after) a record's timestamp T, and by §6.3 step 5
  // verifiers walking back from the latest anchor to its predecessor for
  // the audit-proof input pair.
  if (req.method === 'GET' && url.pathname === '/v6/anchors') {
    const sinceStr = url.searchParams.get('since')
    const limitStr = url.searchParams.get('limit')
    const since = sinceStr ? Number(sinceStr) : undefined
    const limit = limitStr ? Number(limitStr) : 100
    if (sinceStr !== null && (!Number.isFinite(since) || (since as number) < 0)) {
      problemResponse(res, 400, 'invalid-since', 'Bad Request', 'since must be a non-negative integer (unix ms)')
      return
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      problemResponse(res, 400, 'invalid-limit', 'Bad Request', 'limit must be a positive integer')
      return
    }
    const records = anchorHistory.recent(since, limit)
    res.setHeader('cache-control', 'public, max-age=10')
    jsonResponse(res, 200, {
      total_anchors: anchorHistory.size(),
      since: since ?? null,
      limit,
      count: records.length,
      anchors: records,
    })
    return
  }

  // GET /v6/audit-proof?from=N&to=M
  if (req.method === 'GET' && url.pathname === '/v6/audit-proof') {
    const fromStr = url.searchParams.get('from')
    const toStr = url.searchParams.get('to')
    const from = fromStr ? Number(fromStr) : NaN
    const to = toStr ? Number(toStr) : NaN
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
      problemResponse(res, 400, 'invalid-epoch-range', 'Bad Request', 'from + to must be non-negative integers with to >= from')
      return
    }
    const proof = await directory.auditProof(from, to)
    jsonResponse(res, 200, {
      from_epoch: from,
      to_epoch: to,
      proof: Buffer.from(proof).toString('base64url'),
    })
    return
  }

  problemResponse(res, 404, 'not-found', 'Not Found', `no route for ${req.method} ${url.pathname}`)
}
