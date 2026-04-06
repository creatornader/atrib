import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { atrib } from '../src/middleware.js'
import {
  base64urlEncode,
  encodeToken,
  signRecord,
  getPublicKey,
  genesisChainRoot,
  type AtribRecord,
} from '@atrib/mcp'

const TEST_KEY = new Uint8Array(32).fill(42)
const TEST_KEY_B64 = base64urlEncode(TEST_KEY)
const OTHER_KEY = new Uint8Array(32).fill(1)

async function makeIncomingToken(): Promise<string> {
  const pubKey = await getPublicKey(OTHER_KEY)
  const record = await signRecord(
    {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      creator_key: base64urlEncode(pubKey),
      chain_root: genesisChainRoot('4bf92f3577b34da6a3ce929d0e0e4736'),
      event_type: 'tool_call',
      context_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      timestamp: 1743850000000,
      signature: '',
    } as AtribRecord,
    OTHER_KEY,
  )
  return encodeToken(record)
}

describe('atrib() agent middleware', () => {
  // Mock fetch globally to prevent any policy fetch attempts
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ logIndex: 1 }), { status: 200 }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('pass-through mode', () => {
    it('returns pass-through when no creatorKey', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const interceptor = atrib()
      expect(interceptor.getSessionPolicyRecord()).toBeNull()
      const meta = await interceptor.onBeforeToolCall('test', { existing: 'value' })
      expect(meta).toEqual({ existing: 'value' })
      warnSpy.mockRestore()
    })

    it('returns pass-through when creatorKey wrong length', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const interceptor = atrib({ creatorKey: base64urlEncode(new Uint8Array(16)) })
      expect(interceptor.getSessionPolicyRecord()).toBeNull()
      const meta = await interceptor.onBeforeToolCall('test', {})
      expect(meta).toEqual({})
      warnSpy.mockRestore()
    })
  })

  describe('context forwarding', () => {
    it('attaches baggage with session_token on first call', async () => {
      const interceptor = atrib({
        creatorKey: TEST_KEY_B64,
        sessionToken: 'test_session_abc',
      })

      const meta = await interceptor.onBeforeToolCall('search_web', {})
      expect(meta.baggage).toContain('atrib-session=test_session_abc')
    })

    it('attaches traceparent with session context_id on every call', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const meta = await interceptor.onBeforeToolCall('search_web', {})
      expect(meta.traceparent).toBeDefined()
      expect(meta.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    })

    it('does not attach atrib token on first call (no context yet)', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const meta = await interceptor.onBeforeToolCall('search_web', {})
      expect(meta.atrib).toBeUndefined()
    })

    it('attaches atrib token after receiving one in a response', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const token = await makeIncomingToken()

      interceptor.onAfterToolResponse('search_web', { content: [] }, { atrib: token })

      const meta = await interceptor.onBeforeToolCall('next_tool', {})
      expect(meta.atrib).toBeDefined()
      expect(meta.tracestate).toMatch(/^atrib=/)
      expect(meta['X-Atrib-Chain']).toBe(meta.atrib)
    })

    it('embeds atrib-policy record_id in baggage after init', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      // First call triggers session init which generates a policy record
      const meta = await interceptor.onBeforeToolCall('search_web', {})
      const baggage = meta.baggage as string
      expect(baggage).toContain('atrib-session=')
      // Policy record_id was set during init
      expect(baggage).toContain('atrib-policy=')
    })
  })

  describe('isError handling (§5.7)', () => {
    it('skips attribution when isError is true', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const token = await makeIncomingToken()

      // Pass an error response — should NOT accumulate context
      interceptor.onAfterToolResponse(
        'failing_tool',
        { isError: true },
        { atrib: token },
        { isError: true },
      )

      // Next call should still have no atrib token (the inbound was ignored)
      const meta = await interceptor.onBeforeToolCall('next', {})
      expect(meta.atrib).toBeUndefined()
    })
  })

  describe('transaction detection + anti-double-emission', () => {
    it('skips emission when Path 1 detected (merchant has atrib)', async () => {
      const submissions: unknown[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any)?.body as string)
        submissions.push(body)
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      })

      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const token = await makeIncomingToken()

      // ACP response shape WITH atrib token → Path 1
      const checkoutResponse = {
        data: { object: { object: 'checkout_session' }, url: 'https://merchant.com/checkout/abc' },
      }
      interceptor.onAfterToolResponse('checkout', checkoutResponse, { atrib: token })

      await interceptor.flush()

      // No transaction record should have been submitted (Path 2 suppressed)
      const txnSubmissions = submissions.filter((s: any) => s.record?.event_type === 'transaction')
      expect(txnSubmissions.length).toBe(0)
    })

    it('emits Path 2 record when merchant has no atrib (ACP/UCP)', async () => {
      const submissions: any[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any)?.body as string)
        submissions.push(body)
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      })

      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })

      // ACP response shape WITHOUT atrib token → Path 2
      const checkoutResponse = {
        data: { object: { object: 'checkout_session' }, url: 'https://merchant.com/checkout/abc' },
      }
      interceptor.onAfterToolResponse('checkout', checkoutResponse, {})

      await interceptor.flush()

      const txnSubmissions = submissions.filter(s => s.record?.event_type === 'transaction')
      expect(txnSubmissions.length).toBeGreaterThanOrEqual(1)
      expect(txnSubmissions[0].record.event_type).toBe('transaction')
    })

    it('Path 2 transaction record has session_token (cross-trace)', async () => {
      const submissions: any[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any)?.body as string)
        submissions.push(body)
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      })

      const interceptor = atrib({
        creatorKey: TEST_KEY_B64,
        sessionToken: 'my_session',
      })

      interceptor.onAfterToolResponse(
        'checkout',
        { data: { object: { object: 'checkout_session' } } },
        {},
      )
      await interceptor.flush()

      const txn = submissions.find(s => s.record?.event_type === 'transaction')
      expect(txn).toBeDefined()
      expect(txn.record.session_token).toBe('my_session')
    })

    it('Path 2 with no prior context uses genesis chain_root', async () => {
      const submissions: any[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any)?.body as string)
        submissions.push(body)
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      })

      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })

      // First call ever — checkout. No prior context.
      interceptor.onAfterToolResponse(
        'checkout',
        { data: { object: { object: 'checkout_session' } } },
        {},
      )
      await interceptor.flush()

      const txn = submissions.find(s => s.record?.event_type === 'transaction')
      expect(txn).toBeDefined()
      // chain_root should match genesisChainRoot(context_id) — sha256 prefix + 64 hex
      expect(txn.record.chain_root).toMatch(/^sha256:[0-9a-f]{64}$/)
      // It should NOT be all zeros
      expect(txn.record.chain_root).not.toBe(`sha256:${'0'.repeat(64)}`)
    })

    it('Path 2 ACP derives content_id from order.permalink_url', async () => {
      const submissions: any[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any)?.body as string)
        submissions.push(body)
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      })

      const { computeContentId } = await import('@atrib/mcp')
      const expectedContentId = computeContentId(
        'https://example.com/orders/ord_abc123',
        'checkout',
      )

      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      interceptor.onAfterToolResponse(
        'do_checkout',
        {
          // Real ACP completion shape: status === 'completed' + order object
          id: 'checkout_session_123',
          status: 'completed',
          order: {
            id: 'ord_abc123',
            checkout_session_id: 'checkout_session_123',
            permalink_url: 'https://example.com/orders/ord_abc123',
          },
        },
        {},
      )
      await interceptor.flush()

      const txn = submissions.find((s) => s.record?.event_type === 'transaction')
      expect(txn.record.content_id).toBe(expectedContentId)
    })

    it('Path 2 heuristic uses serverUrl + tool name', async () => {
      const submissions: any[] = []
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any)?.body as string)
        submissions.push(body)
        return new Response(JSON.stringify({ logIndex: 1 }), { status: 200 })
      })

      const { computeContentId } = await import('@atrib/mcp')
      const expectedContentId = computeContentId('https://tools.example.com', 'place_order')

      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      // No protocol signal, just tool name match
      interceptor.onAfterToolResponse(
        'place_order',
        { result: 'ok' },
        {},
        { serverUrl: 'https://tools.example.com' },
      )
      await interceptor.flush()

      const txn = submissions.find(s => s.record?.event_type === 'transaction')
      expect(txn).toBeDefined()
      expect(txn.record.content_id).toBe(expectedContentId)
    })
  })

  describe('session policy record', () => {
    it('returns null before init', () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      // Before any call, init hasn't run
      expect(interceptor.getSessionPolicyRecord()).toBeNull()
    })

    it('returns populated record after init', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      // Trigger init
      await interceptor.onBeforeToolCall('search', {})

      const record = interceptor.getSessionPolicyRecord()
      expect(record).not.toBeNull()
      expect(record!.context_id).toMatch(/^[0-9a-f]{32}$/)
      expect(record!.spec_version).toBe('atrib/1.0')
      expect(record!.record_id).toMatch(/^sha256:[0-9a-f]{64}$/)
    })
  })

  describe('idempotent initialization', () => {
    it('initializes only once across concurrent calls', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })

      // Fire two calls in parallel — both should await the same init
      const [meta1, meta2] = await Promise.all([
        interceptor.onBeforeToolCall('a', {}),
        interceptor.onBeforeToolCall('b', {}),
      ])

      // Both should have the same baggage policy record id
      const baggage1 = meta1.baggage as string
      const baggage2 = meta2.baggage as string
      const policyId1 = baggage1.match(/atrib-policy=([^,]+)/)?.[1]
      const policyId2 = baggage2.match(/atrib-policy=([^,]+)/)?.[1]
      expect(policyId1).toBeDefined()
      expect(policyId1).toBe(policyId2)
    })
  })

  describe('warnings', () => {
    it('records transaction_emitted_by_agent warning on Path 2', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      // Trigger init first
      await interceptor.onBeforeToolCall('search', {})

      interceptor.onAfterToolResponse(
        'checkout',
        { data: { object: { object: 'checkout_session' } } },
        {},
      )
      await interceptor.flush()

      const record = interceptor.getSessionPolicyRecord()
      expect(record).not.toBeNull()
      // §5.4.6: runtime warnings MUST be observable through the policy record
      expect(record!.warnings).toContain('transaction_emitted_by_agent')
    })

    it('records transaction_detected_by_heuristic warning when heuristic fires', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      await interceptor.onBeforeToolCall('search', {})

      // Heuristic-only detection (tool name match, no protocol signal)
      interceptor.onAfterToolResponse(
        'place_order',
        { result: 'ok' },
        {},
        { serverUrl: 'https://tools.example.com' },
      )
      await interceptor.flush()

      const record = interceptor.getSessionPolicyRecord()
      expect(record!.warnings).toContain('transaction_emitted_by_agent')
      expect(record!.warnings).toContain('transaction_detected_by_heuristic')
    })

    it('does not duplicate warnings across multiple Path 2 emissions', async () => {
      // Override global mock with one that returns fresh Response per call
      // (Response body is consumed on first read; mockResolvedValue reuses the same instance)
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () => new Response(JSON.stringify({ logIndex: 1 }), { status: 200 }),
      )
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      await interceptor.onBeforeToolCall('search', {})

      // Two Path 2 transactions in the same session
      interceptor.onAfterToolResponse(
        'checkout',
        { data: { object: { object: 'checkout_session' } } },
        {},
      )
      interceptor.onAfterToolResponse(
        'checkout2',
        { data: { object: { object: 'checkout_session' } } },
        {},
      )
      await interceptor.flush()

      const record = interceptor.getSessionPolicyRecord()
      const occurrences = record!.warnings.filter(w => w === 'transaction_emitted_by_agent').length
      expect(occurrences).toBe(1)
    })
  })

  describe('§5.4.3 W3C header merging', () => {
    it('appends atrib-session to existing baggage rather than clobbering it', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64, sessionToken: 'sess123' })
      const meta = await interceptor.onBeforeToolCall('search', {
        baggage: 'vendor=acme,user=alice',
      })
      const baggage = meta.baggage as string
      expect(baggage).toContain('vendor=acme')
      expect(baggage).toContain('user=alice')
      expect(baggage).toContain('atrib-session=sess123')
    })

    it('appends atrib= to existing tracestate rather than clobbering it', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const token = await makeIncomingToken()
      interceptor.onAfterToolResponse('prev', {}, { atrib: token })

      const meta = await interceptor.onBeforeToolCall('next', {
        tracestate: 'congo=ucfe60ee,rojo=00f067aa0ba902b7',
      })
      const tracestate = meta.tracestate as string
      expect(tracestate).toContain('congo=ucfe60ee')
      expect(tracestate).toContain('rojo=00f067aa0ba902b7')
      expect(tracestate).toMatch(/atrib=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)
    })

    it('preserves caller-supplied traceparent (does not regenerate)', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      const incomingTrace = '00-1234567890abcdef1234567890abcdef-1111222233334444-01'
      const meta = await interceptor.onBeforeToolCall('search', {
        traceparent: incomingTrace,
      })
      expect(meta.traceparent).toBe(incomingTrace)
    })

    it('preserves caller tracestate even when no atrib token to append', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      // No prior context → no atrib token, but caller has tracestate
      const meta = await interceptor.onBeforeToolCall('search', {
        tracestate: 'vendor=foo',
      })
      expect(meta.tracestate).toBe('vendor=foo')
    })
  })

  describe('degradation contract (§5.8)', () => {
    it('onBeforeToolCall never throws', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      await expect(interceptor.onBeforeToolCall('tool', {})).resolves.toBeDefined()
    })

    it('onAfterToolResponse never throws', () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      expect(() => interceptor.onAfterToolResponse('tool', null, undefined)).not.toThrow()
    })

    it('flush resolves when empty', async () => {
      const interceptor = atrib({ creatorKey: TEST_KEY_B64 })
      await expect(interceptor.flush()).resolves.toBeUndefined()
    })

    it('init failure does not break the middleware', async () => {
      // Force init failure by mocking initializeSessionPolicy
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const interceptor = atrib({
        creatorKey: TEST_KEY_B64,
        merchantDomain: 'https://broken.example.com',
      })

      // Even with broken fetch, onBeforeToolCall should return meta
      const meta = await interceptor.onBeforeToolCall('search', {})
      expect(meta).toBeDefined()
      expect(meta.baggage).toContain('atrib-session=')

      warnSpy.mockRestore()
    })
  })
})
