/**
 * End-to-end test against the REAL @modelcontextprotocol/sdk.
 *
 * the framework-adapter rollout verification, the existing end-to-end test in
 * `end-to-end.test.ts` mocks the McpServer with our own test harness, which
 * is correct for unit-testing the attribution logic in isolation. But it
 * does not verify that the wire format actually works against the real MCP
 * SDK over a real transport.
 *
 * This test:
 *
 *   1. Creates a real `McpServer` from `@modelcontextprotocol/sdk` and wraps
 *      it with `@atrib/mcp` `atrib()` middleware
 *   2. Registers a real tool via the SDK's high-level `tool()` API
 *   3. Creates a real `Client` and connects it to the server via
 *      `InMemoryTransport.createLinkedPair()` (an in-process transport
 *      shipped by the MCP SDK for exactly this kind of test)
 *   4. Wraps the client with `@atrib/agent` `wrapMcpClient()`
 *   5. Calls the tool through the wrapped client
 *   6. Asserts that:
 *      - The tool's own response is unchanged
 *      - An attribution token rode back through the response `_meta` field
 *      - A signed attribution record was submitted to a mocked log endpoint
 *      - Calling the tool a SECOND time produces a record whose `chain_root`
 *        references the FIRST record's hash (chain linkage)
 *
 * This is the test that proves atrib actually works against the real SDK
 * end-to-end. If a future SDK upgrade silently breaks the wire-level
 * attribution flow, this test fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { atrib as wrapMcpServer, base64urlEncode, decodeToken } from '@atrib/mcp'
import { atrib as createAgent, wrapMcpClient } from '@atrib/agent'

const TOOL_KEY = base64urlEncode(new Uint8Array(32).fill(11))
const AGENT_KEY = base64urlEncode(new Uint8Array(32).fill(44))
const TOOL_URL = 'https://search.example.com'

describe('Real @modelcontextprotocol/sdk end-to-end', () => {
  // Spec §2.6.1: each submitted body IS the bare signed record.
  let submissions: Array<{ event_type?: string; chain_root?: string; content_id?: string }>
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

  it('attribution flows through real SDK transport with chain linkage', async () => {
    // ── 1. Set up a real MCP server with a real tool ────────────────────
    // Order matters: wrapMcpServer MUST be called BEFORE registering tools
    // because McpServer eagerly installs its tools/call dispatcher on the
    // first .tool() / .registerTool() call. The middleware patches
    // setRequestHandler, so it must be in place before that first call.
    // (The middleware ALSO retroactively wraps an already-registered
    // dispatcher, see the "register-then-wrap order" test below, so the
    // reverse order works too. The canonical README pattern is wrap-then-
    // register and that's what we exercise here.)
    const mcpServer = new McpServer({ name: 'search-server', version: '1.0.0' })

    wrapMcpServer(mcpServer, {
      creatorKey: TOOL_KEY,
      serverUrl: TOOL_URL,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mcpServer as any).tool('search', async () => ({
      content: [{ type: 'text', text: 'matched 5 results' }],
    }))

    // ── 2. Set up a real client and connect over InMemoryTransport ──────
    const client = new Client({ name: 'test-agent', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])

    // ── 3. Wrap the client with the @atrib/agent adapter ───────────────
    const interceptor = createAgent({
      creatorKey: AGENT_KEY,
      sessionToken: 'real-sdk-test-session',
    })
    // The Client's exact callTool signature is more specific than our
    // MinimalMcpClient interface (it uses z.core.$loose for _meta which
    // tsc reports as `{...} | undefined`, not exactly `Record<string,unknown>`).
    // Cast through any for the test boundary.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrappedClient = wrapMcpClient(client as any, interceptor, {
      serverUrl: TOOL_URL,
    })

    // ── 4. First tool call: should produce a genesis record ────────────
    const result1 = await wrappedClient.callTool({
      name: 'search',
      arguments: { query: 'foo' },
    })

    // Tool's own output is preserved
    expect(result1.content).toEqual([{ type: 'text', text: 'matched 5 results' }])

    // Attribution token rode back through the response _meta
    expect(result1._meta).toBeDefined()
    expect(result1._meta?.atrib).toBeDefined()
    expect(typeof result1._meta?.atrib).toBe('string')

    // Decode the token and capture the record_hash for chain comparison
    const token1 = result1._meta?.atrib as string
    const decoded1 = decodeToken(token1)
    if (!decoded1) throw new Error('decodeToken returned null for token1')
    expect(decoded1.recordHash.length).toBe(32)
    expect(decoded1.creatorKey.length).toBe(32)

    // ── 5. Second tool call: should chain to the first record ──────────
    const result2 = await wrappedClient.callTool({
      name: 'search',
      arguments: { query: 'bar' },
    })
    expect(result2.content).toEqual([{ type: 'text', text: 'matched 5 results' }])
    expect(result2._meta?.atrib).toBeDefined()

    const token2 = result2._meta?.atrib as string
    expect(token2).not.toBe(token1) // distinct records

    // ── 6. Flush submission queues ──────────────────────────────────────
    await interceptor.flush()
    // Give the server-side queue a tick to drain (it's non-blocking)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // ── 7. Inspect submitted records ────────────────────────────────────
    // Spec §2.6.1: each submission IS the bare record. No `.record` indirection.
    expect(submissions.length).toBeGreaterThanOrEqual(2)
    const records = submissions.filter((r): r is NonNullable<typeof r> => r !== undefined)
    expect(records.length).toBeGreaterThanOrEqual(2)

    // Both records are tool_call (not transaction) since 'search' is not in
    // transactionTools
    for (const r of records) {
      expect(r.event_type).toBe('tool_call')
    }

    // Both records have a content_id derived from serverUrl + 'search'
    for (const r of records) {
      expect(r.content_id).toMatch(/^sha256:[0-9a-f]{64}$/)
    }

    // The two records share the same content_id (same tool, same server)
    expect(records[0]!.content_id).toBe(records[1]!.content_id)

    // ── 8. Chain linkage: the SECOND record's chain_root should reference
    //      the FIRST record's hash, not be a genesis ───────────────────
    // chain_root format: 'sha256:<64 hex>'. The first record's chain_root
    // should be the genesis derived from context_id; the second's should
    // be sha256:<hex of the first record_hash>.
    const firstRecord = records[0]!
    const secondRecord = records[1]!
    expect(firstRecord.chain_root).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(secondRecord.chain_root).toMatch(/^sha256:[0-9a-f]{64}$/)
    // They differ, the second is chained to the first
    expect(secondRecord.chain_root).not.toBe(firstRecord.chain_root)

    // The second record's chain_root should be the hex of decoded1.recordHash
    const expectedChainRoot = 'sha256:' + Buffer.from(decoded1.recordHash).toString('hex')
    expect(secondRecord.chain_root).toBe(expectedChainRoot)

    // ── 9. Cleanup ──────────────────────────────────────────────────────
    await client.close()
    await mcpServer.close()
  })

  it('wrapMcpClient preserves non-callTool methods (listTools)', async () => {
    const mcpServer = new McpServer({ name: 'list-test', version: '1.0.0' })
    wrapMcpServer(mcpServer, { creatorKey: TOOL_KEY, serverUrl: TOOL_URL })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mcpServer as any).tool('alpha', async () => ({
      content: [{ type: 'text', text: 'a' }],
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(mcpServer as any).tool('beta', async () => ({
      content: [{ type: 'text', text: 'b' }],
    }))

    const client = new Client({ name: 'list-agent', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)])

    const interceptor = createAgent({ creatorKey: AGENT_KEY })
    // The Client's exact callTool signature is more specific than our
    // MinimalMcpClient interface, so cast through unknown.
    const wrappedClient = wrapMcpClient(
      client as unknown as Parameters<typeof wrapMcpClient>[0],
      interceptor,
      { serverUrl: TOOL_URL },
    )

    // listTools is forwarded unchanged through the proxy. The wrapped
    // client must remain API-compatible with the raw Client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (await (wrappedClient as any).listTools()) as {
      tools: { name: string }[]
    }
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['alpha', 'beta'])

    await interceptor.flush()
    await client.close()
    await mcpServer.close()
  })
})
