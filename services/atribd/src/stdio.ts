// SPDX-License-Identifier: Apache-2.0

/**
 * stdio surfaces of atribd.
 *
 * The stdio shim exists for startup-spawn harnesses that can only spawn
 * per-thread MCP child processes. On this surface the ambient context
 * ladder is unchanged: explicit argument > `_meta` carriers > `ATRIB_CONTEXT_ID`
 * env > harness registry env > fallback file > undefined, per D078/D083.
 * The stateless explicit-required policy applies to the HTTP surface only.
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Server, type CallToolResult, type Tool } from '@modelcontextprotocol/server'
import {
  callWithToolTimeout,
  createAtribdBackend,
  readPackageVersion,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './backend.js'
import { createAtribdModernServer, DEFAULT_TOOLS_LIST_TTL_MS } from './http-host.js'

export interface AtribdRuntime {
  server: Server
  tools: Tool[]
  toolNames: string[]
  flush(): Promise<void>
  close(): Promise<void>
}

export interface AtribdRuntimeOptions {
  toolTimeoutMs?: number
  toolsListTtlMs?: number
}

/** In-process stdio runtime: mounts the primitives and serves them directly. */
export async function createAtribdRuntime(
  options: AtribdRuntimeOptions = {},
): Promise<AtribdRuntime> {
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const toolsListTtlMs = options.toolsListTtlMs ?? DEFAULT_TOOLS_LIST_TTL_MS
  const backend = await createAtribdBackend({ toolTimeoutMs })
  const server = createAtribdModernServer({
    getBackend: async () => backend,
    toolsListTtlMs,
  })

  return {
    server,
    tools: backend.tools as unknown as Tool[],
    toolNames: backend.toolNames,
    flush: backend.flush,
    close: async () => {
      await backend.flush()
      await server.close()
      await backend.close()
    },
  }
}

/**
 * stdio-to-HTTP proxy shim: a lightweight stdio child that forwards MCP
 * calls to a host-owned atribd HTTP endpoint. The v2 client negotiates the
 * modern stateless protocol and the daemon keeps legacy handling at its HTTP
 * compatibility boundary.
 */
export async function createAtribdHttpProxyRuntime(
  endpoint: string,
  options: AtribdRuntimeOptions = {},
): Promise<AtribdRuntime> {
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const upstreamTransport = new StreamableHTTPClientTransport(new URL(endpoint))
  const upstream = new Client(
    {
      name: 'atribd-stdio-http-proxy',
      version: readPackageVersion(),
    },
    { versionNegotiation: { mode: 'auto' } },
  )
  await upstream.connect(upstreamTransport)
  const listed = await upstream.listTools()
  const server = new Server(
    {
      name: 'atribd-stdio-http-proxy',
      version: readPackageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions:
        'Lightweight stdio proxy for atribd. It forwards MCP calls to a host-owned stateless HTTP daemon.',
    },
  )

  server.setRequestHandler('tools/list', async () => ({ tools: listed.tools }))
  server.setRequestHandler('tools/call', async (request) => {
    return callWithToolTimeout(
      request.params.name,
      toolTimeoutMs,
      () => upstream.callTool(request.params) as never,
    ) as unknown as CallToolResult
  })

  return {
    server,
    tools: listed.tools as Tool[],
    toolNames: listed.tools.map((tool) => tool.name),
    flush: async () => {},
    close: async () => {
      await Promise.allSettled([server.close(), upstream.close(), upstreamTransport.close()])
    },
  }
}
