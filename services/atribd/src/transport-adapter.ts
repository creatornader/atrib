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
 * The current implementation runs the session-era SDK in its documented
 * stateless mode: a fresh `Server` + `StreamableHTTPServerTransport` pair
 * per request, `sessionIdGenerator: undefined` (no session id issued, no
 * session validation, `Mcp-Session-Id` request headers ignored), and JSON
 * responses instead of SSE. A legacy `initialize` POST is answered with a
 * valid capabilities response and no session id.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'

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
