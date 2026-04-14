/**
 * Tests for attributeVercelAiSdkMcp(), the helper that patches an
 * `@ai-sdk/mcp` MCPClient's `request` method so outbound `tools/call`s flow
 * through Atrib's interceptor.
 *
 * We can't import the real `@ai-sdk/mcp` package here because it pulls in
 * the entire `ai` SDK + transport infrastructure as a dependency, which
 * would inflate `@atrib/agent`'s test surface. Instead we construct a
 * minimal structural mock of an MCPClient with just the `request` method.
 * This mirrors the public shape we depend on (verified against
 * `@ai-sdk/mcp@1.0.35` `dist/index.mjs:1750`).
 *
 * Each test exercises one invariant from the adapter contract:
 *
 *   1. Non-tools/call requests pass through unchanged
 *   2. tools/call requests get _meta injected from interceptor.onBeforeToolCall
 *   3. Original args object is NOT mutated (caller's reference is preserved)
 *   4. Response flows through interceptor.onAfterToolResponse with the raw
 *      CallToolResult including its _meta
 *   5. Idempotency: second helper call is a no-op
 *   6. §5.8 degradation: interceptor failures don't break the request
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { atrib as createInterceptor } from '../src/middleware.js'
import {
  attributeVercelAiSdkMcp,
  type VercelAiSdkMcpClientLike,
} from '../src/adapters/vercel-ai-sdk-mcp.js'
import { base64urlEncode } from '@atrib/mcp'

const AGENT_KEY = base64urlEncode(new Uint8Array(32).fill(33))

/**
 * Build a fake @ai-sdk/mcp MCPClient. The real client's `request` method
 * has signature:
 *   request({ request: { method, params }, resultSchema, options }): Promise<unknown>
 *
 * Our mock records every invocation so the test can assert on what was
 * forwarded, then returns whatever the test specifies.
 */
function makeFakeClient(opts: {
  responses?: Map<string, unknown>
  defaultResponse?: unknown
}): VercelAiSdkMcpClientLike & {
  invocations: Array<{
    method: string
    params: Record<string, unknown> | undefined
  }>
} {
  const invocations: Array<{
    method: string
    params: Record<string, unknown> | undefined
  }> = []
  const responses = opts.responses ?? new Map()
  const defaultResponse = opts.defaultResponse ?? {
    content: [{ type: 'text', text: 'ok' }],
  }
  return {
    invocations,
    async request(args) {
      invocations.push({
        method: args.request.method,
        params: args.request.params,
      })
      const toolName =
        args.request.method === 'tools/call'
          ? ((args.request.params?.name as string) ?? '')
          : args.request.method
      return responses.get(toolName) ?? defaultResponse
    },
  }
}

describe('attributeVercelAiSdkMcp', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{"logIndex":1}', { status: 200 }),
    )
  })

  it('forwards non-tools/call requests unchanged (no _meta injection)', async () => {
    const client = makeFakeClient({
      defaultResponse: { tools: [] },
    })
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    attributeVercelAiSdkMcp(client, { interceptor })

    await client.request({
      request: { method: 'tools/list', params: {} },
    })

    expect(client.invocations.length).toBe(1)
    expect(client.invocations[0]!.method).toBe('tools/list')
    // No _meta injected on non-tools/call methods
    expect(client.invocations[0]!.params?._meta).toBeUndefined()

    await interceptor.flush()
  })

  it('injects _meta from the interceptor on tools/call requests', async () => {
    const client = makeFakeClient({
      responses: new Map([
        [
          'search',
          {
            content: [{ type: 'text', text: 'matched 5' }],
          },
        ],
      ]),
    })
    const interceptor = createInterceptor({
      creatorKey: AGENT_KEY,
      sessionToken: 'vercel-test-session',
    })

    attributeVercelAiSdkMcp(client, {
      interceptor,
      serverUrl: 'https://search.example.com',
    })

    const result = (await client.request({
      request: {
        method: 'tools/call',
        params: { name: 'search', arguments: { query: 'foo' } },
      },
    })) as { content: unknown }

    // The fake upstream's response is preserved
    expect(result.content).toEqual([{ type: 'text', text: 'matched 5' }])

    // The forwarded request had _meta injected
    expect(client.invocations.length).toBe(1)
    const sentParams = client.invocations[0]!.params!
    expect(sentParams._meta).toBeDefined()
    const sentMeta = sentParams._meta as Record<string, unknown>
    // traceparent is the always-set W3C field on the first call of a session
    // (we assert on traceparent rather than `atrib` because the atrib token
    // is only set on the second+ call when chaining from a prior response,
    // see packages/agent/src/session.ts buildOutboundMeta lines 117-122)
    expect(typeof sentMeta.traceparent).toBe('string')
    expect(sentMeta.traceparent as string).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    // Original tool params (name, arguments) are still there
    expect(sentParams.name).toBe('search')
    expect(sentParams.arguments).toEqual({ query: 'foo' })

    await interceptor.flush()
  })

  it('does not mutate the caller-supplied args object', async () => {
    const client = makeFakeClient({})
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    attributeVercelAiSdkMcp(client, { interceptor })

    const callerArgs = {
      request: {
        method: 'tools/call',
        params: { name: 'noop', arguments: {} },
      },
    }
    const callerParamsRef = callerArgs.request.params
    await client.request(callerArgs)

    // The caller's params object should NOT have been mutated to add _meta
    expect((callerParamsRef as Record<string, unknown>)._meta).toBeUndefined()
    // The forwarded request DID get _meta (asserted via the fake's recording)
    expect(client.invocations[0]!.params?._meta).toBeDefined()

    await interceptor.flush()
  })

  it('flows the response through onAfterToolResponse with raw _meta', async () => {
    // Server returns a result with its own _meta containing an atrib token
    // (simulating the Atrib server-side middleware response). The interceptor
    // should see that token unmodified.
    const serverAtribToken = 'fake.token.from.server'
    const client = makeFakeClient({
      responses: new Map([
        [
          'doit',
          {
            content: [{ type: 'text', text: 'done' }],
            _meta: { atrib: serverAtribToken },
          },
        ],
      ]),
    })
    const interceptor = createInterceptor({
      creatorKey: AGENT_KEY,
      sessionToken: 'response-test',
    })

    // Spy on onAfterToolResponse to verify the interceptor sees the right
    // response meta
    const original = interceptor.onAfterToolResponse.bind(interceptor)
    const spy = vi.fn().mockImplementation((toolName, response, responseMeta, callOptions) => {
      return original(toolName, response, responseMeta, callOptions)
    })
    interceptor.onAfterToolResponse = spy

    attributeVercelAiSdkMcp(client, {
      interceptor,
      serverUrl: 'https://doit.example.com',
    })

    await client.request({
      request: { method: 'tools/call', params: { name: 'doit', arguments: {} } },
    })

    expect(spy).toHaveBeenCalledTimes(1)
    const [toolName, _response, responseMeta, callOptions] = spy.mock.calls[0]!
    expect(toolName).toBe('doit')
    expect(responseMeta).toEqual({ atrib: serverAtribToken })
    expect(callOptions).toEqual({ serverUrl: 'https://doit.example.com' })

    await interceptor.flush()
  })

  it('is idempotent, second call to the helper is a no-op', async () => {
    const client = makeFakeClient({})
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    attributeVercelAiSdkMcp(client, { interceptor })
    const requestAfterFirst = client.request

    attributeVercelAiSdkMcp(client, { interceptor })
    const requestAfterSecond = client.request

    // Second call did not re-wrap (request method reference is unchanged)
    expect(requestAfterSecond).toBe(requestAfterFirst)

    await interceptor.flush()
  })

  it('§5.8: onBeforeToolCall failure does not break the request', async () => {
    const client = makeFakeClient({})
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    // Force the interceptor to throw on onBeforeToolCall
    interceptor.onBeforeToolCall = vi.fn().mockRejectedValue(new Error('interceptor blew up'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    attributeVercelAiSdkMcp(client, { interceptor })

    const result = (await client.request({
      request: {
        method: 'tools/call',
        params: { name: 'echo', arguments: {} },
      },
    })) as { content: unknown }

    // Tool call still succeeds (returns the fake's default response)
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])

    // The forwarded request had NO _meta injected (interceptor failure
    // caused passthrough)
    expect(client.invocations[0]!.params?._meta).toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onBeforeToolCall failed'),
      expect.any(Error),
    )

    warnSpy.mockRestore()
  })
})
