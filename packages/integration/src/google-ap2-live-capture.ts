import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { extractGoogleAp2SampleArtifacts } from './google-ap2-sample-extract.js'
import { runAp2LiveInterop, type Ap2LiveInteropSummary } from './ap2-live-interop.js'

export interface GoogleAp2LiveCaptureOptions {
  agentUrl?: string
  triggerUrl?: string
  outDir: string
  artifactOutDir?: string
  tempDbDir?: string
  contextId?: string
  sessionId?: string
  firstPrompt?: string
  approvalText?: string
  fallbackApprovalText?: string
  budget?: number
  triggerPrice?: number
  messageTimeoutMs?: number
}

export interface GoogleAp2LiveCaptureResult {
  sessionId: string
  taskId: string
  events: unknown[]
  transcript: TranscriptEntry[]
  mandateRequest: JsonRecord
  monitoring: JsonRecord
  purchaseComplete: JsonRecord
  files: {
    events: string
    transcript: string
    summary: string
  }
  artifactFiles?: {
    result: string
    evidence: string
    transactionRecord: string
    metadata: string
    extractionMetadata: string
  }
  interop?: Ap2LiveInteropSummary
}

interface TranscriptEntry {
  direction: 'request' | 'response'
  message?: unknown
  text?: string
  functionResponses?: string[]
}

interface JsonRecord {
  [key: string]: unknown
}

interface StreamResponse {
  text: string
  functionResponses: string[]
}

const DEFAULT_AGENT_URL = 'http://localhost:8080/a2a/shopping_agent'
const DEFAULT_TRIGGER_URL = 'http://localhost:8081'
const DEFAULT_FIRST_PROMPT =
  "When is the SuperShoe limited edition Gold sneaker drop? I need size 9 women's."
const DEFAULT_APPROVAL_TEXT = 'Yes, please buy if it drops at or below $200.'
const DEFAULT_FALLBACK_APPROVAL_TEXT = '$200 is fine. Please buy it for me when it drops.'
const DEFAULT_BUDGET = 200
const DEFAULT_MESSAGE_TIMEOUT_MS = 120_000

export async function captureGoogleAp2LiveSample(
  options: GoogleAp2LiveCaptureOptions,
): Promise<GoogleAp2LiveCaptureResult> {
  const agentUrl = options.agentUrl ?? DEFAULT_AGENT_URL
  const triggerUrl = options.triggerUrl ?? DEFAULT_TRIGGER_URL
  const sessionId = options.sessionId ?? `atrib-ap2-${randomUUID()}`
  const firstPrompt = options.firstPrompt ?? DEFAULT_FIRST_PROMPT
  const approvalText = options.approvalText ?? DEFAULT_APPROVAL_TEXT
  const fallbackApprovalText = options.fallbackApprovalText ?? DEFAULT_FALLBACK_APPROVAL_TEXT
  const budget = options.budget ?? DEFAULT_BUDGET
  const triggerPrice = options.triggerPrice ?? budget - 1
  const messageTimeoutMs = options.messageTimeoutMs ?? DEFAULT_MESSAGE_TIMEOUT_MS
  const events: unknown[] = []
  const transcript: TranscriptEntry[] = []
  let taskId = randomUUID()

  const send = async (
    message: string | JsonRecord,
    reuseTaskId = taskId,
  ): Promise<StreamResponse> => {
    taskId = reuseTaskId
    return sendA2aMessage({
      agentUrl,
      sessionId,
      taskId,
      message,
      events,
      transcript,
      messageTimeoutMs,
    })
  }

  await send(firstPrompt)
  const approval = await send(approvalText)
  let mandateRequest = extractJsonByType(approval.text, 'mandate_request')
  if (!mandateRequest) {
    const fallback = await send(fallbackApprovalText)
    mandateRequest = extractJsonByType(fallback.text, 'mandate_request')
  }
  if (!mandateRequest) throw new Error('google_ap2_mandate_request_not_found')

  const monitoringResponse = await send({
    type: 'mandate_approved',
    mandate_request: mandateRequest,
  })
  let monitoring = extractJsonByType(monitoringResponse.text, 'monitoring')
  if (!monitoring) {
    const check = await send('Check price now')
    monitoring = extractJsonByType(check.text, 'monitoring')
  }
  if (!monitoring) throw new Error('google_ap2_monitoring_not_found')

  const itemId = requireString(monitoring, 'item_id')
  const priceCap = requireNumber(monitoring, 'price_cap')
  const qty = readNumber(monitoring, 'qty') ?? 1
  const openCheckoutMandate = requireString(monitoring, 'open_checkout_mandate')
  const openPaymentMandate = requireString(monitoring, 'open_payment_mandate')
  await triggerMerchantDrop(triggerUrl, itemId, triggerPrice)

  const purchaseResponse = await send({
    type: 'check_product_now',
    item_id: itemId,
    price_cap: priceCap,
    qty,
    open_checkout_mandate: openCheckoutMandate,
    open_payment_mandate: openPaymentMandate,
    message: 'Check product now',
    source: 'atrib_google_ap2_live_capture',
  })
  const purchaseComplete = extractJsonByType(purchaseResponse.text, 'purchase_complete')
  if (!purchaseComplete) throw new Error('google_ap2_purchase_complete_not_found')

  await mkdir(options.outDir, { recursive: true })
  const eventsPath = join(options.outDir, 'events.json')
  const transcriptPath = join(options.outDir, 'transcript.json')
  const summaryPath = join(options.outDir, 'summary.json')
  const summary: Omit<GoogleAp2LiveCaptureResult, 'events' | 'transcript'> = {
    sessionId,
    taskId,
    mandateRequest,
    monitoring,
    purchaseComplete,
    files: {
      events: eventsPath,
      transcript: transcriptPath,
      summary: summaryPath,
    },
  }

  await writeJson(eventsPath, events)
  await writeJson(transcriptPath, { sessionId, taskId, transcript })

  if (options.tempDbDir) {
    const artifactOutDir = options.artifactOutDir ?? join(options.outDir, 'atrib-packet')
    const extracted = await extractGoogleAp2SampleArtifacts({
      events,
      tempDbDir: options.tempDbDir,
      outDir: artifactOutDir,
      ...(options.contextId ? { contextId: options.contextId } : {}),
    })
    summary.artifactFiles = extracted.files
    summary.interop = await runAp2LiveInterop({
      result: extracted.artifacts.result,
      evidence: extracted.artifacts.evidence,
      transactionRecord: extracted.artifacts.transactionRecord,
      requireCounterpartyAttestation: true,
      evidenceOptions: { nowSeconds: extracted.metadata.now_seconds },
    })
  }

  await writeJson(summaryPath, summary)

  return {
    ...summary,
    events,
    transcript,
  }
}

async function sendA2aMessage(input: {
  agentUrl: string
  sessionId: string
  taskId: string
  message: string | JsonRecord
  events: unknown[]
  transcript: TranscriptEntry[]
  messageTimeoutMs: number
}): Promise<StreamResponse> {
  const parts =
    typeof input.message === 'string'
      ? [{ kind: 'text', text: input.message }]
      : [{ kind: 'data', data: input.message, mimeType: 'application/json' }]
  const request = {
    jsonrpc: '2.0',
    id: input.taskId,
    method: 'message/stream',
    params: {
      message: {
        role: 'user',
        parts,
        messageId: randomUUID(),
      },
      configuration: { historyLength: 20 },
      metadata: { sessionId: input.sessionId },
    },
  }

  input.transcript.push({ direction: 'request', message: input.message })

  const response = await fetch(input.agentUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(input.messageTimeoutMs),
  })
  if (!response.ok || !response.body) {
    throw new Error(`google_ap2_a2a_error:${response.status}:${response.statusText}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const functionResponses: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const event = parseJson(line.slice('data: '.length))
      if (!event) continue
      input.events.push(event)
      collectA2aTextAndFunctionResponses(event, {
        appendText: (chunk) => {
          text += chunk
        },
        appendFunctionResponse: (name) => functionResponses.push(name),
      })
    }
  }

  input.transcript.push({
    direction: 'response',
    text,
    functionResponses,
  })

  return { text, functionResponses }
}

function collectA2aTextAndFunctionResponses(
  event: unknown,
  output: {
    appendText: (chunk: string) => void
    appendFunctionResponse: (name: string) => void
  },
): void {
  if (!isRecord(event)) return
  const result = isRecord(event['result']) ? event['result'] : {}
  const status = isRecord(result['status']) ? result['status'] : {}
  const statusMessage = isRecord(status['message']) ? status['message'] : {}
  const artifact = isRecord(result['artifact']) ? result['artifact'] : undefined
  const artifacts = Array.isArray(result['artifacts']) ? result['artifacts'] : []
  const partLists = [
    readParts(statusMessage),
    ...(artifact ? [readParts(artifact)] : []),
    ...artifacts.filter(isRecord).map(readParts),
  ]

  for (const parts of partLists) {
    for (const part of parts) {
      const text = readString(part, 'text')
      if (text) output.appendText(text)
      const responseName = readFunctionResponseName(part)
      if (responseName) output.appendFunctionResponse(responseName)
    }
  }
}

function readParts(record: JsonRecord): JsonRecord[] {
  const parts = record['parts']
  return Array.isArray(parts) ? parts.filter(isRecord) : []
}

function readFunctionResponseName(part: JsonRecord): string | undefined {
  const root = isRecord(part['root']) ? part['root'] : part
  const functionResponse = root['functionResponse'] ?? root['function_response'] ?? root['data']
  if (!isRecord(functionResponse)) return undefined
  return readString(functionResponse, 'name')
}

function extractJsonByType(text: string, type: string): JsonRecord | undefined {
  const candidates: JsonRecord[] = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue
    const raw = extractBalancedObject(text, start)
    if (!raw) continue
    const parsed = parseJson(raw)
    if (isRecord(parsed) && parsed['type'] === type) candidates.push(parsed)
  }
  return candidates.at(-1)
}

function extractBalancedObject(text: string, start: number): string | undefined {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }

  return undefined
}

async function triggerMerchantDrop(
  triggerUrl: string,
  itemId: string,
  price: number,
): Promise<void> {
  const url = new URL('/trigger-price-drop', triggerUrl)
  url.searchParams.set('item_id', itemId)
  url.searchParams.set('price', String(price))
  url.searchParams.set('stock', '10')

  const response = await fetch(url, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`google_ap2_trigger_error:${response.status}:${response.statusText}`)
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function requireString(record: JsonRecord, key: string): string {
  const value = readString(record, key)
  if (value === undefined) throw new Error(`google_ap2_missing_string:${key}`)
  return value
}

function requireNumber(record: JsonRecord, key: string): number {
  const value = readNumber(record, key)
  if (value === undefined) throw new Error(`google_ap2_missing_number:${key}`)
  return value
}

function readString(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
