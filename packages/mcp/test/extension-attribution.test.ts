// SPDX-License-Identifier: Apache-2.0

/**
 * Producer-side unit tests for the dev.atrib/attribution MCP extension
 * (D141 / spec §1.5.4.1; extension spec docs/extensions/dev.atrib-attribution/v0.1.md).
 *
 * Complements the verify-side conformance suite
 * (packages/verify/test/conformance-mcp-extension.test.ts, which loads the
 * committed corpus) with the producer-library behaviors the corpus does not
 * pin directly: the legacy `initialize`-time declaration path (the tranche-1
 * punch-list gap), `_meta`-loss degradation, gated receipt application, and
 * receipt integrity against a REAL locally-signed record.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import canonicalize from 'canonicalize'
import {
  ATTRIBUTION_EXTENSION_ID,
  ATTRIBUTION_EXTENSION_VERSION,
  ATTRIBUTION_LOG_SUBMISSION_STATUSES,
  MCP_CLIENT_CAPABILITIES_META_KEY,
  applyAttributionReceipt,
  buildAttributionMetaBlock,
  buildAttributionReceipt,
  declaresExtension,
  detectClientDeclaration,
  extendResultWithAttribution,
  resolveContextIdentity,
  resolveInboundToken,
  validateAttributionSettings,
  validateExtensionIdentifier,
  verifyAttributionReceipt,
} from '../src/extension-attribution.js'
import { signRecord, getPublicKey, verifyRecord } from '../src/signing.js'
import { encodeToken } from '../src/token.js'
import { canonicalRecord } from '../src/canon.js'
import { sha256, hexEncode } from '../src/hash.js'
import { base64urlEncode } from '../src/base64url.js'
import { genesisChainRoot } from '../src/chain-root.js'
import type { AtribRecord } from '../src/types.js'

const TEST_KEY = new Uint8Array(32).fill(7)
const CONTEXT_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const OTHER_CONTEXT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

async function makeSignedRecord(contextId = CONTEXT_ID): Promise<AtribRecord> {
  const pubKey = await getPublicKey(TEST_KEY)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot(contextId),
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: contextId,
    timestamp: 1743850000000,
    signature: '',
  } as AtribRecord
  return signRecord(record, TEST_KEY)
}

function declaredMeta(accept?: string[]): Record<string, unknown> {
  return {
    [MCP_CLIENT_CAPABILITIES_META_KEY]: {
      extensions: {
        [ATTRIBUTION_EXTENSION_ID]: {
          version: ATTRIBUTION_EXTENSION_VERSION,
          ...(accept ? { accept } : {}),
        },
      },
    },
  }
}

function jcs(value: unknown): string {
  const out = canonicalize(value)
  if (out === undefined) throw new Error('canonicalization produced undefined')
  return out
}

function throwingProxy(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(): never {
        throw new Error('forced capability-read failure')
      },
      has(): never {
        throw new Error('forced capability-read failure')
      },
    },
  ) as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Identifier grammar + settings validation ────────────────────────────

describe('extension identifier + settings validation', () => {
  it('accepts the published identifier and rejects reserved/malformed ones', () => {
    expect(validateExtensionIdentifier(ATTRIBUTION_EXTENSION_ID)).toBe(true)
    expect(validateExtensionIdentifier('mcp.dev/attribution')).toBe(false)
    expect(validateExtensionIdentifier('io.modelcontextprotocol/attribution')).toBe(false)
    expect(validateExtensionIdentifier('atrib/attribution')).toBe(false) // no dot in prefix
    expect(validateExtensionIdentifier('dev.atrib')).toBe(false) // no name part
    expect(validateExtensionIdentifier('dev.atrib/attribution/extra')).toBe(false)
    expect(validateExtensionIdentifier('dev.atrib/attribution')).toBe(false) // uppercase label
  })

  it('requires version; treats missing/empty/non-string version as undeclared, never an error', () => {
    expect(validateAttributionSettings({ version: '0.1' }).declared).toBe(true)
    expect(validateAttributionSettings({}).declared).toBe(false)
    expect(validateAttributionSettings({ version: '' }).declared).toBe(false)
    expect(validateAttributionSettings({ version: 42 }).declared).toBe(false)
    expect(validateAttributionSettings(null).declared).toBe(false)
    expect(validateAttributionSettings('0.1').declared).toBe(false)
    expect(validateAttributionSettings(['0.1']).declared).toBe(false)
  })

  it('ignores unknown settings fields and unknown accept values (forward compatibility)', () => {
    const v = validateAttributionSettings({
      version: '0.9-future',
      accept: ['token', 'hologram', 'record'],
      zeta_field: true,
      alpha_field: 1,
    })
    expect(v.declared).toBe(true)
    expect(v.negotiatedVersion).toBe('0.9-future') // identifier, not version, is the compatibility unit
    expect(v.effectiveAccept).toEqual(['token', 'record'])
    expect(v.ignoredAcceptValues).toEqual(['hologram'])
    expect(v.ignoredSettingsFields).toEqual(['alpha_field', 'zeta_field'])
  })

  it('an accept array with no recognized value is equivalent to ["token"]', () => {
    const v = validateAttributionSettings({ version: '0.1', accept: ['hologram', 42] })
    expect(v.effectiveAccept).toEqual(['token'])
    expect(v.ignoredAcceptValues).toEqual(['hologram'])
  })
})

// ─── Negotiation gating (per-request + legacy initialize) ────────────────

describe('negotiation gating', () => {
  it('detects a valid per-request declaration', () => {
    const v = detectClientDeclaration(declaredMeta(['token', 'record']))
    expect(v.declared).toBe(true)
    expect(v.effectiveAccept).toEqual(['token', 'record'])
  })

  it('treats missing/malformed clientCapabilities as undeclared', () => {
    expect(detectClientDeclaration(undefined).declared).toBe(false)
    expect(detectClientDeclaration({}).declared).toBe(false)
    expect(detectClientDeclaration({ [MCP_CLIENT_CAPABILITIES_META_KEY]: 'oops' }).declared).toBe(
      false,
    )
    expect(
      detectClientDeclaration({
        [MCP_CLIENT_CAPABILITIES_META_KEY]: { extensions: 'not-an-object' },
      }).declared,
    ).toBe(false)
    expect(
      detectClientDeclaration({
        [MCP_CLIENT_CAPABILITIES_META_KEY]: {
          extensions: { [ATTRIBUTION_EXTENSION_ID]: { accept: ['token'] } }, // no version
        },
      }).declared,
    ).toBe(false)
  })

  it('legacy initialize path: declaration in the session initialize capabilities gates receipts', () => {
    // Punch-list gap: on protocol versions ≤ 2025-11-25 the client declares
    // in initialize and the declaration applies to every request.
    const initializeCapabilities = {
      extensions: {
        [ATTRIBUTION_EXTENSION_ID]: { version: '0.1', accept: ['token', 'record'] },
      },
    }
    const v = declaresExtension({}, { initializeCapabilities })
    expect(v.declared).toBe(true)
    expect(v.effectiveAccept).toEqual(['token', 'record'])

    // No per-request meta at all: still declared via initialize.
    expect(declaresExtension(undefined, { initializeCapabilities }).declared).toBe(true)
  })

  it('a valid per-request declaration takes precedence over the legacy initialize declaration', () => {
    const initializeCapabilities = {
      extensions: { [ATTRIBUTION_EXTENSION_ID]: { version: '0.1', accept: ['token', 'record'] } },
    }
    const v = declaresExtension(declaredMeta(['token']), { initializeCapabilities })
    expect(v.declared).toBe(true)
    expect(v.effectiveAccept).toEqual(['token'])
  })

  it('malformed initialize capabilities are undeclared, never an error', () => {
    expect(declaresExtension({}, { initializeCapabilities: 'garbage' }).declared).toBe(false)
    expect(declaresExtension({}, { initializeCapabilities: { extensions: [] } }).declared).toBe(
      false,
    )
    expect(
      declaresExtension(
        {},
        { initializeCapabilities: { extensions: { [ATTRIBUTION_EXTENSION_ID]: {} } } },
      ).declared,
    ).toBe(false)
  })

  it('a throwing capability read degrades to undeclared without throwing (§5.8)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => declaresExtension(throwingProxy())).not.toThrow()
    expect(declaresExtension(throwingProxy()).declared).toBe(false)
  })
})

// ─── Ladder 1: inbound propagation token ─────────────────────────────────

describe('Ladder 1: inbound propagation token', () => {
  it('extension key wins over all legacy carriers, with a conflict warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = await makeSignedRecord(CONTEXT_ID)
    const b = await makeSignedRecord(OTHER_CONTEXT_ID)
    const tokenA = encodeToken(a)
    const tokenB = encodeToken(b)
    const resolution = resolveInboundToken({
      [ATTRIBUTION_EXTENSION_ID]: { token: tokenA },
      atrib: tokenB,
      tracestate: `atrib=${tokenB}`,
      'X-Atrib-Chain': tokenB,
    })
    expect(resolution.source).toBe('extension')
    expect(resolution.recordHashHex).toBe(hexEncode(sha256(canonicalRecord(a))))
    expect(resolution.conflictWarning).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('a malformed extension token falls through to _meta.atrib (lenient parse)', async () => {
    const b = await makeSignedRecord()
    const tokenB = encodeToken(b)
    const resolution = resolveInboundToken({
      [ATTRIBUTION_EXTENSION_ID]: { token: 'not.a-valid-token' },
      atrib: tokenB,
    })
    expect(resolution.source).toBe('meta-atrib')
    expect(resolution.recordHashHex).toBe(hexEncode(sha256(canonicalRecord(b))))
    expect(resolution.conflictWarning).toBe(false)
  })

  it('legacy order beneath the extension rung: atrib > tracestate > X-Atrib-Chain', async () => {
    const a = await makeSignedRecord(CONTEXT_ID)
    const b = await makeSignedRecord(OTHER_CONTEXT_ID)
    const tokenA = encodeToken(a)
    const tokenB = encodeToken(b)
    expect(resolveInboundToken({ atrib: tokenA, tracestate: `atrib=${tokenB}` }).source).toBe(
      'meta-atrib',
    )
    expect(
      resolveInboundToken({ tracestate: `atrib=${tokenA}`, 'X-Atrib-Chain': tokenB }).source,
    ).toBe('tracestate')
    expect(resolveInboundToken({ 'X-Atrib-Chain': tokenA }).source).toBe('x-atrib-chain')
    expect(resolveInboundToken({ 'x-atrib-chain': tokenA }).source).toBe('x-atrib-chain')
  })

  it('all carriers absent or stripped resolves to nothing, never an error (_meta loss)', () => {
    expect(resolveInboundToken(undefined)).toEqual({ source: null, conflictWarning: false })
    expect(resolveInboundToken({})).toEqual({ source: null, conflictWarning: false })
    expect(resolveInboundToken(null)).toEqual({ source: null, conflictWarning: false })
    expect(resolveInboundToken('garbage')).toEqual({ source: null, conflictWarning: false })
  })
})

// ─── Ladder 2: context identity ──────────────────────────────────────────

describe('Ladder 2: context identity', () => {
  it('an explicit tool argument beats the extension block and traceparent, with warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = resolveContextIdentity(CONTEXT_ID, {
      [ATTRIBUTION_EXTENSION_ID]: { context_id: OTHER_CONTEXT_ID },
      traceparent: `00-${OTHER_CONTEXT_ID}-00f067aa0ba902b7-01`,
    })
    expect(r).toEqual({ contextId: CONTEXT_ID, source: 'argument', mismatchWarning: true })
    expect(warn).toHaveBeenCalled()
  })

  it('extension context_id beats the traceparent trace-id, with warning', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = resolveContextIdentity(undefined, {
      [ATTRIBUTION_EXTENSION_ID]: { context_id: CONTEXT_ID },
      traceparent: `00-${OTHER_CONTEXT_ID}-00f067aa0ba902b7-01`,
    })
    expect(r).toEqual({ contextId: CONTEXT_ID, source: 'extension', mismatchWarning: true })
  })

  it('a non-32-lowercase-hex extension value is ignored and falls through', () => {
    const r = resolveContextIdentity(undefined, {
      [ATTRIBUTION_EXTENSION_ID]: { context_id: 'NOT-HEX' },
      traceparent: `00-${CONTEXT_ID}-00f067aa0ba902b7-01`,
    })
    expect(r).toEqual({ contextId: CONTEXT_ID, source: 'traceparent', mismatchWarning: false })
  })

  it('no per-request carrier resolves to the env-registry fallthrough (undefined at transport)', () => {
    expect(resolveContextIdentity(undefined, {})).toEqual({
      source: 'env-registry-fallthrough',
      mismatchWarning: false,
    })
    expect(resolveContextIdentity(undefined, undefined)).toEqual({
      source: 'env-registry-fallthrough',
      mismatchWarning: false,
    })
  })

  it('unknown block fields (session_token, provenance_token) never affect resolution', () => {
    const r = resolveContextIdentity(undefined, {
      [ATTRIBUTION_EXTENSION_ID]: {
        context_id: CONTEXT_ID,
        session_token: 'should-be-ignored',
        provenance_token: 'should-be-ignored',
        future_field: { nested: true },
      },
    })
    expect(r.contextId).toBe(CONTEXT_ID)
    expect(r.source).toBe('extension')
  })
})

// ─── Request-block builder ───────────────────────────────────────────────

describe('buildAttributionMetaBlock', () => {
  it('builds the prefixed block from a signed record + explicit context_id', async () => {
    const record = await makeSignedRecord()
    const fragment = buildAttributionMetaBlock({ record, contextId: CONTEXT_ID })
    expect(fragment).toEqual({
      [ATTRIBUTION_EXTENSION_ID]: { token: encodeToken(record), context_id: CONTEXT_ID },
    })
    // The built block resolves through both ladders.
    expect(resolveInboundToken(fragment).source).toBe('extension')
    expect(resolveContextIdentity(undefined, fragment).contextId).toBe(CONTEXT_ID)
  })

  it('drops malformed fields with a warning instead of throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fragment = buildAttributionMetaBlock({ token: 'garbage', contextId: CONTEXT_ID })
    expect(fragment).toEqual({ [ATTRIBUTION_EXTENSION_ID]: { context_id: CONTEXT_ID } })
    expect(warn).toHaveBeenCalled()

    const fragment2 = buildAttributionMetaBlock({ contextId: 'NOT-HEX' })
    expect(fragment2).toBeUndefined()
  })
})

// ─── Receipts against a real signed record ───────────────────────────────

describe('receipt integrity against a real signed record', () => {
  it('buildAttributionReceipt recomputes from the record and verifies (Tier-3)', async () => {
    const record = await makeSignedRecord()
    const block = buildAttributionReceipt(record, { includeRecord: true })
    expect(block.token).toBe(encodeToken(record))
    expect(block.receipt.record_hash).toBe(`sha256:${hexEncode(sha256(canonicalRecord(record)))}`)
    expect(block.receipt.creator_key).toBe(record.creator_key)
    expect(block.receipt.context_id).toBe(record.context_id)
    expect(block.receipt.event_type).toBe('tool_call') // short name for the URI
    expect(block.receipt.chain_root).toBe(record.chain_root)
    expect(block.receipt.log_submission).toBe('queued')
    expect(block.record).toBe(record)

    expect(verifyAttributionReceipt(block)).toEqual({ valid: true, mismatched: [] })
    // Tier-3: the attached record's signature verifies independently.
    expect(await verifyRecord(block.record as AtribRecord)).toBe(true)
  })

  it('omits the record body unless includeRecord is set; supports D100 disabled status', async () => {
    const record = await makeSignedRecord()
    const tokenOnly = buildAttributionReceipt(record)
    expect('record' in tokenOnly).toBe(false)
    const disabled = buildAttributionReceipt(record, { logSubmission: 'disabled' })
    expect(disabled.receipt.log_submission).toBe('disabled')
    expect(verifyAttributionReceipt(disabled).valid).toBe(true)
  })

  it('is synchronous: log_submission is a queue status, never an awaited proof (§5.3.5)', async () => {
    const record = await makeSignedRecord()
    // Not a promise; no submission machinery is consulted.
    const block: unknown = buildAttributionReceipt(record)
    expect(block).not.toBeInstanceOf(Promise)
    expect(ATTRIBUTION_LOG_SUBMISSION_STATUSES).toEqual([
      'queued',
      'submitted',
      'disabled',
      'failed',
    ])
  })

  it('flags tampered receipts and discards them without touching the tool result', async () => {
    const record = await makeSignedRecord()
    const good = buildAttributionReceipt(record, { includeRecord: true })

    const badHash = structuredClone(good)
    badHash.receipt.record_hash = `sha256:${'41'.repeat(32)}`
    expect(verifyAttributionReceipt(badHash)).toEqual({
      valid: false,
      mismatched: ['record_hash'],
    })

    const badKey = structuredClone(good)
    badKey.receipt.creator_key = base64urlEncode(new Uint8Array(32))
    const keyVerdict = verifyAttributionReceipt(badKey)
    expect(keyVerdict.valid).toBe(false)
    expect(keyVerdict.mismatched).toContain('creator_key')

    const badStatus = structuredClone(good)
    ;(badStatus.receipt as { log_submission: string }).log_submission = 'awaited'
    expect(verifyAttributionReceipt(badStatus).mismatched).toContain('log_submission')

    const badToken = structuredClone(good)
    badToken.token = 'garbage'
    expect(verifyAttributionReceipt(badToken)).toEqual({ valid: false, mismatched: ['token'] })

    expect(verifyAttributionReceipt(null)).toEqual({ valid: false, mismatched: ['malformed'] })
    expect(verifyAttributionReceipt({ token: 42 })).toEqual({
      valid: false,
      mismatched: ['malformed'],
    })
  })
})

// ─── Gated receipt application ───────────────────────────────────────────

describe('applyAttributionReceipt gating', () => {
  it('writes the block when the client declared on THAT request; honors accept', async () => {
    const record = await makeSignedRecord()
    const result: Record<string, unknown> = { content: [{ type: 'text', text: 'ok' }] }
    const written = applyAttributionReceipt(result, declaredMeta(['token', 'record']), record)
    expect(written).toBe(true)
    const meta = result._meta as Record<string, unknown>
    const block = meta[ATTRIBUTION_EXTENSION_ID] as { record?: unknown }
    expect(block.record).toBe(record)

    const tokenOnly: Record<string, unknown> = { content: [] }
    applyAttributionReceipt(tokenOnly, declaredMeta(['token']), record)
    const tokenBlock = (tokenOnly._meta as Record<string, unknown>)[
      ATTRIBUTION_EXTENSION_ID
    ] as Record<string, unknown>
    expect('record' in tokenBlock).toBe(false)
  })

  it('leaves the result untouched when undeclared', async () => {
    const record = await makeSignedRecord()
    const result: Record<string, unknown> = { content: [{ type: 'text', text: 'ok' }] }
    const before = jcs(result)
    expect(applyAttributionReceipt(result, {}, record)).toBe(false)
    expect(applyAttributionReceipt(result, undefined, record)).toBe(false)
    expect(jcs(result)).toBe(before)
  })

  it('honors the legacy initialize-time declaration', async () => {
    const record = await makeSignedRecord()
    const result: Record<string, unknown> = { content: [] }
    const written = applyAttributionReceipt(result, {}, record, {
      initializeCapabilities: {
        extensions: { [ATTRIBUTION_EXTENSION_ID]: { version: '0.1', accept: ['token'] } },
      },
      logSubmission: 'disabled',
    })
    expect(written).toBe(true)
    const block = (result._meta as Record<string, unknown>)[ATTRIBUTION_EXTENSION_ID] as {
      receipt: { log_submission: string }
    }
    expect(block.receipt.log_submission).toBe('disabled')
  })

  it('never throws and never mutates on a throwing capability read (§5.8)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const record = await makeSignedRecord()
    const result: Record<string, unknown> = { content: [] }
    const before = jcs(result)
    expect(() => applyAttributionReceipt(result, throwingProxy(), record)).not.toThrow()
    expect(jcs(result)).toBe(before)
  })
})

// ─── Full result-path composition + degradation ──────────────────────────

describe('extendResultWithAttribution degradation (§5.8)', () => {
  it('declared: legacy keys + gated block; undeclared: legacy keys only', async () => {
    const record = await makeSignedRecord()
    const declared: Record<string, unknown> = { content: [] }
    extendResultWithAttribution(declared, declaredMeta(['token', 'record']), () => record)
    const declaredMetaOut = declared._meta as Record<string, unknown>
    expect(declaredMetaOut.atrib).toBe(encodeToken(record))
    expect(declaredMetaOut['X-Atrib-Chain']).toBe(encodeToken(record))
    expect(ATTRIBUTION_EXTENSION_ID in declaredMetaOut).toBe(true)

    const undeclared: Record<string, unknown> = { content: [] }
    extendResultWithAttribution(undeclared, {}, () => record)
    const undeclaredMetaOut = undeclared._meta as Record<string, unknown>
    expect(undeclaredMetaOut.atrib).toBe(encodeToken(record))
    expect(ATTRIBUTION_EXTENSION_ID in undeclaredMetaOut).toBe(false)
  })

  it('total _meta loss never blocks: legacy keys written, no extension block, no error', async () => {
    const record = await makeSignedRecord()
    const result: Record<string, unknown> = { content: [] }
    expect(() => extendResultWithAttribution(result, undefined, () => record)).not.toThrow()
    const meta = result._meta as Record<string, unknown>
    expect(meta.atrib).toBe(encodeToken(record))
    expect(ATTRIBUTION_EXTENSION_ID in meta).toBe(false)
  })

  it('signing failure leaves the result byte-identical to passthrough', () => {
    const result: Record<string, unknown> = { content: [{ type: 'text', text: 'primary' }] }
    const before = jcs(result)
    expect(() =>
      extendResultWithAttribution(result, declaredMeta(['token', 'record']), () => {
        throw new Error('forced signing failure')
      }),
    ).not.toThrow()
    expect(result._meta).toBeUndefined()
    expect(jcs(result)).toBe(before)
  })

  it('capability-read failure leaves the result byte-identical to passthrough', async () => {
    const record = await makeSignedRecord()
    const result: Record<string, unknown> = { content: [{ type: 'text', text: 'primary' }] }
    const before = jcs(result)
    expect(() => extendResultWithAttribution(result, throwingProxy(), () => record)).not.toThrow()
    expect(result._meta).toBeUndefined()
    expect(jcs(result)).toBe(before)
  })
})
