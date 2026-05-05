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
import { createAtribProxy, type AtribProxy, type PreCallTransform } from '@atrib/mcp'
import type { WrapConfig } from './config.js'
import { resolveKey, type ResolvedKey } from './keys.js'
import { loadAutoChainSeed, persistRecord } from './mirror.js'

export type LogFn = (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void

/** Inputs that callers (or tests) inject; defaults wire to disk + the real proxy. */
export interface WrapDeps {
  /** Resolve the signing key. Defaults to `resolveKey(config.agent)`. */
  resolveKey?: (agent: string) => Promise<ResolvedKey>
  /** Logger. Defaults to a no-op when not provided (silent operation). */
  log?: LogFn
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

/** Default file paths under ~/.atrib for a given name + agent. */
function defaultPaths(config: WrapConfig): { logFile: string; recordFile: string } {
  const suffix = config.name === config.agent ? config.name : `${config.name}-${config.agent}`
  return {
    logFile: config.logFile ?? join(homedir(), '.atrib', 'logs', `${suffix}.log`),
    recordFile: config.recordFile ?? join(homedir(), '.atrib', 'records', `${suffix}.jsonl`),
  }
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

  const proxy = await createAtribProxy({
    name: `${config.name}-${config.agent}`,
    version: '0.1.0',
    upstream: {
      type: 'stdio',
      command: config.upstream.command,
      ...(config.upstream.args ? { args: config.upstream.args } : {}),
      ...(config.upstream.env ? { env: config.upstream.env } : {}),
    },
    atrib: {
      creatorKey: key.seedB64url,
      serverUrl: `${config.serverUrl}/${config.agent}`,
      logEndpoint: config.logEndpoint,
      autoChain: config.autoChain,
      ...(autoChainSeed.length > 0 ? { autoChainSeed } : {}),
      ...(transactionTools.length > 0 ? { transactionTools } : {}),
      // mcp-wrap default: scan tool args for sha256:<hex> references and
      // auto-populate informed_by per the dogfood-plug-and-play-map convention.
      // See @atrib/mcp `AtribOptions.autoDetectInformedByFromArgs` for details.
      // Wrapper users get the auto-detect "for free"; raw @atrib/mcp consumers
      // (without mcp-wrap) opt in explicitly.
      autoDetectInformedByFromArgs: true,
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
