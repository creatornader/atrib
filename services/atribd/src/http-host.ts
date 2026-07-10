// SPDX-License-Identifier: Apache-2.0

/**
 * Stateless Streamable HTTP host for atribd.
 *
 * Every request is self-describing and any request can land on any
 * instance. There is no session table, no idle sweeper, and no
 * initialize-first gate; the session machinery the 2026-07-28 MCP spec
 * removes is deleted rather than emulated. What replaces it:
 *
 * - Routing-header validation (SEP-2243): when `Mcp-Method` / `Mcp-Name`
 *   headers are present they must match the parsed JSON-RPC body; a
 *   mismatch is HTTP 400 with a JSON-RPC error and no state consulted.
 *   Absent headers are accepted during the legacy compatibility window.
 * - Per-request `_meta` (SEP-414): inbound carriers resolve per request
 *   through the §1.5.4/§1.5.3 ladder inside the tools/call handler.
 * - Cache metadata (SEP-2549): tools/list responses carry `ttlMs` and
 *   `cacheScope` so clients can cache the tool catalogue.
 * - Legacy compatibility window: a pre-2026-07-28 client that POSTs
 *   `initialize` gets a valid stateless response (capabilities returned,
 *   no session id issued); requests carrying `Mcp-Session-Id` are served
 *   with the header ignored, never 404.
 *
 * Per §5.8 the daemon never blocks a primary tool call on network state;
 * a write-primitive call that cannot resolve a context returns a typed
 * tool error to its own caller (the primitive call IS the primary call
 * on this surface).
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import {
  createAtribdBackend,
  errorMessage,
  logDaemonEvent,
  readPackageVersion,
  runtimeContractsDegraded,
  toolCallDiagnosticsDegraded,
  DEFAULT_TOOL_TIMEOUT_MS,
  type AtribdBackend,
} from './backend.js'
import { applyHttpContextPolicy } from './context-policy.js'
import {
  createSessionSdkStatelessAdapter,
  type AtribdTransportAdapter,
} from './transport-adapter.js'

export const DEFAULT_HTTP_HOST = '127.0.0.1'
export const DEFAULT_HTTP_PORT = 8796
export const DEFAULT_HTTP_PATH = '/mcp'
export const DEFAULT_TOOLS_LIST_TTL_MS = 24 * 60 * 60 * 1000
const MAX_JSON_BODY_BYTES = 1024 * 1024

export interface AtribdRequestCounters {
  served: number
  rejected_header_mismatch: number
  rejected_missing_context: number
  legacy_initialize: number
  legacy_session_header_ignored: number
  method_not_allowed: number
}

export interface AtribdHttpHost {
  endpoint: string
  healthEndpoint: string
  server: HttpServer
  requestCounters(): AtribdRequestCounters
  close(): Promise<void>
}

export interface AtribdHttpHostOptions {
  host?: string
  port?: number
  path?: string
  jsonReady?: boolean
  toolTimeoutMs?: number
  /** SEP-2549 freshness hint advertised on tools/list responses. */
  toolsListTtlMs?: number
  /**
   * Opt a single-tenant daemon back into ambient context discovery
   * (D078/D083 env/profile-file ladder) on HTTP, where explicit-required
   * is the default. Working flag name; final name is a P046 open question.
   */
  ambientContext?: boolean
  backendFactory?: () => Promise<AtribdBackend>
  adapterFactory?: (serverFactory: () => Server) => AtribdTransportAdapter
}

type BackendStatus =
  | { state: 'starting'; startedAt: number }
  | { state: 'ready'; startedAt: number; readyAt: number; backend: AtribdBackend }
  | { state: 'error'; startedAt: number; errorAt: number; error: unknown }

function createBackendProvider(factory: () => Promise<AtribdBackend>): {
  get(): Promise<AtribdBackend>
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

export function normalizeMcpPath(raw: string): string {
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  let end = withSlash.length
  while (end > 1 && withSlash.charCodeAt(end - 1) === 47) end -= 1
  const trimmed = withSlash.slice(0, end)
  return trimmed.length > 0 ? trimmed : DEFAULT_HTTP_PATH
}

export function healthPathFor(mcpPath: string): string {
  return mcpPath === '/' ? '/health' : `${mcpPath}/health`
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

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
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

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  if (Array.isArray(raw)) return raw[0]
  return raw
}

interface BodyDescriptor {
  methods: string[]
  toolNames: string[]
}

/**
 * Collect JSON-RPC method names (and tools/call tool names) from a parsed
 * body. Accepts a single message or a legacy batch array; malformed
 * entries contribute nothing and are left for the adapter to reject.
 */
function describeBody(body: unknown): BodyDescriptor {
  const messages = Array.isArray(body) ? body : [body]
  const methods: string[] = []
  const toolNames: string[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const method = (message as Record<string, unknown>).method
    if (typeof method !== 'string') continue
    methods.push(method)
    if (method === 'tools/call') {
      const params = (message as Record<string, unknown>).params
      if (params && typeof params === 'object' && !Array.isArray(params)) {
        const name = (params as Record<string, unknown>).name
        if (typeof name === 'string') toolNames.push(name)
      }
    }
  }
  return { methods, toolNames }
}

/**
 * SEP-2243: when routing headers are present they MUST match the body.
 * Returns an error string on mismatch, undefined when consistent (or when
 * the headers are absent, which the legacy window tolerates).
 */
export function routingHeaderMismatch(
  mcpMethod: string | undefined,
  mcpName: string | undefined,
  body: unknown,
): string | undefined {
  if (mcpMethod === undefined && mcpName === undefined) return undefined
  const { methods, toolNames } = describeBody(body)
  if (mcpMethod !== undefined) {
    if (methods.length === 0) {
      return `Mcp-Method header ${mcpMethod} does not match a body with no request method`
    }
    const mismatch = methods.find((method) => method !== mcpMethod)
    if (mismatch !== undefined) {
      return `Mcp-Method header ${mcpMethod} does not match body method ${mismatch}`
    }
  }
  if (mcpName !== undefined) {
    if (!methods.includes('tools/call')) {
      return `Mcp-Name header ${mcpName} does not match a body with no tools/call request`
    }
    const mismatch = toolNames.find((name) => name !== mcpName)
    if (mismatch !== undefined) {
      return `Mcp-Name header ${mcpName} does not match body tool name ${mismatch}`
    }
    if (toolNames.length === 0) {
      return `Mcp-Name header ${mcpName} does not match a tools/call body with no tool name`
    }
  }
  return undefined
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

export function httpEndpoint(host: string, port: number, path: string): string {
  const literalHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${literalHost}:${port}${path}`
}

function actualPort(server: HttpServer): number {
  const address = server.address()
  if (!address || typeof address === 'string') return DEFAULT_HTTP_PORT
  return (address as AddressInfo).port
}

export interface AtribdServerFactoryOptions {
  getBackend: () => Promise<AtribdBackend>
  toolsListTtlMs: number
  /** Applied to write-primitive tools/call requests on the HTTP surface. */
  httpContextPolicy?: {
    ambientContext: boolean
    onInjected?: () => void
    onRejected?: () => void
  }
}

/**
 * Outer MCP server wired to the shared backend. The HTTP host applies the
 * stateless context policy inside the tools/call handler; the stdio
 * runtime omits it so the D078/D083 ambient ladder keeps working for
 * startup-spawn harnesses.
 */
export function createAtribdServer(options: AtribdServerFactoryOptions): Server {
  const server = new Server(
    {
      name: 'atribd',
      version: readPackageVersion(),
    },
    {
      capabilities: { tools: {} },
      instructions:
        'atribd: one local daemon exposing all seven atrib cognitive primitives. ' +
        'Pass context_id explicitly on every write-primitive call over HTTP.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const backend = await options.getBackend()
    // SEP-2549 cache metadata: ttlMs is a freshness hint in milliseconds;
    // cacheScope 'private' keeps shared intermediaries from caching a
    // per-host tool catalogue.
    return {
      tools: backend.tools,
      ttlMs: options.toolsListTtlMs,
      cacheScope: 'private',
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const backend = await options.getBackend()
    const policy = options.httpContextPolicy
    if (!policy) {
      return backend.callTool(request.params)
    }
    const outcome = applyHttpContextPolicy(request.params, {
      ambientContext: policy.ambientContext,
    })
    if (outcome.kind === 'rejected') {
      policy.onRejected?.()
      logDaemonEvent({
        event: 'write_call_rejected_missing_context',
        tool: request.params.name,
      })
      return outcome.result
    }
    if (outcome.kind === 'injected') {
      policy.onInjected?.()
    }
    return backend.callTool(outcome.params)
  })

  return server
}

export async function bindAtribdHttpHost(
  options: AtribdHttpHostOptions = {},
): Promise<AtribdHttpHost> {
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const toolsListTtlMs = options.toolsListTtlMs ?? DEFAULT_TOOLS_LIST_TTL_MS
  const ambientContext = options.ambientContext ?? false
  const backendProvider = createBackendProvider(
    options.backendFactory ?? (() => createAtribdBackend({ toolTimeoutMs })),
  )
  const host = options.host ?? DEFAULT_HTTP_HOST
  const port = options.port ?? DEFAULT_HTTP_PORT
  const mcpPath = normalizeMcpPath(options.path ?? DEFAULT_HTTP_PATH)
  const healthPath = healthPathFor(mcpPath)
  const sockets = new Set<Socket>()
  const version = readPackageVersion()
  const counters: AtribdRequestCounters = {
    served: 0,
    rejected_header_mismatch: 0,
    rejected_missing_context: 0,
    legacy_initialize: 0,
    legacy_session_header_ignored: 0,
    method_not_allowed: 0,
  }
  let endpoint = ''
  let healthEndpoint = ''

  const serverFactory = () =>
    createAtribdServer({
      getBackend: backendProvider.get,
      toolsListTtlMs,
      httpContextPolicy: {
        ambientContext,
        onRejected: () => {
          counters.rejected_missing_context += 1
        },
      },
    })
  const adapterFactory =
    options.adapterFactory ??
    ((factory: () => Server) => createSessionSdkStatelessAdapter({ serverFactory: factory }))
  const adapter = adapterFactory(serverFactory)

  const server = createServer(async (req, res) => {
    const path = requestPath(req)
    if (path === healthPath || path === '/health') {
      const backendStatus = backendProvider.status()
      const daemon = {
        name: 'atribd',
        version,
        pid: process.pid,
        transport: 'streamable-http-stateless',
        transport_adapter: adapter.name,
        protocol_version: adapter.protocolVersion,
        endpoint,
        health_endpoint: healthEndpoint,
      }
      if (backendStatus.state === 'starting') {
        sendJson(res, 503, {
          status: 'starting',
          report: {
            daemon: {
              ...daemon,
              backend: 'starting',
              tool_count: 0,
              mounted_primitive_count: 0,
              backend_started_at: backendStatus.startedAt,
            },
            requests: { ...counters },
          },
        })
        return
      }
      if (backendStatus.state === 'error') {
        sendJson(res, 500, {
          status: 'error',
          report: {
            daemon: {
              ...daemon,
              backend: 'error',
              error: errorMessage(backendStatus.error),
              backend_started_at: backendStatus.startedAt,
              backend_error_at: backendStatus.errorAt,
            },
            requests: { ...counters },
          },
        })
        return
      }
      const backend = backendStatus.backend
      const toolCalls = backend.diagnostics()
      const runtimeContracts = backend.runtimeContracts()
      const status =
        toolCallDiagnosticsDegraded(toolCalls) || runtimeContractsDegraded(runtimeContracts)
          ? 'degraded'
          : 'healthy'
      let activeHttpConnections = 0
      for (const socket of sockets) {
        if (!socket.destroyed && socket !== req.socket) activeHttpConnections += 1
      }
      sendJson(res, 200, {
        status,
        report: {
          daemon: {
            ...daemon,
            backend: 'shared',
            tool_count: backend.toolNames.length,
            mounted_primitive_count: backend.mountedPrimitiveCount,
            active_http_connections: activeHttpConnections,
            tools_list_ttl_ms: toolsListTtlMs,
          },
          primitive_contracts: runtimeContracts.primitives,
          behavioral_probes: runtimeContracts.behavioral_probes,
          recall_contract: runtimeContracts.recall_content,
          profile: {
            agent: process.env.ATRIB_AGENT,
            mirror_file: process.env.ATRIB_MIRROR_FILE,
            local_substrate_endpoint: process.env.ATRIB_LOCAL_SUBSTRATE_ENDPOINT,
            context_id_policy: ambientContext ? 'ambient-opt-in' : 'explicit-required',
            requires_explicit_context_id: !ambientContext,
          },
          requests: { ...counters },
          tool_calls: toolCalls,
        },
      })
      return
    }

    if (path !== mcpPath) {
      sendJsonRpcError(res, 404, -32000, 'Not Found')
      return
    }

    // Stateless surface: POST only. The Streamable HTTP spec permits 405
    // for servers that offer no server-initiated streams (GET) and no
    // session termination (DELETE).
    if (req.method !== 'POST') {
      counters.method_not_allowed += 1
      res.setHeader('allow', 'POST')
      sendJsonRpcError(res, 405, -32000, 'Method Not Allowed')
      return
    }

    try {
      let body: unknown
      try {
        body = await readJsonBody(req)
      } catch (error) {
        sendJsonRpcError(res, 400, -32700, `invalid JSON body: ${errorMessage(error)}`)
        return
      }

      // SEP-2243 routing-header validation: headers, when present, must
      // match the body. No state is consulted on the mismatch path.
      const mismatch = routingHeaderMismatch(
        headerValue(req, 'mcp-method'),
        headerValue(req, 'mcp-name'),
        body,
      )
      if (mismatch) {
        counters.rejected_header_mismatch += 1
        sendJsonRpcError(res, 400, -32600, `routing header mismatch: ${mismatch}`)
        return
      }

      // Legacy compatibility window: session headers are ignored, never
      // validated; a legacy initialize is answered without session issuance.
      if (headerValue(req, 'mcp-session-id') !== undefined) {
        counters.legacy_session_header_ignored += 1
      }
      if (isInitializeRequest(body)) {
        counters.legacy_initialize += 1
      }

      counters.served += 1
      await adapter.handleRequest(req, res, body)
    } catch (error) {
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, `Internal server error: ${errorMessage(error)}`)
      }
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
            name: 'atribd',
            version,
            pid: process.pid,
            transport: 'streamable-http-stateless',
            transport_adapter: adapter.name,
            endpoint,
            health_endpoint: healthEndpoint,
            tool_count: backend.toolNames.length,
            mounted_primitive_count: backend.mountedPrimitiveCount,
          })}\n`,
        )
      })
      .catch((error: unknown) => {
        process.stderr.write(`atribd: backend failed: ${errorMessage(error)}\n`)
      })
  }

  return {
    endpoint,
    healthEndpoint,
    server,
    requestCounters: () => ({ ...counters }),
    close: async () => {
      try {
        await closeHttpServer(server)
      } finally {
        await backendProvider.close()
      }
    },
  }
}
