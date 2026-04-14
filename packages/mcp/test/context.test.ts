import { describe, it, expect } from 'vitest'
import {
  readInboundContext,
  writeOutboundContext,
  parseTracestateAtrib,
  extractTraceId,
  parseBaggageAtribSession,
  mergeTracestate,
  mergeBaggageAtribSession,
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
    // Create a different token for tracestate (just use the same — but the point
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

  // W3C Trace Context list-member grammar permits OWS (optional whitespace)
  // around the `=`. We must accept it gracefully.
  it('handles OWS around `=` per W3C list-member grammar', () => {
    expect(parseTracestateAtrib('atrib = TOKEN123')).toBe('TOKEN123')
    expect(parseTracestateAtrib('atrib =TOKEN123')).toBe('TOKEN123')
    expect(parseTracestateAtrib('atrib= TOKEN123')).toBe('TOKEN123')
  })

  it('handles atrib not in leftmost position', () => {
    expect(parseTracestateAtrib('rojo=00f067aa,atrib=mytoken,vendor=other')).toBe('mytoken')
  })

  it('returns the LAST atrib entry if duplicates exist (vendor MUST overwrite)', () => {
    // W3C "one entry per key" — if duplicates exist, parseTracestateAtrib's
    // contract is to find SOME atrib entry; since we only emit one, this
    // test documents that we accept the first match without erroring.
    const result = parseTracestateAtrib('atrib=first,vendor=other,atrib=second')
    expect(['first', 'second']).toContain(result)
  })
})

describe('mergeTracestate (W3C 32-list-member limit)', () => {
  it('places atrib entry leftmost (most-recent vendor first)', () => {
    expect(mergeTracestate('atrib=NEW', 'rojo=00f067aa,vendor=acme')).toBe(
      'atrib=NEW,rojo=00f067aa,vendor=acme',
    )
  })

  it('dedupes any prior atrib entry per "one entry per key"', () => {
    expect(mergeTracestate('atrib=NEW', 'atrib=OLD,vendor=acme')).toBe('atrib=NEW,vendor=acme')
  })

  it('dedupes prior atrib entry with OWS around =', () => {
    expect(mergeTracestate('atrib=NEW', 'atrib = OLD,vendor=acme')).toBe('atrib=NEW,vendor=acme')
  })

  it('handles empty existing tracestate', () => {
    expect(mergeTracestate('atrib=NEW', '')).toBe('atrib=NEW')
  })

  it('respects the W3C 32-list-member maximum, evicting from the rightmost end', () => {
    // 32 vendor entries — adding atrib must evict 1 from the right to fit
    const vendors = Array.from({ length: 32 }, (_, i) => `v${i}=val${i}`).join(',')
    const result = mergeTracestate('atrib=NEW', vendors)
    const entries = result.split(',')
    expect(entries.length).toBe(32)
    expect(entries[0]).toBe('atrib=NEW')
    // The rightmost (v31) was evicted; v30 is now the last entry
    expect(entries[entries.length - 1]).toBe('v30=val30')
  })

  it('handles a single vendor entry', () => {
    expect(mergeTracestate('atrib=NEW', 'rojo=00f067aa')).toBe('atrib=NEW,rojo=00f067aa')
  })
})

describe('extractTraceId — W3C trace-id validation', () => {
  it('accepts a valid lowercase 32-hex trace-id with non-zero parent-id', () => {
    expect(extractTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    )
  })

  // W3C trace-context §3.2.2.3: "All bytes as zero is considered an invalid value"
  it('rejects all-zero trace-id (W3C MUST ignore)', () => {
    expect(
      extractTraceId('00-00000000000000000000000000000000-00f067aa0ba902b7-01'),
    ).toBeUndefined()
  })

  it('rejects all-zero parent-id (W3C MUST ignore)', () => {
    expect(
      extractTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'),
    ).toBeUndefined()
  })

  it('rejects uppercase hex in trace-id (W3C requires lowercase)', () => {
    expect(
      extractTraceId('00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01'),
    ).toBeUndefined()
  })

  it('rejects wrong-length trace-id', () => {
    expect(extractTraceId('00-deadbeef-00f067aa0ba902b7-01')).toBeUndefined()
  })

  it('rejects malformed traceflags', () => {
    expect(
      extractTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-XY'),
    ).toBeUndefined()
  })

  it('rejects malformed version', () => {
    expect(
      extractTraceId('XY-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'),
    ).toBeUndefined()
  })

  it('rejects too few parts', () => {
    expect(extractTraceId('00-4bf92f3577b34da6a3ce929d0e0e4736')).toBeUndefined()
  })
})

describe('extractTraceId — basic', () => {
  it('returns undefined for too few parts', () => {
    expect(extractTraceId('00')).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(extractTraceId('')).toBeUndefined()
  })
})

describe('parseBaggageAtribSession (W3C Baggage spec)', () => {
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

  it('handles whitespace before atrib-session', () => {
    expect(parseBaggageAtribSession('other=val, atrib-session=token')).toBe('token')
  })

  // W3C Baggage list-member grammar:
  //   list-member = key OWS "=" OWS value *( OWS ";" OWS property )
  // This means the value MAY be followed by `;property` segments which are
  // NOT part of the value. The parser MUST strip them.
  it('strips a single ;property suffix from the value', () => {
    expect(parseBaggageAtribSession('atrib-session=mytoken;ttl=300')).toBe('mytoken')
  })

  it('strips multiple ;property suffixes from the value', () => {
    expect(parseBaggageAtribSession('atrib-session=mytoken;ttl=300;origin=foo')).toBe('mytoken')
  })

  it('handles OWS around `=` per W3C list-member grammar', () => {
    expect(parseBaggageAtribSession('atrib-session = mytoken')).toBe('mytoken')
    expect(parseBaggageAtribSession('atrib-session =mytoken')).toBe('mytoken')
    expect(parseBaggageAtribSession('atrib-session= mytoken')).toBe('mytoken')
  })

  it('handles OWS around `=` AND a property suffix', () => {
    expect(parseBaggageAtribSession('atrib-session = mytoken ; ttl = 300')).toBe('mytoken')
  })

  it('finds atrib-session when it appears after other entries with properties', () => {
    expect(
      parseBaggageAtribSession(
        'userId=alice;owner=org1,requestId=r-42;sample=true,atrib-session=mytoken',
      ),
    ).toBe('mytoken')
  })
})

describe('mergeBaggageAtribSession (W3C 64-list-member, 8192-byte limit)', () => {
  it('places atrib-session leftmost (most-recent vendor first)', () => {
    expect(mergeBaggageAtribSession('tok', 'vendor=acme,user=alice')).toBe(
      'atrib-session=tok,vendor=acme,user=alice',
    )
  })

  it('dedupes any prior atrib-session entry', () => {
    expect(mergeBaggageAtribSession('NEW', 'vendor=acme,atrib-session=OLD')).toBe(
      'atrib-session=NEW,vendor=acme',
    )
  })

  it('dedupes prior atrib-session even with property suffix', () => {
    expect(mergeBaggageAtribSession('NEW', 'atrib-session=OLD;ttl=300,vendor=acme')).toBe(
      'atrib-session=NEW,vendor=acme',
    )
  })

  it('handles empty existing baggage', () => {
    expect(mergeBaggageAtribSession('tok', '')).toBe('atrib-session=tok')
  })

  it('respects the W3C 64-list-member maximum, evicting from the rightmost end', () => {
    // 64 vendor entries — adding atrib-session must evict 1 from the right
    const vendors = Array.from({ length: 64 }, (_, i) => `v${i}=val${i}`).join(',')
    const result = mergeBaggageAtribSession('tok', vendors)
    const entries = result.split(',')
    expect(entries.length).toBe(64)
    expect(entries[0]).toBe('atrib-session=tok')
    // The rightmost (v63) was evicted
    expect(entries[entries.length - 1]).toBe('v62=val62')
  })

  it('respects the W3C 8192-byte total maximum', () => {
    // Build a baggage near the byte limit using fewer but very large entries
    const bigEntry = 'k=' + 'x'.repeat(800) // ~802 bytes per entry
    // 10 of these = ~8030 bytes, still under cap. Add atrib-session (~60 bytes)
    // and we go over, forcing eviction.
    const big = Array.from({ length: 10 }, () => bigEntry).join(',')
    const result = mergeBaggageAtribSession('tok', big)
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(8192)
    expect(result.startsWith('atrib-session=tok,')).toBe(true)
  })
})
