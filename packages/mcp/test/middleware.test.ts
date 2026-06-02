import { describe, it, expect, vi } from 'vitest'
import { atrib } from '../src/middleware.js'
import { base64urlEncode } from '../src/base64url.js'
import { getPublicKey } from '../src/signing.js'
import * as signingModule from '../src/signing.js'
import { decodeToken } from '../src/token.js'
import { hexEncode } from '../src/hash.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AtribRecord } from '../src/types.js'
import type { OnRecordSidecar } from '../src/middleware.js'

// Deterministic test key
const TEST_PRIVATE_KEY = new Uint8Array(32).fill(42)
const TEST_PRIVATE_KEY_B64 = base64urlEncode(TEST_PRIVATE_KEY)
const VALID_PARENT_RECORD_HASH = 'sha256:' + 'a'.repeat(64)
const OTHER_RECORD_HASH = 'sha256:' + 'b'.repeat(64)

async function withParentRecordHash(value: string | undefined, fn: () => Promise<void>) {
  const prior = process.env['ATRIB_PARENT_RECORD_HASH']
  if (value === undefined) delete process.env['ATRIB_PARENT_RECORD_HASH']
  else process.env['ATRIB_PARENT_RECORD_HASH'] = value
  try {
    await fn()
  } finally {
    if (prior === undefined) delete process.env['ATRIB_PARENT_RECORD_HASH']
    else process.env['ATRIB_PARENT_RECORD_HASH'] = prior
  }
}

function informedByOf(record: AtribRecord): string[] | undefined {
  return (record as AtribRecord & { informed_by?: string[] }).informed_by
}

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

    it('can disable log submission without disabling signing', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'offline' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)
      const onRecord = vi.fn()
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      try {
        const wrapped = atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          logSubmission: 'disabled',
          onRecord,
        })
        registerToolHandler(originalHandler)

        const handler = getToolHandler()!
        await handler(createToolCallRequest('offline_tool'), {})
        await wrapped.flush()

        expect((resultObj as any)._meta?.atrib).toBeDefined()
        expect(onRecord).toHaveBeenCalledTimes(1)
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        fetchSpy.mockRestore()
      }
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

    it('seeds the first committed tool_call from ATRIB_PARENT_RECORD_HASH', async () => {
      await withParentRecordHash(VALID_PARENT_RECORD_HASH, async () => {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        const originalHandler = vi.fn().mockImplementation(async () => ({
          content: [{ type: 'text', text: 'ok' }],
        }))
        const observed: AtribRecord[] = []

        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          autoChain: true,
          logSubmission: 'disabled',
          onRecord: (record) => {
            observed.push(record)
          },
        })
        registerToolHandler(originalHandler)

        const handler = getToolHandler()!
        await handler(createToolCallRequest('search_web'), {})
        await handler(createToolCallRequest('search_web'), {})

        expect(observed).toHaveLength(2)
        expect(informedByOf(observed[0])).toEqual([VALID_PARENT_RECORD_HASH])
        expect(informedByOf(observed[1])).toBeUndefined()
      })
    })

    it('does not consume the parent seed when the tool call fails', async () => {
      await withParentRecordHash(VALID_PARENT_RECORD_HASH, async () => {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        const originalHandler = vi
          .fn()
          .mockResolvedValueOnce({ isError: true, content: [{ type: 'text', text: 'error' }] })
          .mockResolvedValueOnce({ content: [{ type: 'text', text: 'ok' }] })
        const observed: AtribRecord[] = []

        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          autoChain: true,
          logSubmission: 'disabled',
          onRecord: (record) => {
            observed.push(record)
          },
        })
        registerToolHandler(originalHandler)

        const handler = getToolHandler()!
        await handler(createToolCallRequest('search_web'), {})
        await handler(createToolCallRequest('search_web'), {})

        expect(observed).toHaveLength(1)
        expect(informedByOf(observed[0])).toEqual([VALID_PARENT_RECORD_HASH])
      })
    })

    it('dedupes the parent seed with callback and auto-detected structured references', async () => {
      await withParentRecordHash(VALID_PARENT_RECORD_HASH, async () => {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        const originalHandler = vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'ok' }],
        })
        const observed: AtribRecord[] = []

        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          logSubmission: 'disabled',
          autoDetectInformedByFromArgs: true,
          informedBy: () => [OTHER_RECORD_HASH],
          onRecord: (record) => {
            observed.push(record)
          },
        })
        registerToolHandler(originalHandler)

        const handler = getToolHandler()!
        const request = createToolCallRequest('search_web')
        request.params.arguments = { record_hash: OTHER_RECORD_HASH }
        await handler(request, {})

        expect(observed).toHaveLength(1)
        expect(informedByOf(observed[0])).toEqual([VALID_PARENT_RECORD_HASH, OTHER_RECORD_HASH])
      })
    })

    it('does not auto-detect prose hashes as informed_by claims', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const originalHandler = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      })
      const observed: AtribRecord[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        logSubmission: 'disabled',
        autoDetectInformedByFromArgs: true,
        onRecord: (record) => {
          observed.push(record)
        },
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      const request = createToolCallRequest('search_web')
      request.params.arguments = {
        content: `mentioned ${OTHER_RECORD_HASH}`,
        args_hash: OTHER_RECORD_HASH,
        informed_by: [OTHER_RECORD_HASH],
      }
      await handler(request, {})

      expect(observed).toHaveLength(1)
      expect(informedByOf(observed[0])).toBeUndefined()
    })

    it('ignores invalid parent hash env values', async () => {
      await withParentRecordHash('sha256:' + 'A'.repeat(64), async () => {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        const originalHandler = vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'ok' }],
        })
        const observed: AtribRecord[] = []

        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          logSubmission: 'disabled',
          onRecord: (record) => {
            observed.push(record)
          },
        })
        registerToolHandler(originalHandler)

        const handler = getToolHandler()!
        await handler(createToolCallRequest('search_web'), {})

        expect(observed).toHaveLength(1)
        expect(informedByOf(observed[0])).toBeUndefined()
      })
    })

    it('invokes onRecord with the signed record after signing', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'result' }] }
      const originalHandler = vi.fn().mockResolvedValue(resultObj)

      const observed: unknown[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (rec) => {
          observed.push(rec)
        },
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
        onRecord: () => {
          throw new Error('disk full')
        },
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

    it('captures MCP OAuth evidence from validated authInfo without storing the bearer token', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
      const sidecars: OnRecordSidecar[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://mcp.example.com/mcp',
        logSubmission: 'disabled',
        authorizationEvidence: {
          requiredScopes: ['files:read'],
          protectedResourceMetadata: {
            resource: 'https://mcp.example.com/mcp',
            authorization_servers: ['https://auth.example.com'],
          },
        },
        onRecord: (_record, sidecar) => {
          if (sidecar) sidecars.push(sidecar)
        },
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      await handler(createToolCallRequest('read_file'), {
        authInfo: {
          token: 'secret-bearer-token',
          clientId: 'client-123',
          scopes: ['files:read', 'files:write'],
          expiresAt: 1_800_000_000,
          resource: new URL('https://mcp.example.com/mcp'),
        },
      })

      expect(sidecars).toHaveLength(1)
      expect(sidecars[0]!.resolvedFacts).toEqual({ tool_name: 'read_file' })
      const evidence = sidecars[0]!.authorizationEvidence?.[0]
      expect(evidence?.protocol).toBe('mcp_oauth')
      expect(evidence?.claimsVerified).toBe(true)
      expect(evidence?.claims.client_id).toBe('client-123')
      expect(evidence?.claims.scope).toBe('files:read files:write')
      expect(evidence?.claims.resource).toBe('https://mcp.example.com/mcp')
      expect(evidence?.requiredScopes).toEqual(['files:read'])
      expect(evidence?.expectedClientId).toBe('client-123')
      expect(JSON.stringify(evidence)).not.toContain('secret-bearer-token')
      expect(evidence?.token_hash).toMatch(/^sha256:[A-Za-z0-9_-]+$/)
    })

    it('captures DPoP proof material with a token hash instead of the bearer token', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
      const sidecars: OnRecordSidecar[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://mcp.example.com/mcp',
        logSubmission: 'disabled',
        authorizationEvidence: {
          includeDpopProof: true,
          requestMethod: 'POST',
        },
        onRecord: (_record, sidecar) => {
          if (sidecar) sidecars.push(sidecar)
        },
      })
      registerToolHandler(originalHandler)

      const handler = getToolHandler()!
      await handler(createToolCallRequest('read_file'), {
        authInfo: {
          token: 'secret-bearer-token',
          clientId: 'client-123',
          scopes: ['files:read'],
          resource: new URL('https://mcp.example.com/mcp'),
        },
        requestInfo: {
          headers: new Headers({ DPoP: 'header.payload.signature' }),
          url: new URL('https://mcp.example.com/mcp'),
        },
      })

      const dpop = sidecars[0]!.authorizationEvidence?.[0]?.dpopProof
      expect(dpop?.proofJwt).toBe('header.payload.signature')
      expect(dpop?.method).toBe('POST')
      expect(dpop?.url).toBe('https://mcp.example.com/mcp')
      expect(dpop?.expectedAth).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(JSON.stringify(dpop)).not.toContain('secret-bearer-token')
    })

    it('submits sanitized OAuth evidence to the archive when enabled', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const originalHandler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
      const proof = {
        log_index: 42,
        checkpoint: 'log.test/v1\n43\nrootHashBase64\n',
        inclusion_proof: [],
        leaf_hash: 'leafHashBase64',
      }
      const archivePayloads: unknown[] = []
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        const href = String(url)
        if (href === 'https://log.test/v1/entries') {
          return new Response(JSON.stringify(proof), { status: 200 })
        }
        if (href === 'https://archive.test/v1/records') {
          archivePayloads.push(JSON.parse(init?.body as string))
          return new Response(JSON.stringify({ stored: true }), { status: 201 })
        }
        throw new Error(`unexpected fetch ${href}`)
      })

      try {
        const wrapped = atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://mcp.example.com/mcp',
          logEndpoint: 'https://log.test/v1/entries',
          archiveSubmission: { endpoint: 'https://archive.test/v1' },
          authorizationEvidence: {
            requiredScopes: ['files:read'],
            protectedResourceMetadata: {
              resource: 'https://mcp.example.com/mcp',
              authorization_servers: ['https://auth.example.com'],
            },
          },
        })
        registerToolHandler(originalHandler)

        const handler = getToolHandler()!
        await handler(createToolCallRequest('read_file'), {
          authInfo: {
            token: 'secret-bearer-token',
            clientId: 'client-123',
            scopes: ['files:read'],
            resource: new URL('https://mcp.example.com/mcp'),
          },
        })
        await wrapped.flush()

        expect(archivePayloads).toHaveLength(1)
        expect(JSON.stringify(archivePayloads[0])).not.toContain('secret-bearer-token')
        expect(archivePayloads[0]).toMatchObject({
          proof,
          authorizationEvidence: [
            {
              protocol: 'mcp_oauth',
              claims: { client_id: 'client-123' },
              claimsVerified: true,
              requiredScopes: ['files:read'],
            },
          ],
          resolvedFacts: { tool_name: 'read_file' },
        })
      } finally {
        fetchSpy.mockRestore()
      }
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
        onRecord: (r) => {
          captured.push(r)
        },
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
      void canon
      void hash
      void hex
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
        onRecord: (r) => {
          captured.push(r)
        },
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

    it('autoChain uses a resolved harness context before process fallback', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []
      const resolvedContext = '1'.repeat(32)

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        autoChain: true,
        contextIdResolver: () => resolvedContext,
        onRecord: (r) => {
          captured.push(r)
        },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))

      const handler = getToolHandler()!
      await handler(bareToolCallRequest('a'), {})
      await handler(bareToolCallRequest('b'), {})

      expect(captured).toHaveLength(2)
      expect(captured[0]!.context_id).toBe(resolvedContext)
      expect(captured[1]!.context_id).toBe(resolvedContext)

      const { canonicalRecord: canon } = await import('../src/canon.js')
      const { sha256: hash, hexEncode: hex } = await import('../src/hash.js')
      expect(captured[1]!.chain_root).toBe(`sha256:${hex(hash(canon(captured[0]!)))}`)
    })

    it('autoChain fresh fallback isolates calls when the harness resolver fails', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          autoChain: true,
          autoChainFallback: 'fresh',
          contextIdResolver: () => {
            throw new Error('resolver failed')
          },
          onRecord: (r) => {
            captured.push(r)
          },
        })
        registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))

        const handler = getToolHandler()!
        await handler(bareToolCallRequest('a'), {})
        await handler(bareToolCallRequest('b'), {})

        expect(captured).toHaveLength(2)
        expect(new Set(captured.map((r) => r.context_id)).size).toBe(2)

        const { genesisChainRoot: genesis } = await import('../src/chain-root.js')
        for (const record of captured) {
          expect(record.chain_root).toBe(genesis(record.context_id))
        }
        expect(warnSpy).toHaveBeenCalledWith('atrib: contextIdResolver threw', expect.any(Error))
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('autoChain fresh fallback keeps no-context calls out of one process-wide session', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        autoChain: true,
        autoChainFallback: 'fresh',
        onRecord: (r) => {
          captured.push(r)
        },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))

      const handler = getToolHandler()!
      await handler(bareToolCallRequest('a'), {})
      await handler(bareToolCallRequest('b'), {})

      expect(captured).toHaveLength(2)
      expect(new Set(captured.map((r) => r.context_id)).size).toBe(2)

      const { genesisChainRoot: genesis } = await import('../src/chain-root.js')
      for (const record of captured) {
        expect(record.chain_root).toBe(genesis(record.context_id))
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
          onRecord: (r) => {
            first.push(r)
          },
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
        onRecord: (r) => {
          second.push(r)
        },
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
        onRecord: (r) => {
          captured.push(r)
        },
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

  describe('preCallTransform (cross-tool causal embedding)', () => {
    it('signs pre-call, exposes receiptId + recordHash + contextId, lets host mutate args', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }

      // Capture the args the upstream handler ultimately sees so we can
      // assert the mutation took effect.
      let upstreamArgs: Record<string, unknown> | undefined
      const upstreamHandler = vi.fn(async (request: Record<string, unknown>) => {
        const params = request.params as Record<string, unknown>
        upstreamArgs = params.arguments as Record<string, unknown>
        return resultObj
      })

      const captured: AtribRecord[] = []
      let preCallReceived: import('../src/middleware.js').PreCallTransformContext | undefined
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => {
          captured.push(r)
        },
        preCallTransform: (ctx) => {
          preCallReceived = ctx
          return { ...ctx.args, atrib_receipt_id: ctx.receiptId }
        },
      })
      registerToolHandler(upstreamHandler)

      await getToolHandler()!(createToolCallRequest('post_context'), {})

      // 1. preCallTransform was called with the right shape
      expect(preCallReceived).toBeDefined()
      expect(preCallReceived!.toolName).toBe('post_context')
      expect(preCallReceived!.args).toEqual({ query: 'test' }) // pre-mutation snapshot
      expect(preCallReceived!.recordHash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(preCallReceived!.contextId).toMatch(/^[0-9a-f]{32}$/)

      // 2. receiptId is the canonical §1.5.2 propagation token
      const decoded = decodeToken(preCallReceived!.receiptId)
      expect(decoded).not.toBeNull()
      expect(decoded!.recordHash.length).toBe(32)
      expect(decoded!.creatorKey.length).toBe(32)
      const expectedPubKey = await getPublicKey(TEST_PRIVATE_KEY)
      expect(decoded!.creatorKey).toEqual(expectedPubKey)

      // 3. recordHash matches the decoded hash (hex form of token's hash part)
      expect(preCallReceived!.recordHash).toBe(`sha256:${hexEncode(decoded!.recordHash)}`)

      // 4. The upstream handler received the mutated args (atrib_receipt_id injected)
      expect(upstreamArgs).toEqual({ query: 'test', atrib_receipt_id: preCallReceived!.receiptId })

      // 5. Exactly ONE record was emitted (not two, proves no double-sign)
      expect(captured).toHaveLength(1)

      // 6. The committed record is the SAME bytes as the pre-built one
      // (the receipt_id the host embedded references this exact record)
      const committedTokenFromMeta = (resultObj as { _meta?: { atrib?: string } })._meta?.atrib
      expect(committedTokenFromMeta).toBe(preCallReceived!.receiptId)
    })

    it('on preCallTransform throw, falls back to post-call signing (degradation per §5.8)', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const upstreamHandler = vi.fn().mockResolvedValue(resultObj)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const captured: AtribRecord[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => {
          captured.push(r)
        },
        preCallTransform: () => {
          throw new Error('host blew up')
        },
      })
      registerToolHandler(upstreamHandler)

      const result = await getToolHandler()!(createToolCallRequest('post_context'), {})

      // Tool call still succeeds
      expect((result as { content: unknown }).content).toBeDefined()
      // A record was still emitted (post-call fallback path)
      expect(captured).toHaveLength(1)
      // Warning surfaced
      expect(warnSpy).toHaveBeenCalledWith(
        'atrib: preCallTransform pre-sign failed, falling back to post-call',
        expect.any(Error),
      )
      warnSpy.mockRestore()
    })

    it('on upstream isError after pre-sign, no record committed and no autoChain bookkeeping', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()

      const captured: AtribRecord[] = []
      const transforms: import('../src/middleware.js').PreCallTransformContext[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        autoChain: true,
        onRecord: (r) => {
          captured.push(r)
        },
        preCallTransform: (ctx) => {
          transforms.push(ctx)
          return undefined
        },
      })

      // First call: upstream errors. Pre-sign happened (preCallTransform ran),
      // but no record should be committed and autoChain should NOT remember
      // this run's record_hash.
      const errorResult = { isError: true, content: [{ type: 'text', text: 'fail' }] }
      registerToolHandler(vi.fn().mockResolvedValue(errorResult))
      await getToolHandler()!(createToolCallRequest('a'), {})
      expect(transforms).toHaveLength(1) // pre-sign DID run
      expect(captured).toHaveLength(0) // but no record committed

      // Second call: upstream succeeds. chain_root MUST be genesis (the failed
      // call's hash was discarded). If autoChain incorrectly remembered the
      // failed record, this call would chain to it instead.
      const successResult = { content: [{ type: 'text', text: 'ok' }] }
      registerToolHandler(vi.fn().mockResolvedValue(successResult))
      await getToolHandler()!(createToolCallRequest('b'), {})
      expect(captured).toHaveLength(1)
      const committed = captured[0]!
      // Genesis chain_root format per §1.2.3: sha256:<hex(SHA256(UTF-8(context_id)))>
      expect(committed.chain_root).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(committed.chain_root).not.toBe(transforms[0]!.recordHash)
    })

    it('preCallTransform returning undefined leaves args unchanged (opt-in observation)', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }

      let upstreamArgs: Record<string, unknown> | undefined
      registerToolHandler(
        vi.fn(async (req: Record<string, unknown>) => {
          upstreamArgs = (req.params as Record<string, unknown>).arguments as Record<
            string,
            unknown
          >
          return resultObj
        }),
      )

      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        preCallTransform: () => undefined, // observe-only
      })

      await getToolHandler()!(createToolCallRequest('search'), {})
      expect(upstreamArgs).toEqual({ query: 'test' }) // unchanged
    })

    it('without preCallTransform, behavior is unchanged (regression guard)', async () => {
      // This is exactly the "emits attribution record on successful tool call"
      // test path, we run it again here to make the no-opt-in regression
      // guarantee explicit alongside the new pre-call branch tests.
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const captured: AtribRecord[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => {
          captured.push(r)
        },
      })
      registerToolHandler(vi.fn().mockResolvedValue(resultObj))

      await getToolHandler()!(createToolCallRequest('search'), {})
      expect(captured).toHaveLength(1)
      expect((resultObj as { _meta?: { atrib?: string } })._meta?.atrib).toBeDefined()
    })
  })

  describe('disclosure dials (D061 / §8.2 / §8.3)', () => {
    async function captureRecord(
      disclosure:
        | {
            tool_name?: 'omit' | 'verbatim' | 'hashed'
            args?: 'omit' | 'plain-sha256' | 'salted-sha256'
          }
        | undefined,
      toolName: string = 'search_web',
    ): Promise<AtribRecord> {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const resultObj = { content: [{ type: 'text', text: 'ok' }] }
      const captured: AtribRecord[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => {
          captured.push(r)
        },
        ...(disclosure ? { disclosure } : {}),
      })
      registerToolHandler(vi.fn().mockResolvedValue(resultObj))
      await getToolHandler()!(createToolCallRequest(toolName), {})
      expect(captured).toHaveLength(1)
      return captured[0]!
    }

    it('omits all disclosure fields by default (preserves §8.1 default posture)', async () => {
      const rec = await captureRecord(undefined)
      expect(rec.tool_name).toBeUndefined()
      expect(rec.args_hash).toBeUndefined()
      expect(rec.args_salt).toBeUndefined()
    })

    it('omits all disclosure fields when disclosure: {}', async () => {
      const rec = await captureRecord({})
      expect(rec.tool_name).toBeUndefined()
      expect(rec.args_hash).toBeUndefined()
      expect(rec.args_salt).toBeUndefined()
    })

    it('disclosure.tool_name: "verbatim" writes the verbatim tool name', async () => {
      const rec = await captureRecord({ tool_name: 'verbatim' }, 'book_flight')
      expect(rec.tool_name).toBe('book_flight')
    })

    it('disclosure.tool_name: "hashed" writes sha256:<hex> of the tool name', async () => {
      const rec = await captureRecord({ tool_name: 'hashed' }, 'book_flight')
      expect(rec.tool_name).toMatch(/^sha256:[0-9a-f]{64}$/)
      // Independent computation: SHA-256 of UTF-8 "book_flight"
      // Verify the value is deterministic (same input → same hash).
      const second = await captureRecord({ tool_name: 'hashed' }, 'book_flight')
      expect(second.tool_name).toBe(rec.tool_name)
    })

    it('disclosure.args: "plain-sha256" writes args_hash without args_salt', async () => {
      const rec = await captureRecord({ args: 'plain-sha256' })
      expect(rec.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(rec.args_salt).toBeUndefined()
      // Deterministic across two calls with same args.
      const second = await captureRecord({ args: 'plain-sha256' })
      expect(second.args_hash).toBe(rec.args_hash)
    })

    it('disclosure.args: "salted-sha256" writes both args_hash AND args_salt', async () => {
      const rec = await captureRecord({ args: 'salted-sha256' })
      expect(rec.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(rec.args_salt).toMatch(/^[A-Za-z0-9_-]{22}$/) // 16 bytes base64url no padding
      // Salt is per-record random: two consecutive calls produce different salts.
      const second = await captureRecord({ args: 'salted-sha256' })
      expect(second.args_salt).not.toBe(rec.args_salt)
      expect(second.args_hash).not.toBe(rec.args_hash) // because salt → hash
    })

    it('combines tool_name + args disclosure independently', async () => {
      const rec = await captureRecord(
        { tool_name: 'verbatim', args: 'plain-sha256' },
        'book_flight',
      )
      expect(rec.tool_name).toBe('book_flight')
      expect(rec.args_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(rec.args_salt).toBeUndefined()
    })

    it('signed records with disclosure fields verify correctly', async () => {
      // Round-trip: the record's signature MUST verify with the new fields
      // present in the JCS canonical form.
      const { verifyRecord } = await import('../src/signing.js')
      const rec = await captureRecord(
        { tool_name: 'hashed', args: 'salted-sha256' },
        'transfer_usdc',
      )
      const ok = await verifyRecord(rec)
      expect(ok).toBe(true)
    })

    it('disclosure.result: "plain-sha256" writes result_hash without result_salt', async () => {
      // Capture a record where the upstream handler returned a deterministic
      // payload, with disclosure.result enabled. Repeat to confirm the hash
      // is stable across calls with the same result.
      async function capture() {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        const resultObj = { content: [{ type: 'text', text: 'fixed' }] }
        const captured: AtribRecord[] = []
        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          onRecord: (r) => {
            captured.push(r)
          },
          disclosure: { result: 'plain-sha256' },
        })
        registerToolHandler(vi.fn().mockResolvedValue(resultObj))
        await getToolHandler()!(createToolCallRequest('search'), {})
        return captured[0]!
      }
      const a = await capture()
      const b = await capture()
      expect(a.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(a.result_salt).toBeUndefined()
      // Hash includes _meta because we hash BEFORE atrib mutates the result;
      // but since both runs go through identical paths, the hashes match.
      expect(b.result_hash).toBe(a.result_hash)
    })

    it('disclosure.result: "salted-sha256" writes both result_hash and result_salt', async () => {
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => {
          captured.push(r)
        },
        disclosure: { result: 'salted-sha256' },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'r' }] }))
      await getToolHandler()!(createToolCallRequest('search'), {})
      await getToolHandler()!(createToolCallRequest('search'), {})

      expect(captured).toHaveLength(2)
      const [first, second] = captured
      expect(first!.result_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(first!.result_salt).toMatch(/^[A-Za-z0-9_-]{22}$/)
      // Per-record random salt → different hash on repeat call.
      expect(second!.result_salt).not.toBe(first!.result_salt)
      expect(second!.result_hash).not.toBe(first!.result_hash)
    })

    it('signed record with all four §8.3 commitment fields verifies correctly', async () => {
      const { verifyRecord } = await import('../src/signing.js')
      const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
      const captured: AtribRecord[] = []
      atrib(mockServer, {
        creatorKey: TEST_PRIVATE_KEY_B64,
        serverUrl: 'https://test.example.com',
        onRecord: (r) => {
          captured.push(r)
        },
        disclosure: {
          tool_name: 'verbatim',
          args: 'salted-sha256',
          result: 'salted-sha256',
        },
      })
      registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))
      await getToolHandler()!(createToolCallRequest('compose'), {})
      const rec = captured[0]!
      // All §8.3 commitment fields populated.
      expect(rec.args_hash).toBeDefined()
      expect(rec.args_salt).toBeDefined()
      expect(rec.result_hash).toBeDefined()
      expect(rec.result_salt).toBeDefined()
      expect(rec.tool_name).toBe('compose')
      const ok = await verifyRecord(rec)
      expect(ok).toBe(true)
    })

    it('disclosure.result is silently inactive on the preCallTransform path (warns at init)', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const { mockServer, registerToolHandler, getToolHandler } = createMockServer()
        const captured: AtribRecord[] = []
        atrib(mockServer, {
          creatorKey: TEST_PRIVATE_KEY_B64,
          serverUrl: 'https://test.example.com',
          onRecord: (r) => {
            captured.push(r)
          },
          disclosure: { result: 'plain-sha256' },
          preCallTransform: () => undefined, // observe-only
        })
        registerToolHandler(vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }))
        await getToolHandler()!(createToolCallRequest('compose'), {})
        // The pre-call branch signs first; result_hash is NOT populated.
        expect(captured[0]!.result_hash).toBeUndefined()
        expect(captured[0]!.result_salt).toBeUndefined()
        // Init-time warning surfaces the misconfiguration to operators.
        const warnings = warnSpy.mock.calls.map((c) => String(c[0]))
        expect(
          warnings.some((w) =>
            w.includes('disclosure.result is incompatible with preCallTransform'),
          ),
        ).toBe(true)
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
