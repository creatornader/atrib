// SPDX-License-Identifier: Apache-2.0

/**
 * atribd backend: mounts the seven cognitive-primitive MCP servers in
 * process over `InMemoryTransport` and routes their fifteen physical tools
 * through two internal handlers (write, read). Each mounted tool name is a
 * thin alias over the standalone package's own server, so a call through
 * the daemon produces the same canonical record bytes and the same
 * `_local.producer` sidecar label as a call through the standalone binary.
 *
 * Write-primitive calls are serialized per resolved context_id. The
 * primitives resolve their chain tail through mirror inheritance
 * (`resolveChainRoot` in @atrib/mcp; the daemon never reimplements chain
 * selection), and `handleEmit` awaits its mirror write before returning,
 * so serializing read-tail, sign, append per context through one process
 * yields a linear chain for every writer routed through the daemon.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolveEnvContextId } from '@atrib/mcp'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  ErrorCode,
  McpError,
  type CallToolRequest,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export interface AtribdPrimitiveHandle {
  mcp: McpServer
  flush?: (() => Promise<void>) | undefined
}

interface MountedPrimitive {
  name: string
  handle: AtribdPrimitiveHandle
  client: Client
  tools: Tool[]
}

/** Internal routing kind: the two handlers of the daemon (write, read). */
export type AtribdHandlerKind = 'write' | 'read'

interface ToolRoute {
  primitive: string
  kind: AtribdHandlerKind
  client: Client
}

interface InFlightToolCall {
  id: string
  primitive: string
  tool: string
  startedAt: number
  timedOutAt?: number
}

export interface AtribdToolCallDiagnostic {
  id: string
  primitive: string
  tool: string
  started_at: string
  elapsed_ms: number
  timed_out: boolean
  timed_out_at?: string
}

export interface AtribdDiagnostics {
  tool_timeout_ms: number
  active_tool_calls: number
  calls_started: number
  calls_succeeded: number
  calls_failed: number
  calls_timed_out: number
  calls_settled_after_timeout: number
  in_flight_tool_calls: AtribdToolCallDiagnostic[]
}

export interface AtribdRuntimeContractDiagnostic {
  status: 'pass' | 'fail'
  package: string
  runtime_metadata_available: boolean
  expected_coverage_version: string
  expected_content_index_version: string
  version?: string
  coverage_version?: string
  content_index_version?: string
  reason?: string
}

export interface AtribdSurfaceContractDiagnostic {
  status: 'pass' | 'fail'
  primitive: string
  package: string
  expected_tools: string[]
  mounted_tools: string[]
  missing_tools: string[]
  unexpected_tools: string[]
  mutates_log_on_call: boolean
  probe_mode: 'package-and-tool-surface' | 'read-only-behavioral-probe'
  version?: string
  reason?: string
}

export interface AtribdBehavioralProbeDiagnostic {
  status: 'pass' | 'fail' | 'skipped'
  primitive: string
  tool_names: string[]
  probe_kind: 'read-only' | 'schema-only' | 'not-available'
  mutates_log_on_call: boolean
  reason?: string
  observed?: Record<string, unknown>
}

export interface AtribdRuntimeContracts {
  primitives: Record<string, AtribdSurfaceContractDiagnostic>
  recall_content: AtribdRuntimeContractDiagnostic
  behavioral_probes: Record<string, AtribdBehavioralProbeDiagnostic>
}

export interface AtribdBackend {
  tools: Tool[]
  toolNames: string[]
  mountedPrimitiveCount: number
  callTool(request: CallToolRequest['params']): Promise<CallToolResult>
  diagnostics(): AtribdDiagnostics
  runtimeContracts(): AtribdRuntimeContracts
  flush(): Promise<void>
  close(): Promise<void>
}

export type AtribdPrimitiveFactory = () => Promise<AtribdPrimitiveHandle> | AtribdPrimitiveHandle

export interface AtribdBackendOptions {
  toolTimeoutMs?: number
  primitives?: readonly [string, AtribdPrimitiveFactory][]
}

export const DEFAULT_TOOL_TIMEOUT_MS = 45_000
const MCP_REQUEST_TIMEOUT_CODE = -32001
const EXPECTED_RECALL_COVERAGE_VERSION = 'coverage-v1'
const EXPECTED_RECALL_CONTENT_INDEX_VERSION = 'content-index-v1'
const HEALTH_PROBE_ABSENT_HASH = `sha256:${'f'.repeat(64)}`
const HEALTH_PROBE_ABSENT_CONTEXT_ID = 'f'.repeat(32)
const CONTEXT_ID_PATTERN = /^[0-9a-f]{32}$/
const runtimeRequire = createRequire(import.meta.url)

interface PrimitiveSpec {
  name: string
  packageName: string
  kind: AtribdHandlerKind
  expectedTools: readonly string[]
  mutatesLogOnCall: boolean
  probeMode: AtribdSurfaceContractDiagnostic['probe_mode']
}

export const PRIMITIVE_SPECS: readonly PrimitiveSpec[] = [
  {
    name: 'emit',
    packageName: '@atrib/emit',
    kind: 'write',
    expectedTools: ['emit'],
    mutatesLogOnCall: true,
    probeMode: 'package-and-tool-surface',
  },
  {
    name: 'annotate',
    packageName: '@atrib/annotate',
    kind: 'write',
    expectedTools: ['atrib-annotate'],
    mutatesLogOnCall: true,
    probeMode: 'package-and-tool-surface',
  },
  {
    name: 'revise',
    packageName: '@atrib/revise',
    kind: 'write',
    expectedTools: ['atrib-revise'],
    mutatesLogOnCall: true,
    probeMode: 'package-and-tool-surface',
  },
  {
    name: 'recall',
    packageName: '@atrib/recall',
    kind: 'read',
    expectedTools: [
      'recall_annotations',
      'recall_by_content',
      'recall_by_signer',
      'recall_my_attribution_history',
      'recall_orphans',
      'recall_revisions',
      'recall_session_chain',
      'recall_walk',
    ],
    mutatesLogOnCall: false,
    probeMode: 'read-only-behavioral-probe',
  },
  {
    name: 'trace',
    packageName: '@atrib/trace',
    kind: 'read',
    expectedTools: ['trace', 'trace_forward'],
    mutatesLogOnCall: false,
    probeMode: 'package-and-tool-surface',
  },
  {
    name: 'summarize',
    packageName: '@atrib/summarize',
    kind: 'read',
    expectedTools: ['summarize'],
    mutatesLogOnCall: false,
    probeMode: 'package-and-tool-surface',
  },
  {
    name: 'verify',
    packageName: '@atrib/verify-mcp',
    kind: 'read',
    expectedTools: ['atrib-verify'],
    mutatesLogOnCall: false,
    probeMode: 'package-and-tool-surface',
  },
]

/** Physical tool names served by the write handler. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(
  PRIMITIVE_SPECS.filter((spec) => spec.kind === 'write').flatMap((spec) => [
    ...spec.expectedTools,
  ]),
)

const PRIMITIVES: readonly [string, AtribdPrimitiveFactory][] = [
  ['emit', async () => (await import('@atrib/emit')).createAtribEmitServer()],
  ['annotate', async () => (await import('@atrib/annotate')).createAtribAnnotateServer()],
  ['revise', async () => (await import('@atrib/revise')).createAtribReviseServer()],
  ['recall', async () => (await import('@atrib/recall')).createAtribRecallServer()],
  ['trace', async () => (await import('@atrib/trace')).createAtribTraceServer()],
  ['summarize', async () => (await import('@atrib/summarize')).createAtribSummarizeServer()],
  ['verify', async () => (await import('@atrib/verify-mcp')).createAtribVerifyServer()],
]

export function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function readDependencyPackageVersion(packageName: string): string | undefined {
  try {
    const packagePath = runtimeRequire.resolve(`${packageName}/package.json`)
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
    return stringValue(pkg.version)
  } catch {
    return undefined
  }
}

export function logDaemonEvent(event: Record<string, unknown>): void {
  try {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        component: 'atribd',
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function callWithToolTimeout(
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
        logDaemonEvent({
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
): AtribdToolCallDiagnostic {
  const serialized: AtribdToolCallDiagnostic = {
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

export function toolCallDiagnosticsDegraded(diagnostics: AtribdDiagnostics): boolean {
  return diagnostics.in_flight_tool_calls.some(
    (call) => call.timed_out || call.elapsed_ms >= diagnostics.tool_timeout_ms,
  )
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Serialization key for a write-primitive call. Mirrors the context_id
 * derivation the write primitives themselves apply before mirror-tail
 * inheritance: an explicit 32-hex `context_id` argument wins, else the
 * D078/D083 env ladder through `resolveEnvContextId`. When neither
 * resolves, the primitive synthesizes a fresh orphan context (D072), which
 * cannot race another writer, so no lock is taken.
 */
export function writeSerializationKey(
  params: CallToolRequest['params'],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const args = params.arguments
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const explicit = (args as Record<string, unknown>)['context_id']
    if (typeof explicit === 'string' && CONTEXT_ID_PATTERN.test(explicit)) {
      return explicit
    }
  }
  try {
    return resolveEnvContextId(env)
  } catch {
    return undefined
  }
}

/**
 * Per-key promise-chain mutex. Write calls against the same context_id run
 * strictly one after another; different contexts do not block each other.
 */
export class ContextWriteLocks {
  private readonly tails = new Map<string, { chain: Promise<void>; depth: number }>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const entry = this.tails.get(key) ?? { chain: Promise.resolve(), depth: 0 }
    entry.depth += 1
    const prior = entry.chain
    let release!: () => void
    entry.chain = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    this.tails.set(key, entry)
    await prior
    try {
      return await fn()
    } finally {
      release()
      entry.depth -= 1
      if (entry.depth === 0 && this.tails.get(key) === entry) {
        this.tails.delete(key)
      }
    }
  }
}

function failedRecallContract(reason: string): AtribdRuntimeContractDiagnostic {
  return {
    status: 'fail',
    package: '@atrib/recall',
    runtime_metadata_available: false,
    expected_coverage_version: EXPECTED_RECALL_COVERAGE_VERSION,
    expected_content_index_version: EXPECTED_RECALL_CONTENT_INDEX_VERSION,
    reason,
  }
}

function validateRecallRuntimeContract(raw: unknown): AtribdRuntimeContractDiagnostic {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failedRecallContract('getAtribRecallRuntimeContract did not return an object')
  }
  const contract = raw as Record<string, unknown>
  const pkg = stringValue(contract.package) ?? '@atrib/recall'
  const version = stringValue(contract.version)
  const coverageVersion = stringValue(contract.coverage_version)
  const contentIndexVersion = stringValue(contract.content_index_version)
  const ok =
    pkg === '@atrib/recall' &&
    coverageVersion === EXPECTED_RECALL_COVERAGE_VERSION &&
    contentIndexVersion === EXPECTED_RECALL_CONTENT_INDEX_VERSION

  const diagnostic: AtribdRuntimeContractDiagnostic = {
    status: ok ? 'pass' : 'fail',
    package: pkg,
    runtime_metadata_available: true,
    expected_coverage_version: EXPECTED_RECALL_COVERAGE_VERSION,
    expected_content_index_version: EXPECTED_RECALL_CONTENT_INDEX_VERSION,
  }
  if (version) diagnostic.version = version
  if (coverageVersion) diagnostic.coverage_version = coverageVersion
  if (contentIndexVersion) diagnostic.content_index_version = contentIndexVersion
  if (!ok) {
    diagnostic.reason =
      `expected @atrib/recall ${EXPECTED_RECALL_COVERAGE_VERSION} and ` +
      `${EXPECTED_RECALL_CONTENT_INDEX_VERSION}`
  }
  return diagnostic
}

function behavioralProbeSkipped(
  spec: PrimitiveSpec,
  reason: string,
): AtribdBehavioralProbeDiagnostic {
  return {
    status: 'skipped',
    primitive: spec.name,
    tool_names: [...spec.expectedTools],
    probe_kind: 'not-available',
    mutates_log_on_call: spec.mutatesLogOnCall,
    reason,
  }
}

function behavioralProbePassed(
  spec: PrimitiveSpec,
  probeKind: AtribdBehavioralProbeDiagnostic['probe_kind'],
  observed: Record<string, unknown>,
): AtribdBehavioralProbeDiagnostic {
  return {
    status: 'pass',
    primitive: spec.name,
    tool_names: [...spec.expectedTools],
    probe_kind: probeKind,
    mutates_log_on_call: spec.mutatesLogOnCall,
    observed,
  }
}

function behavioralProbeFailed(
  spec: PrimitiveSpec,
  reason: string,
): AtribdBehavioralProbeDiagnostic {
  return {
    status: 'fail',
    primitive: spec.name,
    tool_names: [...spec.expectedTools],
    probe_kind: spec.mutatesLogOnCall ? 'not-available' : 'read-only',
    mutates_log_on_call: spec.mutatesLogOnCall,
    reason,
  }
}

function parseToolJsonResult(toolName: string, result: CallToolResult): unknown {
  const text = result.content?.find(
    (item): item is { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string',
  )?.text
  if (!text) throw new Error(`${toolName} returned no text content`)
  return JSON.parse(text)
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an object`)
  }
  return value as Record<string, unknown>
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} did not return an array`)
  return value
}

async function callProbeTool(
  primitive: MountedPrimitive,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const result = await callWithToolTimeout(
    `${primitive.name}.${toolName}`,
    Math.min(timeoutMs, 5_000),
    () =>
      primitive.client.callTool({
        name: toolName,
        arguments: args,
      }) as Promise<CallToolResult>,
  )
  return assertObject(parseToolJsonResult(toolName, result), toolName)
}

async function probeRecallBehavior(
  primitive: MountedPrimitive,
  spec: PrimitiveSpec,
  timeoutMs: number,
): Promise<AtribdBehavioralProbeDiagnostic> {
  const payload = await callProbeTool(
    primitive,
    'recall_by_content',
    {
      query: 'atrib primitive runtime behavioral health probe',
      k: 1,
      max_records: 10,
      evidence_mode: 'bounded',
    },
    timeoutMs,
  )
  const runtime = assertObject(payload.runtime, 'recall_by_content.runtime')
  const coverage = assertObject(payload.coverage, 'recall_by_content.coverage')
  const index = assertObject(coverage.index, 'recall_by_content.coverage.index')
  if (runtime.coverage_version !== EXPECTED_RECALL_COVERAGE_VERSION) {
    throw new Error(`unexpected recall coverage_version ${String(runtime.coverage_version)}`)
  }
  if (runtime.content_index_version !== EXPECTED_RECALL_CONTENT_INDEX_VERSION) {
    throw new Error(
      `unexpected recall content_index_version ${String(runtime.content_index_version)}`,
    )
  }
  if (index.version !== EXPECTED_RECALL_CONTENT_INDEX_VERSION) {
    throw new Error(`unexpected recall coverage.index.version ${String(index.version)}`)
  }
  return behavioralProbePassed(spec, 'read-only', {
    tool: 'recall_by_content',
    content_index_version: runtime.content_index_version,
    coverage_version: runtime.coverage_version,
    coverage_index_status: index.status,
    searched_records: payload.searched_records,
  })
}

async function probeTraceBehavior(
  primitive: MountedPrimitive,
  spec: PrimitiveSpec,
  timeoutMs: number,
): Promise<AtribdBehavioralProbeDiagnostic> {
  const backward = await callProbeTool(
    primitive,
    'trace',
    { record_hash: HEALTH_PROBE_ABSENT_HASH, depth: 0, compact: true },
    timeoutMs,
  )
  const forward = await callProbeTool(
    primitive,
    'trace_forward',
    { record_hash: HEALTH_PROBE_ABSENT_HASH, depth: 0, compact: true },
    timeoutMs,
  )
  for (const [label, payload, direction] of [
    ['trace', backward, 'backward'],
    ['trace_forward', forward, 'forward'],
  ] as const) {
    if (payload.start_hash !== HEALTH_PROBE_ABSENT_HASH) {
      throw new Error(`${label} returned unexpected start_hash ${String(payload.start_hash)}`)
    }
    if (payload.direction !== direction) {
      throw new Error(`${label} returned unexpected direction ${String(payload.direction)}`)
    }
    const dangling = assertArray(payload.dangling, `${label}.dangling`)
    if (!dangling.includes(HEALTH_PROBE_ABSENT_HASH)) {
      throw new Error(`${label} did not surface the absent probe hash as dangling`)
    }
    const visited = assertArray(payload.visited, `${label}.visited`)
    if (visited.length !== 0) {
      throw new Error(`${label} visited records for an absent probe hash`)
    }
  }
  return behavioralProbePassed(spec, 'read-only', {
    tools: ['trace', 'trace_forward'],
    absent_hash_dangling: true,
  })
}

async function probeSummarizeBehavior(
  primitive: MountedPrimitive,
  spec: PrimitiveSpec,
  timeoutMs: number,
): Promise<AtribdBehavioralProbeDiagnostic> {
  const payload = await callProbeTool(
    primitive,
    'summarize',
    { context_id: HEALTH_PROBE_ABSENT_CONTEXT_ID, max_records: 1 },
    timeoutMs,
  )
  if (payload.narrative !== null) {
    throw new Error('summarize produced a narrative for the absent health-probe context')
  }
  if (payload.records_summarized !== 0) {
    throw new Error(`summarize matched ${String(payload.records_summarized)} probe record(s)`)
  }
  const warnings = assertArray(payload.warnings, 'summarize.warnings').map(String)
  const expectedWarning = warnings.find(
    (warning) =>
      warning.includes('no records matched') || warning.includes('no LLM API key resolved'),
  )
  if (!expectedWarning) {
    throw new Error('summarize did not report a deterministic zero-record health-probe path')
  }
  return behavioralProbePassed(spec, 'schema-only', {
    tool: 'summarize',
    records_summarized: payload.records_summarized,
    warning: expectedWarning,
  })
}

async function probeVerifyBehavior(
  primitive: MountedPrimitive,
  spec: PrimitiveSpec,
  timeoutMs: number,
): Promise<AtribdBehavioralProbeDiagnostic> {
  const payload = await callProbeTool(
    primitive,
    'atrib-verify',
    { records: [], required_record_hashes: [HEALTH_PROBE_ABSENT_HASH] },
    timeoutMs,
  )
  if (payload.all_accepted !== false) {
    throw new Error('atrib-verify accepted an intentionally missing required record')
  }
  const rejected = assertArray(payload.rejected, 'atrib-verify.rejected')
  const missing = rejected.find((entry) => {
    const claim = assertObject(entry, 'atrib-verify.rejected[]')
    return (
      claim.record_hash === HEALTH_PROBE_ABSENT_HASH &&
      Array.isArray(claim.rejection_reasons) &&
      claim.rejection_reasons.includes('record_missing')
    )
  })
  if (!missing) {
    throw new Error('atrib-verify did not reject the absent probe hash as record_missing')
  }
  return behavioralProbePassed(spec, 'read-only', {
    tool: 'atrib-verify',
    missing_required_record_rejected: true,
  })
}

async function inspectPrimitiveBehavioralProbes(
  mounted: readonly MountedPrimitive[],
  timeoutMs: number,
): Promise<Record<string, AtribdBehavioralProbeDiagnostic>> {
  const byName = new Map(mounted.map((primitive) => [primitive.name, primitive]))
  const entries: [string, AtribdBehavioralProbeDiagnostic][] = []
  for (const spec of PRIMITIVE_SPECS) {
    const primitive = byName.get(spec.name)
    if (!primitive) {
      entries.push([spec.name, behavioralProbeFailed(spec, 'primitive did not mount')])
      continue
    }
    if (spec.mutatesLogOnCall) {
      entries.push([
        spec.name,
        behavioralProbeSkipped(
          spec,
          'write primitive has no validate-only contract; health checks must not sign records',
        ),
      ])
      continue
    }
    try {
      if (spec.name === 'recall') {
        entries.push([spec.name, await probeRecallBehavior(primitive, spec, timeoutMs)])
      } else if (spec.name === 'trace') {
        entries.push([spec.name, await probeTraceBehavior(primitive, spec, timeoutMs)])
      } else if (spec.name === 'summarize') {
        entries.push([spec.name, await probeSummarizeBehavior(primitive, spec, timeoutMs)])
      } else if (spec.name === 'verify') {
        entries.push([spec.name, await probeVerifyBehavior(primitive, spec, timeoutMs)])
      } else {
        entries.push([spec.name, behavioralProbeSkipped(spec, 'no behavioral probe defined')])
      }
    } catch (error) {
      entries.push([spec.name, behavioralProbeFailed(spec, errorMessage(error))])
    }
  }
  return Object.fromEntries(entries)
}

function inspectPrimitiveSurfaceContracts(
  mounted: readonly MountedPrimitive[],
): Record<string, AtribdSurfaceContractDiagnostic> {
  return Object.fromEntries(
    PRIMITIVE_SPECS.map((spec) => {
      const primitive = mounted.find((candidate) => candidate.name === spec.name)
      const mountedTools = primitive
        ? primitive.tools.map((tool) => tool.name).sort((a, b) => a.localeCompare(b))
        : []
      const expectedTools = [...spec.expectedTools].sort((a, b) => a.localeCompare(b))
      const missingTools = expectedTools.filter((tool) => !mountedTools.includes(tool))
      const unexpectedTools = mountedTools.filter((tool) => !expectedTools.includes(tool))
      const version = readDependencyPackageVersion(spec.packageName)
      const issues = []
      if (!primitive) issues.push('primitive did not mount')
      if (!version) issues.push('package version could not be read')
      if (missingTools.length) issues.push(`missing tool(s): ${missingTools.join(', ')}`)
      if (unexpectedTools.length) issues.push(`unexpected tool(s): ${unexpectedTools.join(', ')}`)

      const diagnostic: AtribdSurfaceContractDiagnostic = {
        status: issues.length ? 'fail' : 'pass',
        primitive: spec.name,
        package: spec.packageName,
        expected_tools: expectedTools,
        mounted_tools: mountedTools,
        missing_tools: missingTools,
        unexpected_tools: unexpectedTools,
        mutates_log_on_call: spec.mutatesLogOnCall,
        probe_mode: spec.probeMode,
      }
      if (version) diagnostic.version = version
      if (issues.length) diagnostic.reason = issues.join('; ')
      return [spec.name, diagnostic]
    }),
  )
}

async function inspectRuntimeContracts(
  mounted: readonly MountedPrimitive[],
  timeoutMs: number,
): Promise<AtribdRuntimeContracts> {
  const primitives = inspectPrimitiveSurfaceContracts(mounted)
  const behavioralProbes = await inspectPrimitiveBehavioralProbes(mounted, timeoutMs)
  try {
    const recall = (await import('@atrib/recall')) as Record<string, unknown>
    const contractFn = recall.getAtribRecallRuntimeContract
    if (typeof contractFn !== 'function') {
      return {
        primitives,
        behavioral_probes: behavioralProbes,
        recall_content: failedRecallContract(
          '@atrib/recall does not export getAtribRecallRuntimeContract',
        ),
      }
    }
    return {
      primitives,
      behavioral_probes: behavioralProbes,
      recall_content: validateRecallRuntimeContract(contractFn()),
    }
  } catch (error) {
    return {
      primitives,
      behavioral_probes: behavioralProbes,
      recall_content: failedRecallContract(errorMessage(error)),
    }
  }
}

export function runtimeContractsDegraded(contracts: AtribdRuntimeContracts): boolean {
  return (
    contracts.recall_content.status !== 'pass' ||
    Object.values(contracts.primitives).some((contract) => contract.status !== 'pass') ||
    Object.values(contracts.behavioral_probes).some((probe) => probe.status === 'fail')
  )
}

async function mountPrimitive(
  name: string,
  factory: AtribdPrimitiveFactory,
): Promise<MountedPrimitive> {
  const handle = await factory()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await handle.mcp.connect(serverTransport)

  const client = new Client({
    name: `atribd-${name}`,
    version: readPackageVersion(),
  })
  await client.connect(clientTransport)

  const listed = await client.listTools()
  return { name, handle, client, tools: listed.tools }
}

export async function createAtribdBackend(
  options: AtribdBackendOptions = {},
): Promise<AtribdBackend> {
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const primitives = options.primitives ?? PRIMITIVES
  const specByName = new Map(PRIMITIVE_SPECS.map((spec) => [spec.name, spec]))
  const mounted: MountedPrimitive[] = []
  for (const [name, factory] of primitives) {
    mounted.push(await mountPrimitive(name, factory))
  }
  const routeByTool = new Map<string, ToolRoute>()
  const tools: Tool[] = []
  const inFlightToolCalls = new Map<string, InFlightToolCall>()
  const writeLocks = new ContextWriteLocks()
  const runtimeContracts = await inspectRuntimeContracts(mounted, toolTimeoutMs)
  let callsStarted = 0
  let callsSucceeded = 0
  let callsFailed = 0
  let callsTimedOut = 0
  let callsSettledAfterTimeout = 0

  for (const primitive of mounted) {
    // Unknown mount names default to the read handler; only tools served by
    // a registered write primitive go through the write handler's lock.
    const kind: AtribdHandlerKind = specByName.get(primitive.name)?.kind ?? 'read'
    for (const tool of primitive.tools) {
      const existing = routeByTool.get(tool.name)
      if (existing) {
        throw new Error(
          `duplicate atrib primitive tool ${tool.name}: ${existing.primitive} and ${primitive.name}`,
        )
      }
      routeByTool.set(tool.name, { primitive: primitive.name, kind, client: primitive.client })
      tools.push(tool)
    }
  }

  tools.sort((a, b) => a.name.localeCompare(b.name))

  const routeToolCall = async (
    route: ToolRoute,
    request: CallToolRequest['params'],
  ): Promise<CallToolResult> => {
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
    logDaemonEvent({
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
        logDaemonEvent({
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
      logDaemonEvent({
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
              logDaemonEvent({
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
              logDaemonEvent({
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
      logDaemonEvent({
        event: 'tool_call_failed',
        id,
        primitive: route.primitive,
        tool: request.name,
        elapsed_ms: Date.now() - startedAt,
        error: errorMessage(error),
      })
      throw error
    }
  }

  // The two internal handlers of the daemon. The write handler serializes
  // per resolved context so concurrent writers cannot race read-tail, sign,
  // append against the same chain. The read handler routes directly.
  const callWriteTool = async (
    route: ToolRoute,
    request: CallToolRequest['params'],
  ): Promise<CallToolResult> => {
    const key = writeSerializationKey(request)
    if (!key) return routeToolCall(route, request)
    return writeLocks.run(key, () => routeToolCall(route, request))
  }

  const callReadTool = (
    route: ToolRoute,
    request: CallToolRequest['params'],
  ): Promise<CallToolResult> => routeToolCall(route, request)

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
      return route.kind === 'write' ? callWriteTool(route, request) : callReadTool(route, request)
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
    runtimeContracts: () => runtimeContracts,
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
