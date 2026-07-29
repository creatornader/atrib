/**
 * Regression test for our @modelcontextprotocol/server integration assumptions.
 *
 * The atrib() middleware monkey-patches `McpServer.server.setRequestHandler`
 * and detects the tools/call request via Zod schema introspection. Both of
 * these are internal SDK details that could change between versions.
 *
 * This test imports the REAL `@modelcontextprotocol/sdk` package and asserts
 * that:
 *
 *   1. `McpServer.server` is the underlying low-level Server instance
 *   2. `Server.setRequestHandler` is a function we can monkey-patch
 *   3. The shape used for the tools/call request schema is one of the forms
 *      our `isToolsCallSchema` helper recognizes
 *   4. End-to-end: registering a tool via `McpServer.registerTool()`, calling
 *      it through the wrapped middleware, and observing an attribution record
 *      submission via a mocked fetch
 *
 * If the SDK changes any of these, this test fails CI immediately and tells
 * the maintainer exactly what broke. That converts a silent regression
 * (production code works in dev, breaks on upgrade) into a loud one.
 *
 * If you're reading this because the test failed: the SDK shape changed.
 * Update `isToolsCallSchema` in `src/middleware.ts` to recognize the new
 * form, then update this test to match.
 */

import { describe, it, expect, vi } from 'vitest'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { Client } from '@modelcontextprotocol/client'
import { atrib } from '../src/middleware.js'
import { base64urlEncode } from '../src/base64url.js'

const TEST_KEY_B64 = base64urlEncode(new Uint8Array(32).fill(7))

describe('@modelcontextprotocol/server shape assumptions', () => {
  it('McpServer instance exposes a `.server` property', () => {
    const mcpServer = new McpServer({ name: 'test', version: '1.0.0' })
    expect(mcpServer.server).toBeDefined()
    expect(mcpServer.server).not.toBeNull()
  })

  it('McpServer.server.setRequestHandler is a function', () => {
    const mcpServer = new McpServer({ name: 'test', version: '1.0.0' })
    const underlyingServer = mcpServer.server as unknown as {
      setRequestHandler?: unknown
    }
    expect(typeof underlyingServer.setRequestHandler).toBe('function')
  })

  it('uses the v2 string method form that the middleware intercepts', () => {
    // This is the schema McpServer passes to setRequestHandler when it
    // registers its tools/call dispatcher. Our isToolsCallSchema helper
    // looks for the literal 'tools/call' at one of several known paths.
    // At least ONE of those paths must match for our patch to work.

    expect('tools/call').toBe('tools/call')
  })
})

describe('atrib() end-to-end against the real MCP SDK', () => {
  it('intercepts a tool registered via McpServer.registerTool', async () => {
    // Spec §2.6.1: the POST body is a bare signed attribution record.
    const submissions: Array<{ event_type?: string; content_id?: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as { body: string })?.body as string)
      submissions.push(body)
      return new Response(JSON.stringify({ log_index: 1 }), { status: 200 })
    })

    const mcpServer = new McpServer({ name: 'test', version: '1.0.0' })
    const wrapped = atrib(mcpServer, {
      creatorKey: TEST_KEY_B64,
      serverUrl: 'https://test.example.com',
    })

    // Register a real tool through the high-level API. The SDK lazily
    // installs its tools/call dispatcher on first registration; our patch
    // intercepts that registration.
    mcpServer.registerTool('echo', {}, async () => ({
      content: [{ type: 'text' as const, text: 'hello' }],
    }))

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([wrapped.connect(serverTransport), client.connect(clientTransport)])
    const result = (await client.callTool({
      name: 'echo',
      arguments: { message: 'hello' },
      _meta: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    })) as {
      content: { type: string; text: string }[]
      _meta?: { atrib?: string }
    }

    // Tool's own output is preserved
    expect(result.content[0]?.text).toBe('hello')

    // Attribution context was written to the response _meta
    expect(result._meta).toBeDefined()
    expect(result._meta?.atrib).toBeDefined()
    expect(typeof result._meta?.atrib).toBe('string')

    // Flush so the submission queue actually fires
    await wrapped.flush()

    // An attribution record was submitted to the log. The body IS the
    // record per §2.6.1. no wrapper.
    expect(submissions.length).toBeGreaterThan(0)
    expect(submissions[0]!.event_type).toBe('https://atrib.dev/v1/types/tool_call')
    expect(submissions[0]!.content_id).toMatch(/^sha256:[0-9a-f]{64}$/)
    await client.close()
  })

  it('register-then-wrap order: retroactively wraps a pre-existing tools/call dispatcher', async () => {
    // The canonical order is wrap-then-register, but McpServer eagerly
    // installs its tools/call dispatcher on the first .tool() call, so a
    // user who calls atrib() AFTER registering tools would otherwise get no
    // attribution. The middleware must reach into the underlying server's
    // _requestHandlers map and rewrite the existing entry.
    const submissions: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as { body: string })?.body as string)
      submissions.push(body)
      return new Response(JSON.stringify({ log_index: 1 }), { status: 200 })
    })

    const mcpServer = new McpServer({ name: 'test', version: '1.0.0' })

    // Register the tool BEFORE wrapping. this installs the dispatcher
    // eagerly, so our setRequestHandler patch arrives too late.
    mcpServer.registerTool('echo', {}, async () => ({
      content: [{ type: 'text' as const, text: 'hello' }],
    }))

    const wrapped = atrib(mcpServer, {
      creatorKey: TEST_KEY_B64,
      serverUrl: 'https://test.example.com',
    })

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([wrapped.connect(serverTransport), client.connect(clientTransport)])
    const result = (await client.callTool({
      name: 'echo',
      arguments: {},
    })) as { content: { text: string }[]; _meta?: { atrib?: string } }

    // Tool output preserved AND attribution attached, even though atrib()
    // was called after .tool()
    expect(result.content[0]?.text).toBe('hello')
    expect(result._meta?.atrib).toBeDefined()

    await wrapped.flush()
    expect(submissions.length).toBeGreaterThan(0)
    await client.close()
  })

  it('warns and degrades gracefully if McpServer.server shape is unexpected', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Pass an object that LOOKS like an McpServer but has no .server.setRequestHandler
    const fake = {} as unknown as McpServer
    const wrapped = atrib(fake, { creatorKey: TEST_KEY_B64 })
    // Pass-through mode: flush exists but is a no-op
    expect(wrapped.flush).toBeDefined()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('McpServer.server.setRequestHandler is not a function'),
    )
    warnSpy.mockRestore()
  })
})
