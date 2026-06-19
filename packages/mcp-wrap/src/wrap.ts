// The core wrap() function. Composes:
//   - key resolution (keys.ts)
//   - record persistence + autoChain seeding (mirror.ts)
//   - per-tool overrides (config.ts → preCallTransform + transactionTools)
//   - createAtribProxy from @atrib/mcp (the actual MCP wiring)
//
// Returns the live proxy. The caller (main.ts) is responsible for connecting
// it to a stdio transport and handling shutdown signals.

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  createAtribProxy,
  createHttpLocalSubstrateTransport,
  defaultRecordReferenceResolver,
  recordHashExistsInMirror,
  resolveEnvContextId,
  SHA256_REF_PATTERN,
  type AtribOptions,
  type AtribProxy,
  type PreCallTransform,
} from '@atrib/mcp'
import type { WrapConfig } from './config.js'
import { resolveKey, type ResolvedKey } from './keys.js'
import { loadAutoChainSeed, persistRecord } from './mirror.js'

const RECORD_REFERENCE_LOCAL_LOOKUP_TIMEOUT_MS = 500

export type LogFn = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  extra?: Record<string, unknown>,
) => void

/** Inputs that callers (or tests) inject; defaults wire to disk + the real proxy. */
export interface WrapDeps {
  /** Resolve the signing key. Defaults to `resolveKey(config.agent)`. */
  resolveKey?: (agent: string) => Promise<ResolvedKey>
  /** Logger. Defaults to a no-op when not provided (silent operation). */
  log?: LogFn
  /**
   * Optional pre-built upstream transport. When present, wrap() connects the
   * atrib proxy to this transport instead of spawning config.upstream.command.
   * This lets host-owned runtimes mount an upstream MCP server in process while
   * preserving the same signing, mirror, autoChain, and receipt-injection path.
   */
  upstreamTransport?: Transport
}

/**
 * Build the preCallTransform hook from a WrapConfig's `tools` map. Returns
 * undefined when no tool has `injectReceiptId: true` (so the middleware
 * never enters the pre-call signing branch and the latency contract is
 * preserved per D057). Exported for direct testing.
 */
export function buildPreCallTransform(config: WrapConfig): PreCallTransform | undefined {
  const tools = config.tools ?? {}
  const injectTools = new Set(
    Object.entries(tools)
      .filter(([, override]) => override.injectReceiptId === true)
      .map(([name]) => name),
  )
  if (injectTools.size === 0) return undefined
  return (ctx) => {
    if (!injectTools.has(ctx.toolName)) return undefined
    return { ...ctx.args, atrib_receipt_id: ctx.receiptId }
  }
}

type InformedByHook = NonNullable<AtribOptions['informedBy']>
type LocalSubstrateAttemptHook = NonNullable<
  NonNullable<AtribOptions['localSubstrate']>['onAttempt']
>
type LocalSubstrateCommitAttemptHook = NonNullable<
  NonNullable<AtribOptions['localSubstrateCommit']>['onAttempt']
>
type LocalSubstrateAttemptLoggerInput =
  | Parameters<LocalSubstrateAttemptHook>[0]
  | Parameters<LocalSubstrateCommitAttemptHook>[0]

function valueAtPath(value: unknown, path: string): unknown {
  let current = value
  for (const part of path.split('.')) {
    if (!part) return undefined
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function collectExactRecordRefs(value: unknown, out: Set<string>): void {
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    if (SHA256_REF_PATTERN.test(value)) out.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExactRecordRefs(item, out)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectExactRecordRefs(item, out)
    }
  }
}

/**
 * Build an informedBy hook from per-tool exact argument paths. The paths are
 * relative to `params.arguments`, so `metadata.message_envelope.informed_by`
 * reads `params.arguments.metadata.message_envelope.informed_by`.
 */
export function buildInformedBy(config: WrapConfig): InformedByHook | undefined {
  const pathsByTool = new Map<string, string[]>()
  for (const [toolName, override] of Object.entries(config.tools ?? {})) {
    if (override.informedByPaths && override.informedByPaths.length > 0) {
      pathsByTool.set(toolName, override.informedByPaths)
    }
  }
  if (pathsByTool.size === 0) return undefined

  return (params) => {
    const toolName = typeof params.name === 'string' ? params.name : ''
    const paths = pathsByTool.get(toolName)
    if (!paths) return undefined
    const args =
      params.arguments !== null &&
      typeof params.arguments === 'object' &&
      !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {}

    const refs = new Set<string>()
    for (const path of paths) {
      collectExactRecordRefs(valueAtPath(args, path), refs)
    }
    return refs.size > 0 ? [...refs].sort() : undefined
  }
}

export function buildRecordReferenceResolver(
  config: WrapConfig,
  recordFile: string,
  log: LogFn = () => {},
): AtribOptions['recordReferenceResolver'] {
  return async (candidate) => {
    const startedAt = Date.now()
    if (
      recordFile &&
      (await recordHashExistsInMirror({ path: recordFile, recordHash: candidate.recordHash }))
    ) {
      return true
    }

    const resolution = await defaultRecordReferenceResolver(
      candidate.recordHash,
      config.logEndpoint,
      { localLookupTimeoutMs: RECORD_REFERENCE_LOCAL_LOOKUP_TIMEOUT_MS },
    )
    if (resolution === 'found') return true

    log('warn', 'dropped unresolved informed_by candidate', {
      record_hash: candidate.recordHash,
      source: candidate.source,
      tool_name: candidate.toolName,
      resolution,
      lookup_elapsed_ms: Date.now() - startedAt,
      local_lookup_timeout_ms: RECORD_REFERENCE_LOCAL_LOOKUP_TIMEOUT_MS,
    })
    return false
  }
}

/** Default file paths under ~/.atrib for a given name + agent. */
function defaultPaths(config: WrapConfig): { logFile: string; recordFile: string } {
  const suffix = config.name === config.agent ? config.name : `${config.name}-${config.agent}`
  return {
    logFile: config.logFile ?? join(homedir(), '.atrib', 'logs', `${suffix}.log`),
    recordFile: config.recordFile ?? join(homedir(), '.atrib', 'records', `${suffix}.jsonl`),
  }
}

function buildLocalSubstrateAttemptLogger(
  log: LogFn,
  mode: 'shadow' | 'commit',
): (attempt: LocalSubstrateAttemptLoggerInput) => void {
  return (attempt) => {
    const result = attempt.result
    const level = result.ok && attempt.recordHashMatches !== false ? 'info' : 'warn'
    log(level, `local substrate ${mode} attempt completed`, {
      status: result.status,
      elapsed_ms: result.elapsed_ms,
      expected_record_hash: attempt.expectedRecordHash,
      record_hash_matches: attempt.recordHashMatches,
      response_record_hash: result.ok ? result.response.record_hash : undefined,
      reason:
        result.status === 'rejected' || result.status === 'unavailable' ? result.reason : undefined,
      issue_count:
        result.status === 'invalid_request' || result.status === 'invalid_response'
          ? result.issues.length
          : undefined,
    })
  }
}

function localSubstrateWarningDetail(detail: unknown): Record<string, unknown> | undefined {
  if (detail === undefined) return undefined
  if (detail !== null && typeof detail === 'object' && !Array.isArray(detail)) {
    return detail as Record<string, unknown>
  }
  return { detail: String(detail) }
}

/**
 * Wrap an MCP server per the supplied config. Returns the live AtribProxy
 * plus the resolved key info (for caller-side bootstrap logging).
 *
 * The caller owns the stdio transport hookup + shutdown signal handling
 * (see main.ts). This function is async because key resolution and the
 * upstream MCP handshake both await.
 */
export async function wrap(
  config: WrapConfig,
  deps: WrapDeps = {},
): Promise<{ proxy: AtribProxy; key: ResolvedKey; logFile: string; recordFile: string }> {
  const log: LogFn = deps.log ?? (() => {})
  const key = await (deps.resolveKey ?? resolveKey)(config.agent)
  const { logFile, recordFile } = defaultPaths(config)

  const transactionTools = Object.entries(config.tools ?? {})
    .filter(([, override]) => override.transactionTool === true)
    .map(([name]) => name)

  const autoChainSeed = config.autoChain
    ? loadAutoChainSeed(recordFile, (msg, extra) => log('warn', msg, extra))
    : []
  if (autoChainSeed.length > 0) {
    log('info', 'autoChain seeded from local mirror', {
      record_count: autoChainSeed.length,
      distinct_contexts: new Set(autoChainSeed.map((r) => r.context_id)).size,
    })
  }

  const preCallTransform = buildPreCallTransform(config)
  const informedBy = buildInformedBy(config)
  const recordReferenceResolver = buildRecordReferenceResolver(config, recordFile, log)
  const localSubstrateMode = config.localSubstrate?.mode ?? 'shadow'
  const localSubstrateTransport = config.localSubstrate
    ? createHttpLocalSubstrateTransport(config.localSubstrate.endpoint, {
        ...(config.localSubstrate.headers ? { headers: config.localSubstrate.headers } : {}),
      })
    : undefined

  const upstream = deps.upstreamTransport
    ? ({ type: 'inMemory', transport: deps.upstreamTransport } as const)
    : ({
        type: 'stdio',
        command: config.upstream.command,
        ...(config.upstream.args ? { args: config.upstream.args } : {}),
        ...(config.upstream.env ? { env: config.upstream.env } : {}),
      } as const)

  const proxy = await createAtribProxy({
    name: `${config.name}-${config.agent}`,
    version: '0.1.0',
    upstream,
    atrib: {
      creatorKey: key.seedB64url,
      serverUrl: `${config.serverUrl}/${config.agent}`,
      logEndpoint: config.logEndpoint,
      ...(config.archiveSubmission ? { archiveSubmission: config.archiveSubmission } : {}),
      autoChain: config.autoChain,
      autoChainFallback: config.autoChainFallback,
      ...(config.contextIdSource === 'harness' ? { contextIdResolver: resolveEnvContextId } : {}),
      ...(autoChainSeed.length > 0 ? { autoChainSeed } : {}),
      ...(transactionTools.length > 0 ? { transactionTools } : {}),
      autoDetectInformedByFromArgs: config.autoDetectInformedByFromArgs,
      ...(informedBy ? { informedBy } : {}),
      recordReferenceResolver,
      ...(config.disclosure ? { disclosure: config.disclosure } : {}),
      ...(config.localSubstrate && localSubstrateMode === 'shadow' && localSubstrateTransport
        ? {
            localSubstrate: {
              transport: localSubstrateTransport,
              ...(config.localSubstrate.timeoutMs !== undefined
                ? { timeoutMs: config.localSubstrate.timeoutMs }
                : {}),
              producer: {
                name: `${config.name}-${config.agent}`,
                harness_class: 'startup-spawn',
                pid: process.pid,
                transport: 'stdio-mcp-wrapper',
                creator_key_policy: 'explicit-single-creator',
              },
              onAttempt: buildLocalSubstrateAttemptLogger(log, 'shadow'),
            },
          }
        : {}),
      ...(config.localSubstrate && localSubstrateMode === 'commit' && localSubstrateTransport
        ? {
            localSubstrateCommit: {
              transport: localSubstrateTransport,
              ...(config.localSubstrate.timeoutMs !== undefined
                ? { timeoutMs: config.localSubstrate.timeoutMs }
                : {}),
              producer: {
                name: `${config.name}-${config.agent}`,
                harness_class: 'startup-spawn',
                pid: process.pid,
                transport: 'stdio-mcp-wrapper',
                creator_key_policy: 'explicit-single-creator',
              },
              onAttempt: buildLocalSubstrateAttemptLogger(log, 'commit'),
              onWarning: (message, detail) =>
                log('warn', message, localSubstrateWarningDetail(detail)),
            },
          }
        : {}),
      // Persists the signed record + optional pre-sign sidecar. The sidecar
      // carries the upstream tool name + raw args + raw result so consumers
      // like atrib-trace and atrib-summarize can surface semantic context.
      // Public log submission is unaffected.
      onRecord: (rec, sidecar) =>
        persistRecord(recordFile, rec, (msg, extra) => log('warn', msg, extra), sidecar),
      ...(preCallTransform ? { preCallTransform } : {}),
    },
  })

  return { proxy, key, logFile, recordFile }
}
