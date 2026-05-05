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
import { genesisChainRoot } from './chain-root.js'
import { readInboundContext, writeOutboundContext, parseBaggageAtribSession } from './context.js'
import { signRecord, getPublicKey } from './signing.js'
import { hexEncode, sha256 } from './hash.js'
import { canonicalRecord } from './canon.js'
import canonicalize from 'canonicalize'
import { encodeToken } from './token.js'
import { createSubmissionQueue } from './submission.js'
import { zeroize } from './zeroize.js'
import {
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
} from './types.js'
import type { AtribRecord } from './types.js'
import type { SubmissionQueue, ProofBundle } from './submission.js'

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
export type PreCallTransform = (
  ctx: PreCallTransformContext,
) => Record<string, unknown> | undefined

/** Options for the atrib() middleware (§5.3.1). */
export interface AtribOptions {
  /** Base64url-encoded Ed25519 private key (32 bytes). Required. */
  creatorKey?: string
  /** URL of the Merkle log submission endpoint. */
  logEndpoint?: string
  /** Inline attribution policy document (§4.2). */
  policy?: Record<string, unknown>
  /** Canonical URL of this MCP server for content_id derivation. */
  serverUrl?: string
  /** Tool names that complete commerce transactions (§5.4.5 Path 1). */
  transactionTools?: string[]
  /**
   * Observer invoked once per signed record AFTER signing and BEFORE log
   * submission. Lets the host persist or audit the record locally — without
   * this hook the original signed JSON is unrecoverable (the log stores only
   * commitments). Errors thrown from the observer are caught and logged; they
   * do not block submission or affect the tool response (§5.8).
   *
   * Use cases: dogfood verification (replay verifyRecord against creator_key),
   * local audit trail, debugging "what exactly did we sign?".
   */
  onRecord?: (record: AtribRecord) => void | Promise<void>
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
   * semantic — the agent observed every prior call's result before making
   * the next one.
   *
   * Hosts that wrap atrib over an upstream MCP server typically expose this via an env var (e.g. `ATRIB_AUTO_CHAIN`).
   */
  autoChain?: boolean
  /**
   * Seed records used to populate the in-memory `lastRecordHashByContext`
   * map on startup. Without this, autoChain breaks across process restarts:
   * the first call after a wrapper restart becomes a fresh genesis even
   * though prior records exist. Pass the on-disk record mirror's most-recent
   * record per context_id (or just all records — the middleware will pick
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
   * the field. The host is responsible for accuracy — informed_by is a
   * provenance claim, not a heuristic.
   */
  informedBy?: (params: Record<string, unknown>) => string[] | undefined
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
   *
   * Note on result_hash / result_salt: the §8.3 result-side commitment
   * cannot be populated by this middleware path because signing happens
   * BEFORE the upstream handler returns (to support preCallTransform).
   * A separate post-call signing path is the next ADR. Until then,
   * `disclosure.result` is intentionally NOT a field here.
   */
  disclosure?: {
    tool_name?: 'omit' | 'verbatim' | 'hashed'
    args?: 'omit' | 'plain-sha256' | 'salted-sha256'
  }
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
  const queue: SubmissionQueue = createSubmissionQueue(options.logEndpoint, {
    ...(options.maxQueueDepth !== undefined ? { maxQueueDepth: options.maxQueueDepth } : {}),
  })

  // autoChain bookkeeping (process-lifetime, opt-in via options.autoChain).
  // Stable context_id for sessions where the caller never sets traceparent;
  // and per-context_id last-signed-record-hash for chain synthesis.
  const autoChain = options.autoChain === true
  let stableContextId: string | undefined
  const lastRecordHashByContext = new Map<string, string>()

  // Seed lastRecordHashByContext from the caller-provided record set so
  // autoChain survives process restarts. For each context_id, find the
  // most-recent record (by timestamp) and store its record_hash. The next
  // call in that context_id will chain to it instead of starting genesis.
  // Tie-break on equal timestamps by iteration order (later seed entries
  // win): on fast machines, two records signed in the same millisecond
  // get equal Date.now() values, and a strict `>` would retain the OLDER
  // one — which then incorrectly chains to it. JSONL mirrors are appended
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
    if (newestByContext.size > 0) {
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

  // Derive the public key once at init (async, cached).
  let publicKeyB64: string | undefined
  const publicKeyReady = getPublicKey(privateKey).then((pk) => {
    publicKeyB64 = base64urlEncode(pk)
  })

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
    | { setRequestHandler: unknown }
    | undefined

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
    /** Hex-encoded record_hash WITHOUT "sha256:" prefix. */
    recordHashHex: string
    contextId: string
    sessionToken: string | undefined
    inboundTraceparent: unknown
    eventType: string
  }

  /**
   * Build + sign an attribution record from a tools/call request. Pure
   * function over (request, closure-scoped key + options) — no side effects.
   * autoChain bookkeeping, onRecord, writeOutboundContext, and queue.submit
   * are intentionally NOT performed here; the caller decides when to commit
   * those (post-success only).
   */
  const buildSignedRecord = async (
    request: Record<string, unknown>,
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
      if (traceId && /^[0-9a-f]{32}$/.test(traceId)) {
        contextId = traceId
      }
    }
    if (!contextId) {
      if (autoChain) {
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

    // Determine chain_root.
    // 1. Prefer explicit inbound atrib propagation (the spec-canonical path).
    // 2. With autoChain on, fall back to the most recent record this
    //    middleware instance signed for this context_id. This synthesizes
    //    chains for hosts that don't propagate atrib's outbound token.
    // 3. Otherwise, genesis.
    let chainRootValue: string
    if (inbound) {
      chainRootValue = `sha256:${hexEncode(inbound.recordHash)}`
    } else if (autoChain && lastRecordHashByContext.has(contextId)) {
      chainRootValue = `sha256:${lastRecordHashByContext.get(contextId)!}`
    } else {
      chainRootValue = genesisChainRoot(contextId)
    }

    // Determine event_type URI (spec 1.2.4)
    const toolName = (params.name as string) ?? ''
    const eventType = transactionTools.has(toolName)
      ? EVENT_TYPE_TRANSACTION_URI
      : EVENT_TYPE_TOOL_CALL_URI

    // Construct the record
    const contentId = computeContentId(serverUrl, toolName)
    // informedBy callback (D041 / §1.2.7): host declares which prior
    // records influenced this call. Wrapped in try/catch so a faulty
    // callback never blocks signing — per §5.8 attribution must degrade
    // silently. Empty/undefined result omits the field entirely
    // (presence affects the JCS canonical form, so omission is normal).
    let informedByList: string[] | undefined
    if (options.informedBy) {
      try {
        const informed = options.informedBy(params)
        if (Array.isArray(informed) && informed.length > 0) informedByList = informed
      } catch (e) {
        console.warn('atrib: informedBy callback threw', e)
      }
    }
    // §8 / D061 disclosure dials. Each defaults to 'omit' (preserves §8.1
    // default posture). Errors during disclosure synthesis fall through to
    // omission rather than throwing — degradation contract per §5.8.
    const disclosure = options.disclosure ?? {}
    const toolNameDisclosure = disclosure.tool_name ?? 'omit'
    const argsDisclosure = disclosure.args ?? 'omit'

    let toolNameField: string | undefined
    if (toolNameDisclosure === 'verbatim') {
      toolNameField = toolName
    } else if (toolNameDisclosure === 'hashed') {
      toolNameField = `sha256:${hexEncode(sha256(new TextEncoder().encode(toolName)))}`
    }

    let argsHashField: string | undefined
    let argsSaltField: string | undefined
    if (argsDisclosure !== 'omit') {
      try {
        const argsValue = (params.arguments as Record<string, unknown> | undefined) ?? {}
        const argsJcs = canonicalize(argsValue)
        if (typeof argsJcs === 'string') {
          const argsBytes = new TextEncoder().encode(argsJcs)
          if (argsDisclosure === 'plain-sha256') {
            argsHashField = `sha256:${hexEncode(sha256(argsBytes))}`
          } else {
            // salted-sha256 per §8.3: H = SHA-256(salt ‖ canonical_bytes)
            const salt = new Uint8Array(16)
            crypto.getRandomValues(salt)
            const combined = new Uint8Array(salt.length + argsBytes.length)
            combined.set(salt, 0)
            combined.set(argsBytes, salt.length)
            argsHashField = `sha256:${hexEncode(sha256(combined))}`
            argsSaltField = base64urlEncode(salt)
          }
        }
      } catch (e) {
        console.warn('atrib: args disclosure synthesis failed, omitting', e)
      }
    }

    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: contentId,
      creator_key: publicKeyB64!,
      chain_root: chainRootValue,
      event_type: eventType,
      context_id: contextId,
      timestamp: Date.now(),
      signature: '',
      ...(argsHashField ? { args_hash: argsHashField } : {}),
      ...(argsSaltField ? { args_salt: argsSaltField } : {}),
      ...(informedByList ? { informed_by: informedByList } : {}),
      ...(sessionToken ? { session_token: sessionToken } : {}),
      ...(toolNameField !== undefined ? { tool_name: toolNameField } : {}),
    } as AtribRecord

    // §1.4.2: Sign the record
    const signed = await signRecord(record, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))

    return { signed, recordHashHex, contextId, sessionToken, inboundTraceparent, eventType }
  }

  /**
   * Commit a built record: run the onRecord observer, attach outbound
   * context to the result, queue for log submission, update autoChain
   * bookkeeping. Called only on successful tool calls (after the upstream
   * returned and isError is not true).
   */
  const commitRecord = (built: BuiltRecord, resultObj: Record<string, unknown>): void => {
    // autoChain bookkeeping: remember this record's hash so the next
    // call in the same context_id chains to it. Deferred to commit time so
    // failed/aborted calls don't poison the chain.
    if (autoChain) {
      lastRecordHashByContext.set(built.contextId, built.recordHashHex)
    }

    // Optional onRecord observer (post-sign, pre-submit). Errors are
    // swallowed per §5.8 — observation must never affect the tool call.
    if (options.onRecord) {
      try {
        const r = options.onRecord(built.signed)
        if (r && typeof (r as Promise<void>).then === 'function') {
          ;(r as Promise<void>).catch((e) =>
            console.warn('atrib: onRecord observer rejected', e),
          )
        }
      } catch (e) {
        console.warn('atrib: onRecord observer threw', e)
      }
    }

    // §5.3.4: Write outbound context (includes traceparent, baggage, X-Atrib-Chain)
    writeOutboundContext(resultObj, built.signed, {
      traceparent:
        typeof built.inboundTraceparent === 'string' ? built.inboundTraceparent : undefined,
      sessionToken: built.sessionToken,
    })

    // 5.3.5: Non-blocking log submission. Transaction records (1.7 commerce hooks)
    // are admitted at high priority so they are not delayed behind tool_call backlog.
    const priority: 'high' | 'normal' =
      built.eventType === EVENT_TYPE_TRANSACTION_URI ? 'high' : 'normal'
    queue.submit(built.signed, priority)
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
      // Pre-call signing branch: only when host opted in via preCallTransform.
      // Signs the record BEFORE forwarding so the host can embed the
      // receipt_id into the upstream args (cross-tool causal embedding).
      // Errors here degrade silently to the standard post-call path.
      let preBuilt: BuiltRecord | undefined
      if (options.preCallTransform && !destroyed) {
        try {
          await publicKeyReady
          const built = await buildSignedRecord(request)
          const params = request.params as Record<string, unknown>
          const args =
            (params.arguments as Record<string, unknown> | undefined) ?? {}
          const receiptId = encodeToken(built.signed)
          const transformed = options.preCallTransform({
            toolName: (params.name as string) ?? '',
            args,
            receiptId,
            recordHash: `sha256:${built.recordHashHex}`,
            contextId: built.contextId,
          })
          if (transformed && transformed !== args) {
            params.arguments = transformed
          }
          preBuilt = built
        } catch (err) {
          // §5.8: pre-call signing must never block the tool call. Drop the
          // pre-built record (if any) and fall through to the standard path.
          console.warn('atrib: preCallTransform pre-sign failed, falling back to post-call', err)
          preBuilt = undefined
        }
      }

      // Call the upstream handler.
      // §5.8: If the handler itself throws, that's the tool's error. let it propagate.
      const result = await handler(request, extra)

      try {
        // §5.6.3: After destroy(), skip attribution entirely.
        if (destroyed) {
          return result
        }

        // §5.3.3: Only emit for successful calls (isError: false). On error,
        // the pre-built record (if any) is discarded — its receipt_id may
        // have been written into upstream args, but the row (or whatever the
        // upstream did) is not represented by a logged record.
        const resultObj = result as Record<string, unknown>
        if (resultObj.isError === true) {
          return result
        }

        // Reuse the pre-built record from the preCallTransform branch when
        // present; otherwise build + sign now (the standard post-call path).
        const built = preBuilt ?? (await (async () => {
          await publicKeyReady
          return buildSignedRecord(request)
        })())

        commitRecord(built, resultObj)

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
      | ((request: Record<string, unknown>, extra: unknown) => Promise<unknown>)
      | undefined
    if (typeof existing === 'function') {
      handlerMap.set('tools/call', makeWrappedHandler(existing))
    }
  }

  atribServer.flush = () => queue.flush()
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
