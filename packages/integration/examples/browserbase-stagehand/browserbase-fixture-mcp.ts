// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

type SessionState = {
  started: boolean
  currentUrl: string | null
  observedSelector: string | null
  extracted: boolean
}

const PRIVATE_SESSION_ID = 'bb_session_private_20260623'
const PRIVATE_REPLAY_URL = 'https://browserbase.example.invalid/sessions/private-replay-20260623'
const PRIVATE_SELECTOR = '#private-checkout-control'
const PRIVATE_FORM_VALUE = 'private browserbase note'
const PRIVATE_PAGE_SNAPSHOT = '<html><body><button id="private-checkout-control">Ship</button></body></html>'
const PRIVATE_EXTRACTED_TEXT = 'Internal quote: private browserbase note. Account tier: confidential.'

const state: SessionState = {
  started: false,
  currentUrl: null,
  observedSelector: null,
  extracted: false,
}

function textJson(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function toolSchema(name: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    name,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  }
}

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'browserbase-stagehand-fixture', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // The Browserbase MCP server exposes these six hosted tools. This fixture
  // keeps the same proof surface while replacing the cloud browser with
  // deterministic private payloads for local packet generation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const underlying = (server as any).server

  const tools = [
    toolSchema('start', {}),
    toolSchema('navigate', { url: { type: 'string' } }, ['url']),
    toolSchema('observe', { instruction: { type: 'string' } }, ['instruction']),
    toolSchema('act', { action: { type: 'string' } }, ['action']),
    toolSchema('extract', { instruction: { type: 'string' } }),
    toolSchema('end', {}),
  ]

  underlying.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const args = req.params.arguments ?? {}

      if (req.params.name === 'start') {
        state.started = true
        return textJson({
          status: 'started',
          session_id: PRIVATE_SESSION_ID,
          replay_url: PRIVATE_REPLAY_URL,
          stagehand_environment: 'fixture',
        })
      }

      if (!state.started) {
        return textJson({ error: 'session_not_started' })
      }

      if (req.params.name === 'navigate') {
        if (typeof args.url !== 'string') return textJson({ error: 'url is required' })
        state.currentUrl = args.url
        return textJson({
          status: 'navigated',
          url: args.url,
          title: 'Vendor quote fixture',
          page_snapshot: PRIVATE_PAGE_SNAPSHOT,
        })
      }

      if (req.params.name === 'observe') {
        const instruction = typeof args.instruction === 'string' ? args.instruction : ''
        state.observedSelector = PRIVATE_SELECTOR
        return textJson({
          status: 'observed',
          instruction,
          observations: [
            {
              description: 'Submit quote button',
              selector: PRIVATE_SELECTOR,
              confidence: 0.98,
            },
          ],
          page_snapshot: PRIVATE_PAGE_SNAPSHOT,
        })
      }

      if (req.params.name === 'act') {
        const action = typeof args.action === 'string' ? args.action : ''
        return textJson({
          status: 'acted',
          action,
          selector: state.observedSelector ?? PRIVATE_SELECTOR,
          form_value: PRIVATE_FORM_VALUE,
          confirmation_ref: 'quote-submit-fixture',
        })
      }

      if (req.params.name === 'extract') {
        state.extracted = true
        return textJson({
          status: 'extracted',
          instruction: typeof args.instruction === 'string' ? args.instruction : 'default',
          data: {
            confirmation_id: 'browserbase-stagehand-proof-001',
            vendor: 'Fixture Vendor',
            page_text: PRIVATE_EXTRACTED_TEXT,
          },
        })
      }

      if (req.params.name === 'end') {
        const wasExtracted = state.extracted
        state.started = false
        return textJson({
          status: 'ended',
          session_id: PRIVATE_SESSION_ID,
          replay_url: PRIVATE_REPLAY_URL,
          extracted: wasExtracted,
        })
      }

      return {
        isError: true,
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
      }
    },
  )

  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
