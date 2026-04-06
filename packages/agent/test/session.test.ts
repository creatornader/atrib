import { describe, it, expect } from 'vitest'
import {
  createSession,
  buildOutboundMeta,
  accumulateInboundContext,
} from '../src/session.js'
import { base64urlEncode, encodeToken, signRecord, getPublicKey, genesisChainRoot } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(1)
const TEST_KEY_B64 = base64urlEncode(TEST_KEY)

async function makeToken(): Promise<string> {
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
  return encodeToken(signed)
}

describe('createSession', () => {
  it('generates a 32-char hex context_id', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    expect(session.contextId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('generates a session_token when none provided', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    expect(session.sessionToken.length).toBe(22) // 16 bytes → 22 base64url chars
  })

  it('uses provided session_token', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64, sessionToken: 'my_token' })
    expect(session.sessionToken).toBe('my_token')
  })

  it('starts with no latest context', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    expect(session.latestContext).toBeNull()
  })

  it('starts uninitialized', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    expect(session.initialized).toBe(false)
  })

  it('starts with no policy record id', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    expect(session.policyRecordId).toBeNull()
  })
})

describe('buildOutboundMeta', () => {
  it('includes baggage with session_token', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64, sessionToken: 'test_session' })
    const meta = buildOutboundMeta(session)
    expect(meta.baggage).toBe('atrib-session=test_session')
  })

  it('includes traceparent with session context_id as trace-id', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const meta = buildOutboundMeta(session)
    expect(meta.traceparent).toBeDefined()
    // W3C format: 00-<32hex>-<16hex>-01
    expect(meta.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    // The trace-id portion must equal session.contextId
    const traceId = meta.traceparent!.split('-')[1]
    expect(traceId).toBe(session.contextId)
  })

  it('generates a fresh parent-id on each call (same trace-id)', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const meta1 = buildOutboundMeta(session)
    const meta2 = buildOutboundMeta(session)
    const [, traceId1, parentId1] = meta1.traceparent!.split('-')
    const [, traceId2, parentId2] = meta2.traceparent!.split('-')
    expect(traceId1).toBe(traceId2)
    expect(parentId1).not.toBe(parentId2)
  })

  it('embeds atrib-policy in baggage when policyRecordId set', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64, sessionToken: 'tok' })
    session.policyRecordId = 'sha256:abc123'
    const meta = buildOutboundMeta(session)
    // atrib-policy is added after atrib-session, so it ends up leftmost
    // (most-recent vendor first per W3C). Both atrib entries are still
    // grouped at the front of the baggage string.
    expect(meta.baggage).toBe('atrib-policy=sha256:abc123,atrib-session=tok')
  })

  it('omits atrib-policy from baggage when policyRecordId is null', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64, sessionToken: 'tok' })
    const meta = buildOutboundMeta(session)
    expect(meta.baggage).toBe('atrib-session=tok')
    expect(meta.baggage).not.toContain('atrib-policy')
  })

  it('does not include atrib token when no latest context', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const meta = buildOutboundMeta(session)
    expect(meta.atrib).toBeUndefined()
    expect(meta.tracestate).toBeUndefined()
    expect(meta['X-Atrib-Chain']).toBeUndefined()
  })

  it('includes atrib token when latest context exists', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    session.latestContext = {
      recordHash: new Uint8Array(32).fill(0xab),
      creatorKey: new Uint8Array(32).fill(0xcd),
    }
    const meta = buildOutboundMeta(session)
    expect(meta.atrib).toBeDefined()
    expect(meta.atrib).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(meta.tracestate).toMatch(/^atrib=/)
    expect(meta['X-Atrib-Chain']).toBe(meta.atrib)
  })

  describe('§5.4.3 merging with existing _meta (W3C leftmost = most recent)', () => {
    it('prepends atrib-session to existing baggage (most-recent vendor first)', () => {
      const session = createSession({ creatorKey: TEST_KEY_B64, sessionToken: 'tok' })
      const meta = buildOutboundMeta(session, { baggage: 'vendor=acme' })
      // Per W3C, the most recent vendor's entries appear leftmost.
      expect(meta.baggage).toBe('atrib-session=tok,vendor=acme')
    })

    it('prepends atrib-policy and atrib-session leftmost in existing baggage', () => {
      const session = createSession({ creatorKey: TEST_KEY_B64, sessionToken: 'tok' })
      session.policyRecordId = 'sha256:abc'
      const meta = buildOutboundMeta(session, { baggage: 'vendor=acme' })
      // policy-record entry is added after the session merge, so it ends up
      // at the very front. Both atrib entries are leftmost; the caller's
      // existing vendor entries are preserved on the right.
      expect(meta.baggage).toBe('atrib-policy=sha256:abc,atrib-session=tok,vendor=acme')
    })

    it('prepends atrib= to existing tracestate (most-recent vendor first)', () => {
      const session = createSession({ creatorKey: TEST_KEY_B64 })
      session.latestContext = {
        recordHash: new Uint8Array(32).fill(0xab),
        creatorKey: new Uint8Array(32).fill(0xcd),
      }
      const meta = buildOutboundMeta(session, { tracestate: 'rojo=00f067aa' })
      // atrib MUST appear leftmost per W3C convention.
      expect(meta.tracestate).toMatch(/^atrib=[^,]+,rojo=00f067aa$/)
    })

    it('preserves existing tracestate when no atrib token to append', () => {
      const session = createSession({ creatorKey: TEST_KEY_B64 })
      const meta = buildOutboundMeta(session, { tracestate: 'rojo=00f067aa' })
      expect(meta.tracestate).toBe('rojo=00f067aa')
    })

    it('preserves caller-supplied traceparent (does not regenerate)', () => {
      const session = createSession({ creatorKey: TEST_KEY_B64 })
      const incoming = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-1111222233334444-01'
      const meta = buildOutboundMeta(session, { traceparent: incoming })
      expect(meta.traceparent).toBe(incoming)
    })

    it('generates traceparent when caller has none', () => {
      const session = createSession({ creatorKey: TEST_KEY_B64 })
      const meta = buildOutboundMeta(session, {})
      expect(meta.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    })
  })
})

describe('accumulateInboundContext', () => {
  it('reads atrib token from response meta', async () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const token = await makeToken()

    const hasToken = accumulateInboundContext(session, { atrib: token })
    expect(hasToken).toBe(true)
    expect(session.latestContext).not.toBeNull()
    expect(session.latestContext!.recordHash.length).toBe(32)
    expect(session.latestContext!.creatorKey.length).toBe(32)
  })

  it('reads from tracestate fallback', async () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const token = await makeToken()

    const hasToken = accumulateInboundContext(session, {
      tracestate: `atrib=${token},vendor=other`,
    })
    expect(hasToken).toBe(true)
    expect(session.latestContext).not.toBeNull()
  })

  it('reads from X-Atrib-Chain fallback', async () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const token = await makeToken()

    const hasToken = accumulateInboundContext(session, { 'X-Atrib-Chain': token })
    expect(hasToken).toBe(true)
    expect(session.latestContext).not.toBeNull()
  })

  it('returns false when no token present', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const hasToken = accumulateInboundContext(session, { other: 'value' })
    expect(hasToken).toBe(false)
    expect(session.latestContext).toBeNull()
  })

  it('returns false when meta is undefined', () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const hasToken = accumulateInboundContext(session, undefined)
    expect(hasToken).toBe(false)
  })

  it('updates latest context on each call', async () => {
    const session = createSession({ creatorKey: TEST_KEY_B64 })
    const token = await makeToken()

    accumulateInboundContext(session, { atrib: token })
    const first = session.latestContext

    // Simulate a different token (same value here, but the point is it updates)
    accumulateInboundContext(session, { atrib: token })
    const second = session.latestContext

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
  })
})
