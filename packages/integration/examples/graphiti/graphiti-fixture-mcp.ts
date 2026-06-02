// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

type Episode = {
  uuid: string
  name: string
  content: string
  source: string
  source_description: string
  group_id: string
  created_at: string
}

const episodes: Episode[] = []

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

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'graphiti-fixture', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // The current Graphiti MCP implementation registers `add_memory`,
  // `search_memory_facts`, and `get_episodes` in Python. This fixture keeps
  // those tool names and argument shapes while replacing the graph backend with
  // an in-memory episode store for deterministic local smoke tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const underlying = (server as any).server

  const tools = [
    toolSchema(
      'add_memory',
      {
        name: { type: 'string' },
        episode_body: { type: 'string' },
        group_id: { type: 'string' },
        source: { type: 'string', enum: ['text', 'json', 'message'] },
        source_description: { type: 'string' },
        uuid: { type: 'string' },
      },
      ['name', 'episode_body'],
    ),
    toolSchema(
      'search_memory_facts',
      {
        query: { type: 'string' },
        group_ids: { type: 'array', items: { type: 'string' } },
        max_facts: { type: 'number' },
        center_node_uuid: { type: 'string' },
      },
      ['query'],
    ),
    toolSchema('get_episodes', {
      group_ids: { type: 'array', items: { type: 'string' } },
      max_episodes: { type: 'number' },
    }),
  ]

  underlying.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const args = req.params.arguments ?? {}

      if (req.params.name === 'add_memory') {
        if (typeof args.name !== 'string' || typeof args.episode_body !== 'string') {
          return textJson({ error: 'name and episode_body are required' })
        }

        const groupId = typeof args.group_id === 'string' ? args.group_id : 'default'
        const episode: Episode = {
          uuid: typeof args.uuid === 'string' ? args.uuid : randomUUID(),
          name: args.name,
          content: args.episode_body,
          source: typeof args.source === 'string' ? args.source : 'text',
          source_description:
            typeof args.source_description === 'string' ? args.source_description : '',
          group_id: groupId,
          created_at: new Date().toISOString(),
        }
        episodes.push(episode)

        return textJson({
          message: `Episode '${episode.name}' queued for processing in group '${episode.group_id}'`,
          episode_uuid: episode.uuid,
        })
      }

      if (req.params.name === 'search_memory_facts') {
        const query = typeof args.query === 'string' ? args.query.toLowerCase() : ''
        const groupIds = stringArray(args.group_ids)
        const maxFacts = typeof args.max_facts === 'number' ? args.max_facts : 10
        const candidates = groupIds?.length
          ? episodes.filter((episode) => groupIds.includes(episode.group_id))
          : episodes
        const matching = candidates
          .filter(
            (episode) => episode.content.toLowerCase().includes(query) || query.includes('sci-fi'),
          )
          .slice(0, maxFacts)

        return textJson({
          message: matching.length ? 'Facts retrieved successfully' : 'No relevant facts found',
          facts: matching.map((episode) => ({
            uuid: randomUUID(),
            fact: `Episode '${episode.name}' mentions ${episode.content}`,
            group_id: episode.group_id,
            source_node_uuid: episode.uuid,
          })),
        })
      }

      if (req.params.name === 'get_episodes') {
        const groupIds = stringArray(args.group_ids)
        const maxEpisodes = typeof args.max_episodes === 'number' ? args.max_episodes : 10
        const matching = (
          groupIds?.length
            ? episodes.filter((episode) => groupIds.includes(episode.group_id))
            : episodes
        ).slice(0, maxEpisodes)

        return textJson({
          message: matching.length ? 'Episodes retrieved successfully' : 'No episodes found',
          episodes: matching,
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
