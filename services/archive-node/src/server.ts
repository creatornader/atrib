// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { verifyRecord as verifyAtribRecord } from '@atrib/verify'
import {
  ArchiveStore,
  normalizeArchiveSubmission,
  recordHash,
  type ArchiveLookupResult,
  type ArchiveStoreOptions,
  type StoredArchiveEntry,
} from './store.js'

export interface ArchiveServerConfig {
  origin: string
  trustedLogEndpoints?: string[]
  persistencePath?: string
  retentionWindowMs?: number
  bestEffort?: string | number | null
  archivedAfterMs?: number | null
  policyUrl?: string
  allowUncommittedRecords?: boolean
  nowMs?: () => number
  fetchImpl?: typeof fetch
}

export interface ArchiveServerHandle {
  url: string
  store: ArchiveStore
  close(): Promise<void>
}

const DEFAULT_RETENTION_WINDOW_MS = 365 * 24 * 60 * 60 * 1000
const DEFAULT_LOG_ENDPOINTS = ['https://log.atrib.dev/v1']
const MAX_BODY_BYTES = 2_000_000

export async function bindArchiveServer(
  port: number,
  host: string,
  config: ArchiveServerConfig,
): Promise<ArchiveServerHandle> {
  const storeOptions: ArchiveStoreOptions = {
    retentionWindowMs: config.retentionWindowMs ?? DEFAULT_RETENTION_WINDOW_MS,
    ...(config.persistencePath ? { persistencePath: config.persistencePath } : {}),
    ...(config.nowMs ? { nowMs: config.nowMs } : {}),
  }
  const store = new ArchiveStore(storeOptions)
  const replayed = await store.init()
  if (replayed > 0) {
    // eslint-disable-next-line no-console
    console.log(`archive-node: replayed ${replayed} archived record${replayed === 1 ? '' : 's'}`)
  }

  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://archive.local')
    void handle(req, res, url, store, config).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('archive-node internal error', err)
      problem(res, 500, 'internal-error', 'Internal Server Error', 'unexpected archive-node error')
    })
  })

  server.headersTimeout = 5_000
  server.requestTimeout = 30_000

  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
  const addr = server.address()
  const boundPort = typeof addr === 'object' && addr ? addr.port : port

  return {
    url: `http://${host}:${boundPort}`,
    store,
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
  store: ArchiveStore,
  config: ArchiveServerConfig,
): Promise<void> {
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/v1')) {
    return json(res, 200, serviceInfo(config))
  }

  if (req.method === 'GET' && url.pathname === '/v1/retention') {
    return json(res, 200, retentionManifest(config))
  }

  if (req.method === 'POST' && url.pathname === '/v1/records') {
    return handleSubmit(req, res, store, config)
  }

  const recordMatch = url.pathname.match(/^\/v1\/record\/([0-9a-f]{64})$/)
  if (req.method === 'GET' && recordMatch) {
    return handleRecord(res, store.get(`sha256:${recordMatch[1]!}`), false)
  }

  const evidenceMatch = url.pathname.match(/^\/v1\/evidence\/([0-9a-f]{64})$/)
  if (req.method === 'GET' && evidenceMatch) {
    return handleRecord(res, store.get(`sha256:${evidenceMatch[1]!}`), true)
  }

  return json(res, 404, {
    error: 'not found',
    hint: 'Available endpoints: POST /v1/records, GET /v1/record/<record_hash_hex>, GET /v1/evidence/<record_hash_hex>, GET /v1/retention',
  })
}

async function handleSubmit(
  req: IncomingMessage,
  res: ServerResponse,
  store: ArchiveStore,
  config: ArchiveServerConfig,
): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readBody(req))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid JSON body'
    return problem(res, message.includes('too large') ? 413 : 400, 'bad-request', 'Bad Request', message)
  }

  let submission: ReturnType<typeof normalizeArchiveSubmission>
  try {
    submission = normalizeArchiveSubmission(parsed)
  } catch (err) {
    return problem(res, 400, 'bad-archive-submission', 'Bad Request', String(err))
  }

  const verification = await verifyAtribRecord(submission.record)
  if (!verification.signatureOk) {
    return problem(
      res,
      400,
      'record-signature-invalid',
      'Bad Request',
      'record signature did not verify',
    )
  }

  const computedHash = recordHash(submission.record)
  const commitment = await confirmLogCommitment(computedHash, config)
  if (!commitment.ok) {
    return problem(res, 409, 'log-commitment-missing', 'Conflict', commitment.error)
  }

  let stored: Awaited<ReturnType<ArchiveStore['put']>>
  try {
    stored = await store.put(submission)
  } catch (err) {
    return problem(res, 400, 'bad-archive-submission', 'Bad Request', String(err))
  }

  const body = await publicRecordResponse(stored.entry)
  return json(res, stored.created ? 201 : 200, body)
}

async function handleRecord(
  res: ServerResponse,
  lookup: ArchiveLookupResult,
  evidenceOnly: boolean,
): Promise<void> {
  if (lookup.status === 'missing') {
    return json(res, 404, { error: 'not archived' })
  }
  if (lookup.status === 'expired') {
    return json(res, 410, {
      error: 'retention expired',
      record_hash: lookup.entry.record_hash,
      retention_window_ms: lookup.entry.retention_window_ms,
      archived_at_ms: lookup.entry.archived_at_ms,
      expired_at_ms: lookup.expired_at_ms,
    })
  }
  const body = await publicRecordResponse(lookup.entry)
  if (evidenceOnly) {
    return json(res, 200, {
      record_hash: body.record_hash,
      archived_at_ms: body.archived_at_ms,
      retention_window_ms: body.retention_window_ms,
      record_summary: body.record_summary,
      resolved_facts: body.resolved_facts,
      evidence: body.evidence,
    })
  }
  return json(res, 200, body)
}

async function publicRecordResponse(entry: StoredArchiveEntry): Promise<Record<string, unknown>> {
  const verifyOptions = {
    authorizationEvidence: entry.authorizationEvidence,
    ...(entry.resolvedFacts ? { resolvedFacts: entry.resolvedFacts } : {}),
  }
  const computedEvidence =
    entry.authorizationEvidence.length > 0
      ? (await verifyAtribRecord(entry.record, verifyOptions)).evidence ?? []
      : []
  const evidence = dedupeEvidence([...entry.evidence, ...computedEvidence])
  return {
    record_hash: entry.record_hash,
    record: entry.record,
    log_proofs: entry.log_proofs,
    archived_at_ms: entry.archived_at_ms,
    retention_window_ms: entry.retention_window_ms,
    record_summary: {
      creator_key: entry.record.creator_key,
      context_id: entry.record.context_id,
      event_type: entry.record.event_type,
      timestamp: entry.record.timestamp,
      content_id: entry.record.content_id,
    },
    ...(entry.resolvedFacts ? { resolved_facts: entry.resolvedFacts } : {}),
    ...(evidence.length > 0 ? { evidence } : { evidence: [] }),
  }
}

async function confirmLogCommitment(
  recordHashRef: string,
  config: ArchiveServerConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (config.allowUncommittedRecords === true) return { ok: true }
  const endpoints = config.trustedLogEndpoints ?? DEFAULT_LOG_ENDPOINTS
  const hashHex = recordHashRef.slice('sha256:'.length)
  const fetchImpl = config.fetchImpl ?? fetch
  const errors: string[] = []
  for (const endpoint of endpoints) {
    const base = trimTrailingSlashes(endpoint)
    try {
      const response = await fetchImpl(`${base}/lookup/${hashHex}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) {
        errors.push(`${base}: ${response.status}`)
        continue
      }
      const body = (await response.json()) as { record_hash?: unknown }
      if (body.record_hash === recordHashRef) return { ok: true }
      errors.push(`${base}: record_hash mismatch`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${base}: ${message}`)
    }
  }
  return {
    ok: false,
    error: `record hash is not committed in a trusted log (${errors.join('; ') || 'no trusted logs configured'})`,
  }
}

function serviceInfo(config: ArchiveServerConfig): Record<string, unknown> {
  return {
    service: 'atrib-archive-node',
    versions: ['v1'],
    current_version: 'v1',
    origin: config.origin,
    spec: 'https://github.com/creatornader/atrib/blob/main/atrib-spec.md#212-record-body-archive-layer',
    endpoints: {
      submit: 'POST /v1/records',
      record: 'GET /v1/record/<record_hash_hex>',
      evidence: 'GET /v1/evidence/<record_hash_hex>',
      retention: 'GET /v1/retention',
    },
    note: 'The archive serves record bodies and verifier evidence for records whose producer opted into body archival. The public log remains commitment-only.',
  }
}

function retentionManifest(config: ArchiveServerConfig): Record<string, unknown> {
  return {
    operator: config.origin,
    minimum_window_ms: config.retentionWindowMs ?? DEFAULT_RETENTION_WINDOW_MS,
    best_effort: config.bestEffort ?? 'forever',
    archived_after_ms: config.archivedAfterMs ?? null,
    ...(config.policyUrl ? { policy_url: config.policyUrl } : {}),
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function dedupeEvidence<T>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--
  return value.slice(0, end)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

function problem(
  res: ServerResponse,
  status: number,
  type: string,
  title: string,
  detail: string,
): void {
  json(res, status, {
    type: `https://atrib.dev/problems/${type}`,
    title,
    status,
    detail,
  })
}
