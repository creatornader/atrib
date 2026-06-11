#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * Private dogfood runtime for the seven atrib cognitive primitives.
 *
 * Each public primitive package still owns its implementation and standalone
 * binary. This runtime mounts those MCP servers in process and exposes their
 * tools through one stdio server. Hosts that can only configure per-thread MCP
 * servers still spawn one process per thread, but they no longer spawn seven
 * atrib primitive processes per thread.
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { createAtribEmitServer } from '@atrib/emit'
import { createAtribAnnotateServer } from '@atrib/annotate'
import { createAtribReviseServer } from '@atrib/revise'
import { createAtribRecallServer } from '@atrib/recall'
import { createAtribTraceServer } from '@atrib/trace'
import { createAtribSummarizeServer } from '@atrib/summarize'
import { createAtribVerifyServer } from '@atrib/verify-mcp'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

interface PrimitiveHandle {
  mcp: McpServer
  flush?: (() => Promise<void>) | undefined
}

interface MountedPrimitive {
  name: string
  handle: PrimitiveHandle
  client: Client
  tools: Tool[]
}

interface ToolRoute {
  primitive: string
  client: Client
}

export interface AtribPrimitivesRuntime {
  server: Server
  tools: Tool[]
  toolNames: string[]
  flush(): Promise<void>
  close(): Promise<void>
}

type PrimitiveFactory = () => Promise<PrimitiveHandle> | PrimitiveHandle

const PRIMITIVES: readonly [string, PrimitiveFactory][] = [
  ['emit', createAtribEmitServer],
  ['annotate', createAtribAnnotateServer],
  ['revise', createAtribReviseServer],
  ['recall', createAtribRecallServer],
  ['trace', createAtribTraceServer],
  ['summarize', createAtribSummarizeServer],
  ['verify', createAtribVerifyServer],
]

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function mountPrimitive(name: string, factory: PrimitiveFactory): Promise<MountedPrimitive> {
  const handle = await factory()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await handle.mcp.connect(serverTransport)

  const client = new Client({
    name: `atrib-primitives-${name}`,
    version: readPackageVersion(),
  })
  await client.connect(clientTransport)

  const listed = await client.listTools()
  return { name, handle, client, tools: listed.tools }
}

export async function createAtribPrimitivesRuntime(): Promise<AtribPrimitivesRuntime> {
  const mounted = await Promise.all(
    PRIMITIVES.map(([name, factory]) => mountPrimitive(name, factory)),
  )
  const routeByTool = new Map<string, ToolRoute>()
  const tools: Tool[] = []

  for (const primitive of mounted) {
    for (const tool of primitive.tools) {
      const existing = routeByTool.get(tool.name)
      if (existing) {
        throw new Error(
          `duplicate atrib primitive tool ${tool.name}: ${existing.primitive} and ${primitive.name}`,
        )
      }
      routeByTool.set(tool.name, { primitive: primitive.name, client: primitive.client })
      tools.push(tool)
    }
  }

  tools.sort((a, b) => a.name.localeCompare(b.name))

  const server = new Server(
    {
      name: 'atrib-primitives',
      version: readPackageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions:
        'One local MCP runtime exposing all seven atrib cognitive primitives. ' +
        'Use this instead of per-primitive stdio servers when a harness supports only per-thread MCP spawning.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const route = routeByTool.get(request.params.name)
    if (!route) {
      throw new McpError(ErrorCode.MethodNotFound, `unknown atrib primitive tool: ${request.params.name}`)
    }
    return route.client.callTool({
      name: request.params.name,
      arguments: request.params.arguments,
      _meta: request.params._meta,
    }) as Promise<CallToolResult>
  })

  return {
    server,
    tools,
    toolNames: tools.map((tool) => tool.name),
    flush: async () => {
      await Promise.all(mounted.map((primitive) => primitive.handle.flush?.() ?? Promise.resolve()))
    },
    close: async () => {
      await Promise.allSettled(mounted.map((primitive) => primitive.handle.flush?.() ?? Promise.resolve()))
      await Promise.allSettled(mounted.map((primitive) => primitive.client.close()))
      await Promise.allSettled(mounted.map((primitive) => primitive.handle.mcp.close()))
      await server.close()
    },
  }
}

async function main(): Promise<void> {
  const runtime = await createAtribPrimitivesRuntime()
  const shutdown = async () => {
    try {
      await runtime.close()
    } finally {
      process.exit(0)
    }
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const transport = new StdioServerTransport()
  await runtime.server.connect(transport)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(
      `atrib-primitives: fatal ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
    )
    process.exit(1)
  })
}
