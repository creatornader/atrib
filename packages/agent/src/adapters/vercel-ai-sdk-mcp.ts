// SPDX-License-Identifier: Apache-2.0

/**
 * Adapter: attribute MCP tool calls flowing through a Vercel AI SDK MCP client.
 *
 * The Vercel AI SDK exposes `createMCPClient()` (and the legacy
 * `experimental_createMCPClient()`) from `@ai-sdk/mcp`. The returned client is
 * NOT a `@modelcontextprotocol/sdk` Client, it has its own JSON-RPC
 * implementation (verified against `@ai-sdk/mcp@1.0.35`'s `dist/index.mjs`).
 * This means our `wrapMcpClient` adapter (which expects the structural shape
 * of `@modelcontextprotocol/sdk` Client) does not apply directly.
 *
 * Two structural differences make this adapter necessary:
 *
 *   1. **`callTool` shape mismatch.** `@ai-sdk/mcp` MCPClient.callTool takes
 *      `{ name, args, options }` (verified at `dist/index.mjs:1814`),
 *      whereas `@modelcontextprotocol/sdk` Client.callTool takes
 *      `{ name, arguments, _meta }`. Different field names, and
 *      `@ai-sdk/mcp` does not pass `_meta` through to the request layer at
 *      all, it builds the request as `{ method: 'tools/call', params: { name, arguments: args } }`
 *      with no `_meta` field (`dist/index.mjs:1819`).
 *
 *   2. **`tools()` builds AI-SDK-shaped tool definitions whose execute()
 *      callbacks pass through `extractStructuredContent`** when an
 *      outputSchema is set, which DROPS the `_meta` field from the result
 *      envelope (`dist/index.mjs:1989-1991`). Wrapping at the AI SDK execute
 *      layer would lose attribution data for any structured-output tool.
 *
 * The right integration point is **`MCPClient.request()`**, the JSON-RPC
 * bottleneck through which every tools/call (and tools/list, resources/read,
 * etc.) flows on its way to the transport (`dist/index.mjs:1750`). Patching
 * here lets us:
 *
 *   - Inject `_meta` (atrib token, traceparent, tracestate, baggage,
 *     X-Atrib-Chain) into the outbound request.params, so the upstream MCP
 *     server sees a properly contextualized tools/call request
 *   - Receive the raw CallToolResult before any AI-SDK-specific transformation,
 *     so our interceptor's `onAfterToolResponse` gets the original `_meta`
 *     including any `atrib` token from the server side
 *
 * Symmetry with the server side: `@atrib/mcp` patches
 * `McpServer.server.setRequestHandler(CallToolRequestSchema, ...)`. This
 * adapter patches `MCPClient.request` for outbound `tools/call`. Same pattern,
 * opposite end of the wire.
 */

import type { ToolCallInterceptor } from '../middleware.js'

/**
 * Marker symbol set on a patched client to make repeated calls to
 * `attributeVercelAiSdkMcp` idempotent.
 */
const ATRIB_PATCHED = Symbol.for('atrib.vercel-ai-sdk.patched')

/**
 * Minimal structural type for an `@ai-sdk/mcp` MCPClient. Mirrors the public
 * surface we depend on without importing from `@ai-sdk/mcp` (we don't want a
 * hard dependency on the AI SDK package).
 *
 * The `request` method is typed loosely (`unknown` return) because the actual
 * `@ai-sdk/mcp` implementation uses Zod-derived result types that vary per
 * call. The runtime-injected `_meta` we care about is a structural field on
 * the request params, not a typed contract.
 */
export interface VercelAiSdkMcpClientLike {
  request(args: {
    request: {
      method: string
      params?: Record<string, unknown> | undefined
    }
    resultSchema?: unknown
    options?: { signal?: AbortSignal | undefined } | undefined
  }): Promise<unknown>
}

/** Options for `attributeVercelAiSdkMcp`. */
export interface AttributeVercelAiSdkMcpOptions {
  /** The atrib interceptor that observes tool calls on this client. */
  interceptor: ToolCallInterceptor

  /**
   * Canonical URL of the MCP server this client connects to. Used by the
   * interceptor for content_id derivation when emitting Path 2 transaction
   * records (the agent fallback path described in spec §5.4.5). Recommended
   * for any production setup; required for stdio upstreams (where no host
   * header is available).
   */
  serverUrl?: string
}

/**
 * Patch a Vercel AI SDK MCP client so every outbound `tools/call` flows
 * through atrib's interceptor lifecycle.
 *
 * Mutates the passed client in place by replacing its `request` method with
 * a wrapped version. Returns the same client reference for convenience.
 *
 * Idempotent: calling this helper twice on the same client is a no-op the
 * second time.
 *
 * Order: this helper can be called BEFORE or AFTER `mcpClient.tools()`. The
 * AI SDK builds tool execute() callbacks that read `client.request` at
 * invocation time, not at build time, so subsequent tool invocations will
 * use the patched method regardless of when you patch.
 *
 * Usage:
 *
 *   import { createMCPClient } from '@ai-sdk/mcp'
 *   import { streamText } from 'ai'
 *   import { atrib, attributeVercelAiSdkMcp } from '@atrib/agent'
 *
 *   const interceptor = atrib({
 *     creatorKey: process.env.ATRIB_PRIVATE_KEY,
 *     merchantDomain: 'https://merchant.example.com',
 *     serverUrls: ['https://my-tool.example'],
 *   })
 *
 *   const mcpClient = await createMCPClient({
 *     transport: { type: 'http', url: 'https://my-tool.example/mcp' },
 *   })
 *
 *   attributeVercelAiSdkMcp(mcpClient, {
 *     interceptor,
 *     serverUrl: 'https://my-tool.example',
 *   })
 *
 *   const tools = await mcpClient.tools()
 *
 *   const result = await streamText({
 *     model: openai('gpt-4o'),
 *     tools,
 *     prompt: 'What can you do?',
 *     onFinish: async () => {
 *       await mcpClient.close()
 *       await interceptor.flush()
 *     },
 *   })
 */
export function attributeVercelAiSdkMcp<C extends VercelAiSdkMcpClientLike>(
  client: C,
  options: AttributeVercelAiSdkMcpOptions,
): C {
  // Idempotency check, don't double-patch a client. Repeat calls are a no-op.
  if ((client as unknown as Record<symbol, unknown>)[ATRIB_PATCHED] === true) {
    return client
  }

  const { interceptor, serverUrl } = options
  const originalRequest = client.request.bind(client)

  const patchedRequest: VercelAiSdkMcpClientLike['request'] = async (args) => {
    // Forward non-tools/call methods unchanged (tools/list, resources/read,
    // notifications, etc.). The interceptor only cares about tool invocations.
    if (args?.request?.method !== 'tools/call') {
      return originalRequest(args)
    }

    const params = args.request.params ?? {}
    const toolName = (params.name as string) ?? ''
    const existingMeta = (params._meta as Record<string, unknown>) ?? {}

    // §5.4.3: Build outbound _meta. The interceptor returns a record that
    // includes any existing _meta keys plus atrib's own (atrib token,
    // traceparent, tracestate, baggage, X-Atrib-Chain).
    let outboundMeta: Record<string, unknown> | undefined
    try {
      outboundMeta = await interceptor.onBeforeToolCall(toolName, existingMeta)
    } catch (err) {
      // §5.8 degradation: pass through with the original meta on failure
      console.warn('atrib: vercel-ai-sdk-mcp onBeforeToolCall failed, passing through', err)
      outboundMeta = undefined
    }

    // Forward the request with merged _meta if the interceptor provided any.
    // We construct a new args object so the caller's reference is not mutated.
    const forwardedArgs: typeof args =
      outboundMeta !== undefined
        ? {
            ...args,
            request: {
              ...args.request,
              params: { ...params, _meta: outboundMeta },
            },
          }
        : args

    const result = await originalRequest(forwardedArgs)

    // §5.4.4: Update session state from the response _meta. The Vercel AI
    // SDK MCPClient returns the raw CallToolResult here BEFORE any
    // extractStructuredContent transformation, so the _meta field is intact.
    try {
      const responseMeta = (result as { _meta?: Record<string, unknown> })?._meta ?? {}
      const responseOptions = {
        ...(serverUrl !== undefined ? { serverUrl } : {}),
        isError: (result as Record<string, unknown>)?.isError === true,
      }
      interceptor.onAfterToolResponse(toolName, result, responseMeta, responseOptions)
    } catch (err) {
      console.warn('atrib: vercel-ai-sdk-mcp onAfterToolResponse failed, passing through', err)
    }

    return result
  }

  // Replace the method in place. The Vercel AI SDK's tools() callbacks
  // dereference `self.request` at invocation time (not at tools() build time),
  // so this patch fires for tool calls invoked any time after this point.
  ;(client as unknown as { request: typeof patchedRequest }).request = patchedRequest

  // Mark the client so a second call to this helper is a no-op.
  ;(client as unknown as Record<symbol, unknown>)[ATRIB_PATCHED] = true

  return client
}
