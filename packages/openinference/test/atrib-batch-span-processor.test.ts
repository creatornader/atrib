// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import {
  base64urlEncode,
  getPublicKey,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  AtribBatchSpanProcessor,
  type AtribBatchEntry,
} from '../src/index.js'

const TEST_KEY_BYTES = new Uint8Array(32).fill(7)

async function makeBatchProcessor(
  submit: (batch: readonly AtribBatchEntry[]) => void | Promise<void>,
  config?: ConstructorParameters<typeof AtribBatchSpanProcessor>[0]['config'],
) {
  const pubKey = await getPublicKey(TEST_KEY_BYTES)
  return new AtribBatchSpanProcessor({
    privateKey: TEST_KEY_BYTES,
    creatorKey: base64urlEncode(pubKey),
    serverUrl: 'https://test.example/atrib-batch',
    submit: (batch) => submit(batch),
    ...(config ? { config } : {}),
    debug: true,
  })
}

function emitToolSpan(provider: BasicTracerProvider, name: string): void {
  const tracer = provider.getTracer('batch-test')
  const span = tracer.startSpan(name)
  span.setAttribute('openinference.span.kind', 'TOOL')
  span.setAttribute('tool.name', name)
  span.end()
}

describe('AtribBatchSpanProcessor', () => {
  it('signs spans + queues + flushes via single submit call', async () => {
    const calls: AtribRecord[][] = []
    const processor = await makeBatchProcessor(
      (batch) => {
        calls.push(batch.map((b) => b.signed))
      },
      { maxExportBatchSize: 100, scheduledDelayMillis: 30 },
    )
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    emitToolSpan(provider, 'a')
    emitToolSpan(provider, 'b')
    emitToolSpan(provider, 'c')

    await processor.forceFlush()
    expect(calls.length).toBe(1)
    expect(calls[0]!.length).toBe(3)
    for (const r of calls[0]!) {
      expect(await verifyRecord(r)).toBe(true)
    }
  })

  it('flushes immediately when batch size threshold is reached', async () => {
    const calls: number[] = []
    const processor = await makeBatchProcessor(
      (batch) => {
        calls.push(batch.length)
      },
      { maxExportBatchSize: 2, scheduledDelayMillis: 60_000 },
    )
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    emitToolSpan(provider, 'a')
    emitToolSpan(provider, 'b') // triggers immediate flush at threshold
    emitToolSpan(provider, 'c')
    emitToolSpan(provider, 'd') // threshold again

    await processor.forceFlush()
    // First two flushes hit the threshold; remaining (if any) flushed by forceFlush.
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const total = calls.reduce((sum, n) => sum + n, 0)
    expect(total).toBe(4)
  })

  it('flushes on time-based interval when below threshold', async () => {
    const calls: number[] = []
    const processor = await makeBatchProcessor(
      (batch) => {
        calls.push(batch.length)
      },
      { maxExportBatchSize: 100, scheduledDelayMillis: 30 },
    )
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    emitToolSpan(provider, 'a')
    // Wait longer than the scheduled delay to let the timer fire.
    await new Promise((r) => setTimeout(r, 60))

    expect(calls.length).toBe(1)
    expect(calls[0]).toBe(1)
    await processor.shutdown()
  })

  it('shutdown drains pending records', async () => {
    const calls: AtribBatchEntry[][] = []
    const processor = await makeBatchProcessor(
      (batch) => {
        calls.push([...batch])
      },
      { maxExportBatchSize: 100, scheduledDelayMillis: 60_000 },
    )
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    emitToolSpan(provider, 'a')
    emitToolSpan(provider, 'b')

    // Without shutdown the timer wouldn't fire for 60s. Shutdown must drain.
    await processor.shutdown()
    const total = calls.reduce((sum, b) => sum + b.length, 0)
    expect(total).toBe(2)
  })

  it('catches submit errors without affecting the OTel pipeline', async () => {
    let attempts = 0
    const processor = await makeBatchProcessor(
      () => {
        attempts += 1
        throw new Error('downstream failure')
      },
      { maxExportBatchSize: 1, scheduledDelayMillis: 60_000 },
    )
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    expect(() => emitToolSpan(provider, 'boom')).not.toThrow()
    await processor.forceFlush()
    expect(attempts).toBeGreaterThanOrEqual(1)
  })

  it('drops oldest records when queue exceeds maxQueueSize', async () => {
    const calls: AtribBatchEntry[][] = []
    const processor = await makeBatchProcessor(
      (batch) => {
        calls.push([...batch])
      },
      { maxQueueSize: 3, maxExportBatchSize: 100, scheduledDelayMillis: 60_000 },
    )
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      emitToolSpan(provider, name)
    }
    // Allow the async signing pipeline to drain into the queue.
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    await processor.forceFlush()

    expect(processor.getDroppedRecordCount()).toBe(2)
    const total = calls.reduce((sum, b) => sum + b.length, 0)
    expect(total).toBe(3)
  })

  it('honors a custom filter', async () => {
    const calls: AtribBatchEntry[][] = []
    const pubKey = await getPublicKey(TEST_KEY_BYTES)
    const processor = new AtribBatchSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey: base64urlEncode(pubKey),
      serverUrl: 'https://test.example/atrib-batch',
      submit: (batch) => {
        calls.push([...batch])
      },
      filter: (span) =>
        span.attributes['openinference.span.kind'] === 'TOOL' &&
        span.attributes['tool.name'] === 'allowed',
      config: { maxExportBatchSize: 10, scheduledDelayMillis: 30 },
      debug: true,
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    emitToolSpan(provider, 'allowed')
    emitToolSpan(provider, 'not-allowed')
    await processor.forceFlush()

    const total = calls.reduce((sum, b) => sum + b.length, 0)
    expect(total).toBe(1)
  })

  it('post-shutdown spans do not enter the queue', async () => {
    const submitFn = vi.fn()
    const processor = await makeBatchProcessor(submitFn, {
      maxExportBatchSize: 100,
      scheduledDelayMillis: 30,
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })

    await processor.shutdown()
    emitToolSpan(provider, 'post-shutdown')
    await new Promise((r) => setImmediate(r))
    expect(submitFn).not.toHaveBeenCalled()
  })

  it('forceFlush is idempotent on an empty queue', async () => {
    const processor = await makeBatchProcessor(() => undefined, {
      maxExportBatchSize: 10,
      scheduledDelayMillis: 30,
    })
    await processor.forceFlush()
    await processor.forceFlush()
    await processor.shutdown()
  })
})
