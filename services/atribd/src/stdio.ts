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

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import {
  callWithToolTimeout,
  createAtribdBackend,
  readPackageVersion,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './backend.js'
import { createAtribdServer, DEFAULT_TOOLS_LIST_TTL_MS } from './http-host.js'

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
  const server = createAtribdServer({
    getBackend: async () => backend,
    toolsListTtlMs,
  })

  return {
    server,
    tools: backend.tools,
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
 * calls to a host-owned atribd HTTP endpoint. Works against both the
 * legacy session host and the stateless host (the client's initialize is
 * answered without session issuance and later requests carry no session).
 */
export async function createAtribdHttpProxyRuntime(
  endpoint: string,
  options: AtribdRuntimeOptions = {},
): Promise<AtribdRuntime> {
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const upstreamTransport = new StreamableHTTPClientTransport(new URL(endpoint))
  const upstream = new Client({
    name: 'atribd-stdio-http-proxy',
    version: readPackageVersion(),
  })
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

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed.tools }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callWithToolTimeout(
      request.params.name,
      toolTimeoutMs,
      () => upstream.callTool(request.params) as Promise<CallToolResult>,
    )
  })

  return {
    server,
    tools: listed.tools,
    toolNames: listed.tools.map((tool) => tool.name),
    flush: async () => {},
    close: async () => {
      await Promise.allSettled([server.close(), upstream.close(), upstreamTransport.close()])
    },
  }
}
