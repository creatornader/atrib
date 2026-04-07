/**
 * Test harness for end-to-end attribution flow.
 *
 * Provides:
 *  - A mock McpServer that captures setRequestHandler calls (for @atrib/mcp)
 *  - A "wire" simulator that ferries requests/responses between agent + server
 *  - A record store that captures everything submitted to the (mocked) Merkle log
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AtribRecord } from '@atrib/mcp'

export interface RecordStore {
  records: AtribRecord[]
  /** Install a global fetch mock that captures records submitted by @atrib/mcp's submission queue. */
  installFetchMock(): void
  restore(): void
}

/** Create an in-memory record store with a fetch mock that captures submissions. */
export function createRecordStore(): RecordStore {
  const records: AtribRecord[] = []
  const originalFetch = globalThis.fetch
  let installed = false

  return {
    records,
    installFetchMock() {
      if (installed) return
      installed = true
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        // Capture record submissions. Spec §2.6.1: the POST body is a
        // bare signed attribution record. Earlier versions of this harness
        // expected a `{record, priority}` wrapper to match the (incorrect)
        // wire format the submission queue used; that has been fixed.
        try {
          if (init?.body && typeof init.body === 'string') {
            const parsed = JSON.parse(init.body) as Partial<AtribRecord>
            if (parsed.spec_version === 'atrib/1.0') {
              records.push(parsed as AtribRecord)
            }
          }
        } catch {
          // ignore — not all fetches are submissions
        }
        return new Response(
          JSON.stringify({
            log_index: records.length,
            checkpoint: `log.test/v1\n${records.length + 1}\nrootHashBase64\n`,
            inclusion_proof: [],
            leaf_hash: 'leafHashBase64',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }) as typeof fetch
    },
    restore() {
      if (!installed) return
      installed = false
      globalThis.fetch = originalFetch
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock MCP server that mimics McpServer.server.setRequestHandler() interface
// ─────────────────────────────────────────────────────────────────────────────

type RequestHandler = (
  request: Record<string, unknown>,
  extra: unknown,
) => Promise<unknown>

export interface MockMcpServerHandle {
  /** The McpServer-shaped object to pass to atrib() */
  server: McpServer
  /** Register a tools/call handler (simulates McpServer.tool() registration) */
  registerToolHandler(handler: RequestHandler): void
  /** Get the (possibly atrib-wrapped) tools/call handler */
  getToolHandler(): RequestHandler | undefined
}

export function createMockMcpServer(): MockMcpServerHandle {
  const handlers = new Map<string, RequestHandler>()

  const mockUnderlyingServer = {
    setRequestHandler(
      schema: { shape?: { method?: { value?: string } } },
      handler: RequestHandler,
    ) {
      const method = schema?.shape?.method?.value ?? 'unknown'
      handlers.set(method, handler)
    },
  }

  return {
    server: { server: mockUnderlyingServer } as unknown as McpServer,
    registerToolHandler(handler: RequestHandler) {
      const callToolSchema = { shape: { method: { value: 'tools/call' } } }
      mockUnderlyingServer.setRequestHandler(callToolSchema, handler)
    },
    getToolHandler() {
      return handlers.get('tools/call')
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wire simulator — drives a tools/call from the agent through a wrapped server
// ─────────────────────────────────────────────────────────────────────────────

export interface WireResult {
  /** The result returned by the wrapped tool handler (with attribution context attached) */
  result: Record<string, unknown>
  /** The _meta from result.params if present (where atrib writes the response context) */
  responseMeta: Record<string, unknown> | undefined
}

/**
 * Simulate one tools/call traveling from the agent to a wrapped MCP server.
 *
 * Flow:
 *   1. Agent builds outbound _meta via onBeforeToolCall
 *   2. Server's wrapped handler runs with that _meta
 *   3. Server attaches response context to result via writeOutboundContext
 *   4. Agent reads inbound context from response via onAfterToolResponse
 */
export async function callTool(opts: {
  toolName: string
  agent: {
    onBeforeToolCall: (
      name: string,
      meta: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>
    onAfterToolResponse: (
      name: string,
      response: unknown,
      meta: Record<string, unknown> | undefined,
      options?: { headers?: Record<string, string | undefined>; serverUrl?: string },
    ) => void
  }
  serverHandle: MockMcpServerHandle
  /** Body the inner tool returns (BEFORE attribution wrapping) */
  innerResult: Record<string, unknown>
  serverUrl?: string
}): Promise<WireResult> {
  const { toolName, agent, serverHandle, innerResult, serverUrl } = opts

  // 1. Agent prepares outbound _meta
  const outboundMeta = await agent.onBeforeToolCall(toolName, {})

  // 2. Build a tools/call request
  const request = {
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: {},
      _meta: outboundMeta,
    },
  }

  // 3. Inner handler returns innerResult (caller controls); the atrib wrapper
  // will mutate it to attach response context
  const innerHandler: RequestHandler = async () => innerResult
  serverHandle.registerToolHandler(innerHandler)

  // 4. Invoke the wrapped handler
  const wrappedHandler = serverHandle.getToolHandler()
  if (!wrappedHandler) throw new Error('no tool handler registered')
  const result = (await wrappedHandler(request, {})) as Record<string, unknown>

  // 5. Extract response _meta — @atrib/mcp writes attribution context to result._meta
  // (see writeOutboundContext in @atrib/mcp/src/context.ts)
  const responseMeta = result._meta as Record<string, unknown> | undefined

  // 6. Agent processes the response
  agent.onAfterToolResponse(toolName, result, responseMeta, serverUrl ? { serverUrl } : {})

  return { result, responseMeta }
}
