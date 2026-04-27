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
import { hexEncode } from './hash.js'
import { createSubmissionQueue } from './submission.js'
import { zeroize } from './zeroize.js'
import type { AtribRecord } from './types.js'
import type { SubmissionQueue, ProofBundle } from './submission.js'

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
  const queue: SubmissionQueue = createSubmissionQueue(options.logEndpoint)

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
      // Call the original handler FIRST, outside the try block for attribution.
      // §5.8: If the handler itself throws, that's the tool's error. let it propagate.
      const result = await handler(request, extra)

      try {
        // §5.6.3: After destroy(), skip attribution entirely.
        if (destroyed) {
          return result
        }

        await publicKeyReady

        // §5.3.3: Only emit for successful calls (isError: false)
        const resultObj = result as Record<string, unknown>
        if (resultObj.isError === true) {
          return result
        }

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
          const bytes = new Uint8Array(16)
          crypto.getRandomValues(bytes)
          contextId = hexEncode(bytes)
        }

        // session_token can come from inbound context or directly from baggage
        let sessionToken = inbound?.sessionToken
        if (!sessionToken && meta?.baggage && typeof meta.baggage === 'string') {
          sessionToken = parseBaggageAtribSession(meta.baggage)
        }

        // Forward traceparent to outbound _meta (§1.5.4)
        const inboundTraceparent = meta?.traceparent

        // Determine chain_root
        let chainRootValue: string
        if (inbound) {
          chainRootValue = `sha256:${hexEncode(inbound.recordHash)}`
        } else {
          chainRootValue = genesisChainRoot(contextId)
        }

        // Determine event_type
        const toolName = (params.name as string) ?? ''
        const eventType = transactionTools.has(toolName) ? 'transaction' : ('tool_call' as const)

        // Construct the record
        const contentId = computeContentId(serverUrl, toolName)
        const record: AtribRecord = {
          spec_version: 'atrib/1.0',
          content_id: contentId,
          creator_key: publicKeyB64!,
          chain_root: chainRootValue,
          event_type: eventType,
          context_id: contextId,
          timestamp: Date.now(),
          signature: '',
          ...(sessionToken ? { session_token: sessionToken } : {}),
        } as AtribRecord

        // §1.4.2: Sign the record
        const signed = await signRecord(record, privateKey)

        // Optional onRecord observer (post-sign, pre-submit). Errors are
        // swallowed per §5.8 — observation must never affect the tool call.
        if (options.onRecord) {
          try {
            const r = options.onRecord(signed)
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
        writeOutboundContext(resultObj, signed, {
          traceparent: typeof inboundTraceparent === 'string' ? inboundTraceparent : undefined,
          sessionToken,
        })

        // §5.3.5: Non-blocking log submission
        const priority = eventType === 'transaction' ? 'high' : ('normal' as const)
        queue.submit(signed, priority)

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
