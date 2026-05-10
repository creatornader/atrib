// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { base64urlEncode, getPublicKey, type AtribRecord } from '@atrib/mcp'
import { AtribSpanProcessor } from '../src/index.js'

const TEST_KEY_BYTES = new Uint8Array(32).fill(7)

async function makeProcessor(submit: (signed: AtribRecord) => void) {
  const pubKey = await getPublicKey(TEST_KEY_BYTES)
  return new AtribSpanProcessor({
    privateKey: TEST_KEY_BYTES,
    creatorKey: base64urlEncode(pubKey),
    serverUrl: 'https://test.example/atrib',
    submit: (signed) => submit(signed),
  })
}

const KINDS_BY_MODEL_NAME: Array<{ kind: string; modelAttr: string; prefix: string }> = [
  { kind: 'EMBEDDING', modelAttr: 'embedding.model_name', prefix: 'embedding' },
  { kind: 'RETRIEVER', modelAttr: 'retrieval.model_name', prefix: 'retriever' },
  { kind: 'RERANKER', modelAttr: 'reranker.model_name', prefix: 'reranker' },
]

const KINDS_BY_SPAN_NAME: Array<{ kind: string; prefix: string }> = [
  { kind: 'CHAIN', prefix: 'chain' },
  { kind: 'GUARDRAIL', prefix: 'guardrail' },
  { kind: 'EVALUATOR', prefix: 'evaluator' },
  { kind: 'PROMPT', prefix: 'prompt' },
]

describe('AtribSpanProcessor, all 10 OpenInference kinds', () => {
  for (const { kind, modelAttr, prefix } of KINDS_BY_MODEL_NAME) {
    it(`${kind} spans map to observation event_type with ${prefix}: prefix`, async () => {
      const submitted: AtribRecord[] = []
      const processor = await makeProcessor((s) => submitted.push(s))
      const provider = new BasicTracerProvider({ spanProcessors: [processor] })
      const tracer = provider.getTracer('test')
      const span = tracer.startSpan(`${kind.toLowerCase()}-span`)
      span.setAttribute('openinference.span.kind', kind)
      span.setAttribute(modelAttr, 'test-model-v1')
      span.end()
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      expect(submitted).toHaveLength(1)
      expect(submitted[0]!.event_type).toBe('https://atrib.dev/v1/types/observation')
    })

    it(`${kind} span without model attribute falls back to span.name`, async () => {
      const submitted: AtribRecord[] = []
      const processor = await makeProcessor((s) => submitted.push(s))
      const provider = new BasicTracerProvider({ spanProcessors: [processor] })
      const tracer = provider.getTracer('test')
      const span = tracer.startSpan('fallback-name')
      span.setAttribute('openinference.span.kind', kind)
      span.end()
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      expect(submitted).toHaveLength(1)
      expect(submitted[0]!.event_type).toBe('https://atrib.dev/v1/types/observation')
    })
  }

  for (const { kind, prefix } of KINDS_BY_SPAN_NAME) {
    it(`${kind} spans map to observation event_type with ${prefix}: prefix`, async () => {
      const submitted: AtribRecord[] = []
      const processor = await makeProcessor((s) => submitted.push(s))
      const provider = new BasicTracerProvider({ spanProcessors: [processor] })
      const tracer = provider.getTracer('test')
      const span = tracer.startSpan(`${kind.toLowerCase()}-span`)
      span.setAttribute('openinference.span.kind', kind)
      span.end()
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      expect(submitted).toHaveLength(1)
      expect(submitted[0]!.event_type).toBe('https://atrib.dev/v1/types/observation')
    })
  }

  it('all 10 OpenInference kinds (TOOL/LLM/AGENT/EMBEDDING/RETRIEVER/RERANKER/CHAIN/GUARDRAIL/EVALUATOR/PROMPT) sign in one pipeline', async () => {
    const submitted: AtribRecord[] = []
    const processor = await makeProcessor((s) => submitted.push(s))
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('test')
    const all: Array<[string, Record<string, string>]> = [
      ['TOOL', { 'tool.name': 'foo' }],
      ['LLM', { 'llm.model_name': 'qwen' }],
      ['AGENT', {}],
      ['EMBEDDING', { 'embedding.model_name': 'embed-v1' }],
      ['RETRIEVER', { 'retrieval.model_name': 'retriever-v1' }],
      ['RERANKER', { 'reranker.model_name': 'rerank-v1' }],
      ['CHAIN', {}],
      ['GUARDRAIL', {}],
      ['EVALUATOR', {}],
      ['PROMPT', {}],
    ]
    for (const [kind, attrs] of all) {
      const span = tracer.startSpan(`${kind.toLowerCase()}-span`)
      span.setAttribute('openinference.span.kind', kind)
      for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v)
      span.end()
    }
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(submitted).toHaveLength(10)
    const types = [...new Set(submitted.map((r) => r.event_type.split('/').pop()))]
    expect(types.sort()).toEqual(['observation', 'tool_call'])
  })
})
