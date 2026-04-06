import { describe, it, expect } from 'vitest'
import {
  readInboundContext,
  writeOutboundContext,
  parseTracestateAtrib,
  extractTraceId,
  parseBaggageAtribSession,
} from '../src/context.js'
import { encodeToken } from '../src/token.js'
import { signRecord, getPublicKey } from '../src/signing.js'
import { base64urlEncode } from '../src/base64url.js'
import { genesisChainRoot } from '../src/chain-root.js'
import type { AtribRecord } from '../src/types.js'

const TEST_KEY = new Uint8Array(32).fill(1)

async function makeSignedRecordAndToken(): Promise<{ record: AtribRecord; token: string }> {
  const pubKey = await getPublicKey(TEST_KEY)
  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: 'sha256:3f8a2b0000000000000000000000000000000000000000000000000000000000',
    creator_key: base64urlEncode(pubKey),
    chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
    event_type: 'tool_call',
    context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
    timestamp: 1743850000000,
    signature: '',
  } as AtribRecord
  const signed = await signRecord(record, TEST_KEY)
  return { record: signed, token: encodeToken(signed) }
}

describe('readInboundContext', () => {
  it('reads from _meta.atrib (priority 1)', async () => {
    const { token } = await makeSignedRecordAndToken()
    const result = readInboundContext({
      _meta: {
        atrib: token,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    })
    expect(result).not.toBeNull()
    expect(result!.recordHash.length).toBe(32)
    expect(result!.creatorKey.length).toBe(32)
    expect(result!.contextId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('falls back to tracestate atrib= entry (priority 2)', async () => {
    const { token } = await makeSignedRecordAndToken()
    const result = readInboundContext({
      _meta: {
        tracestate: `vendor=abc,atrib=${token},other=xyz`,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    })
    expect(result).not.toBeNull()
    expect(result!.recordHash.length).toBe(32)
  })

  it('falls back to X-Atrib-Chain (priority 3)', async () => {
    const { token } = await makeSignedRecordAndToken()
    const result = readInboundContext({
      _meta: {
        'X-Atrib-Chain': token,
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    })
    expect(result).not.toBeNull()
    expect(result!.recordHash.length).toBe(32)
  })

  it('prefers _meta.atrib over tracestate', async () => {
    const { token } = await makeSignedRecordAndToken()
    // Create a different token for tracestate (just use the same, but the point
    // is that atrib field is checked first)
    const result = readInboundContext({
      _meta: {
        atrib: token,
        tracestate: 'atrib=garbage_token_that_would_fail',
      },
    })
    expect(result).not.toBeNull()
  })

  it('returns null when no context present', () => {
    const result = readInboundContext({ _meta: {} })
    expect(result).toBeNull()
  })

  it('returns null when _meta is missing', () => {
    const result = readInboundContext({})
    expect(result).toBeNull()
  })

  it('extracts session_token from baggage', async () => {
    const { token } = await makeSignedRecordAndToken()
    const result = readInboundContext({
      _meta: {
        atrib: token,
        baggage: 'atrib-session=test_session_123,other=val',
      },
    })
    expect(result).not.toBeNull()
    expect(result!.sessionToken).toBe('test_session_123')
  })

  it('returns undefined sessionToken when baggage has no atrib-session', async () => {
    const { token } = await makeSignedRecordAndToken()
    const result = readInboundContext({
      _meta: {
        atrib: token,
        baggage: 'other=val',
      },
    })
    expect(result!.sessionToken).toBeUndefined()
  })

  it('handles malformed atrib token gracefully', () => {
    const result = readInboundContext({
      _meta: { atrib: 'not_a_valid_token' },
    })
    expect(result).toBeNull()
  })
})

describe('writeOutboundContext', () => {
  it('writes _meta.atrib token', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    writeOutboundContext(result, record)
    const meta = result._meta as Record<string, unknown>
    expect(typeof meta.atrib).toBe('string')
    expect((meta.atrib as string).length).toBeLessThanOrEqual(87)
  })

  it('writes tracestate with atrib= prefix', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    writeOutboundContext(result, record)
    const meta = result._meta as Record<string, unknown>
    expect(meta.tracestate).toMatch(/^atrib=/)
  })

  it('prepends to existing tracestate', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {
      _meta: { tracestate: 'vendor=existing' },
    }
    writeOutboundContext(result, record)
    const meta = result._meta as Record<string, unknown>
    expect(meta.tracestate).toMatch(/^atrib=.*,vendor=existing$/)
  })

  it('writes X-Atrib-Chain fallback', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    writeOutboundContext(result, record)
    const meta = result._meta as Record<string, unknown>
    expect(meta['X-Atrib-Chain']).toBe(meta.atrib)
  })

  it('forwards traceparent when provided', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    writeOutboundContext(result, record, { traceparent: tp })
    const meta = result._meta as Record<string, unknown>
    expect(meta.traceparent).toBe(tp)
  })

  it('does not write traceparent when not provided', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    writeOutboundContext(result, record)
    const meta = result._meta as Record<string, unknown>
    expect(meta.traceparent).toBeUndefined()
  })

  it('writes session_token to baggage (§1.5.5 MUST)', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    writeOutboundContext(result, record, { sessionToken: 'my_session' })
    const meta = result._meta as Record<string, unknown>
    expect(meta.baggage).toBe('atrib-session=my_session')
  })

  it('prepends session_token to existing baggage', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {
      _meta: { baggage: 'other=val' },
    }
    writeOutboundContext(result, record, { sessionToken: 'my_session' })
    const meta = result._meta as Record<string, unknown>
    expect(meta.baggage).toBe('atrib-session=my_session,other=val')
  })

  it('creates _meta when result has none', async () => {
    const { record } = await makeSignedRecordAndToken()
    const result: Record<string, unknown> = {}
    writeOutboundContext(result, record)
    expect(result._meta).toBeDefined()
  })
})

describe('parseTracestateAtrib', () => {
  it('extracts atrib entry from multi-entry tracestate', () => {
    expect(parseTracestateAtrib('vendor=abc, atrib=TOKEN123, other=xyz')).toBe('TOKEN123')
  })

  it('returns null when no atrib entry', () => {
    expect(parseTracestateAtrib('vendor=abc,other=xyz')).toBeNull()
  })

  it('handles atrib as only entry', () => {
    expect(parseTracestateAtrib('atrib=TOKEN')).toBe('TOKEN')
  })

  it('handles empty string', () => {
    expect(parseTracestateAtrib('')).toBeNull()
  })
})

describe('extractTraceId', () => {
  it('extracts trace-id from valid traceparent', () => {
    expect(extractTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'))
      .toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('returns undefined for too few parts', () => {
    expect(extractTraceId('00')).toBeUndefined()
  })

  it('returns undefined for uppercase trace-id', () => {
    expect(extractTraceId('00-4BF92F3577B34DA6A3CE929D0E0E4736-abc-01')).toBeUndefined()
  })

  it('returns undefined for wrong-length trace-id', () => {
    expect(extractTraceId('00-4bf92f35-abc-01')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(extractTraceId('')).toBeUndefined()
  })
})

describe('parseBaggageAtribSession', () => {
  it('extracts session token from baggage', () => {
    expect(parseBaggageAtribSession('atrib-session=abc123,other=val')).toBe('abc123')
  })

  it('returns undefined when key not present', () => {
    expect(parseBaggageAtribSession('other=val')).toBeUndefined()
  })

  it('handles single entry', () => {
    expect(parseBaggageAtribSession('atrib-session=token')).toBe('token')
  })

  it('handles empty string', () => {
    expect(parseBaggageAtribSession('')).toBeUndefined()
  })

  it('handles whitespace around entries (trims entry prefix only)', () => {
    // The split/trim trims leading whitespace on the entry, but the value after = is preserved
    // "atrib-session=token " → trimmed to "atrib-session=token " → value is "token "
    // Actually our implementation trims the whole entry, so " atrib-session=token " becomes
    // "atrib-session=token " after trim, and slice(14) gives "token "
    // But W3C Baggage values shouldn't have trailing whitespace in practice.
    // Our implementation correctly handles the comma-separation.
    expect(parseBaggageAtribSession('other=val, atrib-session=token')).toBe('token')
  })
})
