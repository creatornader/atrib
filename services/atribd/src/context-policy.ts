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

import { hexEncode, readInboundContext } from '@atrib/mcp'
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
