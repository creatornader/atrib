/**
 * Inbound/outbound attribution context handling (§5.3.2, §5.3.4).
 */

import { decodeToken, encodeToken } from './token.js'
import type { AtribRecord, DecodedToken } from './types.js'

/** Extracted inbound context from an MCP request. */
export interface InboundContext {
  /** The record_hash from the upstream token, becomes chain_root of the next record. */
  recordHash: Uint8Array
  /** The creator_key from the upstream token, identifies the sender. */
  creatorKey: Uint8Array
  /** OTel trace-id from traceparent, if available. */
  contextId: string | undefined
  /** Session token from baggage, if available. */
  sessionToken: string | undefined
}

/** Options for writing outbound context. */
export interface OutboundContextOptions {
  /** traceparent value to forward (§1.5.4). */
  traceparent?: string | undefined
  /** session_token to propagate in baggage (§1.5.5). */
  sessionToken?: string | undefined
}

/**
 * Read inbound attribution context from an MCP tools/call request (§5.3.2).
 * Priority: params._meta.atrib > tracestate atrib= > X-Atrib-Chain
 */
export function readInboundContext(params: Record<string, unknown>): InboundContext | null {
  const meta = params._meta as Record<string, unknown> | undefined

  // 1. Try params._meta.atrib (MCP stdio and Streamable HTTP)
  let token: DecodedToken | null = null
  if (meta?.atrib && typeof meta.atrib === 'string') {
    token = decodeToken(meta.atrib)
  }

  // 2. Try tracestate in _meta for atrib= entry
  if (!token && meta?.tracestate && typeof meta.tracestate === 'string') {
    const atribEntry = parseTracestateAtrib(meta.tracestate)
    if (atribEntry) {
      token = decodeToken(atribEntry)
    }
  }

  // 3. Try X-Atrib-Chain fallback (§1.5.3)
  if (!token) {
    const xAtribChain = meta?.['X-Atrib-Chain'] ?? meta?.['x-atrib-chain']
    if (typeof xAtribChain === 'string' && xAtribChain.length > 0) {
      token = decodeToken(xAtribChain)
    }
  }

  if (!token) return null

  // Extract context_id from traceparent if present
  let contextId: string | undefined
  if (meta?.traceparent && typeof meta.traceparent === 'string') {
    contextId = extractTraceId(meta.traceparent)
  }

  // Extract session_token from baggage
  let sessionToken: string | undefined
  if (meta?.baggage && typeof meta.baggage === 'string') {
    sessionToken = parseBaggageAtribSession(meta.baggage)
  }

  return {
    recordHash: token.recordHash,
    creatorKey: token.creatorKey,
    contextId,
    sessionToken,
  }
}

/**
 * Write outbound attribution context into an MCP response (§5.3.4).
 * Writes to _meta.atrib, _meta.tracestate, _meta['X-Atrib-Chain'],
 * and optionally _meta.traceparent and _meta.baggage.
 */
export function writeOutboundContext(
  result: Record<string, unknown>,
  signedRecord: AtribRecord,
  options?: OutboundContextOptions,
): void {
  const token = encodeToken(signedRecord)

  // Ensure _meta exists
  if (!result._meta || typeof result._meta !== 'object') {
    result._meta = {}
  }
  const meta = result._meta as Record<string, unknown>

  // Write atrib token (§5.3.4)
  meta.atrib = token

  // Write/append to tracestate, atrib entry leftmost per W3C convention
  if (typeof meta.tracestate === 'string') {
    meta.tracestate = `atrib=${token},${meta.tracestate}`
  } else {
    meta.tracestate = `atrib=${token}`
  }

  // Write X-Atrib-Chain fallback (§1.5.3)
  meta['X-Atrib-Chain'] = token

  // Forward traceparent if available (§1.5.4)
  if (options?.traceparent) {
    meta.traceparent = options.traceparent
  }

  // Write session_token to baggage (§1.5.5 MUST)
  if (options?.sessionToken) {
    if (typeof meta.baggage === 'string') {
      meta.baggage = `atrib-session=${options.sessionToken},${meta.baggage}`
    } else {
      meta.baggage = `atrib-session=${options.sessionToken}`
    }
  }
}

/** Parse the `atrib=` entry from a tracestate string. */
export function parseTracestateAtrib(tracestate: string): string | null {
  for (const entry of tracestate.split(',')) {
    const trimmed = entry.trim()
    if (trimmed.startsWith('atrib=')) {
      return trimmed.slice(6)
    }
  }
  return null
}

/** Extract 32-char trace-id from a W3C traceparent header value. */
export function extractTraceId(traceparent: string): string | undefined {
  // Format: version-traceid-parentid-traceflags
  const parts = traceparent.split('-')
  if (parts.length >= 2) {
    const traceId = parts[1]
    if (traceId && /^[0-9a-f]{32}$/.test(traceId)) {
      return traceId
    }
  }
  return undefined
}

/** Parse `atrib-session=` value from W3C Baggage string. */
export function parseBaggageAtribSession(baggage: string): string | undefined {
  for (const entry of baggage.split(',')) {
    const trimmed = entry.trim()
    if (trimmed.startsWith('atrib-session=')) {
      return trimmed.slice(14)
    }
  }
  return undefined
}
