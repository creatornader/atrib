// SPDX-License-Identifier: Apache-2.0

import {
  BaseLlm,
  FunctionTool,
  getFunctionCalls,
  getFunctionResponses,
  InMemoryRunner,
  LlmAgent,
  setLogger,
  version as adkVersion,
} from '@google/adk'
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { AtribAdkPlugin } from '../../src/google-adk-attribution.js'

const contextId = '676f6f676c652d61646b2d70726f6f66'
const privateKey = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex',
)
const privatePhrase = 'orchid order note stays local'
const baseTimestamp = 1_779_840_000_000

type SmokeResult = {
  ok: true
  note: string
  adk: {
    package: '@google/adk'
    version: string
    runner: 'InMemoryRunner'
    plugin: 'BasePlugin'
    tool: 'FunctionTool'
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  final_text: string
  event_counts: {
    yielded_events: number
    function_call_events: number
    function_response_events: number
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
}

class ScriptedAdkModel extends BaseLlm {
  private calls = 0

  constructor() {
    super({ model: 'atrib-scripted-adk-model' })
  }

  override async *generateContentAsync(
    _llmRequest: LlmRequest,
    _stream?: boolean,
    _abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    this.calls += 1
    if (this.calls === 1) {
      yield {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'adk-tool-call-1',
                name: 'quote_price',
                args: {
                  sku: 'atlas-kit',
                  quantity: 2,
                  internal_note: privatePhrase,
                },
              },
            },
          ],
        },
      }
      return
    }

    yield {
      content: {
        role: 'model',
        parts: [{ text: 'Quote ready for atlas-kit.' }],
      },
    }
  }

  override async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('google-adk smoke does not use live model connections')
  }
}

export async function runGoogleAdkPluginSmoke(): Promise<SmokeResult> {
  setLogger(null)
  const plugin = new AtribAdkPlugin({
    privateKey,
    contextId,
    serverUrl: 'adk://atrib-google-adk-smoke',
    logSubmission: 'disabled',
    now: timestampClock(baseTimestamp),
  })

  const quotePrice = new FunctionTool({
    name: 'quote_price',
    description: 'Return a deterministic quote for a catalog item.',
    execute: (input) => {
      const args = input as { sku?: string; quantity?: number; internal_note?: string }
      return {
        sku: args.sku,
        quantity: args.quantity,
        total_cents: 8400,
        private_note: args.internal_note,
      }
    },
  })

  const agent = new LlmAgent({
    name: 'google_adk_atrib_smoke_agent',
    model: new ScriptedAdkModel(),
    instruction: 'Quote catalog items with the quote_price tool.',
    tools: [quotePrice],
  })

  const runner = new InMemoryRunner({
    appName: 'atrib-google-adk-smoke',
    agent,
    plugins: [plugin],
  })

  const events = []
  for await (const event of runner.runEphemeral({
    userId: 'atrib-smoke-user',
    newMessage: {
      role: 'user',
      parts: [{ text: 'Quote two atlas kits.' }],
    },
  })) {
    events.push(event)
  }

  await plugin.flushAtrib()
  const records = plugin.getSignedRecords()
  const sidecars = plugin.getSidecars()
  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private ADK tool payload')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable ADK tool material')
  }

  const finalText = events
    .flatMap((event) => event.content?.parts ?? [])
    .map((part) => ('text' in part && part.text ? part.text : ''))
    .join('')

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )

  return {
    ok: true,
    note: 'Runs a real @google/adk InMemoryRunner with a BasePlugin tool callback, then signs hash-only atrib records.',
    adk: {
      package: '@google/adk',
      version: adkVersion,
      runner: 'InMemoryRunner',
      plugin: 'BasePlugin',
      tool: 'FunctionTool',
    },
    context_id: contextId,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    record_hashes: recordHashes,
    final_text: finalText,
    event_counts: {
      yielded_events: events.length,
      function_call_events: events.filter((event) => getFunctionCalls(event).length > 0).length,
      function_response_events: events.filter((event) => getFunctionResponses(event).length > 0)
        .length,
    },
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
  }
}

function timestampClock(start: number): () => number {
  let offset = 0
  return () => start + offset++
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGoogleAdkPluginSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((err) => {
      console.error('google-adk plugin smoke failed:', err)
      process.exitCode = 1
    })
}
