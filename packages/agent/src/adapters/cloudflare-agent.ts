/**
 * Adapter: attribute MCP tool calls flowing through a Cloudflare Agent.
 *
 * Cloudflare's `agents` package exposes two MCP integration surfaces:
 *
 *   1. **Server-side `McpAgent`** — you build an MCP server inside a Worker
 *      by extending `McpAgent` and defining tools on `this.server`. Because
 *      `this.server` is a real `McpServer` from `@modelcontextprotocol/sdk`,
 *      you wrap it directly with `atrib()` from `@atrib/mcp` — no helper
 *      needed. See `packages/integration/examples/cloudflare-agents/` for
 *      the runnable McpAgent example.
 *
 *   2. **Client-side `Agent.addMcpServer`** — your `Agent` (or `AIChatAgent`)
 *      connects to one or more upstream MCP servers via `this.addMcpServer(name, url)`.
 *      Cloudflare's `MCPClientManager` constructs an `@modelcontextprotocol/sdk`
 *      Client per upstream and stores it on `agent.mcp.mcpConnections[name].client`.
 *      Tool invocations flow through `MCPClientManager.callTool()` which
 *      delegates straight to `mcpConnections[serverId].client.callTool(...)`
 *      (verified against `agents@0.9.0` `dist/client-BwgM3cRz.js` line 1444).
 *
 * This file is the helper for surface (2). It walks `agent.mcp.mcpConnections`
 * after the agent has finished registering its upstream MCP servers and
 * replaces each connection's `client` field with one wrapped by `wrapMcpClient`.
 * Subsequent tool calls go through Atrib's interceptor lifecycle.
 *
 * Usage:
 *
 *   import { Agent } from 'agents'
 *   import { atrib, attributeCloudflareAgentMcp } from '@atrib/agent'
 *
 *   class WeatherAgent extends Agent<Env> {
 *     interceptor = atrib({
 *       creatorKey: this.env.ATRIB_PRIVATE_KEY,
 *       merchantDomain: 'https://merchant.example.com',
 *       serverUrls: ['https://weather-mcp.example.com'],
 *     })
 *
 *     async onStart() {
 *       await this.addMcpServer('weather', 'https://weather-mcp.example.com/mcp', {
 *         transport: { type: 'streamable-http' },
 *       })
 *
 *       // After all addMcpServer() calls complete, attribute the connections.
 *       attributeCloudflareAgentMcp(this, { interceptor: this.interceptor })
 *     }
 *   }
 *
 * If you call `addMcpServer` again later (e.g. in a message handler or after
 * an OAuth flow completes), call `attributeCloudflareAgentMcp` again. The
 * helper is idempotent — connections that are already wrapped are skipped.
 *
 * Per spec §5.8 (degradation contract), if any single connection fails to wrap
 * (missing `client` field, unexpected shape), the helper logs a warning with
 * the `atrib:` prefix and skips it without throwing. The agent's tool calls
 * continue to work — they just won't be attributed for that connection.
 */

import { wrapMcpClient, type MinimalMcpClient } from './mcp-client.js'
import type { ToolCallInterceptor } from '../middleware.js'

/** Runtime check that an unknown value structurally matches MinimalMcpClient. */
function isMinimalMcpClient(v: unknown): v is MinimalMcpClient {
  return (
    v != null &&
    typeof v === 'object' &&
    typeof (v as { callTool?: unknown }).callTool === 'function'
  )
}

/**
 * Marker symbol set on a wrapped client to make repeated calls to
 * `attributeCloudflareAgentMcp` idempotent. The Proxy returned by
 * `wrapMcpClient` carries this property; the unwrapped Client does not.
 */
const ATRIB_WRAPPED = Symbol.for('atrib.cloudflare.wrapped')

/**
 * Minimal structural type for a Cloudflare `Agent` we can attribute. Mirrors
 * the public surface of `agents`'s `Agent` class without importing from
 * `agents` (we don't want a hard dependency on the Cloudflare package).
 *
 * `client` is typed as `unknown` here rather than `MinimalMcpClient` so the
 * real Cloudflare `MCPClientConnection.client: Client` from
 * `@modelcontextprotocol/sdk` is structurally assignable without forcing
 * users to cast at the call site. The helper performs a runtime check on
 * each connection's `client` shape before wrapping.
 */
export interface CloudflareAgentLike {
  mcp: {
    mcpConnections: Record<
      string,
      {
        client: unknown
        url?: URL | string
      }
    >
  }
}

/** Options for `attributeCloudflareAgentMcp`. */
export interface AttributeCloudflareAgentMcpOptions {
  /** The Atrib interceptor that should observe tool calls on this agent. */
  interceptor: ToolCallInterceptor

  /**
   * Optional override map of server name → canonical serverUrl. If a server
   * name appears here, the helper passes that URL as the `serverUrl` option
   * to `wrapMcpClient`. If a server name is missing from this map, the helper
   * derives serverUrl from the connection's own `url.origin`.
   *
   * Override when the upstream URL the agent connects to is not the canonical
   * URL you want to record in attribution records (e.g. you're hitting a
   * reverse proxy or staging endpoint but want production identity).
   */
  serverUrls?: Record<string, string>
}

/**
 * Wrap every currently-connected MCP client on a Cloudflare Agent with Atrib
 * attribution. Returns the number of connections wrapped (excluding ones that
 * were already wrapped). Idempotent — safe to call multiple times.
 *
 * Call this in `onStart()` after your `addMcpServer()` calls. If you add more
 * MCP servers later (in a message handler, after OAuth, etc.), call again.
 */
export function attributeCloudflareAgentMcp(
  agent: CloudflareAgentLike,
  options: AttributeCloudflareAgentMcpOptions,
): number {
  const connections = agent.mcp?.mcpConnections
  if (!connections || typeof connections !== 'object') {
    console.warn(
      'atrib: attributeCloudflareAgentMcp called on an agent with no mcp.mcpConnections — ' +
        "the Cloudflare 'agents' package shape may have changed. Skipping.",
    )
    return 0
  }

  let wrapped = 0

  for (const [name, conn] of Object.entries(connections)) {
    try {
      if (!conn || !isMinimalMcpClient(conn.client)) {
        console.warn(
          `atrib: connection '${name}' has no client field, skipping`,
        )
        continue
      }

      // Skip already-wrapped clients (idempotency)
      if ((conn.client as unknown as Record<symbol, unknown>)[ATRIB_WRAPPED] === true) {
        continue
      }

      // Derive serverUrl: explicit override > connection.url.origin > undefined
      let serverUrl: string | undefined = options.serverUrls?.[name]
      if (!serverUrl && conn.url) {
        try {
          const u = conn.url instanceof URL ? conn.url : new URL(conn.url)
          serverUrl = u.origin
        } catch {
          // URL parse failed; let wrapMcpClient fall back to no serverUrl
        }
      }

      const wrappedClient = wrapMcpClient(
        conn.client,
        options.interceptor,
        serverUrl ? { serverUrl } : {},
      )

      // Mark as wrapped so a second call to this helper doesn't double-wrap.
      // The Proxy returned by wrapMcpClient is safe to add a Symbol property
      // to via direct assignment because the proxy's `set` trap (default) is
      // a passthrough.
      ;(wrappedClient as unknown as Record<symbol, unknown>)[ATRIB_WRAPPED] = true

      // Replace the client field in place. MCPClientManager.callTool reads
      // mcpConnections[serverId].client at invocation time, so subsequent
      // tool calls will go through the wrapped client.
      conn.client = wrappedClient
      wrapped++
    } catch (err) {
      // §5.8 degradation contract: never let a single bad connection break
      // the whole agent. Log and continue.
      console.warn(
        `atrib: failed to wrap MCP connection '${name}', skipping:`,
        err,
      )
    }
  }

  return wrapped
}
