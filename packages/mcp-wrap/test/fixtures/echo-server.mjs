// SPDX-License-Identifier: Apache-2.0

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

const server = new McpServer({ name: 'mcp-wrap-v2-fixture', version: '0.0.0' })
server.registerTool(
  'echo',
  {
    description: 'Return the supplied text.',
    inputSchema: {},
  },
  async () => ({ content: [{ type: 'text', text: 'echo' }] }),
)

serveStdio(() => server)
