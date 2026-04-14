/**
 * atrib + Cloudflare Agents. Surface 1: McpAgent server-side instrumentation
 *
 * This is a Cloudflare Worker that exposes an MCP server using Cloudflare's
 * `agents/mcp` package. Each MCP session gets its own Durable Object instance
 * (a `WeatherMcp` here) and atrib middleware is applied to that instance's
 * `this.server` in `init()`. Every successful tools/call going through that DO
 * emits a signed attribution record.
 *
 * Deploy with:
 *   wrangler deploy
 *
 * Required wrangler.toml bindings:
 *   - Durable Object class binding for `WeatherMcp`
 *   - Secrets: ATRIB_PRIVATE_KEY, ATRIB_LOG_ENDPOINT
 *
 * NOTE: This file imports from `agents/mcp`, `@modelcontextprotocol/sdk`, and
 * `zod`, none of which are dependencies of @atrib/integration. To run this
 * example, copy it to a Worker project and install:
 *
 *   pnpm add agents @modelcontextprotocol/sdk zod @atrib/mcp
 *
 * The integration package's tsconfig excludes `examples/` from compilation
 * for exactly this reason. the examples typecheck against user-installed
 * versions, not against our test build.
 */

import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { atrib } from '@atrib/mcp'
import { z } from 'zod'

interface Env {
  ATRIB_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT: string
}

export class WeatherMcp extends McpAgent<Env> {
  // `this.server` is a real McpServer from @modelcontextprotocol/sdk.
  // the same class @atrib/mcp's atrib() middleware wraps.
  server = new McpServer({ name: 'weather', version: '1.0.0' })

  async init() {
    // 1. Register tools as you normally would for an McpAgent.
    this.server.registerTool(
      'get_temperature',
      {
        description: 'Get the current temperature for a location',
        inputSchema: {
          latitude: z.number().describe('Latitude coordinate'),
          longitude: z.number().describe('Longitude coordinate'),
        },
      },
      async ({ latitude, longitude }) => {
        const r = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&temperature_unit=fahrenheit`,
        )
        const data = (await r.json()) as {
          current: { temperature_2m: number }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Temperature: ${data.current.temperature_2m}°F`,
            },
          ],
        }
      },
    )

    // 2. ★ ATRIB ★
    // Apply attribution middleware to the in-process McpServer. This patches
    // the dispatch path so every successful tools/call emits a signed record.
    // The middleware is safe to call AFTER registerTool. see the retroactive
    // wrap logic in @atrib/mcp middleware.ts (it rewrites an
    // already-installed dispatcher in place).
    atrib(this.server, {
      creatorKey: this.env.ATRIB_PRIVATE_KEY,
      serverUrl: 'https://your-worker.workers.dev/mcp',
      logEndpoint: this.env.ATRIB_LOG_ENDPOINT,
    })
  }
}

// Export the Worker handler. McpAgent.serve handles the HTTP→DO routing.
export default WeatherMcp.serve('/mcp', { binding: 'WeatherMcp' })
