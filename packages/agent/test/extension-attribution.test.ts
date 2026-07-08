// SPDX-License-Identifier: Apache-2.0

/**
 * Client-side unit tests for the dev.atrib/attribution MCP extension helpers
 * (D141 / spec §1.5.4.1; extension spec docs/extensions/dev.atrib-attribution/v0.1.md).
 *
 * Covers: declare + parse round-trip against a REAL signed record, no caller
 * mutation, idempotency, and the §5.8 degradation contract (malformed or
 * inconsistent receipts are atrib:-logged and discarded; nothing ever throws
 * into the tool-call path).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  base64urlEncode,
  canonicalRecord,
  encodeToken,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  ATTRIBUTION_EXTENSION_ID,
  ATTRIBUTION_EXTENSION_VERSION,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  declareAttributionExtension,
  parseAttributionReceipt,
} from '../src/extension-attribution.js'
import type { AttributionResultBlock } from '../src/extension-attribution.js'

const TEST_KEY = new Uint8Array(32).fill(9)
const CONTEXT_ID = '4bf92f3577b34da6a3ce929d0e0e4736'

async function makeSignedRecord(): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(CONTEXT_ID),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: CONTEXT_ID,
    timestamp: 1743850000000,
    signature: '',
  } as AtribRecord
  return signRecord(record, TEST_KEY)
}

/** Simulate the server side: build a spec-§6.2 result block from a signed record. */
function serverReceiptBlock(record: AtribRecord, includeRecord: boolean): AttributionResultBlock {
  const block: AttributionResultBlock = {
    token: encodeToken(record),
    receipt: {
      record_hash: `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
      creator_key: record.creator_key,
      context_id: record.context_id,
      event_type: 'tool_call',
      chain_root: record.chain_root,
      log_submission: 'queued',
    },
  }
  if (includeRecord) block.record = record
  return block
}

function extractDeclaration(meta: Record<string, unknown>): Record<string, unknown> {
  const caps = meta[MCP_CLIENT_CAPABILITIES_META_KEY] as Record<string, unknown>
  const extensions = caps.extensions as Record<string, unknown>
  return extensions[ATTRIBUTION_EXTENSION_ID] as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── declareAttributionExtension ─────────────────────────────────────────

describe('declareAttributionExtension', () => {
  it('declares the extension per-request with the default accept ["token"]', () => {
    const meta = declareAttributionExtension()
    expect(extractDeclaration(meta)).toEqual({
      version: ATTRIBUTION_EXTENSION_VERSION,
      accept: ['token'],
    })
  })

  it('honors the accept option and drops unrecognized values', () => {
    const meta = declareAttributionExtension({}, { accept: ['token', 'record'] })
    expect(extractDeclaration(meta)).toEqual({ version: '0.1', accept: ['token', 'record'] })
  })

  it('carries the prefixed request block when token/contextId are supplied', async () => {
    const record = await makeSignedRecord()
    const token = encodeToken(record)
    const meta = declareAttributionExtension({}, { token, contextId: CONTEXT_ID })
    expect(meta[ATTRIBUTION_EXTENSION_ID]).toEqual({ token, context_id: CONTEXT_ID })
  })

  it('drops malformed token/contextId with a warning instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const meta = declareAttributionExtension(
      {},
      { token: 'not-a-token', contextId: 'NOT-32-HEX' },
    )
    expect(ATTRIBUTION_EXTENSION_ID in meta).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('never mutates the caller meta and preserves unrelated keys', () => {
    const existing = Object.freeze({
      traceparent: `00-${CONTEXT_ID}-00f067aa0ba902b7-01`,
      [MCP_CLIENT_CAPABILITIES_META_KEY]: Object.freeze({
        sampling: {},
        extensions: Object.freeze({
          'com.example/other': { version: '2.0' },
        }),
      }),
    }) as Record<string, unknown>
    const snapshot = JSON.stringify(existing)

    const meta = declareAttributionExtension(existing)
    expect(JSON.stringify(existing)).toBe(snapshot) // no caller mutation
    expect(meta).not.toBe(existing)
    expect(meta.traceparent).toBe(existing.traceparent)
    const caps = meta[MCP_CLIENT_CAPABILITIES_META_KEY] as Record<string, unknown>
    expect(caps.sampling).toEqual({})
    const extensions = caps.extensions as Record<string, unknown>
    expect(extensions['com.example/other']).toEqual({ version: '2.0' })
    expect(extensions[ATTRIBUTION_EXTENSION_ID]).toEqual({ version: '0.1', accept: ['token'] })
  })

  it('is idempotent: declaring twice equals declaring once', () => {
    const once = declareAttributionExtension({}, { accept: ['token', 'record'] })
    const twice = declareAttributionExtension(once, { accept: ['token', 'record'] })
    expect(twice).toEqual(once)
  })

  it('replaces a malformed existing clientCapabilities value without throwing (§5.8)', () => {
    const meta = declareAttributionExtension({
      [MCP_CLIENT_CAPABILITIES_META_KEY]: 'garbage',
    })
    expect(extractDeclaration(meta)).toEqual({ version: '0.1', accept: ['token'] })
  })
})

// ─── parseAttributionReceipt ─────────────────────────────────────────────

describe('parseAttributionReceipt', () => {
  it('round-trip: parses a consistent receipt built from a real signed record', async () => {
    const record = await makeSignedRecord()
    const resultMeta = {
      atrib: encodeToken(record),
      [ATTRIBUTION_EXTENSION_ID]: serverReceiptBlock(record, true),
    }
    const parsed = parseAttributionReceipt(resultMeta)
    expect(parsed).toBeDefined()
    expect(parsed!.token).toBe(encodeToken(record))
    expect(parsed!.receipt.record_hash).toBe(
      `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
    )
    expect(parsed!.receipt.log_submission).toBe('queued')
    expect(parsed!.record).toEqual(record)
  })

  it('parses a token-only receipt (no record body)', async () => {
    const record = await makeSignedRecord()
    const parsed = parseAttributionReceipt({
      [ATTRIBUTION_EXTENSION_ID]: serverReceiptBlock(record, false),
    })
    expect(parsed).toBeDefined()
    expect(parsed!.record).toBeUndefined()
  })

  it('returns undefined silently when the block is absent (legacy path)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseAttributionReceipt(undefined)).toBeUndefined()
    expect(parseAttributionReceipt({})).toBeUndefined()
    expect(parseAttributionReceipt({ atrib: 'some.token' })).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('discards a structurally malformed block with an atrib: warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseAttributionReceipt({ [ATTRIBUTION_EXTENSION_ID]: 'garbage' })).toBeUndefined()
    expect(parseAttributionReceipt({ [ATTRIBUTION_EXTENSION_ID]: { token: 42 } })).toBeUndefined()
    expect(
      parseAttributionReceipt({
        [ATTRIBUTION_EXTENSION_ID]: { token: 'a.b', receipt: { record_hash: 'x' } },
      }),
    ).toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^atrib:/)
  })

  it('discards an internally inconsistent receipt (hash mismatch) and never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = await makeSignedRecord()
    const block = serverReceiptBlock(record, true)
    block.receipt.record_hash = `sha256:${'41'.repeat(32)}`
    expect(parseAttributionReceipt({ [ATTRIBUTION_EXTENSION_ID]: block })).toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('discards a receipt whose log_submission is outside the closed enum', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = await makeSignedRecord()
    const block = serverReceiptBlock(record, false)
    ;(block.receipt as { log_submission: string }).log_submission = 'awaited'
    expect(parseAttributionReceipt({ [ATTRIBUTION_EXTENSION_ID]: block })).toBeUndefined()
  })

  it('never throws on pathological result meta (§5.8)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing = new Proxy(
      {},
      {
        get(): never {
          throw new Error('forced read failure')
        },
        has(): never {
          throw new Error('forced read failure')
        },
      },
    )
    expect(() => parseAttributionReceipt(throwing)).not.toThrow()
    expect(parseAttributionReceipt(throwing)).toBeUndefined()
  })
})
