// SPDX-License-Identifier: Apache-2.0

/**
 * OpenInference dual-export smoke.
 *
 * Default mode starts a tiny local OTLP/HTTP receiver and proves that the
 * same OpenTelemetry span stream reaches a real OTLP exporter and
 * `AtribSpanProcessor`. Set ATRIB_OPENINFERENCE_OTLP_ENDPOINT, or a Phoenix
 * / Langfuse endpoint env var, to point the observability side at an
 * external collector instead.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { context, trace, type Span } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  AtribSpanProcessor,
  verifyOpenTelemetryContextPropagation,
  type AtribSpanSidecar,
} from '@atrib/openinference'

interface LocalCollector {
  endpoint: string
  requests: Array<{ path: string; bytes: number; contentType: string | undefined }>
  close: () => Promise<void>
}

type BackendKind = 'phoenix' | 'langfuse'

interface BackendMatch {
  traceIds: string[]
  spanIds: string[]
  spanNames: string[]
  runIdSeen: boolean
}

interface BackendVerification {
  kind: BackendKind
  status: 'ok'
  base_url: string
  attempts: number
  matched_trace_ids: string[]
  matched_span_ids: string[]
  matched_span_names: string[]
  run_id_seen: boolean
}

const TEST_KEY_BYTES = new Uint8Array(32).fill(8)
const RUN_NAME = 'atrib-openinference-dual-export-smoke'
const RUN_TAGS = ['atrib', 'dual-export', 'openinference']

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function startLocalOtlpReceiver(): Promise<LocalCollector> {
  const requests: LocalCollector['requests'] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        path: req.url ?? '',
        bytes: Buffer.concat(chunks).byteLength,
        contentType: req.headers['content-type'],
      })
      res.statusCode = 200
      res.end()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('local OTLP receiver did not bind to a TCP port')
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.endsWith('/v1/traces')) return endpoint
  return `${endpoint.replace(/\/$/, '')}/v1/traces`
}

function configuredEndpoint(): string | undefined {
  const raw =
    process.env.ATRIB_OPENINFERENCE_OTLP_ENDPOINT ??
    process.env.PHOENIX_OTLP_ENDPOINT ??
    process.env.PHOENIX_COLLECTOR_ENDPOINT ??
    process.env.LANGFUSE_OTLP_ENDPOINT
  return raw === undefined || raw.length === 0 ? undefined : normalizeEndpoint(raw)
}

function parseHeaders(): Record<string, string> {
  return parseHeaderPairs(
    process.env.ATRIB_OPENINFERENCE_OTLP_HEADERS ?? process.env.OTEL_EXPORTER_OTLP_HEADERS,
  )
}

function parseHeaderPairs(raw: string | undefined): Record<string, string> {
  if (raw === undefined || raw.length === 0) return {}
  const out: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=')
    if (idx <= 0) continue
    const key = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (key.length > 0) out[key] = value
  }
  return out
}

function backendKind(): BackendKind | undefined {
  const raw = process.env.ATRIB_OPENINFERENCE_VERIFY_BACKEND
  if (raw === undefined || raw.length === 0 || raw === 'none' || raw === 'false') {
    return undefined
  }
  if (raw === 'phoenix' || raw === 'langfuse') return raw
  throw new Error(
    `ATRIB_OPENINFERENCE_VERIFY_BACKEND must be "phoenix", "langfuse", or unset; got ${raw}`,
  )
}

function privateKeyFromEnv(): Uint8Array {
  const encoded = process.env.ATRIB_PRIVATE_KEY
  return encoded === undefined || encoded.length === 0 ? TEST_KEY_BYTES : base64urlDecode(encoded)
}

function runIdFromEnv(): string {
  return (
    process.env.ATRIB_OPENINFERENCE_RUN_ID ??
    `atrib-dual-export-${Date.now()}-${randomUUID().slice(0, 8)}`
  )
}

function setCorrelationAttributes(span: Span, runId: string): void {
  span.setAttribute('langfuse.session.id', runId)
  span.setAttribute('langfuse.trace.name', RUN_NAME)
  span.setAttribute('langfuse.trace.tags', RUN_TAGS)
  span.setAttribute('langfuse.trace.metadata.atrib_dual_export_run_id', runId)
  span.setAttribute('atrib.dual_export_run_id', runId)
  span.setAttribute('user.id', 'atrib-dual-export-smoke')
}

function backendBaseUrl(kind: BackendKind, endpoint: string): string {
  const explicit =
    kind === 'phoenix'
      ? (process.env.ATRIB_OPENINFERENCE_BACKEND_BASE_URL ??
        process.env.PHOENIX_BASE_URL ??
        process.env.PHOENIX_COLLECTOR_ENDPOINT)
      : (process.env.ATRIB_OPENINFERENCE_BACKEND_BASE_URL ??
        process.env.LANGFUSE_BASE_URL ??
        process.env.LANGFUSE_HOST ??
        process.env.LANGFUSE_OTLP_ENDPOINT)

  const raw = explicit ?? endpoint
  if (kind === 'langfuse') {
    return raw
      .replace(/\/api\/public\/otel\/v1\/traces\/?$/, '')
      .replace(/\/api\/public\/otel\/?$/, '')
      .replace(/\/$/, '')
  }
  return raw.replace(/\/v1\/traces\/?$/, '').replace(/\/$/, '')
}

function backendHeaders(kind: BackendKind): Record<string, string> {
  const explicit = parseHeaderPairs(process.env.ATRIB_OPENINFERENCE_BACKEND_HEADERS)
  const out = Object.keys(explicit).length > 0 ? explicit : { ...parseHeaders() }

  if (out.Authorization === undefined && out.authorization === undefined) {
    if (kind === 'phoenix' && process.env.PHOENIX_API_KEY !== undefined) {
      out.Authorization = `Bearer ${process.env.PHOENIX_API_KEY}`
    }
    if (kind === 'langfuse') {
      const authString =
        process.env.LANGFUSE_AUTH_STRING ??
        (process.env.LANGFUSE_PUBLIC_KEY !== undefined &&
        process.env.LANGFUSE_SECRET_KEY !== undefined
          ? Buffer.from(
              `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
            ).toString('base64')
          : undefined)
      if (authString !== undefined) out.Authorization = `Basic ${authString}`
    }
  }

  return out
}

function backendQueryUrl(
  kind: BackendKind,
  baseUrl: string,
  expected: {
    runId: string
    traceIds: string[]
    fromStartTime: string
    toStartTime: string
  },
): string {
  if (kind === 'langfuse') {
    const url = new URL(`${baseUrl}/api/public/v2/observations`)
    url.searchParams.set('traceId', expected.traceIds[0] ?? '')
    url.searchParams.set('fromStartTime', expected.fromStartTime)
    url.searchParams.set('toStartTime', expected.toStartTime)
    url.searchParams.set('fields', 'core,basic,io,metadata,model,usage,prompt,trace_context')
    url.searchParams.set('limit', '100')
    return url.toString()
  }

  const project =
    process.env.ATRIB_OPENINFERENCE_PHOENIX_PROJECT ?? process.env.PHOENIX_PROJECT_NAME ?? 'default'
  const url = new URL(`${baseUrl}/v1/projects/${encodeURIComponent(project)}/traces`)
  url.searchParams.set('start_time', expected.fromStartTime)
  url.searchParams.set('end_time', expected.toStartTime)
  url.searchParams.set('include_spans', 'true')
  url.searchParams.set('limit', '100')
  return url.toString()
}

async function verifyBackendReceipt(args: {
  kind: BackendKind
  endpoint: string
  runId: string
  traceIds: string[]
  spanIds: string[]
  spanNames: string[]
  fromStartTime: string
}): Promise<BackendVerification> {
  const baseUrl = backendBaseUrl(args.kind, args.endpoint)
  const timeoutMs = Number(process.env.ATRIB_OPENINFERENCE_BACKEND_VERIFY_TIMEOUT_MS ?? '60000')
  const intervalMs = Number(process.env.ATRIB_OPENINFERENCE_BACKEND_VERIFY_INTERVAL_MS ?? '2000')
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  let lastFailure = 'backend did not return matching spans'

  while (Date.now() <= deadline) {
    attempts += 1
    const queryUrl = backendQueryUrl(args.kind, baseUrl, {
      runId: args.runId,
      traceIds: args.traceIds,
      fromStartTime: args.fromStartTime,
      toStartTime: new Date(Date.now() + 5 * 60_000).toISOString(),
    })

    try {
      const response = await fetch(queryUrl, {
        headers: {
          Accept: 'application/json',
          ...backendHeaders(args.kind),
        },
      })
      if (!response.ok) {
        lastFailure = `${args.kind} query returned HTTP ${response.status}: ${await response.text()}`
      } else {
        const payload = await response.json()
        const match = matchBackendPayload(payload, args)
        if (
          match.traceIds.length === args.traceIds.length &&
          match.spanIds.length === args.spanIds.length &&
          match.spanNames.length === args.spanNames.length
        ) {
          return {
            kind: args.kind,
            status: 'ok',
            base_url: baseUrl,
            attempts,
            matched_trace_ids: match.traceIds,
            matched_span_ids: match.spanIds,
            matched_span_names: match.spanNames,
            run_id_seen: match.runIdSeen,
          }
        }
        lastFailure = [
          `run_id_seen=${match.runIdSeen}`,
          `trace_ids=${match.traceIds.length}/${args.traceIds.length}`,
          `span_ids=${match.spanIds.length}/${args.spanIds.length}`,
          `span_names=${match.spanNames.length}/${args.spanNames.length}`,
        ].join(', ')
      }
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err)
    }

    if (Date.now() <= deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  throw new Error(
    `${args.kind} backend verification failed after ${attempts} attempts: ${lastFailure}`,
  )
}

function matchBackendPayload(
  payload: unknown,
  expected: { runId: string; traceIds: string[]; spanIds: string[]; spanNames: string[] },
): BackendMatch {
  const text = JSON.stringify(payload)
  return {
    traceIds: expected.traceIds.filter((id) => text.includes(id)),
    spanIds: expected.spanIds.filter((id) => text.includes(id)),
    spanNames: expected.spanNames.filter((name) => text.includes(name)),
    runIdSeen: text.includes(expected.runId),
  }
}

async function main(): Promise<void> {
  const ctxManager = new AsyncHooksContextManager()
  ctxManager.enable()
  context.setGlobalContextManager(ctxManager)
  await verifyOpenTelemetryContextPropagation()

  const runId = runIdFromEnv()
  const fromStartTime = new Date(Date.now() - 60_000).toISOString()
  const verifyKind = backendKind()
  const localCollector =
    configuredEndpoint() === undefined ? await startLocalOtlpReceiver() : undefined
  const endpoint = configuredEndpoint() ?? localCollector!.endpoint
  const privateKey = privateKeyFromEnv()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const submitted: Array<{ record: AtribRecord; sidecar: AtribSpanSidecar }> = []

  const otlpProcessor = new SimpleSpanProcessor(
    new OTLPTraceExporter({
      url: endpoint,
      headers: parseHeaders(),
    }),
  )
  const atribProcessor = new AtribSpanProcessor({
    privateKey,
    creatorKey,
    serverUrl: 'https://example.test/atrib-openinference-dual-export',
    submit: (record, sidecar) => {
      submitted.push({ record, sidecar })
    },
    autoInformedBy: true,
    argsResultHashPosture: 'plain',
  })
  const provider = new BasicTracerProvider({
    spanProcessors: [otlpProcessor, atribProcessor],
  })
  const tracer = provider.getTracer('atrib-openinference-dual-export-smoke')

  try {
    const root = tracer.startSpan('agent-root')
    setCorrelationAttributes(root, runId)
    await context.with(trace.setSpan(context.active(), root), async () => {
      const llmSpan = tracer.startSpan('generate-text')
      setCorrelationAttributes(llmSpan, runId)
      llmSpan.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, 'LLM')
      llmSpan.setAttribute(SemanticConventions.LLM_MODEL_NAME, 'qwen3.5')
      llmSpan.setAttribute('llm.prompts', 'Compare Phoenix trace capture with atrib evidence.')
      llmSpan.setAttribute(
        'llm.output_messages.0.message.tool_calls.0.tool_call.id',
        'dual-export-call',
      )
      llmSpan.setAttribute(SemanticConventions.INPUT_VALUE, '{"prompt":"dual export"}')
      llmSpan.setAttribute(SemanticConventions.OUTPUT_VALUE, '{"tool_call":"dual-export-call"}')
      llmSpan.end()

      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      const toolSpan = tracer.startSpan('search_docs')
      setCorrelationAttributes(toolSpan, runId)
      toolSpan.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, 'TOOL')
      toolSpan.setAttribute(SemanticConventions.TOOL_NAME, 'search_docs')
      toolSpan.setAttribute('tool_call.id', 'dual-export-call')
      toolSpan.setAttribute(SemanticConventions.INPUT_VALUE, '{"query":"Phoenix OTLP"}')
      toolSpan.setAttribute(SemanticConventions.OUTPUT_VALUE, '{"hits":1}')
      toolSpan.end()
    })
    root.end()

    await provider.forceFlush()
    await atribProcessor.forceFlush()

    if (submitted.length < 2) {
      throw new Error(`expected at least 2 atrib records, got ${submitted.length}`)
    }
    for (const { record } of submitted) {
      if (!(await verifyRecord(record))) {
        throw new Error(`invalid atrib signature for ${record.signature}`)
      }
    }
    if (localCollector !== undefined && localCollector.requests.length === 0) {
      throw new Error('local OTLP receiver saw zero export requests')
    }

    const toolRecord = submitted.find((entry) =>
      entry.record.event_type.endsWith('/tool_call'),
    )?.record
    const llmRecord = submitted.find((entry) => entry.sidecar.content.span_kind === 'LLM')?.record
    if (toolRecord === undefined || llmRecord === undefined) {
      throw new Error('expected both LLM and TOOL records')
    }

    const expectedTraceIds = [...new Set(submitted.map((entry) => entry.sidecar.traceId))]
    const expectedSpanIds = submitted.map((entry) => entry.sidecar.spanId)
    const expectedSpanNames = submitted.map((entry) => entry.sidecar.spanName)
    const backendVerification =
      verifyKind === undefined
        ? null
        : await verifyBackendReceipt({
            kind: verifyKind,
            endpoint,
            runId,
            traceIds: expectedTraceIds,
            spanIds: expectedSpanIds,
            spanNames: expectedSpanNames,
            fromStartTime,
          })

    const output = {
      status: 'ok',
      run_id: runId,
      collector_kind: localCollector === undefined ? 'external-otlp-http' : 'local-otlp-http',
      collector_endpoint: endpoint,
      collector_requests: localCollector?.requests.length ?? null,
      collector_bytes: localCollector?.requests.reduce((sum, req) => sum + req.bytes, 0) ?? null,
      atrib_records: submitted.length,
      context_ids: [...new Set(submitted.map((entry) => entry.record.context_id))],
      trace_ids: expectedTraceIds,
      span_ids: expectedSpanIds,
      span_names: expectedSpanNames,
      informed_by_edges: submitted.filter((entry) => entry.record.informed_by !== undefined).length,
      tool_informed_by_llm: toolRecord.informed_by?.[0] === recordHash(llmRecord),
      args_hashes_present: submitted.every((entry) => entry.record.args_hash !== undefined),
      result_hashes_present: submitted.every((entry) => entry.record.result_hash !== undefined),
      backend_verification: backendVerification,
    }
    console.log(JSON.stringify(output))
  } finally {
    await provider.shutdown()
    await localCollector?.close()
    ctxManager.disable()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
