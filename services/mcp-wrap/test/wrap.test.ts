// Tests for buildPreCallTransform, the core gating logic that decides
// which tools get the pre-call signing branch.
//
// `wrap()` itself spawns a child process and connects to log.atrib.dev,
// which the test guard blocks anyway. Integration tests live in
// integration.test.ts using an inMemory upstream.

import { describe, it, expect } from 'vitest'
import { buildPreCallTransform } from '../src/wrap.js'
import type { WrapConfig } from '../src/config.js'

function makeConfig(tools?: WrapConfig['tools']): WrapConfig {
  return {
    name: 'test',
    agent: 'claude-code',
    upstream: { command: 'echo' },
    serverUrl: 'mcp://test.local',
    logEndpoint: 'http://localhost:3100/v1/entries',
    autoChain: true,
    ...(tools !== undefined ? { tools } : {}),
  }
}

const SAMPLE_RECEIPT =
  'OL9GMj6QjKD55xWpOB6AvYIf-2--Ivh3Al6XuorYh3k.haoZK4D1AXmy_r05GJP4CZGOv0zh0iK1l7ls1FA8oZI'

describe('buildPreCallTransform', () => {
  it('returns undefined when no tools have injectReceiptId set', () => {
    expect(buildPreCallTransform(makeConfig())).toBeUndefined()
    expect(buildPreCallTransform(makeConfig({}))).toBeUndefined()
    expect(
      buildPreCallTransform(makeConfig({ post_context: { transactionTool: true } })),
    ).toBeUndefined()
  })

  it('returns a hook when at least one tool has injectReceiptId true', () => {
    const hook = buildPreCallTransform(
      makeConfig({ post_context: { injectReceiptId: true } }),
    )
    expect(typeof hook).toBe('function')
  })

  it('hook injects receipt into args for opted-in tools', () => {
    const hook = buildPreCallTransform(
      makeConfig({ post_context: { injectReceiptId: true } }),
    )!
    const result = hook({
      toolName: 'post_context',
      args: { source: 'test', content: 'x' },
      receiptId: SAMPLE_RECEIPT,
      recordHash: 'sha256:0'.repeat(64),
      contextId: 'a'.repeat(32),
    })
    expect(result).toEqual({
      source: 'test',
      content: 'x',
      atrib_receipt_id: SAMPLE_RECEIPT,
    })
  })

  it('hook returns undefined for tools NOT in the inject set (passthrough)', () => {
    const hook = buildPreCallTransform(
      makeConfig({ post_context: { injectReceiptId: true } }),
    )!
    expect(
      hook({
        toolName: 'get_context',
        args: { limit: 10 },
        receiptId: SAMPLE_RECEIPT,
        recordHash: 'sha256:0'.repeat(64),
        contextId: 'a'.repeat(32),
      }),
    ).toBeUndefined()
  })

  it('multiple injection-enabled tools all get receipt injected', () => {
    const hook = buildPreCallTransform(
      makeConfig({
        post_context: { injectReceiptId: true },
        write_message: { injectReceiptId: true },
        get_context: { injectReceiptId: false }, // explicit false → not included
      }),
    )!
    const a = hook({
      toolName: 'post_context',
      args: {},
      receiptId: SAMPLE_RECEIPT,
      recordHash: 'sha256:0'.repeat(64),
      contextId: 'a'.repeat(32),
    })
    const b = hook({
      toolName: 'write_message',
      args: {},
      receiptId: SAMPLE_RECEIPT,
      recordHash: 'sha256:0'.repeat(64),
      contextId: 'a'.repeat(32),
    })
    const c = hook({
      toolName: 'get_context',
      args: {},
      receiptId: SAMPLE_RECEIPT,
      recordHash: 'sha256:0'.repeat(64),
      contextId: 'a'.repeat(32),
    })
    expect((a as Record<string, unknown>)['atrib_receipt_id']).toBe(SAMPLE_RECEIPT)
    expect((b as Record<string, unknown>)['atrib_receipt_id']).toBe(SAMPLE_RECEIPT)
    expect(c).toBeUndefined()
  })

  it('does not mutate the caller args object (returns a fresh object)', () => {
    const hook = buildPreCallTransform(
      makeConfig({ post_context: { injectReceiptId: true } }),
    )!
    const args = { source: 'test', content: 'x' }
    const result = hook({
      toolName: 'post_context',
      args,
      receiptId: SAMPLE_RECEIPT,
      recordHash: 'sha256:0'.repeat(64),
      contextId: 'a'.repeat(32),
    })
    expect(result).not.toBe(args)
    expect(args).toEqual({ source: 'test', content: 'x' })
  })
})
