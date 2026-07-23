// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/mcp middleware. the atrib() wrapper function (§5.3).
 *
 * Wraps an MCP server to automatically emit attribution records and
 * propagate context. Zero ongoing surface area: one init call, then
 * everything is automatic.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { base64urlDecode, base64urlEncode } from './base64url.js'
import { computeContentId } from './content-id.js'
import {
  SHA256_REF_PATTERN,
  extractRecordReferenceCandidates,
  parentRecordHashFromEnv,
} from './refs.js'
import { resolveChainRoot } from './chain-root.js'
import { readInboundContext, writeOutboundContext, parseBaggageAtribSession } from './context.js'
import { applyAttributionReceipt } from './extension-attribution.js'
import { signRecord, getPublicKey } from './signing.js'
import { hexEncode, sha256 } from './hash.js'
import { canonicalRecord } from './canon.js'
import canonicalize from 'canonicalize'
import { encodeToken } from './token.js'
import { createSubmissionQueue } from './submission.js'
import { createAnchorFanout } from './anchors.js'
import type { AnchorSetConfig } from './anchors.js'
import { zeroize } from './zeroize.js'
import { EVENT_TYPE_TOOL_CALL_URI, EVENT_TYPE_TRANSACTION_URI } from './types.js'
import { buildMcpOAuthEvidenceFromExtra } from './oauth-evidence.js'
import { buildX401EvidenceFromExtra } from './x401-evidence.js'
import {
  LOCAL_SUBSTRATE_REQUEST_SCHEMA,
  tryLocalSubstrateCoordinator,
  type LocalSubstrateCoordinatorRequest,
  type LocalSubstrateCoordinatorTransport,
  type LocalSubstrateDegradationPolicy,
  type LocalSubstrateProducer,
  type TryLocalSubstrateCoordinatorResult,
} from './local-substrate.js'
import type { AtribRecord, UnsignedAtribRecord } from './types.js'
import type { ArchiveSubmissionOptions, SubmissionQueue, ProofBundle } from './submission.js'
import type { CapturedMcpOAuthEvidence, McpOAuthEvidenceCaptureOptions } from './oauth-evidence.js'
import type { CapturedX401Evidence, X401EvidenceCaptureOptions } from './x401-evidence.js'
import type { DelegationCertificate } from './delegation.js'

const HEX_32 = /^[0-9a-f]{32}$/
const DEFAULT_LOCAL_SUBSTRATE_SHADOW_DEGRADATION: LocalSubstrateDegradationPolicy = {
  if_unavailable: 'sign locally in producer and continue without coordinator receipt',
  primary_path_blocking: false,
}

const DEFAULT_LOCAL_SUBSTRATE_COMMIT_DEGRADATION: LocalSubstrateDegradationPolicy = {
  if_unavailable: 'submit through the local queue and continue without coordinator receipt',
  primary_path_blocking: false,
}

/** Context passed to a {@link PreCallTransform} callback. */
export interface PreCallTransformContext {
  /** MCP tool name (params.name), e.g. "post_context". */
  toolName: string
  /** Arguments the upstream handler will see. The host returns a replacement object to mutate. */
  args: Record<string, unknown>
  /**
   * §1.5.2 propagation token for the record about to be emitted:
   * `base64url(record_hash) + "." + base64url(creator_key)`. Self-contained
   * reference to the (about-to-be-signed) record. Useful for embedding into
   * the upstream tool's own data so cross-tool consumers can derive a causal
   * edge back to the signed record.
   */
  receiptId: string
  /** Canonical record_hash reference: `sha256:<64-hex>`. Same value the host would receive in `informed_by`. */
  recordHash: string
  /** Per-call context_id (32 hex chars). Stable across calls in the same session under autoChain. */
  contextId: string
}

/**
 * Pre-call transform callback. When set on {@link AtribOptions}, atrib signs
 * the record BEFORE forwarding to the upstream handler so the host can embed
 * the resulting receipt_id (or record_hash) into the upstream call's args.
 *
 * Return contract:
 *   - **Return a new object** to replace `request.params.arguments` for the
 *     upstream call. The canonical pattern is `return { ...ctx.args, my_field: ctx.receiptId }`.
 *   - Return `undefined` to leave arguments unchanged (observe-only mode).
 *   - Mutating `ctx.args` in place AND returning the same reference is NOT
 *     supported: the middleware uses reference equality to detect a transform,
 *     so same-reference returns are treated as "no change." If the upstream
 *     request had no `arguments` field at all, in-place mutations to `ctx.args`
 *     are silently lost. Always allocate and return a fresh object.
 *
 * Errors thrown from the callback are caught; the middleware then falls back
 * to the standard post-call signing path so the tool call itself never fails
 * because of attribution (§5.8).
 *
 * Use case: cross-tool causal embedding. e.g., a wrapper around an MCP server
 * that writes rows to a database can use this to write the atrib receipt_id
 * into the row at insert time, letting downstream consumers anchor their own
 * `informed_by` references to the row's atrib record.
 */
export type PreCallTransform = (ctx: PreCallTransformContext) => Record<string, unknown> | undefined

export type RecordReferenceSource = 'parent-env' | 'informedBy-callback' | 'auto-detect'

export interface RecordReferenceCandidate {
  /** Candidate record_hash, `sha256:<64-hex>`. */
  recordHash: string
  /** How the candidate entered the producer. */
  source: RecordReferenceSource
  /** MCP tool name (params.name), e.g. "post_context". */
  toolName: string
  /** Per-call context_id that the record being signed will use. */
  contextId: string
  /** Full MCP tool-call params object. */
  params: Record<string, unknown>
}

export type RecordReferenceResolver = (
  candidate: RecordReferenceCandidate,
) => boolean | Promise<boolean>

export interface LocalSubstrateShadowAttempt {
  request: LocalSubstrateCoordinatorRequest
  result: TryLocalSubstrateCoordinatorResult
  expectedRecordHash: string
  recordHashMatches?: boolean
}

export interface LocalSubstrateShadowOptions {
  /** Coordinator transport. Library callers can use HTTP, Unix sockets, or tests. */
  transport: LocalSubstrateCoordinatorTransport
  /** Producer identity written into the coordinator envelope. */
  producer: LocalSubstrateProducer
  /** Per-attempt timeout. Defaults to the shared client helper default. */
  timeoutMs?: number
  /** Fallback posture written into the coordinator envelope. */
  degradation?: LocalSubstrateDegradationPolicy
  /**
   * Optional observer for rollout telemetry. It fires after the direct path has
   * signed locally, and any observer error is caught per §5.8.
   */
  onAttempt?: (attempt: LocalSubstrateShadowAttempt) => void | Promise<void>
}

export interface LocalSubstrateCommitAttempt {
  request: LocalSubstrateCoordinatorRequest
  result: TryLocalSubstrateCoordinatorResult
  expectedRecordHash: string
  responseRecordHash?: string
  recordHashMatches: boolean
}

export interface LocalSubstrateCommitOptions {
  /** Coordinator transport. Library callers can use HTTP, Unix sockets, or tests. */
  transport: LocalSubstrateCoordinatorTransport
  /** Producer identity written into the coordinator envelope. */
  producer: LocalSubstrateProducer
  /** Per-attempt timeout. Defaults to the shared client helper default. */
  timeoutMs?: number
  /** Fallback posture written into the coordinator envelope. */
  degradation?: LocalSubstrateDegradationPolicy
  /** Observer for rollout telemetry. It never affects the tool response. */
  onAttempt?: (attempt: LocalSubstrateCommitAttempt) => void | Promise<void>
  /** Warning hook for mismatches or observer errors. It never affects the tool response. */
  onWarning?: (message: string, detail?: unknown) => void
}

export interface DisclosureOptions {
  tool_name?: 'omit' | 'verbatim' | 'hashed'
  args?: 'omit' | 'plain-sha256' | 'salted-sha256'
  result?: 'omit' | 'plain-sha256' | 'salted-sha256'
}

/**
 * Recommended action-evidence preset. It commits to tool identity, arguments,
 * and the pre-mutation result while keeping their raw values in the local
 * sidecar. Low-level middleware remains byte-compatible unless callers select
 * `evidenceMode: 'verifiable-action'`.
 */
export const VERIFIABLE_ACTION_DISCLOSURE: Readonly<DisclosureOptions> = Object.freeze({
  tool_name: 'hashed',
  args: 'salted-sha256',
  result: 'salted-sha256',
})

/**
 * Pre-sign payload context passed to `onRecord` alongside the signed
 * AtribRecord. The signed record commits to this content (via content_id /
 * args_hash / result_hash) but does not itself contain it. Hosts can use
 * this sidecar to populate a richer local mirror that surfaces semantic
 * context (tool name, raw args, raw result) for consumers like atrib-trace
 * and atrib-summarize, without leaking the same content to the public log.
 *
 * All fields are optional and best-effort. The sidecar is informational
 * for observers; the canonical record bytes remain the AtribRecord.
 */
export interface OnRecordSidecar {
  /** Request/outcome phase when verifiable-action mode emits a paired record. */
  actionPhase?: 'request' | 'outcome'
  /** MCP tool name (params.name), e.g. "post_context". */
  toolName?: string
  /** Tool call arguments (params.arguments) at invocation time. */
  args?: Record<string, unknown>
  /** Upstream tool's result object, BEFORE atrib mutated _meta with its token. */
  result?: Record<string, unknown>
  /** Verifier-ready authorization evidence captured from MCP request metadata. */
  authorizationEvidence?: Array<CapturedMcpOAuthEvidence | CapturedX401Evidence>
  /** Local facts callers can feed into @atrib/verify capability_check. */
  resolvedFacts?: {
    tool_name?: string
  }
  /** Full §1.11 certificate carried only in the local mirror envelope. */
  delegation_cert?: DelegationCertificate
}

/** Options for the atrib() middleware (§5.3.1). */
export interface AtribOptions {
  /** Base64url-encoded Ed25519 private key (32 bytes). Required. */
  creatorKey?: string
  /** URL of the Merkle log submission endpoint. */
  logEndpoint?: string
  /**
   * Set to 'disabled' for offline tests and local-mirror-only hosts that
   * should still sign records and run onRecord, but must not submit to a log.
   * Defaults to 'enabled'.
   */
  logSubmission?: 'enabled' | 'disabled'
  /**
   * Opt-in anchor plurality (D138, §2.11.12). When set, every record handed
   * to the log submission queue also fans out to the configured anchor set,
   * fire-and-forget (§5.3.5) and silent-failure (§5.8). Absent = current
   * single-log behavior, unchanged.
   */
  anchors?: AnchorSetConfig
  /**
   * Opt-in record body archive submission. When set, the middleware submits
   * the signed record body plus selected verifier evidence to the archive
   * only after the log returns an inclusion proof. Raw sidecar args/results
   * stay local-only.
   */
  archiveSubmission?: ArchiveSubmissionOptions
  /**
   * Optional §1.11 delegation certificate for this producer's run key.
   * The middleware carries it only in `_local.delegation_cert`; it does not
   * add fields to the signed record or change log submission bytes.
   */
  delegationCert?: DelegationCertificate
  /** Inline attribution policy document (§4.2). */
  policy?: Record<string, unknown>
  /** Canonical URL of this MCP server for content_id derivation. */
  serverUrl?: string
  /** Tool names that complete commerce transactions (§5.4.5 Path 1). */
  transactionTools?: string[]
  /**
   * Observer invoked once per signed record AFTER signing and BEFORE log
   * submission. Lets the host persist or audit the record locally, without
   * this hook the original signed JSON is unrecoverable (the log stores only
   * commitments). Errors thrown from the observer are caught and logged; they
   * do not block submission or affect the tool response (§5.8).
   *
   * The optional `sidecar` argument carries pre-sign payload context that the
   * record's content_id / args_hash / result_hash COMMIT TO but does not
   * itself contain. Hosts can use it to persist a richer local mirror that
   * surfaces tool name + args + result alongside the signed record without
   * leaking that content to the public log (the public log only ever sees
   * the bare AtribRecord). Backward-compatible: existing observers that
   * ignore the second argument behave unchanged.
   *
   * Use cases: dogfood verification (replay verifyRecord against creator_key),
   * local audit trail, debugging "what exactly did we sign?", richer recall
   * surfaces (atrib-trace, atrib-summarize) that need semantic context.
   */
  onRecord?: (record: AtribRecord, sidecar?: OnRecordSidecar) => void | Promise<void>
  /**
   * Opt-in producer-side MCP/OAuth evidence capture. When enabled and the
   * MCP transport provides `extra.authInfo`, atrib writes verifier-ready
   * authorization evidence into the local-only sidecar. The bearer token is
   * not stored; the sidecar contains verified claims, optional token hash,
   * optional DPoP proof material, and configured constraints for later
   * `@atrib/verify` checks.
   */
  authorizationEvidence?: boolean | McpOAuthEvidenceCaptureOptions
  /**
   * Opt-in producer-side x401 proof evidence capture. When enabled and the
   * host passes HTTP proof headers through `extra.requestInfo.headers`, atrib
   * writes verifier-ready x401 evidence into the local-only sidecar. Raw
   * credential payloads stay in the header values supplied by the host; archive
   * projections should store verifier output rather than raw inputs.
   */
  x401AuthorizationEvidence?: boolean | X401EvidenceCaptureOptions
  /**
   * Maximum number of records held in the in-memory submission queue while
   * the log is unreachable. When this cap is hit, the queue evicts the
   * oldest 'normal'-priority entry first (then 'high'-priority if needed).
   * Defaults to 10000. Forwarded to createSubmissionQueue.
   */
  maxQueueDepth?: number
  /**
   * Opt-in: synthesize chain context within a single middleware instance when
   * the calling agent does not propagate atrib's outbound `_meta.atrib` token
   * back into subsequent requests. Default false.
   *
   * When true:
   *   - If a request arrives with no inbound atrib chain context AND no
   *     `_meta.traceparent`, the middleware uses a stable process-lifetime
   *     context_id so successive calls share a trace.
   *   - Within each context_id, the middleware remembers the most recent
   *     signed record's hash and uses it as `chain_root` for the next call,
   *     forming `CHAIN_PRECEDES` edges between successive tool calls.
   *
   * Why opt-in: spec-conformant behavior is "chain reflects propagated agent
   * context." For agents that DO propagate, autoChain would clobber explicit
   * intent. For agents that don't (Claude Code, Cursor, generic stdio hosts),
   * autoChain turns "every call is a genesis" into "every call links to its
   * predecessor in this process," which is the dogfood-loop's intended
   * semantic, the agent observed every prior call's result before making
   * the next one.
   *
   * Hosts that wrap atrib over an upstream MCP server typically expose this via an env var (e.g. `ATRIB_AUTO_CHAIN`).
   */
  autoChain?: boolean
  /**
   * Optional per-call context resolver used when the caller did not provide
   * `_meta.atrib` or a valid traceparent. This lets long-lived MCP children
   * inherit the active host session from a harness state file instead of
   * minting a wrapper-owned session.
   *
   * Returning undefined falls through to the normal autoChain fallback.
   * Invalid values are ignored. Exceptions are caught so the tool call still
   * succeeds when context discovery is stale or unavailable.
   */
  contextIdResolver?: () => string | undefined
  /**
   * Controls what `autoChain` does when no inbound or resolved context exists.
   *
   * `stable-process` preserves the historical wrapper behavior: a process-wide
   * context_id is minted and reused so non-propagating hosts still get a chain.
   *
   * `fresh` keeps autoChain active for resolved contexts but refuses to create
   * a wrapper-wide session. Each no-context call gets its own genesis context.
   */
  autoChainFallback?: 'stable-process' | 'fresh'
  /**
   * Seed records used to populate the in-memory `lastRecordHashByContext`
   * map on startup. Without this, autoChain breaks across process restarts:
   * the first call after a wrapper restart becomes a fresh genesis even
   * though prior records exist. Pass the on-disk record mirror's most-recent
   * record per context_id (or just all records, the middleware will pick
   * the most-recent per context_id).
   *
   * Only consulted when `autoChain: true`. Records are not verified here;
   * the caller is expected to filter to records they trust (e.g. their own
   * signed-record mirror persisted by `onRecord`).
   */
  autoChainSeed?: AtribRecord[]
  /**
   * Optional callback invoked once per outbound tool call. Returns the list
   * of prior `record_hash` values (each `sha256:<64-hex>`) that this call
   * is informed by. The middleware injects the result into the signed
   * record's `informed_by` field (D041 / spec §1.2.7), letting verifiers
   * derive INFORMED_BY graph edges.
   *
   * Receives the MCP tool-call params object (so the host can inspect
   * arguments, names, etc.). Returning `undefined` or an empty array omits
   * the field. The host is responsible for accuracy, informed_by is a
   * provenance claim, not a heuristic.
   */
  informedBy?: (params: Record<string, unknown>) => string[] | undefined
  /**
   * Optional source-aware validator for `informed_by` candidates.
   *
   * When supplied, refs from `informedBy` callbacks and
   * `autoDetectInformedByFromArgs` are kept only if the resolver returns
   * true. `ATRIB_PARENT_RECORD_HASH` env seeds are producer-owned spawn
   * anchors and bypass this lookup because the parent may have just signed
   * the dispatch record before mirror or public-log visibility catches up.
   *
   * Resolver errors are caught; the candidate is dropped and the wrapped tool
   * call still succeeds per §5.8.
   */
  recordReferenceResolver?: RecordReferenceResolver
  /**
   * Mechanical auto-detection of `informed_by` references from tool args.
   *
   * When `true`, the middleware extracts refs only from structured
   * record-reference fields such as `record_hash`, `record_hashes`,
   * `accepted_record_hashes`, `annotates`, and `revises`. It does not scan
   * arbitrary prose or commitment fields. Detected references are merged with
   * the explicit `informedBy` callback result, de-duped, and lex-sorted per
   * §1.2.5. Default `false` preserves backward compat.
   *
   * Per spec §1.2.5: informed_by is a provenance claim. Auto-detect is only a
   * convenience for structured record refs; hosts that know a tool-specific
   * path should prefer the explicit `informedBy` callback.
   */
  autoDetectInformedByFromArgs?: boolean
  /**
   * Optional pre-call transform. When set, atrib signs the record BEFORE
   * forwarding to the upstream handler so the host can embed the resulting
   * receipt_id into the upstream call's args. See {@link PreCallTransform}.
   *
   * When unset, signing happens AFTER the upstream returns (the default,
   * spec-aligned with §5.3 latency contract: attribution must not block the
   * tool's response shape). preCallTransform is opt-in because pre-call
   * signing trades a small latency penalty (one signature on the critical
   * path) for the ability to causally embed records into downstream data.
   */
  preCallTransform?: PreCallTransform
  /**
   * Named evidence posture. `verifiable-action` applies
   * `VERIFIABLE_ACTION_DISCLOSURE` unless `disclosure` is supplied.
   * `minimal` preserves the §8.1 byte-compatible omission posture.
   */
  evidenceMode?: 'minimal' | 'verifiable-action'
  /**
   * Optional disclosure controls per spec §8 / D061. Each dial picks how
   * much the signed record discloses about the underlying tool call. All
   * default to `'omit'`, preserving the §8.1 default posture (existing
   * behavior; no change to record bytes for callers that don't opt in).
   *
   *   - `tool_name: 'omit' | 'verbatim' | 'hashed'` (§8.2). 'verbatim'
   *     writes the raw tool name. 'hashed' writes `sha256:<hex>` of the
   *     name (verifiers configured with a name registry can resolve;
   *     others see only the hash). 'omit' adds nothing.
   *   - `args: 'omit' | 'plain-sha256' | 'salted-sha256'` (§8.3).
   *     'plain-sha256' writes `args_hash = sha256(JCS(arguments))`.
   *     'salted-sha256' generates a 16-byte random salt, writes both
   *     `args_salt` (the salt, base64url) and `args_hash =
   *     sha256(salt || JCS(arguments))`. 'omit' adds nothing.
   *   - `result: 'omit' | 'plain-sha256' | 'salted-sha256'` (§8.3).
   *     Same scheme as `args` but for the tool's response. Hashes the
   *     JCS canonicalization of the result object captured BEFORE
   *     atrib mutates `result._meta` with its own fields.
   *
   * **Compatibility note**: `result` disclosure requires the post-call
   * signing path. It is INCOMPATIBLE with `preCallTransform` (which
   * signs BEFORE the handler returns). When both are set, `result`
   * disclosure is silently ignored and a warning is logged.
   */
  disclosure?: DisclosureOptions
  /**
   * Opt-in local substrate shadow probe. The middleware sends the exact
   * unsigned record body to a coordinator in `shadow_probe` mode, then still
   * signs, mirrors, and submits locally. This proves startup-spawn reachability
   * without moving ownership of queue or mirror side effects.
   */
  localSubstrate?: LocalSubstrateShadowOptions
  /**
   * Opt-in local substrate commit path. The middleware signs locally so it can
   * attach outbound context and persist the local sidecar, then sends the exact
   * unsigned record body to a coordinator in `commit` mode. If the coordinator
   * returns the same record_hash, this process skips its own log-submission
   * queue. Rejection, timeout, or hash mismatch falls back to the local queue.
   */
  localSubstrateCommit?: LocalSubstrateCommitOptions
  /**
   * Opt-in `dev.atrib/attribution` MCP extension receipts (D141 / spec
   * §1.5.4.1; extension spec docs/extensions/dev.atrib-attribution/v0.1.md).
   *
   * When true, successful tool calls whose client declared the extension on
   * THAT request (per-request `io.modelcontextprotocol/clientCapabilities`
   * in `_meta`, or a legacy `initialize`-time declaration supplied by the
   * host) additionally receive the gated `dev.atrib/attribution` block in
   * `result._meta`: the propagation token plus an attestation receipt naming
   * the already-signed record, with `log_submission` reported as a queue
   * status (`'disabled'` under `logSubmission: 'disabled'`, else `'queued'`)
   * — never an awaited proof (§5.3.5).
   *
   * Default false: zero behavior change. The legacy unprefixed result keys
   * (`atrib`, `tracestate`, `X-Atrib-Chain`) are written unconditionally
   * either way, and receipt emission failures degrade silently per §5.8.
   */
  extensionAttribution?: boolean
}

/** Extended McpServer with atrib-specific methods. */
export interface AtribServer extends McpServer {
  /** Flush pending log submissions (for testing/shutdown). */
  flush(): Promise<void>
  /** The policy document this server exposes, if any (§5.3.6). */
  readonly policy: Record<string, unknown> | null
  /** Retrieve a cached proof bundle by record hash (§5.3.5). */
  getProof(recordHash: string): ProofBundle | undefined
  /**
   * Zero the private key and prevent further signing (§5.6.3).
   * Call on graceful shutdown. After destroy(), tool calls pass through
   * without attribution records.
   */
  destroy(): void
}

function createNoopSubmissionQueue(): SubmissionQueue {
  return {
    submit() {},
    getProof() {
      return undefined
    },
    async flush() {},
  }
}

/**
 * Wrap an MCP server with atrib attribution middleware (§5.3).
 *
 * If creatorKey is not provided, operates in pass-through mode:
 * all requests and responses forwarded without modification.
 */
export function atrib(server: McpServer, options: AtribOptions = {}): AtribServer {
  const atribServer = server as AtribServer

  // §5.8: If ATRIB_PRIVATE_KEY is not set, pass-through mode
  if (!options.creatorKey) {
    console.warn('atrib: no creatorKey provided, operating in pass-through mode')
    atribServer.flush = async () => {}
    atribServer.getProof = () => undefined
    atribServer.destroy = () => {}
    Object.defineProperty(atribServer, 'policy', { value: null, writable: false })
    return atribServer
  }

  const privateKey = base64urlDecode(options.creatorKey)
  if (privateKey.length !== 32) {
    console.warn('atrib: creatorKey must be 32 bytes, operating in pass-through mode')
    atribServer.flush = async () => {}
    atribServer.getProof = () => undefined
    atribServer.destroy = () => {}
    Object.defineProperty(atribServer, 'policy', { value: null, writable: false })
    return atribServer
  }

  const serverUrl = options.serverUrl ?? ''
  if (!serverUrl) {
    console.warn(
      'atrib: no serverUrl provided. content_id values will not uniquely identify this server. ' +
        'Set serverUrl explicitly, especially for stdio transport where no host header is available.',
    )
  }
  const transactionTools = new Set(options.transactionTools ?? [])
  const baseQueue: SubmissionQueue =
    options.logSubmission === 'disabled'
      ? createNoopSubmissionQueue()
      : createSubmissionQueue(options.logEndpoint, {
          ...(options.maxQueueDepth !== undefined ? { maxQueueDepth: options.maxQueueDepth } : {}),
          ...(options.archiveSubmission !== undefined
            ? { archiveSubmission: options.archiveSubmission }
            : {}),
        })
  // D138 anchor plurality: opt-in fan-out wrapper over the queue boundary.
  // Identical queue object when `anchors` is unset; fan-out legs are
  // fire-and-forget per §5.3.5 and silent-failure per §5.8.
  const anchorFanout =
    options.anchors !== undefined ? createAnchorFanout({ config: options.anchors }) : undefined
  const queue: SubmissionQueue = anchorFanout
    ? {
        submit(record, priority, sidecar) {
          baseQueue.submit(record, priority, sidecar)
          anchorFanout.submitToAnchors(record, priority)
        },
        getProof: (hash) => baseQueue.getProof(hash),
        flush: async () => {
          await baseQueue.flush()
          await anchorFanout.flush()
        },
      }
    : baseQueue

  // autoChain bookkeeping (process-lifetime, opt-in via options.autoChain).
  // Stable context_id for sessions where the caller never sets traceparent;
  // and per-context_id last-signed-record-hash for chain synthesis.
  const autoChain = options.autoChain === true
  const autoChainFallback = options.autoChainFallback ?? 'stable-process'
  let stableContextId: string | undefined
  const lastRecordHashByContext = new Map<string, string>()
  const parentRecordHashSeed = parentRecordHashFromEnv()
  let parentRecordHashSeedConsumed = false

  // Seed lastRecordHashByContext from the caller-provided record set so
  // autoChain survives process restarts. For each context_id, find the
  // most-recent record (by timestamp) and store its record_hash. The next
  // call in that context_id will chain to it instead of starting genesis.
  // Tie-break on equal timestamps by iteration order (later seed entries
  // win): on fast machines, two records signed in the same millisecond
  // get equal Date.now() values, and a strict `>` would retain the OLDER
  // one, which then incorrectly chains to it. JSONL mirrors are appended
  // chronologically, so iteration order IS the correct tie-break signal.
  if (autoChain && options.autoChainSeed && options.autoChainSeed.length > 0) {
    const newestByContext = new Map<string, AtribRecord>()
    for (const r of options.autoChainSeed) {
      const existing = newestByContext.get(r.context_id)
      if (!existing || r.timestamp >= existing.timestamp) {
        newestByContext.set(r.context_id, r)
      }
    }
    for (const [ctx, r] of newestByContext) {
      const hash = hexEncode(sha256(canonicalRecord(r)))
      lastRecordHashByContext.set(ctx, hash)
    }
    // If the seed records all share a single context_id and no traceparent
    // is set later, reuse that context_id rather than minting a new one.
    // Picks the context_id with the most-recent record.
    if (newestByContext.size > 0 && autoChainFallback === 'stable-process') {
      let bestCtx: string | undefined
      let bestTs = -Infinity
      for (const [ctx, r] of newestByContext) {
        // Same `>=` tie-break rationale as the per-context loop above: on
        // equal timestamps, prefer the later-iterated entry (jsonl mirror
        // append order = chronological).
        if (r.timestamp >= bestTs) {
          bestTs = r.timestamp
          bestCtx = ctx
        }
      }
      stableContextId = bestCtx
    }
  }

  // §5.6.3: Track whether destroy() has been called. After destroy, the
  // private key is zeroed and no further signing is possible.
  let destroyed = false
  const pendingLocalSubstrateCommits: Promise<void>[] = []

  // Derive the public key once at init (async, cached).
  let publicKeyB64: string | undefined
  const publicKeyReady = getPublicKey(privateKey).then((pk) => {
    publicKeyB64 = base64urlEncode(pk)
  })

  // Init-time warning: result disclosure requires the post-call signing
  // path. preCallTransform forces pre-call signing where the result isn't
  // available yet, so the two are mutually exclusive. The runtime path
  // already silently skips result hashing on pre-call; this warning makes
  // the conflict visible at config time rather than letting it manifest as
  // silently-missing result_hash fields on emitted records.
  const effectiveDisclosure =
    options.disclosure ??
    (options.evidenceMode === 'verifiable-action' ? VERIFIABLE_ACTION_DISCLOSURE : {})

  if (
    options.preCallTransform &&
    options.disclosure !== undefined &&
    effectiveDisclosure.result &&
    effectiveDisclosure.result !== 'omit'
  ) {
    console.warn(
      'atrib: disclosure.result is incompatible with preCallTransform (the result is not available pre-call). result_hash / result_salt will not appear on records produced via the preCallTransform path.',
    )
  }

  // === MCP SDK integration: setRequestHandler monkey-patch ===
  //
  // The MCP TypeScript SDK does not currently expose a documented middleware
  // or interceptor extension point (verified against
  // github.com/modelcontextprotocol/typescript-sdk as of @^1.29.0). The high-
  // level `McpServer.registerTool(name, config, cb)` API accumulates tool
  // callbacks and lazily registers a single dispatching handler on the
  // underlying low-level `Server` via `setRequestHandler(CallToolRequestSchema, ...)`.
  //
  // We patch that low-level setRequestHandler to wrap the tools/call dispatcher
  // with attribution logic. This intercepts BOTH high-level usage
  // (`McpServer.registerTool` / deprecated `tool`) AND low-level direct usage
  // (`server.server.setRequestHandler('tools/call', ...)`), because both code
  // paths funnel through the same low-level call.
  //
  // The patch is fragile in two specific ways:
  //   1. It depends on `server.server` being the underlying Server instance
  //      (an internal implementation detail of McpServer).
  //   2. It detects the tools/call request by inspecting the Zod schema
  //      passed to setRequestHandler. SDK 1.29 uses `CallToolRequestSchema`
  //      whose shape exposes `.shape.method.value === 'tools/call'`. The v2
  //      migration docs hint at a future string-based form
  //      (`setRequestHandler('tools/call', handler)`); we accept both forms
  //      via `isToolsCallSchema` below so the patch survives that migration.
  //
  // We add a runtime sanity check that warns loudly if `server.server` is
  // missing or `setRequestHandler` is not a function. this turns silent
  // failures on SDK upgrades into visible warnings. A regression test in
  // `packages/mcp/test/middleware-sdk-shape.test.ts` imports the real SDK
  // and asserts the shape we depend on, so an SDK upgrade that breaks
  // either assumption fails CI immediately.
  //
  // If the SDK eventually exposes a documented middleware API
  // (e.g., `Server.use(middleware)` or `Server.fallbackRequestHandler`),
  // the body of this patch should be replaced with that API. The wrap()
  // function below stays unchanged.
  const underlyingServer = (server as { server?: unknown }).server as
    { setRequestHandler: unknown } | undefined

  if (!underlyingServer || typeof underlyingServer.setRequestHandler !== 'function') {
    console.warn(
      'atrib: McpServer.server.setRequestHandler is not a function. ' +
        'the MCP SDK shape this middleware depends on has changed. ' +
        'Operating in pass-through mode. Please file an issue at ' +
        'github.com/creatornader/atrib with your @modelcontextprotocol/sdk version.',
    )
    atribServer.flush = async () => {}
    atribServer.getProof = () => undefined
    atribServer.destroy = () => {}
    Object.defineProperty(atribServer, 'policy', { value: null, writable: false })
    return atribServer
  }

  // We need to intercept setRequestHandler to wrap the tools/call handler.
  // The MCP SDK uses complex Zod-based types internally, so we use `any` for
  // the interop boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origSetHandler: any = (underlyingServer.setRequestHandler as Function).bind(
    underlyingServer,
  )

  /**
   * Result of building + signing a record from a tools/call request. Captured
   * once so pre-call and post-call branches share the same outputs.
   */
  interface BuiltRecord {
    signed: AtribRecord
    recordBody: UnsignedAtribRecord
    /** Hex-encoded record_hash WITHOUT "sha256:" prefix. */
    recordHashHex: string
    contextId: string
    sessionToken: string | undefined
    inboundTraceparent: unknown
    eventType: string
    parentRecordHashSeeded: boolean
    parentRecordHash?: string
  }

  /**
   * Build + sign a record from the request. When `resultForHash` is
   * supplied, the disclosure.result dial drives result_hash / result_salt
   * computation against the JCS canonicalization of that object.
   * Pre-call signing (preCallTransform path) calls without resultForHash
   * because the handler hasn't returned yet; disclosure.result is
   * silently ignored on that path with a warning. The optional local
   * substrate shadow probe is fire-and-forget and never replaces local
   * signing in this path. The optional commit path normally runs after the
   * tool succeeds. Verifiable-action pre-call mode commits its request before
   * execution and signs a linked terminal outcome for success or failure.
   */
  const buildSignedRecord = async (
    request: Record<string, unknown>,
    resultForHash?: Record<string, unknown>,
    priorRecordHashHex?: string,
    eventTypeOverride?: string,
  ): Promise<BuiltRecord> => {
    // §5.3.2: Read inbound context
    const params = request.params as Record<string, unknown>
    const inbound = readInboundContext(params)

    // Extract context_id
    const meta = params._meta as Record<string, unknown> | undefined
    let contextId = inbound?.contextId
    if (!contextId && meta?.traceparent && typeof meta.traceparent === 'string') {
      const parts = meta.traceparent.split('-')
      const traceId = parts[1]
      if (traceId && HEX_32.test(traceId)) {
        contextId = traceId
      }
    }
    if (!contextId && options.contextIdResolver) {
      try {
        const resolved = options.contextIdResolver()
        if (typeof resolved === 'string' && HEX_32.test(resolved)) {
          contextId = resolved
        }
      } catch (e) {
        console.warn('atrib: contextIdResolver threw', e)
      }
    }
    if (!contextId) {
      if (autoChain && autoChainFallback === 'stable-process') {
        // Stable across the wrapper process's lifetime so successive
        // calls share a trace. Without this, autoChain has no effect
        // because every call would land in its own context_id bucket.
        if (!stableContextId) {
          const bytes = new Uint8Array(16)
          crypto.getRandomValues(bytes)
          stableContextId = hexEncode(bytes)
        }
        contextId = stableContextId
      } else {
        const bytes = new Uint8Array(16)
        crypto.getRandomValues(bytes)
        contextId = hexEncode(bytes)
      }
    }

    // session_token can come from inbound context or directly from baggage
    let sessionToken = inbound?.sessionToken
    if (!sessionToken && meta?.baggage && typeof meta.baggage === 'string') {
      sessionToken = parseBaggageAtribSession(meta.baggage)
    }

    // Forward traceparent to outbound _meta (§1.5.4)
    const inboundTraceparent = meta?.traceparent

    // Determine chain_root via the priority cascade in resolveChainRoot:
    // inbound traceparent > autoChain in-memory tail > ATRIB_CHAIN_TAIL_<ctx>
    // env var (cross-producer handoff) > synthetic genesis.
    const chainRootValue = resolveChainRoot({
      contextId,
      inboundRecordHashHex:
        priorRecordHashHex ?? (inbound ? hexEncode(inbound.recordHash) : undefined),
      autoChainTailHex: autoChain ? lastRecordHashByContext.get(contextId) : undefined,
    })

    // Determine event_type URI (spec 1.2.4)
    const toolName = (params.name as string) ?? ''
    const eventType =
      eventTypeOverride ??
      (transactionTools.has(toolName) ? EVENT_TYPE_TRANSACTION_URI : EVENT_TYPE_TOOL_CALL_URI)

    // Construct the record
    const contentId = computeContentId(serverUrl, toolName)
    // informedBy callback (D041 / §1.2.7): host declares which prior
    // records influenced this call. Wrapped in try/catch so a faulty
    // callback never blocks signing, per §5.8 attribution must degrade
    // silently. Empty/undefined result omits the field entirely
    // (presence affects the JCS canonical form, so omission is normal).
    let informedByList: string[] | undefined
    const merged = new Set<string>()
    if (priorRecordHashHex !== undefined) {
      merged.add(`sha256:${priorRecordHashHex}`)
    }
    const candidates: RecordReferenceCandidate[] = []
    let parentRecordHashSeeded = false
    if (parentRecordHashSeed && !parentRecordHashSeedConsumed) {
      merged.add(parentRecordHashSeed)
      parentRecordHashSeeded = true
    }
    if (options.informedBy) {
      try {
        const informed = options.informedBy(params)
        if (Array.isArray(informed)) {
          for (const h of informed) {
            if (typeof h === 'string' && SHA256_REF_PATTERN.test(h)) {
              candidates.push({
                recordHash: h,
                source: 'informedBy-callback',
                toolName,
                contextId,
                params,
              })
            }
          }
        }
      } catch (e) {
        console.warn('atrib: informedBy callback threw', e)
      }
    }
    // Mechanical auto-detect from args, opt-in via autoDetectInformedByFromArgs.
    // See AtribOptions.autoDetectInformedByFromArgs for the rationale.
    if (options.autoDetectInformedByFromArgs) {
      for (const h of extractRecordReferenceCandidates(params)) {
        candidates.push({
          recordHash: h,
          source: 'auto-detect',
          toolName,
          contextId,
          params,
        })
      }
    }
    if (candidates.length > 0) {
      for (const candidate of candidates) {
        if (!options.recordReferenceResolver) {
          merged.add(candidate.recordHash)
          continue
        }
        try {
          if (await options.recordReferenceResolver(candidate)) {
            merged.add(candidate.recordHash)
          }
        } catch (e) {
          console.warn('atrib: recordReferenceResolver threw', e)
        }
      }
    }
    if (merged.size > 0) {
      // Lex-sort per §1.2.5 to keep canonical form stable across emitters.
      informedByList = [...merged].sort()
    }
    // §8 / D061 disclosure dials. Each defaults to 'omit' (preserves §8.1
    // default posture). Errors during disclosure synthesis fall through to
    // omission rather than throwing, degradation contract per §5.8.
    const disclosure = effectiveDisclosure
    const toolNameDisclosure = disclosure.tool_name ?? 'omit'
    const argsDisclosure = disclosure.args ?? 'omit'

    let toolNameField: string | undefined
    if (toolNameDisclosure === 'verbatim') {
      toolNameField = toolName
    } else if (toolNameDisclosure === 'hashed') {
      toolNameField = `sha256:${hexEncode(sha256(new TextEncoder().encode(toolName)))}`
    }

    // Helper for §8.3 commitment-form synthesis. Returns { hash, salt? }
    // where salt is present iff scheme === 'salted-sha256'.
    const computeCommitment = (
      schemeBytes: Uint8Array,
      scheme: 'plain-sha256' | 'salted-sha256',
    ): { hash: string; salt?: string } => {
      if (scheme === 'plain-sha256') {
        return { hash: `sha256:${hexEncode(sha256(schemeBytes))}` }
      }
      // salted-sha256 per §8.3: H = SHA-256(salt ‖ canonical_bytes)
      const salt = new Uint8Array(16)
      crypto.getRandomValues(salt)
      const combined = new Uint8Array(salt.length + schemeBytes.length)
      combined.set(salt, 0)
      combined.set(schemeBytes, salt.length)
      return {
        hash: `sha256:${hexEncode(sha256(combined))}`,
        salt: base64urlEncode(salt),
      }
    }

    let argsHashField: string | undefined
    let argsSaltField: string | undefined
    if (argsDisclosure !== 'omit') {
      try {
        const argsValue = (params.arguments as Record<string, unknown> | undefined) ?? {}
        const argsJcs = canonicalize(argsValue)
        if (typeof argsJcs === 'string') {
          const argsBytes = new TextEncoder().encode(argsJcs)
          const c = computeCommitment(argsBytes, argsDisclosure)
          argsHashField = c.hash
          argsSaltField = c.salt
        }
      } catch (e) {
        console.warn('atrib: args disclosure synthesis failed, omitting', e)
      }
    }

    // §8.3 result_hash / result_salt synthesis. Only fires when:
    //   (a) caller passed `resultForHash` (post-call signing path), AND
    //   (b) `disclosure.result` is not 'omit'.
    // Pre-call signing (preCallTransform) supplies no resultForHash so
    // disclosure.result is silently inactive there.
    const resultDisclosure = disclosure.result ?? 'omit'
    let resultHashField: string | undefined
    let resultSaltField: string | undefined
    if (resultDisclosure !== 'omit' && resultForHash) {
      try {
        const resultJcs = canonicalize(resultForHash)
        if (typeof resultJcs === 'string') {
          const resultBytes = new TextEncoder().encode(resultJcs)
          const c = computeCommitment(resultBytes, resultDisclosure)
          resultHashField = c.hash
          resultSaltField = c.salt
        }
      } catch (e) {
        console.warn('atrib: result disclosure synthesis failed, omitting', e)
      }
    }

    const record: UnsignedAtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: contentId,
      creator_key: publicKeyB64!,
      chain_root: chainRootValue,
      event_type: eventType,
      context_id: contextId,
      timestamp: Date.now(),
      ...(argsHashField ? { args_hash: argsHashField } : {}),
      ...(argsSaltField ? { args_salt: argsSaltField } : {}),
      ...(informedByList ? { informed_by: informedByList } : {}),
      ...(resultHashField ? { result_hash: resultHashField } : {}),
      ...(resultSaltField ? { result_salt: resultSaltField } : {}),
      ...(sessionToken ? { session_token: sessionToken } : {}),
      ...(toolNameField !== undefined ? { tool_name: toolNameField } : {}),
    } as UnsignedAtribRecord

    // §1.4.2: Sign the record
    const signed = await signRecord({ ...record, signature: '' } as AtribRecord, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
    dispatchLocalSubstrateShadow(
      {
        schema: LOCAL_SUBSTRATE_REQUEST_SCHEMA,
        operation: 'sign_record',
        mode: 'shadow_probe',
        producer: options.localSubstrate?.producer ?? {
          name: 'unknown-producer',
          harness_class: 'startup-spawn',
        },
        context: {
          source: '@atrib/mcp',
          context_id: contextId,
          chain_tail: chainRootValue,
          ...(parentRecordHashSeeded && parentRecordHashSeed
            ? { parent_record_hash: parentRecordHashSeed }
            : {}),
        },
        record_body: record,
        degradation:
          options.localSubstrate?.degradation ?? DEFAULT_LOCAL_SUBSTRATE_SHADOW_DEGRADATION,
      },
      `sha256:${recordHashHex}`,
    )

    return {
      signed,
      recordBody: record,
      recordHashHex,
      contextId,
      sessionToken,
      inboundTraceparent,
      eventType,
      parentRecordHashSeeded,
      ...(parentRecordHashSeeded && parentRecordHashSeed
        ? { parentRecordHash: parentRecordHashSeed }
        : {}),
    }
  }

  const dispatchLocalSubstrateShadow = (
    request: LocalSubstrateCoordinatorRequest,
    expectedRecordHash: string,
  ): void => {
    const shadow = options.localSubstrate
    if (!shadow) return

    void tryLocalSubstrateCoordinator(request, {
      transport: shadow.transport,
      ...(shadow.timeoutMs !== undefined ? { timeoutMs: shadow.timeoutMs } : {}),
      expectedHarnessClass: shadow.producer.harness_class,
      directRecordBody: request.record_body,
    })
      .then((result) => {
        const actualRecordHash = result.ok ? result.response.record_hash : undefined
        const recordHashMatches =
          actualRecordHash !== undefined ? actualRecordHash === expectedRecordHash : undefined
        if (recordHashMatches === false) {
          console.warn('atrib: local substrate shadow record_hash mismatch', {
            expected: expectedRecordHash,
            actual: actualRecordHash,
          })
        }
        if (shadow.onAttempt) {
          try {
            const observed = shadow.onAttempt({
              request,
              result,
              expectedRecordHash,
              ...(recordHashMatches !== undefined ? { recordHashMatches } : {}),
            })
            void Promise.resolve(observed).catch((error) => {
              console.warn('atrib: local substrate shadow observer rejected', error)
            })
          } catch (error) {
            console.warn('atrib: local substrate shadow observer threw', error)
          }
        }
      })
      .catch((error) => {
        console.warn('atrib: local substrate shadow probe failed unexpectedly', error)
      })
  }

  const dispatchLocalSubstrateCommit = (
    built: BuiltRecord,
    priority: 'high' | 'normal',
    sidecar?: OnRecordSidecar,
  ): void => {
    const commit = options.localSubstrateCommit
    if (!commit) {
      queue.submit(built.signed, priority, sidecar)
      return
    }

    const expectedRecordHash = `sha256:${built.recordHashHex}`
    const request: LocalSubstrateCoordinatorRequest = {
      schema: LOCAL_SUBSTRATE_REQUEST_SCHEMA,
      operation: 'sign_record',
      mode: 'commit',
      producer: commit.producer,
      context: {
        source: '@atrib/mcp',
        context_id: built.contextId,
        chain_tail: built.signed.chain_root,
        ...(built.parentRecordHash !== undefined
          ? { parent_record_hash: built.parentRecordHash }
          : {}),
      },
      record_body: built.recordBody,
      degradation: commit.degradation ?? DEFAULT_LOCAL_SUBSTRATE_COMMIT_DEGRADATION,
    }

    const attempt = tryLocalSubstrateCoordinator(request, {
      transport: commit.transport,
      ...(commit.timeoutMs !== undefined ? { timeoutMs: commit.timeoutMs } : {}),
      expectedHarnessClass: commit.producer.harness_class,
      directRecordBody: built.recordBody,
    })
      .then((result) => {
        const responseRecordHash =
          result.ok || result.status === 'rejected' ? result.response?.record_hash : undefined
        const recordHashMatches = responseRecordHash === expectedRecordHash
        if (commit.onAttempt) {
          try {
            const observed = commit.onAttempt({
              request,
              result,
              expectedRecordHash,
              ...(responseRecordHash !== undefined ? { responseRecordHash } : {}),
              recordHashMatches,
            })
            void Promise.resolve(observed).catch((error) => {
              notifyLocalSubstrateCommitWarning(
                commit,
                'local substrate commit observer rejected',
                error,
              )
            })
          } catch (error) {
            notifyLocalSubstrateCommitWarning(
              commit,
              'local substrate commit observer threw',
              error,
            )
          }
        }

        if (result.ok && recordHashMatches) {
          return
        }

        if (result.ok && !recordHashMatches) {
          notifyLocalSubstrateCommitWarning(commit, 'local substrate commit record_hash mismatch', {
            expected_record_hash: expectedRecordHash,
            response_record_hash: responseRecordHash ?? null,
          })
        }
        queue.submit(built.signed, priority, sidecar)
      })
      .catch((error) => {
        notifyLocalSubstrateCommitWarning(
          commit,
          'local substrate commit failed unexpectedly',
          error,
        )
        queue.submit(built.signed, priority, sidecar)
      })

    pendingLocalSubstrateCommits.push(attempt)
    void attempt.finally(() => {
      const idx = pendingLocalSubstrateCommits.indexOf(attempt)
      if (idx !== -1) pendingLocalSubstrateCommits.splice(idx, 1)
    })
  }

  const notifyLocalSubstrateCommitWarning = (
    commit: LocalSubstrateCommitOptions,
    message: string,
    detail?: unknown,
  ): void => {
    if (commit.onWarning) {
      try {
        commit.onWarning(`atrib: ${message}`, detail)
        return
      } catch {
        // Warning observers must not affect the signed record path.
      }
    }
    console.warn(`atrib: ${message}`, detail)
  }

  /**
   * Commit a built record: run the onRecord observer, attach outbound
   * context to the result, queue for log submission, update autoChain
   * bookkeeping. Ordinary calls reach this helper only after success.
   * Verifiable-action request/outcome pairs also use it for the pre-execution
   * request and for terminal error outcomes.
   *
   * `sidecar` is the optional pre-sign payload (toolName, args, result)
   * passed through to onRecord observers that want to persist a richer
   * local mirror. Public-log submission is unaffected, the queue only
   * sees the bare AtribRecord.
   */
  const commitRecord = (
    built: BuiltRecord,
    resultObj: Record<string, unknown> | undefined,
    sidecar?: OnRecordSidecar,
  ): void => {
    // autoChain bookkeeping: remember this record's hash so the next
    // call in the same context_id chains to it. Deferred to commit time so
    // failed/aborted calls don't poison the chain.
    if (autoChain) {
      lastRecordHashByContext.set(built.contextId, built.recordHashHex)
    }

    // Optional onRecord observer (post-sign, pre-submit). Errors are
    // swallowed per §5.8, observation must never affect the tool call.
    if (options.onRecord) {
      try {
        const r = options.onRecord(built.signed, sidecar)
        if (r && typeof (r as Promise<void>).then === 'function') {
          ;(r as Promise<void>).catch((e) => console.warn('atrib: onRecord observer rejected', e))
        }
      } catch (e) {
        console.warn('atrib: onRecord observer threw', e)
      }
    }

    // §5.3.4: Write outbound context (includes traceparent, baggage, X-Atrib-Chain)
    if (resultObj) {
      writeOutboundContext(resultObj, built.signed, {
        traceparent:
          typeof built.inboundTraceparent === 'string' ? built.inboundTraceparent : undefined,
        sessionToken: built.sessionToken,
      })
    }

    // 5.3.5: Non-blocking log submission. Transaction records (1.7 commerce hooks)
    // are admitted at high priority so they are not delayed behind tool_call backlog.
    // In local-substrate commit mode, queue ownership moves to the coordinator
    // only after a bounded hash-matching attempt accepts the same signed bytes.
    const priority: 'high' | 'normal' =
      built.eventType === EVENT_TYPE_TRANSACTION_URI ? 'high' : 'normal'
    dispatchLocalSubstrateCommit(built, priority, sidecar)
    if (built.parentRecordHashSeeded) {
      parentRecordHashSeedConsumed = true
    }
  }

  // The attribution wrapper. Extracted so we can apply it both to newly-
  // registered handlers (via the setRequestHandler patch) AND retroactively
  // to a handler that was already installed before atrib() was called.
  //
  // The canonical README pattern is wrap-then-register: call `atrib(server)`
  // first, then `server.tool(...)`. But McpServer's `.tool()` / `.registerTool()`
  // eagerly installs the tools/call dispatcher on first registration, so if a
  // user calls `atrib()` AFTER their first `.tool()`, our setRequestHandler
  // patch would never see the dispatcher. To support both orderings, we also
  // reach into the underlying Server's `_requestHandlers` map (an undocumented
  // internal, but stable through SDK 1.x) and rewrite the existing entry in
  // place if it's already there.
  const makeWrappedHandler = (
    handler: (request: Record<string, unknown>, extra: unknown) => Promise<unknown>,
  ) => {
    return async (request: Record<string, unknown>, extra: unknown) => {
      const requestParams = request.params as Record<string, unknown>
      const requestToolName = (requestParams.name as string) ?? ''

      const buildSidecar = (
        resultObj?: Record<string, unknown>,
        actionPhase?: 'request' | 'outcome',
        argsOverride?: Record<string, unknown>,
      ): OnRecordSidecar => {
        const sidecar: OnRecordSidecar = {}
        if (resultObj !== undefined) sidecar.result = resultObj
        if (actionPhase !== undefined) sidecar.actionPhase = actionPhase
        if (options.delegationCert !== undefined) {
          sidecar.delegation_cert = options.delegationCert
        }
        if (typeof requestParams.name === 'string') {
          sidecar.toolName = requestParams.name
          sidecar.resolvedFacts = { tool_name: requestParams.name }
        }
        const sideArgs =
          argsOverride ?? (requestParams.arguments as Record<string, unknown> | undefined)
        if (sideArgs) sidecar.args = sideArgs
        const authorizationEvidence = buildMcpOAuthEvidenceFromExtra(
          extra,
          options.authorizationEvidence,
          { serverUrl },
        )
        const x401Evidence = buildX401EvidenceFromExtra(extra, options.x401AuthorizationEvidence)
        const sidecarEvidence = [authorizationEvidence, x401Evidence].filter(
          (entry): entry is CapturedMcpOAuthEvidence | CapturedX401Evidence => entry !== undefined,
        )
        if (sidecarEvidence.length > 0) sidecar.authorizationEvidence = sidecarEvidence
        return sidecar
      }

      // Pre-call signing branch: only when host opted in via preCallTransform.
      // Signs the record BEFORE forwarding so the host can embed the
      // receipt_id into the upstream args (cross-tool causal embedding).
      // Errors here degrade silently to the standard post-call path.
      let preBuilt: BuiltRecord | undefined
      let preCallArgs: Record<string, unknown> | undefined
      if (options.preCallTransform && !destroyed) {
        try {
          await publicKeyReady
          const pairedVerifiableMode =
            options.evidenceMode === 'verifiable-action' && options.disclosure === undefined
          const built = await buildSignedRecord(
            request,
            undefined,
            undefined,
            pairedVerifiableMode && transactionTools.has(requestToolName)
              ? EVENT_TYPE_TOOL_CALL_URI
              : undefined,
          )
          const args = (requestParams.arguments as Record<string, unknown> | undefined) ?? {}
          preCallArgs = structuredClone(args)
          const receiptId = encodeToken(built.signed)
          const transformed = options.preCallTransform({
            toolName: requestToolName,
            args,
            receiptId,
            recordHash: `sha256:${built.recordHashHex}`,
            contextId: built.contextId,
          })
          if (transformed && transformed !== args) {
            requestParams.arguments = transformed
          }
          preBuilt = built
          if (pairedVerifiableMode) {
            // The upstream is about to receive this exact receipt. Commit the
            // request before execution so failures cannot leave an externally
            // visible receipt pointing at an omitted record.
            commitRecord(built, undefined, buildSidecar(undefined, 'request', preCallArgs))
          }
        } catch (err) {
          // §5.8: pre-call signing must never block the tool call. Drop the
          // pre-built record (if any) and fall through to the standard path.
          console.warn('atrib: preCallTransform pre-sign failed, falling back to post-call', err)
          preBuilt = undefined
        }
      }

      // Call the upstream handler.
      // In paired verifiable mode, commit a terminal failure outcome before
      // preserving the upstream exception. The signed result_hash commits to
      // the bounded failure envelope; raw detail stays in the local sidecar.
      let result: unknown
      try {
        result = await handler(request, extra)
      } catch (error) {
        if (
          preBuilt !== undefined &&
          options.evidenceMode === 'verifiable-action' &&
          options.disclosure === undefined &&
          !destroyed
        ) {
          try {
            const failureResult: Record<string, unknown> = {
              isError: true,
              error: {
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
              },
            }
            await publicKeyReady
            const failureOutcome = await buildSignedRecord(
              request,
              failureResult,
              preBuilt.recordHashHex,
            )
            commitRecord(failureOutcome, undefined, buildSidecar(failureResult, 'outcome'))
          } catch (attributionError) {
            console.warn(
              'atrib: failed to sign terminal outcome for thrown tool call',
              attributionError,
            )
          }
        }
        throw error
      }

      try {
        // §5.6.3: After destroy(), skip attribution entirely.
        if (destroyed) {
          return result
        }

        const pairedVerifiableMode =
          preBuilt !== undefined &&
          options.evidenceMode === 'verifiable-action' &&
          options.disclosure === undefined
        const resultIsObject =
          result !== null && typeof result === 'object' && !Array.isArray(result)
        const resultObj: Record<string, unknown> = resultIsObject
          ? (result as Record<string, unknown>)
          : {
              isError: true,
              error: {
                name: 'InvalidToolResult',
                message: 'Tool handler returned a non-object result',
              },
            }
        // Minimal mode preserves §5.3.3: failed calls do not emit. Paired
        // verifiable mode already committed the request before execution and
        // therefore must commit a terminal error outcome as well.
        if ((resultObj.isError === true || !resultIsObject) && !pairedVerifiableMode) {
          return result
        }

        // Construct the pre-sign sidecar for onRecord observers. Captures
        // toolName + raw args + raw result so a richer local mirror can
        // surface semantic context alongside the signed bytes. Public log
        // submission below is unchanged, it only sees `built.signed`.
        const params = requestParams
        const sidecar = buildSidecar(resultObj)

        let built: BuiltRecord
        if (pairedVerifiableMode) {
          // The receipt-bearing request record cannot commit to a result that
          // does not exist yet. Emit a second result-bearing record, linked by
          // both chain_root and informed_by to the exact request record.
          // The request was committed before execution, so only the terminal
          // outcome is committed here.
          await publicKeyReady
          built = await buildSignedRecord(request, resultObj, preBuilt!.recordHashHex)
          commitRecord(built, resultIsObject ? resultObj : undefined, {
            ...sidecar,
            actionPhase: 'outcome',
          })
        } else {
          // Reuse the pre-built record from the preCallTransform branch when
          // present; otherwise build and sign on the standard post-call path.
          built =
            preBuilt ??
            (await (async () => {
              await publicKeyReady
              return buildSignedRecord(request, resultObj)
            })())
          commitRecord(built, resultObj, sidecar)
        }

        // D141 / §1.5.4.1: opt-in dev.atrib/attribution receipt, gated on the
        // client having declared the extension on THIS request. Runs after
        // commitRecord so the legacy outbound keys are already in place;
        // applyAttributionReceipt is §5.8-safe (never throws, never mutates
        // the result on failure) and reports log_submission as a queue
        // status — submission itself stays non-blocking per §5.3.5.
        if (options.extensionAttribution === true && resultIsObject) {
          applyAttributionReceipt(resultObj, params._meta, built.signed, {
            logSubmission: options.logSubmission === 'disabled' ? 'disabled' : 'queued',
          })
        }

        return result
      } catch (err) {
        // §5.8: Degradation contract. catch attribution errors, return
        // the already-computed result unchanged. Never re-invoke handler.
        console.warn('atrib: middleware error, passing through', err)
        return result
      }
    }
  }

  // Override setRequestHandler to intercept any FUTURE tools/call registration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(underlyingServer as any).setRequestHandler = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any,
    handler: (request: Record<string, unknown>, extra: unknown) => Promise<unknown>,
  ) => {
    if (!isToolsCallSchema(schema)) {
      return origSetHandler(schema, handler)
    }
    return origSetHandler(schema, makeWrappedHandler(handler))
  }

  // Retroactively wrap any ALREADY-registered tools/call handler. The
  // underlying Server keeps handlers in `_requestHandlers: Map<string, Fn>`
  // keyed by method name. If the user called .tool() before atrib(), the
  // dispatcher is already sitting in that map; rewrite it in place.
  const handlerMap = (underlyingServer as { _requestHandlers?: Map<string, unknown> })
    ._requestHandlers
  if (handlerMap instanceof Map) {
    const existing = handlerMap.get('tools/call') as
      ((request: Record<string, unknown>, extra: unknown) => Promise<unknown>) | undefined
    if (typeof existing === 'function') {
      handlerMap.set('tools/call', makeWrappedHandler(existing))
    }
  }

  atribServer.flush = async () => {
    while (pendingLocalSubstrateCommits.length > 0) {
      const inFlight = pendingLocalSubstrateCommits.splice(0)
      await Promise.allSettled(inFlight)
    }
    await queue.flush()
  }
  atribServer.getProof = (hash: string) => queue.getProof(hash)

  // §5.6.3: Zero the private key and mark as destroyed. After this call,
  // the wrapped handler skips attribution and passes tool results through
  // unmodified. Should be called on graceful shutdown.
  atribServer.destroy = () => {
    if (!destroyed) {
      zeroize(privateKey)
      destroyed = true
    }
  }

  // §5.3.6: Expose the policy document if provided.
  // Accessible via atribServer.policy for programmatic use.
  // For HTTP transports, the caller should serve this at /.well-known/atrib-policy.json.
  // For MCP stdio transports, the policy is available via this property.
  Object.defineProperty(atribServer, 'policy', {
    value: options.policy ?? null,
    writable: false,
  })

  return atribServer
}

/**
 * Detect whether a schema passed to `Server.setRequestHandler(schema, handler)`
 * represents the `tools/call` request method.
 *
 * The MCP TypeScript SDK has used several shapes for this over its history:
 *
 *   - SDK 1.x:                   Zod object schema where `schema.shape.method`
 *                                is `z.literal('tools/call')` whose `.value`
 *                                exposes the literal string. We detect by
 *                                inspecting `schema.shape.method.value`.
 *   - SDK 1.x (deeper Zod):     Some Zod versions place the literal value at
 *                                `schema.shape.method._def.value`. We probe
 *                                that path as a fallback.
 *   - SDK v2 migration:         The migration docs at
 *                                github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration.md
 *                                hint at a string-based form
 *                                `setRequestHandler('tools/call', handler)`.
 *                                We accept that too so the patch survives the
 *                                migration without code change.
 *   - Wrapped Zod schemas:       Some users pre-parse the schema before passing
 *                                it; we also accept `schema.method` directly.
 *
 * If none of these match, we treat the schema as "not tools/call" and pass
 * the registration through unchanged. The regression test in
 * `middleware-sdk-shape.test.ts` ensures this stays in sync with the real
 * `@modelcontextprotocol/sdk` package we depend on.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isToolsCallSchema(schema: any): boolean {
  if (schema == null) return false

  // SDK v2 migration: string-based method name
  if (typeof schema === 'string') {
    return schema === 'tools/call'
  }

  // SDK 1.x Zod literal: schema.shape.method.value === 'tools/call'
  if (schema.shape?.method?.value === 'tools/call') return true

  // Some Zod versions wrap the literal value in _def
  if (schema.shape?.method?._def?.value === 'tools/call') return true

  // Pre-parsed schema with the method exposed at the top level
  if (schema.method === 'tools/call') return true

  return false
}
