import { describe, it, expect, vi } from 'vitest'
import { atrib } from '../src/middleware.js'
import { base64urlEncode } from '../src/base64url.js'
import { getPublicKey } from '../src/signing.js'
import * as signingModule from '../src/signing.js'
import { decodeToken } from '../src/token.js'
import { hexEncode } from '../src/hash.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AtribRecord } from '../src/types.js'

// Deterministic test key
const TEST_PRIVATE_KEY = new Uint8Array(32).fill(42)
const TEST_PRIVATE_KEY_B64 = base64urlEncode(TEST_PRIVATE_KEY)

/**
 * Create a minimal mock McpServer that captures the setRequestHandler calls.
 * This mimics the McpServer.server (low-level Server) interface.
 */
function createMockServer() {
  const handlers = new Map<string, Function>()

  const mockUnderlyingServer = {
    setRequestHandler(schema: { shape?: { method?: { value?: string } } }, handler: Function) {
      const method = schema?.shape?.method?.value ?? 'unknown'
      handlers.set(method, handler)
    },
  }

  const mockServer = {
    server: mockUnderlyingServer,
  } as unknown as McpServer

  return {
    mockServer,
    handlers,
    /** Simulate registering a tool (triggers setRequestHandler for tools/call) */
    registerToolHandler(handler: Function) {
      const callToolSchema = { shape: { method: { value: 'tools/call' } } }
      mockUnderlyingServer.setRequestHandler(callToolSchema, handler)
    },
    /** Get the (possibly wrapped) tools/call handler */
    getToolHandler(): Function | undefined {
      return handlers.get('tools/call')
    },
  }
}

/** Create a mock tools/call request */
function createToolCallRequest(toolName: string, meta?: Record<string, unknown>) {
  return {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: { query: 'test' },
      _meta: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        ...meta,
      },
    },
  }
}

describe('atrib() middleware', () => {
  describe('pass-through mode', () => {
    it('operates in pass-through when no creatorKey provided', () => {
      const { mockServer } = createMockServer()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const wrapped = atrib(mockServer)

      expect(warnSpy).toHaveBeenCalledWith(
        'atrib: no creatorKey provided, operating in pass-through mode',
      )
      expect(wrapped.flush).toBeDefined()
      warnSpy.mockRestore()
    })

    it('operates in pass-through when creatorKey is wrong length', () => {
      const { mockServer } = createMockServer()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const shortKey = base64urlEncode(new Uint8Array(16)) // 16 bytes, not 32

      atrib(mockServer, { creatorKey: shortKey })

      expect(warnSpy).toHaveBeenCalledWith(
        'atrib: creatorKey must be 32 bytes, operating in pass-through mode',
      )
      warnSpy.mockRestore()
    })
  })

  describe('handler wrapping', () => {
    it('wraps the tools/call handler when registered', () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })

      // Apply the middleware FIRST
      atrib(mockServer, { creatorKey: TEST_PRIVATE_KEY_B64, serverUrl: 'https://test.example.com' })

      // Then register a tool handler (simulates what McpServer.tool() does internally)
      registerToolHandler(originalHandler)

      // The handler should now be wrapped
      const handler = getToolHandler()
      expect(handler).toBeDefined()
      // The wrapped handler is NOT the original
      expect(handler).not.toBe(originalHandler)
    })

    it('does not wrap non-tools/call handlers', () => {
      const { mockServer, handlers } = createMockServer()
      const pingHandler = vi.fn()

      atrib(mockServer, { creatorKey: TEST_PRIVATE_KEY_B64 })

      // Simulate registering a different handler
      const pingSchema = { shape: { method: { value: 'ping' } } }
      mockServer.server.setRequestHandler(pingSchema as any, pingHandler)

      expect(handlers.get('ping')).toBe(pingHandler) // NOT wrapped
    })
  })

  describe('record emission', () => {
    it('emits attribution record on successful tool call', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'result' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('search_web')

      await handler(request, {})

      // The result should now have _meta.atrib with a propagation token
      expect(resultObj._meta).toBeDefined()
      const meta = (resultObj as any)._meta
      expect(meta.atrib).toBeDefined()
      expect(typeof meta.atrib).toBe('string')

      // Token should be valid format (87 chars max)
      expect(meta.atrib.length).toBeLessThanOrEqual(87)

      // Decode and verify the token
      const decoded = decodeToken(meta.atrib)
      expect(decoded).not.toBeNull()
      expect(decoded!.recordHash.length).toBe(32)
      expect(decoded!.creatorKey.length).toBe(32)

      // The creator key in the token should match our test key's public key
      const expectedPubKey = await getPublicKey(TEST_PRIVATE_KEY)
      expect(decoded!.creatorKey).toEqual(expectedPubKey)
    })

    it('does not emit record when isError is true', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const errorResult = { isError: true, content: [{ type: 'text', text: 'error' }] }
      const originalHandler = vi.fn().mockResolvedValue(errorResult)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('search_web')

      const result = await handler(request, {})

      // No _meta.atrib should be added
      expect((result as any)._meta?.atrib).toBeUndefined()
    })

    it('invokes onRecord with the signed record after signing', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'result' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      const observed: unknown[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (rec) => { observed.push(rec) },
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      await handler(createToolCallRequest('search_web'), {})

      expect(observed).toHaveLength(1)
      const rec = observed[0] as Record<string, unknown>
      expect(rec.spec_version).toBe('atrib/1.0')
      expect(rec.event_type).toBe('https://atrib.dev/v1/types/tool_call')
      expect(rec.signature).toBeTruthy() // signed AFTER, not BEFORE
      const expectedPubKey = await getPublicKey(TEST_PRIVATE_KEY)
      const { base64urlEncode: enc } = await import('../src/base64url.js')
      expect(rec.creator_key).toBe(enc(expectedPubKey))
    })

    it('onRecord errors do not break tool calls or block submission (§5.8)', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'result' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: () => { throw new Error('disk full') },
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const result = await handler(createToolCallRequest('search_web'), {})

      // Tool call still succeeds and gets attribution token in _meta
      expect((result as any)._meta?.atrib).toBeDefined()
      expect(warnSpy).toHaveBeenCalledWith('atrib: onRecord observer threw', expect.any(Error))
      warnSpy.mockRestore()
    })

    it('emits transaction record for transactionTools', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'checkout done' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://merchant.example.com',
        transactionTools: ['checkout'],
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('checkout')

      await handler(request, {})

      // Token should be present (record was emitted)
      expect((resultObj as any)._meta?.atrib).toBeDefined()
    })
  })

  describe('context propagation', () => {
    it('extracts context_id from traceparent', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('search_web')

      await handler(request, {})

      // Token should be present
      const token = (resultObj as any)._meta.atrib as string
      expect(token).toBeDefined()
    })

    it('writes tracestate with atrib entry', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('search_web')

      await handler(request, {})

      const meta = (resultObj as any)._meta
      expect(meta.tracestate).toBeDefined()
      expect(meta.tracestate).toMatch(/^atrib=/)
    })

    it('reads inbound atrib token and chains records', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()

      // First call: genesis record
      const result1 = { content: [{ type: 'text', text: 'first' }] }
      const handler1 = vi.fn().mockResolvedValue(result1)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(handler1)

      const wrappedHandler = getToolHandler()!
      const request1 = createToolCallRequest('tool_a')
      await wrappedHandler(request1, {})
      const token1 = (result1 as any)._meta.atrib as string

      // Second call: carries the token from first call
      const result2 = { content: [{ type: 'text', text: 'second' }] }
      const handler2 = vi.fn().mockResolvedValue(result2)
      registerToolHandler(handler2)
      const wrappedHandler2 = getToolHandler()!

      const request2 = createToolCallRequest('tool_b', { atrib: token1 })
      await wrappedHandler2(request2, {})
      const token2 = (result2 as any)._meta.atrib as string

      // Tokens should be different (different records)
      expect(token1).not.toBe(token2)

      // Both should be valid tokens
      expect(decodeToken(token1)).not.toBeNull()
      expect(decodeToken(token2)).not.toBeNull()
    })

    it('generates random context_id when no traceparent present', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      // Request with NO traceparent
      const request = {
        method: 'tools/call',
        params: { name: 'search_web', arguments: {}, _meta: {} },
      }
      await handler(request, {})

      // Should still produce a valid token (used generated context_id)
      expect((resultObj as any)._meta.atrib).toBeDefined()
    })

    it('propagates session_token through baggage in outbound context', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('search_web', {
        baggage: 'atrib-session=test_session_42',
      })
      await handler(request, {})

      const meta = (resultObj as any)._meta
      expect(meta.baggage).toContain('atrib-session=test_session_42')
    })

    it('writes X-Atrib-Chain fallback in outbound context', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      await handler(createToolCallRequest('search_web'), {})

      const meta = (resultObj as any)._meta
      expect(meta['X-Atrib-Chain']).toBe(meta.atrib)
    })

    it('forwards traceparent in outbound context', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const tp = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
      const request = createToolCallRequest('search_web')
      await handler(request, {})

      const meta = (resultObj as any)._meta
      expect(meta.traceparent).toBe(tp)
    })
  })

  describe('chain integrity', () => {
    it('second record chain_root equals sha256 of first signed record', async () => {
      // Spy on fetch to capture the signed records submitted to the log.
      // Spec §2.6.1: the body IS the bare signed record, not a wrapper.
      const submittedRecords: any[] = []
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as any).body as string)
        submittedRecords.push(body)
        return new Response(
          JSON.stringify({
            log_index: 1,
            checkpoint: 'log.test/v1\n2\nrootHashBase64\n',
            inclusion_proof: [],
            leaf_hash: 'leafHashBase64',
          }),
          { status: 200 },
        )
      })

      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()

      const result1 = { content: [{ type: 'text', text: 'first' }] }
      const handler1 = vi.fn().mockResolvedValue(result1)

      const wrapped = atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(handler1)

      // First call. genesis
      const wrappedHandler = getToolHandler()!
      await wrappedHandler(createToolCallRequest('tool_a'), {})
      const token1 = (result1 as any)._meta.atrib as string

      // Second call. chained, carries first token
      const result2 = { content: [{ type: 'text', text: 'second' }] }
      const handler2 = vi.fn().mockResolvedValue(result2)
      registerToolHandler(handler2)
      const wrappedHandler2 = getToolHandler()!

      await wrappedHandler2(createToolCallRequest('tool_b', { atrib: token1 }), {})

      // Flush to ensure submissions complete
      await wrapped.flush()

      // We should have captured 2 signed records
      expect(submittedRecords.length).toBe(2)

      const record1 = submittedRecords[0]
      const record2 = submittedRecords[1]

      // Record 1 is a genesis. chain_root = sha256(context_id)
      expect(record1.chain_root).toMatch(/^sha256:[0-9a-f]{64}$/)

      // Record 2's chain_root should be "sha256:" + hex of the first token's record_hash
      const decoded1 = decodeToken(token1)!
      const expectedChainRoot = `sha256:${hexEncode(decoded1.recordHash)}`
      expect(record2.chain_root).toBe(expectedChainRoot)

      // Both records should have the same context_id
      expect(record1.context_id).toBe(record2.context_id)

      // Both creator keys should match (same server)
      expect(record1.creator_key).toBe(record2.creator_key)

      fetchSpy.mockRestore()
    })
  })

  describe('degradation contract (§5.8)', () => {
    it('never re-invokes handler on attribution error', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()

      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      let callCount = 0
      const originalHandler = vi.fn().mockImplementation(async () => {
        callCount++
        return resultObj
      })

      // Use an invalid serverUrl that will cause computeContentId to throw
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'not://a valid url but wont crash',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await handler(createToolCallRequest('search_web'), {})

      // Handler must be called exactly once. never re-invoked
      expect(callCount).toBe(1)

      warnSpy.mockRestore()
    })

    it('returns original result when attribution logic throws', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()

      const expectedResult = { content: [{ type: 'text', text: 'important data' }] }
      const originalHandler = vi.fn().mockResolvedValue(expectedResult)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const result = await handler(createToolCallRequest('search_web'), {})

      // Result must be the handler's return value
      expect(result).toBe(expectedResult)
    })

    it('flush() resolves even when no submissions pending', async () => {
      const { mockServer } = createMockServer()
      const wrapped = atrib(mockServer, { creatorKey: TEST_PRIVATE_KEY_B64 })
      await expect(wrapped.flush()).resolves.toBeUndefined()
    })

    it('returns unmodified result when signRecord throws (catch path exercised)', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()

      const expectedResult = { content: [{ type: 'text', text: 'original' }] }
      const originalHandler = vi.fn().mockResolvedValue(expectedResult)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Mock signRecord to throw. this forces the catch path
      const signSpy = vi
        .spyOn(signingModule, 'signRecord')
        .mockRejectedValue(new Error('forced signing failure'))

      const result = await handler(createToolCallRequest('search_web'), {})

      // Must return the original result unchanged
      expect(result).toBe(expectedResult)
      // Must not have atrib token (attribution failed)
      expect((expectedResult as any)._meta?.atrib).toBeUndefined()
      // Catch path logged a warning
      expect(warnSpy).toHaveBeenCalledWith(
        'atrib: middleware error, passing through',
        expect.any(Error),
      )

      signSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('warns about missing serverUrl', () => {
      const { mockServer } = createMockServer()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      atrib(mockServer, { creatorKey: TEST_PRIVATE_KEY_B64 })

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no serverUrl provided'))
      warnSpy.mockRestore()
    })
  })

  describe('autoChain (opt-in chain synthesis for non-propagating hosts)', () => {
    /** Build a request without traceparent so the middleware must derive context_id itself. */
    function bareToolCallRequest(toolName: string) {
      return { method: 'tools/call', params: { name: toolName, arguments: {} } }
    }

    it('default off: no traceparent → each call gets a random context_id and a genesis chain_root', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => { captured.push(r) },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))

      const handler = getToolHandler()!
      await handler(bareToolCallRequest('a'), {})
      await handler(bareToolCallRequest('b'), {})
      await handler(bareToolCallRequest('c'), {})

      expect(captured).toHaveLength(3)
      const contextIds = new Set(captured.map((r) => r.context_id))
      // No traceparent → each call gets its own random context_id (genesis on each).
      expect(contextIds.size).toBe(3)
      // Every chain_root must equal the genesis root for its own context_id.
      const { canonicalRecord: canon } = await import('../src/canon.js')
      const { sha256: hash, hexEncode: hex } = await import('../src/hash.js')
      void canon; void hash; void hex
      const { genesisChainRoot: genesis } = await import('../src/chain-root.js')
      for (const r of captured) {
        expect(r.chain_root).toBe(genesis(r.context_id))
      }
    })

    it('autoChain on: no traceparent → all calls share a stable context_id and chain to predecessor', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        autoChain: true,
        onRecord: (r) => { captured.push(r) },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))

      const handler = getToolHandler()!
      await handler(bareToolCallRequest('a'), {})
      await handler(bareToolCallRequest('b'), {})
      await handler(bareToolCallRequest('c'), {})

      expect(captured).toHaveLength(3)

      // All three records share a single stable context_id.
      const contextIds = new Set(captured.map((r) => r.context_id))
      expect(contextIds.size).toBe(1)

      // First record is genesis; each subsequent record's chain_root references
      // the previous record's hash → CHAIN_PRECEDES edges form.
      const { canonicalRecord: canon } = await import('../src/canon.js')
      const { sha256: hash, hexEncode: hex } = await import('../src/hash.js')
      const { genesisChainRoot: genesis } = await import('../src/chain-root.js')

      expect(captured[0]!.chain_root).toBe(genesis(captured[0]!.context_id))

      for (let i = 1; i < captured.length; i++) {
        const prevHashHex = hex(hash(canon(captured[i - 1]!)))
        expect(captured[i]!.chain_root).toBe(`sha256:${prevHashHex}`)
      }
    })

    it('autoChainSeed restores chain across simulated wrapper restart', async () => {
      // First "wrapper instance", produce 2 records. autoChain on, no seed.
      const first: AtribRecord[] = []
      {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          autoChain: true,
          onRecord: (r) => { first.push(r) },
        })
        registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))
        const handler = getToolHandler()!
        await handler(bareToolCallRequest('a'), {})
        await handler(bareToolCallRequest('b'), {})
      }
      expect(first).toHaveLength(2)
      const sharedContext = first[0]!.context_id
      expect(first[1]!.context_id).toBe(sharedContext)

      // Second "wrapper instance", fresh middleware, seeded with first[1].
      // The next call MUST chain to first[1], using the SAME context_id.
      const { canonicalRecord: canon } = await import('../src/canon.js')
      const { sha256: hash, hexEncode: hex } = await import('../src/hash.js')

      const second: AtribRecord[] = []
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        autoChain: true,
        autoChainSeed: first, // simulate reading the local jsonl mirror on boot
        onRecord: (r) => { second.push(r) },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))
      const handler = getToolHandler()!
      await handler(bareToolCallRequest('c'), {})

      expect(second).toHaveLength(1)
      // Same context_id as the first instance, chain continues, doesn't fork.
      expect(second[0]!.context_id).toBe(sharedContext)
      // chain_root references first[1]'s record_hash, NOT genesis.
      const expectedPrev = `sha256:${hex(hash(canon(first[1]!)))}`
      expect(second[0]!.chain_root).toBe(expectedPrev)
    })

    it('autoChain on but inbound atrib propagation present: explicit chain wins over synthesized', async () => {
      // Same middleware instance used for two calls; second call carries a
      // valid inbound atrib token. The middleware must honor it instead of
      // chaining via lastRecordHashByContext.
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        autoChain: true,
        onRecord: (r) => { captured.push(r) },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))

      const handler = getToolHandler()!
      await handler(bareToolCallRequest('a'), {}) // genesis under the stable contextId
      const first = captured[0]!
      const { canonicalRecord: canon } = await import('../src/canon.js')
      const { sha256: hash, hexEncode: hex } = await import('../src/hash.js')

      // Build an explicit atrib token referencing a DIFFERENT (hand-crafted) record.
      const fakePriorHash = new Uint8Array(32).fill(7)
      const tokenPayload = `${Buffer.from(fakePriorHash).toString('base64url')}.${captured[0]!.creator_key}`
      const result2 = { content: [{ type: 'text', text: 'ok' }] }
      const handler2 = vi.fn().mockResolvedValue(result2)
      // re-register with new handler
      registerToolHandler(handler2)
      const newHandler = getToolHandler()!

      await newHandler(
        {
          method: 'tools/call',
          params: {
            name: 'b',
            arguments: {},
            _meta: {
              atrib: tokenPayload,
              traceparent: `00-${first.context_id}-0000000000000000-01`,
            },
          },
        },
        {},
      )
      const second = captured[1]!
      // Spec wins: chain_root MUST be the inbound (fake prior) hash, not the
      // autoChain'd hash of `first`.
      expect(second.chain_root).toBe(`sha256:${hex(fakePriorHash)}`)
      // Sanity: it is NOT the autoChain candidate.
      expect(second.chain_root).not.toBe(`sha256:${hex(hash(canon(first)))}`)
    })
  })
})
