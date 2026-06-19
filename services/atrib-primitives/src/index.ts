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
import type { AddressInfo, Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolRequest,
  type CallToolResult,
  type Tool,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export interface AtribPrimitiveHandle {
  mcp: McpServer
  flush?: (() => Promise<void>) | undefined
}

interface MountedPrimitive {
  name: string
  handle: AtribPrimitiveHandle
  client: Client
  tools: Tool[]
}

interface ToolRoute {
  primitive: string
  client: Client
}

interface InFlightToolCall {
  id: string
  primitive: string
  tool: string
  startedAt: number
  timedOutAt?: number
}

export interface AtribPrimitivesToolCallDiagnostic {
  id: string
  primitive: string
  tool: string
  started_at: string
  elapsed_ms: number
  timed_out: boolean
  timed_out_at?: string
}

export interface AtribPrimitivesDiagnostics {
  tool_timeout_ms: number
  active_tool_calls: number
  calls_started: number
  calls_succeeded: number
  calls_failed: number
  calls_timed_out: number
  calls_settled_after_timeout: number
  in_flight_tool_calls: AtribPrimitivesToolCallDiagnostic[]
}

export interface AtribPrimitivesBackend {
  tools: Tool[]
  toolNames: string[]
  mountedPrimitiveCount: number
  callTool(request: CallToolRequest['params']): Promise<CallToolResult>
  diagnostics(): AtribPrimitivesDiagnostics
  flush(): Promise<void>
  close(): Promise<void>
}

export interface AtribPrimitivesRuntime {
  server: Server
  tools: Tool[]
  toolNames: string[]
  flush(): Promise<void>
  close(): Promise<void>
}

export interface AtribPrimitivesRuntimeOptions {
  toolTimeoutMs?: number
}

type TransportMode = 'stdio' | 'streamable-http' | 'stdio-http-proxy'

interface CliOptions {
  transport: TransportMode
  host: string
  port: number
  path: string
  endpoint: string
  json: boolean
  sessionIdleMs: number
  toolTimeoutMs: number
  help: boolean
}

interface HttpSession {
  server: Server
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
  toolTimeoutMs?: number
  backendFactory?: () => Promise<AtribPrimitivesBackend>
}

type BackendStatus =
  | {
      state: 'starting'
      startedAt: number
    }
  | {
      state: 'ready'
      startedAt: number
      readyAt: number
      backend: AtribPrimitivesBackend
    }
  | {
      state: 'error'
      startedAt: number
      errorAt: number
      error: unknown
    }

const DEFAULT_HTTP_HOST = '127.0.0.1'
const DEFAULT_HTTP_PORT = 8796
const DEFAULT_HTTP_PATH = '/mcp'
const DEFAULT_SESSION_IDLE_MS = 12 * 60 * 60 * 1000
const DEFAULT_TOOL_TIMEOUT_MS = 45_000
const MAX_JSON_BODY_BYTES = 1024 * 1024
const MCP_REQUEST_TIMEOUT_CODE = -32001

export type AtribPrimitiveFactory = () => Promise<AtribPrimitiveHandle> | AtribPrimitiveHandle

export interface AtribPrimitivesBackendOptions {
  toolTimeoutMs?: number
  primitives?: readonly [string, AtribPrimitiveFactory][]
}

const PRIMITIVES: readonly [string, AtribPrimitiveFactory][] = [
  ['emit', async () => (await import('@atrib/emit')).createAtribEmitServer()],
  ['annotate', async () => (await import('@atrib/annotate')).createAtribAnnotateServer()],
  ['revise', async () => (await import('@atrib/revise')).createAtribReviseServer()],
  ['recall', async () => (await import('@atrib/recall')).createAtribRecallServer()],
  ['trace', async () => (await import('@atrib/trace')).createAtribTraceServer()],
  ['summarize', async () => (await import('@atrib/summarize')).createAtribSummarizeServer()],
  ['verify', async () => (await import('@atrib/verify-mcp')).createAtribVerifyServer()],
]

const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on'])

function requiresExplicitContextId(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['ATRIB_REQUIRE_EXPLICIT_CONTEXT_ID']
  return raw !== undefined && TRUE_ENV_VALUES.has(raw.trim().toLowerCase())
}

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

function logToolCall(event: Record<string, unknown>): void {
  try {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        component: 'atrib-primitives',
        ...event,
      })}\n`,
    )
  } catch {
    // Diagnostics must not interfere with the MCP transport.
  }
}

function toolTimeoutError(tool: string, timeoutMs: number): McpError {
  return new McpError(
    MCP_REQUEST_TIMEOUT_CODE,
    `atrib primitive tool ${tool} timed out after ${timeoutMs}ms`,
  )
}

async function callWithToolTimeout(
  tool: string,
  timeoutMs: number,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  let timeoutHandle: NodeJS.Timeout | undefined
  let timedOut = false
  const startedAt = Date.now()
  const call = run()
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true
      reject(toolTimeoutError(tool, timeoutMs))
    }, timeoutMs)
    timeoutHandle.unref?.()
  })
  try {
    return await Promise.race([call, timeout])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (timedOut) {
      void call.catch((error: unknown) => {
        logToolCall({
          event: 'proxy_tool_call_failed_after_timeout',
          tool,
          elapsed_ms: Date.now() - startedAt,
          error: errorMessage(error),
        })
      })
    }
  }
}

function serializeInFlightToolCall(
  call: InFlightToolCall,
  now = Date.now(),
): AtribPrimitivesToolCallDiagnostic {
  const serialized: AtribPrimitivesToolCallDiagnostic = {
    id: call.id,
    primitive: call.primitive,
    tool: call.tool,
    started_at: new Date(call.startedAt).toISOString(),
    elapsed_ms: Math.max(0, now - call.startedAt),
    timed_out: call.timedOutAt !== undefined,
  }
  if (call.timedOutAt !== undefined) {
    serialized.timed_out_at = new Date(call.timedOutAt).toISOString()
  }
  return serialized
}

function toolCallDiagnosticsDegraded(diagnostics: AtribPrimitivesDiagnostics): boolean {
  return diagnostics.in_flight_tool_calls.some(
    (call) => call.timed_out || call.elapsed_ms >= diagnostics.tool_timeout_ms,
  )
}

async function mountPrimitive(
  name: string,
  factory: AtribPrimitiveFactory,
): Promise<MountedPrimitive> {
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

export async function createAtribPrimitivesBackend(
  options: AtribPrimitivesBackendOptions = {},
): Promise<AtribPrimitivesBackend> {
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const primitives = options.primitives ?? PRIMITIVES
  const mounted: MountedPrimitive[] = []
  for (const [name, factory] of primitives) {
    mounted.push(await mountPrimitive(name, factory))
  }
  const routeByTool = new Map<string, ToolRoute>()
  const tools: Tool[] = []
  const inFlightToolCalls = new Map<string, InFlightToolCall>()
  let callsStarted = 0
  let callsSucceeded = 0
  let callsFailed = 0
  let callsTimedOut = 0
  let callsSettledAfterTimeout = 0

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

  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
    mountedPrimitiveCount: mounted.length,
    callTool: async (request) => {
      const route = routeByTool.get(request.name)
      if (!route) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `unknown atrib primitive tool: ${request.name}`,
        )
      }
      const id = randomUUID()
      const startedAt = Date.now()
      const call: InFlightToolCall = {
        id,
        primitive: route.primitive,
        tool: request.name,
        startedAt,
      }
      callsStarted += 1
      inFlightToolCalls.set(id, call)
      logToolCall({
        event: 'tool_call_started',
        id,
        primitive: route.primitive,
        tool: request.name,
      })

      let timeoutHandle: NodeJS.Timeout | undefined
      let timedOut = false
      const toolCall = route.client.callTool(request) as Promise<CallToolResult>
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true
          call.timedOutAt = Date.now()
          callsTimedOut += 1
          logToolCall({
            event: 'tool_call_timed_out',
            id,
            primitive: route.primitive,
            tool: request.name,
            timeout_ms: toolTimeoutMs,
            elapsed_ms: call.timedOutAt - startedAt,
          })
          reject(toolTimeoutError(request.name, toolTimeoutMs))
        }, toolTimeoutMs)
        timeoutHandle.unref?.()
      })

      try {
        const result = await Promise.race([toolCall, timeout])
        if (timeoutHandle) clearTimeout(timeoutHandle)
        callsSucceeded += 1
        inFlightToolCalls.delete(id)
        logToolCall({
          event: 'tool_call_completed',
          id,
          primitive: route.primitive,
          tool: request.name,
          elapsed_ms: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        if (timedOut) {
          void toolCall
            .then(
              () => {
                callsSettledAfterTimeout += 1
                logToolCall({
                  event: 'tool_call_settled_after_timeout',
                  id,
                  primitive: route.primitive,
                  tool: request.name,
                  outcome: 'succeeded',
                  elapsed_ms: Date.now() - startedAt,
                })
              },
              (lateError: unknown) => {
                callsSettledAfterTimeout += 1
                logToolCall({
                  event: 'tool_call_settled_after_timeout',
                  id,
                  primitive: route.primitive,
                  tool: request.name,
                  outcome: 'failed',
                  elapsed_ms: Date.now() - startedAt,
                  error: errorMessage(lateError),
                })
              },
            )
            .finally(() => {
              inFlightToolCalls.delete(id)
            })
          throw error
        }
        callsFailed += 1
        inFlightToolCalls.delete(id)
        logToolCall({
          event: 'tool_call_failed',
          id,
          primitive: route.primitive,
          tool: request.name,
          elapsed_ms: Date.now() - startedAt,
          error: errorMessage(error),
        })
        throw error
      }
    },
    diagnostics: () => {
      const now = Date.now()
      return {
        tool_timeout_ms: toolTimeoutMs,
        active_tool_calls: inFlightToolCalls.size,
        calls_started: callsStarted,
        calls_succeeded: callsSucceeded,
        calls_failed: callsFailed,
        calls_timed_out: callsTimedOut,
        calls_settled_after_timeout: callsSettledAfterTimeout,
        in_flight_tool_calls: [...inFlightToolCalls.values()].map((call) =>
          serializeInFlightToolCall(call, now),
        ),
      }
    },
    flush: async () => {
      await Promise.all(mounted.map((primitive) => primitive.handle.flush?.() ?? Promise.resolve()))
    },
    close: async () => {
      await Promise.allSettled(
        mounted.map((primitive) => primitive.handle.flush?.() ?? Promise.resolve()),
      )
      await Promise.allSettled(mounted.map((primitive) => primitive.client.close()))
      await Promise.allSettled(mounted.map((primitive) => primitive.handle.mcp.close()))
    },
  }
}

function createBackendProvider(
  factory: () => Promise<AtribPrimitivesBackend> = createAtribPrimitivesBackend,
): {
  get(): Promise<AtribPrimitivesBackend>
  status(): BackendStatus
  close(): Promise<void>
} {
  const startedAt = Date.now()
  let status: BackendStatus = { state: 'starting', startedAt }
  const ready = factory().then(
    (backend) => {
      status = { state: 'ready', startedAt, readyAt: Date.now(), backend }
      return backend
    },
    (error: unknown) => {
      status = { state: 'error', startedAt, errorAt: Date.now(), error }
      throw error
    },
  )
  void ready.catch(() => {})

  return {
    get: () => ready,
    status: () => status,
    close: async () => {
      const backend = status.state === 'ready' ? status.backend : await ready.catch(() => undefined)
      await backend?.close()
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createOuterServer(getBackend: () => Promise<AtribPrimitivesBackend>): Server {
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

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const backend = await getBackend()
    return { tools: backend.tools }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const backend = await getBackend()
    return backend.callTool(request.params)
  })

  return server
}

export async function createAtribPrimitivesRuntime(
  options: AtribPrimitivesRuntimeOptions = {},
): Promise<AtribPrimitivesRuntime> {
  const toolTimeoutMs =
    options.toolTimeoutMs ??
    parseOptionalPositiveInt(
      process.env.ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS,
      'ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS',
    ) ??
    DEFAULT_TOOL_TIMEOUT_MS
  const backendProvider = createBackendProvider(() =>
    createAtribPrimitivesBackend({ toolTimeoutMs }),
  )
  const backend = await backendProvider.get()
  const server = createOuterServer(backendProvider.get)

  return {
    server,
    tools: backend.tools,
    toolNames: backend.toolNames,
    flush: backend.flush,
    close: async () => {
      await backend.flush()
      await server.close()
      await backendProvider.close()
    },
  }
}

export async function createAtribPrimitivesHttpProxyRuntime(
  endpoint: string,
  options: AtribPrimitivesRuntimeOptions = {},
): Promise<AtribPrimitivesRuntime> {
  const toolTimeoutMs =
    options.toolTimeoutMs ??
    parseOptionalPositiveInt(
      process.env.ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS,
      'ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS',
    ) ??
    DEFAULT_TOOL_TIMEOUT_MS
  const upstreamTransport = new StreamableHTTPClientTransport(new URL(endpoint))
  const upstream = new Client({
    name: 'atrib-primitives-stdio-http-proxy',
    version: readPackageVersion(),
  })
  await upstream.connect(upstreamTransport)
  const listed = await upstream.listTools()
  const server = new Server(
    {
      name: 'atrib-primitives-stdio-http-proxy',
      version: readPackageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions:
        'Lightweight stdio proxy for atrib primitives. It forwards MCP calls to a host-owned Streamable HTTP primitive runtime.',
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
    endpoint:
      process.env.ATRIB_PRIMITIVES_HTTP_ENDPOINT ??
      httpEndpoint(DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT, DEFAULT_HTTP_PATH),
    json: false,
    sessionIdleMs:
      parseOptionalPositiveInt(
        process.env.ATRIB_PRIMITIVES_SESSION_IDLE_MS,
        'ATRIB_PRIMITIVES_SESSION_IDLE_MS',
      ) ?? DEFAULT_SESSION_IDLE_MS,
    toolTimeoutMs:
      parseOptionalPositiveInt(
        process.env.ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS,
        'ATRIB_PRIMITIVES_TOOL_TIMEOUT_MS',
      ) ?? DEFAULT_TOOL_TIMEOUT_MS,
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
      if (value !== 'stdio' && value !== 'streamable-http' && value !== 'stdio-http-proxy') {
        throw new Error('--transport must be stdio, streamable-http, or stdio-http-proxy')
      }
      options.transport = value
    } else if (arg === '--endpoint') {
      options.endpoint = requireArg(argv, ++i, '--endpoint')
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
    } else if (arg === '--tool-timeout-ms') {
      options.toolTimeoutMs = parsePositiveInt(
        requireArg(argv, ++i, '--tool-timeout-ms'),
        '--tool-timeout-ms',
      )
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  options.path = normalizeMcpPath(options.path)
  options.endpoint = normalizeHttpEndpoint(options.endpoint, '--endpoint')
  return options
}

function usage(): string {
  return `Usage:
  atrib-primitives [--transport stdio]
  atrib-primitives --transport streamable-http [--host 127.0.0.1] [--port 8796] [--path /mcp]
  atrib-primitives --transport stdio-http-proxy --endpoint http://127.0.0.1:8796/mcp

Options:
  --http                         Alias for --transport streamable-http.
  --transport <mode>             stdio, streamable-http, or stdio-http-proxy. Defaults to stdio.
  --endpoint <url>               HTTP MCP endpoint for stdio-http-proxy mode.
  --host <host>                  HTTP bind host. Defaults to 127.0.0.1.
  --port <port>                  HTTP bind port. Defaults to 8796. Use 0 for ephemeral.
  --path <path>                  HTTP MCP path. Defaults to /mcp.
  --session-idle-ms <ms>         Close idle HTTP sessions. Defaults to 12 hours.
  --tool-timeout-ms <ms>         Bound each primitive tool call. Defaults to 45000.
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

function parseOptionalPositiveInt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined
  return parsePositiveInt(raw, name)
}

function normalizeHttpEndpoint(raw: string, flag: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    return url.toString()
  } catch {
    throw new Error(`${flag} must be an absolute HTTP URL`)
  }
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
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const backendProvider = createBackendProvider(
    options.backendFactory ?? (() => createAtribPrimitivesBackend({ toolTimeoutMs })),
  )
  const host = options.host ?? DEFAULT_HTTP_HOST
  const port = options.port ?? DEFAULT_HTTP_PORT
  const mcpPath = normalizeMcpPath(options.path ?? DEFAULT_HTTP_PATH)
  const healthPath = healthPathFor(mcpPath)
  const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS
  const sessions = new Map<string, HttpSession>()
  const sockets = new Set<Socket>()
  const version = readPackageVersion()
  let openedSessions = 0
  let closedSessions = 0
  let activeHttpRequests = 0
  let endpoint = ''
  let healthEndpoint = ''

  const closeSession = async (session: HttpSession): Promise<void> => {
    if (session.closing) return
    session.closing = true
    if (session.sessionId) sessions.delete(session.sessionId)
    closedSessions += 1
    await Promise.allSettled([session.transport.close(), session.server.close()])
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
      const backendStatus = backendProvider.status()
      if (backendStatus.state === 'starting') {
        sendJson(res, 503, {
          status: 'starting',
          report: {
            primitive_runtime: {
              name: 'atrib-primitives',
              version,
              pid: process.pid,
              transport: 'streamable-http',
              backend: 'starting',
              session_model: 'per-session-transport-shared-backend',
              endpoint,
              health_endpoint: healthEndpoint,
              tool_count: 0,
              mounted_primitive_count: 0,
              backend_started_at: backendStatus.startedAt,
            },
          },
        })
        return
      }
      if (backendStatus.state === 'error') {
        sendJson(res, 500, {
          status: 'error',
          report: {
            primitive_runtime: {
              name: 'atrib-primitives',
              version,
              pid: process.pid,
              transport: 'streamable-http',
              backend: 'error',
              session_model: 'per-session-transport-shared-backend',
              endpoint,
              health_endpoint: healthEndpoint,
              error: errorMessage(backendStatus.error),
              backend_started_at: backendStatus.startedAt,
              backend_error_at: backendStatus.errorAt,
            },
          },
        })
        return
      }
      const backend = backendStatus.backend
      const toolCalls = backend.diagnostics()
      const status = toolCallDiagnosticsDegraded(toolCalls) ? 'degraded' : 'healthy'
      let activeHttpConnections = 0
      for (const socket of sockets) {
        if (!socket.destroyed && socket !== req.socket) activeHttpConnections += 1
      }
      sendJson(res, 200, {
        status,
        report: {
          primitive_runtime: {
            name: 'atrib-primitives',
            version,
            pid: process.pid,
            transport: 'streamable-http',
            backend: 'shared',
            session_model: 'per-session-transport-shared-backend',
            endpoint,
            health_endpoint: healthEndpoint,
            tool_count: backend.toolNames.length,
            mounted_primitive_count: backend.mountedPrimitiveCount,
          },
          profile: {
            agent: process.env.ATRIB_AGENT,
            mirror_file: process.env.ATRIB_MIRROR_FILE,
            local_substrate_endpoint: process.env.ATRIB_LOCAL_SUBSTRATE_ENDPOINT,
            context_id_policy: requiresExplicitContextId()
              ? 'explicit-required'
              : 'active-session-or-fallback',
            requires_explicit_context_id: requiresExplicitContextId(),
          },
          sessions: {
            active: sessions.size,
            opened: openedSessions,
            closed: closedSessions,
            active_http_requests: activeHttpRequests,
            active_http_connections: activeHttpConnections,
            idle_timeout_ms: sessionIdleMs,
          },
          tool_calls: toolCalls,
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

    activeHttpRequests += 1
    try {
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
          const sessionServer = createOuterServer(backendProvider.get)
          session = {
            server: sessionServer,
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
          await sessionServer.connect(session.transport)
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
    } finally {
      activeHttpRequests = Math.max(0, activeHttpRequests - 1)
    }
  })
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  try {
    await listen(server, host, port)
  } catch (error) {
    clearInterval(sweepTimer)
    await backendProvider.close().catch(() => {})
    throw error
  }
  const boundPort = actualPort(server)
  endpoint = httpEndpoint(host, boundPort, mcpPath)
  healthEndpoint = httpEndpoint(host, boundPort, healthPath)

  if (options.jsonReady) {
    void backendProvider
      .get()
      .then((backend) => {
        process.stdout.write(
          `${JSON.stringify({
            status: 'ready',
            name: 'atrib-primitives',
            version,
            pid: process.pid,
            transport: 'streamable-http',
            endpoint,
            health_endpoint: healthEndpoint,
            tool_count: backend.toolNames.length,
            mounted_primitive_count: backend.mountedPrimitiveCount,
          })}\n`,
        )
      })
      .catch((error: unknown) => {
        process.stderr.write(`atrib-primitives: backend failed: ${errorMessage(error)}\n`)
      })
  }

  return {
    endpoint,
    healthEndpoint,
    server,
    close: async () => {
      clearInterval(sweepTimer)
      const active = [...sessions.values()]
      await Promise.allSettled(active.map((session) => closeSession(session)))
      try {
        await closeHttpServer(server)
      } finally {
        await backendProvider.close()
      }
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
      toolTimeoutMs: options.toolTimeoutMs,
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

  const runtime =
    options.transport === 'stdio-http-proxy'
      ? await createAtribPrimitivesHttpProxyRuntime(options.endpoint, {
          toolTimeoutMs: options.toolTimeoutMs,
        })
      : await createAtribPrimitivesRuntime({ toolTimeoutMs: options.toolTimeoutMs })
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
