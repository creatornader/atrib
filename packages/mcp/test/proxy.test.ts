/**
 * Tests for createAtribProxy(). the in-process McpServer that forwards
 * tool calls to an upstream MCP server with attribution applied at the
 * proxy layer.
 *
 * Uses InMemoryTransport.createLinkedPair() to construct a real upstream
 * McpServer + Client pair entirely in-process, with no child processes or
 * network calls. The proxy connects to the upstream via the
 * `{ type: 'inMemory', transport }` escape hatch, which bypasses the
 * stdio/http transport constructors.
 *
 * Each test exercises one invariant from the proxy contract:
 *
 *   1. Tools/list is the upstream's snapshot
 *   2. Tools/call is forwarded to the upstream and the response is unchanged
 *   3. atrib() middleware fires on the proxy side. a record is submitted
 *      and the proxy's response carries the outbound `_meta.atrib` token
 *   4. §5.8 degradation: if the upstream throws, the proxy returns a
 *      tool error and atrib's submission queue does NOT see a record
 *      (records are only emitted for successful calls per §5.3.3)
 *   5. close() disconnects the upstream client cleanly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createAtribProxy } from '../src/proxy.js'
import { base64urlEncode } from '../src/base64url.js'

const PROXY_KEY = base64urlEncode(new Uint8Array(32).fill(7))
const PROXY_URL = 'https://proxy.example.com'

/**
 * Build a real upstream McpServer + a paired in-process Transport that the
 * proxy can use as its `inMemory` upstream.
 *
 * We register tools via the low-level `setRequestHandler` API rather than
 * `McpServer.tool()` because the deprecated single-arg `tool(name, cb)` form
 * drops the `args` parameter entirely (the callback signature becomes
 * `(extra) => result` per `ToolCallback<undefined>`). Going low-level lets
 * the test handler see `request.params.arguments` so we can verify forwarding
 * preserves them.
 */
async function makeUpstream(opts: {
  tools: Array<{
    name: string
    inputSchema?: Record<string, unknown>
    handler: (args: Record<string, unknown>) => Promise<{ content: unknown[]; isError?: boolean }>
  }>
}) {
  const upstream = new McpServer(
    { name: 'fake-upstream', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const underlying = (upstream as any).server

  underlying.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      inputSchema: t.inputSchema ?? { type: 'object' },
    })),
  }))

  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const tool = opts.tools.find((t) => t.name === req.params.name)
      if (!tool) {
        return {
          isError: true,
          content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
        }
      }
      return await tool.handler(req.params.arguments ?? {})
    },
  )

  const [proxySideTransport, upstreamSideTransport] = InMemoryTransport.createLinkedPair()
  await upstream.connect(upstreamSideTransport)

  return { upstream, proxySideTransport }
}

describe('createAtribProxy', () => {
  // Spec §2.6.1: the POST body is a bare signed attribution record.
  // Earlier versions of this test wrapped the body in a `.record` field
  // to match the (incorrect) wire format the submission queue used.
  let submissions: Array<{ event_type?: string; content_id?: string }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any

  beforeEach(() => {
    submissions = []
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(async (_url: any, init: any) => {
        const body = JSON.parse(init?.body as string)
        submissions.push(body)
        return new Response(
          JSON.stringify({
            log_index: submissions.length,
            checkpoint: `log.test/v1\n${submissions.length + 1}\nrootHashBase64\n`,
            inclusion_proof: [],
            leaf_hash: 'leafHashBase64',
          }),
          { status: 200 },
        )
      })
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('forwards tools/list from the upstream', async () => {
    const { proxySideTransport } = await makeUpstream({
      tools: [
        {
          name: 'echo',
          handler: async () => ({ content: [{ type: 'text', text: 'hi' }] }),
        },
      ],
    })

    const proxy = await createAtribProxy({
      name: 'echo-proxy',
      upstream: { type: 'inMemory', transport: proxySideTransport },
      atrib: { creatorKey: PROXY_KEY, serverUrl: PROXY_URL },
    })

    // Connect a host-side Client to the proxy's local server to drive
    // tools/list through the wire format.
    const hostClient = new Client({ name: 'host', version: '1.0.0' })
    const [hostTransport, proxyHostTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([proxy.server.connect(proxyHostTransport), hostClient.connect(hostTransport)])

    const tools = await hostClient.listTools()
    expect(tools.tools.map((t) => t.name)).toContain('echo')

    await hostClient.close()
    await proxy.close()
  })

  it('forwards tools/call to the upstream and returns its response unchanged', async () => {
    const { proxySideTransport } = await makeUpstream({
      tools: [
        {
          name: 'echo',
          handler: async (args) => ({
            content: [{ type: 'text', text: `echo:${(args.message as string) ?? ''}` }],
          }),
        },
      ],
    })

    const proxy = await createAtribProxy({
      name: 'echo-proxy',
      upstream: { type: 'inMemory', transport: proxySideTransport },
      atrib: { creatorKey: PROXY_KEY, serverUrl: PROXY_URL },
    })

    const hostClient = new Client({ name: 'host', version: '1.0.0' })
    const [hostTransport, proxyHostTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([proxy.server.connect(proxyHostTransport), hostClient.connect(hostTransport)])

    const result = await hostClient.callTool({
      name: 'echo',
      arguments: { message: 'hello' },
    })

    expect(result.content).toEqual([{ type: 'text', text: 'echo:hello' }])

    await hostClient.close()
    await proxy.close()
  })

  it('emits an attribution record on the proxy side for forwarded calls', async () => {
    const { proxySideTransport } = await makeUpstream({
      tools: [
        {
          name: 'compute',
          handler: async () => ({ content: [{ type: 'text', text: '42' }] }),
        },
      ],
    })

    const proxy = await createAtribProxy({
      name: 'compute-proxy',
      upstream: { type: 'inMemory', transport: proxySideTransport },
      atrib: { creatorKey: PROXY_KEY, serverUrl: PROXY_URL },
    })

    const hostClient = new Client({ name: 'host', version: '1.0.0' })
    const [hostTransport, proxyHostTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([proxy.server.connect(proxyHostTransport), hostClient.connect(hostTransport)])

    const result = await hostClient.callTool({
      name: 'compute',
      arguments: {},
    })

    // Tool result is preserved
    expect(result.content).toEqual([{ type: 'text', text: '42' }])

    // Outbound _meta.atrib token is present (the proxy is the attributing
    // party here)
    expect(result._meta).toBeDefined()
    expect(result._meta?.atrib).toBeDefined()
    expect(typeof result._meta?.atrib).toBe('string')

    // Drain the proxy's submission queue
    await proxy.server.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // At least one record was submitted to the mocked log endpoint.
    // Spec §2.6.1: each `submissions` entry IS the bare record.
    expect(submissions.length).toBeGreaterThanOrEqual(1)

    // It's a tool_call (not a transaction. 'compute' is not in transactionTools)
    expect(submissions[0]!.event_type).toBe('https://atrib.dev/v1/types/tool_call')
    // content_id is derived from PROXY_URL + 'compute'
    expect(submissions[0]!.content_id).toMatch(/^sha256:[0-9a-f]{64}$/)

    await hostClient.close()
    await proxy.close()
  })

  it('§5.8 degradation: upstream tool errors propagate without crashing the proxy', async () => {
    const { proxySideTransport } = await makeUpstream({
      tools: [
        {
          name: 'broken',
          // The MCP convention for a tool-level error is { isError: true, content: [...] }
          handler: async () => ({
            isError: true,
            content: [{ type: 'text', text: 'upstream blew up' }],
          }),
        },
      ],
    })

    const proxy = await createAtribProxy({
      name: 'err-proxy',
      upstream: { type: 'inMemory', transport: proxySideTransport },
      atrib: { creatorKey: PROXY_KEY, serverUrl: PROXY_URL },
    })

    const hostClient = new Client({ name: 'host', version: '1.0.0' })
    const [hostTransport, proxyHostTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([proxy.server.connect(proxyHostTransport), hostClient.connect(hostTransport)])

    const result = await hostClient.callTool({
      name: 'broken',
      arguments: {},
    })

    // Error is surfaced to the host unchanged
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'upstream blew up' }])

    // Per §5.3.3, no record is emitted for isError: true responses.
    await proxy.server.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(submissions.length).toBe(0)

    await hostClient.close()
    await proxy.close()
  })

  it('preCallTransform option flows through createAtribProxy and mutates upstream args', async () => {
    // Loop 5 / D057: cross-tool causal embedding. The middleware's preCallTransform
    // hook is exposed at the bare atrib() entry point; this test confirms it
    // also works at the createAtribProxy entry point so wrapper authors can
    // rely on it without reaching past the proxy abstraction.
    let upstreamSawArgs: Record<string, unknown> | undefined
    const { proxySideTransport } = await makeUpstream({
      tools: [
        {
          name: 'post_context',
          handler: async (args) => {
            upstreamSawArgs = args
            return { content: [{ type: 'text', text: 'ok' }] }
          },
        },
      ],
    })

    let preCallContext: import('../src/middleware.js').PreCallTransformContext | undefined
    const proxy = await createAtribProxy({
      name: 'pre-call-proxy',
      upstream: { type: 'inMemory', transport: proxySideTransport },
      atrib: {
        creatorKey: PROXY_KEY,
        serverUrl: PROXY_URL,
        preCallTransform: (ctx) => {
          preCallContext = ctx
          return { ...ctx.args, atrib_receipt_id: ctx.receiptId }
        },
      },
    })

    const hostClient = new Client({ name: 'host', version: '1.0.0' })
    const [hostTransport, proxyHostTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([proxy.server.connect(proxyHostTransport), hostClient.connect(hostTransport)])

    const result = await hostClient.callTool({
      name: 'post_context',
      arguments: { source: 'test', content: 'x' },
    })

    // preCallTransform fired with the right shape
    expect(preCallContext).toBeDefined()
    expect(preCallContext!.toolName).toBe('post_context')
    expect(preCallContext!.recordHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(preCallContext!.contextId).toMatch(/^[0-9a-f]{32}$/)
    // §1.5.2 token format: 43 base64url chars, dot, 43 base64url chars
    expect(preCallContext!.receiptId).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/)

    // Upstream saw the mutated args (atrib_receipt_id injected by the host)
    expect(upstreamSawArgs).toEqual({
      source: 'test',
      content: 'x',
      atrib_receipt_id: preCallContext!.receiptId,
    })

    // Tool result still flows back unchanged
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }])

    // Outbound _meta.atrib token equals the pre-call receiptId (no double-sign)
    expect(result._meta?.atrib).toBe(preCallContext!.receiptId)

    // Exactly one record submitted (the pre-built one, not a duplicate)
    await proxy.server.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(submissions.length).toBe(1)

    await hostClient.close()
    await proxy.close()
  })

  it('close() disconnects the upstream client cleanly', async () => {
    const { proxySideTransport } = await makeUpstream({
      tools: [{ name: 'noop', handler: async () => ({ content: [] }) }],
    })

    const proxy = await createAtribProxy({
      name: 'noop-proxy',
      upstream: { type: 'inMemory', transport: proxySideTransport },
      atrib: { creatorKey: PROXY_KEY, serverUrl: PROXY_URL },
    })

    await proxy.close()
    await expect(proxy.close()).resolves.toBeUndefined()
  })
})
