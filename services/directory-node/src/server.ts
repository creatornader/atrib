// services/directory-node, HTTP server
//
// Implements spec §6.2 directory operations:
//   POST   /v6/publish      , publish a signed identity claim
//   GET    /v6/lookup/:key  , lookup current claim for a creator_key
//   GET    /v6/history/:key , full version chain for a creator_key
//   GET    /v6/anchor       , latest anchored snapshot (epoch + root_hash)
//   GET    /v6/audit-proof  , append-only consistency proof between epochs
//
// Per §6.2.4 per-operation anchoring (D034 + D050 sibling): every successful
// publish triggers a `directory_anchor` record submission to the configured
// atrib log endpoint, so the directory state at each epoch is provable
// against the log's witness-cosigned checkpoints.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AtribDirectory } from '@atrib/directory'
import type { IdentityClaim } from '@atrib/directory'
import { verifyClaimSignature } from '@atrib/directory'
import { emitDirectoryAnchor } from './anchor.js'

export interface DirectoryServerConfig {
  /** Operator's Ed25519 32-byte seed for signing directory checkpoints. */
  operatorPrivateKey: Uint8Array
  /** Public origin string for this directory (e.g., `directory.atrib.dev/v6`). */
  origin: string
  /** atrib log endpoint to anchor checkpoints into. When undefined, anchoring is skipped (dev only). */
  logEndpoint?: string
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

export async function bindDirectoryServer(
  port: number,
  host: string,
  config: DirectoryServerConfig,
): Promise<DirectoryServerHandle> {
  const directory = await AtribDirectory.create(config.operatorPrivateKey)

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
    void handle(req, res, url, directory, config).catch((e) => {
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
): Promise<void> {
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

    // §6.2.4 per-operation anchoring: emit directory_anchor record after each publish.
    let anchor: { record_hash?: string; submitted: boolean; error?: string } = { submitted: false }
    if (config.logEndpoint) {
      anchor = await emitDirectoryAnchor({
        logEndpoint: config.logEndpoint,
        directoryOrigin: config.origin,
        operatorPrivateKey: config.operatorPrivateKey,
        epoch: snapshot.epoch,
        rootHash: snapshot.root_hash,
      })
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
