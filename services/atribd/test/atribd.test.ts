// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  bindAtribdHttpHost,
  createAtribdBackend,
  parseCliOptions,
  routingHeaderMismatch,
  MISSING_CONTEXT_ERROR_TEXT,
  type AtribdBackend,
  type AtribdDiagnostics,
} from '../src/index.js'

const BINARY = resolve(__dirname, '..', 'dist', 'index.js')
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

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** §1.5.2 propagation token: base64url(recordHash) + "." + base64url(creatorKey). */
function fakePropagationToken(recordHashByte: number): string {
  return `${base64url(new Uint8Array(32).fill(recordHashByte))}.${base64url(
    new Uint8Array(32).fill(7),
  )}`
}

function emptyDiagnostics(toolTimeoutMs = 45_000): AtribdDiagnostics {
  return {
    tool_timeout_ms: toolTimeoutMs,
    active_tool_calls: 0,
    calls_started: 0,
    calls_succeeded: 0,
    calls_failed: 0,
    calls_timed_out: 0,
    calls_settled_after_timeout: 0,
    in_flight_tool_calls: [],
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

function toolsCallBody(id: number, name: string, args: Record<string, unknown>, meta?: Record<string, unknown>) {
  const params: Record<string, unknown> = { name, arguments: args }
  if (meta) params._meta = meta
  return { jsonrpc: '2.0', id, method: 'tools/call', params }
}

const TOOLS_LIST_BODY = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }

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

function startHttpHostProcess(env: NodeJS.ProcessEnv, extraArgs: string[] = []): Promise<HttpHostProcess> {
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
    expect(routingHeaderMismatch('tools/call', 'summarize', toolsCallBody(2, 'emit', {}))).toContain(
      'Mcp-Name',
    )
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
      expect(payload.result?.tools?.map((tool) => tool.name).sort()).toEqual([
        'emit',
        'fake_read',
      ])
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
      const matching = await postJson(
        host.endpoint,
        toolsCallBody(4, 'fake_read', {}),
        { 'mcp-method': 'tools/call', 'mcp-name': 'fake_read' },
      )
      expect(matching.status).toBe(200)
      const counters = host.requestCounters()
      expect(counters.rejected_header_mismatch).toBe(2)
      // The mismatch path consulted no state and routed nothing.
      expect(calls.filter((call) => call.tool === 'emit')).toHaveLength(0)
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
      const payload = JSON.parse(
        (result as { content: { text: string }[] }).content[0]!.text,
      ) as { read: boolean }
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
        toolsCallBody(7, 'emit', { content: { what: 'carried' } }, {
          atrib: token,
          traceparent,
        }),
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
        toolsCallBody(8, 'emit', { content: { what: 'fallback' } }, {
          'X-Atrib-Chain': token,
          traceparent,
        }),
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
    await Promise.all([
      backend.callTool({
        name: 'emit',
        arguments: { context_id: CONTEXT_A, content: {} },
      }),
      backend.callTool({
        name: 'emit',
        arguments: { context_id: CONTEXT_B, content: {} },
      }),
    ])
    expect(maxConcurrentWrites()).toBe(2)
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
      expect(health.report?.daemon?.transport_adapter).toBe('session-sdk-per-request')
      expect(typeof health.report?.daemon?.protocol_version).toBe('string')
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

  it('times out hung primitive calls and exposes in-flight diagnostics', async () => {
    let releaseTool!: () => void
    const toolGate = new Promise<void>((resolveTool) => {
      releaseTool = resolveTool
    })
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
              async () => {
                await toolGate
                return { content: [{ type: 'text', text: 'released' }] }
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
      const degraded = (await (await fetch(host.healthEndpoint)).json()) as {
        status?: string
        report?: { tool_calls?: AtribdDiagnostics }
      }
      expect(degraded.status).toBe('degraded')
      expect(degraded.report?.tool_calls?.calls_timed_out).toBe(1)
      expect(degraded.report?.tool_calls?.in_flight_tool_calls[0]?.tool).toBe('slow_tool')
    } finally {
      releaseTool()
      await client?.close().catch(() => {})
      await host.close()
    }
  })
})

describe('atribd real primitive mounts', () => {
  it('lists every cognitive primitive tool from one stdio process', { timeout: 30_000 }, async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [BINARY],
      env: processEnvWith({ ATRIB_RECORD_FILE: recordFile }),
      stderr: 'pipe',
    })
    const client = new Client({ name: 'atribd-stdio-test', version: '0.0.0' })
    try {
      await client.connect(transport)
      const listed = await client.listTools()
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES)
    } finally {
      await client.close().catch(() => {})
    }
  })

  it('serves the seventeen-tool alias union over stateless HTTP with passing contracts', { timeout: 30_000 }, async () => {
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
  })

  it('proxies stdio clients into the stateless HTTP daemon', { timeout: 30_000 }, async () => {
    const host = await startHttpHostProcess({
      ATRIB_AGENT: 'test-agent',
      ATRIB_RECORD_FILE: recordFile,
    })
    try {
      const transport = new StdioClientTransport({
        command: 'node',
        args: [BINARY, '--transport', 'stdio-http-proxy', '--endpoint', host.endpoint],
        env: processEnvWith({ ATRIB_RECORD_FILE: recordFile }),
        stderr: 'pipe',
      })
      const client = new Client({ name: 'atribd-proxy-test', version: '0.0.0' })
      try {
        await client.connect(transport)
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

describe('atribd CLI options', () => {
  it('accepts the deprecated --session-idle-ms as an ignored no-op', () => {
    const options = parseCliOptions(['--transport', 'streamable-http', '--session-idle-ms', '60000'])
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
