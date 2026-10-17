// SPDX-License-Identifier: Apache-2.0

import { createTool } from '@mastra/core/tools'
import { MCPServer } from '@mastra/mcp'
import { z } from 'zod'

let probeCalls = 0
let confirmCalls = 0
let completions = 0
const probe = createTool({
  id: 'probe',
  description: 'Echo a fixture value or report a fixture backend error.',
  inputSchema: z.object({ value: z.string().min(1), fail: z.boolean().default(false) }),
  outputSchema: z.object({ echo: z.string(), protocol: z.string() }),
  execute: async (input, context) => {
    probeCalls++
    if (input.fail) throw new Error('fixture backend denied')
    return { echo: input.value, protocol: context.mcp?.protocolVersion ?? 'in-process' }
  },
})
const confirm = createTool({
  id: 'confirm',
  description: 'Ask for confirmation before completing a fixture request.',
  inputSchema: z.object({ action: z.string() }),
  outputSchema: z.object({ confirmed: z.literal(true), action: z.string() }),
  suspendSchema: z.object({ message: z.string() }),
  resumeSchema: z.object({ approved: z.boolean() }),
  execute: async (input, context) => {
    confirmCalls++
    if (!context.resumeData) {
      if (!context.suspend) throw new Error('fixture suspension is unavailable')
      await context.suspend({ message: 'Confirm this fixture-only request' })
      return
    }
    if (!context.resumeData.approved) throw new Error('fixture approval denied')
    completions++
    return { confirmed: true as const, action: input.action }
  },
})
const inspectCalls = createTool({
  id: 'inspect_calls',
  description: 'Read fixture handler counters.',
  inputSchema: z.object({}),
  outputSchema: z.object({ probe: z.number(), confirm: z.number(), completions: z.number() }),
  execute: async () => ({ probe: probeCalls, confirm: confirmCalls, completions }),
})

export const mastraCompatibilityServer = new MCPServer({
  name: 'atrib-mastra-compatibility',
  version: '2.0.0',
  tools: { probe, confirm, inspect_calls: inspectCalls },
  requestState: { key: 'local-fixture-request-state-key-32-bytes', ttlSeconds: 60 },
})

if (import.meta.url === `file://${process.argv[1]}`) {
  mastraCompatibilityServer.startStdio().catch((error) => {
    process.stderr.write(`Mastra fixture failed: ${String(error)}\n`)
    process.exitCode = 1
  })
}
