// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createProtectedMcpExecutor, type ActionGateLocalSidecar } from '@atrib/action-gate'
import type { AtribRecord } from '@atrib/mcp'

const PRIVATE_KEY = new Uint8Array(32).fill(29)
const CONTEXT_ID = 'abcdef0123456789abcdef0123456789'

describe('protected MCP executor integration', () => {
  const closeCallbacks: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(closeCallbacks.splice(0).map((close) => close()))
  })

  it('executes through the signed gate and rejects a direct raw-boundary call', async () => {
    let sideEffects = 0
    const records: Array<{ record: AtribRecord; sidecar: ActionGateLocalSidecar }> = []
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      now: () => 1_780_000_000_000,
      createPermitId: () => 'integration-permit-1',
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'protected-mcp-integration',
        policy_version: '1',
      }),
      executeUpstream: (request) => {
        sideEffects += 1
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ executed: true, arguments: request.arguments ?? {} }),
            },
          ],
        }
      },
      onRecord: (record, sidecar) => {
        records.push({ record, sidecar })
      },
    })

    const server = new McpServer(
      { name: 'protected-mcp-fixture', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    // The low-level handler keeps both the normal action path and the raw
    // protected boundary visible in one real MCP transport.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const underlying = (server as any).server
    underlying.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        { name: 'protected.transfer', inputSchema: { type: 'object' } },
        { name: 'raw.transfer', inputSchema: { type: 'object' } },
      ],
    }))
    underlying.setRequestHandler(
      CallToolRequestSchema,
      async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
        const toolCall = {
          name: 'payments.transfer',
          arguments: request.params.arguments ?? {},
        }
        const action = {
          run_id: 'integration-run',
          action_id: 'integration-action',
          agent_id: 'integration-agent',
          risk: ['external_write'],
        }
        if (request.params.name === 'protected.transfer') {
          const run = await executor.authorizeAndExecute({
            action,
            request: toolCall,
          })
          if (run.state !== 'allowed' || run.result === undefined) {
            return {
              isError: true,
              content: [{ type: 'text', text: `gate rejected: ${run.state}` }],
            }
          }
          return run.result
        }
        if (request.params.name === 'raw.transfer') {
          const bypass = await executor.dispatch({
            action,
            request: toolCall,
          })
          if (!bypass.ok) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `protected executor rejected: ${bypass.authorization.reason}`,
                },
              ],
            }
          }
          return bypass.result
        }
        return {
          isError: true,
          content: [{ type: 'text', text: 'unknown tool' }],
        }
      },
    )

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'protected-mcp-test', version: '1.0.0' })
    await client.connect(clientTransport)
    closeCallbacks.push(async () => {
      await client.close()
      await server.close()
    })

    const protectedResult = await client.callTool({
      name: 'protected.transfer',
      arguments: { amount: '42.00' },
    })
    expect(protectedResult.isError).not.toBe(true)
    expect(sideEffects).toBe(1)
    expect(records).toHaveLength(2)
    expect(records.map(({ sidecar }) => sidecar.record_kind)).toEqual(['decision', 'outcome'])

    const bypassResult = await client.callTool({
      name: 'raw.transfer',
      arguments: { amount: '42.00' },
    })
    expect(bypassResult.isError).toBe(true)
    expect(bypassResult.content).toEqual([
      {
        type: 'text',
        text: 'protected executor rejected: authorization_missing',
      },
    ])
    expect(sideEffects).toBe(1)
    expect(records).toHaveLength(4)
    expect(records.slice(2).map(({ sidecar }) => sidecar.record_kind)).toEqual([
      'decision',
      'outcome',
    ])
  })
})
