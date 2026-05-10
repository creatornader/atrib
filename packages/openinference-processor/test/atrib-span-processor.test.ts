// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  base64urlEncode,
  getPublicKey,
  verifyRecord,
  EVENT_TYPE_TOOL_CALL_URI,
  type AtribRecord,
} from '@atrib/mcp'
import {
  AtribSpanProcessor,
  isOpenInferenceSpan,
  getOpenInferenceSpanKind,
  spanToUnsignedRecord,
} from '../src/index.js'

const TEST_KEY_BYTES = new Uint8Array(32).fill(7)

async function makeProcessor(submit: (signed: AtribRecord) => void) {
  const pubKey = await getPublicKey(TEST_KEY_BYTES)
  return new AtribSpanProcessor({
    privateKey: TEST_KEY_BYTES,
    creatorKey: base64urlEncode(pubKey),
    serverUrl: 'https://test.example/atrib-openinference',
    submit: (signed) => submit(signed),
    debug: true,
  })
}

describe('isOpenInferenceSpan / getOpenInferenceSpanKind', () => {
  it('recognizes spans with the canonical kind attribute', () => {
    const provider = new BasicTracerProvider()
    const exporter = new InMemorySpanExporter()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    const tracer = provider.getTracer('test')

    const toolSpan = tracer.startSpan('search_web')
    toolSpan.setAttribute('openinference.span.kind', 'TOOL')
    toolSpan.setAttribute('tool.name', 'search_web')
    toolSpan.end()

    const plainSpan = tracer.startSpan('not-openinference')
    plainSpan.end()

    const exported = exporter.getFinishedSpans()
    expect(exported).toHaveLength(2)
    expect(isOpenInferenceSpan(exported[0]!)).toBe(true)
    expect(getOpenInferenceSpanKind(exported[0]!)).toBe('TOOL')
    expect(isOpenInferenceSpan(exported[1]!)).toBe(false)
    expect(getOpenInferenceSpanKind(exported[1]!)).toBeUndefined()
  })

  it('rejects unknown kind values', () => {
    const provider = new BasicTracerProvider()
    const exporter = new InMemorySpanExporter()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    const tracer = provider.getTracer('test')

    const span = tracer.startSpan('unknown')
    span.setAttribute('openinference.span.kind', 'NOT_A_KIND')
    span.end()

    const [exported] = exporter.getFinishedSpans()
    expect(getOpenInferenceSpanKind(exported!)).toBeUndefined()
    expect(isOpenInferenceSpan(exported!)).toBe(false)
  })
})

describe('spanToUnsignedRecord', () => {
  it('maps a TOOL span to a tool_call record with derived fields', async () => {
    const provider = new BasicTracerProvider()
    const exporter = new InMemorySpanExporter()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    const tracer = provider.getTracer('test')

    const span = tracer.startSpan('grep_files')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.setAttribute('tool.name', 'grep_files')
    span.setAttribute('session.id', '4bf92f3577b34da6a3ce929d0e0e4736')
    span.setAttribute('input.value', '{"pattern":"foo"}')
    span.setAttribute('output.value', '{"matches":[]}')
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()

    const [exported] = exporter.getFinishedSpans()
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const result = spanToUnsignedRecord(exported!, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://example.test/atrib',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('TOOL')
    expect(result.record.event_type).toBe(EVENT_TYPE_TOOL_CALL_URI)
    expect(result.record.context_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(result.record.spec_version).toBe('atrib/1.0')
    expect(result.record.content_id).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.record.chain_root).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('skips spans without openinference kind', async () => {
    const provider = new BasicTracerProvider()
    const exporter = new InMemorySpanExporter()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    const tracer = provider.getTracer('test')

    const span = tracer.startSpan('plain')
    span.end()

    const [exported] = exporter.getFinishedSpans()
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const result = spanToUnsignedRecord(exported!, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://example.test/atrib',
    })

    expect(result.ok).toBe(false)
  })

  it('skips non-TOOL kinds at this version', async () => {
    const provider = new BasicTracerProvider()
    const exporter = new InMemorySpanExporter()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    const tracer = provider.getTracer('test')

    const span = tracer.startSpan('llm-call')
    span.setAttribute('openinference.span.kind', 'LLM')
    span.end()

    const [exported] = exporter.getFinishedSpans()
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const result = spanToUnsignedRecord(exported!, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://example.test/atrib',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('LLM')
    }
  })

  it('rejects TOOL spans missing tool.name', async () => {
    const provider = new BasicTracerProvider()
    const exporter = new InMemorySpanExporter()
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    const tracer = provider.getTracer('test')

    const span = tracer.startSpan('tool-no-name')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.end()

    const [exported] = exporter.getFinishedSpans()
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const result = spanToUnsignedRecord(exported!, {
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://example.test/atrib',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('tool.name')
  })
})

describe('AtribSpanProcessor end-to-end', () => {
  it('signs a TOOL span and emits a verifiable record', async () => {
    const submitted: AtribRecord[] = []
    const processor = await makeProcessor((signed) => {
      submitted.push(signed)
    })

    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(processor)
    const tracer = provider.getTracer('atrib-openinference-test')

    const span = tracer.startSpan('list_files')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.setAttribute('tool.name', 'list_files')
    span.setAttribute('session.id', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    span.setAttribute('agent.name', 'Researcher')
    span.setAttribute('input.value', '{"path":"/tmp"}')
    span.setAttribute('output.value', '["a","b"]')
    span.end()

    // Wait for the async submit chain to settle.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(submitted).toHaveLength(1)
    const record = submitted[0]!
    expect(record.event_type).toBe(EVENT_TYPE_TOOL_CALL_URI)
    expect(record.context_id).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(record.signature.length).toBeGreaterThan(80)
    expect(await verifyRecord(record)).toBe(true)
  })

  it('skips non-TOOL spans without throwing', async () => {
    const submitted: AtribRecord[] = []
    const processor = await makeProcessor((signed) => {
      submitted.push(signed)
    })

    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(processor)
    const tracer = provider.getTracer('test')

    const llmSpan = tracer.startSpan('llm-step')
    llmSpan.setAttribute('openinference.span.kind', 'LLM')
    llmSpan.end()

    const plainSpan = tracer.startSpan('non-openinference')
    plainSpan.end()

    await new Promise((resolve) => setImmediate(resolve))
    expect(submitted).toHaveLength(0)
  })

  it('catches submit errors and never throws to the OTel pipeline', async () => {
    let submitCalls = 0
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(await getPublicKey(TEST_KEY_BYTES)),
      serverUrl: 'https://example.test/atrib',
      submit: () => {
        submitCalls += 1
        throw new Error('downstream submission failed')
      },
      debug: false,
    })

    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(processor)
    const tracer = provider.getTracer('test')

    expect(() => {
      const span = tracer.startSpan('boom')
      span.setAttribute('openinference.span.kind', 'TOOL')
      span.setAttribute('tool.name', 'boom')
      span.end()
    }).not.toThrow()

    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(submitCalls).toBe(1)
  })

  it('honors a custom filter', async () => {
    const submitted: AtribRecord[] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://example.test/atrib',
      submit: (signed) => {
        submitted.push(signed)
      },
      filter: (span) =>
        span.attributes['openinference.span.kind'] === 'TOOL' &&
        span.attributes['agent.name'] === 'Approved',
    })

    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(processor)
    const tracer = provider.getTracer('test')

    const allowed = tracer.startSpan('allowed')
    allowed.setAttribute('openinference.span.kind', 'TOOL')
    allowed.setAttribute('tool.name', 'allowed')
    allowed.setAttribute('agent.name', 'Approved')
    allowed.end()

    const blocked = tracer.startSpan('blocked')
    blocked.setAttribute('openinference.span.kind', 'TOOL')
    blocked.setAttribute('tool.name', 'blocked')
    blocked.setAttribute('agent.name', 'NotApproved')
    blocked.end()

    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.context_id).toBeDefined()
  })

  it('respects shutdown', async () => {
    const submitFn = vi.fn()
    const processor = await makeProcessor(submitFn)

    await processor.shutdown()

    const provider = new BasicTracerProvider()
    provider.addSpanProcessor(processor)
    const tracer = provider.getTracer('test')

    const span = tracer.startSpan('post-shutdown')
    span.setAttribute('openinference.span.kind', 'TOOL')
    span.setAttribute('tool.name', 'post-shutdown')
    span.end()

    await new Promise((resolve) => setImmediate(resolve))
    expect(submitFn).not.toHaveBeenCalled()
  })
})
