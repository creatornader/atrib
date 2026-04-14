/**
 * Atrib + Cloudflare Agents — Surface 2: Agent client-side instrumentation
 *
 * This is a Cloudflare Worker that runs an Agent (or AIChatAgent) which
 * connects out to one or more upstream MCP servers via this.addMcpServer().
 * Atrib's `attributeCloudflareAgentMcp` helper wraps each connection's
 * underlying @modelcontextprotocol/sdk Client so subsequent tool calls flow
 * through the interceptor's onBeforeToolCall / onAfterToolResponse lifecycle.
 *
 * The wrap targets `agent.mcp.mcpConnections[name].client` directly. Verified
 * against agents@0.9.0 dist/client-BwgM3cRz.js:1444 — MCPClientManager.callTool
 * delegates straight to mcpConnections[serverId].client.callTool(...).
 *
 * Deploy with:
 *   wrangler deploy
 *
 * Required wrangler.toml bindings:
 *   - Durable Object class binding for `WeatherChatAgent`
 *   - Secrets: ATRIB_PRIVATE_KEY, ATRIB_LOG_ENDPOINT
 *
 * NOTE: This file imports from `agents`, which is not a dependency of
 * @atrib/integration. Copy to a Worker project and install:
 *
 *   pnpm add agents @atrib/agent @modelcontextprotocol/sdk
 */

import { Agent } from 'agents'
import { atrib, attributeCloudflareAgentMcp } from '@atrib/agent'

interface Env {
  ATRIB_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT: string
}

export class WeatherChatAgent extends Agent<Env> {
  // Construct the Atrib interceptor once per agent instance. This handles
  // session lifecycle, policy negotiation, W3C trace context propagation,
  // and Path 1/2 transaction detection.
  interceptor = atrib({
    creatorKey: this.env.ATRIB_PRIVATE_KEY,
    merchantDomain: 'https://your-merchant.example.com',
    serverUrls: ['https://weather-mcp.example.com'],
    logEndpoint: this.env.ATRIB_LOG_ENDPOINT,
  })

  async onStart() {
    // 1. Register your upstream MCP servers as you normally would.
    //    Workers runtime: only HTTP transports work — no stdio, no child
    //    processes.
    await this.addMcpServer('weather', 'https://weather-mcp.example.com/mcp', {
      transport: { type: 'streamable-http' },
    })

    // 2. ★ ATRIB ★
    // Wrap every connected MCP client. After this call, every tool invoked
    // via this.mcp.getAITools() goes through the interceptor.
    const wrappedCount = attributeCloudflareAgentMcp(this, {
      interceptor: this.interceptor,
    })
    console.log(`atrib: wrapped ${wrappedCount} MCP connection(s)`)
  }

  // If you call addMcpServer in connection handlers (per-user MCP servers,
  // OAuth-completing-late, etc.), call attributeCloudflareAgentMcp again.
  // It's idempotent — already-wrapped clients are skipped.
  async onConnect() {
    attributeCloudflareAgentMcp(this, { interceptor: this.interceptor })
  }
}

// Bare Worker handler — your real app would route to the agent here. The
// interesting code lives in the agent class above.
export default {
  async fetch(_request: Request, _env: Env) {
    return new Response('chat agent — see WeatherChatAgent class', {
      status: 200,
    })
  },
}
