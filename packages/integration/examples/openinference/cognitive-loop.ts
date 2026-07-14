// SPDX-License-Identifier: Apache-2.0

/**
 * OpenInference -> atrib local mirror -> cognitive read proof.
 *
 * This script is offline-runnable. It emits synthetic OpenInference LLM and
 * TOOL spans, signs them with @atrib/openinference, writes `{ record, _local }`
 * envelopes to a temp local mirror, then proves the same records are readable
 * by recall, trace, and summarize internals.
 */

import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { context, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { AtribSpanProcessor, type AtribSpanSidecar } from '@atrib/openinference'

const TEST_KEY_BYTES = new Uint8Array(32).fill(13)
const TOOL_CALL_ID = 'call_langfuse_boundary_1'

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

async function main(): Promise<void> {
  const ctxManager = new AsyncHooksContextManager()
  ctxManager.enable()
  context.setGlobalContextManager(ctxManager)

  const tmp = await mkdtemp(join(tmpdir(), 'atrib-openinference-cognitive-'))
  const mirrorPath = join(tmp, 'openinference.jsonl')
  const submitted: Array<{ record: AtribRecord; sidecar: AtribSpanSidecar }> = []

  try {
    const creatorKey = base64urlEncode(await getPublicKey(TEST_KEY_BYTES))
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey,
      serverUrl: 'https://example.test/atrib-openinference-cognitive-loop',
      autoInformedBy: true,
      submit: async (record, sidecar) => {
        submitted.push({ record, sidecar })
        await appendFile(
          mirrorPath,
          `${JSON.stringify({
            record,
            _local: {
              ...sidecar,
              producer: 'openinference-cognitive-loop-example',
            },
            written_at: Date.now(),
          })}\n`,
        )
      },
    })

    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('atrib-openinference-cognitive-loop')

    const root = tracer.startSpan('research-agent')
    await context.with(trace.setSpan(context.active(), root), async () => {
      const llmSpan = tracer.startSpan('llm-plan-search')
      llmSpan.setAttribute('openinference.span.kind', 'LLM')
      llmSpan.setAttribute('llm.model_name', 'qwen3.5')
      llmSpan.setAttribute('llm.prompts', 'Compare Langfuse trace shape with atrib evidence shape')
      llmSpan.setAttribute('llm.prompt_template.version', 'langfuse-boundary-v1')
      llmSpan.setAttribute('llm.token_count.prompt', 17)
      llmSpan.setAttribute('llm.token_count.completion', 29)
      llmSpan.setAttribute('llm.cost.total', 0.0013)
      llmSpan.setAttribute('metadata', '{"release":"cognitive-loop","user_id":"example"}')
      llmSpan.setAttribute(
        'llm.output_messages.0.message.tool_calls.0.tool_call.id',
        TOOL_CALL_ID,
      )
      llmSpan.setStatus({ code: SpanStatusCode.OK })
      llmSpan.end()

      await flush()

      const toolSpan = tracer.startSpan('search_web')
      toolSpan.setAttribute('openinference.span.kind', 'TOOL')
      toolSpan.setAttribute('tool.name', 'search_web')
      toolSpan.setAttribute('tool_call.id', TOOL_CALL_ID)
      toolSpan.setAttribute('input.value', '{"query":"Langfuse OpenTelemetry traces observations"}')
      toolSpan.setAttribute('output.value', '{"top_result":"Langfuse maps spans into observations"}')
      toolSpan.setStatus({ code: SpanStatusCode.OK })
      toolSpan.end()
    })
    root.end()

    await flush()
    await provider.shutdown()
    await processor.shutdown()
    await ctxManager.disable()

    const llm = submitted.find((entry) => entry.sidecar.content.span_kind === 'LLM')
    const tool = submitted.find((entry) => entry.sidecar.content.span_kind === 'TOOL')
    expect(llm, 'expected LLM record')
    expect(tool, 'expected TOOL record')
    expect(await verifyRecord(llm.record), 'LLM signature must verify')
    expect(await verifyRecord(tool.record), 'TOOL signature must verify')
    expect(
      tool.record.informed_by?.[0] === recordHash(llm.record),
      'TOOL record must cite the LLM record through informed_by',
    )

    delete process.env.ATRIB_RECORD_FILE
    delete process.env.ATRIB_RECORDS_DIR
    const [
      { loadLoaded },
      { indexableTokensForRecord },
      { loadAllRecords: loadTraceRecords },
      { traceBackward },
      { loadAllRecords: loadSummaryRecords },
      { buildUserMessage },
    ] = await Promise.all([
      import('../../../../services/atrib-recall/src/aggregations.js'),
      import('../../../../services/atrib-recall/src/scoring.js'),
      import('../../../../services/atrib-recall/src/trace-storage.js'),
      import('../../../../services/atrib-recall/src/trace-walk.js'),
      import('../../../../services/atrib-summarize/src/storage.js'),
      import('../../../../services/atrib-summarize/src/prompt.js'),
    ])

    const loaded = loadLoaded(mirrorPath)
    const loadedLlm = loaded.find((entry) => recordHash(entry.record) === recordHash(llm.record))
    expect(loadedLlm, 'recall loader must read the LLM mirror entry')
    const tokens = indexableTokensForRecord(loadedLlm, undefined)
    expect(tokens.includes('langfuse'), 'recall tokens should include prompt text')
    expect(tokens.includes('boundary'), 'recall tokens should include prompt version')
    expect(tokens.includes('qwen3'), 'recall tokens should include model metadata')

    const traceRecords = loadTraceRecords(tmp)
    const traced = traceBackward(recordHash(tool.record), 1, traceRecords.byHash)
    expect(
      traced.visited.some((entry) => entry.record_hash === recordHash(llm.record)),
      `trace must walk from TOOL back to LLM: ${JSON.stringify({
        visited: traced.visited.map((entry) => ({
          hash: entry.record_hash,
          informed_by: entry.record.informed_by,
        })),
        dangling: traced.dangling,
        warnings: traced.warnings,
        indexed: traceRecords.byHash.size,
        llm_hash: recordHash(llm.record),
        tool_hash: recordHash(tool.record),
        tool_informed_by: tool.record.informed_by,
      })}`,
    )
    expect(traced.dangling.length === 0, 'trace should have no dangling informed_by refs')

    const summaryRecords = loadSummaryRecords(tmp)
    const summaryPrompt = buildUserMessage(
      summaryRecords.newestFirst,
      'Explain the OpenInference sidecar cognitive loop.',
    )
    expect(
      summaryPrompt.includes('prompt_version: langfuse-boundary-v1'),
      'summarize prompt must include prompt version',
    )
    expect(summaryPrompt.includes('usage_details:'), 'summarize prompt must include usage details')
    expect(summaryPrompt.includes('tool: search_web'), 'summarize prompt must include tool name')

    console.log(
      JSON.stringify({
        status: 'ok',
        records: submitted.length,
        recall_tokens_checked: ['langfuse', 'boundary', 'qwen3'],
        trace_visited: traced.visited.length,
        summarize_prompt_bytes: summaryPrompt.length,
      }),
    )
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('openinference cognitive loop failed:', err)
    process.exit(1)
  },
)
