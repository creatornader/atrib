/**
 * Atrib + Claude Agent SDK, Case A: instrument in-process tools
 *
 * Your tools are defined in your own TypeScript with createSdkMcpServer().
 * Adding Atrib is one extra line: call atrib() on the server's .instance.
 *
 * Run with:
 *   ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
 *   ATRIB_LOG_ENDPOINT=https://your.log/submit \
 *   ANTHROPIC_API_KEY=sk-... \
 *   pnpm tsx case-a-in-process-tools.ts
 *
 * Or import this file from your own application; nothing here is example-only.
 *
 * NOTE: This file imports from @anthropic-ai/claude-agent-sdk, which is NOT a
 * dependency of @atrib/integration. To run, install it in a separate workspace
 * or temporarily add it to your local copy of this directory:
 *
 *   pnpm add @anthropic-ai/claude-agent-sdk zod
 *
 * The example is type-checked against the published @anthropic-ai/claude-agent-sdk
 * 0.2.92 type definitions; if those drift, the example may need updating.
 */

import { createSdkMcpServer, tool, query } from '@anthropic-ai/claude-agent-sdk'
import { atrib } from '@atrib/mcp'
import { z } from 'zod'

// 1. Define your tool the way you would for any Claude Agent SDK app.
const getTemperature = tool(
  'get_temperature',
  'Get the current temperature at a location',
  {
    latitude: z.number().describe('Latitude coordinate'),
    longitude: z.number().describe('Longitude coordinate'),
  },
  async (args) => {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m&temperature_unit=fahrenheit`,
    )
    const data = (await r.json()) as { current: { temperature_2m: number } }
    return {
      content: [
        { type: 'text', text: `Temperature: ${data.current.temperature_2m}°F` },
      ],
    }
  },
)

// 2. Wrap the tool in an in-process SDK MCP server (standard SDK API).
const weatherServer = createSdkMcpServer({
  name: 'weather',
  version: '1.0.0',
  tools: [getTemperature],
})

// 3. ★ ATRIB ★
//    weatherServer.instance is a real `McpServer` from @modelcontextprotocol/sdk.
//    Calling atrib() monkey-patches its setRequestHandler to wrap every
//    tools/call with the attribution lifecycle. Zero further changes needed.
const ATRIB_KEY = process.env.ATRIB_PRIVATE_KEY
if (!ATRIB_KEY) {
  console.warn(
    'ATRIB_PRIVATE_KEY not set, Atrib will operate in pass-through mode (no records emitted).',
  )
}

atrib(weatherServer.instance, {
  ...(ATRIB_KEY ? { creatorKey: ATRIB_KEY } : {}),
  serverUrl: 'https://example.com/weather',
  ...(process.env.ATRIB_LOG_ENDPOINT
    ? { logEndpoint: process.env.ATRIB_LOG_ENDPOINT }
    : {}),
})

// 4. Drive the agent. From Claude's perspective there is no Atrib involvement.
async function main() {
  for await (const message of query({
    prompt: "What's the temperature in San Francisco?",
    options: {
      mcpServers: { weather: weatherServer },
      allowedTools: ['mcp__weather__get_temperature'],
    },
  })) {
    if (message.type === 'result' && message.subtype === 'success') {
      console.log(message.result)
    }
  }
}

main().catch((err) => {
  console.error('agent failed:', err)
  process.exit(1)
})
