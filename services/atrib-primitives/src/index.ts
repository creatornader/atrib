#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * Private dogfood runtime for the seven atrib cognitive primitives.
 *
 * Each public primitive package still owns its implementation and standalone
 * binary. This runtime mounts those MCP servers in process and exposes their
 * tools through one MCP server. Stdio mode reduces per-thread process count.
 * Streamable HTTP mode lets startup-spawn harnesses share one host process.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
  isInitializeRequest,
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
type TransportMode = 'stdio' | 'streamable-http'

interface CliOptions {
  transport: TransportMode
  host: string
  port: number
  path: string
  json: boolean
  sessionIdleMs: number
  help: boolean
}

interface HttpSession {
  runtime: AtribPrimitivesRuntime
  transport: StreamableHTTPServerTransport
  sessionId?: string
  createdAt: number
  lastSeenAt: number
  closing: boolean
}

export interface AtribPrimitivesHttpHost {
  endpoint: string
  healthEndpoint: string
  server: HttpServer
  close(): Promise<void>
}

export interface AtribPrimitivesHttpHostOptions {
  host?: string
  port?: number
  path?: string
  jsonReady?: boolean
  sessionIdleMs?: number
}

const DEFAULT_HTTP_HOST = '127.0.0.1'
const DEFAULT_HTTP_PORT = 8796
const DEFAULT_HTTP_PATH = '/mcp'
const DEFAULT_SESSION_IDLE_MS = 12 * 60 * 60 * 1000
const MAX_JSON_BODY_BYTES = 1024 * 1024

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
      throw new McpError(
        ErrorCode.MethodNotFound,
        `unknown atrib primitive tool: ${request.params.name}`,
      )
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
      await Promise.allSettled(
        mounted.map((primitive) => primitive.handle.flush?.() ?? Promise.resolve()),
      )
      await Promise.allSettled(mounted.map((primitive) => primitive.client.close()))
      await Promise.allSettled(mounted.map((primitive) => primitive.handle.mcp.close()))
      await server.close()
    },
  }
}

function normalizeMcpPath(raw: string): string {
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  let end = withSlash.length
  while (end > 1 && withSlash.charCodeAt(end - 1) === 47) end -= 1
  const trimmed = withSlash.slice(0, end)
  return trimmed.length > 0 ? trimmed : DEFAULT_HTTP_PATH
}

function healthPathFor(mcpPath: string): string {
  return mcpPath === '/' ? '/health' : `${mcpPath}/health`
}

function parseSessionIdHeader(req: IncomingMessage): string | undefined {
  const header = req.headers['mcp-session-id']
  if (Array.isArray(header)) return header[0]
  return header
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    return '/'
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const bytes = Buffer.from(JSON.stringify(body))
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', bytes.length)
  res.end(bytes)
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  sendJson(res, status, {
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  })
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_JSON_BODY_BYTES) {
      throw new Error(`request body exceeds ${MAX_JSON_BODY_BYTES} bytes`)
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim().length === 0) return undefined
  return JSON.parse(raw)
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function httpEndpoint(host: string, port: number, path: string): string {
  const literalHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${literalHost}:${port}${path}`
}

function actualPort(server: HttpServer): number {
  const address = server.address()
  if (!address || typeof address === 'string') return DEFAULT_HTTP_PORT
  return (address as AddressInfo).port
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    transport: 'stdio',
    host: process.env.ATRIB_PRIMITIVES_HTTP_HOST ?? DEFAULT_HTTP_HOST,
    port: parseOptionalPort(process.env.ATRIB_PRIMITIVES_HTTP_PORT) ?? DEFAULT_HTTP_PORT,
    path: process.env.ATRIB_PRIMITIVES_HTTP_PATH ?? DEFAULT_HTTP_PATH,
    json: false,
    sessionIdleMs:
      parseOptionalPositiveInt(process.env.ATRIB_PRIMITIVES_SESSION_IDLE_MS) ??
      DEFAULT_SESSION_IDLE_MS,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--http') {
      options.transport = 'streamable-http'
    } else if (arg === '--transport') {
      const value = requireArg(argv, ++i, '--transport')
      if (value !== 'stdio' && value !== 'streamable-http') {
        throw new Error('--transport must be stdio or streamable-http')
      }
      options.transport = value
    } else if (arg === '--host') {
      options.host = requireArg(argv, ++i, '--host')
    } else if (arg === '--port') {
      options.port = parsePort(requireArg(argv, ++i, '--port'))
    } else if (arg === '--path') {
      options.path = requireArg(argv, ++i, '--path')
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--session-idle-ms') {
      options.sessionIdleMs = parsePositiveInt(
        requireArg(argv, ++i, '--session-idle-ms'),
        '--session-idle-ms',
      )
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  options.path = normalizeMcpPath(options.path)
  return options
}

function usage(): string {
  return `Usage:
  atrib-primitives [--transport stdio]
  atrib-primitives --transport streamable-http [--host 127.0.0.1] [--port 8796] [--path /mcp]

Options:
  --http                         Alias for --transport streamable-http.
  --transport <mode>             stdio or streamable-http. Defaults to stdio.
  --host <host>                  HTTP bind host. Defaults to 127.0.0.1.
  --port <port>                  HTTP bind port. Defaults to 8796. Use 0 for ephemeral.
  --path <path>                  HTTP MCP path. Defaults to /mcp.
  --session-idle-ms <ms>         Close idle HTTP sessions. Defaults to 12 hours.
  --json                         Print a JSON ready line in HTTP mode.
  --help                         Print this help.
`
}

function requireArg(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (value === undefined) throw new Error(`${flag} requires a value`)
  return value
}

function parseOptionalPort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  return parsePort(raw)
}

function parsePort(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error('--port must be an integer from 0 to 65535')
  }
  return n
}

function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  return parsePositiveInt(raw, 'ATRIB_PRIMITIVES_SESSION_IDLE_MS')
}

function parsePositiveInt(raw: string, name: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return n
}

export async function bindAtribPrimitivesHttpHost(
  options: AtribPrimitivesHttpHostOptions = {},
): Promise<AtribPrimitivesHttpHost> {
  const host = options.host ?? DEFAULT_HTTP_HOST
  const port = options.port ?? DEFAULT_HTTP_PORT
  const mcpPath = normalizeMcpPath(options.path ?? DEFAULT_HTTP_PATH)
  const healthPath = healthPathFor(mcpPath)
  const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS
  const sessions = new Map<string, HttpSession>()
  const version = readPackageVersion()
  let openedSessions = 0
  let closedSessions = 0
  let endpoint = ''
  let healthEndpoint = ''

  const closeSession = async (session: HttpSession): Promise<void> => {
    if (session.closing) return
    session.closing = true
    if (session.sessionId) sessions.delete(session.sessionId)
    closedSessions += 1
    await Promise.allSettled([session.transport.close(), session.runtime.close()])
  }

  const sweepIdleSessions = (): void => {
    const cutoff = Date.now() - sessionIdleMs
    for (const session of sessions.values()) {
      if (session.lastSeenAt < cutoff) void closeSession(session)
    }
  }

  const sweepTimer = setInterval(sweepIdleSessions, Math.min(sessionIdleMs, 60_000))
  sweepTimer.unref?.()

  const server = createServer(async (req, res) => {
    const path = requestPath(req)
    if (path === healthPath || path === '/health') {
      sendJson(res, 200, {
        status: 'healthy',
        report: {
          primitive_runtime: {
            name: 'atrib-primitives',
            version,
            pid: process.pid,
            transport: 'streamable-http',
            endpoint,
            health_endpoint: healthEndpoint,
            tool_count: 15,
          },
          profile: {
            agent: process.env.ATRIB_AGENT,
            mirror_file: process.env.ATRIB_MIRROR_FILE,
            local_substrate_endpoint: process.env.ATRIB_LOCAL_SUBSTRATE_ENDPOINT,
          },
          sessions: {
            active: sessions.size,
            opened: openedSessions,
            closed: closedSessions,
            idle_timeout_ms: sessionIdleMs,
          },
        },
      })
      return
    }

    if (path !== mcpPath) {
      sendJsonRpcError(res, 404, -32000, 'Not Found')
      return
    }

    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
      sendJsonRpcError(res, 405, -32000, 'Method Not Allowed')
      return
    }

    sweepIdleSessions()
    const sessionId = parseSessionIdHeader(req)

    try {
      let body: unknown
      if (req.method === 'POST') {
        try {
          body = await readJsonBody(req)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJsonRpcError(res, 400, -32700, `invalid JSON body: ${message}`)
          return
        }
      }

      if (sessionId) {
        const session = sessions.get(sessionId)
        if (!session) {
          sendJsonRpcError(res, 404, -32000, 'Session not found')
          return
        }
        session.lastSeenAt = Date.now()
        await session.transport.handleRequest(req, res, body)
        return
      }

      if (req.method !== 'POST' || !isInitializeRequest(body)) {
        sendJsonRpcError(
          res,
          400,
          -32000,
          'Bad Request: initialize first or provide mcp-session-id',
        )
        return
      }

      let session: HttpSession | undefined
      try {
        const runtime = await createAtribPrimitivesRuntime()
        session = {
          runtime,
          transport: new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              if (!session) return
              session.sessionId = newSessionId
              session.lastSeenAt = Date.now()
              sessions.set(newSessionId, session)
            },
          }),
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
          closing: false,
        }
        session.transport.onclose = () => {
          if (session) void closeSession(session)
        }
        await runtime.server.connect(session.transport)
        openedSessions += 1
        await session.transport.handleRequest(req, res, body)
      } finally {
        if (session && !session.sessionId && !session.closing) {
          await closeSession(session)
        }
      }
    } catch (error) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : String(error)
        sendJsonRpcError(res, 500, -32603, `Internal server error: ${message}`)
      }
    }
  })

  await listen(server, host, port)
  const boundPort = actualPort(server)
  endpoint = httpEndpoint(host, boundPort, mcpPath)
  healthEndpoint = httpEndpoint(host, boundPort, healthPath)

  if (options.jsonReady) {
    process.stdout.write(
      `${JSON.stringify({
        status: 'ready',
        name: 'atrib-primitives',
        version,
        pid: process.pid,
        transport: 'streamable-http',
        endpoint,
        health_endpoint: healthEndpoint,
      })}\n`,
    )
  }

  return {
    endpoint,
    healthEndpoint,
    server,
    close: async () => {
      clearInterval(sweepTimer)
      const active = [...sessions.values()]
      await Promise.allSettled(active.map((session) => closeSession(session)))
      await closeHttpServer(server)
    },
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }

  if (options.transport === 'streamable-http') {
    const host = await bindAtribPrimitivesHttpHost({
      host: options.host,
      port: options.port,
      path: options.path,
      jsonReady: options.json,
      sessionIdleMs: options.sessionIdleMs,
    })
    const shutdown = async () => {
      try {
        await host.close()
      } finally {
        process.exit(0)
      }
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    if (!options.json) {
      process.stderr.write(`atrib-primitives: listening at ${host.endpoint}\n`)
    }
    return
  }

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
      `atrib-primitives: fatal ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
    )
    process.exit(1)
  })
}
