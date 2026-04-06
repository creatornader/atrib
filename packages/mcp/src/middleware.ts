/**
 * @atrib/mcp middleware, the atrib() wrapper function (§5.3).
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
import type { AtribRecord } from './types.js'
import type { SubmissionQueue } from './submission.js'

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
}

/** Extended McpServer with atrib-specific methods. */
export interface AtribServer extends McpServer {
  /** Flush pending log submissions (for testing/shutdown). */
  flush(): Promise<void>
}

/**
 * Wrap an MCP server with Atrib attribution middleware (§5.3).
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
    return atribServer
  }

  const privateKey = base64urlDecode(options.creatorKey)
  if (privateKey.length !== 32) {
    console.warn('atrib: creatorKey must be 32 bytes, operating in pass-through mode')
    atribServer.flush = async () => {}
    return atribServer
  }

  const serverUrl = options.serverUrl ?? ''
  if (!serverUrl) {
    console.warn(
      'atrib: no serverUrl provided, content_id values will not uniquely identify this server. ' +
      'Set serverUrl explicitly, especially for stdio transport where no host header is available.',
    )
  }
  const transactionTools = new Set(options.transactionTools ?? [])
  const queue: SubmissionQueue = createSubmissionQueue(options.logEndpoint)

  // Derive the public key once at init (async, cached).
  let publicKeyB64: string | undefined
  const publicKeyReady = getPublicKey(privateKey).then(pk => {
    publicKeyB64 = base64urlEncode(pk)
  })

  // Intercept the Server's request handler for tools/call.
  // McpServer registers its handler when the first tool is registered via .tool().
  // We patch setRequestHandler on the underlying Server to wrap the tools/call handler.
  const underlyingServer = server.server

  // We need to intercept setRequestHandler to wrap the tools/call handler.
  // The MCP SDK uses complex Zod-based types internally, so we use `any` for
  // the interop boundary, we only inspect the schema to detect tools/call.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origSetHandler: any = underlyingServer.setRequestHandler.bind(underlyingServer)

  // Override setRequestHandler to intercept the CallToolRequest handler
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(underlyingServer as any).setRequestHandler = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schema: any,
    handler: (request: Record<string, unknown>, extra: unknown) => Promise<unknown>,
  ) => {
    // Detect CallToolRequest by checking the schema's method value
    const isCallTool = schema?.shape?.method?.value === 'tools/call'

    if (!isCallTool) {
      return origSetHandler(schema, handler)
    }

    // Wrap the tools/call handler with attribution logic
    const wrappedHandler = async (request: Record<string, unknown>, extra: unknown) => {
      // Call the original handler FIRST, outside the try block for attribution.
      // §5.8: If the handler itself throws, that's the tool's error, let it propagate.
      const result = await handler(request, extra)

      try {
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
        const eventType = transactionTools.has(toolName) ? 'transaction' : 'tool_call' as const

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

        // §5.3.4: Write outbound context (includes traceparent, baggage, X-Atrib-Chain)
        writeOutboundContext(resultObj, signed, {
          traceparent: typeof inboundTraceparent === 'string' ? inboundTraceparent : undefined,
          sessionToken,
        })

        // §5.3.5: Non-blocking log submission
        const priority = eventType === 'transaction' ? 'high' : 'normal' as const
        queue.submit(signed, priority)

        return result
      } catch (err) {
        // §5.8: Degradation contract, catch attribution errors, return
        // the already-computed result unchanged. Never re-invoke handler.
        console.warn('atrib: middleware error, passing through', err)
        return result
      }
    }

    return origSetHandler(schema, wrappedHandler)
  }

  atribServer.flush = () => queue.flush()

  return atribServer
}
