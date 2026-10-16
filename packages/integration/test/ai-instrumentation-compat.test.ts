// SPDX-License-Identifier: Apache-2.0

import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { context } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import {
  OpenInferenceSimpleSpanProcessor,
  isOpenInferenceSpan,
} from '@arizeai/openinference-vercel'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { LegacyOpenTelemetry } from '@ai-sdk/otel'
import { generateText, streamText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import {
  AtribSpanProcessor,
  AtribBatchSpanProcessor,
  type AtribSpanSidecar,
} from '@atrib/openinference'
import {
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'

async function pipeline(batch: boolean) {
  const manager = new AsyncHooksContextManager().enable()
  context.setGlobalContextManager(manager)
  const privateKey = new Uint8Array(32).fill(19)
  const records: AtribRecord[] = []
  const sidecars: AtribSpanSidecar[] = []
  const exporter = new InMemorySpanExporter()
  const options = {
    privateKey,
    creatorKey: base64urlEncode(await getPublicKey(privateKey)),
    serverUrl: 'https://example.test/ai-instrumentation',
    autoInformedBy: true,
    argsResultHashPosture: 'plain' as const,
    submit(record: AtribRecord, sidecar: AtribSpanSidecar) {
      records.push(record)
      sidecars.push(sidecar)
    },
  }
  const atrib = batch
    ? new AtribBatchSpanProcessor({
        ...options,
        submit(entries) {
          for (const entry of entries) options.submit(entry.signed, entry.sidecar)
        },
      })
    : new AtribSpanProcessor(options)
  const arize = new OpenInferenceSimpleSpanProcessor({ exporter, spanFilter: isOpenInferenceSpan })
  const provider = new BasicTracerProvider({ spanProcessors: [arize, atrib] })
  const telemetry = {
    integrations: [new LegacyOpenTelemetry({ tracer: provider.getTracer('ai-compatibility') })],
    functionId: 'local-ai-compatibility',
  }
  return { provider, exporter, records, sidecars, telemetry, manager }
}

type RequestBody = { stream?: boolean; messages: Array<{ role: string; content?: unknown }> }
type Reply = (body: RequestBody, index: number) => { status?: number; body: unknown }
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  context.disable()
})

async function fixture(reply: Reply, batch = false) {
  const requests: RequestBody[] = []
  const server = createServer(async (req, res) => {
    expect(req.url).toBe('/chat/completions')
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as RequestBody
    requests.push(body)
    const response = reply(body, requests.length - 1)
    res.writeHead(response.status ?? 200, {
      'content-type': body.stream ? 'text/event-stream' : 'application/json',
    })
    if (body.stream) {
      for (const chunk of response.body as unknown[])
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      res.end('data: [DONE]\n\n')
    } else res.end(JSON.stringify(response.body))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  const address = server.address() as { port: number }
  const provider = createOpenAICompatible({
    name: 'local-compat',
    baseURL: `http://127.0.0.1:${address.port}`,
  })
  const spans = await pipeline(batch)
  cleanup.push(async () => {
    await spans.provider.shutdown()
    spans.manager.disable()
  })
  return { ...spans, requests, model: provider.chatModel('local-fixture') }
}

function completion(message: unknown, finishReason = 'stop') {
  return {
    id: 'local-completion',
    object: 'chat.completion',
    created: 1,
    model: 'local-fixture',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  }
}

function toolCall(args = '{"city":"Austin"}') {
  return completion(
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'weather-call', type: 'function', function: { name: 'weather', arguments: args } },
      ],
    },
    'tool_calls',
  )
}

async function signedSpans(f: Awaited<ReturnType<typeof fixture>>) {
  await f.provider.forceFlush()
  expect(f.records.length).toBeGreaterThan(0)
  for (const record of f.records) expect(await verifyRecord(record)).toBe(true)
  const spans = f.exporter.getFinishedSpans()
  expect(spans.length).toBe(f.records.length)
  expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(1)
  expect(new Set(f.records.map((record) => record.context_id)).size).toBe(1)
  expect(f.sidecars.map((sidecar) => sidecar.spanId).sort()).toEqual(
    spans.map((span) => span.spanContext().spanId).sort(),
  )
  return spans
}

describe('real AI SDK instrumentation', () => {
  for (const batch of [false, true])
    it(`executes a tool and preserves tracing and informed_by (${batch ? 'batch' : 'simple'})`, async () => {
      const f = await fixture(
        (_body, index) => ({
          body:
            index === 0
              ? toolCall()
              : completion({ role: 'assistant', content: 'Clear in Austin.' }),
        }),
        batch,
      )
      const cities: string[] = []
      const result = await generateText({
        model: f.model,
        prompt: 'Check Austin weather.',
        telemetry: f.telemetry,
        stopWhen: stepCountIs(2),
        tools: {
          weather: tool({
            inputSchema: z.object({ city: z.string() }),
            execute: async ({ city }) => {
              cities.push(city)
              await Promise.resolve()
              return { city, forecast: 'clear' }
            },
          }),
        },
      })
      expect(result.text).toBe('Clear in Austin.')
      expect(cities).toEqual(['Austin'])
      expect(f.requests).toHaveLength(2)
      expect(f.requests[1]!.messages.some((message) => message.role === 'tool')).toBe(true)
      await signedSpans(f)
      const toolIndex = f.sidecars.findIndex((sidecar) => sidecar.spanKind === 'TOOL')
      expect(toolIndex).toBeGreaterThanOrEqual(0)
      const llmIndex = f.sidecars.findIndex(
        (sidecar) => sidecar.spanKind === 'LLM' && sidecar.llmOutputToolCallId === 'weather-call',
      )
      expect(llmIndex).toBeGreaterThanOrEqual(0)
      const llmHash = `sha256:${hexEncode(sha256(canonicalRecord(f.records[llmIndex]!)))}`
      expect(f.records[toolIndex]!.informed_by).toEqual([llmHash])
      expect(f.records[toolIndex]!.args_hash).toMatch(/^sha256:/)
      expect(f.records[toolIndex]!.result_hash).toMatch(/^sha256:/)
    })

  it('consumes real streamed provider output and flushes signed spans', async () => {
    const f = await fixture(() => ({
      body: [
        {
          id: 'local-stream',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Hello ' }, finish_reason: null },
          ],
        },
        {
          id: 'local-stream',
          choices: [{ index: 0, delta: { content: 'Austin' }, finish_reason: null }],
        },
        { id: 'local-stream', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ],
    }))
    const result = streamText({ model: f.model, prompt: 'Say hello.', telemetry: f.telemetry })
    let text = ''
    for await (const chunk of result.textStream) text += chunk
    expect(text).toBe('Hello Austin')
    expect(await result.text).toBe(text)
    expect(f.requests[0]!.stream).toBe(true)
    await signedSpans(f)
  })

  it('rejects invalid tool arguments before execution', async () => {
    const f = await fixture(() => ({ body: toolCall('{"city":42}') }))
    let calls = 0
    const result = await generateText({
      model: f.model,
      prompt: 'Check weather.',
      telemetry: f.telemetry,
      tools: {
        weather: tool({
          inputSchema: z.object({ city: z.string() }),
          execute: async () => {
            calls++
            return 'must not run'
          },
        }),
      },
    })
    expect(calls).toBe(0)
    expect(result.content.some((part) => part.type === 'tool-error')).toBe(true)
    expect(f.requests).toHaveLength(1)
    await signedSpans(f)
  })

  it('preserves provider errors and exports their error spans', async () => {
    const f = await fixture(() => ({
      status: 401,
      body: { error: { message: 'local provider denied', type: 'authentication_error' } },
    }))
    await expect(
      generateText({ model: f.model, prompt: 'Denied.', telemetry: f.telemetry, maxRetries: 0 }),
    ).rejects.toThrow('local provider denied')
    expect(f.requests).toHaveLength(1)
    const spans = await signedSpans(f)
    expect(spans.some((span) => span.status.code === 2)).toBe(true)
  })
})
