// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client'
import { StdioClientTransport as ModernStdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  bindAtribdHttpHost,
  createAtribdBackend,
  DEFAULT_TOOLS_LIST_TTL_MS,
  parseCliOptions,
  routingHeaderMismatch,
  MISSING_CONTEXT_ERROR_TEXT,
  type AtribdBackend,
  type AtribdDiagnostics,
} from '../src/index.js'

const ROOT = resolve(__dirname, '..', '..', '..')
const PROCESS_PROOF = 'services/atribd/test/atribd.test.ts'
const inventory = JSON.parse(
  readFileSync(resolve(ROOT, 'scripts', 'mcp-v2-owned-surfaces.json'), 'utf8'),
) as {
  surfaces: Array<{
    id: string
    workspace: string
    entrypoint: string
    process_proof: string
  }>
}
const ATTRIBD_SURFACES = inventory.surfaces.filter(
  (surface) => surface.process_proof === PROCESS_PROOF,
)
expect(ATTRIBD_SURFACES.map((surface) => surface.id).sort()).toEqual([
  'atribd-stdio',
  'atribd-stdio-http-proxy',
  'atribd-streamable-http',
])
const BINARY = resolve(ROOT, ATTRIBD_SURFACES[0].workspace, ATTRIBD_SURFACES[0].entrypoint)
// The alias-window union: the fifteen legacy tool names plus the attest
// (write) and recall (read) verbs, all served by three mounts.
const EXPECTED_TOOL_NAMES = [
  'atrib-annotate',
  'atrib-revise',
  'atrib-verify',
  'attest',
  'emit',
  'recall',
  'recall_annotations',
  'recall_by_content',
  'recall_by_signer',
  'recall_my_attribution_history',
  'recall_orphans',
  'recall_revisions',
  'recall_session_chain',
  'recall_walk',
  'summarize',
  'trace',
  'trace_forward',
]

const CONTEXT_A = 'a'.repeat(32)
const CONTEXT_B = 'b'.repeat(32)
const TEST_PRIVATE_KEY = Buffer.from(new Uint8Array(32).fill(29)).toString('base64url')

function processEnvWith(env: NodeJS.ProcessEnv): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (typeof value === 'string') merged[key] = value
  }
  return merged
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? Infinity
}

async function timedRequest(run: () => Promise<Response>): Promise<number> {
  const startedAt = performance.now()
  const response = await run()
  expect(response.status).toBe(200)
  await response.arrayBuffer()
  return performance.now() - startedAt
}

async function freeTcpPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('failed to reserve a TCP port')
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  })
  return address.port
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
}

async function retryPost(
  endpoint: string,
  body: unknown,
  headers: Record<string, string>,
  deadlineMs = 30_000,
): Promise<Response> {
  const deadline = Date.now() + deadlineMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await postJson(endpoint, body, headers)
    } catch (error) {
      lastError = error
      await delay(25)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('request retry deadline expired')
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** §1.5.2 propagation token: base64url(recordHash) + "." + base64url(creatorKey). */
function fakePropagationToken(recordHashByte: number): string {
  return `${base64url(new Uint8Array(32).fill(recordHashByte))}.${base64url(
    new Uint8Array(32).fill(7),
  )}`
}

function fixedHealthProbeCollisionRecord(): string {
  return `${JSON.stringify({
    record: {
      spec_version: 'atrib/1.0',
      content_id: `sha256:${'a'.repeat(64)}`,
      creator_key: 'k'.repeat(43),
      chain_root: `sha256:${'0'.repeat(64)}`,
      event_type: 'https://atrib.dev/v1/types/observation',
      context_id: 'f'.repeat(32),
      timestamp: 1,
      signature: 's'.repeat(86),
    },
  })}\n`
}

function emptyDiagnostics(toolTimeoutMs = 45_000): AtribdDiagnostics {
  return {
    tool_timeout_ms: toolTimeoutMs,
    active_tool_calls: 0,
    calls_started: 0,
    calls_succeeded: 0,
    calls_failed: 0,
    calls_timed_out: 0,
    calls_cancelled: 0,
    calls_settled_after_timeout: 0,
    calls_settled_after_cancel: 0,
    in_flight_tool_calls: [],
    idempotency: {
      schema: 'atrib.mcp-write-idempotency.v1',
      window_ms: 7 * 24 * 60 * 60 * 1000,
      max_entries: 10_000,
      pending: 0,
      completed: 0,
    },
  }
}

function fakeRuntimeContracts() {
  return {
    primitives: {},
    behavioral_probes: {},
    recall_content: {
      status: 'pass' as const,
      package: '@atrib/recall',
      runtime_metadata_available: true,
      expected_coverage_version: 'coverage-v1',
      expected_content_index_version: 'content-index-v1',
      version: '0.0.0',
      coverage_version: 'coverage-v1',
      content_index_version: 'content-index-v1',
    },
  }
}

function fakeBackend(): AtribdBackend {
  return {
    tools: [],
    toolNames: [],
    mountedPrimitiveCount: 0,
    callTool: async () => {
      throw new Error('fake backend has no tools')
    },
    diagnostics: () => emptyDiagnostics(),
    runtimeContracts: () => fakeRuntimeContracts(),
    flush: async () => {},
    close: async () => {},
  }
}

interface RecordedCall {
  tool: string
  args: Record<string, unknown>
}

/**
 * Backend with a fake write primitive mounted under the real `emit` tool
 * name plus a fake read tool. Records every routed call's arguments and
 * tracks write-handler concurrency for the serialization tests.
 */
async function fakeToolBackend(options: { writeDelayMs?: number } = {}): Promise<{
  backend: AtribdBackend
  calls: RecordedCall[]
  maxConcurrentWrites: () => number
}> {
  const calls: RecordedCall[] = []
  let active = 0
  let maxActive = 0
  const writeDelayMs = options.writeDelayMs ?? 0
  const backend = await createAtribdBackend({
    primitives: [
      [
        'emit',
        () => {
          const mcp = new McpServer({ name: 'fake-emit', version: '0.0.0' })
          mcp.registerTool(
            'emit',
            {
              description: 'Fake write primitive',
              inputSchema: {
                context_id: z.string().optional(),
                chain_root: z.string().optional(),
                content: z.record(z.string(), z.unknown()).optional(),
                event_type: z.string().optional(),
              },
            },
            async (args) => {
              active += 1
              maxActive = Math.max(maxActive, active)
              if (writeDelayMs > 0) await delay(writeDelayMs)
              calls.push({ tool: 'emit', args: args as Record<string, unknown> })
              active -= 1
              return {
                content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
              }
            },
          )
          return { mcp }
        },
      ],
      [
        'reader',
        () => {
          const mcp = new McpServer({ name: 'fake-reader', version: '0.0.0' })
          mcp.registerTool(
            'fake_read',
            {
              description: 'Fake read primitive',
              inputSchema: {},
            },
            async () => {
              calls.push({ tool: 'fake_read', args: {} })
              return { content: [{ type: 'text', text: JSON.stringify({ read: true }) }] }
            },
          )
          return { mcp }
        },
      ],
    ],
  })
  return { backend, calls, maxConcurrentWrites: () => maxActive }
}

async function postJson(
  endpoint: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function toolsCallBody(
  id: number,
  name: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
) {
  const params: Record<string, unknown> = { name, arguments: args }
  if (meta) params._meta = meta
  return { jsonrpc: '2.0', id, method: 'tools/call', params }
}

const TOOLS_LIST_BODY = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }

function modernMeta() {
  return {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'atribd-modern-test', version: '0.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  }
}

function modernRequest(id: number, method: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, _meta: modernMeta() },
  }
}

const MODERN_HEADERS = {
  'mcp-protocol-version': '2026-07-28',
}

async function connectHttpClient(endpoint: string, name: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint))
  const client = new Client({ name, version: '0.0.0' })
  try {
    await client.connect(transport)
    return client
  } catch (error) {
    await transport.close().catch(() => {})
    throw error
  }
}

interface HttpHostProcess {
  child: ChildProcessWithoutNullStreams
  endpoint: string
  healthEndpoint: string
  close(): Promise<void>
}

function startHttpHostProcess(
  env: NodeJS.ProcessEnv,
  extraArgs: string[] = [],
): Promise<HttpHostProcess> {
  return new Promise((resolveHost, rejectHost) => {
    const child = spawn(
      'node',
      [BINARY, '--transport', 'streamable-http', '--port', '0', '--json', ...extraArgs],
      {
        env: processEnvWith(env),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let settled = false
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      rejectHost(new Error(`HTTP host did not become ready. stderr=${stderr}`))
      // The mount path runs the union behavioral probes (including the lazy
      // @atrib/verify closure load), ~6s cold; 5s was too tight.
    }, 30_000)

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      let idx = stdout.indexOf('\n')
      while (idx >= 0) {
        const line = stdout.slice(0, idx).trim()
        stdout = stdout.slice(idx + 1)
        if (line) {
          try {
            const ready = JSON.parse(line) as {
              status?: string
              endpoint?: string
              health_endpoint?: string
            }
            if (ready.status === 'ready' && ready.endpoint && ready.health_endpoint) {
              settled = true
              clearTimeout(timer)
              resolveHost({
                child,
                endpoint: ready.endpoint,
                healthEndpoint: ready.health_endpoint,
                close: () => stopChild(child),
              })
              return
            }
          } catch {
            // Ignore non-ready stdout lines from child startup.
          }
        }
        idx = stdout.indexOf('\n')
      }
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectHost(
        new Error(
          `HTTP host exited before ready: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderr}`,
        ),
      )
    })
  })
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveStop()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolveStop()
    }, 2000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
    child.kill('SIGTERM')
  })
}

let tmp: string
let recordFile: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atribd-mcp-'))
  recordFile = join(tmp, 'records.jsonl')
  writeFileSync(recordFile, '')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('routingHeaderMismatch (SEP-2243)', () => {
  it('accepts absent headers during the legacy window', () => {
    expect(routingHeaderMismatch(undefined, undefined, TOOLS_LIST_BODY)).toBeUndefined()
  })

  it('accepts headers that match the body', () => {
    expect(routingHeaderMismatch('tools/list', undefined, TOOLS_LIST_BODY)).toBeUndefined()
    expect(
      routingHeaderMismatch('tools/call', 'emit', toolsCallBody(2, 'emit', {})),
    ).toBeUndefined()
  })

  it('rejects a method header that diverges from the body', () => {
    expect(routingHeaderMismatch('tools/call', undefined, TOOLS_LIST_BODY)).toContain('Mcp-Method')
  })

  it('rejects a name header that diverges from the body tool name', () => {
    expect(
      routingHeaderMismatch('tools/call', 'summarize', toolsCallBody(2, 'emit', {})),
    ).toContain('Mcp-Name')
  })

  it('rejects a name header when the body is not a tools/call', () => {
    expect(routingHeaderMismatch(undefined, 'emit', TOOLS_LIST_BODY)).toContain('Mcp-Name')
  })
})

describe('atribd stateless HTTP host', () => {
  it('serves a bare tools/list POST with no prior initialize and carries SEP-2549 cache metadata', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => backend,
      toolsListTtlMs: 12_345,
    })
    try {
      const response = await postJson(host.endpoint, TOOLS_LIST_BODY)
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        result?: { tools?: { name: string }[]; ttlMs?: number; cacheScope?: string }
      }
      expect(payload.result?.tools?.map((tool) => tool.name).sort()).toEqual(['emit', 'fake_read'])
      expect(payload.result?.ttlMs).toBe(12_345)
      expect(payload.result?.cacheScope).toBe('private')
      // No session is ever issued on the stateless surface.
      expect(response.headers.get('mcp-session-id')).toBeNull()
    } finally {
      await host.close()
    }
  })

  it('ignores a legacy Mcp-Session-Id header instead of returning 404', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const response = await postJson(host.endpoint, TOOLS_LIST_BODY, {
        'mcp-session-id': 'stale-session-from-before-the-stateless-cutover',
      })
      expect(response.status).toBe(200)
      const counters = host.requestCounters()
      expect(counters.legacy_session_header_ignored).toBe(1)
      expect(counters.served).toBe(1)
    } finally {
      await host.close()
    }
  })

  it('answers a legacy initialize without issuing a session id', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const response = await postJson(host.endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'legacy-client', version: '0.0.0' },
        },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('mcp-session-id')).toBeNull()
      const payload = (await response.json()) as {
        result?: { serverInfo?: { name?: string }; capabilities?: Record<string, unknown> }
      }
      expect(payload.result?.serverInfo?.name).toBe('atribd')
      expect(payload.result?.capabilities).toBeDefined()
      expect(host.requestCounters().legacy_initialize).toBe(1)
      expect(host.requestCounters().legacy_requests).toBe(1)
    } finally {
      await host.close()
    }
  })

  it('serves 2026-07-28 discovery and tool listing without a handshake', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const discover = await postJson(host.endpoint, modernRequest(21, 'server/discover'), {
        ...MODERN_HEADERS,
        'mcp-method': 'server/discover',
      })
      expect(discover.status).toBe(200)
      const discoverPayload = (await discover.json()) as {
        result?: {
          supportedVersions?: string[]
          _meta?: { 'io.modelcontextprotocol/serverInfo'?: { name?: string } }
        }
      }
      expect(discoverPayload.result?.supportedVersions).toContain('2026-07-28')
      expect(discoverPayload.result?._meta?.['io.modelcontextprotocol/serverInfo']?.name).toBe(
        'atribd',
      )
      expect(host.requestCounters().modern_requests).toBe(1)

      const list = await postJson(host.endpoint, modernRequest(22, 'tools/list'), {
        ...MODERN_HEADERS,
        'mcp-method': 'tools/list',
      })
      expect(list.status).toBe(200)
      const listPayload = (await list.json()) as {
        result?: { tools?: { name: string }[]; ttlMs?: number; cacheScope?: string }
      }
      expect(listPayload.result?.tools?.map((tool) => tool.name).sort()).toEqual([
        'emit',
        'fake_read',
      ])
      expect(listPayload.result?.ttlMs).toBe(DEFAULT_TOOLS_LIST_TTL_MS)
      expect(listPayload.result?.cacheScope).toBe('private')
    } finally {
      await host.close()
    }
  })

  it('negotiates and lists tools with the stable v2 client', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    const transport = new ModernStreamableHTTPClientTransport(new URL(host.endpoint))
    const client = new ModernClient(
      { name: 'atribd-v2-integration-test', version: '0.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    )
    try {
      await client.connect(transport)
      expect(client.getProtocolEra()).toBe('modern')
      expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['emit', 'fake_read'])
    } finally {
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
      await host.close()
    }
  })

  it('verifies bearer auth per request without exposing the token to rate limiting', async () => {
    const { backend } = await fakeToolBackend()
    const seen: unknown[] = []
    const host = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => backend,
      bearerAuth: {
        requiredScopes: ['atrib:read'],
        verifier: {
          async verifyAccessToken(token) {
            expect(token).toBe('valid-secret')
            return {
              token,
              clientId: 'principal-from-token',
              scopes: ['atrib:read'],
              expiresAt: Math.floor(Date.now() / 1000) + 60,
              extra: { tenant_id: 'tenant-a' },
            }
          },
        },
      },
      rateLimit: (context) => {
        seen.push(context)
        return { allowed: true }
      },
    })
    try {
      const missing = await postJson(host.endpoint, TOOLS_LIST_BODY)
      expect(missing.status).toBe(401)
      expect(host.requestCounters().rejected_auth).toBe(1)

      const accepted = await postJson(host.endpoint, modernRequest(31, 'tools/list'), {
        ...MODERN_HEADERS,
        'mcp-method': 'tools/list',
        authorization: 'Bearer valid-secret',
      })
      expect(accepted.status, await accepted.clone().text()).toBe(200)
      expect(seen).toEqual([
        {
          method: 'tools/list',
          action_class: 'control',
          protocol_era: 'modern',
          principal: {
            client_id: 'principal-from-token',
            scopes: ['atrib:read'],
            expires_at: expect.any(Number),
            attributes: { tenant_id: 'tenant-a' },
          },
        },
      ])
      expect(JSON.stringify(seen)).not.toContain('valid-secret')
    } finally {
      await host.close()
    }
  })

  it('rate limits every request independently of connection or client name', async () => {
    const { backend, calls } = await fakeToolBackend()
    let requests = 0
    const host = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => backend,
      rateLimit: (context) => {
        expect(context.principal).toBeUndefined()
        expect(context.action_class).toBe('read')
        requests += 1
        return requests === 1
          ? { allowed: true }
          : { allowed: false, retry_after_ms: 1_500, reason: 'request budget exhausted' }
      },
    })
    try {
      const first = await postJson(
        host.endpoint,
        toolsCallBody(32, 'fake_read', {}, {
          'io.modelcontextprotocol/clientInfo': { name: 'trusted-looking-name' },
        }),
      )
      const second = await postJson(
        host.endpoint,
        toolsCallBody(33, 'fake_read', {}, {
          'io.modelcontextprotocol/clientInfo': { name: 'different-name' },
        }),
      )
      expect(first.status).toBe(200)
      expect(second.status).toBe(429)
      expect(second.headers.get('retry-after')).toBe('2')
      expect(calls.filter((call) => call.tool === 'fake_read')).toHaveLength(1)
      expect(host.requestCounters().rate_limited).toBe(1)
    } finally {
      await host.close()
    }
  })

  it('returns an equivalent read result when the same request lands on a different instance', async () => {
    const first = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => (await fakeToolBackend()).backend,
    })
    const second = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => (await fakeToolBackend()).backend,
    })
    try {
      const body = toolsCallBody(9, 'fake_read', {})
      const [a, b] = await Promise.all([
        postJson(first.endpoint, body),
        postJson(second.endpoint, body),
      ])
      const payloadA = (await a.json()) as { result?: unknown }
      const payloadB = (await b.json()) as { result?: unknown }
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(payloadA.result).toEqual(payloadB.result)
    } finally {
      await first.close()
      await second.close()
    }
  })

  it('rejects routing-header mismatches with HTTP 400 and counts them', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const methodMismatch = await postJson(host.endpoint, TOOLS_LIST_BODY, {
        'mcp-method': 'tools/call',
      })
      expect(methodMismatch.status).toBe(400)
      const nameMismatch = await postJson(
        host.endpoint,
        toolsCallBody(3, 'emit', { context_id: CONTEXT_A }),
        { 'mcp-method': 'tools/call', 'mcp-name': 'summarize' },
      )
      expect(nameMismatch.status).toBe(400)
      const matching = await postJson(host.endpoint, toolsCallBody(4, 'fake_read', {}), {
        'mcp-method': 'tools/call',
        'mcp-name': 'fake_read',
      })
      expect(matching.status).toBe(200)
      const counters = host.requestCounters()
      expect(counters.rejected_header_mismatch).toBe(2)
      // The mismatch path consulted no state and routed nothing.
      expect(calls.filter((call) => call.tool === 'emit')).toHaveLength(0)
    } finally {
      await host.close()
    }
  })

  it('uses the 2026-07-28 header-mismatch code for modern requests', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const response = await postJson(host.endpoint, modernRequest(23, 'tools/list'), {
        ...MODERN_HEADERS,
        'mcp-method': 'tools/call',
      })
      expect(response.status).toBe(400)
      const payload = (await response.json()) as { error?: { code?: number } }
      expect(payload.error?.code).toBe(-32020)
      expect(calls).toHaveLength(0)
    } finally {
      await host.close()
    }
  })

  it('answers GET and DELETE with 405 on the stateless surface', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const get = await fetch(host.endpoint, { method: 'GET' })
      expect(get.status).toBe(405)
      expect(get.headers.get('allow')).toBe('POST')
      const del = await fetch(host.endpoint, { method: 'DELETE' })
      expect(del.status).toBe(405)
      expect(host.requestCounters().method_not_allowed).toBe(2)
    } finally {
      await host.close()
    }
  })

  it('serves a session-era SDK client end to end through the legacy window', async () => {
    const { backend } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    let client: Client | undefined
    try {
      client = await connectHttpClient(host.endpoint, 'atribd-legacy-client-test')
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['emit', 'fake_read'])
      const result = await client.callTool({ name: 'fake_read', arguments: {} })
      const payload = JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as {
        read: boolean
      }
      expect(payload.read).toBe(true)
    } finally {
      await client?.close().catch(() => {})
      await host.close()
    }
  })
})

describe('atribd HTTP context policy', () => {
  it('rejects a write call with no resolvable context with a typed tool error', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const response = await postJson(host.endpoint, toolsCallBody(5, 'emit', { content: {} }))
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        result?: { isError?: boolean; content?: { text?: string }[] }
      }
      expect(payload.result?.isError).toBe(true)
      expect(payload.result?.content?.[0]?.text).toBe(MISSING_CONTEXT_ERROR_TEXT)
      expect(calls).toHaveLength(0)
      expect(host.requestCounters().rejected_missing_context).toBe(1)
    } finally {
      await host.close()
    }
  })

  it('passes an explicit context_id through untouched', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const response = await postJson(
        host.endpoint,
        toolsCallBody(6, 'emit', { context_id: CONTEXT_A, content: { what: 'x' } }),
      )
      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.args.context_id).toBe(CONTEXT_A)
      expect(calls[0]?.args.chain_root).toBeUndefined()
    } finally {
      await host.close()
    }
  })

  it('resolves inbound _meta carriers per the §1.5.4/§1.5.3 ladder and seeds chain_root', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const token = fakePropagationToken(0xab)
      const traceparent = `00-${CONTEXT_B}-00f067aa0ba902b7-01`
      const response = await postJson(
        host.endpoint,
        toolsCallBody(
          7,
          'emit',
          { content: { what: 'carried' } },
          {
            atrib: token,
            traceparent,
          },
        ),
      )
      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.args.context_id).toBe(CONTEXT_B)
      expect(calls[0]?.args.chain_root).toBe(`sha256:${'ab'.repeat(32)}`)
    } finally {
      await host.close()
    }
  })

  it('resolves the X-Atrib-Chain fallback carrier (§1.5.3)', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const token = fakePropagationToken(0xcd)
      const traceparent = `00-${CONTEXT_B}-00f067aa0ba902b7-01`
      const response = await postJson(
        host.endpoint,
        toolsCallBody(
          8,
          'emit',
          { content: { what: 'fallback' } },
          {
            'X-Atrib-Chain': token,
            traceparent,
          },
        ),
      )
      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.args.context_id).toBe(CONTEXT_B)
      expect(calls[0]?.args.chain_root).toBe(`sha256:${'cd'.repeat(32)}`)
    } finally {
      await host.close()
    }
  })

  it('lets read primitives proceed unscoped', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const response = await postJson(host.endpoint, toolsCallBody(9, 'fake_read', {}))
      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.tool).toBe('fake_read')
    } finally {
      await host.close()
    }
  })

  it('opts back into ambient discovery with the ambient-context flag', async () => {
    const { backend, calls } = await fakeToolBackend()
    const host = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => backend,
      ambientContext: true,
    })
    try {
      const response = await postJson(host.endpoint, toolsCallBody(10, 'emit', { content: {} }))
      expect(response.status).toBe(200)
      expect(calls).toHaveLength(1)
      expect(host.requestCounters().rejected_missing_context).toBe(0)
    } finally {
      await host.close()
    }
  })
})

describe('atribd write serialization', () => {
  it('serializes concurrent writes against one context_id', async () => {
    const { backend, calls, maxConcurrentWrites } = await fakeToolBackend({ writeDelayMs: 20 })
    const requests = Array.from({ length: 5 }, () =>
      backend.callTool({
        name: 'emit',
        arguments: { context_id: CONTEXT_A, content: { what: 'serialized' } },
      }),
    )
    await Promise.all(requests)
    expect(calls).toHaveLength(5)
    expect(maxConcurrentWrites()).toBe(1)
    await backend.close()
  })

  it('lets writes on different contexts overlap', async () => {
    const { backend, maxConcurrentWrites } = await fakeToolBackend({ writeDelayMs: 30 })
    const contexts = Array.from({ length: 32 }, (_, index) =>
      index.toString(16).padStart(32, '0'),
    )
    await Promise.all(
      contexts.map((contextId) =>
        backend.callTool({
        name: 'emit',
          arguments: { context_id: contextId, content: {} },
        }),
      ),
    )
    expect(maxConcurrentWrites()).toBe(contexts.length)
    await backend.close()
  })

  it('keeps independent contexts moving behind one busy context', async () => {
    const { backend, calls } = await fakeToolBackend({ writeDelayMs: 25 })
    const busy = Array.from({ length: 8 }, (_, index) =>
      backend.callTool({
        name: 'emit',
        arguments: { context_id: CONTEXT_A, content: { index } },
      }),
    )
    const independent = backend.callTool({
        name: 'emit',
        arguments: { context_id: CONTEXT_B, content: {} },
    })
    await independent
    expect(calls.some((call) => call.args['context_id'] === CONTEXT_B)).toBe(true)
    expect(calls.filter((call) => call.args['context_id'] === CONTEXT_A).length).toBeLessThan(8)
    await Promise.all(busy)
    await backend.close()
  })
})

describe('atribd request cancellation', () => {
  it('forwards cancellation to a read primitive and frees the route', async () => {
    let primitiveObservedAbort = false
    const backend = await createAtribdBackend({
      primitives: [
        [
          'reader',
          () => {
            const mcp = new McpServer({ name: 'abort-aware-reader', version: '0.0.0' })
            mcp.registerTool(
              'abortable_read',
              { description: 'Abort-aware read', inputSchema: {} },
              async (_args, extra) => {
                await new Promise<never>((_resolve, reject) => {
                  extra.signal.addEventListener(
                    'abort',
                    () => {
                      primitiveObservedAbort = true
                      reject(extra.signal.reason)
                    },
                    { once: true },
                  )
                })
              },
            )
            return { mcp }
          },
        ],
      ],
    })
    const controller = new AbortController()
    const call = backend.callTool(
      { name: 'abortable_read', arguments: {} },
      { signal: controller.signal },
    )
    await delay(5)
    controller.abort()
    await expect(call).rejects.toThrow(/abortable_read was cancelled/)
    await delay(10)
    expect(primitiveObservedAbort).toBe(true)
    expect(backend.diagnostics()).toMatchObject({
      active_tool_calls: 0,
      calls_cancelled: 1,
      calls_settled_after_cancel: 1,
    })
    await backend.close()
  })

  it('keeps a cancelled write settling and replays its eventual result', async () => {
    const { backend, calls } = await fakeToolBackend({ writeDelayMs: 35 })
    const controller = new AbortController()
    const request = {
      name: 'emit',
      arguments: { context_id: CONTEXT_A, content: { what: 'settle after cancel' } },
      _meta: { 'dev.atrib/idempotencyKey': 'cancelled-write-0001' },
    }
    const call = backend.callTool(request, { signal: controller.signal })
    await delay(5)
    controller.abort()
    await expect(call).rejects.toThrow(/emit was cancelled/)
    await delay(50)

    const replay = await backend.callTool(request)
    expect(replay.content).toEqual([{ type: 'text', text: JSON.stringify({ ok: true }) }])
    expect(calls).toHaveLength(1)
    expect(backend.diagnostics()).toMatchObject({
      active_tool_calls: 0,
      calls_cancelled: 1,
      calls_settled_after_cancel: 1,
      idempotency: { pending: 0, completed: 1 },
    })
    await backend.close()
  })
})

describe('atribd health surface', () => {
  it('answers health while the shared backend is still mounting', async () => {
    let releaseBackend!: () => void
    const backendGate = new Promise<void>((resolveBackend) => {
      releaseBackend = resolveBackend
    })
    const host = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => {
        await backendGate
        return fakeBackend()
      },
    })
    try {
      const starting = await fetch(host.healthEndpoint)
      expect(starting.status).toBe(503)
      const startingPayload = (await starting.json()) as {
        status?: string
        report?: { daemon?: { backend?: string; tool_count?: number } }
      }
      expect(startingPayload.status).toBe('starting')
      expect(startingPayload.report?.daemon?.backend).toBe('starting')

      releaseBackend()
      for (let i = 0; i < 20; i += 1) {
        const ready = await fetch(host.healthEndpoint)
        if (ready.ok) {
          const readyPayload = (await ready.json()) as {
            status?: string
            report?: { daemon?: { backend?: string } }
          }
          expect(readyPayload.status).toBe('healthy')
          expect(readyPayload.report?.daemon?.backend).toBe('shared')
          return
        }
        await delay(10)
      }
      throw new Error('backend did not report healthy')
    } finally {
      await host.close()
    }
  })

  it('reports the stateless daemon shape with request counters and no sessions block', async () => {
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => fakeBackend() })
    try {
      await postJson(host.endpoint, TOOLS_LIST_BODY, { 'mcp-session-id': 'stale' })
      const health = (await (await fetch(host.healthEndpoint)).json()) as {
        status?: string
        report?: Record<string, unknown> & {
          daemon?: {
            name?: string
            transport?: string
            transport_adapter?: string
            protocol_version?: string
          }
          profile?: { context_id_policy?: string; requires_explicit_context_id?: boolean }
          requests?: Record<string, number>
        }
      }
      expect(health.status).toBe('healthy')
      expect(health.report?.daemon?.name).toBe('atribd')
      expect(health.report?.daemon?.transport).toBe('streamable-http-stateless')
      expect(health.report?.daemon?.transport_adapter).toBe('v2-dual-era-per-request')
      expect(health.report?.daemon?.protocol_version).toBe('2026-07-28')
      expect(health.report?.profile?.context_id_policy).toBe('explicit-required')
      expect(health.report?.profile?.requires_explicit_context_id).toBe(true)
      expect(health.report?.requests?.served).toBe(1)
      expect(health.report?.requests?.legacy_session_header_ignored).toBe(1)
      expect(health.report?.sessions).toBeUndefined()
      expect(health.report?.primitive_contracts).toBeDefined()
      expect(health.report?.behavioral_probes).toBeDefined()
      expect(health.report?.recall_contract).toBeDefined()
    } finally {
      await host.close()
    }
  })

  it('degrades health when the recall content-index contract fails', async () => {
    const backend = {
      ...fakeBackend(),
      runtimeContracts: () => ({
        ...fakeRuntimeContracts(),
        recall_content: {
          status: 'fail' as const,
          package: '@atrib/recall',
          runtime_metadata_available: false,
          expected_coverage_version: 'coverage-v1',
          expected_content_index_version: 'content-index-v1',
          reason: '@atrib/recall does not export getAtribRecallRuntimeContract',
        },
      }),
    }
    const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
    try {
      const health = (await (await fetch(host.healthEndpoint)).json()) as {
        status?: string
        report?: { recall_contract?: { status?: string } }
      }
      expect(health.status).toBe('degraded')
      expect(health.report?.recall_contract?.status).toBe('fail')
    } finally {
      await host.close()
    }
  })

  it('cancels timed-out read primitives and releases the routed request', async () => {
    let primitiveObservedAbort = false
    const backend = await createAtribdBackend({
      toolTimeoutMs: 25,
      primitives: [
        [
          'slow',
          () => {
            const mcp = new McpServer({ name: 'slow-primitive', version: '0.0.0' })
            mcp.registerTool(
              'slow_tool',
              {
                description: 'Slow test tool',
                inputSchema: {},
              },
              async (_args, extra) => {
                await new Promise<never>((_resolve, reject) => {
                  extra.signal.addEventListener(
                    'abort',
                    () => {
                      primitiveObservedAbort = true
                      reject(extra.signal.reason)
                    },
                    { once: true },
                  )
                })
              },
            )
            return { mcp }
          },
        ],
      ],
    })
    const host = await bindAtribdHttpHost({
      port: 0,
      backendFactory: async () => backend,
      toolTimeoutMs: 25,
    })
    let client: Client | undefined
    try {
      client = await connectHttpClient(host.endpoint, 'atribd-timeout-test')
      await expect(client.callTool({ name: 'slow_tool', arguments: {} })).rejects.toThrow(
        /slow_tool timed out after 25ms/,
      )
      await delay(10)
      const health = (await (await fetch(host.healthEndpoint)).json()) as {
        status?: string
        report?: { tool_calls?: AtribdDiagnostics }
      }
      expect(primitiveObservedAbort).toBe(true)
      expect(health.status).toBe('degraded')
      expect(health.report?.tool_calls?.calls_timed_out).toBe(1)
      expect(health.report?.tool_calls?.calls_settled_after_timeout).toBe(1)
      expect(health.report?.tool_calls?.active_tool_calls).toBe(0)
    } finally {
      await client?.close().catch(() => {})
      await host.close()
    }
  })
})

describe('atribd real primitive mounts', () => {
  it(
    'lists every cognitive primitive tool from one stdio process',
    { timeout: 30_000 },
    async () => {
      const transport = new ModernStdioClientTransport({
        command: 'node',
        args: [BINARY],
        env: processEnvWith({ ATRIB_RECORD_FILE: recordFile }),
        stderr: 'pipe',
      })
      const client = new ModernClient(
        { name: 'atribd-v2-stdio-test', version: '0.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      )
      try {
        await client.connect(transport)
        expect(client.getProtocolEra()).toBe('modern')
        expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
        const listed = await client.listTools()
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES)
      } finally {
        await client.close().catch(() => {})
      }
    },
  )

  it(
    'serves the seventeen-tool alias union over stateless HTTP with passing contracts',
    { timeout: 30_000 },
    async () => {
      const host = await startHttpHostProcess({
        ATRIB_AGENT: 'test-agent',
        ATRIB_RECORD_FILE: recordFile,
      })
      try {
        const health = (await (await fetch(host.healthEndpoint)).json()) as {
          status?: string
          report?: {
            daemon?: { tool_count?: number; mounted_primitive_count?: number }
            primitive_contracts?: Record<string, { status?: string }>
            behavioral_probes?: Record<string, { status?: string }>
            recall_contract?: { status?: string }
          }
        }
        expect(health.status).toBe('healthy')
        expect(health.report?.daemon?.mounted_primitive_count).toBe(3)
        expect(health.report?.daemon?.tool_count).toBe(EXPECTED_TOOL_NAMES.length)
        expect(health.report?.recall_contract?.status).toBe('pass')
        for (const primitive of ['recall', 'summarize']) {
          expect(health.report?.behavioral_probes?.[primitive]?.status).toBe('pass')
        }
        expect(health.report?.behavioral_probes?.['attest']?.status).toBe('skipped')

        const response = await postJson(host.endpoint, TOOLS_LIST_BODY)
        const payload = (await response.json()) as {
          result?: { tools?: { name: string }[]; ttlMs?: number; cacheScope?: string }
        }
        expect(payload.result?.tools?.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES)
        expect(typeof payload.result?.ttlMs).toBe('number')
        expect(payload.result?.cacheScope).toBe('private')
      } finally {
        await host.close()
      }
    },
  )

  it(
    'keeps health independent from a valid record using the old fixed probe context',
    { timeout: 30_000 },
    async () => {
      writeFileSync(recordFile, fixedHealthProbeCollisionRecord())
      const host = await startHttpHostProcess({
        ATRIB_AGENT: 'test-agent',
        ATRIB_RECORD_FILE: recordFile,
        ATRIB_RECORDS_DIR: tmp,
        ATRIB_SUMMARIZE_API_KEY: 'health-probe-test-key',
      })
      try {
        const health = (await (await fetch(host.healthEndpoint)).json()) as {
          status?: string
          report?: { behavioral_probes?: Record<string, { status?: string }> }
        }
        expect(health.status).toBe('healthy')
        expect(health.report?.behavioral_probes?.['summarize']?.status).toBe('pass')
      } finally {
        await host.close()
      }
    },
  )

  it(
    'returns a negotiated dev.atrib/attribution record receipt on a native v2 call',
    { timeout: 30_000 },
    async () => {
      const host = await startHttpHostProcess({
        ATRIB_AGENT: 'test-agent',
        ATRIB_PRIVATE_KEY: TEST_PRIVATE_KEY,
        ATRIB_RECORD_FILE: recordFile,
        ATRIB_MIRROR_FILE: recordFile,
      })
      try {
        const requestMeta = {
          ...modernMeta(),
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: {
              'dev.atrib/attribution': {
                version: '0.1',
                accept: ['record'],
              },
            },
          },
        }
        const response = await postJson(
          host.endpoint,
          toolsCallBody(
            31,
            'emit',
            {
              context_id: 'e'.repeat(32),
              event_type: 'observation',
              content: { what: 'native v2 receipt proof' },
            },
            requestMeta,
          ),
          { ...MODERN_HEADERS, 'mcp-method': 'tools/call', 'mcp-name': 'emit' },
        )
        expect(response.status).toBe(200)
        const payload = (await response.json()) as {
          result?: {
            _meta?: {
              'dev.atrib/attribution'?: {
                token?: string
                receipt?: { context_id?: string; record_hash?: string }
                record?: { context_id?: string; signature?: string }
              }
            }
          }
        }
        const attribution = payload.result?._meta?.['dev.atrib/attribution']
        expect(attribution, JSON.stringify(payload)).toBeDefined()
        expect(attribution?.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
        expect(attribution?.receipt?.context_id).toBe('e'.repeat(32))
        expect(attribution?.receipt?.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(attribution?.record?.context_id).toBe('e'.repeat(32))
        expect(attribution?.record?.signature).toMatch(/^[A-Za-z0-9_-]+$/)
      } finally {
        await host.close()
      }
    },
  )

  it('proxies stdio clients into the stateless HTTP daemon', { timeout: 30_000 }, async () => {
    const host = await startHttpHostProcess({
      ATRIB_AGENT: 'test-agent',
      ATRIB_RECORD_FILE: recordFile,
    })
    try {
      const transport = new ModernStdioClientTransport({
        command: 'node',
        args: [BINARY, '--transport', 'stdio-http-proxy', '--endpoint', host.endpoint],
        env: processEnvWith({ ATRIB_RECORD_FILE: recordFile }),
        stderr: 'pipe',
      })
      const client = new ModernClient(
        { name: 'atribd-v2-proxy-test', version: '0.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      )
      try {
        await client.connect(transport)
        expect(client.getProtocolEra()).toBe('modern')
        expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
        const listed = await client.listTools()
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES)
        const result = await client.callTool({
          name: 'recall_my_attribution_history',
          arguments: { compact: true },
        })
        const payload = JSON.parse(
          (result as { content: { text: string }[] }).content[0]!.text,
        ) as { total: number; returned: number }
        expect(payload.total).toBe(0)
        expect(payload.returned).toBe(0)
      } finally {
        await client.close().catch(() => {})
      }
    } finally {
      await host.close()
    }
  })
})

describe('atribd process replacement', () => {
  it(
    'recovers discovery, reads, writes, receipts, and retries without session repair',
    { timeout: 90_000 },
    async () => {
      const port = await freeTcpPort()
      const contextId = '9'.repeat(32)
      const idempotencyKey = 'process-replacement-write-0001'
      const env = {
        HOME: tmp,
        NODE_ENV: 'production',
        ATRIB_AGENT: 'resilience-test',
        ATRIBD_IDEMPOTENCY_STATE_FILE: join(tmp, 'idempotency.json'),
        ATRIB_PRIVATE_KEY: TEST_PRIVATE_KEY,
        ATRIB_RECORD_FILE: recordFile,
        ATRIB_MIRROR_FILE: recordFile,
        ATRIB_LOG_ENDPOINT: 'http://127.0.0.1:9/v1/entries',
      }
      const args = ['--port', String(port), '--tools-list-ttl-ms', '100']
      const headers = {
        ...MODERN_HEADERS,
        'mcp-method': 'tools/call',
        'mcp-name': 'emit',
      }
      const requestMeta = {
        ...modernMeta(),
        'dev.atrib/idempotencyKey': idempotencyKey,
        'io.modelcontextprotocol/clientCapabilities': {
          extensions: {
            'dev.atrib/attribution': { version: '0.1', accept: ['record'] },
          },
        },
      }
      const write = toolsCallBody(
        501,
        'emit',
        {
          context_id: contextId,
          event_type: 'observation',
          content: { what: 'survives process replacement' },
        },
        requestMeta,
      )

      const first = await startHttpHostProcess(env, args)
      let second: HttpHostProcess | undefined
      try {
        const discover = await postJson(
          first.endpoint,
          modernRequest(499, 'server/discover'),
          { ...MODERN_HEADERS, 'mcp-method': 'server/discover' },
        )
        expect(discover.status).toBe(200)

        const read = await postJson(
          first.endpoint,
          toolsCallBody(500, 'recall_my_attribution_history', { compact: true }, modernMeta()),
          {
            ...MODERN_HEADERS,
            'mcp-method': 'tools/call',
            'mcp-name': 'recall_my_attribution_history',
          },
        )
        expect(read.status).toBe(200)

        const initialWrite = await postJson(first.endpoint, write, headers)
        expect(initialWrite.status).toBe(200)
        const initialPayload = (await initialWrite.json()) as {
          result?: {
            _meta?: {
              'dev.atrib/attribution'?: { receipt?: { record_hash?: string } }
            }
          }
        }
        expect(
          initialPayload.result?._meta?.['dev.atrib/attribution']?.receipt?.record_hash,
        ).toMatch(/^sha256:[0-9a-f]{64}$/)

        first.child.kill('SIGKILL')
        await waitForExit(first.child)

        const retry = retryPost(first.endpoint, write, headers)
        second = await startHttpHostProcess(env, args)
        const retriedWrite = await retry
        expect(retriedWrite.status).toBe(200)
        const retriedPayload = (await retriedWrite.json()) as { result?: unknown }
        expect(retriedPayload.result).toEqual(initialPayload.result)

        const list = await postJson(
          second.endpoint,
          modernRequest(502, 'tools/list'),
          { ...MODERN_HEADERS, 'mcp-method': 'tools/list' },
        )
        const listed = (await list.json()) as {
          result?: { ttlMs?: number; cacheScope?: string; tools?: unknown[] }
        }
        expect(listed.result?.ttlMs).toBe(100)
        expect(listed.result?.cacheScope).toBe('private')
        expect(listed.result?.tools?.length).toBe(EXPECTED_TOOL_NAMES.length)

        const records = readFileSync(recordFile, 'utf8')
          .split('\n')
          .filter(Boolean)
        expect(records).toHaveLength(1)
      } finally {
        if (second) await second.close()
        else await first.close()
      }
    },
  )

  it(
    'retries requests that lose their connection while the daemon is stopped',
    { timeout: 120_000 },
    async () => {
      const port = await freeTcpPort()
      const contextId = '8'.repeat(32)
      const env = {
        HOME: tmp,
        NODE_ENV: 'production',
        ATRIB_AGENT: 'in-flight-kill-test',
        ATRIBD_IDEMPOTENCY_STATE_FILE: join(tmp, 'idempotency-in-flight.json'),
        ATRIB_PRIVATE_KEY: TEST_PRIVATE_KEY,
        ATRIB_RECORD_FILE: recordFile,
        ATRIB_MIRROR_FILE: recordFile,
        ATRIB_LOG_ENDPOINT: 'http://127.0.0.1:9/v1/entries',
      }
      const args = ['--port', String(port), '--tools-list-ttl-ms', '100']
      const cases = [
        {
          name: 'discovery',
          body: modernRequest(601, 'server/discover'),
          headers: { ...MODERN_HEADERS, 'mcp-method': 'server/discover' },
        },
        {
          name: 'tool listing',
          body: modernRequest(602, 'tools/list'),
          headers: { ...MODERN_HEADERS, 'mcp-method': 'tools/list' },
        },
        {
          name: 'read',
          body: toolsCallBody(
            603,
            'recall_my_attribution_history',
            { compact: true },
            modernMeta(),
          ),
          headers: {
            ...MODERN_HEADERS,
            'mcp-method': 'tools/call',
            'mcp-name': 'recall_my_attribution_history',
          },
        },
        {
          name: 'write with negotiated receipt',
          body: toolsCallBody(
            604,
            'emit',
            {
              context_id: contextId,
              event_type: 'observation',
              content: { what: 'survives an in-flight connection loss' },
            },
            {
              ...modernMeta(),
              'dev.atrib/idempotencyKey': 'in-flight-kill-write-0001',
              'io.modelcontextprotocol/clientCapabilities': {
                extensions: {
                  'dev.atrib/attribution': { version: '0.1', accept: ['record'] },
                },
              },
            },
          ),
          headers: {
            ...MODERN_HEADERS,
            'mcp-method': 'tools/call',
            'mcp-name': 'emit',
          },
        },
      ]

      for (const requestCase of cases) {
        const first = await startHttpHostProcess(env, args)
        let settled = false
        const pending = postJson(first.endpoint, requestCase.body, requestCase.headers).finally(
          () => {
            settled = true
          },
        )
        void pending.catch(() => {})
        first.child.kill('SIGSTOP')
        await delay(20)

        expect(settled, `${requestCase.name} settled while the daemon was stopped`).toBe(false)

        first.child.kill('SIGKILL')
        await waitForExit(first.child)
        await pending.catch(() => undefined)

        const second = await startHttpHostProcess(env, args)
        try {
          const response = await retryPost(
            second.endpoint,
            requestCase.body,
            requestCase.headers,
          )
          expect(response.status, requestCase.name).toBe(200)
          const payload = (await response.json()) as {
            result?: {
              _meta?: {
                'dev.atrib/attribution'?: { receipt?: { record_hash?: string } }
              }
            }
          }
          if (requestCase.name === 'write with negotiated receipt') {
            expect(
              payload.result?._meta?.['dev.atrib/attribution']?.receipt?.record_hash,
            ).toMatch(/^sha256:[0-9a-f]{64}$/)
          }
        } finally {
          await second.close()
        }
      }

      const records = readFileSync(recordFile, 'utf8')
        .split('\n')
        .filter(Boolean)
      expect(records).toHaveLength(1)
    },
  )

  it(
    'keeps stable request paths within local daemon latency budgets',
    { timeout: 90_000 },
    async () => {
      const port = await freeTcpPort()
      const contextId = '7'.repeat(32)
      const env = {
        HOME: tmp,
        NODE_ENV: 'production',
        ATRIB_AGENT: 'request-budget-test',
        ATRIBD_IDEMPOTENCY_STATE_FILE: join(tmp, 'idempotency-benchmark.json'),
        ATRIB_PRIVATE_KEY: TEST_PRIVATE_KEY,
        ATRIB_RECORD_FILE: recordFile,
        ATRIB_MIRROR_FILE: recordFile,
        ATRIB_LOG_ENDPOINT: 'http://127.0.0.1:9/v1/entries',
      }
      const host = await startHttpHostProcess(env, [
        '--port',
        String(port),
        '--tools-list-ttl-ms',
        '100',
      ])
      try {
        const coldDiscoveryMs = await timedRequest(() =>
          postJson(
            host.endpoint,
            modernRequest(700, 'server/discover'),
            { ...MODERN_HEADERS, 'mcp-method': 'server/discover' },
          ),
        )
        const cachedListMs: number[] = []
        const readMs: number[] = []
        const writeReceiptMs: number[] = []
        const compatibilityMs: number[] = []

        for (let index = 0; index < 8; index += 1) {
          cachedListMs.push(
            await timedRequest(() =>
              postJson(
                host.endpoint,
                modernRequest(710 + index, 'tools/list'),
                { ...MODERN_HEADERS, 'mcp-method': 'tools/list' },
              ),
            ),
          )
          readMs.push(
            await timedRequest(() =>
              postJson(
                host.endpoint,
                toolsCallBody(
                  720 + index,
                  'recall_my_attribution_history',
                  { compact: true },
                  modernMeta(),
                ),
                {
                  ...MODERN_HEADERS,
                  'mcp-method': 'tools/call',
                  'mcp-name': 'recall_my_attribution_history',
                },
              ),
            ),
          )
          writeReceiptMs.push(
            await timedRequest(() =>
              postJson(
                host.endpoint,
                toolsCallBody(
                  730 + index,
                  'emit',
                  {
                    context_id: contextId,
                    event_type: 'observation',
                    content: { what: `request budget sample ${index}` },
                  },
                  {
                    ...modernMeta(),
                    'dev.atrib/idempotencyKey': `request-budget-write-${index}`,
                    'io.modelcontextprotocol/clientCapabilities': {
                      extensions: {
                        'dev.atrib/attribution': { version: '0.1', accept: ['record'] },
                      },
                    },
                  },
                ),
                {
                  ...MODERN_HEADERS,
                  'mcp-method': 'tools/call',
                  'mcp-name': 'emit',
                },
              ),
            ),
          )
          compatibilityMs.push(
            await timedRequest(() =>
              postJson(host.endpoint, TOOLS_LIST_BODY, { 'mcp-method': 'tools/list' }),
            ),
          )
        }

        expect(coldDiscoveryMs).toBeLessThan(2_000)
        expect(percentile(cachedListMs, 0.95)).toBeLessThan(500)
        expect(percentile(readMs, 0.95)).toBeLessThan(1_500)
        expect(percentile(writeReceiptMs, 0.95)).toBeLessThan(2_000)
        expect(percentile(compatibilityMs, 0.95)).toBeLessThan(500)
      } finally {
        await host.close()
      }
    },
  )
})

describe('atribd CLI options', () => {
  it('accepts the deprecated --session-idle-ms as an ignored no-op', () => {
    const options = parseCliOptions([
      '--transport',
      'streamable-http',
      '--session-idle-ms',
      '60000',
    ])
    expect(options.transport).toBe('streamable-http')
  })

  it('rejects unknown arguments', () => {
    expect(() => parseCliOptions(['--sessions'])).toThrow(/unknown argument/)
  })

  it('parses the ambient-context flag and ttl override', () => {
    const options = parseCliOptions(['--ambient-context', '--tools-list-ttl-ms', '5000'])
    expect(options.ambientContext).toBe(true)
    expect(options.toolsListTtlMs).toBe(5000)
  })
})
