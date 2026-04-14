// SPDX-License-Identifier: Apache-2.0

/**
 * Adapter: wrap a raw `@modelcontextprotocol/sdk` Client with atrib attribution.
 *
 * The MCP TypeScript SDK exposes a `Client` class with a `callTool(params, ...)`
 * method. This adapter returns a thin proxy around such a client whose
 * `callTool` is wrapped to:
 *
 *   1. Call `interceptor.onBeforeToolCall(toolName, existingMeta)` to get the
 *      attribution `_meta` block (traceparent, atrib token, baggage, etc.)
 *   2. Forward the request through the underlying client with the new
 *      `_meta` merged into `params._meta`
 *   3. Call `interceptor.onAfterToolResponse(toolName, result, result._meta, ...)`
 *      so the interceptor can update its session state, detect transactions,
 *      and emit Path 2 records when the tool server has no @atrib/mcp
 *
 * The adapter is intentionally narrow, it only proxies `callTool`. All other
 * client methods (`listTools`, `close`, `connect`, `request`, etc.) are
 * forwarded unchanged. This means a developer can drop the adapter into any
 * existing code that uses the MCP SDK Client directly without changing
 * anything else.
 *
 * If the MCP SDK ever changes the `callTool` signature, the adapter will
 * fail loudly because TypeScript will complain about the proxied parameters
 * shape, see the `MinimalMcpClient` interface below.
 */

import type { ToolCallInterceptor } from '../middleware.js'

/**
 * The minimal subset of `@modelcontextprotocol/sdk/client/index.js` Client
 * that this adapter depends on. We do not import the SDK type directly to
 * avoid making `@modelcontextprotocol/sdk` a hard dependency of `@atrib/agent`
 *, the SDK is only needed if you actually use this adapter, not for the
 * core interceptor API.
 */
export interface MinimalMcpClient {
  callTool(
    params: {
      name: string
      arguments?: Record<string, unknown>
      _meta?: Record<string, unknown>
      [key: string]: unknown
    },
    resultSchema?: unknown,
    options?: unknown,
  ): Promise<{
    content?: unknown
    _meta?: Record<string, unknown>
    isError?: boolean
    [key: string]: unknown
  }>
}

/** Options for `wrapMcpClient`. */
export interface WrapMcpClientOptions {
  /**
   * The canonical URL of the MCP server this client connects to. Used by
   * the interceptor for content_id derivation when emitting Path 2
   * transaction records (the agent fallback path described in spec §5.4.5).
   * If omitted, the interceptor will fall back to the tool's MCP server
   * URL only when it can be derived elsewhere, for many transports
   * (especially stdio) it cannot, and content_id values for transactions
   * will be less specific.
   */
  serverUrl?: string
}

/**
 * Wrap a raw MCP Client so every `callTool` invocation participates in
 * atrib attribution.
 *
 * Returns a Proxy over the client. All non-`callTool` methods are forwarded
 * unchanged via the prototype, so the wrapped client is API-compatible with
 * the original.
 *
 * Usage:
 *
 *   import { Client } from '@modelcontextprotocol/sdk/client/index.js'
 *   import { atrib, wrapMcpClient } from '@atrib/agent'
 *
 *   const interceptor = atrib({
 *     creatorKey: process.env.ATRIB_PRIVATE_KEY,
 *     merchantDomain: 'https://merchant.example.com',
 *     serverUrls: ['https://my-tool.example'],
 *   })
 *
 *   const rawClient = new Client({ name: 'my-agent', version: '1.0.0' })
 *   await rawClient.connect(transport)
 *
 *   const client = wrapMcpClient(rawClient, interceptor, {
 *     serverUrl: 'https://my-tool.example',
 *   })
 *
 *   // Use `client` exactly like the raw MCP Client.
 *   const result = await client.callTool({ name: 'search', arguments: { q: 'foo' } })
 *
 *   // On shutdown:
 *   await interceptor.flush()
 *   await rawClient.close()
 */
export function wrapMcpClient<C extends MinimalMcpClient>(
  client: C,
  interceptor: ToolCallInterceptor,
  options: WrapMcpClientOptions = {},
): C {
  const { serverUrl } = options

  const wrappedCallTool: MinimalMcpClient['callTool'] = async (
    params,
    resultSchema,
    requestOptions,
  ) => {
    const toolName = params.name

    // §5.4.3: Build outbound _meta. The interceptor returns a record that
    // includes any existing _meta keys from the caller plus atrib's own
    // (atrib token, traceparent, tracestate, baggage, X-Atrib-Chain).
    let outboundMeta: Record<string, unknown> | undefined
    try {
      const existingMeta = (params._meta ?? {}) as Record<string, unknown>
      outboundMeta = await interceptor.onBeforeToolCall(toolName, existingMeta)
    } catch (err) {
      // §5.8 degradation contract: never let attribution failures break the
      // primary tool call. Fall through to the original params unchanged.
      console.warn('atrib: wrapMcpClient onBeforeToolCall failed, passing through', err)
      outboundMeta = undefined
    }

    const forwardedParams: typeof params =
      outboundMeta !== undefined ? { ...params, _meta: outboundMeta } : params

    // Forward to the underlying client with the merged _meta.
    const result = await client.callTool(forwardedParams, resultSchema, requestOptions)

    // §5.4.4: Update session state from the response _meta. Also runs Path 1/2
    // transaction detection if the response shape matches a known protocol.
    try {
      const responseMeta = (result?._meta ?? {}) as Record<string, unknown>
      // exactOptionalPropertyTypes: only include serverUrl when it's set,
      // because the interceptor's option type doesn't accept undefined.
      const responseOptions = {
        ...(serverUrl !== undefined ? { serverUrl } : {}),
        isError: (result as Record<string, unknown>)?.isError === true,
      }
      interceptor.onAfterToolResponse(toolName, result, responseMeta, responseOptions)
    } catch (err) {
      console.warn('atrib: wrapMcpClient onAfterToolResponse failed, passing through', err)
    }

    return result
  }

  // Proxy the client so all other methods (listTools, close, connect, etc.)
  // pass through unchanged. We can't simply spread the client because the
  // SDK's Client class methods rely on `this` being the original instance.
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'callTool') {
        return wrappedCallTool
      }
      const value = Reflect.get(target, prop, receiver)
      // If the property is a function, bind it to the original target so
      // method calls like `client.listTools()` still work correctly.
      if (typeof value === 'function') {
        return (value as Function).bind(target)
      }
      return value
    },
  })
}
