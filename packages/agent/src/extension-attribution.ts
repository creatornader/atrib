// SPDX-License-Identifier: Apache-2.0

/**
 * `dev.atrib/attribution` MCP extension v0.1 — client-side helpers (D141 /
 * spec §1.5.4.1; extension spec docs/extensions/dev.atrib-attribution/v0.1.md).
 *
 * Two surfaces, both opt-in and §5.8-shaped:
 *
 *   - {@link declareAttributionExtension}: return a NEW outbound `_meta`
 *     that declares the extension per-request under the core-reserved
 *     `io.modelcontextprotocol/clientCapabilities` key (and optionally
 *     carries the prefixed request block: propagation token + explicit
 *     context_id). Never mutates the caller's object; idempotent.
 *   - {@link parseAttributionReceipt}: read the gated result block from
 *     `result._meta`, validate its structure and internal consistency per
 *     extension spec §6.2, and return a typed receipt — or `undefined` with
 *     an `atrib:`-prefixed warning when the block is absent, malformed, or
 *     inconsistent. Receipt invalidity never invalidates the tool result.
 *
 * Clients using these helpers keep writing the legacy carriers
 * (`buildOutboundMeta` already emits `atrib`, `tracestate`, `X-Atrib-Chain`)
 * so non-adopting servers keep chaining: the extension is upside, not a
 * dependency.
 */

import {
  base64urlEncode,
  canonicalRecord,
  decodeToken,
  encodeToken,
  hexEncode,
  sha256,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

// Protocol-frozen strings, mirroring @atrib/mcp's extension-attribution
// module (the identifier freezes on publication per extension spec §3;
// breaking changes require a new identifier).
export const ATTRIBUTION_EXTENSION_ID = 'dev.atrib/attribution'
export const ATTRIBUTION_EXTENSION_VERSION = '0.1'
export const MCP_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities'

/** Receipt verbosities a client can request (extension spec §4.2 `accept`). */
export const ATTRIBUTION_ACCEPT_VALUES = ['token', 'record'] as const
export type AttributionAcceptValue = (typeof ATTRIBUTION_ACCEPT_VALUES)[number]

const LOG_SUBMISSION_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'submitted',
  'disabled',
  'failed',
])
const HEX32 = /^[0-9a-f]{32}$/

/** The v0.1 receipt object (extension spec §6.2). */
export interface AttributionReceipt {
  record_hash: string
  creator_key: string
  context_id: string
  event_type: string
  chain_root: string
  /** Queue status at response time — a claim of local signing, never an awaited proof. */
  log_submission: 'queued' | 'submitted' | 'disabled' | 'failed'
}

/** The parsed, consistency-checked result block. */
export interface AttributionResultBlock {
  /** Propagation token of the record named by the receipt. */
  token: string
  receipt: AttributionReceipt
  /** Full signed record, present only when the server honored `accept: ["record"]`. */
  record?: AtribRecord
}

/** Options for {@link declareAttributionExtension}. */
export interface DeclareAttributionExtensionOptions {
  /**
   * Receipt verbosity negotiation (extension spec §4.2). Defaults to
   * `['token']`. Add `'record'` to request the full signed record body in
   * receipts for immediate signature re-verification.
   */
  accept?: readonly AttributionAcceptValue[]
  /**
   * Optional §1.5.2 propagation token to carry in the prefixed request
   * block (extension spec §5). Malformed tokens are dropped with a warning.
   */
  token?: string
  /**
   * Optional explicit 32-lowercase-hex context_id to carry in the prefixed
   * request block. Malformed values are dropped with a warning.
   */
  contextId?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Return a NEW `_meta` object that declares `dev.atrib/attribution` on this
 * request (per-request client capabilities, stateless MCP model) and — when
 * `token` / `contextId` are supplied — carries the prefixed request block.
 *
 * Non-destructive: existing `_meta` keys, existing `clientCapabilities`
 * fields, and other declared extensions are preserved; only this extension's
 * settings entry (and the prefixed block, when requested) are (re)written,
 * which also makes the helper idempotent. The caller's object is never
 * mutated. §5.8: any internal failure returns the caller's `_meta` shape
 * unchanged (a shallow copy) with an `atrib:` warning — never a throw.
 */
export function declareAttributionExtension(
  meta: Record<string, unknown> = {},
  options: DeclareAttributionExtensionOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta }
  try {
    // Settings object per extension spec §4.2. Unknown accept values would
    // be ignored server-side; we only ever emit recognized ones.
    const accept = (options.accept ?? ['token']).filter((v) =>
      (ATTRIBUTION_ACCEPT_VALUES as readonly string[]).includes(v),
    )
    const settings: Record<string, unknown> = {
      version: ATTRIBUTION_EXTENSION_VERSION,
      accept: accept.length > 0 ? [...new Set(accept)] : ['token'],
    }

    const existingCaps = out[MCP_CLIENT_CAPABILITIES_META_KEY]
    const caps: Record<string, unknown> = isPlainObject(existingCaps) ? { ...existingCaps } : {}
    const existingExtensions = caps.extensions
    const extensions: Record<string, unknown> = isPlainObject(existingExtensions)
      ? { ...existingExtensions }
      : {}
    extensions[ATTRIBUTION_EXTENSION_ID] = settings
    caps.extensions = extensions
    out[MCP_CLIENT_CAPABILITIES_META_KEY] = caps

    // Prefixed request block (extension spec §5): exactly two fields in
    // v0.1, both optional; malformed values are dropped, never thrown.
    const block: Record<string, unknown> = {}
    if (options.token !== undefined) {
      if (typeof options.token === 'string' && decodeToken(options.token) !== null) {
        block.token = options.token
      } else {
        console.warn('atrib: malformed propagation token, omitting from extension block')
      }
    }
    if (options.contextId !== undefined) {
      if (typeof options.contextId === 'string' && HEX32.test(options.contextId)) {
        block.context_id = options.contextId
      } else {
        console.warn('atrib: malformed context_id, omitting from extension block')
      }
    }
    if (Object.keys(block).length > 0) {
      const existingBlock = out[ATTRIBUTION_EXTENSION_ID]
      out[ATTRIBUTION_EXTENSION_ID] = isPlainObject(existingBlock)
        ? { ...existingBlock, ...block }
        : block
    }
    return out
  } catch (err) {
    console.warn('atrib: declareAttributionExtension failed, passing meta through', err)
    return { ...meta }
  }
}

function isStructurallyReceiptBlock(block: unknown): block is AttributionResultBlock {
  if (!isPlainObject(block)) return false
  if (typeof block.token !== 'string') return false
  const receipt = block.receipt
  if (!isPlainObject(receipt)) return false
  for (const field of [
    'record_hash',
    'creator_key',
    'context_id',
    'event_type',
    'chain_root',
    'log_submission',
  ]) {
    if (typeof receipt[field] !== 'string') return false
  }
  if (block.record !== undefined && !isPlainObject(block.record)) return false
  return true
}

/**
 * Internal-consistency check per extension spec §6.2: the token,
 * `record_hash`, and `creator_key` must agree with each other and — when
 * the full record body is attached — recompute from the record's canonical
 * bytes. Mirrors `verifyAttributionReceipt` in @atrib/mcp.
 */
function receiptIsConsistent(block: AttributionResultBlock): boolean {
  const decoded = decodeToken(block.token)
  if (!decoded) return false
  if (block.receipt.record_hash !== `sha256:${hexEncode(decoded.recordHash)}`) return false
  if (block.receipt.creator_key !== base64urlEncode(decoded.creatorKey)) return false
  if (!LOG_SUBMISSION_STATUSES.has(block.receipt.log_submission)) return false
  if (block.record) {
    if (block.token !== encodeToken(block.record)) return false
    const recordHashHex = hexEncode(sha256(canonicalRecord(block.record)))
    if (block.receipt.record_hash !== `sha256:${recordHashHex}`) return false
    if (block.receipt.creator_key !== block.record.creator_key) return false
    if (block.receipt.context_id !== block.record.context_id) return false
    if (block.receipt.chain_root !== block.record.chain_root) return false
  }
  return true
}

/**
 * Parse the gated `dev.atrib/attribution` block from a tool result's
 * `_meta` (extension spec §6). Returns the typed, consistency-checked block,
 * or `undefined` when:
 *
 *   - the block is absent (server pre-extension, or client undeclared) —
 *     silent, this is the normal legacy path;
 *   - the block is structurally malformed or internally inconsistent —
 *     `atrib:`-logged and DISCARDED per extension spec §6.2 ("a consumer
 *     that detects an internal inconsistency MUST treat the receipt as
 *     invalid and discard it").
 *
 * §5.8: never throws; receipt invalidity never invalidates the tool result.
 * A valid return is a *claim of local signing*, not a proof: callers wanting
 * Tier-3 assurance verify the attached record's signature (`verifyRecord`
 * from @atrib/mcp) and log inclusion independently.
 */
export function parseAttributionReceipt(
  resultMeta: unknown,
): AttributionResultBlock | undefined {
  try {
    if (!isPlainObject(resultMeta)) return undefined
    if (!(ATTRIBUTION_EXTENSION_ID in resultMeta)) return undefined
    const block = resultMeta[ATTRIBUTION_EXTENSION_ID]
    if (!isStructurallyReceiptBlock(block)) {
      console.warn('atrib: malformed dev.atrib/attribution receipt block, discarding')
      return undefined
    }
    if (!receiptIsConsistent(block)) {
      console.warn('atrib: inconsistent dev.atrib/attribution receipt, discarding')
      return undefined
    }
    return block
  } catch (err) {
    console.warn('atrib: failed to parse dev.atrib/attribution receipt, discarding', err)
    return undefined
  }
}
