import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AtribRecord } from '@atrib/mcp'
import type { Ap2ViEvidenceBundle } from '@atrib/verify'
import {
  DEFAULT_RUNTIME_NOW_SECONDS,
  buildGoogleEvidenceGate,
  buildReplayPacket,
  loadPacketFromFiles,
  merchantAdapterContract,
  writeAnalyticsRowToBigQuery,
  type GoogleAgentAnalyticsRow,
  type GoogleEvidenceGate,
  type GoogleEvidencePacket,
} from '../../../src/google-evidence-runtime.js'
import { createGoogleActiveRuntimeRun, type GoogleActiveRuntimeRun } from './active-runtime.js'

const runtimeDir = dirname(fileURLToPath(import.meta.url))
const integrationDir = resolve(runtimeDir, '../../..')
const fixtureDir = join(integrationDir, 'test/fixtures/ap2-vi-reference')
const defaultResultJson = join(fixtureDir, 'ap2-vi-reference-result.json')
const defaultEvidenceJson = join(fixtureDir, 'ap2-vi-reference-evidence.json')
const serviceName = 'atrib-google-evidence-runtime'
const port = Number(process.env.PORT ?? '8080')
const maxStoredRuns = 25

let replayPacketPromise: Promise<GoogleEvidencePacket> | undefined
const activeRuns = new Map<string, GoogleActiveRuntimeRun>()

const server = createServer((request, response) => {
  void handleRequest(request, response)
})

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ ok: true, service: serviceName, port }))
})

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    setCorsHeaders(response)
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      writeJson(response, 200, { ok: true, service: serviceName })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/runtime-state') {
      const gate = await buildDefaultGate()
      writeJson(response, 200, runtimeState(gate))
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/runs') {
      writeJson(response, 200, {
        ok: true,
        runs: [...activeRuns.values()]
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map(summarizeRun),
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/runs') {
      const body = await readJsonBody(request)
      const packet = await packetFromRunBody(body)
      const run = await createGoogleActiveRuntimeRun({
        runId: runIdFromBody(body),
        packet,
        mode: runModeFromBody(body),
        prompt: promptFromBody(body),
      })
      rememberRun(run)
      const analyticsWrite = await maybeWriteRuntimeAnalytics(body, run.analytics_rows)
      writeJson(response, 200, {
        ok: run.ok,
        run,
        analytics_write: analyticsWrite,
      })
      return
    }

    const apiRunId = runIdFromPath(url.pathname)
    if (request.method === 'GET' && apiRunId) {
      const run = activeRuns.get(apiRunId)
      if (!run) {
        writeJson(response, 404, { ok: false, error: 'run_not_found', run_id: apiRunId })
        return
      }
      writeJson(response, 200, { ok: true, run })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/replay/google-ap2-sample') {
      const gate = await buildDefaultGate()
      writeJson(response, 200, {
        ok: gate.allowed,
        mode: 'official-sample-replay',
        gate,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/verify-ap2') {
      const body = await readJsonBody(request)
      const packet = await packetFromBody(body)
      const gate = await buildGoogleEvidenceGate(packet)
      let analyticsWrite: unknown = null
      if (isRecord(body) && body.writeAnalytics === true) {
        if (!canWriteAnalytics()) {
          writeJson(response, 403, {
            ok: false,
            error: 'bigquery_write_disabled',
          })
          return
        }
        analyticsWrite = await writeAnalyticsRowToBigQuery(gate.analytics_row)
      }
      writeJson(response, 200, {
        ok: gate.allowed,
        gate,
        analytics_write: analyticsWrite,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/analytics/write') {
      if (!canWriteAnalytics()) {
        writeJson(response, 403, {
          ok: false,
          error: 'bigquery_write_disabled',
        })
        return
      }
      const body = await readJsonBody(request)
      const row = isRecord(body) && isRecord(body.row) ? normalizeAnalyticsRow(body.row) : null
      const analyticsRow = row ?? (await buildDefaultGate()).analytics_row
      const result = await writeAnalyticsRowToBigQuery(analyticsRow)
      writeJson(response, 200, { ok: true, analytics_write: result, row: analyticsRow })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/merchant-adapter') {
      writeJson(response, 200, {
        ok: true,
        contract: merchantAdapterContract(),
      })
      return
    }

    writeJson(response, 404, {
      ok: false,
      error: 'not_found',
      endpoints: [
        'GET /health',
        'GET /api/runs',
        'POST /api/runs',
        'GET /api/runs/:runId',
        'GET /v1/runtime-state',
        'POST /v1/replay/google-ap2-sample',
        'POST /v1/verify-ap2',
        'POST /v1/analytics/write',
        'GET /v1/merchant-adapter',
      ],
    })
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function runtimeState(gate: GoogleEvidenceGate): Record<string, unknown> {
  return {
    ok: gate.allowed,
    service: serviceName,
    mode: 'replay',
    capabilities: {
      analytics_write_enabled: canWriteAnalytics(),
    },
    gate,
    endpoints: {
      runs: '/api/runs',
      run: '/api/runs/:runId',
      verify: '/v1/verify-ap2',
      replay: '/v1/replay/google-ap2-sample',
      analytics_write: '/v1/analytics/write',
      merchant_adapter: '/v1/merchant-adapter',
    },
  }
}

function rememberRun(run: GoogleActiveRuntimeRun): void {
  activeRuns.set(run.run_id, run)
  const sorted = [...activeRuns.values()].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  )
  for (const stale of sorted.slice(maxStoredRuns)) {
    activeRuns.delete(stale.run_id)
  }
}

function summarizeRun(run: GoogleActiveRuntimeRun): Record<string, unknown> {
  return {
    run_id: run.run_id,
    ok: run.ok,
    status: run.status,
    mode: run.mode,
    created_at: run.created_at,
    updated_at: run.updated_at,
    prompt: run.prompt,
    steps: run.steps.map((step) => ({
      key: step.key,
      protocol: step.protocol,
      status: step.status,
      record_hash: step.record_hash,
    })),
  }
}

function runIdFromBody(body: unknown): string {
  if (isRecord(body) && typeof body.runId === 'string' && body.runId.length > 0) {
    return body.runId
  }
  return `google-active-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
}

function promptFromBody(body: unknown): string | undefined {
  if (isRecord(body) && typeof body.prompt === 'string' && body.prompt.trim().length > 0) {
    return body.prompt.trim()
  }
  return undefined
}

function runModeFromBody(body: unknown): 'replay' | 'provided_packet' {
  if (
    !isRecord(body) ||
    body.mode === 'replay' ||
    (!('result' in body) && !isRecord(body.files))
  ) {
    return 'replay'
  }
  return 'provided_packet'
}

function runIdFromPath(pathname: string): string | null {
  const prefix = '/api/runs/'
  if (!pathname.startsWith(prefix)) return null
  const encoded = pathname.slice(prefix.length)
  if (!encoded) return null
  return decodeURIComponent(encoded)
}

async function maybeWriteRuntimeAnalytics(
  body: unknown,
  rows: GoogleAgentAnalyticsRow[],
): Promise<unknown> {
  if (!isRecord(body) || body.writeAnalytics !== true) return null
  if (!canWriteAnalytics()) return { ok: false, error: 'bigquery_write_disabled' }
  const writes = []
  for (const row of rows) {
    writes.push(await writeAnalyticsRowToBigQuery(row))
  }
  return { ok: true, rows_written: writes.length, writes }
}

async function buildDefaultGate(): Promise<GoogleEvidenceGate> {
  return buildGoogleEvidenceGate(await defaultPacket())
}

async function defaultPacket(): Promise<GoogleEvidencePacket> {
  if (!replayPacketPromise) replayPacketPromise = loadConfiguredPacket()
  return replayPacketPromise
}

async function loadConfiguredPacket(): Promise<GoogleEvidencePacket> {
  const nowSeconds = numberFromEnv(process.env.ATRIB_AP2_INTEROP_NOW_SECONDS)
  const resultJson = process.env.ATRIB_AP2_INTEROP_RESULT_JSON
  const evidenceJson = process.env.ATRIB_AP2_INTEROP_EVIDENCE_JSON
  const transactionRecordJson = process.env.ATRIB_AP2_INTEROP_TRANSACTION_RECORD_JSON

  if (resultJson && evidenceJson && transactionRecordJson) {
    return loadPacketFromFiles({
      resultJson,
      evidenceJson,
      transactionRecordJson,
      source: 'runtime AP2 packet files',
      nowSeconds: nowSeconds ?? DEFAULT_RUNTIME_NOW_SECONDS,
    })
  }

  return buildReplayPacket({
    resultJson: defaultResultJson,
    evidenceJson: defaultEvidenceJson,
    contextId: process.env.ATRIB_GOOGLE_RUNTIME_CONTEXT_ID,
    nowSeconds: nowSeconds ?? DEFAULT_RUNTIME_NOW_SECONDS,
  })
}

async function packetFromBody(body: unknown): Promise<GoogleEvidencePacket> {
  if (!isRecord(body) || body.mode === 'replay' || Object.keys(body).length === 0) {
    return defaultPacket()
  }

  if (isRecord(body.files)) {
    return loadPacketFromFiles({
      resultJson: stringField(body.files, 'resultJson'),
      evidenceJson: stringField(body.files, 'evidenceJson'),
      transactionRecordJson: stringField(body.files, 'transactionRecordJson'),
      source: 'request file packet',
      nowSeconds: numberField(body, 'nowSeconds') ?? DEFAULT_RUNTIME_NOW_SECONDS,
    })
  }

  if (!('result' in body) || !('evidence' in body)) {
    throw new Error('POST /v1/verify-ap2 requires result and evidence, or { "mode": "replay" }')
  }

  if (!isRecord(body.transactionRecord)) {
    throw new Error('transactionRecord is required for counterparty-attested verification')
  }

  return {
    result: body.result,
    evidence: body.evidence as Ap2ViEvidenceBundle,
    transactionRecord: body.transactionRecord as AtribRecord,
    source: 'request inline packet',
    nowSeconds: numberField(body, 'nowSeconds') ?? DEFAULT_RUNTIME_NOW_SECONDS,
  }
}

async function packetFromRunBody(body: unknown): Promise<GoogleEvidencePacket> {
  if (
    !isRecord(body) ||
    body.mode === 'replay' ||
    (!('result' in body) && !isRecord(body.files))
  ) {
    return defaultPacket()
  }
  return packetFromBody(body)
}

function normalizeAnalyticsRow(row: Record<string, unknown>): GoogleAgentAnalyticsRow {
  return {
    timestamp: stringField(row, 'timestamp'),
    event_type: stringField(row, 'event_type'),
    agent: stringField(row, 'agent'),
    session_id: stringField(row, 'session_id'),
    invocation_id: stringField(row, 'invocation_id'),
    user_id: stringField(row, 'user_id'),
    trace_id: stringField(row, 'trace_id'),
    span_id: stringField(row, 'span_id'),
    parent_span_id: stringField(row, 'parent_span_id'),
    status: stringField(row, 'status'),
    error_message: stringField(row, 'error_message'),
    is_truncated: Boolean(row.is_truncated),
    atrib_record_hash: stringField(row, 'atrib_record_hash'),
    atrib_parent_record_hashes: stringField(row, 'atrib_parent_record_hashes'),
    protocol: stringField(row, 'protocol'),
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 8 * 1024 * 1024) throw new Error('request body exceeds 8 MiB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('access-control-allow-headers', 'content-type,authorization')
  response.setHeader('cache-control', 'no-store')
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(value, null, 2)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function numberField(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number`)
  }
  return value
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error('ATRIB_AP2_INTEROP_NOW_SECONDS must be numeric')
  return parsed
}

function canWriteAnalytics(): boolean {
  return process.env.BIGQUERY_WRITE_ENABLED === '1'
}
