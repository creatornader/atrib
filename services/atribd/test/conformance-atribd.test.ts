// SPDX-License-Identifier: Apache-2.0

/**
 * Reference test for the D148 atribd conformance corpus (promoted from P046).
 *
 * Walks spec/conformance/atribd/manifest.json and executes every case
 * against the live implementation: HTTP vectors against bindAtribdHttpHost
 * on ephemeral loopback ports, stdio-env vectors against resolveEnvContextId,
 * chain-root vectors against resolveChainRoot, and the record-byte-parity
 * plus concurrent-writer-serialization families against the real primitive
 * servers with the fixed fill(42) test seed and an unreachable log endpoint.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  canonicalRecord,
  genesisChainRoot,
  hexEncode,
  inheritChainContext,
  resolveChainRoot,
  resolveEnvContextId,
  sha256,
} from '@atrib/mcp'
import {
  bindAtribdHttpHost,
  createAtribdBackend,
  type AtribdBackend,
  type AtribdPrimitiveFactory,
  type AtribdRuntimeContracts,
} from '../src/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '../../../spec/conformance/atribd')
const MULTI_PRODUCER_CORPUS = resolve(HERE, '../../../spec/conformance/1.2.3/multi-producer')

interface ManifestFamily {
  name: string
  cases: string[]
}

interface Manifest {
  families: ManifestFamily[]
  constants: { fixed_seed_base64url: string }
}

const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf-8')) as Manifest
const FIXED_SEED = manifest.constants.fixed_seed_base64url

function familyCases<T>(name: string): { name: string; fixture: T }[] {
  const family = manifest.families.find((candidate) => candidate.name === name)
  if (!family) throw new Error(`manifest is missing family ${name}`)
  return family.cases.map((file) => {
    const fixture = JSON.parse(readFileSync(join(CORPUS, file), 'utf-8')) as T & { name: string }
    return { name: fixture.name, fixture }
  })
}

// ------------------------------------------------------------------ env

const SCRUBBED_ENV_KEYS = [
  ...Object.keys(process.env).filter((key) => key.startsWith('ATRIB_')),
  'CLAUDE_CODE_SESSION_ID',
  'CODEX_THREAD_ID',
]
const savedEnv = new Map<string, string | undefined>()

// Local log stub: accepts every submission with 200 and an empty JSON body
// (no proof bundle), so queue flushes settle instantly without touching any
// real log. The degradation family keeps the genuinely unreachable endpoint;
// everything else signs against this stub.
let stubLogServer: HttpServer
let STUB_LOG = ''

beforeAll(async () => {
  for (const key of SCRUBBED_ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    delete process.env[key]
  }
  stubLogServer = createServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  await new Promise<void>((resolveListen) => {
    stubLogServer.listen(0, '127.0.0.1', resolveListen)
  })
  const port = (stubLogServer.address() as AddressInfo).port
  STUB_LOG = `http://127.0.0.1:${port}/v1/entries`
})

afterAll(async () => {
  await new Promise<void>((resolveClose) => {
    stubLogServer.close(() => resolveClose())
  })
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ATRIB_')) delete process.env[key]
  }
  delete process.env['CLAUDE_CODE_SESSION_ID']
  delete process.env['CODEX_THREAD_ID']
})

// ------------------------------------------------------------------ helpers

interface RecordedCall {
  tool: string
  args: Record<string, unknown>
}

async function fakeToolBackend(): Promise<{ backend: AtribdBackend; calls: RecordedCall[] }> {
  const calls: RecordedCall[] = []
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
              calls.push({ tool: 'emit', args: args as Record<string, unknown> })
              return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }
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
            { description: 'Fake read primitive', inputSchema: {} },
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
  return { backend, calls }
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

interface HttpVectorFixture {
  name: string
  input: {
    headers?: Record<string, string>
    body: unknown
    replay_against_fresh_instance?: boolean
  }
  expected: {
    http_status?: number
    mcp_session_id_response_header?: string | null
    result_present?: boolean
    server_name?: string
    counter_incremented?: string
    error_message_contains?: string
    no_tool_routed?: boolean
    received_context_id?: string
    received_chain_root?: string | null
    rejected?: boolean
    error_text?: string
    routed?: boolean
    equivalent_results_across_instances?: boolean
  }
}

async function runHttpVector(fixture: HttpVectorFixture): Promise<void> {
  const { backend, calls } = await fakeToolBackend()
  const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
  try {
    const response = await postJson(host.endpoint, fixture.input.body, fixture.input.headers ?? {})
    const expected = fixture.expected
    if (expected.http_status !== undefined) {
      expect(response.status).toBe(expected.http_status)
    }
    if (expected.mcp_session_id_response_header !== undefined) {
      expect(response.headers.get('mcp-session-id')).toBe(expected.mcp_session_id_response_header)
    }
    const payload = (await response.json().catch(() => undefined)) as
      | {
          result?: {
            serverInfo?: { name?: string }
            isError?: boolean
            content?: { text?: string }[]
          }
          error?: { message?: string }
        }
      | undefined
    if (expected.result_present) {
      expect(payload?.result).toBeDefined()
    }
    if (expected.server_name !== undefined) {
      expect(payload?.result?.serverInfo?.name).toBe(expected.server_name)
    }
    if (expected.error_message_contains !== undefined) {
      expect(payload?.error?.message).toContain(expected.error_message_contains)
    }
    if (expected.counter_incremented !== undefined) {
      const counters = host.requestCounters() as unknown as Record<string, number>
      expect(counters[expected.counter_incremented]).toBeGreaterThanOrEqual(1)
    }
    if (expected.no_tool_routed) {
      expect(calls).toHaveLength(0)
    }
    if (expected.rejected) {
      expect(payload?.result?.isError).toBe(true)
      if (expected.error_text !== undefined) {
        expect(payload?.result?.content?.[0]?.text).toBe(expected.error_text)
      }
      expect(calls).toHaveLength(0)
    }
    if (expected.routed) {
      expect(calls).toHaveLength(1)
    }
    if (expected.received_context_id !== undefined) {
      expect(calls).toHaveLength(1)
      expect(calls[0]?.args['context_id']).toBe(expected.received_context_id)
      if (expected.received_chain_root === null) {
        expect(calls[0]?.args['chain_root']).toBeUndefined()
      } else if (expected.received_chain_root !== undefined) {
        expect(calls[0]?.args['chain_root']).toBe(expected.received_chain_root)
      }
    }
    if (expected.equivalent_results_across_instances) {
      const { backend: freshBackend } = await fakeToolBackend()
      const fresh = await bindAtribdHttpHost({ port: 0, backendFactory: async () => freshBackend })
      try {
        const replay = await postJson(
          fresh.endpoint,
          fixture.input.body,
          fixture.input.headers ?? {},
        )
        expect(replay.status).toBe(response.status)
        const replayPayload = (await replay.json()) as { result?: unknown }
        expect(replayPayload.result).toEqual(payload?.result)
      } finally {
        await fresh.close()
      }
    }
  } finally {
    await host.close()
  }
}

type MirrorEnvelope = {
  record: Record<string, unknown> & { chain_root: string; context_id: string }
  _local?: { producer?: string }
}

function readMirrorEnvelopes(path: string): MirrorEnvelope[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MirrorEnvelope)
}

function recordHashOf(record: Record<string, unknown>): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record as never)))}`
}

/** Assert the mirror holds one linear chain: genesis first, no forks. */
function assertLinearChain(envelopes: MirrorEnvelope[], contextId: string): void {
  expect(envelopes.length).toBeGreaterThan(0)
  const genesis = genesisChainRoot(contextId)
  expect(envelopes[0]?.record.chain_root).toBe(genesis)
  for (let i = 1; i < envelopes.length; i += 1) {
    const parent = recordHashOf(envelopes[i - 1]!.record)
    expect(envelopes[i]?.record.chain_root).toBe(parent)
  }
  const parentCounts = new Map<string, number>()
  for (const envelope of envelopes) {
    const root = envelope.record.chain_root
    parentCounts.set(root, (parentCounts.get(root) ?? 0) + 1)
  }
  const forks = [...parentCounts.values()].filter((count) => count > 1).length
  expect(forks).toBe(0)
}

const REAL_WRITE_FACTORIES: Record<string, { mountName: string; factory: AtribdPrimitiveFactory }> =
  {
    emit: {
      mountName: 'emit',
      factory: async () => (await import('@atrib/attest')).createAtribEmitServer(),
    },
    'atrib-annotate': {
      mountName: 'annotate',
      factory: async () => (await import('@atrib/attest')).createAtribAnnotateServer(),
    },
    'atrib-revise': {
      mountName: 'revise',
      factory: async () => (await import('@atrib/attest')).createAtribReviseServer(),
    },
  }

async function callThroughStandalone(
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const spec = REAL_WRITE_FACTORIES[tool]
  if (!spec) throw new Error(`no standalone factory for ${tool}`)
  const handle = await spec.factory()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await handle.mcp.connect(serverTransport)
  const client = new Client({ name: 'conformance-standalone', version: '0.0.0' })
  await client.connect(clientTransport)
  try {
    const result = (await client.callTool({ name: tool, arguments: args })) as {
      content: { text: string }[]
    }
    return JSON.parse(result.content[0]!.text) as Record<string, unknown>
  } finally {
    await handle.flush?.()
    await client.close()
    await handle.mcp.close()
  }
}

// ------------------------------------------------------------------ families

describe('atribd corpus: stateless-transport', () => {
  for (const { name, fixture } of familyCases<HttpVectorFixture>('stateless-transport')) {
    it(name, async () => {
      await runHttpVector(fixture)
    })
  }
})

describe('atribd corpus: routing-headers', () => {
  for (const { name, fixture } of familyCases<HttpVectorFixture>('routing-headers')) {
    it(name, async () => {
      await runHttpVector(fixture)
    })
  }
})

interface ContextResolutionFixture extends HttpVectorFixture {
  check: 'http-carrier' | 'stdio-env' | 'chain-root-corpus'
  input: HttpVectorFixture['input'] & {
    env?: Record<string, string>
    reuses_corpus?: string
  }
  expected: HttpVectorFixture['expected'] & {
    context_id?: string
    all_cases_match?: boolean
  }
}

describe('atribd corpus: context-resolution', () => {
  for (const { name, fixture } of familyCases<ContextResolutionFixture>('context-resolution')) {
    it(name, async () => {
      if (fixture.check === 'http-carrier') {
        await runHttpVector(fixture)
        return
      }
      if (fixture.check === 'stdio-env') {
        expect(resolveEnvContextId(fixture.input.env as NodeJS.ProcessEnv)).toBe(
          fixture.expected.context_id,
        )
        return
      }
      // chain-root-corpus: re-run the §1.2.3 multi-producer corpus from the
      // daemon's dependency surface; chain selection output must be
      // unchanged case for case. Fixtures with a mirror_corpus input run
      // through inheritChainContext against a materialized on-disk corpus,
      // exactly as the upstream reference test does (D146 corpus-scoped
      // resolution is on the daemon's dependency surface too).
      const upstream = JSON.parse(
        readFileSync(join(MULTI_PRODUCER_CORPUS, 'manifest.json'), 'utf-8'),
      ) as { cases: { file: string }[] }
      expect(upstream.cases.length).toBeGreaterThan(0)
      for (const entry of upstream.cases) {
        const upstreamCase = JSON.parse(
          readFileSync(join(MULTI_PRODUCER_CORPUS, entry.file), 'utf-8'),
        ) as {
          input: {
            context_id: string
            inbound_record_hash_hex: string | null
            auto_chain_tail_hex: string | null
            env: Record<string, string>
            mirror_tail_hex: string | null
            mirror_corpus?: {
              effective_file: string
              files: { file: string; lines: unknown[] }[]
            }
          }
          expected: { chain_root: string }
        }
        const corpus = upstreamCase.input.mirror_corpus
        if (corpus) {
          const corpusTmp = mkdtempSync(join(tmpdir(), 'atribd-corpus-rerun-'))
          try {
            for (const file of corpus.files) {
              const path = join(corpusTmp, file.file)
              mkdirSync(dirname(path), { recursive: true })
              writeFileSync(
                path,
                `${file.lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
              )
            }
            const chain = await inheritChainContext({
              callerContextId: upstreamCase.input.context_id,
              mirrorPath: join(corpusTmp, corpus.effective_file),
              env: upstreamCase.input.env,
              randomContextId: () => 'f'.repeat(32),
            })
            expect(chain.chainRoot).toBe(upstreamCase.expected.chain_root)
          } finally {
            rmSync(corpusTmp, { recursive: true, force: true })
          }
          continue
        }
        const result = resolveChainRoot({
          contextId: upstreamCase.input.context_id,
          inboundRecordHashHex: upstreamCase.input.inbound_record_hash_hex ?? undefined,
          autoChainTailHex: upstreamCase.input.auto_chain_tail_hex ?? undefined,
          mirrorTailHex: upstreamCase.input.mirror_tail_hex ?? undefined,
          env: upstreamCase.input.env,
        })
        expect(result).toBe(upstreamCase.expected.chain_root)
      }
    })
  }
})

interface ParityFixture {
  name: string
  input: {
    tool: string
    arguments: Record<string, unknown>
    private_key_seed_base64url: string
    timestamp_ms: number
  }
  expected: {
    record: Record<string, unknown>
    record_hash: string
    canonical_record_sha256: string
    producer_label: string
  }
}

describe('atribd corpus: record-byte-parity', () => {
  for (const { name, fixture } of familyCases<ParityFixture>('record-byte-parity')) {
    it(name, { timeout: 20_000 }, async () => {
      // Mirror-tail resolution is corpus-scoped per D146 (every *.jsonl in
      // the effective mirror's directory), so each surface gets its own
      // directory; sharing one would chain surface (b) and (c) onto (a)'s
      // record instead of signing the genesis record of the fixed context.
      const tmpA = mkdtempSync(join(tmpdir(), 'atribd-parity-a-'))
      const tmpB = mkdtempSync(join(tmpdir(), 'atribd-parity-b-'))
      const tmpC = mkdtempSync(join(tmpdir(), 'atribd-parity-c-'))
      vi.spyOn(Date, 'now').mockReturnValue(fixture.input.timestamp_ms)
      process.env['ATRIB_PRIVATE_KEY'] = fixture.input.private_key_seed_base64url
      process.env['ATRIB_LOG_ENDPOINT'] = STUB_LOG
      const spec = REAL_WRITE_FACTORIES[fixture.input.tool]
      if (!spec) throw new Error(`no factory for ${fixture.input.tool}`)
      try {
        // Surface (a): standalone server over InMemoryTransport (the same
        // server object the stdio binary connects to a transport).
        const mirrorA = join(tmpA, 'standalone.jsonl')
        process.env['ATRIB_MIRROR_FILE'] = mirrorA
        const standalonePayload = await callThroughStandalone(
          fixture.input.tool,
          fixture.input.arguments,
        )
        expect(standalonePayload['record_hash']).toBe(fixture.expected.record_hash)

        // Surfaces (b) HTTP and (c) alias mount share one daemon backend;
        // each call signs the genesis record of the fixed context against
        // its own fresh mirror corpus.
        const backend = await createAtribdBackend({
          primitives: [[spec.mountName, spec.factory]],
        })
        const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
        const mirrorB = join(tmpB, 'daemon-http.jsonl')
        try {
          process.env['ATRIB_MIRROR_FILE'] = mirrorB
          const response = await postJson(host.endpoint, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: fixture.input.tool, arguments: fixture.input.arguments },
          })
          expect(response.status).toBe(200)

          const mirrorC = join(tmpC, 'daemon-alias.jsonl')
          process.env['ATRIB_MIRROR_FILE'] = mirrorC
          const aliasResult = (await backend.callTool({
            name: fixture.input.tool,
            arguments: fixture.input.arguments,
          })) as { content: { text: string }[] }
          const aliasPayload = JSON.parse(aliasResult.content[0]!.text) as Record<string, unknown>
          expect(aliasPayload['record_hash']).toBe(fixture.expected.record_hash)

          for (const mirror of [mirrorA, mirrorB, mirrorC]) {
            const envelopes = readMirrorEnvelopes(mirror)
            expect(envelopes).toHaveLength(1)
            const record = envelopes[0]!.record
            expect(record).toEqual(fixture.expected.record)
            expect(hexEncode(sha256(canonicalRecord(record as never)))).toBe(
              fixture.expected.canonical_record_sha256,
            )
            expect(envelopes[0]!._local?.producer).toBe(fixture.expected.producer_label)
          }
        } finally {
          await host.close()
        }
      } finally {
        for (const dir of [tmpA, tmpB, tmpC]) {
          rmSync(dir, { recursive: true, force: true })
        }
      }
    })
  }
})

interface HealthGateFixture {
  name: string
  input: { runtime_contracts: AtribdRuntimeContracts }
  expected: {
    status: string
    sessions_block_absent: boolean
    requests_block_present: boolean
    daemon_transport?: string
  }
}

describe('atribd corpus: health-gates', () => {
  for (const { name, fixture } of familyCases<HealthGateFixture>('health-gates')) {
    it(name, async () => {
      const backend: AtribdBackend = {
        tools: [],
        toolNames: [],
        mountedPrimitiveCount: 7,
        callTool: async () => {
          throw new Error('health-gate fixture backend has no tools')
        },
        diagnostics: () => ({
          tool_timeout_ms: 45_000,
          active_tool_calls: 0,
          calls_started: 0,
          calls_succeeded: 0,
          calls_failed: 0,
          calls_timed_out: 0,
          calls_settled_after_timeout: 0,
          in_flight_tool_calls: [],
        }),
        runtimeContracts: () => fixture.input.runtime_contracts,
        flush: async () => {},
        close: async () => {},
      }
      const host = await bindAtribdHttpHost({ port: 0, backendFactory: async () => backend })
      try {
        const response = await fetch(host.healthEndpoint)
        const payload = (await response.json()) as {
          status?: string
          report?: Record<string, unknown> & { daemon?: { transport?: string } }
        }
        expect(payload.status).toBe(fixture.expected.status)
        if (fixture.expected.sessions_block_absent) {
          expect(payload.report?.['sessions']).toBeUndefined()
        }
        if (fixture.expected.requests_block_present) {
          expect(payload.report?.['requests']).toBeDefined()
        }
        if (fixture.expected.daemon_transport !== undefined) {
          expect(payload.report?.daemon?.transport).toBe(fixture.expected.daemon_transport)
        }
      } finally {
        await host.close()
      }
    })
  }
})

interface DegradationFixture extends HttpVectorFixture {
  input: HttpVectorFixture['input'] & {
    tool?: string
    arguments?: Record<string, unknown>
    log_endpoint?: string
    tool_timeout_ms?: number
  }
  expected: HttpVectorFixture['expected'] & {
    record_hash_signed?: boolean
    mirror_line_written?: boolean
    warnings_contains?: string
    timeout_error_code?: number
    health_status?: string
    subsequent_call_served?: boolean
  }
}

describe('atribd corpus: degradation', () => {
  for (const { name, fixture } of familyCases<DegradationFixture>('degradation')) {
    it(name, { timeout: 20_000 }, async () => {
      if (fixture.expected.record_hash_signed !== undefined) {
        // Unreachable log endpoint: the write still signs and mirrors.
        const tmp = mkdtempSync(join(tmpdir(), 'atribd-degradation-'))
        const mirror = join(tmp, 'mirror.jsonl')
        process.env['ATRIB_PRIVATE_KEY'] = FIXED_SEED
        process.env['ATRIB_MIRROR_FILE'] = mirror
        try {
          const backend = await createAtribdBackend({
            primitives: [
              [
                'emit',
                async () =>
                  (await import('@atrib/attest')).createAtribEmitServer({
                    logEndpoint: fixture.input.log_endpoint,
                  }),
              ],
            ],
          })
          const result = (await backend.callTool({
            name: fixture.input.tool ?? 'emit',
            arguments: fixture.input.arguments ?? {},
          })) as { content: { text: string }[] }
          const payload = JSON.parse(result.content[0]!.text) as {
            record_hash?: string
            warnings?: string[]
          }
          expect(typeof payload.record_hash).toBe('string')
          expect(payload.record_hash).not.toBe('sha256:unknown')
          if (fixture.expected.warnings_contains !== undefined) {
            expect(
              payload.warnings?.some((warning) =>
                warning.includes(fixture.expected.warnings_contains as string),
              ),
            ).toBe(true)
          }
          if (fixture.expected.mirror_line_written) {
            expect(readMirrorEnvelopes(mirror)).toHaveLength(1)
          }
          await backend.close()
        } finally {
          rmSync(tmp, { recursive: true, force: true })
        }
        return
      }

      if (fixture.expected.timeout_error_code !== undefined) {
        let releaseTool!: () => void
        const toolGate = new Promise<void>((resolveTool) => {
          releaseTool = resolveTool
        })
        const backend = await createAtribdBackend({
          toolTimeoutMs: fixture.input.tool_timeout_ms,
          primitives: [
            [
              'slow',
              () => {
                const mcp = new McpServer({ name: 'slow-primitive', version: '0.0.0' })
                mcp.registerTool(
                  'slow_tool',
                  { description: 'Slow test tool', inputSchema: {} },
                  async () => {
                    await toolGate
                    return { content: [{ type: 'text', text: 'released' }] }
                  },
                )
                mcp.registerTool(
                  'fast_tool',
                  { description: 'Fast test tool', inputSchema: {} },
                  async () => ({ content: [{ type: 'text', text: 'fast' }] }),
                )
                return { mcp }
              },
            ],
          ],
        })
        const host = await bindAtribdHttpHost({
          port: 0,
          backendFactory: async () => backend,
          toolTimeoutMs: fixture.input.tool_timeout_ms,
        })
        try {
          const timedOut = await postJson(host.endpoint, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'slow_tool', arguments: {} },
          })
          const timedOutPayload = (await timedOut.json()) as { error?: { code?: number } }
          expect(timedOutPayload.error?.code).toBe(fixture.expected.timeout_error_code)

          if (fixture.expected.health_status !== undefined) {
            const health = (await (await fetch(host.healthEndpoint)).json()) as {
              status?: string
            }
            expect(health.status).toBe(fixture.expected.health_status)
          }

          if (fixture.expected.subsequent_call_served) {
            const subsequent = await postJson(host.endpoint, {
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: { name: 'fast_tool', arguments: {} },
            })
            expect(subsequent.status).toBe(200)
            const subsequentPayload = (await subsequent.json()) as { result?: unknown }
            expect(subsequentPayload.result).toBeDefined()
          }
        } finally {
          releaseTool()
          await host.close()
        }
        return
      }

      // Malformed-_meta lenient-parse vectors run as plain HTTP vectors.
      await runHttpVector(fixture)
    })
  }
})

interface SerializationFixture {
  name: string
  input: {
    tool?: string
    concurrent_writes?: number
    context_id: string
    private_key_seed_base64url: string
    writes?: { tool: string; arguments: Record<string, unknown> }[]
  }
  expected: {
    records?: number
    forks?: number
    first_chain_root?: string
    chain_linear?: boolean
    fork_count?: number
    daemon_writes_single_parented?: boolean
  }
}

async function realWriteBackend(): Promise<AtribdBackend> {
  // One write mount serves the whole write union (attest + the three
  // legacy names) since the attest/recall rename; the mixed-producer
  // corpus cases still dispatch by tool name against it.
  return createAtribdBackend({
    primitives: [
      ['attest', async () => (await import('@atrib/attest')).createAtribAttestServer()],
    ],
  })
}

describe('atribd corpus: concurrent-writer-serialization', () => {
  for (const { name, fixture } of familyCases<SerializationFixture>(
    'concurrent-writer-serialization',
  )) {
    it(name, { timeout: 20_000 }, async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'atribd-serialization-'))
      const mirror = join(tmp, 'mirror.jsonl')
      process.env['ATRIB_PRIVATE_KEY'] = fixture.input.private_key_seed_base64url
      process.env['ATRIB_MIRROR_FILE'] = mirror
      process.env['ATRIB_LOG_ENDPOINT'] = STUB_LOG
      const contextId = fixture.input.context_id
      try {
        const backend = await realWriteBackend()
        try {
          if (fixture.expected.fork_count !== undefined) {
            // Documented boundary: an outside-daemon writer signing against
            // a stale tail forks the chain; the daemon cannot repair it but
            // stays single-parented on the newest tail.
            await backend.callTool({
              name: 'emit',
              arguments: {
                event_type: 'observation',
                context_id: contextId,
                content: { what: 'daemon write A' },
              },
            })
            const { emitInProcess } = await import('@atrib/attest')
            const outside = await emitInProcess(
              {
                event_type: 'observation',
                context_id: contextId,
                chain_root: genesisChainRoot(contextId),
                content: { what: 'outside writer with a stale genesis tail' },
              },
              { logEndpoint: STUB_LOG, flushDeadlineMs: 5_000 },
            )
            expect(outside.record_hash).not.toBe('sha256:unknown')
            await backend.callTool({
              name: 'emit',
              arguments: {
                event_type: 'observation',
                context_id: contextId,
                content: { what: 'daemon write C' },
              },
            })

            const envelopes = readMirrorEnvelopes(mirror)
            expect(envelopes).toHaveLength(3)
            const genesis = genesisChainRoot(contextId)
            const parentCounts = new Map<string, number>()
            for (const envelope of envelopes) {
              const root = envelope.record.chain_root
              parentCounts.set(root, (parentCounts.get(root) ?? 0) + 1)
            }
            const forkCount = [...parentCounts.values()].filter((count) => count > 1).length
            expect(forkCount).toBe(fixture.expected.fork_count)
            expect(parentCounts.get(genesis)).toBe(2)
            if (fixture.expected.daemon_writes_single_parented) {
              // The daemon's follow-up write chains to the newest tail (the
              // outside record), not a second fork off an older parent.
              const newestBeforeC = recordHashOf(envelopes[1]!.record)
              expect(envelopes[2]?.record.chain_root).toBe(newestBeforeC)
            }
            return
          }

          const writes =
            fixture.input.writes?.map((write) => ({
              name: write.tool,
              arguments: { ...write.arguments, context_id: contextId },
            })) ??
            Array.from({ length: fixture.input.concurrent_writes ?? 0 }, (_, index) => ({
              name: fixture.input.tool ?? 'emit',
              arguments: {
                event_type: 'observation',
                context_id: contextId,
                content: { what: `concurrent write ${index}` },
              },
            }))
          expect(writes.length).toBeGreaterThan(0)
          await Promise.all(writes.map((write) => backend.callTool(write)))

          const envelopes = readMirrorEnvelopes(mirror)
          expect(envelopes).toHaveLength(fixture.expected.records ?? writes.length)
          if (fixture.expected.first_chain_root === 'genesis') {
            expect(envelopes[0]?.record.chain_root).toBe(genesisChainRoot(contextId))
          }
          if (fixture.expected.chain_linear) {
            assertLinearChain(envelopes, contextId)
          }
        } finally {
          await backend.close()
        }
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})
