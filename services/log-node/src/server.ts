// SPDX-License-Identifier: Apache-2.0

/**
 * HTTP server for @atrib/log-node, production log with real Merkle proofs.
 *
 * Endpoints:
 *   POST /v1/entries    , submit a signed attribution record
 *   GET  /v1/checkpoint , return the latest signed checkpoint as text/plain
 *
 * Validation follows §2.6.1 Steps 1-6.
 *
 * All hashes in the JSON response are standard base64 (RFC 4648 §4, with
 * padding), matching the tlog-tiles checkpoint format.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { canonicalRecord, validateSubmission, verifyRecord, hexEncode } from '@atrib/mcp'
import type { AtribRecord, ProofBundle } from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'
import { serializeEntry } from './entry.js'
import type { MerkleTree } from './tree.js'
import type { CheckpointSigner } from './checkpoint.js'

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
): Promise<ServerHandle> {
  // Dedup cache: record_hash hex → proof bundle
  // Bounded to MAX_PROOF_CACHE entries (~30MB at ~300 bytes/entry).
  // NOTE: Idempotency is best-effort. After cache eviction, re-submission
  // of the same record will append a new entry with a different log_index
  // and a fresh proof. Both proofs are independently valid. The spec allows
  // this: §2.6.1 Step 6 says "return the existing inclusion proof" as a
  // SHOULD, not a MUST, for implementations with bounded caches.
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

  // Protect against Slowloris and slow-request DoS attacks
  server.headersTimeout = 5_000 // 5 seconds to receive headers
  server.requestTimeout = 30_000 // 30 seconds for full request

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

  sendJson(res, 404, {
    error: 'not found',
    hint: 'Available endpoints: POST /v1/entries, GET /v1/checkpoint',
  })
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  tree: MerkleTree,
  signer: CheckpointSigner,
  proofCache: Map<string, ProofBundle>,
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
    return reject(res, 400, 'body must be a json object, the bare attribution record per §2.6.1')
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

  // §2.6.1 Step 6: idempotency, return existing proof if already submitted
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
    // Node-only: this service runs server-side only
    inclusion_proof: inclusionProof.map((h) => Buffer.from(h).toString('base64')),
    leaf_hash: Buffer.from(leafHashBytes).toString('base64'),
  }

  // Cache for idempotency, evict oldest entry if at capacity
  if (proofCache.size >= MAX_PROOF_CACHE) {
    const oldest = proofCache.keys().next().value
    if (oldest !== undefined) proofCache.delete(oldest)
  }
  proofCache.set(recordHashHex, proof)

  sendJson(res, 200, proof)
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

  const rootHash = tree.root()
  const signedCheckpoint = await signer.sign(tree.size, rootHash)

  const checkpointBytes = Buffer.byteLength(signedCheckpoint)
  res.statusCode = 200
  res.setHeader('content-type', 'text/plain')
  res.setHeader('content-length', checkpointBytes)
  res.end(signedCheckpoint)
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

const MAX_BODY_BYTES = 64 * 1024 // 64 KB, an AtribRecord is always small

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
