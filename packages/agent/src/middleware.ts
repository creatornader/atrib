// SPDX-License-Identifier: Apache-2.0

/**
 * @atrib/agent middleware. the atrib() wrapper for agents (§5.4).
 *
 * Wraps an agent or MCP client to automatically manage attribution
 * context across tool calls. Zero ongoing surface area.
 */

import {
  base64urlDecode,
  base64urlEncode,
  signRecord,
  getPublicKey,
  computeContentId,
  hexEncode,
  genesisChainRoot,
  createSubmissionQueue,
  type SubmissionQueue,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { createSession, buildOutboundMeta, accumulateInboundContext } from './session.js'
import type { SessionState } from './session.js'
import { detectTransaction } from './transaction.js'
import type { TransactionDetection } from './transaction.js'
import { initializeSessionPolicy } from './policy.js'
import type { SessionPolicyRecord } from './policy.js'

/** Options for the agent atrib() middleware (§5.4.1). */
export interface AgentAtribOptions {
  /** Base64url-encoded Ed25519 private key (32 bytes). Required. */
  creatorKey?: string | undefined
  /** Merchant domain for policy fetch at session init. */
  merchantDomain?: string | undefined
  /** Merkle log submission endpoint. */
  logEndpoint?: string | undefined
  /** Session token for cross-trace linking. Auto-generated if absent. */
  sessionToken?: string | undefined
  /** Server URLs for tools the agent will call (for policy fetch). */
  serverUrls?: string[] | undefined
}

/**
 * The interception surface for wrapping an agent or MCP client.
 * The agent middleware needs to intercept outbound tool calls and
 * inbound responses. This interface defines the minimum contract.
 */
export interface ToolCallInterceptor {
  /**
   * Called before a tool call is sent. Returns modified _meta to attach.
   * MUST be awaited. session initialization happens here on the first call.
   */
  onBeforeToolCall(
    toolName: string,
    meta: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  /**
   * Called after a tool response is received.
   * @param isError - if true, the response is an error and no attribution is recorded
   */
  onAfterToolResponse(
    toolName: string,
    response: unknown,
    responseMeta: Record<string, unknown> | undefined,
    options?: {
      headers?: Record<string, string | undefined>
      isError?: boolean
      /** The MCP server URL of the tool that was called (for heuristic content_id). */
      serverUrl?: string
    },
  ): void
  /** Get the session policy record for a context_id. */
  getSessionPolicyRecord(contextId?: string): SessionPolicyRecord | null
  /** Flush pending log submissions. */
  flush(): Promise<void>
}

/**
 * Create an atrib agent interceptor (§5.4).
 *
 * Returns a ToolCallInterceptor that manages attribution context.
 * The caller is responsible for integrating this with their MCP client
 * or agent framework by calling onBeforeToolCall/onAfterToolResponse
 * at the appropriate points.
 */
export function atrib(options: AgentAtribOptions = {}): ToolCallInterceptor {
  // §5.8: Pass-through mode if no creatorKey
  if (!options.creatorKey) {
    console.warn('atrib: no creatorKey provided, operating in pass-through mode')
    return createPassthrough()
  }

  const privateKey = base64urlDecode(options.creatorKey)
  if (privateKey.length !== 32) {
    console.warn('atrib: creatorKey must be 32 bytes, operating in pass-through mode')
    return createPassthrough()
  }

  const queue: SubmissionQueue = createSubmissionQueue(options.logEndpoint)

  // Derive public key at init
  let publicKeyB64: string | undefined
  const publicKeyReady = getPublicKey(privateKey).then((pk) => {
    publicKeyB64 = base64urlEncode(pk)
  })

  // Create session state
  const session = createSession({
    creatorKey: options.creatorKey,
    sessionToken: options.sessionToken,
  })

  // Session policy record (populated after init)
  let sessionPolicyRecord: SessionPolicyRecord | null = null
  let initPromise: Promise<void> | null = null
  const pendingEmissions: Promise<void>[] = []

  /**
   * Append a runtime warning to BOTH session.warnings and the session policy
   * record. §5.4.6: warnings must be observable through getSessionPolicyRecord().
   */
  function addRuntimeWarning(warning: string): void {
    session.warnings.push(warning)
    if (sessionPolicyRecord && !sessionPolicyRecord.warnings.includes(warning)) {
      sessionPolicyRecord.warnings.push(warning)
    }
  }

  /**
   * Run session initialization once. §5.4.2: MUST complete before
   * the first outbound tool call.
   */
  async function ensureInitialized(): Promise<void> {
    if (session.initialized) return

    if (!initPromise) {
      initPromise = (async () => {
        try {
          sessionPolicyRecord = await initializeSessionPolicy({
            contextId: session.contextId,
            merchantDomain: options.merchantDomain,
            serverUrls: options.serverUrls,
          })
          session.warnings.push(...sessionPolicyRecord.warnings)
          // §4.5.1 Step 4: embed policy record ID in baggage on subsequent calls
          session.policyRecordId = sessionPolicyRecord.record_id
        } catch (err) {
          console.warn('atrib: session initialization failed, using defaults', err)
          session.warnings.push('session initialization failed')
        }
        session.initialized = true
      })()
    }

    await initPromise
  }

  return {
    async onBeforeToolCall(
      _toolName: string,
      meta: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      try {
        // §5.4.2: Session init MUST complete before the first outbound tool call
        await ensureInitialized()

        // Build outbound _meta. passes existing so baggage/tracestate are appended,
        // not clobbered (§5.4.3 W3C semantics)
        const outbound = buildOutboundMeta(session, meta)

        // Merge with existing _meta
        return { ...meta, ...outbound }
      } catch (err) {
        console.warn('atrib: error in onBeforeToolCall, passing through', err)
        return meta
      }
    },

    onAfterToolResponse(
      toolName: string,
      response: unknown,
      responseMeta: Record<string, unknown> | undefined,
      callOptions?: {
        headers?: Record<string, string | undefined>
        isError?: boolean
        serverUrl?: string
      },
    ): void {
      // §5.7: tool_call_inbound trigger only fires when isError is false.
      // Check both the explicit option (set by adapters) and the response
      // body's own isError field (guards direct callers who omit options).
      if (callOptions?.isError === true) return
      if ((response as Record<string, unknown>)?.isError === true) return

      try {
        // §5.4.4: Accumulate inbound context
        const hasAtribToken = accumulateInboundContext(session, responseMeta)

        // §5.4.5: Transaction detection
        const detection = detectTransaction(toolName, response, callOptions?.headers)

        if (detection.detected) {
          // Path 1: Merchant has @atrib/mcp. token present in response
          if (hasAtribToken) {
            // Path 1: Skip emission, merchant already emitted transaction record.
            return
          }

          // Path 2: No attribution token. agent emits transaction record
          // §5.4.6: warnings are appended throughout the session. push to BOTH
          // session.warnings (for in-memory tracking) and sessionPolicyRecord.warnings
          // (so getSessionPolicyRecord() callers see them)
          addRuntimeWarning('transaction_emitted_by_agent')
          if (detection.protocol === 'heuristic') {
            addRuntimeWarning('transaction_detected_by_heuristic')
          }

          // Emit transaction record asynchronously
          const emission = emitTransactionRecord(
            toolName,
            detection,
            callOptions?.serverUrl,
            session,
            privateKey,
            publicKeyReady,
            () => publicKeyB64,
            queue,
          ).catch((err) => {
            console.warn('atrib: transaction emission failed', err)
          }).finally(() => {
            const idx = pendingEmissions.indexOf(emission)
            if (idx !== -1) pendingEmissions.splice(idx, 1)
          })
          pendingEmissions.push(emission)
        }
      } catch (err) {
        console.warn('atrib: error in onAfterToolResponse, continuing', err)
      }
    },

    getSessionPolicyRecord(_contextId?: string): SessionPolicyRecord | null {
      return sessionPolicyRecord
    },

    async flush(): Promise<void> {
      // Drain in a loop: emissions arriving during our await are caught
      // by the next iteration. Terminates when no new emissions appear.
      while (pendingEmissions.length > 0) {
        const snapshot = pendingEmissions.splice(0)
        await Promise.allSettled(snapshot)
      }
      await queue.flush()
      // Drain any emissions that submitted to the queue during queue.flush()
      while (pendingEmissions.length > 0) {
        const snapshot = pendingEmissions.splice(0)
        await Promise.allSettled(snapshot)
        await queue.flush()
      }
    },
  }
}

/**
 * Emit a transaction record for Path 2 agent-side detection (§5.4.5).
 * Derives content_id per protocol:
 * - ACP/UCP: checkout URL from response, tool_name = "checkout"
 * - x402/MPP: HTTP endpoint URL, tool_name = "checkout"
 * - Heuristic: MCP server URL of tool, actual tool_name
 */
async function emitTransactionRecord(
  toolName: string,
  detection: TransactionDetection,
  callServerUrl: string | undefined,
  session: SessionState,
  privateKey: Uint8Array,
  publicKeyReady: Promise<void>,
  publicKeyB64Getter: () => string | undefined,
  queue: SubmissionQueue,
): Promise<void> {
  await publicKeyReady
  const publicKeyB64 = publicKeyB64Getter()
  if (!publicKeyB64) {
    throw new Error('public key not ready')
  }

  // Derive content_id per protocol (§5.4.5)
  let contentIdServerUrl: string
  let contentIdToolName: string

  switch (detection.protocol) {
    case 'ACP':
    case 'UCP':
      contentIdServerUrl = detection.checkoutUrl ?? callServerUrl ?? ''
      contentIdToolName = 'checkout'
      break
    case 'x402':
    case 'MPP':
      // Use the HTTP endpoint URL that returned Payment-Receipt
      contentIdServerUrl = callServerUrl ?? ''
      contentIdToolName = 'checkout'
      break
    case 'AP2':
      contentIdServerUrl = callServerUrl ?? ''
      contentIdToolName = 'checkout'
      break
    case 'heuristic':
    default:
      // Heuristic: weakest case, use the MCP server URL of the tool that was called
      contentIdServerUrl = callServerUrl ?? ''
      contentIdToolName = toolName
      break
  }

  const contentId = computeContentId(contentIdServerUrl, contentIdToolName)

  // §1.2.3: chain_root for genesis records
  const chainRoot = session.latestContext
    ? `sha256:${hexEncode(session.latestContext.recordHash)}`
    : genesisChainRoot(session.contextId)

  const record: AtribRecord = {
    spec_version: 'atrib/1.0',
    content_id: contentId,
    creator_key: publicKeyB64,
    chain_root: chainRoot,
    event_type: 'transaction',
    context_id: session.contextId,
    timestamp: Date.now(),
    signature: '',
    session_token: session.sessionToken,
  } as AtribRecord

  const signed = await signRecord(record, privateKey)

  // Submit immediately. transaction records are the closing anchor
  queue.submit(signed, 'high')
}

/** Create a no-op pass-through interceptor. */
function createPassthrough(): ToolCallInterceptor {
  return {
    async onBeforeToolCall(_toolName: string, meta: Record<string, unknown>) {
      return meta
    },
    onAfterToolResponse() {},
    getSessionPolicyRecord() {
      return null
    },
    async flush() {},
  }
}
