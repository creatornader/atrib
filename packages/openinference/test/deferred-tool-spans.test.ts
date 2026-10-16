// SPDX-License-Identifier: Apache-2.0

import { context, trace } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it, vi } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { AtribSpanProcessor, AtribBatchSpanProcessor, type AtribSpanSidecar } from '../src/index.js'

async function setup(batch: boolean) {
  const records: AtribRecord[] = []
  const sidecars: AtribSpanSidecar[] = []
  const privateKey = new Uint8Array(32).fill(13)
  const options = {
    privateKey,
    creatorKey: base64urlEncode(await getPublicKey(privateKey)),
    serverUrl: 'https://example.test/deferred-tools',
    autoInformedBy: true,
    submit(record: AtribRecord, sidecar: AtribSpanSidecar) {
      records.push(record)
      sidecars.push(sidecar)
    },
  }
  const processor = batch
    ? new AtribBatchSpanProcessor({
        ...options,
        config: { maxExportBatchSize: 1 },
        submit(entries) {
          for (const entry of entries) options.submit(entry.signed, entry.sidecar)
        },
      })
    : new AtribSpanProcessor(options)
  const provider = new BasicTracerProvider({ spanProcessors: [processor] })
  const tracer = provider.getTracer('deferred-tool-test')
  const root = tracer.startSpan('root')
  const parent = trace.setSpan(context.active(), root)
  function tool(id: string) {
    const span = tracer.startSpan('tool', {}, parent)
    span.setAttributes({
      'openinference.span.kind': 'TOOL',
      'tool.name': 'weather',
      'tool_call.id': id,
      'ai.operationId': 'ai.toolCall',
    })
    span.end()
  }
  function model(id: string, sameTrace = true) {
    const span = tracer.startSpan('model', {}, sameTrace ? parent : context.active())
    span.setAttributes({
      'openinference.span.kind': 'LLM',
      'llm.model_name': 'local-fixture',
      'llm.output_messages.0.message.tool_calls.0.tool_call.id': id,
    })
    span.end()
  }
  return { records, sidecars, processor, provider, root, tool, model }
}

for (const batch of [false, true])
  describe(`${batch ? 'batch' : 'simple'} deferred AI SDK tools`, () => {
    it('signs the matching LLM before linking an already-ended tool', async () => {
      const f = await setup(batch)
      try {
        f.tool('call-1')
        f.model('call-1')
        await f.processor.forceFlush()
        const llmIndex = f.sidecars.findIndex((sidecar) => sidecar.spanKind === 'LLM')
        const toolIndex = f.sidecars.findIndex((sidecar) => sidecar.spanKind === 'TOOL')
        const hash = `sha256:${hexEncode(sha256(canonicalRecord(f.records[llmIndex]!)))}`
        expect(llmIndex).toBeLessThan(toolIndex)
        expect(f.records[toolIndex]!.informed_by).toEqual([hash])
        for (const record of f.records) expect(await verifyRecord(record)).toBe(true)
      } finally {
        f.root.end()
        await f.provider.shutdown()
      }
    })

    it('flushes unmatched tools without linking the same ID from another trace', async () => {
      const f = await setup(batch)
      try {
        f.tool('shared-id')
        f.model('shared-id', false)
        await f.processor.forceFlush()
        expect(f.records).toHaveLength(2)
        const index = f.sidecars.findIndex((sidecar) => sidecar.spanKind === 'TOOL')
        expect(f.records[index]!.informed_by).toBeUndefined()
        for (const record of f.records) expect(await verifyRecord(record)).toBe(true)
      } finally {
        f.root.end()
        await f.provider.shutdown()
      }
    })

    it('emits overflow and shutdown records without inventing links or dropping tools', async () => {
      const f = await setup(batch)
      try {
        for (let index = 0; index < 257; index++) f.tool(`unmatched-${index}`)
        await vi.waitFor(() => expect(f.records).toHaveLength(1))
        await f.processor.shutdown()
        expect(f.records).toHaveLength(257)
        expect(f.records.every((record) => record.informed_by === undefined)).toBe(true)
        for (const record of f.records) expect(await verifyRecord(record)).toBe(true)
      } finally {
        f.root.end()
        await f.provider.shutdown()
      }
    })
  })
