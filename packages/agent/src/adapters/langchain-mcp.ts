// SPDX-License-Identifier: Apache-2.0

/**
 * Adapter: attribute MCP tool calls flowing through a LangChain JS MCP client.
 *
 * LangChain exposes MCP integration via the `@langchain/mcp-adapters` package
 * (verified against `@langchain/mcp-adapters@1.1.3`). Two APIs are supported:
 *
 *   1. **High-level: `new MultiServerMCPClient({ mcpServers: {...} }).getTools()`**
 *     , config-driven, the client owns its internal
 *      `@modelcontextprotocol/sdk` Client instances behind `#private` fields.
 *      Users never see the Client reference directly; there is no public
 *      setter to inject a `wrapMcpClient`-style Proxy replacement. The
 *      `getClient(serverName)` getter returns the internal Client, so we
 *      can reach it, but we cannot substitute it.
 *
 *   2. **Low-level: `loadMcpTools(serverName, rawClient)`**, accepts a raw
 *      `@modelcontextprotocol/sdk` Client directly (verified at
 *      `dist/tools.d.ts:28`). For this path, users can construct their own
 *      Client, wrap with the existing `wrapMcpClient` helper, and pass it
 *      in. No new code required, see the example in
 *      `packages/integration/examples/langchain-js/` for the pattern.
 *
 * This adapter handles the high-level `MultiServerMCPClient` path. It walks
 * the multi-client's configured servers, calls `getClient()` on each to reach
 * the internal Client, and monkey-patches `callTool` in place. Structurally
 * the same pattern as `attributeVercelAiSdkMcp` (see D023), with one
 * additional concern documented below.
 *
 * ## Per-call fork propagation
 *
 * LangChain's internal `_callTool` function (verified at `dist/tools.js:384`)
 * supports per-call header changes via `client.fork(headers)`, this creates
 * a new Client instance with different HTTP headers and calls `callTool` on
 * the forked instance, not the original. A naive monkey-patch on the original
 * Client would silently lose attribution for any LangChain user whose tools
 * set per-call headers (the dominant pattern for per-user authentication).
 *
 * The patch therefore ALSO wraps `fork()` when present, so the forked Client
 * is recursively patched before being returned to `_callTool`. This means
 * every forked instance also flows through the Atrib interceptor, no silent
 * attribution drop for header-changing tools.
 *
 * ## Idempotency
 *
 * Each patched Client is marked with `Symbol.for('atrib.langchain-mcp.patched')`.
 * Repeat calls to the helper on the same multi-client, and repeat `fork()`
 * calls on already-patched Clients, are no-ops.
 *
 * ## Order sensitivity
 *
 * The helper is SAFE to call AFTER `multiClient.getTools()` because LangChain's
 * tool `func` captures `client` by closure but dereferences `client.callTool`
 * at invocation time (not at tool construction time, see `dist/tools.js:391`).
 * Patching the client after tools are built still takes effect on the next
 * tool invocation.
 *
 * The helper is also safe to call BEFORE `getTools()`, but in that case
 * `multiClient.getClient(serverName)` will lazily initialize the connection
 * if it hasn't happened yet. For predictable startup, most users will call
 * `await multiClient.initializeConnections()` first, then
 * `await attributeLangchainMcp(multiClient, { interceptor })`.
 */

import type { ToolCallInterceptor } from '../middleware.js'

/**
 * Marker symbol set on a patched client to make repeated patches idempotent.
 */
const ATRIB_PATCHED = Symbol.for('atrib.langchain-mcp.patched')

/**
 * Minimal structural type for a LangChain-extended MCP Client (from
 * `@langchain/mcp-adapters`'s `connection.ts`). This is the MCP SDK Client
 * with an added `fork()` method for per-call header changes. We don't import
 * from `@langchain/mcp-adapters` to avoid a hard dependency on the LangChain
 * ecosystem from `@atrib/agent`.
 *
 * The `callTool` signature mirrors `@modelcontextprotocol/sdk`'s
 * `Client.callTool(params, resultSchema?, options?)`.
 */
export interface LangchainMcpClientLike {
  callTool(
    params: {
      name: string
      arguments?: Record<string, unknown> | undefined
      _meta?: Record<string, unknown> | undefined
    },
    resultSchema?: unknown,
    options?: {
      signal?: AbortSignal | undefined
      timeout?: number | undefined
      onprogress?: ((progress: unknown) => void) | undefined
    },
  ): Promise<unknown>
  fork?(headers: Record<string, string>): Promise<LangchainMcpClientLike>
}

/**
 * Minimal structural type for a LangChain `MultiServerMCPClient`. Mirrors the
 * subset of the public surface we depend on (verified against
 * `@langchain/mcp-adapters@1.1.3` `dist/client.d.ts`).
 *
 * The `config` getter returns a cloned `ClientConfig` whose `mcpServers`
 * field enumerates every configured server by name, this is how we
 * discover which servers to patch without requiring the caller to list
 * them explicitly.
 */
export interface LangchainMultiServerMcpClientLike {
  readonly config: { mcpServers?: Record<string, unknown> | undefined }
  getClient(serverName: string, options?: unknown): Promise<LangchainMcpClientLike | undefined>
}

/** Options for `attributeLangchainMcp`. */
export interface AttributeLangchainMcpOptions {
  /** The Atrib interceptor that observes tool calls on this client. */
  interceptor: ToolCallInterceptor

  /**
   * Optional per-server canonical URL map. Used by the interceptor for
   * content_id derivation when emitting Path 2 transaction records (§5.4.5).
   * Keys are the server names as they appear in the multi-client's
   * `mcpServers` config; values are canonical URLs (e.g.
   * `'https://search.example.com'`).
   */
  serverUrls?: Record<string, string>

  /**
   * Optional list of server names to patch. If omitted, the helper patches
   * every server in the multi-client's `config.mcpServers`. Provide this
   * when you want to selectively attribute only a subset of configured
   * servers (rare, usually you want all of them).
   */
  servers?: string[]
}

/**
 * Patch a LangChain `MultiServerMCPClient` so every outbound `tools/call`
 * flows through Atrib's interceptor lifecycle.
 *
 * Walks the multi-client's configured servers, calls `getClient(serverName)`
 * on each to reach the internal `@modelcontextprotocol/sdk` Client, and
 * monkey-patches `callTool` (and `fork` when present) in place.
 *
 * Idempotent: calling the helper twice on the same multi-client, or calling
 * it on a multi-client with some already-patched servers, is safe. Repeat
 * invocations on already-patched clients are no-ops.
 *
 * Order independent: this helper can be called BEFORE or AFTER
 * `multiClient.getTools()` because LangChain's tool `func` dereferences
 * `client.callTool` at invocation time, not at build time.
 *
 * Returns the number of clients that were newly patched on this call
 * (excludes clients that were already patched from a previous call).
 *
 * Usage:
 *
 *   import { MultiServerMCPClient } from '@langchain/mcp-adapters'
 *   import { ChatAnthropic } from '@langchain/anthropic'
 *   import { createReactAgent } from '@langchain/langgraph/prebuilt'
 *   import { atrib, attributeLangchainMcp } from '@atrib/agent'
 *
 *   const interceptor = atrib({
 *     creatorKey: process.env.ATRIB_PRIVATE_KEY!,
 *     merchantDomain: 'https://merchant.example.com',
 *     serverUrls: ['https://search.example.com'],
 *   })
 *
 *   const multi = new MultiServerMCPClient({
 *     mcpServers: {
 *       search: { transport: 'http', url: 'https://search.example.com/mcp' },
 *     },
 *   })
 *
 *   await multi.initializeConnections()
 *   await attributeLangchainMcp(multi, {
 *     interceptor,
 *     serverUrls: { search: 'https://search.example.com' },
 *   })
 *
 *   const tools = await multi.getTools()
 *   const agent = createReactAgent({
 *     llm: new ChatAnthropic({ model: 'claude-sonnet-4-6' }),
 *     tools,
 *   })
 */
export async function attributeLangchainMcp(
  multiClient: LangchainMultiServerMcpClientLike,
  options: AttributeLangchainMcpOptions,
): Promise<number> {
  const { interceptor, serverUrls = {}, servers } = options
  const configuredServers = servers ?? Object.keys(multiClient.config.mcpServers ?? {})

  let newlyPatched = 0
  for (const serverName of configuredServers) {
    let client: LangchainMcpClientLike | undefined
    try {
      client = await multiClient.getClient(serverName)
    } catch (err) {
      console.warn(
        `atrib: langchain-mcp could not resolve client for server '${serverName}', skipping`,
        err,
      )
      continue
    }
    if (!client) {
      console.warn(
        `atrib: langchain-mcp server '${serverName}' has no client (not initialized?), skipping`,
      )
      continue
    }
    if (patchClient(client, interceptor, serverUrls[serverName])) {
      newlyPatched++
    }
  }
  return newlyPatched
}

/**
 * Patch a single LangChain MCP Client in place. Returns true if the client
 * was newly patched, false if it was already patched from a previous call.
 *
 * Recursive on `fork()`: when the patched `fork` is invoked, the returned
 * forked client is itself passed through `patchClient` before being handed
 * back to LangChain's `_callTool`. This ensures that per-call-header
 * workflows (common for per-user authentication) don't silently lose
 * attribution.
 */
function patchClient(
  client: LangchainMcpClientLike,
  interceptor: ToolCallInterceptor,
  serverUrl: string | undefined,
): boolean {
  if ((client as unknown as Record<symbol, unknown>)[ATRIB_PATCHED] === true) {
    return false
  }

  const originalCallTool = client.callTool.bind(client)

  const patchedCallTool: typeof client.callTool = async (params, resultSchema, opts) => {
    const toolName = params.name
    const existingMeta = (params._meta ?? {}) as Record<string, unknown>

    // §5.4.3: Build outbound _meta via the interceptor. The interceptor
    // returns a record that includes any existing _meta keys plus Atrib's
    // own (atrib token, traceparent, tracestate, baggage, X-Atrib-Chain).
    let outboundMeta: Record<string, unknown> | undefined
    try {
      outboundMeta = await interceptor.onBeforeToolCall(toolName, existingMeta)
    } catch (err) {
      // §5.8 degradation: pass through with the original params on failure
      console.warn('atrib: langchain-mcp onBeforeToolCall failed, passing through', err)
      outboundMeta = undefined
    }

    // Construct new params rather than mutating, caller's reference is preserved.
    const forwardedParams = outboundMeta !== undefined ? { ...params, _meta: outboundMeta } : params

    const result = await originalCallTool(forwardedParams, resultSchema, opts)

    // §5.4.4: Update session state from the response _meta.
    try {
      const responseMeta = ((result as { _meta?: Record<string, unknown> })?._meta ?? {}) as Record<
        string,
        unknown
      >
      const responseOptions = serverUrl !== undefined ? { serverUrl } : {}
      interceptor.onAfterToolResponse(toolName, result, responseMeta, responseOptions)
    } catch (err) {
      console.warn('atrib: langchain-mcp onAfterToolResponse failed, passing through', err)
    }

    return result
  }

  ;(client as unknown as { callTool: typeof patchedCallTool }).callTool = patchedCallTool

  // Fork propagation: LangChain's _callTool creates a new Client via fork()
  // when per-call header changes are requested (dist/tools.js:384). The
  // forked client needs its own callTool patch, or it silently bypasses
  // Atrib. We wrap fork so the returned forked client is patched recursively
  // before being handed back to the caller.
  if (typeof client.fork === 'function') {
    const originalFork = client.fork.bind(client)
    const patchedFork = async (
      headers: Record<string, string>,
    ): Promise<LangchainMcpClientLike> => {
      const forkedClient = await originalFork(headers)
      patchClient(forkedClient, interceptor, serverUrl)
      return forkedClient
    }
    ;(client as unknown as { fork: typeof patchedFork }).fork = patchedFork
  }

  ;(client as unknown as Record<symbol, unknown>)[ATRIB_PATCHED] = true
  return true
}
