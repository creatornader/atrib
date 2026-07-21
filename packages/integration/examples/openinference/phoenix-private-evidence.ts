// SPDX-License-Identifier: Apache-2.0

/**
 * Phoenix private-evidence lifecycle proof.
 *
 * A local OpenInference span stream is consumed twice:
 *
 * 1. Atrib signs salted commitments to the original tool input and output,
 *    while a private mirror keeps the disclosure material.
 * 2. An allowlist exporter removes user content before sending the spans to
 *    Phoenix.
 *
 * The proof confirms that Phoenix received the safe trace, deletes that trace,
 * then rechecks the signed records and private disclosures after deletion.
 */

import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { context, trace, type Span } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  leafHash,
  sha256,
  verifyInclusion,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'
import { parseCheckpointBody, parseSignatureLine, serializeEntry } from '@atrib/log-node'
import {
  AtribSpanProcessor,
  verifyOpenTelemetryContextPropagation,
  type AtribSpanSidecar,
} from '@atrib/openinference'

type PrivateMirrorEntry = {
  record: AtribRecord
  local: AtribSpanSidecar
}

type PhoenixReceipt = {
  attempts: number
  traceIds: string[]
  spanIds: string[]
  spanNames: string[]
  payloadContainsPrivateInput: boolean
  payloadContainsPrivateOutput: boolean
}

const TEST_KEY_BYTES = new Uint8Array(32).fill(11)
const PROJECT_NAME = process.env.PHOENIX_PROJECT_NAME ?? 'default'
const PHOENIX_BASE_URL = (process.env.PHOENIX_BASE_URL ?? 'http://127.0.0.1:6006').replace(
  /\/$/,
  '',
)
const PHOENIX_OTLP_ENDPOINT = `${PHOENIX_BASE_URL}/v1/traces`
const RUN_NAME = 'atrib-openinference-private-evidence'
const API_LEAVES = new Set([
  'checkpoint',
  'entries',
  'evidence',
  'lookup',
  'proof',
  'pubkey',
  'record',
  'records',
])

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const SAFE_SPAN_ATTRIBUTE_KEYS = new Set([
  SemanticConventions.OPENINFERENCE_SPAN_KIND,
  SemanticConventions.TOOL_NAME,
  SemanticConventions.LLM_MODEL_NAME,
  SemanticConventions.SESSION_ID,
  'tool_call.id',
  'llm.output_messages.0.message.tool_calls.0.tool_call.id',
  'atrib.private_evidence_run_id',
])

const SAFE_RESOURCE_ATTRIBUTE_KEYS = new Set([
  'service.name',
  'service.namespace',
  'service.version',
  'telemetry.sdk.language',
  'telemetry.sdk.name',
  'telemetry.sdk.version',
])

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function recordHashHex(record: AtribRecord): string {
  return recordHash(record).slice('sha256:'.length)
}

function apiEndpoint(base: string, leaf: string, suffix?: string): string {
  const url = new URL(base)
  const parts = url.pathname.split('/').filter(Boolean)
  while (parts.length > 0 && API_LEAVES.has(parts.at(-1) ?? '')) parts.pop()
  if (parts.at(-1) !== 'v1') parts.push('v1')
  parts.push(leaf)
  if (suffix !== undefined) parts.push(suffix)
  url.pathname = `/${parts.join('/')}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function canonicalMaterial(value: string): Uint8Array {
  const canonical = canonicalize(parseJsonOrString(value))
  if (canonical === undefined) throw new Error('private disclosure is not JCS-encodable')
  return new TextEncoder().encode(canonical)
}

function replayCommitment(value: string, salt: string | undefined): string {
  const material = canonicalMaterial(value)
  if (salt === undefined) return `sha256:${hexEncode(sha256(material))}`

  const saltBytes = base64urlDecode(salt)
  const combined = new Uint8Array(saltBytes.length + material.length)
  combined.set(saltBytes)
  combined.set(material, saltBytes.length)
  return `sha256:${hexEncode(sha256(combined))}`
}

function allowlistAttributes(
  attributes: ReadableSpan['attributes'],
  allowed: ReadonlySet<string>,
): ReadableSpan['attributes'] {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => allowed.has(key)))
}

function redactSpanForExport(span: ReadableSpan): ReadableSpan {
  const safeAttributes = allowlistAttributes(span.attributes, SAFE_SPAN_ATTRIBUTE_KEYS)
  const safeResourceAttributes = allowlistAttributes(
    span.resource.attributes,
    SAFE_RESOURCE_ATTRIBUTE_KEYS,
  )
  const safeResource = new Proxy(span.resource, {
    get(target, property, receiver) {
      if (property === 'attributes') return safeResourceAttributes
      return Reflect.get(target, property, receiver)
    },
  })

  return new Proxy(span, {
    get(target, property, receiver) {
      if (property === 'attributes') return safeAttributes
      if (property === 'resource') return safeResource
      if (property === 'events' || property === 'links') return []
      if (property === 'status') return { code: target.status.code }
      return Reflect.get(target, property, receiver)
    },
  })
}

class AllowlistSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    this.delegate.export(spans.map(redactSpanForExport), resultCallback)
  }

  async shutdown(): Promise<void> {
    await this.delegate.shutdown()
  }

  async forceFlush(): Promise<void> {
    await this.delegate.forceFlush?.()
  }
}

function setSafeCorrelationAttributes(span: Span, runId: string): void {
  span.setAttribute('atrib.private_evidence_run_id', runId)
}

function phoenixHeaders(): Record<string, string> {
  return process.env.PHOENIX_API_KEY === undefined
    ? {}
    : { Authorization: `Bearer ${process.env.PHOENIX_API_KEY}` }
}

function phoenixTraceQueryUrl(fromStartTime: string): string {
  const url = new URL(`${PHOENIX_BASE_URL}/v1/projects/${encodeURIComponent(PROJECT_NAME)}/traces`)
  url.searchParams.set('start_time', fromStartTime)
  url.searchParams.set('end_time', new Date(Date.now() + 5 * 60_000).toISOString())
  url.searchParams.set('include_spans', 'true')
  url.searchParams.set('limit', '100')
  return url.toString()
}

async function waitForPhoenixReceipt(args: {
  fromStartTime: string
  traceIds: string[]
  spanIds: string[]
  spanNames: string[]
  privateInputValues: string[]
  privateOutputValues: string[]
}): Promise<PhoenixReceipt> {
  const timeoutMs = Number(process.env.ATRIB_OPENINFERENCE_BACKEND_VERIFY_TIMEOUT_MS ?? '60000')
  const intervalMs = Number(process.env.ATRIB_OPENINFERENCE_BACKEND_VERIFY_INTERVAL_MS ?? '1000')
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  let lastFailure = 'Phoenix did not return the expected trace'

  while (Date.now() <= deadline) {
    attempts += 1
    try {
      const response = await fetch(phoenixTraceQueryUrl(args.fromStartTime), {
        headers: { Accept: 'application/json', ...phoenixHeaders() },
      })
      if (!response.ok) {
        lastFailure = `Phoenix query returned HTTP ${response.status}: ${await response.text()}`
      } else {
        const payloadText = await response.text()
        const traceIds = args.traceIds.filter((id) => payloadText.includes(id))
        const spanIds = args.spanIds.filter((id) => payloadText.includes(id))
        const spanNames = args.spanNames.filter((name) => payloadText.includes(name))
        if (
          traceIds.length === args.traceIds.length &&
          spanIds.length === args.spanIds.length &&
          spanNames.length === args.spanNames.length
        ) {
          return {
            attempts,
            traceIds,
            spanIds,
            spanNames,
            payloadContainsPrivateInput: args.privateInputValues.some((value) =>
              payloadText.includes(value),
            ),
            payloadContainsPrivateOutput: args.privateOutputValues.some((value) =>
              payloadText.includes(value),
            ),
          }
        }
        lastFailure = [
          `trace_ids=${traceIds.length}/${args.traceIds.length}`,
          `span_ids=${spanIds.length}/${args.spanIds.length}`,
          `span_names=${spanNames.length}/${args.spanNames.length}`,
        ].join(', ')
      }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`Phoenix receipt verification failed after ${attempts} attempts: ${lastFailure}`)
}

async function deletePhoenixTrace(traceId: string): Promise<void> {
  const response = await fetch(`${PHOENIX_BASE_URL}/v1/traces/${traceId}`, {
    method: 'DELETE',
    headers: phoenixHeaders(),
  })
  if (response.status !== 204) {
    throw new Error(
      `Phoenix trace deletion returned HTTP ${response.status}: ${await response.text()}`,
    )
  }
}

async function phoenixNoLongerContainsTrace(
  fromStartTime: string,
  traceId: string,
): Promise<boolean> {
  const response = await fetch(phoenixTraceQueryUrl(fromStartTime), {
    headers: { Accept: 'application/json', ...phoenixHeaders() },
  })
  if (!response.ok) {
    throw new Error(`Phoenix post-delete query returned HTTP ${response.status}`)
  }
  return !(await response.text()).includes(traceId)
}

async function writePrivateMirror(entries: PrivateMirrorEntry[]): Promise<string> {
  const configured = process.env.ATRIB_OPENINFERENCE_PRIVATE_MIRROR
  const path =
    configured ?? join(await mkdtemp(join(tmpdir(), 'atrib-openinference-private-')), 'mirror.json')
  await writeFile(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

async function verifyPrivateMirror(path: string): Promise<{
  records: number
  signaturesValid: boolean
  argsCommitmentsValid: boolean
  resultCommitmentsValid: boolean
  traceIdsSignedAsContext: boolean
}> {
  const entries = JSON.parse(await readFile(path, 'utf8')) as PrivateMirrorEntry[]
  const signaturesValid = (
    await Promise.all(entries.map(({ record }) => verifyRecord(record)))
  ).every(Boolean)

  return {
    records: entries.length,
    signaturesValid,
    argsCommitmentsValid: entries.every(({ record, local }) => {
      if (local.input === undefined || record.args_hash === undefined) return false
      return replayCommitment(local.input, record.args_salt) === record.args_hash
    }),
    resultCommitmentsValid: entries.every(({ record, local }) => {
      if (local.output === undefined || record.result_hash === undefined) return false
      return replayCommitment(local.output, record.result_salt) === record.result_hash
    }),
    traceIdsSignedAsContext: entries.every(
      ({ record, local }) => record.context_id === local.traceId,
    ),
  }
}

function expectedLogLeaf(record: AtribRecord): Uint8Array {
  return leafHash(
    serializeEntry({
      record_hash_hex: recordHashHex(record),
      creator_key_b64url: record.creator_key,
      context_id: record.context_id,
      timestamp: record.timestamp,
      event_type: record.event_type,
    }),
  )
}

async function readResponse(response: Response, label: string): Promise<string> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  return text
}

async function publishPublicProofs(
  entries: PrivateMirrorEntry[],
  privateValues: string[],
): Promise<
  | { enabled: false }
  | {
      enabled: true
      log_endpoint: string
      archive_endpoint: string
      records: Array<{
        record_hash: string
        log_index: number
        inclusion_valid: boolean
        checkpoint_signature_valid: boolean
        checkpoint_key_id_matches: boolean
        archive_record_matches: boolean
        private_body_published: boolean
        urls: {
          log_lookup: string
          log_proof: string
          archive_record: string
          explorer_action: string
        }
      }>
    }
> {
  if (process.env.ATRIB_OPENINFERENCE_PUBLIC_PROOF !== '1') return { enabled: false }

  const logEndpoint = process.env.ATRIB_LOG_ENDPOINT ?? 'https://log.atrib.dev/v1'
  const archiveEndpoint = process.env.ATRIB_ARCHIVE_ENDPOINT ?? 'https://archive.atrib.dev/v1'
  const explorerOrigin = process.env.ATRIB_EXPLORER_ORIGIN ?? 'https://explore.atrib.dev'
  const pubkeyResponse = JSON.parse(
    await readResponse(await fetch(apiEndpoint(logEndpoint, 'pubkey')), 'log pubkey'),
  ) as { origin?: unknown; key_id?: unknown; public_key?: unknown }
  if (
    typeof pubkeyResponse.origin !== 'string' ||
    typeof pubkeyResponse.key_id !== 'string' ||
    typeof pubkeyResponse.public_key !== 'string'
  ) {
    throw new Error('log pubkey response is incomplete')
  }
  const logPublicKey = base64urlDecode(pubkeyResponse.public_key)

  const results = []
  for (const { record } of entries) {
    const hash = recordHash(record)
    const hex = recordHashHex(record)
    const serializedRecord = JSON.stringify(record)
    if (privateValues.some((value) => serializedRecord.includes(value))) {
      throw new Error(`public record preflight found private material in ${hash}`)
    }
    const proof = JSON.parse(
      await readResponse(
        await fetch(apiEndpoint(logEndpoint, 'entries'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: serializedRecord,
        }),
        'log submission',
      ),
    ) as ProofBundle

    await readResponse(
      await fetch(apiEndpoint(archiveEndpoint, 'records'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record, proof }),
      }),
      'archive submission',
    )

    const checkpointSeparator = proof.checkpoint.indexOf('\n\n')
    if (checkpointSeparator < 0) throw new Error('checkpoint is missing its signature')
    const checkpointBody = proof.checkpoint.slice(0, checkpointSeparator + 1)
    const signatureLine = proof.checkpoint
      .slice(checkpointSeparator + 2)
      .split('\n')
      .find((line) => line.trim().length > 0)
    const parsedSignature = signatureLine === undefined ? null : parseSignatureLine(signatureLine)
    if (parsedSignature === null) throw new Error('checkpoint signature line is malformed')
    const checkpoint = parseCheckpointBody(checkpointBody)
    const leaf = new Uint8Array(Buffer.from(proof.leaf_hash, 'base64'))
    const proofPath = proof.inclusion_proof.map(
      (item) => new Uint8Array(Buffer.from(item, 'base64')),
    )
    const checkpointRoot = new Uint8Array(Buffer.from(checkpoint.rootHash, 'base64'))
    const leafMatchesRecord = Buffer.from(leaf).equals(Buffer.from(expectedLogLeaf(record)))
    const inclusionValid =
      leafMatchesRecord &&
      verifyInclusion(proof.log_index, checkpoint.treeSize, leaf, proofPath, checkpointRoot)
    const checkpointSignatureValid = await ed.verifyAsync(
      parsedSignature.signature,
      new TextEncoder().encode(checkpointBody),
      logPublicKey,
    )
    const checkpointKeyIdMatches = Buffer.from(parsedSignature.keyId).equals(
      Buffer.from(pubkeyResponse.key_id, 'hex'),
    )

    const archiveRecordUrl = apiEndpoint(archiveEndpoint, 'record', hex)
    const archiveText = await readResponse(await fetch(archiveRecordUrl), 'archive record')
    const archivePayload = JSON.parse(archiveText) as {
      record_hash?: unknown
      record?: AtribRecord
    }
    const archiveRecordMatches =
      archivePayload.record_hash === hash &&
      archivePayload.record !== undefined &&
      recordHash(archivePayload.record) === hash
    const privateBodyPublished = privateValues.some((value) => archiveText.includes(value))
    const explorerUrl = new URL(explorerOrigin)
    explorerUrl.pathname = `/action/${hash}`

    if (
      !inclusionValid ||
      !checkpointSignatureValid ||
      !checkpointKeyIdMatches ||
      !archiveRecordMatches ||
      privateBodyPublished
    ) {
      throw new Error(`public proof verification failed for ${hash}`)
    }

    results.push({
      record_hash: hash,
      log_index: proof.log_index,
      inclusion_valid: inclusionValid,
      checkpoint_signature_valid: checkpointSignatureValid,
      checkpoint_key_id_matches: checkpointKeyIdMatches,
      archive_record_matches: archiveRecordMatches,
      private_body_published: privateBodyPublished,
      urls: {
        log_lookup: apiEndpoint(logEndpoint, 'lookup', hex),
        log_proof: apiEndpoint(logEndpoint, 'proof', hex),
        archive_record: archiveRecordUrl,
        explorer_action: explorerUrl.toString(),
      },
    })
  }

  return {
    enabled: true,
    log_endpoint: logEndpoint,
    archive_endpoint: archiveEndpoint,
    records: results,
  }
}

async function main(): Promise<void> {
  const ctxManager = new AsyncHooksContextManager()
  ctxManager.enable()
  context.setGlobalContextManager(ctxManager)
  await verifyOpenTelemetryContextPropagation()

  const privateNonce = randomUUID()
  const privateEmail = 'private@example.test'
  const privateApiKey = `sk-private-${privateNonce}`
  const privateRefundId = `rf-private-${privateNonce}`
  const privateInput = JSON.stringify({
    customer_email: privateEmail,
    api_key: privateApiKey,
    request: 'approve refund',
  })
  const privateOutput = JSON.stringify({
    refund_id: privateRefundId,
    status: 'approved',
  })
  const privateInputValues = [privateInput, privateEmail, privateApiKey]
  const privateOutputValues = [privateOutput, privateRefundId, privateNonce]
  const runId = `phoenix-retention-proof-${Date.now()}-${randomUUID().slice(0, 8)}`
  const fromStartTime = new Date(Date.now() - 60_000).toISOString()
  const privateKey =
    process.env.ATRIB_PRIVATE_KEY === undefined
      ? TEST_KEY_BYTES
      : base64urlDecode(process.env.ATRIB_PRIVATE_KEY)
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const entries: PrivateMirrorEntry[] = []

  const phoenixExporter = new AllowlistSpanExporter(
    new OTLPTraceExporter({ url: PHOENIX_OTLP_ENDPOINT, headers: phoenixHeaders() }),
  )
  const atribProcessor = new AtribSpanProcessor({
    privateKey,
    creatorKey,
    serverUrl: 'https://example.test/openinference-private-evidence',
    submit: (record, local) => entries.push({ record, local }),
    autoInformedBy: true,
    argsResultHashPosture: 'salted',
  })
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(phoenixExporter), atribProcessor],
  })
  const tracer = provider.getTracer(RUN_NAME)

  try {
    const root = tracer.startSpan('private-evidence-run')
    setSafeCorrelationAttributes(root, runId)
    await context.with(trace.setSpan(context.active(), root), async () => {
      const llmSpan = tracer.startSpan('select-refund-tool')
      setSafeCorrelationAttributes(llmSpan, runId)
      llmSpan.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, 'LLM')
      llmSpan.setAttribute(SemanticConventions.LLM_MODEL_NAME, 'synthetic-review-model')
      llmSpan.setAttribute(
        'llm.output_messages.0.message.tool_calls.0.tool_call.id',
        'private-refund-call',
      )
      llmSpan.setAttribute(SemanticConventions.INPUT_VALUE, privateInput)
      llmSpan.setAttribute(
        SemanticConventions.OUTPUT_VALUE,
        JSON.stringify({ tool_call_id: 'private-refund-call', privateNonce }),
      )
      llmSpan.end()

      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      const toolSpan = tracer.startSpan('approve_refund')
      setSafeCorrelationAttributes(toolSpan, runId)
      toolSpan.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, 'TOOL')
      toolSpan.setAttribute(SemanticConventions.TOOL_NAME, 'approve_refund')
      toolSpan.setAttribute('tool_call.id', 'private-refund-call')
      toolSpan.setAttribute(SemanticConventions.INPUT_VALUE, privateInput)
      toolSpan.setAttribute(SemanticConventions.OUTPUT_VALUE, privateOutput)
      toolSpan.end()
    })
    root.end()

    await provider.forceFlush()
    await atribProcessor.forceFlush()

    if (entries.length !== 2) {
      throw new Error(`expected 2 signed OpenInference records, got ${entries.length}`)
    }
    const privateMirrorPath = await writePrivateMirror(entries)
    const traceIds = [...new Set(entries.map(({ local }) => local.traceId))]
    const spanIds = entries.map(({ local }) => local.spanId)
    const spanNames = entries.map(({ local }) => local.spanName)
    if (traceIds.length !== 1) {
      throw new Error(`expected one trace id, got ${traceIds.length}`)
    }

    const phoenixReceipt = await waitForPhoenixReceipt({
      fromStartTime,
      traceIds,
      spanIds,
      spanNames,
      privateInputValues,
      privateOutputValues,
    })
    if (phoenixReceipt.payloadContainsPrivateInput || phoenixReceipt.payloadContainsPrivateOutput) {
      throw new Error('Phoenix retained private input or output despite the allowlist exporter')
    }

    await deletePhoenixTrace(traceIds[0]!)
    const phoenixTraceDeleted = await phoenixNoLongerContainsTrace(fromStartTime, traceIds[0]!)
    if (!phoenixTraceDeleted) throw new Error('Phoenix still returned the deleted trace')

    const postDeleteVerification = await verifyPrivateMirror(privateMirrorPath)
    if (
      !postDeleteVerification.signaturesValid ||
      !postDeleteVerification.argsCommitmentsValid ||
      !postDeleteVerification.resultCommitmentsValid ||
      !postDeleteVerification.traceIdsSignedAsContext
    ) {
      throw new Error('post-delete private-evidence verification failed')
    }
    const publicProof = await publishPublicProofs(entries, [
      ...privateInputValues,
      ...privateOutputValues,
    ])

    console.log(
      JSON.stringify({
        status: 'ok',
        run_id: runId,
        phoenix: {
          base_url: PHOENIX_BASE_URL,
          project: PROJECT_NAME,
          receipt_attempts: phoenixReceipt.attempts,
          trace_received: true,
          private_input_exported: phoenixReceipt.payloadContainsPrivateInput,
          private_output_exported: phoenixReceipt.payloadContainsPrivateOutput,
          trace_deleted: phoenixTraceDeleted,
        },
        atrib: {
          records: entries.length,
          record_hashes: entries.map(({ record }) => recordHash(record)),
          context_ids: [...new Set(entries.map(({ record }) => record.context_id))],
          signed_trace_correlation: postDeleteVerification.traceIdsSignedAsContext,
          signatures_valid_after_phoenix_delete: postDeleteVerification.signaturesValid,
          private_args_match_commitments_after_phoenix_delete:
            postDeleteVerification.argsCommitmentsValid,
          private_results_match_commitments_after_phoenix_delete:
            postDeleteVerification.resultCommitmentsValid,
          private_mirror_path: privateMirrorPath,
        },
        public_proof: publicProof,
        boundary: {
          public_record_contains_span_id: false,
          private_mirror_contains_span_id: true,
          public_log_inclusion_proved: publicProof.enabled,
          note: publicProof.enabled
            ? 'This run proves signatures, trace correlation, redacted Phoenix export, deletion, private disclosure replay, public-log inclusion, checkpoint signature validity, and archive retrieval without private bodies.'
            : 'This run proves signatures, trace correlation, redacted Phoenix export, deletion, and private disclosure replay. Set ATRIB_OPENINFERENCE_PUBLIC_PROOF=1 to add public-log inclusion and archive retrieval.',
        },
      }),
    )
  } finally {
    await provider.shutdown()
    ctxManager.disable()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
