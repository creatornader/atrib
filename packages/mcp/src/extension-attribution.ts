// SPDX-License-Identifier: Apache-2.0

/**
 * `dev.atrib/attribution` MCP extension v0.1 — producer/client primitives.
 *
 * Implements the extension contract of D141 / spec §1.5.4.1, whose complete
 * specification is docs/extensions/dev.atrib-attribution/v0.1.md and whose
 * behavioral contract is pinned by spec/conformance/mcp-extension/. The
 * extension changes no signed byte of any record: it gates only discovery
 * and carriage.
 *
 * Everything here is opt-in and §5.8-shaped: the exported apply/extend
 * helpers never throw to the caller and never mutate the tool result on
 * failure; the pure resolution ladders treat malformation as fall-through,
 * never as an error. The legacy unprefixed convention (`_meta.atrib`,
 * `tracestate` `atrib=`, `X-Atrib-Chain`) remains fully supported and is the
 * documented fallback at every rung below the extension key.
 */

import { base64urlEncode } from './base64url.js'
import { canonicalRecord } from './canon.js'
import { extractTraceId, parseTracestateAtrib, writeOutboundContext } from './context.js'
import { hexEncode, sha256 } from './hash.js'
import { decodeToken, encodeToken } from './token.js'
import { EVENT_TYPE_SHORT_TO_URI } from './types.js'
import type { AtribRecord } from './types.js'

// ─── Constants (extension spec §3, §4, §6) ──────────────────────────────

/** SEP-2133 extension identifier. Frozen: breaking changes require a new id. */
export const ATTRIBUTION_EXTENSION_ID = 'dev.atrib/attribution'

/** Settings-object `version` published by this implementation. */
export const ATTRIBUTION_EXTENSION_VERSION = '0.1'

/**
 * Core-reserved `_meta` key under which per-request client capabilities
 * travel in the stateless MCP model (extension spec §4.2).
 */
export const MCP_CLIENT_CAPABILITIES_META_KEY = 'io.modelcontextprotocol/clientCapabilities'

/**
 * DNS labels reserved for official MCP extensions (SEP-2133). A vendor
 * prefix containing any of these labels is invalid for unofficial extensions.
 */
export const RESERVED_EXTENSION_PREFIX_LABELS: ReadonlySet<string> = new Set([
  'mcp',
  'modelcontextprotocol',
])

/** Receipt verbosities a client can request (extension spec §4.2 `accept`). */
export const ATTRIBUTION_ACCEPT_VALUES = ['token', 'record'] as const
export type AttributionAcceptValue = (typeof ATTRIBUTION_ACCEPT_VALUES)[number]

/** Closed queue-status enum for `receipt.log_submission` (extension spec §6.3). */
export const ATTRIBUTION_LOG_SUBMISSION_STATUSES = [
  'queued',
  'submitted',
  'disabled',
  'failed',
] as const
export type AttributionLogSubmissionStatus = (typeof ATTRIBUTION_LOG_SUBMISSION_STATUSES)[number]

/**
 * Every settings field recognized at v0.1 across BOTH sides (client `accept`
 * plus the server advisory fields). Unknown settings fields MUST be ignored
 * (extension spec §4.1/§4.2 forward compatibility).
 */
export const ATTRIBUTION_KNOWN_SETTINGS_FIELDS: ReadonlySet<string> = new Set([
  'version',
  'accept',
  'signs',
  'receipts',
  'disclosure',
  'creator_key',
  'logs',
  'directory',
])

const KNOWN_ACCEPT_VALUES: ReadonlySet<string> = new Set(ATTRIBUTION_ACCEPT_VALUES)
const LOG_SUBMISSION_STATUS_SET: ReadonlySet<string> = new Set(ATTRIBUTION_LOG_SUBMISSION_STATUSES)
const HEX32 = /^[0-9a-f]{32}$/

// ─── Settings schemas (extension spec §4) ───────────────────────────────

/** Server capability settings object (extension spec §4.1). Advisory beyond `version`. */
export interface AttributionServerSettings {
  /** REQUIRED. Settings version, `"0.1"` for this document. */
  version: string
  /** atrib event-type short names this server signs (e.g. `"tool_call"`). */
  signs?: string[]
  /** Receipt verbosities the server can produce. */
  receipts?: AttributionAcceptValue[]
  /** Advisory disclosure posture per atrib spec §8.3. */
  disclosure?: { args?: string; result?: string; tool_name?: string }
  /** base64url-encoded 32-byte Ed25519 public key the server expects to sign with. */
  creator_key?: string
  /** Transparency-log base URLs records are submitted to. */
  logs?: string[]
  /** Identity-claim directory base URL for the creator key. */
  directory?: string
}

/** Client capability settings object (extension spec §4.2). */
export interface AttributionClientSettings {
  /** REQUIRED. Settings version, `"0.1"`. */
  version: string
  /** Receipt verbosity negotiation. Defaults to `["token"]` when absent. */
  accept?: AttributionAcceptValue[]
}

/** Outcome of validating a settings object per extension spec §4. */
export interface AttributionSettingsValidation {
  /** Whether the peer validly declared the extension. */
  declared: boolean
  /** The declared settings `version` string, when declared. */
  negotiatedVersion?: string
  /** Effective `accept` after unknown-value filtering; defaults to `['token']`. */
  effectiveAccept: string[]
  /** Unknown settings fields, sorted (ignored per forward compatibility). */
  ignoredSettingsFields: string[]
  /** Unrecognized string `accept` values (ignored). */
  ignoredAcceptValues: string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function undeclaredValidation(): AttributionSettingsValidation {
  return {
    declared: false,
    effectiveAccept: ['token'],
    ignoredSettingsFields: [],
    ignoredAcceptValues: [],
  }
}

/**
 * Validate an extension identifier per the SEP-2133 grammar
 * (`{vendor-prefix}/{extension-name}`, reverse-DNS prefix, no reserved
 * labels). Extension spec §3.
 */
export function validateExtensionIdentifier(identifier: string): boolean {
  const parts = identifier.split('/')
  if (parts.length !== 2) return false
  const [prefix, name] = parts
  if (!prefix || !name) return false
  const labels = prefix.split('.')
  if (labels.length < 2) return false
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label)) return false
    if (RESERVED_EXTENSION_PREFIX_LABELS.has(label)) return false
  }
  return /^[a-z0-9-]+$/.test(name)
}

/**
 * Validate a settings object per extension spec §4. A settings object
 * missing `version` (or whose `version` is not a non-empty string) is
 * malformed: the peer is treated as NOT having declared the extension, and
 * this MUST NOT produce a protocol error. Unknown settings fields and
 * unknown `accept` values are ignored (forward compatibility); an `accept`
 * array containing no recognized value is equivalent to `["token"]`. An
 * unrecognized `version` under this identifier is still a valid declaration:
 * the identifier, not the version string, is the compatibility unit.
 */
export function validateAttributionSettings(settings: unknown): AttributionSettingsValidation {
  if (!isPlainObject(settings)) return undeclaredValidation()
  const version = settings.version
  if (typeof version !== 'string' || version.length === 0) return undeclaredValidation()

  const ignoredSettingsFields = Object.keys(settings)
    .filter((k) => !ATTRIBUTION_KNOWN_SETTINGS_FIELDS.has(k))
    .sort()

  const ignoredAcceptValues: string[] = []
  let effectiveAccept: string[] = ['token']
  if (Array.isArray(settings.accept)) {
    const recognized = settings.accept.filter((v): v is string => {
      if (typeof v === 'string' && KNOWN_ACCEPT_VALUES.has(v)) return true
      if (typeof v === 'string') ignoredAcceptValues.push(v)
      return false
    })
    if (recognized.length > 0) effectiveAccept = recognized
  }

  return {
    declared: true,
    negotiatedVersion: version,
    effectiveAccept,
    ignoredSettingsFields,
    ignoredAcceptValues,
  }
}

// ─── Negotiation gating (extension spec §6.1) ───────────────────────────

/**
 * Per-request client declaration detection: reads
 * `_meta["io.modelcontextprotocol/clientCapabilities"].extensions` and
 * validates the `dev.atrib/attribution` settings object.
 *
 * NOTE: this is the RAW detector — pathological inputs (e.g. a throwing
 * Proxy for `requestMeta`) propagate their exception so callers on the
 * result path can abort BEFORE mutating anything, preserving byte-identical
 * passthrough per the degradation corpus. Hosts that want the §5.8-safe
 * form should call {@link declaresExtension} instead.
 */
export function detectClientDeclaration(requestMeta: unknown): AttributionSettingsValidation {
  if (!isPlainObject(requestMeta)) return validateAttributionSettings(undefined)
  const caps = requestMeta[MCP_CLIENT_CAPABILITIES_META_KEY]
  if (!isPlainObject(caps)) return validateAttributionSettings(undefined)
  const extensions = caps.extensions
  if (!isPlainObject(extensions)) return validateAttributionSettings(undefined)
  return validateAttributionSettings(extensions[ATTRIBUTION_EXTENSION_ID])
}

/** Options for {@link declaresExtension}. */
export interface DeclaresExtensionOptions {
  /**
   * Legacy protocol versions (≤ 2025-11-25) carry client capabilities in the
   * `initialize` request instead of per-request `_meta`. Pass the session's
   * `initialize` `capabilities` object here (the object containing the
   * `extensions` map); a declaration there applies to every request on the
   * session (extension spec §4.2 / §6.1). Per-request declarations, when
   * validly present, take precedence.
   */
  initializeCapabilities?: unknown
}

/**
 * §6.1 negotiation gating check, §5.8-safe: whether the client declared
 * `dev.atrib/attribution` for this request, either per-request under the
 * `io.modelcontextprotocol/clientCapabilities` `_meta` key or (legacy
 * protocol versions) in the session's `initialize` capabilities.
 *
 * A missing, malformed, or non-object declaration — or any exception while
 * reading either carrier — is treated as **undeclared**; never an error.
 */
export function declaresExtension(
  requestMeta: unknown,
  options?: DeclaresExtensionOptions,
): AttributionSettingsValidation {
  try {
    const perRequest = detectClientDeclaration(requestMeta)
    if (perRequest.declared) return perRequest
    const init = options?.initializeCapabilities
    if (isPlainObject(init)) {
      const extensions = init.extensions
      if (isPlainObject(extensions)) {
        const legacy = validateAttributionSettings(extensions[ATTRIBUTION_EXTENSION_ID])
        if (legacy.declared) return legacy
      }
    }
    return perRequest
  } catch (err) {
    console.warn('atrib: capability declaration read failed, treating as undeclared', err)
    return undeclaredValidation()
  }
}

// ─── Request carriage (extension spec §5) ───────────────────────────────

/** The v0.1 request block under `_meta["dev.atrib/attribution"]`. */
export interface AttributionRequestBlock {
  /** §1.5.2 propagation token, ≤87 chars. */
  token?: string
  /** Raw 32-lowercase-hex session anchor (§1.5.1), carried explicitly. */
  context_id?: string
}

/** Input for {@link buildAttributionMetaBlock}. */
export interface BuildAttributionMetaBlockInput {
  /** Pre-encoded §1.5.2 propagation token. Mutually exclusive with `record`. */
  token?: string
  /** Signed record to derive the token from (via `encodeToken`). */
  record?: AtribRecord
  /** Explicit 32-lowercase-hex context_id to carry. */
  contextId?: string
}

/**
 * Build the prefixed `_meta` fragment a client attaches to a request
 * (extension spec §5): `{ "dev.atrib/attribution": { token?, context_id? } }`.
 *
 * Malformed inputs are dropped with an `atrib:` warning, never thrown:
 * a token that does not decode to two 32-byte parts is omitted; a
 * `contextId` that is not exactly 32 lowercase hex characters is omitted.
 * Returns `undefined` when no valid field remains (callers then attach
 * nothing — the legacy carriers still travel).
 *
 * Clients SHOULD write the legacy carriers alongside this block so
 * non-adopting servers keep chaining (extension spec §5.1); this helper
 * builds only the prefixed block and never touches the legacy keys.
 */
export function buildAttributionMetaBlock(
  input: BuildAttributionMetaBlockInput,
): { [ATTRIBUTION_EXTENSION_ID]: AttributionRequestBlock } | undefined {
  const block: AttributionRequestBlock = {}
  try {
    let token = input.token
    if (token === undefined && input.record) {
      token = encodeToken(input.record)
    }
    if (token !== undefined) {
      if (typeof token === 'string' && decodeToken(token) !== null) {
        block.token = token
      } else {
        console.warn('atrib: malformed propagation token, omitting from extension block')
      }
    }
    if (input.contextId !== undefined) {
      if (typeof input.contextId === 'string' && HEX32.test(input.contextId)) {
        block.context_id = input.contextId
      } else {
        console.warn('atrib: malformed context_id, omitting from extension block')
      }
    }
  } catch (err) {
    console.warn('atrib: failed to build extension request block', err)
    return undefined
  }
  if (block.token === undefined && block.context_id === undefined) return undefined
  return { [ATTRIBUTION_EXTENSION_ID]: block }
}

// ─── Ladder 1: inbound propagation token (extension spec §5.2) ──────────

export type AttributionTokenSource =
  | 'extension'
  | 'meta-atrib'
  | 'tracestate'
  | 'x-atrib-chain'
  | null

/** Outcome of Ladder 1 resolution. */
export interface AttributionTokenResolution {
  /** Which carrier resolved, or null when all carriers are absent/malformed. */
  source: AttributionTokenSource
  /** Lowercase hex record_hash (no `sha256:` prefix) from the winning token. */
  recordHashHex?: string
  /** base64url creator_key from the winning token. */
  creatorKey?: string
  /**
   * True when the extension key and a legacy carrier decode to DIFFERENT
   * tokens (extension wins; the caller SHOULD have seen an `atrib:` warning).
   */
  conflictWarning: boolean
}

function decodeCarrier(value: unknown): { hashHex: string; key: string } | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const decoded = decodeToken(value)
  if (!decoded) return null
  return { hashHex: hexEncode(decoded.recordHash), key: base64urlEncode(decoded.creatorKey) }
}

/**
 * Canonical Ladder 1 resolution (extension spec §5.2 / spec §1.5.4.1):
 *
 *   `_meta["dev.atrib/attribution"].token` > `_meta.atrib`
 *     > `tracestate` `atrib=` entry > `_meta["X-Atrib-Chain"]`
 *
 * Lenient parse: a malformed extension token falls through to the next
 * carrier; malformation is never an error. On conflict between the extension
 * key and a legacy carrier, the extension key wins and an `atrib:` warning
 * is logged. When nothing resolves, `source` is null and chain-root
 * resolution continues down the §1.2.3.1 / D067 ladder — this function
 * refines only the inbound-token rung and never replaces `resolveChainRoot`.
 */
export function resolveInboundToken(requestMeta: unknown): AttributionTokenResolution {
  const m = isPlainObject(requestMeta) ? requestMeta : {}

  // Legacy rungs, in §1.5.4 order, via the production parsers.
  const legacy: {
    source: Exclude<AttributionTokenSource, 'extension' | null>
    hit: { hashHex: string; key: string }
  }[] = []
  const metaAtrib = decodeCarrier(m.atrib)
  if (metaAtrib) legacy.push({ source: 'meta-atrib', hit: metaAtrib })
  if (typeof m.tracestate === 'string') {
    const entry = parseTracestateAtrib(m.tracestate)
    const decoded = entry ? decodeCarrier(entry) : null
    if (decoded) legacy.push({ source: 'tracestate', hit: decoded })
  }
  const xChain = decodeCarrier(m['X-Atrib-Chain'] ?? m['x-atrib-chain'])
  if (xChain) legacy.push({ source: 'x-atrib-chain', hit: xChain })

  // Extension rung on top: lenient parse, falls through when malformed.
  const block = m[ATTRIBUTION_EXTENSION_ID]
  if (isPlainObject(block)) {
    const extension = decodeCarrier(block.token)
    if (extension) {
      const conflictWarning = legacy.some((l) => l.hit.hashHex !== extension.hashHex)
      if (conflictWarning) {
        console.warn(
          'atrib: extension token conflicts with a legacy carrier, extension key wins',
        )
      }
      return {
        source: 'extension',
        recordHashHex: extension.hashHex,
        creatorKey: extension.key,
        conflictWarning,
      }
    }
  }

  const first = legacy[0]
  if (first) {
    return {
      source: first.source,
      recordHashHex: first.hit.hashHex,
      creatorKey: first.hit.key,
      conflictWarning: false,
    }
  }
  return { source: null, conflictWarning: false }
}

// ─── Ladder 2: context identity (extension spec §5.3) ───────────────────

export type AttributionContextSource =
  | 'argument'
  | 'extension'
  | 'traceparent'
  | 'env-registry-fallthrough'

/** Outcome of Ladder 2 resolution. */
export interface AttributionContextResolution {
  /** Resolved 32-hex context_id, or undefined at the transport layer. */
  contextId?: string
  /**
   * Which rung resolved. `'env-registry-fallthrough'` means no per-request
   * carrier resolved: producer-local D078/D083 env-and-file discovery applies
   * next (its internal ordering stays defined by those decisions).
   */
  source: AttributionContextSource
  /** True when a lower carrier disagreed with the winner (warning logged). */
  mismatchWarning: boolean
}

/**
 * Canonical Ladder 2 resolution (extension spec §5.3 / spec §1.5.4.1):
 *
 *   explicit context_id tool argument
 *     > `_meta["dev.atrib/attribution"].context_id`
 *     > `_meta.traceparent` trace-id
 *     > D078/D083 env-file registry (producer-side, not resolved here)
 *     > undefined
 *
 * An explicit tool argument always wins (application intent beats transport
 * metadata); an extension-block `context_id` that is not exactly 32
 * lowercase hex is ignored and falls through — never an error.
 */
export function resolveContextIdentity(
  explicitArgument: unknown,
  requestMeta: unknown,
): AttributionContextResolution {
  const m = isPlainObject(requestMeta) ? requestMeta : {}
  const block = m[ATTRIBUTION_EXTENSION_ID]
  const extensionValue =
    isPlainObject(block) && typeof block.context_id === 'string' && HEX32.test(block.context_id)
      ? block.context_id
      : undefined
  const traceValue = typeof m.traceparent === 'string' ? extractTraceId(m.traceparent) : undefined

  if (typeof explicitArgument === 'string' && HEX32.test(explicitArgument)) {
    const lowerCarrier = extensionValue ?? traceValue
    const mismatchWarning = lowerCarrier !== undefined && lowerCarrier !== explicitArgument
    if (mismatchWarning) {
      console.warn('atrib: explicit context_id argument overrides transport carrier')
    }
    return { contextId: explicitArgument, source: 'argument', mismatchWarning }
  }
  if (extensionValue !== undefined) {
    const mismatchWarning = traceValue !== undefined && traceValue !== extensionValue
    if (mismatchWarning) {
      console.warn('atrib: extension context_id overrides traceparent trace-id')
    }
    return { contextId: extensionValue, source: 'extension', mismatchWarning }
  }
  if (traceValue !== undefined) {
    return { contextId: traceValue, source: 'traceparent', mismatchWarning: false }
  }
  // No per-request carrier resolved. Producer-side D078/D083 env-file
  // resolution applies next; at the transport layer the result is undefined.
  return { source: 'env-registry-fallthrough', mismatchWarning: false }
}

// ─── Result carriage: attestation receipts (extension spec §6) ──────────

/** The `receipt` object inside the result block (extension spec §6.2). */
export interface AttributionReceipt {
  /** `"sha256:" + lowercase hex of sha256(JCS(signed record))`. */
  record_hash: string
  /** The record's signer (base64url 32-byte Ed25519 public key). */
  creator_key: string
  /** The record's context_id. */
  context_id: string
  /** atrib event-type short name (e.g. `"tool_call"`) or the full URI. */
  event_type: string
  /** The record's chain_root. */
  chain_root: string
  /** Queue status at response time — never an awaited proof (§5.3.5). */
  log_submission: AttributionLogSubmissionStatus
}

/** The v0.1 result block under `result._meta["dev.atrib/attribution"]`. */
export interface AttributionResultBlock {
  /** Propagation token of the record named by the receipt. */
  token: string
  receipt: AttributionReceipt
  /** OPTIONAL full signed record (only when the client's accept includes "record"). */
  record?: AtribRecord
}

/** Options for {@link buildAttributionReceipt}. */
export interface BuildAttributionReceiptOptions {
  /** Attach the full signed record body (extension spec §6.4). Default false. */
  includeRecord?: boolean
  /**
   * Queue status at response time (extension spec §6.3). Defaults to
   * `'queued'`. Use `'disabled'` for D100 sign-without-submission postures.
   * This is reporting only: callers MUST NOT await log submission before
   * returning the tool result.
   */
  logSubmission?: AttributionLogSubmissionStatus
}

/**
 * Build the gated result block for a record the server has ALREADY signed
 * locally (extension spec §6.2). Synchronous by construction: it reports the
 * submission queue's status, never awaits submission or inclusion proofs
 * (§5.3.5 / critical invariant 4). Attaching the full record is safe by
 * construction — records carry commitments, never payloads (§8.3).
 *
 * Gating is the CALLER's obligation (or use {@link applyAttributionReceipt}):
 * this block may be written to `result._meta` only when the client declared
 * the extension on that request.
 */
export function buildAttributionReceipt(
  record: AtribRecord,
  options: BuildAttributionReceiptOptions = {},
): AttributionResultBlock {
  const shortName = Object.entries(EVENT_TYPE_SHORT_TO_URI).find(
    ([, uri]) => uri === record.event_type,
  )?.[0]
  const block: AttributionResultBlock = {
    token: encodeToken(record),
    receipt: {
      record_hash: `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
      creator_key: record.creator_key,
      context_id: record.context_id,
      event_type: shortName ?? record.event_type,
      chain_root: record.chain_root,
      log_submission: options.logSubmission ?? 'queued',
    },
  }
  if (options.includeRecord === true) block.record = record
  return block
}

/** Options for {@link applyAttributionReceipt}. */
export interface ApplyAttributionReceiptOptions {
  /** Queue status to report (see {@link BuildAttributionReceiptOptions}). */
  logSubmission?: AttributionLogSubmissionStatus
  /** Legacy `initialize`-time declaration carrier (see {@link DeclaresExtensionOptions}). */
  initializeCapabilities?: unknown
}

/**
 * Gated receipt write for an already-signed record: emits the
 * `dev.atrib/attribution` block into `result._meta` ONLY when the client
 * declared the extension on that request (extension spec §6.1). §5.8-safe:
 * never throws, and on any failure the result object is left exactly as it
 * was. Returns true iff the block was written.
 *
 * This helper writes only the prefixed block. The legacy unprefixed result
 * keys are written unconditionally elsewhere (`writeOutboundContext`),
 * unchanged, regardless of negotiation state.
 */
export function applyAttributionReceipt(
  result: Record<string, unknown>,
  requestMeta: unknown,
  record: AtribRecord,
  options: ApplyAttributionReceiptOptions = {},
): boolean {
  try {
    const declaration = declaresExtension(requestMeta, {
      initializeCapabilities: options.initializeCapabilities,
    })
    if (!declaration.declared) return false
    const block = buildAttributionReceipt(record, {
      includeRecord: declaration.effectiveAccept.includes('record'),
      ...(options.logSubmission !== undefined ? { logSubmission: options.logSubmission } : {}),
    })
    if (!isPlainObject(result._meta)) {
      result._meta = {}
    }
    ;(result._meta as Record<string, unknown>)[ATTRIBUTION_EXTENSION_ID] = block
    return true
  } catch (err) {
    console.warn('atrib: extension receipt emission failed, omitting block', err)
    return false
  }
}

/** Options for {@link extendResultWithAttribution}. */
export interface ExtendResultWithAttributionOptions {
  /** Queue status to report (see {@link BuildAttributionReceiptOptions}). */
  logSubmission?: AttributionLogSubmissionStatus
  /** Legacy `initialize`-time declaration carrier (see {@link DeclaresExtensionOptions}). */
  initializeCapabilities?: unknown
}

/**
 * §5.8-conformant reference composition of the full result path: sign,
 * detect the client declaration, write the legacy outbound keys, then the
 * gated extension block. Any failure — signing, capability read, carriage —
 * leaves the tool result byte-identical to passthrough and never throws to
 * the caller (degradation corpus contract: on failure NOT EVEN the legacy
 * keys are added by the failed attempt).
 *
 * Producers that sign elsewhere (e.g. the `@atrib/mcp` middleware, which
 * runs `writeOutboundContext` in its commit path) should use
 * {@link applyAttributionReceipt} instead.
 */
export function extendResultWithAttribution(
  result: Record<string, unknown>,
  requestMeta: unknown,
  sign: () => AtribRecord,
  options: ExtendResultWithAttributionOptions = {},
): void {
  try {
    const record = sign()
    // Raw detection on purpose: a pathological requestMeta (throwing Proxy)
    // must abort BEFORE writeOutboundContext mutates the result.
    let declaration = detectClientDeclaration(requestMeta)
    if (!declaration.declared && options.initializeCapabilities !== undefined) {
      const init = options.initializeCapabilities
      if (isPlainObject(init) && isPlainObject(init.extensions)) {
        const legacy = validateAttributionSettings(
          (init.extensions as Record<string, unknown>)[ATTRIBUTION_EXTENSION_ID],
        )
        if (legacy.declared) declaration = legacy
      }
    }
    writeOutboundContext(result, record)
    if (declaration.declared) {
      const meta = result._meta as Record<string, unknown>
      meta[ATTRIBUTION_EXTENSION_ID] = buildAttributionReceipt(record, {
        includeRecord: declaration.effectiveAccept.includes('record'),
        ...(options.logSubmission !== undefined ? { logSubmission: options.logSubmission } : {}),
      })
    }
  } catch {
    // §5.8: extension failures never affect the primary tool result.
  }
}

// ─── Receipt verification (extension spec §6.2, consumer side) ──────────

/** Outcome of {@link verifyAttributionReceipt}. */
export interface AttributionReceiptVerification {
  /** True iff the block is structurally well-formed and internally consistent. */
  valid: boolean
  /**
   * Fields that disagreed (`'token'`, `'record_hash'`, `'creator_key'`,
   * `'context_id'`, `'chain_root'`, `'log_submission'`), or `['malformed']`
   * when the block is not structurally a v0.1 result block.
   */
  mismatched: string[]
}

function isStructurallyReceiptBlock(block: unknown): block is AttributionResultBlock {
  if (!isPlainObject(block)) return false
  if (typeof block.token !== 'string') return false
  const receipt = block.receipt
  if (!isPlainObject(receipt)) return false
  for (const field of ['record_hash', 'creator_key', 'context_id', 'event_type', 'chain_root', 'log_submission']) {
    if (typeof receipt[field] !== 'string') return false
  }
  if (block.record !== undefined && !isPlainObject(block.record)) return false
  return true
}

/**
 * Consumer-side receipt integrity check (extension spec §6.2): the token,
 * `record_hash`, and `creator_key` must agree with each other and — when the
 * full record body is attached — recompute from the record's canonical
 * bytes. A consumer that detects an internal inconsistency MUST treat the
 * receipt as invalid and discard it; receipt invalidity never invalidates
 * the tool result itself.
 *
 * This checks internal consistency only. A receipt is a claim of local
 * signing, not a proof: callers wanting Tier-3 assurance additionally verify
 * the attached record's Ed25519 signature (`verifyRecord`) and, where
 * required, log inclusion via an independently fetched proof bundle.
 */
export function verifyAttributionReceipt(block: unknown): AttributionReceiptVerification {
  if (!isStructurallyReceiptBlock(block)) {
    return { valid: false, mismatched: ['malformed'] }
  }
  const mismatched: string[] = []
  const decoded = decodeToken(block.token)
  if (!decoded) return { valid: false, mismatched: ['token'] }
  const tokenHashHex = hexEncode(decoded.recordHash)
  const tokenKey = base64urlEncode(decoded.creatorKey)

  if (block.receipt.record_hash !== `sha256:${tokenHashHex}`) mismatched.push('record_hash')
  if (block.receipt.creator_key !== tokenKey) mismatched.push('creator_key')
  if (!LOG_SUBMISSION_STATUS_SET.has(block.receipt.log_submission)) {
    mismatched.push('log_submission')
  }

  if (block.record) {
    const recordHashHex = hexEncode(sha256(canonicalRecord(block.record)))
    if (block.token !== encodeToken(block.record) && !mismatched.includes('token')) {
      mismatched.push('token')
    }
    if (
      block.receipt.record_hash !== `sha256:${recordHashHex}` &&
      !mismatched.includes('record_hash')
    ) {
      mismatched.push('record_hash')
    }
    if (
      block.receipt.creator_key !== block.record.creator_key &&
      !mismatched.includes('creator_key')
    ) {
      mismatched.push('creator_key')
    }
    if (block.receipt.context_id !== block.record.context_id) mismatched.push('context_id')
    if (block.receipt.chain_root !== block.record.chain_root) mismatched.push('chain_root')
  }

  return { valid: mismatched.length === 0, mismatched }
}
