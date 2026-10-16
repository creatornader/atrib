// SPDX-License-Identifier: Apache-2.0

import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { loadMcpTools, MultiServerMCPClient } from '@langchain/mcp-adapters'
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
  entrypoint,
  getStore,
  InMemoryStore,
  interrupt,
} from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { atrib, attributeLangchainMcp } from '@atrib/agent'
import { base64urlEncode, canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import { attributeLangGraphStore } from '../src/langgraph-store-attribution.js'

const close: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of close.splice(0).reverse()) await cleanup()
})

async function mcpFixture(forkedHeaders = true) {
  const calls: Array<{
    name: string
    args: unknown
    meta: Record<string, unknown> | undefined
    tenant: string | undefined
  }> = []
  let tenant = 'alice'
  const http = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const server = new Server(
      { name: 'langchain-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: ['weather', 'explode'].map((name) => ({
        name,
        description: name,
        inputSchema: {
          type: 'object' as const,
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      })),
    }))
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls.push({
        name: request.params.name,
        args: request.params.arguments,
        meta: request.params._meta,
        tenant: req.headers['x-tenant'] as string | undefined,
      })
      return {
        content: [
          {
            type: 'text',
            text:
              request.params.name === 'explode'
                ? 'fixture backend denied'
                : `clear in ${request.params.arguments?.city}`,
          },
        ],
        ...(request.params.name === 'explode' ? { isError: true } : {}),
      }
    })
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    res.on('close', () => {
      void server.close()
    })
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      // MCP 1.x transport callback optionality differs from its server interface.
      await server.connect(transport as Parameters<Server['connect']>[0])
      await transport.handleRequest(req, res, JSON.parse(Buffer.concat(chunks).toString()))
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error))
    }
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  close.push(async () => {
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  })
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/mcp`
  const multi = new MultiServerMCPClient({
    beforeToolCall: () => (forkedHeaders ? { headers: { 'x-tenant': tenant } } : {}),
    mcpServers: {
      local: {
        transport: 'http',
        url,
      },
    },
  })
  close.push(() => multi.close())
  const tools = await multi.getTools()
  const weather = tools.find((tool) => tool.name.endsWith('weather'))!
  const explode = tools.find((tool) => tool.name.endsWith('explode'))!
  expect(weather).toBeDefined()
  expect(explode).toBeDefined()
  const interceptor = atrib({
    creatorKey: base64urlEncode(new Uint8Array(32).fill(22)),
    detectTransaction: [],
  })
  close.push(() => interceptor.flush())
  return {
    calls,
    multi,
    tools,
    weather,
    explode,
    interceptor,
    setTenant(value: string) {
      tenant = value
    },
    loadTools(
      serverName: string,
      client: NonNullable<Awaited<ReturnType<typeof multi.getClient>>>,
    ) {
      return loadMcpTools(serverName, client, {
        beforeToolCall: () => (forkedHeaders ? { headers: { 'x-tenant': tenant } } : {}),
      })
    },
  }
}

describe('installed LangChain core and LangGraph compatibility', () => {
  it('attributes cached base-client tools and reports an unreplaceable fork once', async () => {
    const f = await mcpFixture(false)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await attributeLangchainMcp(f.multi, { interceptor: f.interceptor })).toBe(1)
      expect(await attributeLangchainMcp(f.multi, { interceptor: f.interceptor })).toBe(0)
      await f.weather.invoke({ city: 'Austin' })
      expect(f.calls[0]!.meta?.['X-atrib-Context']).toMatch(/^[0-9a-f]{32}$/)
      expect(warning).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('loadMcpTools with wrapMcpClient'),
      )
    } finally {
      warning.mockRestore()
    }
  })

  it('preserves cached native tools and attribution through header forks', async () => {
    const f = await mcpFixture()
    const baseline = await f.weather.invoke({ city: 'Austin' })
    expect(f.calls[0]!.meta?.['X-atrib-Context']).toBeUndefined()
    expect(
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
    ).toBe(1)
    expect(
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
    ).toBe(0)
    const tools = f.tools
    const weather = tools.find((tool) => tool.name.endsWith('weather'))!
    const after = vi.spyOn(f.interceptor, 'onAfterToolResponse')
    expect(await weather.invoke({ city: 'Austin' })).toEqual(baseline)
    f.setTenant('bob')
    expect(await weather.invoke({ city: 'Boston' })).toBeDefined()
    expect(f.calls.map((call) => call.tenant)).toEqual(['alice', 'alice', 'bob'])
    for (const call of f.calls.slice(1)) {
      expect(call.meta?.['X-atrib-Context']).toMatch(/^[0-9a-f]{32}$/)
      expect(call.meta?.traceparent).toMatch(/^00-/)
    }
    expect(after).toHaveBeenCalledTimes(2)
  })

  it('rejects mixed attribution modes before introducing duplicate callbacks', async () => {
    const f = await mcpFixture(false)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor })
      await expect(
        attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
      ).rejects.toThrow('do not combine')
      expect(f.calls).toHaveLength(0)
      const other = await mcpFixture(false)
      await attributeLangchainMcp(other.multi, {
        interceptor: other.interceptor,
        loadTools: other.loadTools,
      })
      await expect(
        attributeLangchainMcp(other.multi, { interceptor: other.interceptor }),
      ).rejects.toThrow('do not combine')
      expect(other.calls).toHaveLength(0)
    } finally {
      warning.mockRestore()
    }
  })

  it('rejects mismatched loader names before changing any cached tool', async () => {
    const f = await mcpFixture()
    const original = f.weather.func
    await expect(
      attributeLangchainMcp(f.multi, {
        interceptor: f.interceptor,
        loadTools: async () => [],
      }),
    ).rejects.toThrow('loader omitted tool')
    expect(f.weather.func).toBe(original)
    expect(f.calls).toHaveLength(0)
  })

  it('rejects invalid arguments before transport and preserves backend failures', async () => {
    const f = await mcpFixture()
    expect(
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
    ).toBe(1)
    expect(
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
    ).toBe(0)
    const tools = f.tools
    const weather = tools.find((tool) => tool.name.endsWith('weather'))!
    const explode = tools.find((tool) => tool.name.endsWith('explode'))!
    await expect(weather.invoke({ city: 42 })).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
    const after = vi.spyOn(f.interceptor, 'onAfterToolResponse')
    await expect(explode.invoke({ city: 'Austin' })).rejects.toThrow('fixture backend denied')
    expect(f.calls).toHaveLength(1)
    expect(after).toHaveBeenCalledWith(
      'explode',
      expect.anything(),
      {},
      expect.objectContaining({ isError: true }),
    )
  })

  it('executes native LangChain tools in a checkpointed graph without crossing threads', async () => {
    const f = await mcpFixture()
    expect(
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
    ).toBe(1)
    expect(
      await attributeLangchainMcp(f.multi, { interceptor: f.interceptor, loadTools: f.loadTools }),
    ).toBe(0)
    const tools = f.tools
    const weather = tools.find((tool) => tool.name.endsWith('weather'))!
    const graph = new StateGraph(MessagesAnnotation)
      .addNode('tools', new ToolNode(tools))
      .addEdge(START, 'tools')
      .addEdge('tools', END)
      .compile({ checkpointer: new MemorySaver() })
    const run = (thread: string, city: string) =>
      graph.invoke(
        {
          messages: [
            new AIMessage({
              content: '',
              tool_calls: [
                { id: `call-${thread}`, name: weather.name, args: { city }, type: 'tool_call' },
              ],
            }),
          ],
        },
        { configurable: { thread_id: thread } },
      )
    const alice = await run('alice-thread', 'Austin')
    const bob = await run('bob-thread', 'Boston')
    expect(alice.messages.at(-1)!.getType()).toBe('tool')
    expect(JSON.stringify(alice.messages.at(-1)!.content)).toContain('Austin')
    expect(JSON.stringify(bob.messages.at(-1)!.content)).toContain('Boston')
    expect(JSON.stringify(bob.messages)).not.toContain('Austin')
    const checkpoint = await graph.getState({ configurable: { thread_id: 'alice-thread' } })
    expect(JSON.stringify(checkpoint.values.messages)).toContain('Austin')
    expect(f.calls.every((call) => typeof call.meta?.['X-atrib-Context'] === 'string')).toBe(true)
  })

  it('resumes an interrupt from the selected checkpoint only', async () => {
    const State = Annotation.Root({ owner: Annotation<string>(), decision: Annotation<string>() })
    const graph = new StateGraph(State)
      .addNode('approval', (state) => ({ decision: interrupt({ owner: state.owner }) as string }))
      .addEdge(START, 'approval')
      .addEdge('approval', END)
      .compile({ checkpointer: new MemorySaver() })
    const config = { configurable: { thread_id: 'approval-alice' } }
    const paused = await graph.invoke({ owner: 'alice' }, config)
    expect((paused as typeof paused & { __interrupt__?: unknown[] }).__interrupt__).toHaveLength(1)
    const resumed = await graph.invoke(new Command({ resume: 'approved' }), config)
    expect(resumed.decision).toBe('approved')
    const other = await graph.getState({ configurable: { thread_id: 'approval-bob' } })
    expect(other.values).toEqual({})
  })

  it('keeps native workflow store namespaces, readback and signed chains intact', async () => {
    const store = attributeLangGraphStore(new InMemoryStore(), {
      privateKey: new Uint8Array(32).fill(23),
      contextId: '1234567890abcdef1234567890abcdef',
      logSubmission: 'disabled',
    })
    const workflow = entrypoint(
      { name: 'remember', store },
      async (input: { owner: string; fact: string }) => {
        const scoped = getStore()!
        const namespace = ['users', input.owner]
        await scoped.put(namespace, 'fact', { text: input.fact, kind: 'private' })
        return {
          item: await scoped.get(namespace, 'fact'),
          matches: await scoped.search(namespace, { filter: { kind: 'private' } }),
        }
      },
    )
    const [alice, bob] = await Promise.all([
      workflow.invoke({ owner: 'alice', fact: 'private alice preference' }),
      workflow.invoke({ owner: 'bob', fact: 'private bob preference' }),
    ])
    expect(alice.item?.value.text).toBe('private alice preference')
    expect(bob.item?.value.text).toBe('private bob preference')
    expect(alice.matches).toHaveLength(1)
    expect(bob.matches).toHaveLength(1)
    expect(await store.search(['users', 'absent'])).toEqual([])
    await store.delete(['users', 'alice'], 'fact')
    expect(await store.get(['users', 'alice'], 'fact')).toBeNull()
    expect((await store.get(['users', 'bob'], 'fact'))?.value.text).toBe('private bob preference')
    const records = store.getSignedRecords()
    expect(records.length).toBeGreaterThanOrEqual(6)
    for (let index = 0; index < records.length; index++) {
      expect(await verifyRecord(records[index]!)).toBe(true)
      if (index > 0)
        expect(records[index]!.chain_root).toBe(
          `sha256:${hexEncode(sha256(canonicalRecord(records[index - 1]!)))}`,
        )
    }
    expect(JSON.stringify(records)).not.toContain('private alice preference')
    expect(JSON.stringify(store.getSidecars())).toContain('private alice preference')
  })
})
