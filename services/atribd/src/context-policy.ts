// SPDX-License-Identifier: Apache-2.0

/**
 * Context-identity policy for the stateless HTTP surface (P046).
 *
 * Precedence per request, using the legacy inbound carriers that
 * `readInboundContext` in @atrib/mcp reads (`_meta.atrib`, the tracestate
 * `atrib=` entry, the §1.5.3 `X-Atrib-Chain` fallback, and the traceparent
 * trace-id). The `dev.atrib/attribution` extension rungs of §1.5.4 are not
 * read here yet:
 *
 *   1. Explicit `context_id` tool argument (32-hex). Passed through
 *      untouched; the daemon adds nothing.
 *   2. Inbound carrier resolution from per-request `_meta`. When the
 *      carriers resolve a context_id (traceparent trace-id) the daemon
 *      injects it as the explicit argument; when they also resolve a
 *      propagation token, the token's record hash is injected as
 *      `chain_root` on tools whose schema accepts it, seeding chain-tail
 *      resolution per D067 rung 1.
 *   3. Nothing resolves: write primitives get a typed tool error
 *      (`atrib: context_id required on stateless transport`). Read
 *      primitives that support unscoped queries proceed per their own
 *      scope rules. A single-tenant daemon may opt back into ambient
 *      env/profile-file discovery (D083 v3) with the ambient-context
 *      flag, in which case the call passes through and the primitive's
 *      own D078/D083 ladder applies.
 *
 * Chain-root selection itself is never reimplemented here: the injected
 * values feed `resolveChainRoot` through the primitives' existing
 * caller-argument path, and its D067 precedence is untouched.
 */

import { KNOWN_HARNESS_DISCOVERIES, hexEncode, readInboundContext } from '@atrib/mcp'
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { WRITE_TOOL_NAMES } from './backend.js'

const CONTEXT_ID_PATTERN = /^[0-9a-f]{32}$/

/** Write tools whose input schema accepts a caller-managed chain_root. */
const CHAIN_ROOT_CAPABLE_TOOLS: ReadonlySet<string> = new Set(['emit'])

export const MISSING_CONTEXT_ERROR_TEXT = 'atrib: context_id required on stateless transport'

export type HttpContextPolicyOutcome =
  | { kind: 'pass'; params: CallToolRequest['params'] }
  | { kind: 'injected'; params: CallToolRequest['params'] }
  | { kind: 'rejected'; result: CallToolResult }

function argumentsRecord(params: CallToolRequest['params']): Record<string, unknown> {
  const args = params.arguments
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  return {}
}

/**
 * Apply the stateless-HTTP context policy to one tools/call request.
 * Never mutates the caller's params object.
 */
export function applyHttpContextPolicy(
  params: CallToolRequest['params'],
  options: { ambientContext: boolean },
): HttpContextPolicyOutcome {
  if (!WRITE_TOOL_NAMES.has(params.name)) {
    return { kind: 'pass', params }
  }

  const args = argumentsRecord(params)
  const explicit = args['context_id']
  if (typeof explicit === 'string' && CONTEXT_ID_PATTERN.test(explicit)) {
    return { kind: 'pass', params }
  }

  // Rung 2: per-request _meta carriers (§1.5.4 ladder + §1.5.3 fallback).
  const inbound = readInboundContext(params as unknown as Record<string, unknown>)
  if (inbound?.contextId && CONTEXT_ID_PATTERN.test(inbound.contextId)) {
    const injected: Record<string, unknown> = { ...args, context_id: inbound.contextId }
    if (
      CHAIN_ROOT_CAPABLE_TOOLS.has(params.name) &&
      args['chain_root'] === undefined &&
      inbound.recordHash.length === 32
    ) {
      injected['chain_root'] = `sha256:${hexEncode(inbound.recordHash)}`
    }
    return { kind: 'injected', params: { ...params, arguments: injected } }
  }

  if (options.ambientContext) {
    return { kind: 'pass', params }
  }

  return {
    kind: 'rejected',
    result: {
      content: [{ type: 'text', text: MISSING_CONTEXT_ERROR_TEXT }],
      isError: true,
    },
  }
}

/**
 * stdio-to-HTTP proxy context rung. The proxy child is spawned by the
 * harness, so its environment can name the session that started it
 * (`ATRIB_CONTEXT_ID`, `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`). For a write
 * call whose arguments omit `context_id` entirely and that carries no `_meta`
 * context carrier, forward that environment value as an explicit `context_id`.
 *
 * Only environment rungs are used. The D083 file rungs (the per-parent-PID and
 * profile active-session files) name whichever session last wrote them, and a
 * harness that runs many sessions under one parent process shares those files,
 * so they would sign concurrent sessions under each other's context. Anything
 * else (a present `context_id`, a non-object `arguments`, any `_meta` carrier,
 * or no environment value) passes through unchanged and the daemon decides.
 * Never mutates the caller's params object.
 */
export function applyStdioProxyContext(
  params: CallToolRequest['params'],
  resolveSession: () => string | undefined = resolveProxySessionContext,
): CallToolRequest['params'] {
  if (!WRITE_TOOL_NAMES.has(params.name)) return params

  const raw = params.arguments
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    return params
  }
  const args = (raw ?? {}) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(args, 'context_id')) return params
  if (hasContextCarrier(params)) return params

  let session: string | undefined
  try {
    session = resolveSession()
  } catch {
    return params
  }
  if (!session || !CONTEXT_ID_PATTERN.test(session)) return params

  return { ...params, arguments: { ...args, context_id: session } }
}

function hasContextCarrier(params: CallToolRequest['params']): boolean {
  if (readInboundContext(params as unknown as Record<string, unknown>)) return true
  const meta = (params as { _meta?: unknown })._meta
  if (!meta || typeof meta !== 'object') return false
  // Any present carrier key counts, valid or not: the daemon decides what a
  // malformed carrier means, and the proxy never substitutes for it.
  return Object.keys(meta).some((key) => CONTEXT_CARRIER_META_KEYS.has(key))
}

/** `_meta` keys the §1.5.4 ladders name, spelled as the spec spells them. */
const CONTEXT_CARRIER_META_KEYS: ReadonlySet<string> = new Set([
  'dev.atrib/attribution',
  'atrib',
  'traceparent',
  'tracestate',
  'X-Atrib-Chain',
  'x-atrib-chain',
])

/**
 * The proxy's session ladder: `ATRIB_CONTEXT_ID`, then each registered harness
 * environment variable in registry order. No file rung is consulted.
 */
export function resolveProxySessionContext(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = env['ATRIB_CONTEXT_ID']
  if (explicit && CONTEXT_ID_PATTERN.test(explicit)) return explicit
  for (const discovery of KNOWN_HARNESS_DISCOVERIES) {
    if (discovery.envVar === '') continue
    const value = env[discovery.envVar]
    if (value === undefined || value === '') continue
    try {
      const parsed = discovery.parse(value)
      if (parsed && CONTEXT_ID_PATTERN.test(parsed)) return parsed
    } catch {
      // A registry parser that throws falls through to the next rung.
    }
  }
  return undefined
}
