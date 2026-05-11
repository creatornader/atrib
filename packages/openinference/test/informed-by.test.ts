// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { context, trace } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import {
  base64urlEncode,
  getPublicKey,
  canonicalRecord,
  sha256,
  hexEncode,
  type AtribRecord,
} from '@atrib/mcp'
import {
  AtribSpanProcessor,
  AtribBatchSpanProcessor,
  InformedByTracker,
  type AtribSpanSidecar,
} from '../src/index.js'

const TEST_KEY_BYTES = new Uint8Array(32).fill(7)

beforeEachInstallContextManager()

function beforeEachInstallContextManager() {
  // Ensure async-hooks context manager is registered so child spans
  // share the parent's traceId. Required for these tests.
  const ctxManager = new AsyncHooksContextManager()
  ctxManager.enable()
  context.setGlobalContextManager(ctxManager)
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

describe('InformedByTracker', () => {
  it('registers + looks up by (traceId, toolCallId)', () => {
    const t = new InformedByTracker()
    t.recordLlmToolCallEmission('trace1', 'call1', 'sha256:aaa')
    expect(t.lookup('trace1', 'call1')).toBe('sha256:aaa')
    expect(t.lookup('trace1', 'unknown')).toBeUndefined()
    expect(t.lookup('different-trace', 'call1')).toBeUndefined()
  })

  it('evicts oldest tool_call when per-trace cap is exceeded', () => {
    const t = new InformedByTracker({ maxToolCallsPerTrace: 2 })
    t.recordLlmToolCallEmission('trace1', 'a', 'sha256:1')
    t.recordLlmToolCallEmission('trace1', 'b', 'sha256:2')
    t.recordLlmToolCallEmission('trace1', 'c', 'sha256:3')
    expect(t.lookup('trace1', 'a')).toBeUndefined() // evicted
    expect(t.lookup('trace1', 'b')).toBe('sha256:2')
    expect(t.lookup('trace1', 'c')).toBe('sha256:3')
  })

  it('evicts oldest trace when global trace cap is exceeded', () => {
    const t = new InformedByTracker({ maxTracedTraceIds: 2 })
    t.recordLlmToolCallEmission('t1', 'a', 'sha256:1')
    t.recordLlmToolCallEmission('t2', 'a', 'sha256:2')
    t.recordLlmToolCallEmission('t3', 'a', 'sha256:3')
    expect(t.lookup('t1', 'a')).toBeUndefined() // evicted
    expect(t.lookup('t2', 'a')).toBe('sha256:2')
    expect(t.lookup('t3', 'a')).toBe('sha256:3')
  })

  it('reports cumulative size across all traces', () => {
    const t = new InformedByTracker()
    t.recordLlmToolCallEmission('t1', 'a', 'sha256:1')
    t.recordLlmToolCallEmission('t1', 'b', 'sha256:2')
    t.recordLlmToolCallEmission('t2', 'a', 'sha256:3')
    expect(t.size()).toBe(3)
    t.clear()
    expect(t.size()).toBe(0)
  })
})

describe('AtribSpanProcessor with autoInformedBy', () => {
  it('TOOL record carries informed_by edge to preceding LLM record', async () => {
    const submitted: { record: AtribRecord; sidecar: AtribSpanSidecar }[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed, sidecar) => {
        submitted.push({ record: signed, sidecar })
      },
      autoInformedBy: true,
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')

    // Wrap both spans in a parent span's context so they share traceId.
    // This mimics the real Vercel AI SDK flow where LLM + TOOL are
    // children of an AGENT root.
    const root = tracer.startSpan('agent-root')
    await context.with(trace.setSpan(context.active(), root), async () => {
      // Emit LLM span with output tool_call.id = 'callA'
      const llmSpan = tracer.startSpan('llm-step')
      llmSpan.setAttribute('openinference.span.kind', 'LLM')
      llmSpan.setAttribute('llm.model_name', 'qwen3.5')
      llmSpan.setAttribute(
        'llm.output_messages.0.message.tool_calls.0.tool_call.id',
        'callA',
      )
      llmSpan.end()

      // Wait for LLM signing to complete + register in tracker
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      // Emit TOOL span with tool_call.id = 'callA'
      const toolSpan = tracer.startSpan('tool-step')
      toolSpan.setAttribute('openinference.span.kind', 'TOOL')
      toolSpan.setAttribute('tool.name', 'get_weather')
      toolSpan.setAttribute('tool_call.id', 'callA')
      toolSpan.end()
    })
    root.end()

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // 3 records: LLM, TOOL, AGENT (root, even synthetic). Filter to
    // just the LLM and TOOL entries.
    const llmRec = submitted.find((s) => s.record.event_type.endsWith('observation') && s.sidecar.llmOutputToolCallId === 'callA')!.record
    const toolRec = submitted.find((s) => s.record.event_type.endsWith('tool_call'))!.record
    expect(llmRec).toBeDefined()
    expect(toolRec).toBeDefined()
    expect(toolRec.informed_by).toBeDefined()
    expect(toolRec.informed_by).toEqual([recordHash(llmRec)])
  })

  it('TOOL record without matching LLM tool_call has no informed_by edge', async () => {
    const submitted: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed) => {
        submitted.push(signed)
      },
      autoInformedBy: true,
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')

    const toolSpan = tracer.startSpan('tool-step')
    toolSpan.setAttribute('openinference.span.kind', 'TOOL')
    toolSpan.setAttribute('tool.name', 'get_weather')
    toolSpan.setAttribute('tool_call.id', 'orphan-tool-call')
    toolSpan.end()

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.informed_by).toBeUndefined()
  })

  it('autoInformedBy=false (default) means no informed_by even when tool_call.id matches', async () => {
    const submitted: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed) => {
        submitted.push(signed)
      },
      // autoInformedBy not set; defaults to off
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')

    const llmSpan = tracer.startSpan('llm')
    llmSpan.setAttribute('openinference.span.kind', 'LLM')
    llmSpan.setAttribute('llm.model_name', 'qwen3.5')
    llmSpan.setAttribute(
      'llm.output_messages.0.message.tool_calls.0.tool_call.id',
      'callA',
    )
    llmSpan.end()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    const toolSpan = tracer.startSpan('tool')
    toolSpan.setAttribute('openinference.span.kind', 'TOOL')
    toolSpan.setAttribute('tool.name', 'foo')
    toolSpan.setAttribute('tool_call.id', 'callA')
    toolSpan.end()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(submitted[1]!.informed_by).toBeUndefined()
  })

  it('shared tracker across simple + batch processors composes correctly', async () => {
    const llmRecords: AtribRecord[] = []
    const toolRecords: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const sharedTracker = new InformedByTracker()

    const llmProcessor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (signed) => {
        llmRecords.push(signed)
      },
      filter: (s) => s.attributes['openinference.span.kind'] === 'LLM',
      autoInformedBy: true,
      informedByTracker: sharedTracker,
    })

    const toolProcessor = new AtribBatchSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib',
      submit: (batch) => {
        for (const e of batch) toolRecords.push(e.signed)
      },
      filter: (s) => s.attributes['openinference.span.kind'] === 'TOOL',
      autoInformedBy: true,
      informedByTracker: sharedTracker,
      config: { maxExportBatchSize: 10, scheduledDelayMillis: 30 },
    })

    const provider = new BasicTracerProvider({
      spanProcessors: [llmProcessor, toolProcessor],
    })
    const tracer = provider.getTracer('test')

    const root = tracer.startSpan('agent-root')
    await context.with(trace.setSpan(context.active(), root), async () => {
      const llmSpan = tracer.startSpan('llm')
      llmSpan.setAttribute('openinference.span.kind', 'LLM')
      llmSpan.setAttribute('llm.model_name', 'qwen3.5')
      llmSpan.setAttribute(
        'llm.output_messages.0.message.tool_calls.0.tool_call.id',
        'cross-processor-call',
      )
      llmSpan.end()
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      const toolSpan = tracer.startSpan('tool')
      toolSpan.setAttribute('openinference.span.kind', 'TOOL')
      toolSpan.setAttribute('tool.name', 'foo')
      toolSpan.setAttribute('tool_call.id', 'cross-processor-call')
      toolSpan.end()
    })
    root.end()
    await toolProcessor.forceFlush()

    expect(llmRecords).toHaveLength(1)
    expect(toolRecords).toHaveLength(1)
    expect(toolRecords[0]!.informed_by).toEqual([recordHash(llmRecords[0]!)])
  })
})
