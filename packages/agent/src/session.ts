// SPDX-License-Identifier: Apache-2.0

/**
 * Agent session state management (§5.4).
 *
 * Tracks the latest attribution context across sequential tool calls
 * within a session. The session is initialized lazily on the first
 * outbound tool call.
 */

import {
  base64urlEncode,
  hexEncode,
  decodeToken,
  mergeTracestate,
  mergeBaggageAtribSession,
  type DecodedToken,
} from '@atrib/mcp'

/** The latest attribution context from the most recent tool response. */
export interface LatestContext {
  recordHash: Uint8Array
  creatorKey: Uint8Array
}

/** Mutable session state, evolved by each tool call/response. */
export interface SessionState {
  contextId: string
  sessionToken: string
  latestContext: LatestContext | null
  initialized: boolean
  /** The record_id from the session policy record, set after init. */
  policyRecordId: string | null
  warnings: string[]
}

/** Options for creating a session. */
export interface SessionOptions {
  /** Base64url-encoded Ed25519 private key (32 bytes). */
  creatorKey: string
  /** Session token for cross-trace linking. Auto-generated if absent. */
  sessionToken?: string | undefined
}

/**
 * Create a new session state.
 */
export function createSession(options: SessionOptions): SessionState {
  // Generate context_id (random 16-byte hex if no OTel trace available)
  const contextIdBytes = new Uint8Array(16)
  crypto.getRandomValues(contextIdBytes)
  const contextId = hexEncode(contextIdBytes)

  // Generate or use provided session_token
  let sessionToken: string
  if (options.sessionToken) {
    sessionToken = options.sessionToken
  } else {
    const tokenBytes = new Uint8Array(16)
    crypto.getRandomValues(tokenBytes)
    sessionToken = base64urlEncode(tokenBytes)
  }

  return {
    contextId,
    sessionToken,
    latestContext: null,
    initialized: false,
    policyRecordId: null,
    warnings: [],
  }
}

/**
 * Build the outbound _meta for a tools/call request (§5.4.3).
 * Attaches attribution context, traceparent, session_token, and policy record ID.
 */
/**
 * Build the outbound _meta for a tools/call request (§5.4.3).
 * Attaches attribution context, traceparent, session_token, and policy record ID.
 *
 * Merges with the caller's existing _meta:
 * - `baggage` and `tracestate` are APPENDED (W3C semantics, multi-vendor safe)
 * - `traceparent` is overwritten only if the caller has not supplied one
 * - `atrib` and `X-Atrib-Chain` are set (atrib-owned keys)
 */
export function buildOutboundMeta(
  session: SessionState,
  existing: Record<string, unknown> = {},
): Record<string, string> {
  const meta: Record<string, string> = {}

  // §1.5.4: traceparent. only set if caller has not provided one.
  // If they have one, the trace-id should already match session.contextId
  // (since the session adopted it), so we leave it untouched.
  if (typeof existing.traceparent === 'string') {
    meta.traceparent = existing.traceparent
  } else {
    const parentIdBytes = new Uint8Array(8)
    crypto.getRandomValues(parentIdBytes)
    const parentId = hexEncode(parentIdBytes)
    meta.traceparent = `00-${session.contextId}-${parentId}-01`
  }

  // §5.4.3: baggage gets atrib-session prepended (most-recent vendor first
  // per W3C). mergeBaggageAtribSession dedupes prior atrib-session entries
  // and enforces the W3C 64-list-member and 8192-byte limits, evicting
  // entries from the rightmost end if needed.
  //
  // policy is added as a separate, non-evictable entry. We add it after the
  // session merge to ensure both atrib entries are leftmost.
  const existingBaggage = typeof existing.baggage === 'string' ? existing.baggage : ''
  let baggage = mergeBaggageAtribSession(session.sessionToken, existingBaggage)
  if (session.policyRecordId) {
    baggage = `atrib-policy=${session.policyRecordId},${baggage}`
  }
  meta.baggage = baggage

  // Attach latest attribution token if available
  if (session.latestContext) {
    const token = `${base64urlEncode(session.latestContext.recordHash)}.${base64urlEncode(session.latestContext.creatorKey)}`
    meta.atrib = token
    meta['X-Atrib-Chain'] = token

    // §5.4.3: tracestate gets `atrib=<token>` PREPENDED so atrib appears
    // leftmost (W3C "most recent vendor first" convention). mergeTracestate
    // dedupes any prior atrib entry and enforces the W3C 32-list-member
    // maximum, evicting from the rightmost end if needed.
    const existingTracestate = typeof existing.tracestate === 'string' ? existing.tracestate : ''
    meta.tracestate = mergeTracestate(`atrib=${token}`, existingTracestate)
  } else if (typeof existing.tracestate === 'string') {
    // Preserve caller's tracestate if no atrib token to add
    meta.tracestate = existing.tracestate
  }

  return meta
}

/**
 * Read inbound attribution context from a tool response (§5.4.4).
 * Updates session state with the latest context.
 * Returns true if an attribution token was found.
 */
export function accumulateInboundContext(
  session: SessionState,
  responseMeta: Record<string, unknown> | undefined,
): boolean {
  if (!responseMeta) return false

  // Priority: _meta.atrib > tracestate atrib= > X-Atrib-Chain
  let decoded: DecodedToken | null = null

  if (typeof responseMeta.atrib === 'string') {
    decoded = decodeToken(responseMeta.atrib)
  }

  if (!decoded && typeof responseMeta.tracestate === 'string') {
    // W3C Trace Context list-member grammar allows OWS around `=`. Be lenient
    // about whitespace and accept the entry whether it's leftmost or not.
    for (const entry of responseMeta.tracestate.split(',')) {
      const trimmed = entry.trim()
      const match = trimmed.match(/^atrib\s*=\s*(.*)$/)
      if (match && match[1] !== undefined) {
        decoded = decodeToken(match[1].trim())
        break
      }
    }
  }

  if (!decoded) {
    const xAtribChain = responseMeta['X-Atrib-Chain'] ?? responseMeta['x-atrib-chain']
    if (typeof xAtribChain === 'string') {
      decoded = decodeToken(xAtribChain)
    }
  }

  if (decoded) {
    session.latestContext = {
      recordHash: decoded.recordHash,
      creatorKey: decoded.creatorKey,
    }
    return true
  }

  // No token → tool doesn't have @atrib/mcp. Gap node in graph. Session continues.
  return false
}
