// SPDX-License-Identifier: Apache-2.0

import { createTool } from '@mastra/core/tools'
import { MCPServer } from '@mastra/mcp'
import { z } from 'zod'

const approveOrder = createTool({
  id: 'approve_order',
  description: 'Approve a deterministic procurement request.',
  inputSchema: z.object({
    sku: z.string(),
    quantity: z.number().int().positive(),
    internal_note: z.string(),
  }),
  execute: async (input, context) => {
    return {
      status: 'approved',
      approval_id: `mastra-${input.sku}-${input.quantity}`,
      sku: input.sku,
      quantity: input.quantity,
      private_note: input.internal_note,
      tool_call_id: context.agent?.toolCallId ?? 'direct-mcp-call',
    }
  },
})

export const mastraRuntimeServer = new MCPServer({
  name: 'atrib-mastra-runtime-smoke',
  version: '1.0.0',
  tools: { approve_order: approveOrder },
})

if (import.meta.url === `file://${process.argv[1]}`) {
  mastraRuntimeServer.startStdio().catch((error) => {
    console.error('mastra runtime smoke server failed:', error)
    process.exitCode = 1
  })
}
