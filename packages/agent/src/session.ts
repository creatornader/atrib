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

  // §1.5.4: traceparent — only set if caller has not provided one.
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

  // §5.4.3: baggage += `,atrib-session=...` — APPEND, do not clobber
  const atribBaggageEntries = [`atrib-session=${session.sessionToken}`]
  if (session.policyRecordId) {
    atribBaggageEntries.push(`atrib-policy=${session.policyRecordId}`)
  }
  const existingBaggage = typeof existing.baggage === 'string' ? existing.baggage : ''
  meta.baggage = existingBaggage
    ? `${existingBaggage},${atribBaggageEntries.join(',')}`
    : atribBaggageEntries.join(',')

  // Attach latest attribution token if available
  if (session.latestContext) {
    const token = `${base64urlEncode(session.latestContext.recordHash)}.${base64urlEncode(session.latestContext.creatorKey)}`
    meta.atrib = token
    meta['X-Atrib-Chain'] = token

    // §5.4.3: tracestate += `,atrib=${token}` — APPEND
    const existingTracestate =
      typeof existing.tracestate === 'string' ? existing.tracestate : ''
    meta.tracestate = existingTracestate
      ? `${existingTracestate},atrib=${token}`
      : `atrib=${token}`
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
    const match = responseMeta.tracestate.match(/atrib=([^,]+)/)
    if (match?.[1]) {
      decoded = decodeToken(match[1])
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
