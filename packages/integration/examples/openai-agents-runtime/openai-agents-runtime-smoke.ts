// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Agent, setTracingDisabled, tool, Usage } from '@openai/agents'
import type {
  AgentOutputItem,
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from '@openai/agents'
import { z } from 'zod'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { OpenAIAgentsRuntimeReceiptRecorder } from '../../src/openai-agents-runtime-receipt.js'

const require = createRequire(import.meta.url)
const contextId = '6f70656e61692d6167656e7473212121'
const privateKey = Buffer.from(
  '2031425364758697a8b9cacbdcedfeef2031425364758697a8b9cacbdcedfeef',
  'hex',
)
const privatePhrase = 'lotus OpenAI agent runtime note stays local'
const baseTimestamp = 1_779_840_200_000

type SmokeResult = {
  ok: true
  note: string
  openai_agents: {
    package: '@openai/agents'
    version: string
    runner: 'run'
    agent: 'Agent'
    model: 'scripted'
    tool: 'tool'
    lifecycle: 'agent_tool_end'
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  final_output: string
  final_receipt: {
    status: 'quoted'
    quote_id: string
    sku: string
    quantity: number
    total_usd: number
  }
  event_counts: {
    model_calls: number
    tool_call_items: number
    tool_call_output_items: number
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

export async function runOpenAIAgentsRuntimeReceiptSmoke(): Promise<SmokeResult> {
  setTracingDisabled(true)

  const model = new ScriptedToolModel()
  const recorder = new OpenAIAgentsRuntimeReceiptRecorder({
    privateKey,
    contextId,
    serverUrl: 'openai-agents://atrib-runtime-smoke',
    logSubmission: 'disabled',
    now: timestampClock(baseTimestamp),
  })
  const quoteTool = tool({
    name: 'quote_price',
    description: 'Create a procurement quote for a SKU and quantity.',
    parameters: z.object({
      sku: z.string(),
      quantity: z.number().int().positive(),
      internal_note: z.string(),
    }),
    execute: async (input) => ({
      status: 'quoted' as const,
      quote_id: 'openai-agents-atlas-kit-2',
      sku: input.sku,
      quantity: input.quantity,
      total_usd: input.quantity * 42,
      internal_note: input.internal_note,
    }),
  })
  const agent = recorder.attachAgent(
    new Agent({
      name: 'Procurement Reviewer',
      instructions: 'Use quote_price for procurement quote requests.',
      model,
      tools: [quoteTool],
    }),
  )

  const result = await import('@openai/agents').then(({ run }) =>
    run(agent, 'Quote 2 atlas-kit units with the private procurement note.', {
      maxTurns: 3,
    }),
  )

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
    throw new Error('public records leaked the private OpenAI Agents tool payload')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable OpenAI Agents tool material')
  }

  const receipt = unwrapReceipt(sidecars[0]?.result)
  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )
  const output = result.output

  return {
    ok: true,
    note: 'Runs a real @openai/agents Agent with a scripted local Model, executes a real function tool through run(), then signs one hash-only atrib record from the SDK lifecycle event.',
    openai_agents: {
      package: '@openai/agents',
      version: packageVersion('@openai/agents'),
      runner: 'run',
      agent: 'Agent',
      model: 'scripted',
      tool: 'tool',
      lifecycle: 'agent_tool_end',
    },
    context_id: contextId,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    record_hashes: recordHashes,
    final_output: String(result.finalOutput),
    final_receipt: receipt,
    event_counts: {
      model_calls: model.calls,
      tool_call_items: output.filter((item) => item.type === 'function_call').length,
      tool_call_output_items: output.filter((item) => item.type === 'function_call_result').length,
    },
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This proves the @openai/agents JavaScript local function-tool boundary, not the Python Agents SDK.',
      'It does not call a hosted OpenAI model, the Responses API, computer-use tools, MCP transports, sessions, handoffs, or OpenAI tracing export.',
      'The scripted model is deliberate so the proof is deterministic and does not require OPENAI_API_KEY.',
    ],
  }
}

class ScriptedToolModel implements Model {
  calls = 0

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1
    if (this.calls === 1) {
      const toolName = request.tools.find((entry) => entry.type === 'function')?.name
      if (toolName !== 'quote_price') {
        throw new Error(`expected quote_price tool, saw ${toolName ?? 'none'}`)
      }
      return {
        usage: new Usage({ requests: 1 }),
        responseId: 'openai-agents-scripted-1',
        output: [
          {
            type: 'function_call',
            callId: 'openai-agents-tool-call-1',
            name: 'quote_price',
            status: 'completed',
            arguments: JSON.stringify({
              sku: 'atlas-kit',
              quantity: 2,
              internal_note: privatePhrase,
            }),
          },
        ],
      }
    }

    const receipt = findToolReceipt(request.input)
    return {
      usage: new Usage({ requests: 1 }),
      responseId: `openai-agents-scripted-${this.calls}`,
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: `Quote ${receipt.quote_id} totals $${receipt.total_usd}.`,
            },
          ],
        },
      ],
    }
  }

  async *getStreamedResponse(_request: ModelRequest): AsyncIterable<StreamEvent> {
    throw new Error('streaming is not used by this smoke')
  }
}

function findToolReceipt(input: ModelRequest['input']): SmokeResult['final_receipt'] {
  if (typeof input === 'string') throw new Error('expected structured model input after tool call')
  const output = input.find(
    (item): item is Extract<AgentOutputItem, { type: 'function_call_result' }> =>
      item.type === 'function_call_result',
  )
  const value = parseToolOutput(output?.output)
  return unwrapReceipt(value)
}

function parseToolOutput(output: unknown): unknown {
  const text =
    typeof output === 'string'
      ? output
      : output && typeof output === 'object' && 'text' in output && typeof output.text === 'string'
        ? output.text
        : undefined
  if (!text) return output
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function unwrapReceipt(value: unknown): SmokeResult['final_receipt'] {
  const receipt = value as {
    status?: unknown
    quote_id?: unknown
    sku?: unknown
    quantity?: unknown
    total_usd?: unknown
  }
  if (
    receipt.status !== 'quoted' ||
    typeof receipt.quote_id !== 'string' ||
    typeof receipt.sku !== 'string' ||
    typeof receipt.quantity !== 'number' ||
    typeof receipt.total_usd !== 'number'
  ) {
    throw new Error(`unexpected OpenAI Agents tool result: ${JSON.stringify(value)}`)
  }
  return {
    status: 'quoted',
    quote_id: receipt.quote_id,
    sku: receipt.sku,
    quantity: receipt.quantity,
    total_usd: receipt.total_usd,
  }
}

function packageVersion(name: '@openai/agents'): string {
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
  runOpenAIAgentsRuntimeReceiptSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error('OpenAI Agents runtime receipt smoke failed:', err)
      process.exitCode = 1
    })
}
