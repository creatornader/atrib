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
import { context, trace } from '@opentelemetry/api'
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

const TEST_KEY_BYTES = new Uint8Array(32).fill(8)

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
  const raw = process.env.ATRIB_OPENINFERENCE_OTLP_HEADERS ?? process.env.OTEL_EXPORTER_OTLP_HEADERS
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

function privateKeyFromEnv(): Uint8Array {
  const encoded = process.env.ATRIB_PRIVATE_KEY
  return encoded === undefined || encoded.length === 0 ? TEST_KEY_BYTES : base64urlDecode(encoded)
}

async function main(): Promise<void> {
  const ctxManager = new AsyncHooksContextManager()
  ctxManager.enable()
  context.setGlobalContextManager(ctxManager)
  await verifyOpenTelemetryContextPropagation()

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
    await context.with(trace.setSpan(context.active(), root), async () => {
      const llmSpan = tracer.startSpan('generate-text')
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

    const output = {
      status: 'ok',
      collector_kind: localCollector === undefined ? 'external-otlp-http' : 'local-otlp-http',
      collector_endpoint: endpoint,
      collector_requests: localCollector?.requests.length ?? null,
      collector_bytes: localCollector?.requests.reduce((sum, req) => sum + req.bytes, 0) ?? null,
      atrib_records: submitted.length,
      context_ids: [...new Set(submitted.map((entry) => entry.record.context_id))],
      informed_by_edges: submitted.filter((entry) => entry.record.informed_by !== undefined).length,
      tool_informed_by_llm: toolRecord.informed_by?.[0] === recordHash(llmRecord),
      args_hashes_present: submitted.every((entry) => entry.record.args_hash !== undefined),
      result_hashes_present: submitted.every((entry) => entry.record.result_hash !== undefined),
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
