/**
 * End-to-end integration test.
 *
 * Exercises the full attribution flow across all three SDK packages:
 *
 *   1. Two MCP servers wrapped with @atrib/mcp (different creator keys)
 *   2. One merchant MCP server with transactionTools=['checkout']
 *   3. An agent interceptor from @atrib/agent
 *   4. Records captured in an in-memory store via fetch mock
 *   5. Graph constructed from records using §3.2.4 derivation rules
 *   6. Settlement calculation via @atrib/verify.calculate()
 *   7. Distribution verified to sum to 1.0 and contain expected creators
 *
 * Validates: record signing, chain_root linking, context propagation
 * (traceparent + baggage + atrib token), Path 1 transaction emission,
 * graph construction, deterministic calculation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { atrib as wrapMcpServer, base64urlEncode, getPublicKey } from '@atrib/mcp'
import { atrib as createAgent } from '@atrib/agent'
import { calculate, DEFAULT_POLICY } from '@atrib/verify'
import { buildGraphFromRecords } from '../src/graph-builder.js'
import { createRecordStore, createMockMcpServer, callTool } from '../src/test-harness.js'

// Three creator keypairs. two tools and a merchant
const TOOL_A_KEY = new Uint8Array(32).fill(11)
const TOOL_B_KEY = new Uint8Array(32).fill(22)
const MERCHANT_KEY = new Uint8Array(32).fill(33)
const AGENT_KEY = new Uint8Array(32).fill(44)

const TOOL_A_KEY_B64 = base64urlEncode(TOOL_A_KEY)
const TOOL_B_KEY_B64 = base64urlEncode(TOOL_B_KEY)
const MERCHANT_KEY_B64 = base64urlEncode(MERCHANT_KEY)
const AGENT_KEY_B64 = base64urlEncode(AGENT_KEY)

const TOOL_A_URL = 'https://search.example.com'
const TOOL_B_URL = 'https://summarize.example.com'
const MERCHANT_URL = 'https://shop.example.com'

describe('End-to-end attribution flow', () => {
  let store: ReturnType<typeof createRecordStore>

  beforeEach(() => {
    store = createRecordStore()
    store.installFetchMock()
  })

  afterEach(() => {
    store.restore()
  })

  it('builds a complete attribution chain across two tools and a merchant transaction', async () => {
    // ── 1. Set up the three wrapped MCP servers ──────────────────────────
    const toolAHandle = createMockMcpServer()
    wrapMcpServer(toolAHandle.server, {
      creatorKey: TOOL_A_KEY_B64,
      serverUrl: TOOL_A_URL,
    })

    const toolBHandle = createMockMcpServer()
    wrapMcpServer(toolBHandle.server, {
      creatorKey: TOOL_B_KEY_B64,
      serverUrl: TOOL_B_URL,
    })

    const merchantHandle = createMockMcpServer()
    wrapMcpServer(merchantHandle.server, {
      creatorKey: MERCHANT_KEY_B64,
      serverUrl: MERCHANT_URL,
      transactionTools: ['checkout'],
    })

    // ── 2. Set up the agent interceptor ─────────────────────────────────
    const agent = createAgent({
      creatorKey: AGENT_KEY_B64,
      sessionToken: 'integration-test-session',
    })

    // ── 3. Drive the attribution chain ──────────────────────────────────
    // Call tool A. first call, generates a genesis record
    const callA = await callTool({
      toolName: 'search',
      agent,
      serverHandle: toolAHandle,
      innerResult: { content: [{ type: 'text', text: 'search results' }] },
      serverUrl: TOOL_A_URL,
    })
    expect(callA.responseMeta?.atrib).toBeDefined()

    // Call tool B. should see tool A's token in outbound _meta and chain to it
    const callB = await callTool({
      toolName: 'summarize',
      agent,
      serverHandle: toolBHandle,
      innerResult: { content: [{ type: 'text', text: 'summary' }] },
      serverUrl: TOOL_B_URL,
    })
    expect(callB.responseMeta?.atrib).toBeDefined()
    expect(callB.responseMeta?.atrib).not.toBe(callA.responseMeta?.atrib)

    // Call merchant checkout. emits transaction record (Path 1)
    const callC = await callTool({
      toolName: 'checkout',
      agent,
      serverHandle: merchantHandle,
      innerResult: {
        content: [{ type: 'text', text: 'order placed' }],
        // ACP-shaped response so detectTransaction would fire on the agent side
        // but Path 1 should suppress agent emission
        data: { object: { object: 'checkout_session' }, url: 'https://shop.example.com/order/1' },
      },
      serverUrl: MERCHANT_URL,
    })
    expect(callC.responseMeta?.atrib).toBeDefined()

    // ── 4. Drain pending submissions ────────────────────────────────────
    await agent.flush()
    // Give the mcp submission queues a tick to drain too
    await new Promise((resolve) => setTimeout(resolve, 50))

    // ── 5. Inspect the captured records ─────────────────────────────────
    expect(store.records.length).toBeGreaterThanOrEqual(3)
    const txRecords = store.records.filter(
      (r) => r.event_type === 'https://atrib.dev/v1/types/transaction',
    )
    const toolCallRecords = store.records.filter(
      (r) => r.event_type === 'https://atrib.dev/v1/types/tool_call',
    )

    // Exactly one transaction record (Path 1, signed by merchant)
    expect(txRecords.length).toBe(1)
    expect(txRecords[0]!.creator_key).toBe(base64urlEncode(await getPublicKey(MERCHANT_KEY)))

    // Two tool_call records (one from tool A, one from tool B)
    expect(toolCallRecords.length).toBe(2)
    const creatorKeys = new Set(toolCallRecords.map((r) => r.creator_key))
    expect(creatorKeys.has(base64urlEncode(await getPublicKey(TOOL_A_KEY)))).toBe(true)
    expect(creatorKeys.has(base64urlEncode(await getPublicKey(TOOL_B_KEY)))).toBe(true)

    // All records share the same context_id (single session)
    const contextIds = new Set(store.records.map((r) => r.context_id))
    expect(contextIds.size).toBe(1)
    const contextId = [...contextIds][0]!

    // All records carry the same session_token
    const sessionTokens = new Set(
      store.records.map((r) => ('session_token' in r ? r.session_token : undefined)),
    )
    expect(sessionTokens.size).toBe(1)
    expect([...sessionTokens][0]).toBe('integration-test-session')

    // ── 6. Build the graph ──────────────────────────────────────────────
    const graph = await buildGraphFromRecords(store.records, contextId)
    expect(graph.has_transaction).toBe(true)
    expect(graph.node_count).toBe(3)

    // §3.2.4 step 4: every non-tx node has CONVERGES_ON to the transaction
    const convergesOnEdges = graph.edges.filter((e) => e.type === 'CONVERGES_ON')
    expect(convergesOnEdges.length).toBe(2)

    // §3.2.4 step 1: chain links derived from chain_root references.
    // Tool B's chain_root references Tool A's record hash → A → B
    // Merchant tx's chain_root references Tool B's record hash → B → tx
    // Expect exactly 2 CHAIN_PRECEDES edges
    const chainEdges = graph.edges.filter((e) => e.type === 'CHAIN_PRECEDES')
    expect(chainEdges.length).toBe(2)

    // Verify the chain is A → B → tx by walking the edges
    const txNode = graph.nodes.find((n) => n.event_type === 'transaction')!
    const edgeTo = (target: string) => chainEdges.find((e) => e.target === target)
    const txParentEdge = edgeTo(txNode.id)
    expect(txParentEdge).toBeDefined()
    const toolBNodeId = txParentEdge!.source
    const toolBParentEdge = edgeTo(toolBNodeId)
    expect(toolBParentEdge).toBeDefined()
    // Tool A should be the root (no chain parent)
    const toolANodeId = toolBParentEdge!.source
    expect(edgeTo(toolANodeId)).toBeUndefined()

    // ── 7. Run the calculation ──────────────────────────────────────────
    const distribution = calculate(graph, DEFAULT_POLICY)
    const total = Object.values(distribution).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1.0, 9)

    // Both tool creators should appear in the distribution
    const toolAPub = base64urlEncode(await getPublicKey(TOOL_A_KEY))
    const toolBPub = base64urlEncode(await getPublicKey(TOOL_B_KEY))
    expect(distribution[toolAPub]).toBeDefined()
    expect(distribution[toolBPub]).toBeDefined()

    // Merchant should NOT appear in the distribution. they own the transaction
    // node, which is excluded from contributing nodes per §4.6.2
    const merchantPub = base64urlEncode(await getPublicKey(MERCHANT_KEY))
    expect(distribution[merchantPub]).toBeUndefined()

    // Default policy = equal weight to both tools
    expect(distribution[toolAPub]).toBeCloseTo(0.5, 9)
    expect(distribution[toolBPub]).toBeCloseTo(0.5, 9)
  })

  it('produces a deterministic distribution across multiple runs', async () => {
    // Repeat the chain twice and verify identical distributions
    async function runOnce(): Promise<Record<string, number>> {
      const localStore = createRecordStore()
      localStore.installFetchMock()

      try {
        const toolAHandle = createMockMcpServer()
        wrapMcpServer(toolAHandle.server, {
          creatorKey: TOOL_A_KEY_B64,
          serverUrl: TOOL_A_URL,
        })
        const toolBHandle = createMockMcpServer()
        wrapMcpServer(toolBHandle.server, {
          creatorKey: TOOL_B_KEY_B64,
          serverUrl: TOOL_B_URL,
        })
        const merchantHandle = createMockMcpServer()
        wrapMcpServer(merchantHandle.server, {
          creatorKey: MERCHANT_KEY_B64,
          serverUrl: MERCHANT_URL,
          transactionTools: ['checkout'],
        })

        const agent = createAgent({
          creatorKey: AGENT_KEY_B64,
          sessionToken: 'deterministic-test',
        })

        await callTool({
          toolName: 'search',
          agent,
          serverHandle: toolAHandle,
          innerResult: { content: [] },
          serverUrl: TOOL_A_URL,
        })
        await callTool({
          toolName: 'summarize',
          agent,
          serverHandle: toolBHandle,
          innerResult: { content: [] },
          serverUrl: TOOL_B_URL,
        })
        await callTool({
          toolName: 'checkout',
          agent,
          serverHandle: merchantHandle,
          innerResult: {
            data: {
              object: { object: 'checkout_session' },
              url: 'https://shop.example.com/order/1',
            },
          },
          serverUrl: MERCHANT_URL,
        })
        await agent.flush()
        await new Promise((resolve) => setTimeout(resolve, 50))

        const ctxId = localStore.records[0]!.context_id
        const graph = await buildGraphFromRecords(localStore.records, ctxId)
        return calculate(graph, DEFAULT_POLICY)
      } finally {
        localStore.restore()
      }
    }

    const dist1 = await runOnce()
    const dist2 = await runOnce()
    // Different runs use different timestamps and context_ids, but the
    // distribution structure (creator → share fractions) must be identical.
    expect(Object.keys(dist1).sort()).toEqual(Object.keys(dist2).sort())
    for (const k of Object.keys(dist1)) {
      expect(dist1[k]).toBeCloseTo(dist2[k]!, 9)
    }
  })

  it('agent emits Path 2 transaction record when merchant has no @atrib/mcp', async () => {
    // Same flow but without wrapping the merchant
    const toolAHandle = createMockMcpServer()
    wrapMcpServer(toolAHandle.server, {
      creatorKey: TOOL_A_KEY_B64,
      serverUrl: TOOL_A_URL,
    })

    // Unwrapped merchant. no atrib middleware
    const unwrappedMerchant = createMockMcpServer()
    unwrappedMerchant.registerToolHandler(async () => ({
      data: {
        object: { object: 'checkout_session' },
        url: 'https://unprotected.example.com/order/1',
      },
    }))

    const agent = createAgent({
      creatorKey: AGENT_KEY_B64,
      sessionToken: 'path-2-test',
    })

    await callTool({
      toolName: 'search',
      agent,
      serverHandle: toolAHandle,
      innerResult: { content: [] },
      serverUrl: TOOL_A_URL,
    })

    // Manually invoke the unwrapped merchant
    const outboundMeta = await agent.onBeforeToolCall('checkout', {})
    const merchantHandler = unwrappedMerchant.getToolHandler()!
    const merchantResult = (await merchantHandler(
      { method: 'tools/call', params: { name: 'checkout', _meta: outboundMeta } },
      {},
    )) as Record<string, unknown>
    // No atrib middleware → no token in response
    expect(merchantResult._meta).toBeUndefined()
    agent.onAfterToolResponse('checkout', merchantResult, undefined, {
      serverUrl: 'https://unprotected.example.com',
    })

    await agent.flush()
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Now we should have: tool A's record + an agent-emitted Path 2 transaction
    const txRecords = store.records.filter((r) => r.event_type === 'transaction')
    expect(txRecords.length).toBe(1)
    // Transaction record signed by the AGENT, not the merchant
    expect(txRecords[0]!.creator_key).toBe(base64urlEncode(await getPublicKey(AGENT_KEY)))
  })
})
