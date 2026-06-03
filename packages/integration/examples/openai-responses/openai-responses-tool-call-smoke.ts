// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import OpenAI from 'openai'
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { OpenAIResponsesToolCallReceiptRecorder } from '../../src/openai-responses-tool-call-receipt.js'

const require = createRequire(import.meta.url)
const contextId = '6f70656e61692d726573706f6e736573'
const privateKey = Buffer.from(
  '102132435465768798a9bacbdcedfeef102132435465768798a9bacbdcedfeef',
  'hex',
)
const privatePhrase = 'lotus OpenAI Responses note stays local'
const baseTimestamp = 1_779_840_300_000

type SmokeResult = {
  ok: true
  note: string
  openai_responses: {
    package: 'openai'
    version: string
    client: 'OpenAI'
    api: 'responses.create'
    base_url: 'local-fixture'
    tool_item_type: 'function_call'
    tool_output_item_type: 'function_call_output'
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  response_ids: {
    tool_call: string
    final: string
  }
  final_output_text: string
  final_receipt: {
    status: 'quoted'
    quote_id: string
    sku: string
    quantity: number
    total_usd: number
  }
  event_counts: {
    responses_create_calls: number
    request_function_tools: number
    raw_function_call_items: number
    raw_function_call_output_items: number
    signed_function_tool_items: number
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

export async function runOpenAIResponsesToolCallReceiptSmoke(): Promise<SmokeResult> {
  const fixture = await startResponsesFixture()
  try {
    const client = new OpenAI({
      apiKey: 'fixture-key',
      baseURL: fixture.baseURL,
    })
    const recorder = new OpenAIResponsesToolCallReceiptRecorder({
      privateKey,
      contextId,
      serverUrl: 'openai-responses://atrib-runtime-smoke',
      logSubmission: 'disabled',
      now: timestampClock(baseTimestamp),
    })
    const tool: ResponseCreateParamsNonStreaming['tools'] = [
      {
        type: 'function',
        name: 'procurement_quote',
        description: 'Create a procurement quote for a SKU and quantity.',
        strict: true,
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sku: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            internal_note: { type: 'string' },
          },
          required: ['sku', 'quantity', 'internal_note'],
        },
      },
    ]

    const toolCallResponse = await client.responses.create({
      model: 'gpt-5-mini',
      input: 'Quote 2 atlas-kit units with the private procurement note.',
      tools: tool,
      tool_choice: { type: 'function', name: 'procurement_quote' },
      store: false,
    })
    const toolCall = findFunctionToolCall(toolCallResponse)
    const receipt = runProcurementQuote(parseToolArgs(toolCall.arguments))
    const publicReceipt = omitInternalNote(receipt)
    recorder.recordFunctionToolCall({
      response: toolCallResponse,
      toolCall,
      result: receipt,
    })

    const finalResponse = await client.responses.create({
      model: 'gpt-5-mini',
      previous_response_id: toolCallResponse.id,
      input: [
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(receipt),
        },
      ],
      store: false,
    })

    await recorder.flushAtrib()
    const records = recorder.getSignedRecords()
    const sidecars = recorder.getSidecars()
    const invalid = []
    for (const record of records) {
      if (!(await verifyRecord(record))) invalid.push(record.tool_name)
    }
    if (invalid.length > 0) {
      throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
    }

    const publicRecordJson = JSON.stringify(records)
    if (publicRecordJson.includes(privatePhrase)) {
      throw new Error('public records leaked the private OpenAI Responses tool payload')
    }
    if (!JSON.stringify(sidecars).includes(privatePhrase)) {
      throw new Error('local sidecars should keep inspectable OpenAI Responses material')
    }

    const recordHashes = records.map(
      (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
    )
    const requests = fixture.getRequests()

    return {
      ok: true,
      note: 'Runs real openai SDK Responses calls against a local fixture, mirrors a function_call plus function_call_output cycle, then signs one hash-only atrib record for the tool-call boundary.',
      openai_responses: {
        package: 'openai',
        version: packageVersion('openai'),
        client: 'OpenAI',
        api: 'responses.create',
        base_url: 'local-fixture',
        tool_item_type: 'function_call',
        tool_output_item_type: 'function_call_output',
      },
      context_id: contextId,
      signed_records: records.length,
      operations: records.map((record) => record.tool_name ?? ''),
      record_hashes: recordHashes,
      response_ids: {
        tool_call: toolCallResponse.id,
        final: finalResponse.id,
      },
      final_output_text: finalResponse.output_text,
      final_receipt: publicReceipt,
      event_counts: {
        responses_create_calls: requests.length,
        request_function_tools: countFunctionTools(requests[0]),
        raw_function_call_items: toolCallResponse.output.filter(
          (item) => item.type === 'function_call',
        ).length,
        raw_function_call_output_items: countFunctionCallOutputInputs(requests[1]),
        signed_function_tool_items: sidecars.length,
      },
      privacy: {
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
      },
      caveats: [
        'This proves the OpenAI Node SDK Responses custom tool-call shape against a local fixture, not a hosted OpenAI model call.',
        'It does not prove Responses computer use, streaming, MCP tools, OpenAI conversations or sessions, tracing export, or the Python SDK.',
        'The local fixture is deliberate so the proof is deterministic and does not require OPENAI_API_KEY.',
      ],
    }
  } finally {
    await fixture.close()
  }
}

function findFunctionToolCall(response: Response): ResponseFunctionToolCall {
  const toolCall = response.output.find(
    (item): item is ResponseFunctionToolCall => item.type === 'function_call',
  )
  if (!toolCall)
    throw new Error(`missing Responses function_call item: ${JSON.stringify(response)}`)
  return toolCall
}

function parseToolArgs(value: string): {
  sku: string
  quantity: number
  internal_note: string
} {
  const parsed = JSON.parse(value) as {
    sku?: unknown
    quantity?: unknown
    internal_note?: unknown
  }
  if (
    typeof parsed.sku !== 'string' ||
    typeof parsed.quantity !== 'number' ||
    typeof parsed.internal_note !== 'string'
  ) {
    throw new Error(`unexpected OpenAI Responses tool args: ${value}`)
  }
  return {
    sku: parsed.sku,
    quantity: parsed.quantity,
    internal_note: parsed.internal_note,
  }
}

function runProcurementQuote(input: {
  sku: string
  quantity: number
  internal_note: string
}): SmokeResult['final_receipt'] & { internal_note: string } {
  return {
    status: 'quoted',
    quote_id: 'openai-responses-atlas-kit-2',
    sku: input.sku,
    quantity: input.quantity,
    total_usd: input.quantity * 42,
    internal_note: input.internal_note,
  }
}

function omitInternalNote(
  receipt: SmokeResult['final_receipt'] & { internal_note: string },
): SmokeResult['final_receipt'] {
  return {
    status: receipt.status,
    quote_id: receipt.quote_id,
    sku: receipt.sku,
    quantity: receipt.quantity,
    total_usd: receipt.total_usd,
  }
}

async function startResponsesFixture(): Promise<{
  baseURL: string
  getRequests(): Array<ResponseCreateParamsNonStreaming>
  close(): Promise<void>
}> {
  const requests: Array<ResponseCreateParamsNonStreaming> = []
  const server = createServer(async (req, res) => {
    try {
      if (
        req.method !== 'POST' ||
        !new URL(req.url ?? '/', 'http://local').pathname.endsWith('/responses')
      ) {
        sendJson(res, 404, { error: { message: 'not found' } })
        return
      }
      const body = (await readJson(req)) as ResponseCreateParamsNonStreaming
      requests.push(body)
      if (!body.previous_response_id) {
        sendJson(res, 200, buildToolCallResponse(body))
        return
      }
      sendJson(res, 200, buildFinalResponse(body))
    } catch {
      sendJson(res, 500, { error: { message: 'Responses fixture error' } })
    }
  })
  await listen(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not start Responses fixture')
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    getRequests: () => [...requests],
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      }),
  }
}

function buildToolCallResponse(body: ResponseCreateParamsNonStreaming): Response {
  const functionTool = body.tools?.find((tool) => tool.type === 'function')
  if (!functionTool || functionTool.name !== 'procurement_quote') {
    throw new Error(`expected procurement_quote function tool: ${JSON.stringify(body.tools)}`)
  }
  return responseBase({
    id: 'resp_openai_responses_tool_001',
    output_text: '',
    output: [
      {
        type: 'function_call',
        id: 'fc_openai_responses_001',
        call_id: 'call_procurement_quote_001',
        name: 'procurement_quote',
        status: 'completed',
        arguments: JSON.stringify({
          sku: 'atlas-kit',
          quantity: 2,
          internal_note: privatePhrase,
        }),
      },
    ],
    tools: body.tools ?? [],
  })
}

function buildFinalResponse(body: ResponseCreateParamsNonStreaming): Response {
  const output = findFunctionCallOutput(body.input)
  const receipt = JSON.parse(output.output) as SmokeResult['final_receipt']
  return responseBase({
    id: 'resp_openai_responses_final_001',
    previous_response_id: body.previous_response_id ?? null,
    output_text: `Procurement accepted ${receipt.quote_id} at $${receipt.total_usd}.`,
    output: [
      {
        type: 'message',
        id: 'msg_openai_responses_final_001',
        role: 'assistant',
        status: 'completed',
        content: [
          {
            type: 'output_text',
            text: `Procurement accepted ${receipt.quote_id} at $${receipt.total_usd}.`,
            annotations: [],
          },
        ],
      },
    ],
    tools: [],
  })
}

function responseBase({
  id,
  previous_response_id,
  output_text,
  output,
  tools,
}: {
  id: string
  previous_response_id?: string | null
  output_text: string
  output: Response['output']
  tools: Response['tools']
}): Response {
  return {
    id,
    object: 'response',
    created_at: 1_779_840_300,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: 'gpt-5-mini',
    output,
    output_text,
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: 'auto',
    tools,
    top_p: null,
    background: false,
    max_output_tokens: null,
    previous_response_id,
    reasoning: null,
    service_tier: 'default',
    store: false,
    truncation: 'disabled',
    usage: {
      input_tokens: 12,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 8,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: 20,
    },
  }
}

function findFunctionCallOutput(input: ResponseCreateParamsNonStreaming['input']): {
  type: 'function_call_output'
  call_id: string
  output: string
} {
  if (!Array.isArray(input)) throw new Error('expected structured Responses input')
  const output = input.find(
    (item): item is Extract<ResponseInputItem, { type: 'function_call_output' }> =>
      item.type === 'function_call_output',
  )
  if (!output || typeof output.output !== 'string') {
    throw new Error(`missing Responses function_call_output item: ${JSON.stringify(input)}`)
  }
  return {
    type: 'function_call_output',
    call_id: output.call_id,
    output: output.output,
  }
}

function countFunctionTools(request: ResponseCreateParamsNonStreaming | undefined): number {
  return request?.tools?.filter((tool) => tool.type === 'function').length ?? 0
}

function countFunctionCallOutputInputs(
  request: ResponseCreateParamsNonStreaming | undefined,
): number {
  return Array.isArray(request?.input)
    ? request.input.filter((item) => item.type === 'function_call_output').length
    : 0
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? (JSON.parse(text) as unknown) : {}
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
}

function packageVersion(name: 'openai'): string {
  let dir = dirname(require.resolve(name))
  while (dir !== dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: string
        version?: string
      }
      if (pkg.name === name && typeof pkg.version === 'string') return pkg.version
    } catch {
      // Keep walking until we reach the package root.
    }
    dir = dirname(dir)
  }
  throw new Error(`could not resolve ${name} package version`)
}

function timestampClock(start: number): () => number {
  let offset = 0
  return () => start + offset++
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOpenAIResponsesToolCallReceiptSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch(() => {
      console.error('OpenAI Responses tool-call receipt smoke failed')
      process.exitCode = 1
    })
}
