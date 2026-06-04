// Tests for buildPreCallTransform, the core gating logic that decides
// which tools get the pre-call signing branch.
//
// `wrap()` itself spawns a child process and connects to log.atrib.dev,
// which the test guard blocks anyway. Integration tests live in
// integration.test.ts using an inMemory upstream.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { canonicalRecord, hexEncode, sha256, type AtribRecord } from '@atrib/mcp'
import {
  buildInformedBy,
  buildPreCallTransform,
  buildRecordReferenceResolver,
} from '../src/wrap.js'
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

const VALID_RECORD: AtribRecord = {
  spec_version: 'atrib/1.0',
  content_id: `sha256:${'d'.repeat(64)}`,
  creator_key: 'haoZK4D1AXmy_r05GJP4CZGOv0zh0iK1l7ls1FA8oZI',
  chain_root: `sha256:${'0'.repeat(64)}`,
  event_type: 'https://atrib.dev/v1/types/tool_call',
  context_id: 'a'.repeat(32),
  timestamp: 1000,
  signature: 'A'.repeat(86),
}

describe('buildPreCallTransform', () => {
  it('returns undefined when no tools have injectReceiptId set', () => {
    expect(buildPreCallTransform(makeConfig())).toBeUndefined()
    expect(buildPreCallTransform(makeConfig({}))).toBeUndefined()
    expect(
      buildPreCallTransform(makeConfig({ post_context: { transactionTool: true } })),
    ).toBeUndefined()
  })

  it('returns a hook when at least one tool has injectReceiptId true', () => {
    const hook = buildPreCallTransform(makeConfig({ post_context: { injectReceiptId: true } }))
    expect(typeof hook).toBe('function')
  })

  it('hook injects receipt into args for opted-in tools', () => {
    const hook = buildPreCallTransform(makeConfig({ post_context: { injectReceiptId: true } }))!
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
    const hook = buildPreCallTransform(makeConfig({ post_context: { injectReceiptId: true } }))!
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
    const hook = buildPreCallTransform(makeConfig({ post_context: { injectReceiptId: true } }))!
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

describe('buildInformedBy', () => {
  const RECORD_A = 'sha256:' + 'a'.repeat(64)
  const RECORD_B = 'sha256:' + 'b'.repeat(64)
  const CONTENT_HASH = 'sha256:' + 'c'.repeat(64)

  it('returns undefined when no tools declare informedByPaths', () => {
    expect(buildInformedBy(makeConfig())).toBeUndefined()
    expect(buildInformedBy(makeConfig({ post_context: { injectReceiptId: true } }))).toBeUndefined()
  })

  it('extracts exact record refs from configured tool argument paths', () => {
    const hook = buildInformedBy(
      makeConfig({
        post_context: {
          injectReceiptId: true,
          informedByPaths: ['informed_by', 'metadata.message_envelope.informed_by'],
        },
      }),
    )!

    const result = hook({
      name: 'post_context',
      arguments: {
        informed_by: [RECORD_A],
        content: `body hash ${CONTENT_HASH}`,
        metadata: {
          message_envelope: {
            informed_by: RECORD_B,
          },
        },
      },
    })

    expect(result).toEqual([RECORD_A, RECORD_B])
  })

  it('ignores prose hashes and non-configured tools', () => {
    const hook = buildInformedBy(
      makeConfig({
        post_context: {
          informedByPaths: ['informed_by'],
        },
      }),
    )!

    expect(
      hook({
        name: 'post_context',
        arguments: {
          content: `body hash ${CONTENT_HASH}`,
        },
      }),
    ).toBeUndefined()

    expect(
      hook({
        name: 'get_context',
        arguments: {
          informed_by: [RECORD_A],
        },
      }),
    ).toBeUndefined()
  })
})

describe('buildRecordReferenceResolver', () => {
  it('accepts refs present in the configured wrapper mirror', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atrib-wrap-ref-'))
    const recordFile = join(dir, 'records.jsonl')
    const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(VALID_RECORD)))}`
    writeFileSync(recordFile, `${JSON.stringify({ record: VALID_RECORD })}\n`)

    try {
      const resolver = buildRecordReferenceResolver(makeConfig(), recordFile)
      await expect(
        resolver({
          recordHash,
          source: 'informedBy-callback',
          toolName: 'post_context',
          contextId: VALID_RECORD.context_id,
          params: { name: 'post_context' },
        }),
      ).resolves.toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects refs missing from mirror and log lookup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atrib-wrap-ref-miss-'))
    const recordFile = join(dir, 'records.jsonl')
    const log = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response)

    try {
      const resolver = buildRecordReferenceResolver(makeConfig(), recordFile, log)
      await expect(
        resolver({
          recordHash: `sha256:${'f'.repeat(64)}`,
          source: 'informedBy-callback',
          toolName: 'post_context',
          contextId: VALID_RECORD.context_id,
          params: { name: 'post_context' },
        }),
      ).resolves.toBe(false)
      expect(log).toHaveBeenCalledWith(
        'warn',
        'dropped unresolved informed_by candidate',
        expect.objectContaining({
          source: 'informedBy-callback',
          tool_name: 'post_context',
          resolution: 'not-found',
        }),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  })
})
