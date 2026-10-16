// SPDX-License-Identifier: Apache-2.0

/**
 * Context-identity policy for the stateless HTTP surface (P046).
 *
 * Precedence per request, citing the single canonical inbound-carrier
 * ladder (spec §1.5.4 with the §1.5.3 `X-Atrib-Chain` fallback, as
 * `readInboundContext` in @atrib/mcp implements):
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

import { hexEncode, readInboundContext, resolveEnvContextId } from '@atrib/mcp'
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
 * harness, so its env and parent PID can carry the D078/D083 ladder that the
 * shared HTTP daemon cannot see. For a write call whose arguments omit
 * `context_id` entirely and that carries no `_meta` context carrier, resolve
 * the child's ladder and forward the result as an explicit `context_id`.
 *
 * The profile active-session file rung is skipped on purpose: it names
 * whichever session of the profile last wrote the file, which is the
 * last-writer attribution `--ambient-context` keeps off by default. A present
 * but invalid `context_id`, a non-object `arguments`, any `_meta` carrier, or
 * an unresolvable ladder passes through unchanged so the daemon's HTTP policy
 * or the primitive schema decides. Never mutates the caller's params object.
 */
export function applyStdioProxyContext(
  params: CallToolRequest['params'],
  resolveAmbient: () => string | undefined = resolveProxyAmbientContext,
): CallToolRequest['params'] {
  if (!WRITE_TOOL_NAMES.has(params.name)) return params

  const raw = params.arguments
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    return params
  }
  const args = (raw ?? {}) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(args, 'context_id')) return params

  if (readInboundContext(params as unknown as Record<string, unknown>)) return params

  let ambient: string | undefined
  try {
    ambient = resolveAmbient()
  } catch {
    return params
  }
  if (!ambient || !CONTEXT_ID_PATTERN.test(ambient)) return params

  return { ...params, arguments: { ...args, context_id: ambient } }
}

/**
 * The proxy's ladder: `ATRIB_CONTEXT_ID`, harness env vars, and the harness
 * parent-process file, without the profile-file rung.
 */
export function resolveProxyAmbientContext(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const withoutProfile: NodeJS.ProcessEnv = { ...env }
  delete withoutProfile['ATRIB_ACTIVE_SESSION_PROFILE']
  delete withoutProfile['ATRIB_AGENT']
  return resolveEnvContextId(withoutProfile)
}
