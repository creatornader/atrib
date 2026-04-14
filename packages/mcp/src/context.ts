// SPDX-License-Identifier: Apache-2.0

/**
 * Inbound/outbound attribution context handling (§5.3.2, §5.3.4).
 */

import { decodeToken, encodeToken } from './token.js'
import type { AtribRecord, DecodedToken } from './types.js'

/** Extracted inbound context from an MCP request. */
export interface InboundContext {
  /** The record_hash from the upstream token — becomes chain_root of the next record. */
  recordHash: Uint8Array
  /** The creator_key from the upstream token — identifies the sender. */
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

  // Write/prepend atrib to tracestate. The W3C convention is "most recent
  // vendor first" — see https://www.w3.org/TR/trace-context/#tracestate-header.
  // Dedupe any existing atrib= entry first per "one entry per key is allowed".
  const existingTracestate = typeof meta.tracestate === 'string' ? meta.tracestate : ''
  meta.tracestate = mergeTracestate(`atrib=${token}`, existingTracestate)

  // Write X-Atrib-Chain fallback (§1.5.3)
  meta['X-Atrib-Chain'] = token

  // Forward traceparent if available (§1.5.4)
  if (options?.traceparent) {
    meta.traceparent = options.traceparent
  }

  // Write session_token to baggage (§1.5.5 MUST). Prepend, dedupe.
  if (options?.sessionToken) {
    const existingBaggage = typeof meta.baggage === 'string' ? meta.baggage : ''
    meta.baggage = mergeBaggageAtribSession(options.sessionToken, existingBaggage)
  }
}

/**
 * Merge a new atrib tracestate entry into an existing tracestate string,
 * placing atrib leftmost (most-recent), removing any prior atrib entry, and
 * enforcing the W3C 32-list-member maximum.
 *
 * If adding atrib would exceed the 32-entry limit, the rightmost entries are
 * evicted first per W3C truncation guidance: "entries SHOULD be removed
 * starting from the end of `tracestate`."
 */
export function mergeTracestate(atribEntry: string, existing: string): string {
  const cleanedExisting = existing
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !/^atrib\s*=/.test(e))

  // Reserve one slot for atrib, evict from the end if needed
  const MAX_LIST_MEMBERS = 32
  while (cleanedExisting.length > MAX_LIST_MEMBERS - 1) {
    cleanedExisting.pop()
  }

  return cleanedExisting.length > 0 ? `${atribEntry},${cleanedExisting.join(',')}` : atribEntry
}

/**
 * Merge a new atrib-session baggage entry into an existing baggage string,
 * deduping any prior atrib-session entry and enforcing the W3C 64-list-member
 * and 8192-byte maximums.
 */
export function mergeBaggageAtribSession(sessionToken: string, existing: string): string {
  const newEntry = `atrib-session=${sessionToken}`
  const cleanedExisting = existing
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && !/^atrib-session\s*=/.test(e))

  // Reserve one slot for atrib-session, evict from the end if needed
  const MAX_LIST_MEMBERS = 64
  while (cleanedExisting.length > MAX_LIST_MEMBERS - 1) {
    cleanedExisting.pop()
  }

  let merged = cleanedExisting.length > 0 ? `${newEntry},${cleanedExisting.join(',')}` : newEntry

  // Enforce 8192-byte total cap. Drop entries from the right until under cap.
  // atrib-session itself is < 60 bytes so this only fires when callers
  // bring near-cap baggage.
  const MAX_BYTES = 8192
  if (encodedByteLength(merged) > MAX_BYTES) {
    while (cleanedExisting.length > 0 && encodedByteLength(merged) > MAX_BYTES) {
      cleanedExisting.pop()
      merged = cleanedExisting.length > 0 ? `${newEntry},${cleanedExisting.join(',')}` : newEntry
    }
  }

  return merged
}

/** UTF-8 byte length of a string (W3C baggage uses bytes, not chars). */
function encodedByteLength(s: string): number {
  // TextEncoder is available in all our supported runtimes (Node 18+, browsers).
  return new TextEncoder().encode(s).length
}

/**
 * Parse the `atrib=` entry from a W3C tracestate string.
 *
 * Spec: https://www.w3.org/TR/trace-context/ — list-member grammar is
 * `key=value` separated by commas with optional whitespace (OWS) on either
 * side of the comma. Per the spec, callers SHOULD use single space or no
 * whitespace, but receivers must accept either.
 *
 * Note: tracestate values per the spec are 0-256 printable ASCII, no comma,
 * no equals sign — so the first `=` after `atrib` cleanly delimits the value.
 */
export function parseTracestateAtrib(tracestate: string): string | null {
  for (const entry of tracestate.split(',')) {
    const trimmed = entry.trim()
    // Be lenient about OWS around `=`: `atrib=value` and `atrib = value` both valid
    const match = trimmed.match(/^atrib\s*=\s*(.*)$/)
    if (match && match[1] !== undefined) {
      return match[1].trim()
    }
  }
  return null
}

/**
 * Extract 32-char trace-id from a W3C traceparent header value.
 *
 * Spec: https://www.w3.org/TR/trace-context/#traceparent-header — format is
 * `version-trace_id-parent_id-trace_flags` where trace-id is 32 lowercase
 * hex characters and MUST NOT be all zeros. Receivers MUST ignore the
 * traceparent entirely if either trace-id or parent-id is invalid.
 */
export function extractTraceId(traceparent: string): string | undefined {
  // Format: version-traceid-parentid-traceflags
  const parts = traceparent.split('-')
  if (parts.length < 4) return undefined

  const [version, traceId, parentId, traceFlags] = parts
  if (!version || !traceId || !parentId || !traceFlags) return undefined

  // Per W3C: version is 2 lowercase hex
  if (!/^[0-9a-f]{2}$/.test(version)) return undefined
  // Per W3C: trace-id is exactly 32 lowercase hex, NOT all zeros
  if (!/^[0-9a-f]{32}$/.test(traceId)) return undefined
  if (traceId === '0'.repeat(32)) return undefined
  // Per W3C: parent-id is exactly 16 lowercase hex, NOT all zeros
  if (!/^[0-9a-f]{16}$/.test(parentId)) return undefined
  if (parentId === '0'.repeat(16)) return undefined
  // Per W3C: trace-flags is 2 lowercase hex
  if (!/^[0-9a-f]{2}$/.test(traceFlags)) return undefined

  return traceId
}

/**
 * Parse the `atrib-session=` value from a W3C Baggage string.
 *
 * Spec: https://www.w3.org/TR/baggage/ — list-member grammar is
 * `key OWS = OWS value *( OWS ; OWS property )`. The value may be followed
 * by zero or more `;property` segments which are NOT part of the value.
 * Receivers MUST strip the property suffix when extracting the value.
 *
 * Examples:
 *   `atrib-session=tok123`              → `tok123`
 *   `atrib-session = tok123`            → `tok123` (OWS around `=`)
 *   `atrib-session=tok123;ttl=300`      → `tok123` (property stripped)
 *   `atrib-session = tok123 ; ttl=300`  → `tok123` (OWS + property stripped)
 */
export function parseBaggageAtribSession(baggage: string): string | undefined {
  for (const entry of baggage.split(',')) {
    const trimmed = entry.trim()
    // Be lenient about OWS around `=` per the W3C grammar
    const match = trimmed.match(/^atrib-session\s*=\s*([^;]*)/)
    if (match && match[1] !== undefined) {
      return match[1].trim()
    }
  }
  return undefined
}
