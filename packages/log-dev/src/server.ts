/**
 * HTTP server for `@atrib/log-dev`.
 *
 * Implements the spec §2.6 submission API with the minimum surface needed
 * by `@atrib/mcp`'s submission queue:
 *
 *   POST /v1/entries — submit a signed attribution record
 *
 * Validation follows §2.6.1 Steps 1-6 except for the cryptographic
 * signature verification (Step 1), which the dev log skips because we
 * don't want a hard dependency on the verification path (verify lives in
 * `@atrib/verify` and would create a circular workspace dep). The dev log
 * is honest about this in its inspection API — anyone using the dev log
 * for end-to-end correctness testing should also run `@atrib/verify` on
 * the captured records separately.
 *
 * Reads the `X-Atrib-Priority` header (extension to §2.6.1, see
 * `@atrib/mcp/src/submission.ts` file header for the rationale on the two
 * real consumers of priority). Forwards the header value to the storage
 * layer's priority queue for admission control.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { canonicalRecord } from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'
import type { AtribRecord } from '@atrib/mcp'
import type { Storage, Priority } from './storage.js'
import { buildProofBundle } from './proof.js'

const VALID_EVENT_TYPES = new Set(['tool_call', 'transaction'])
const SPEC_VERSION = 'atrib/1.0'
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000 // §2.6.1 Step 4: 10 minutes

export interface ServerHandle {
  /** Base URL the server is listening on (e.g. `http://127.0.0.1:54321`). */
  url: string
  /** Stop the HTTP server and release the port. */
  close(): Promise<void>
}

/**
 * Bind an HTTP server to the given port and route POST /v1/entries to the
 * storage layer. Returns the bound URL and a `close()` function.
 */
export async function bindServer(
  storage: Storage,
  port: number,
): Promise<ServerHandle> {
  const server = createServer((req, res) => {
    handleRequest(req, res, storage).catch((err) => {
      // Last-resort error handler. The dev log is non-critical
      // infrastructure; if anything in the request handler throws, log
      // it and return 500 rather than crashing the process.
      // eslint-disable-next-line no-console
      console.error('atrib-log-dev: request handler crashed', err)
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
    throw new Error('atrib-log-dev: server.address() returned unexpected shape')
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
  storage: Storage,
): Promise<void> {
  // Only POST /v1/entries is implemented for the dev log. Everything else
  // returns 404 with a hint about which endpoints exist.
  if (req.method !== 'POST' || req.url !== '/v1/entries') {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'not found',
        hint: 'POST /v1/entries is the only endpoint @atrib/log-dev implements',
      }),
    )
    return
  }

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

  // Spec §2.6.1 Step 1 (signature verification) is intentionally skipped
  // by the dev log — see file header. The other shape checks above are
  // sufficient to catch most client-side bugs at integration time.

  // The body MUST also have creator_key, chain_root, content_id, and
  // signature for the record to be a valid AtribRecord shape. We don't
  // semantically validate them but we do require their presence so the
  // dev log can compute a record_hash.
  for (const field of ['creator_key', 'chain_root', 'content_id', 'signature'] as const) {
    if (typeof record[field] !== 'string') {
      return reject(res, 400, `${field} is required and must be a string`)
    }
  }

  const fullRecord = record as AtribRecord
  const recordHashBytes = sha256(canonicalRecord(fullRecord))
  const recordHash = bytesToHex(recordHashBytes)

  // Read the priority header. Defaults to 'normal' for spec compliance —
  // a real Tessera log would also default to normal when the extension
  // header is absent.
  const priorityHeader = (req.headers['x-atrib-priority'] ?? 'normal') as string
  const priority: Priority = priorityHeader === 'high' ? 'high' : 'normal'

  // Submit to storage. The storage layer handles idempotency (§2.6.1 Step 6)
  // and the priority queue. This await may suspend if storage is at its
  // maxConcurrent capacity — that's the intended admission-control behavior.
  const entry = await storage.submit(fullRecord, recordHash, priority)

  // Build a well-formed proof bundle per §2.6.2 (placeholder hashes).
  const proof = buildProofBundle(entry, storage.size)

  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(proof))
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
