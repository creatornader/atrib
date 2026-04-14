/**
 * Tests for attributeLangchainMcp(), the helper that patches a LangChain
 * `MultiServerMCPClient`'s internal Client instances so outbound tools/call
 * requests flow through Atrib's interceptor.
 *
 * We can't import the real `@langchain/mcp-adapters` package here, it pulls
 * in the entire LangChain runtime (langgraph, core messages, zod, etc.) as
 * a dependency, which would inflate `@atrib/agent`'s test surface by an
 * order of magnitude. Instead we construct a minimal structural mock of a
 * MultiServerMCPClient with just the `config` getter and `getClient` method,
 * plus a mock LangChain-extended Client with `callTool` and optional `fork`.
 * This mirrors the public shape we depend on (verified against
 * `@langchain/mcp-adapters@1.1.3` `dist/client.d.ts` and `dist/tools.d.ts`).
 *
 * Each test exercises one invariant from the adapter contract:
 *
 *   1. Walks the multi-client's config and patches every configured server
 *   2. Returns the count of newly-patched clients
 *   3. Is idempotent on second call (returns 0)
 *   4. Injects _meta from interceptor on tools/call
 *   5. Does not mutate the caller-supplied params object
 *   6. Flows responses through onAfterToolResponse with raw _meta
 *   7. Fork propagation: forked clients are recursively patched so per-call
 *      header changes don't silently lose attribution
 *   8. §5.8 degradation: onBeforeToolCall failure does not break the call
 *   9. Skips servers whose getClient returns undefined (not initialized)
 *  10. Selective server patching via the `servers` option
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { atrib as createInterceptor } from '../src/middleware.js'
import {
  attributeLangchainMcp,
  type LangchainMcpClientLike,
  type LangchainMultiServerMcpClientLike,
} from '../src/adapters/langchain-mcp.js'
import { base64urlEncode } from '@atrib/mcp'

const AGENT_KEY = base64urlEncode(new Uint8Array(32).fill(44))

/**
 * Build a fake LangChain-extended MCP Client. Records every callTool
 * invocation and optionally every fork invocation so tests can assert on
 * what was forwarded.
 */
function makeFakeClient(opts: {
  responses?: Map<string, unknown>
  defaultResponse?: unknown
  withFork?: boolean
}): LangchainMcpClientLike & {
  invocations: Array<{
    name: string
    arguments?: Record<string, unknown>
    _meta?: Record<string, unknown>
  }>
  forks: Array<Record<string, string>>
} {
  const invocations: Array<{
    name: string
    arguments?: Record<string, unknown>
    _meta?: Record<string, unknown>
  }> = []
  const forks: Array<Record<string, string>> = []
  const responses = opts.responses ?? new Map()
  const defaultResponse = opts.defaultResponse ?? {
    content: [{ type: 'text', text: 'ok' }],
  }

  const client: LangchainMcpClientLike & {
    invocations: typeof invocations
    forks: typeof forks
  } = {
    invocations,
    forks,
    async callTool(params) {
      invocations.push({
        name: params.name,
        ...(params.arguments !== undefined ? { arguments: params.arguments } : {}),
        ...(params._meta !== undefined ? { _meta: params._meta } : {}),
      })
      return responses.get(params.name) ?? defaultResponse
    },
  }

  if (opts.withFork) {
    client.fork = async (headers: Record<string, string>) => {
      forks.push(headers)
      // A forked client is a fresh instance with its own state. It shares
      // the invocations/forks arrays so the test can assert cross-instance.
      const forked: LangchainMcpClientLike & {
        invocations: typeof invocations
        forks: typeof forks
      } = {
        invocations,
        forks,
        async callTool(params) {
          invocations.push({
            name: params.name,
            ...(params.arguments !== undefined ? { arguments: params.arguments } : {}),
            ...(params._meta !== undefined ? { _meta: params._meta } : {}),
          })
          return responses.get(params.name) ?? defaultResponse
        },
      }
      return forked
    }
  }

  return client
}

/**
 * Build a fake MultiServerMCPClient with the given set of named servers.
 * Each server maps to its own fake Client constructed via `makeFakeClient`.
 */
function makeFakeMultiClient(
  servers: Record<string, LangchainMcpClientLike>,
): LangchainMultiServerMcpClientLike {
  return {
    get config() {
      return {
        mcpServers: Object.fromEntries(
          Object.keys(servers).map((name) => [
            name,
            { transport: 'http', url: `https://${name}.example.com/mcp` },
          ]),
        ),
      }
    },
    async getClient(serverName) {
      return servers[serverName]
    },
  }
}

describe('attributeLangchainMcp', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{"logIndex":1}', { status: 200 }),
    )
  })

  it('patches every configured server by default and returns count', async () => {
    const searchClient = makeFakeClient({})
    const shopClient = makeFakeClient({})
    const multi = makeFakeMultiClient({ search: searchClient, shop: shopClient })
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    const patched = await attributeLangchainMcp(multi, { interceptor })

    expect(patched).toBe(2)
    await interceptor.flush()
  })

  it('is idempotent, second call returns 0 and does not re-wrap', async () => {
    const searchClient = makeFakeClient({})
    const multi = makeFakeMultiClient({ search: searchClient })
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    const first = await attributeLangchainMcp(multi, { interceptor })
    const callToolAfterFirst = (searchClient as LangchainMcpClientLike).callTool

    const second = await attributeLangchainMcp(multi, { interceptor })
    const callToolAfterSecond = (searchClient as LangchainMcpClientLike).callTool

    expect(first).toBe(1)
    expect(second).toBe(0)
    expect(callToolAfterSecond).toBe(callToolAfterFirst)

    await interceptor.flush()
  })

  it('injects _meta from the interceptor on tools/call', async () => {
    const searchClient = makeFakeClient({
      responses: new Map([['search', { content: [{ type: 'text', text: 'matched 3' }] }]]),
    })
    const multi = makeFakeMultiClient({ search: searchClient })
    const interceptor = createInterceptor({
      creatorKey: AGENT_KEY,
      sessionToken: 'langchain-test-session',
    })

    await attributeLangchainMcp(multi, {
      interceptor,
      serverUrls: { search: 'https://search.example.com' },
    })

    const result = (await searchClient.callTool({
      name: 'search',
      arguments: { query: 'foo' },
    })) as { content: unknown }

    expect(result.content).toEqual([{ type: 'text', text: 'matched 3' }])

    const fakeWithInvocations = searchClient as LangchainMcpClientLike & {
      invocations: Array<{ _meta?: Record<string, unknown> }>
    }
    expect(fakeWithInvocations.invocations.length).toBe(1)
    const sentMeta = fakeWithInvocations.invocations[0]!._meta
    expect(sentMeta).toBeDefined()
    // traceparent is always set on the first call; the atrib token only
    // shows up on 2nd+ calls when chaining from a prior response.
    expect(typeof sentMeta!.traceparent).toBe('string')
    expect(sentMeta!.traceparent as string).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)

    await interceptor.flush()
  })

  it('does not mutate the caller-supplied params object', async () => {
    const searchClient = makeFakeClient({})
    const multi = makeFakeMultiClient({ search: searchClient })
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    await attributeLangchainMcp(multi, { interceptor })

    const callerParams = { name: 'noop', arguments: { q: 'hi' } }
    await searchClient.callTool(callerParams)

    expect((callerParams as Record<string, unknown>)._meta).toBeUndefined()
    const recorded = (
      searchClient as LangchainMcpClientLike & {
        invocations: Array<{ _meta?: Record<string, unknown> }>
      }
    ).invocations[0]!._meta
    expect(recorded).toBeDefined()

    await interceptor.flush()
  })

  it('flows the response through onAfterToolResponse with raw _meta', async () => {
    const serverAtribToken = 'fake.token.from.server'
    const doitClient = makeFakeClient({
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
    const multi = makeFakeMultiClient({ doit: doitClient })
    const interceptor = createInterceptor({
      creatorKey: AGENT_KEY,
      sessionToken: 'langchain-response-test',
    })

    const original = interceptor.onAfterToolResponse.bind(interceptor)
    const spy = vi.fn().mockImplementation((toolName, response, responseMeta, callOptions) => {
      return original(toolName, response, responseMeta, callOptions)
    })
    interceptor.onAfterToolResponse = spy

    await attributeLangchainMcp(multi, {
      interceptor,
      serverUrls: { doit: 'https://doit.example.com' },
    })

    await doitClient.callTool({ name: 'doit', arguments: {} })

    expect(spy).toHaveBeenCalledTimes(1)
    const [toolName, , responseMeta, callOptions] = spy.mock.calls[0]!
    expect(toolName).toBe('doit')
    expect(responseMeta).toEqual({ atrib: serverAtribToken })
    expect(callOptions).toEqual({ serverUrl: 'https://doit.example.com', isError: false })

    await interceptor.flush()
  })

  it('fork propagation: forked clients are recursively patched', async () => {
    const client = makeFakeClient({ withFork: true })
    const multi = makeFakeMultiClient({ search: client })
    const interceptor = createInterceptor({
      creatorKey: AGENT_KEY,
      sessionToken: 'fork-test',
    })

    await attributeLangchainMcp(multi, {
      interceptor,
      serverUrls: { search: 'https://search.example.com' },
    })

    // Simulate LangChain's _callTool fork path: user tool sets custom
    // headers, LangChain calls client.fork(headers), then calls callTool on
    // the forked instance.
    const forkedClient = await client.fork!({ 'X-User-Id': 'u123' })
    await forkedClient.callTool({ name: 'search', arguments: { query: 'foo' } })

    // The forked client's invocation should ALSO have had _meta injected,
    // proving the recursive patch worked.
    const recorded = client as LangchainMcpClientLike & {
      invocations: Array<{ _meta?: Record<string, unknown> }>
      forks: Array<Record<string, string>>
    }
    expect(recorded.forks).toEqual([{ 'X-User-Id': 'u123' }])
    expect(recorded.invocations.length).toBe(1)
    expect(recorded.invocations[0]!._meta).toBeDefined()
    expect(typeof recorded.invocations[0]!._meta!.traceparent).toBe('string')

    await interceptor.flush()
  })

  it('§5.8: onBeforeToolCall failure does not break the call', async () => {
    const searchClient = makeFakeClient({})
    const multi = makeFakeMultiClient({ search: searchClient })
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    interceptor.onBeforeToolCall = vi.fn().mockRejectedValue(new Error('interceptor blew up'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await attributeLangchainMcp(multi, { interceptor })

    const result = (await searchClient.callTool({
      name: 'echo',
      arguments: {},
    })) as { content: unknown }

    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])

    // The forwarded request had NO _meta injected (interceptor failure → passthrough)
    const recorded = (
      searchClient as LangchainMcpClientLike & {
        invocations: Array<{ _meta?: Record<string, unknown> }>
      }
    ).invocations[0]!
    expect(recorded._meta).toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('onBeforeToolCall failed'),
      expect.any(Error),
    )

    warnSpy.mockRestore()
  })

  it('skips servers whose getClient returns undefined', async () => {
    const multi: LangchainMultiServerMcpClientLike = {
      get config() {
        return { mcpServers: { search: {}, missing: {} } }
      },
      async getClient(name) {
        if (name === 'search') return makeFakeClient({})
        return undefined
      },
    }
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const patched = await attributeLangchainMcp(multi, { interceptor })

    expect(patched).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("server 'missing' has no client"))

    warnSpy.mockRestore()
    await interceptor.flush()
  })

  it('patches only the servers listed in options.servers when provided', async () => {
    const searchClient = makeFakeClient({})
    const shopClient = makeFakeClient({})
    const multi = makeFakeMultiClient({ search: searchClient, shop: shopClient })
    const interceptor = createInterceptor({ creatorKey: AGENT_KEY })

    const patched = await attributeLangchainMcp(multi, {
      interceptor,
      servers: ['search'],
    })

    expect(patched).toBe(1)

    // search was patched: calling it records a _meta
    await searchClient.callTool({ name: 'x', arguments: {} })
    const searchRec = (
      searchClient as LangchainMcpClientLike & {
        invocations: Array<{ _meta?: Record<string, unknown> }>
      }
    ).invocations[0]!
    expect(searchRec._meta).toBeDefined()

    // shop was NOT patched: calling it does not inject _meta
    await shopClient.callTool({ name: 'y', arguments: {} })
    const shopRec = (
      shopClient as LangchainMcpClientLike & {
        invocations: Array<{ _meta?: Record<string, unknown> }>
      }
    ).invocations[0]!
    expect(shopRec._meta).toBeUndefined()

    await interceptor.flush()
  })
})
