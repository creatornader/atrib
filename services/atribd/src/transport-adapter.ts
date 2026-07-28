// SPDX-License-Identifier: Apache-2.0

/**
 * Transport adapter boundary (P046).
 *
 * The MCP 2026-07-28 spec removes the `initialize`/`initialized` handshake
 * and the `Mcp-Session-Id` header from Streamable HTTP. The Tier-1
 * TypeScript SDK gate for that transport binds the transport binding, not
 * the daemon core, so the daemon isolates "turn one self-describing HTTP
 * request into MCP server handling" behind this interface. When the SDK
 * ships stateless-transport support, only the adapter internals swap.
 *
 * The native adapter uses the stable v2 TypeScript SDK's modern HTTP
 * handler. It serves 2026-07-28 requests as single self-describing
 * exchanges and retains a stateless 2025-era fallback for clients that
 * have not upgraded yet.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import {
  createMcpHandler,
  isLegacyRequest,
  type Server as ModernServer,
} from '@modelcontextprotocol/server'
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node'

/** The highest protocol revision served by the v2 per-request HTTP handler. */
export const MODERN_MCP_PROTOCOL_VERSION = '2026-07-28'

export interface AtribdTransportAdapter {
  /** Adapter implementation name, surfaced in the health report. */
  readonly name: string
  /** Highest MCP protocol version the adapter speaks. */
  readonly protocolVersion: string
  /**
   * Handle one self-describing HTTP request. The caller has already parsed
   * and validated the JSON body (size cap, SEP-2243 routing headers); the
   * adapter owns JSON-RPC dispatch and the response.
   */
  handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody: unknown): Promise<void>
}

export interface SessionSdkStatelessAdapterOptions {
  /**
   * Factory for a per-request MCP server wired to the shared backend.
   * Creating a server per request is what makes any request able to land
   * on any instance: no transport state survives the response.
   */
  serverFactory: () => Server
}

/** Options for the native 2026-07-28 HTTP adapter. */
export interface ModernSdkStatelessAdapterOptions {
  /**
   * The v2 server factory is invoked for each request. The v2 handler keeps
   * the 2026-07-28 exchange stateless and applies its own stateless legacy
   * fallback for 2025-era clients.
   */
  serverFactory: () => ModernServer
  /** Existing v1 server factory for 2025-era clients during the compatibility window. */
  legacyServerFactory: () => Server
}

/**
 * Serve the current MCP wire protocol with a dual-era stateless endpoint.
 *
 * `createMcpHandler` owns modern protocol validation, discovery, header
 * handling, and legacy fallback. The Node adapter preserves the existing
 * plain-node HTTP host without reimplementing Fetch request conversion.
 */
export function createModernSdkStatelessAdapter(
  options: ModernSdkStatelessAdapterOptions,
): AtribdTransportAdapter {
  const handler = createMcpHandler(options.serverFactory, {
    // The host routes 2025 traffic to the existing v1 adapter. Keeping the
    // paths separate preserves its JSON-only response behavior for deployed
    // legacy clients while v2 owns the modern wire protocol.
    legacy: 'reject',
  })
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => {
      try {
        process.stderr.write(`atribd: MCP transport error: ${error.message}\n`)
      } catch {
        // Transport diagnostics must not affect a primary MCP response.
      }
    },
  })
  const legacyAdapter = createSessionSdkStatelessAdapter({
    serverFactory: options.legacyServerFactory,
  })

  return {
    name: 'v2-dual-era-per-request',
    protocolVersion: MODERN_MCP_PROTOCOL_VERSION,
    handleRequest: async (req, res, parsedBody) => {
      const webRequest = await toWebRequest(req, parsedBody)
      if (await isLegacyRequest(webRequest)) {
        return legacyAdapter.handleRequest(req, res, parsedBody)
      }
      return nodeHandler(req, res, parsedBody)
    },
  }
}

export function createSessionSdkStatelessAdapter(
  options: SessionSdkStatelessAdapterOptions,
): AtribdTransportAdapter {
  return {
    name: 'session-sdk-per-request',
    protocolVersion: LATEST_PROTOCOL_VERSION,
    handleRequest: async (req, res, parsedBody) => {
      const server = options.serverFactory()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      const cleanup = () => {
        void Promise.allSettled([transport.close(), server.close()])
      }
      res.once('close', cleanup)
      try {
        await server.connect(transport)
        await transport.handleRequest(req, res, parsedBody)
      } finally {
        res.removeListener('close', cleanup)
        cleanup()
      }
    },
  }
}
