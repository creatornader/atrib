/**
 * HTTP server for @atrib/log-node — production log with real Merkle proofs.
 *
 * Endpoints:
 *   POST /v1/entries     — submit a signed attribution record
 *   GET  /v1/checkpoint  — return the latest signed checkpoint as text/plain
 *
 * Validation follows §2.6.1 Steps 2-6. Step 1 (signature verification) is
 * intentionally skipped here — it lives in @atrib/verify and would create a
 * circular dep. Callers needing full verification should run @atrib/verify
 * separately.
 *
 * All hashes in the JSON response are standard base64 (RFC 4648 §4, with
 * padding), matching the tlog-tiles checkpoint format.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { canonicalRecord } from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'
import type { AtribRecord } from '@atrib/mcp'
import { serializeEntry } from './entry.js'
import type { MerkleTree } from './tree.js'
import type { CheckpointSigner } from './checkpoint.js'

const VALID_EVENT_TYPES = new Set(['tool_call', 'transaction'])
const SPEC_VERSION = 'atrib/1.0'
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000 // §2.6.1 Step 4: 10 minutes

/**
 * In-memory duplicate detection cache. Keyed by record_hash hex → serialized
 * proof bundle (so we can return the exact same proof on re-submission).
 */
export interface ProofBundle {
  log_index: number
  checkpoint: string
  inclusion_proof: string[]
  leaf_hash: string
}

export interface ServerHandle {
  url: string
  close(): Promise<void>
}

/**
 * Bind an HTTP server that handles POST /v1/entries and GET /v1/checkpoint.
 */
export async function bindServer(
  tree: MerkleTree,
  signer: CheckpointSigner,
  port: number,
): Promise<ServerHandle> {
  // Dedup cache: record_hash hex → proof bundle
  const proofCache = new Map<string, ProofBundle>()

  const server = createServer((req, res) => {
    handleRequest(req, res, tree, signer, proofCache).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('atrib-log-node: request handler crashed', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'internal error' }))
      }
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('atrib-log-node: server.address() returned unexpected shape')
  }
  const url = `http://127.0.0.1:${address.port}`

  return {
    url,
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
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
): Promise<void> {
  if (req.method === 'POST' && req.url === '/v1/entries') {
    return handleSubmit(req, res, tree, signer, proofCache)
  }

  if (req.method === 'GET' && req.url === '/v1/checkpoint') {
    return handleCheckpoint(res, tree, signer)
  }

  res.statusCode = 404
  res.setHeader('content-type', 'application/json')
  res.end(
    JSON.stringify({
      error: 'not found',
      hint: 'Available endpoints: POST /v1/entries, GET /v1/checkpoint',
    }),
  )
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
): Promise<void> {
  const body = await readBody(req)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return reject(res, 400, 'invalid json body')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return reject(res, 400, 'body must be a json object — the bare attribution record per §2.6.1')
  }

  const record = parsed as Partial<AtribRecord>

  // §2.6.1 Step 2: spec_version must be 'atrib/1.0'
  if (record.spec_version !== SPEC_VERSION) {
    return reject(
      res,
      400,
      `spec_version must be '${SPEC_VERSION}', got ${JSON.stringify(record.spec_version)}`,
    )
  }

  // §2.6.1 Step 3: event_type must be a known value
  if (typeof record.event_type !== 'string' || !VALID_EVENT_TYPES.has(record.event_type)) {
    return reject(
      res,
      400,
      `event_type must be one of ${[...VALID_EVENT_TYPES].join(', ')}, got ${JSON.stringify(record.event_type)}`,
    )
  }

  // §2.6.1 Step 4: timestamp not more than 10 minutes in the future
  if (typeof record.timestamp !== 'number') {
    return reject(res, 400, 'timestamp must be a number (ms since epoch)')
  }
  if (record.timestamp - Date.now() > MAX_FUTURE_SKEW_MS) {
    return reject(res, 400, 'timestamp is more than 10 minutes in the future')
  }

  // §2.6.1 Step 5: context_id must be exactly 32 lowercase hex chars
  if (
    typeof record.context_id !== 'string' ||
    !/^[0-9a-f]{32}$/.test(record.context_id)
  ) {
    return reject(res, 400, 'context_id must be 32 lowercase hex characters')
  }

  // Required string fields for record_hash computation
  for (const field of ['creator_key', 'chain_root', 'content_id', 'signature'] as const) {
    if (typeof record[field] !== 'string') {
      return reject(res, 400, `${field} is required and must be a string`)
    }
  }

  const fullRecord = record as AtribRecord

  // Compute record_hash: SHA-256 of JCS canonical bytes
  const canonBytes = canonicalRecord(fullRecord)
  const recordHashBytes = sha256(canonBytes)
  const recordHashHex = bytesToHex(recordHashBytes)

  // §2.6.1 Step 6: idempotency — return existing proof if already submitted
  const cached = proofCache.get(recordHashHex)
  if (cached !== undefined) {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(cached))
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

  // Append to Merkle tree
  const logIndex = tree.append(entryBytes)

  // Generate inclusion proof
  const inclusionProof = tree.inclusionProof(logIndex)

  // Get cached leaf hash for this entry
  const leafHashBytes = tree.leafHash(logIndex)

  // Sign a checkpoint covering the current tree state
  const rootHash = tree.root()
  const signedCheckpoint = await signer.sign(tree.size, rootHash)

  const proof: ProofBundle = {
    log_index: logIndex,
    checkpoint: signedCheckpoint,
    inclusion_proof: inclusionProof.map((h) => Buffer.from(h).toString('base64')),
    leaf_hash: Buffer.from(leafHashBytes).toString('base64'),
  }

  // Cache for idempotency
  proofCache.set(recordHashHex, proof)

  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(proof))
}

async function handleCheckpoint(
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
): Promise<void> {
  if (tree.size === 0) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'no entries yet' }))
    return
  }

  const rootHash = tree.root()
  const signedCheckpoint = await signer.sign(tree.size, rootHash)

  res.statusCode = 200
  res.setHeader('content-type', 'text/plain')
  res.end(signedCheckpoint)
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

const MAX_BODY_BYTES = 64 * 1024 // 64 KB — an AtribRecord is always small

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
