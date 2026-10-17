// SPDX-License-Identifier: Apache-2.0

/**
 * Attribute calls from LangChain MCPAdapter 2.x and MultiServerMCPClient 1.x.
 * Discover servers from the configuration snapshot, then wrap each internal
 * client's callTool method and mutable forks. LangChain 2.0.1 exposes a mutable
 * fork method, but cached tools capture it before attribution setup. Use loader
 * mode for those per-call header callbacks. The 1.1.3 proxy synthesizes fork on
 * reads, so it needs loader mode for per-call headers; an unreplaceable fork produces a warning.
 *
 * Loader mode rebuilds callbacks around wrapMcpClient while retaining cached
 * tool objects. Forward the SDK's naming and hook options to loadMcpTools.
 * Select a mode on the first helper call. Mixing modes is rejected to avoid
 * duplicate attribution. Both modes are idempotent and preserve tool errors.
 */

import type { ToolCallInterceptor } from '../middleware.js'
import { extractResponseHeaders } from '../response-headers.js'
import { wrapMcpClient, type MinimalMcpClient } from './mcp-client.js'

/**
 * Marker symbol set on a patched client to make repeated patches idempotent.
 */
const ATRIB_PATCHED = Symbol.for('atrib.langchain-mcp.patched')
const attributedTools = new WeakSet<object>()
const loaderClients = new WeakSet<object>()

export interface LangchainMcpToolLike {
  name: string
  func: (...args: never[]) => unknown
}

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
      signal?: AbortSignal
      timeout?: number
      onprogress?: (progress: unknown) => void
    },
  ): Promise<unknown>
  fork?(headers: Record<string, string>): Promise<LangchainMcpClientLike>
}

/**
 * Minimal structural type for a LangChain `MultiServerMCPClient`. Mirrors the
 * subset used from MCPAdapter 2.0.1 and MultiServerMCPClient 1.1.3.
 *
 * The snapshot uses `servers` in 2.x and `mcpServers` in 1.x. Neither
 * snapshot can reconfigure an existing client.
 */
export interface LangchainMultiServerMcpClientLike<
  C extends LangchainMcpClientLike = LangchainMcpClientLike,
  T extends LangchainMcpToolLike = LangchainMcpToolLike,
> {
  readonly config: {
    servers?: Record<string, unknown> | undefined
    mcpServers?: Record<string, unknown> | undefined
  }
  getClient(serverName: string, options?: unknown): Promise<C | undefined>
  listTools?(serverName: string): Promise<T[]>
  getTools?(serverName: string): Promise<T[]>
}

/** Options for `attributeLangchainMcp`. */
export interface AttributeLangchainMcpOptions<
  C extends LangchainMcpClientLike = LangchainMcpClientLike,
  T extends LangchainMcpToolLike = LangchainMcpToolLike,
> {
  /**
   * Rebuild native tool callbacks around a wrapped client, preserving cached
   * tool objects. Forward the SDK's original tool naming and hook options.
   * Use this mode on the first helper call for native proxy fork factories.
   */
  loadTools?: (serverName: string, client: C) => Promise<T[]>
  /** The atrib interceptor that observes tool calls on this client. */
  interceptor: ToolCallInterceptor

  /**
   * Optional per-server canonical URL map. Used by the interceptor for
   * content_id derivation when emitting Path 2 transaction records (§5.4.5).
   * Keys are the server names as they appear in the multi-client's
   * `servers` or `mcpServers` config; values are canonical URLs (e.g.
   * `'https://search.example.com'`).
   */
  serverUrls?: Record<string, string>

  /**
   * Optional list of server names to patch. If omitted, the helper patches
   * every server in the multi-client's `config.mcpServers`. Provide this
   * when you want to selectively attribute only a subset of configured
   * servers (rare. usually you want all of them).
   */
  servers?: string[]
}

/**
 * Attribute a LangChain MCPAdapter or MultiServerMCPClient.
 *
 * In-place mode patches base calls and mutable fork methods. Cached LangChain
 * 2.x tool callbacks retain their original fork, so per-call headers need
 * loader mode. Loader mode replaces callbacks without replacing tool objects.
 * Forward the SDK's naming and hook options in loadTools.
 *
 * Calling the helper again in the same mode is idempotent. The return value
 * counts newly attributed clients. Attribution errors preserve tool behavior
 * under the degradation contract in spec section 5.8.
 *
 * @example
 * const toolOptions = { prefixToolNameWithServerName: true }
 * const multi = new MCPAdapter({ servers, ...toolOptions })
 * const tools = await multi.listTools()
 * await attributeLangchainMcp(multi, {
 *   interceptor,
 *   loadTools: (name, client) => loadMcpTools(name, client, toolOptions),
 * })
 */
export async function attributeLangchainMcp<
  C extends LangchainMcpClientLike,
  T extends LangchainMcpToolLike,
>(
  multiClient: LangchainMultiServerMcpClientLike<C, T>,
  options: AttributeLangchainMcpOptions<C, T>,
): Promise<number> {
  const { interceptor, serverUrls = {}, servers } = options
  const config = multiClient.config
  const configuredServers = servers ?? Object.keys(config.servers ?? config.mcpServers ?? {})

  let newlyPatched = 0
  for (const serverName of configuredServers) {
    let client: C | undefined
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
    if (options.loadTools !== undefined) {
      if ((client as unknown as Record<symbol, unknown>)[ATRIB_PATCHED]) {
        throw new TypeError(
          'atrib: choose loadTools on the first call; do not combine attribution modes',
        )
      }
      const listTools = multiClient.listTools ?? multiClient.getTools
      if (typeof listTools !== 'function') {
        throw new TypeError('atrib: langchain-mcp loadTools requires listTools or getTools')
      }
      const tools = await listTools.call(multiClient, serverName)
      if (tools.every((tool) => attributedTools.has(tool))) continue
      // The SDK loader expects MCP results. Retain the concrete caller client
      // type while bridging the legacy structural interface's unknown result.
      const wrapped = wrapMcpClient(client as C & MinimalMcpClient, interceptor, {
        ...(serverUrls[serverName] ? { serverUrl: serverUrls[serverName] } : {}),
      })
      const replacements = await options.loadTools(serverName, wrapped)
      const byName = new Map(replacements.map((tool) => [tool.name, tool]))
      for (const tool of tools) {
        if (!byName.has(tool.name)) {
          throw new Error(
            `atrib: langchain-mcp loader omitted tool '${tool.name}'; preserve SDK tool naming options`,
          )
        }
      }
      for (const tool of tools) {
        if (attributedTools.has(tool)) continue
        tool.func = byName.get(tool.name)!.func
        attributedTools.add(tool)
      }
      loaderClients.add(client)
      newlyPatched++
      continue
    }
    if (loaderClients.has(client)) {
      throw new TypeError('atrib: do not combine loader and in-place attribution modes')
    }
    if (patchClient(client, interceptor, serverUrls[serverName])) {
      newlyPatched++
      if (
        config.servers !== undefined &&
        typeof multiClient.listTools === 'function' &&
        typeof client.fork === 'function'
      ) {
        console.warn(
          'atrib: LangChain 2 cached tools capture fork before attribution; supply loadTools for per-call headers',
        )
      }
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
    // returns a record that includes any existing _meta keys plus atrib's
    // own (atrib token, traceparent, tracestate, baggage, X-Atrib-Chain).
    let outboundMeta: Record<string, unknown> | undefined
    try {
      outboundMeta = await interceptor.onBeforeToolCall(toolName, existingMeta)
    } catch (err) {
      // §5.8 degradation: pass through with the original params on failure
      console.warn('atrib: langchain-mcp onBeforeToolCall failed, passing through', err)
      outboundMeta = undefined
    }

    // Construct new params rather than mutating. caller's reference is preserved.
    const forwardedParams = outboundMeta !== undefined ? { ...params, _meta: outboundMeta } : params

    const result = await originalCallTool(forwardedParams, resultSchema, opts)

    // §5.4.4: Update session state from the response _meta.
    try {
      const responseMeta = ((result as { _meta?: Record<string, unknown> })?._meta ?? {}) as Record<
        string,
        unknown
      >
      const responseHeaders = extractResponseHeaders(result)
      const responseOptions = {
        ...(serverUrl !== undefined ? { serverUrl } : {}),
        ...(responseHeaders !== undefined ? { headers: responseHeaders } : {}),
        isError: (result as Record<string, unknown>)?.isError === true,
      }
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
  // atrib. We wrap fork so the returned forked client is patched recursively
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
    const descriptor = Object.getOwnPropertyDescriptor(client, 'fork')
    const installed = Reflect.set(client, 'fork', patchedFork)
    if (!installed || client.fork !== patchedFork) {
      if (installed) {
        if (descriptor) Object.defineProperty(client, 'fork', descriptor)
        else Reflect.deleteProperty(client, 'fork')
      }
      console.warn(
        'atrib: langchain-mcp cannot replace this client fork; supply loadTools or use loadMcpTools with wrapMcpClient for per-call headers',
      )
    }
  }

  ;(client as unknown as Record<symbol, unknown>)[ATRIB_PATCHED] = true
  return true
}
