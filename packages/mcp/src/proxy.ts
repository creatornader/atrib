// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/mcp proxy — in-process McpServer that forwards tool calls to an
 * upstream MCP server with attribution applied at the proxy layer.
 *
 * Use this when you want to attribute tool calls flowing through a third-party
 * MCP server (e.g. `@modelcontextprotocol/server-filesystem`) and your host
 * accepts an in-process `McpServer` instance.
 *
 * The canonical use case is the Claude Agent SDK's `{ type: 'sdk', name,
 * instance: McpServer }` config: hosts that accept an in-process McpServer can
 * receive the proxy directly. For user-built tools (where the consumer
 * constructs their own `McpServer` and registers tools on it), the proxy is
 * NOT needed — apply `atrib()` to the user's `McpServer` directly. The proxy
 * exists specifically for the case where the tools live in an upstream
 * process the host doesn't run itself.
 *
 * Architecture:
 *
 *   ┌────────────────────────┐    in-process    ┌─────────────────────┐
 *   │ host (Claude Agent SDK,│ ───[ tools/* ]──▶│ proxy McpServer     │
 *   │ Cloudflare Agents, …)  │                   │   (atrib() applied) │
 *   └────────────────────────┘                   └──────────┬──────────┘
 *                                                            │
 *                                                            │ forwards via
 *                                                            │ Client over
 *                                                            ▼ stdio/http/sse
 *                                                  ┌─────────────────────┐
 *                                                  │ upstream MCP server │
 *                                                  │ (third-party)       │
 *                                                  └─────────────────────┘
 *
 * Attribution records are emitted at the proxy layer, on the in-process side.
 * The upstream sees a normal `tools/call` request with no Atrib metadata; the
 * forwarder strips Atrib's outbound `_meta.atrib` token before sending
 * upstream so the upstream's response shape is unchanged.
 *
 * Per spec §3.1 (graph records structure, not causality), the proxy never
 * inspects upstream responses for semantic content — it forwards the response
 * unchanged after attribution. Per §5.8, any failure on the upstream side is
 * surfaced to the host as a tool error; Atrib stays out of the failure path.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { atrib, type AtribOptions, type AtribServer } from './middleware.js'

/** Upstream MCP server transport options. */
export type UpstreamTransport =
  | {
      type: 'stdio'
      /** Executable to spawn (e.g. 'node', 'npx', 'python') */
      command: string
      /** Command-line arguments */
      args?: string[]
      /** Environment variables for the child process */
      env?: Record<string, string>
    }
  | {
      type: 'http'
      /** Streamable HTTP endpoint URL */
      url: string
      /** Custom HTTP headers */
      headers?: Record<string, string>
    }
  | {
      type: 'inMemory'
      /** Pre-built in-process Transport (used for testing). */
      transport: Transport
    }

// Note on SSE: the MCP SDK's `SSEClientTransport` is marked deprecated as of
// 1.29.0 in favor of Streamable HTTP. We do NOT add a `type: 'sse'` upstream
// option here so we don't bake a deprecated transport into our public API.
// Users with a legacy SSE upstream can still construct their own
// `SSEClientTransport` and pass it via `{ type: 'inMemory', transport }`.

/** Options for createAtribProxy(). */
export interface AtribProxyOptions {
  /**
   * Display name for the proxy McpServer. Surfaces to the host as the
   * server identifier (e.g. used by Claude Agent SDK to namespace tool names
   * as `mcp__<name>__<tool>`).
   */
  name: string

  /** Server version reported via the MCP initialize handshake. Defaults to '0.0.0'. */
  version?: string

  /** Upstream MCP server transport — what the proxy forwards calls to. */
  upstream: UpstreamTransport

  /** Atrib middleware options applied to the in-process side of the proxy. */
  atrib: AtribOptions
}

/** Result of createAtribProxy(). */
export interface AtribProxy {
  /**
   * The wrapped local McpServer. Pass this to your host:
   *
   *   - Claude Agent SDK: `{ type: 'sdk', name, instance: proxy.server }`
   *   - Cloudflare Agents: register on the agent's MCP surface
   *   - Any other host that accepts an `McpServer` instance
   *
   * The host owns connecting the McpServer to its own transport (it will call
   * `proxy.server.connect(hostTransport)`). The proxy does NOT pre-connect
   * the McpServer to anything.
   */
  server: AtribServer

  /**
   * Live upstream MCP client. Exposed for advanced control (custom shutdown
   * coordination, manual ping, etc.). Most callers should never need this.
   */
  upstreamClient: Client

  /**
   * Disconnect the upstream client cleanly. Does NOT close the in-process
   * McpServer — the host owns that lifecycle.
   */
  close(): Promise<void>
}

/**
 * Create an in-process McpServer that proxies all tool calls to an upstream
 * MCP server, with `atrib()` middleware applied to the in-process side.
 *
 * The proxy connects to the upstream during construction and lists its tools.
 * The returned McpServer exposes the same tool catalog as the upstream and
 * forwards every `tools/call` to the upstream client.
 *
 * Tool list is captured once at construction; dynamic refresh is V2 (see
 * DECISIONS D021). For now, restart the proxy if the upstream changes its
 * tool catalog.
 */
export async function createAtribProxy(options: AtribProxyOptions): Promise<AtribProxy> {
  // ── 1. Connect upstream client ───────────────────────────────────────
  const upstreamTransport = createUpstreamTransport(options.upstream)
  const upstreamClient = new Client({
    name: `atrib-proxy:${options.name}`,
    version: options.version ?? '0.0.0',
  })
  await upstreamClient.connect(upstreamTransport)

  // ── 2. Snapshot upstream tool catalog ────────────────────────────────
  // Captured once at construction. Dynamic refresh is a V2 deferral.
  const upstreamTools = await upstreamClient.listTools()

  // ── 3. Build local McpServer with explicit tools capability ──────────
  // We declare the tools capability up-front so the host's MCP initialize
  // handshake reflects that this server serves tools. We do NOT use
  // McpServer.registerTool() here because that API expects Zod-shape input
  // schemas, but the upstream returns JSON Schema. Going low-level via
  // setRequestHandler lets us pass JSON Schema through unchanged.
  const localServer = new McpServer(
    { name: options.name, version: options.version ?? '0.0.0' },
    { capabilities: { tools: {} } },
  )

  // ── 4. Apply atrib() middleware BEFORE registering handlers ──────────
  // Order matters: atrib() patches setRequestHandler to wrap the
  // tools/call handler at registration time. If we register tools/call
  // first, the patch's setRequestHandler interception would not see it
  // (atrib() does retroactively rewrite an already-registered handler,
  // but the canonical pattern is wrap-then-register and that's what we
  // do here).
  const wrappedServer = atrib(localServer, options.atrib)

  // ── 5. Register tools/list — return the upstream's snapshot ──────────
  // The underlying low-level Server is McpServer.server. setRequestHandler
  // is now patched by atrib(), but the patch passes through any request
  // schema that is NOT tools/call, so this registration is safe.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const underlying = (wrappedServer as any).server

  underlying.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: upstreamTools.tools }))

  // ── 6. Register tools/call — forward to upstream client ──────────────
  // atrib()'s patched setRequestHandler will wrap this handler with the
  // attribution lifecycle. Every tools/call lands here AFTER attribution
  // has run; the forwarder calls the upstream and returns the result
  // unchanged. Per §5.8 if the upstream throws, the error propagates to
  // the host and atrib's outer try/catch ensures the failure stays
  // contained.
  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const { name, arguments: args } = request.params
      const result = await upstreamClient.callTool({
        name,
        arguments: args ?? {},
      })
      return result
    },
  )

  // ── 7. Return the proxy handle ───────────────────────────────────────
  return {
    server: wrappedServer,
    upstreamClient,
    async close() {
      await upstreamClient.close()
    },
  }
}

/**
 * Build a Client Transport for the requested upstream transport type.
 *
 * Stdio spawns a child process. http/sse open a network connection. inMemory
 * uses a pre-built Transport (intended for tests).
 */
function createUpstreamTransport(spec: UpstreamTransport): Transport {
  switch (spec.type) {
    case 'stdio':
      return new StdioClientTransport({
        command: spec.command,
        args: spec.args ?? [],
        ...(spec.env ? { env: spec.env } : {}),
      })
    case 'http':
      // The SDK's StreamableHTTPClientTransport `implements Transport`, but
      // its `sessionId?: string` getter is structurally incompatible with
      // `Transport.sessionId?: string` under exactOptionalPropertyTypes (the
      // getter returns `string | undefined`, the interface expects `string`
      // when present). Cast through `unknown` — the runtime conformance is
      // guaranteed by `implements Transport` on the SDK side.
      return new StreamableHTTPClientTransport(new URL(spec.url), {
        ...(spec.headers ? { requestInit: { headers: spec.headers } } : {}),
      }) as unknown as Transport
    case 'inMemory':
      return spec.transport
  }
}
