// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const PRIVATE_QUERY = 'private acquisition research query'
const PRIVATE_URL = 'https://example.invalid/private-firecrawl-source'
const PRIVATE_MARKDOWN = '# Private vendor page\n\nConfidential pricing: private firecrawl text.'
const PRIVATE_HTML = '<main><h1>Private vendor page</h1><p>Confidential pricing</p></main>'
const PRIVATE_EXTRACT = 'private firecrawl extracted account note'
const PRIVATE_CRAWL_JOB_ID = 'crawl_private_job_20260623'

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
    { name: 'firecrawl-web-ingestion-fixture', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // The Firecrawl MCP server exposes these tools over stdio. This local
  // fixture keeps the same names and private result classes while avoiding
  // network calls and API keys in default tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const underlying = (server as any).server

  const tools = [
    toolSchema(
      'firecrawl_search',
      {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      ['query'],
    ),
    toolSchema(
      'firecrawl_scrape',
      {
        url: { type: 'string' },
        formats: { type: 'array', items: { type: 'string' } },
      },
      ['url'],
    ),
    toolSchema(
      'firecrawl_extract',
      {
        urls: { type: 'array', items: { type: 'string' } },
        prompt: { type: 'string' },
        schema: { type: 'object' },
      },
      ['urls', 'prompt'],
    ),
    toolSchema(
      'firecrawl_crawl',
      {
        url: { type: 'string' },
        maxDepth: { type: 'number' },
        limit: { type: 'number' },
      },
      ['url'],
    ),
  ]

  underlying.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const args = req.params.arguments ?? {}

      if (req.params.name === 'firecrawl_search') {
        return textJson({
          status: 'success',
          query: typeof args.query === 'string' ? args.query : PRIVATE_QUERY,
          results: [
            {
              title: 'Private vendor page',
              url: PRIVATE_URL,
              description: PRIVATE_EXTRACT,
              markdown: PRIVATE_MARKDOWN,
            },
          ],
        })
      }

      if (req.params.name === 'firecrawl_scrape') {
        const url = typeof args.url === 'string' ? args.url : PRIVATE_URL
        return textJson({
          status: 'success',
          url,
          markdown: PRIVATE_MARKDOWN,
          html: PRIVATE_HTML,
          metadata: {
            source_url: url,
            title: 'Private vendor page',
          },
        })
      }

      if (req.params.name === 'firecrawl_extract') {
        return textJson({
          status: 'success',
          data: {
            company: 'Fixture Vendor',
            account_note: PRIVATE_EXTRACT,
            source_url: PRIVATE_URL,
          },
        })
      }

      if (req.params.name === 'firecrawl_crawl') {
        const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : 1
        const limit = typeof args.limit === 'number' ? args.limit : 1
        if (maxDepth > 1 || limit > 2) {
          return textJson({ error: 'crawl_cap_exceeded', maxDepth, limit })
        }
        return textJson({
          status: 'queued',
          job_id: PRIVATE_CRAWL_JOB_ID,
          maxDepth,
          limit,
          seed_url: typeof args.url === 'string' ? args.url : PRIVATE_URL,
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
