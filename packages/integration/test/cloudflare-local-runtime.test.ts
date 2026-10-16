// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unstable_dev, type Unstable_DevWorker } from 'wrangler'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { startDevLog, type DevLog } from '@atrib/log-dev'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  verifyRecord,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp'

const examples = resolve('examples/cloudflare-agents')
let log: DevLog
const workers: Unstable_DevWorker[] = []

async function startWorker(name: string) {
  const worker = await unstable_dev(resolve(examples, name, 'src/index.ts'), {
    config: resolve(examples, name, 'wrangler.jsonc'),
    local: true,
    ip: '127.0.0.1',
    port: 0,
    persist: false,
    logLevel: 'error',
    vars: {
      ATRIB_PRIVATE_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE',
      ATRIB_LOG_ENDPOINT: log.submissionEndpoint,
    },
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  })
  workers.push(worker)
  return worker
}

function text(result: unknown): string {
  if (
    !result ||
    typeof result !== 'object' ||
    !('content' in result) ||
    !Array.isArray(result.content)
  ) {
    throw new Error('expected MCP content array')
  }
  const content = result.content as Array<{ type: string; text?: string }>
  const item = content.find((part) => part.type === 'text')
  if (!item?.text) throw new Error('expected MCP text result')
  return item.text
}

beforeAll(async () => {
  log = await startDevLog()
})
afterAll(async () => {
  for (const worker of workers.reverse()) await worker.stop()
  await log?.close()
})

describe('local Cloudflare runtime compatibility', () => {
  it('runs the real Agent MCP client and captures signed records in the local dev log', async () => {
    const worker = await startWorker('live-client-proof')
    const base = `http://${worker.address}:${worker.port}`
    expect((await fetch(`${base}/run-client-proof`)).status).toBe(405)
    const response = await fetch(`${base}/run-client-proof`, { method: 'POST' })
    expect(response.status).toBe(200)
    const result = (await response.json()) as {
      wrapped_count: number
      tool_result: {
        structuredContent?: {
          status: string
          meta_seen: { has_traceparent: boolean; has_baggage: boolean }
        }
      }
      gap_nodes: unknown[]
      captured: Array<{ record: AtribRecord; proof: ProofBundle }>
    }
    expect(result.wrapped_count).toBeGreaterThan(0)
    expect(result.tool_result.structuredContent).toMatchObject({
      status: 'completed',
      meta_seen: { has_traceparent: true, has_baggage: true },
    })
    expect(result.gap_nodes).toEqual([
      expect.objectContaining({ type: 'gap_node', signed: false, tool_name: 'complete_checkout' }),
    ])
    expect(result.captured).toHaveLength(1)
    for (const { record, proof } of result.captured) {
      expect(record.event_type).toBe('https://atrib.dev/v1/types/transaction')
      expect(await verifyRecord(record)).toBe(true)
      const stored = log.entries.find((entry) => entry.logIndex === proof.log_index)
      expect(stored?.recordHash).toBe(hexEncode(sha256(canonicalRecord(record))))
      expect(proof.checkpoint).toContain('devLogPlaceholderSignature')
    }
  }, 60_000)

  it('executes real MCP tools, rejects invalid input and keeps signed records', async () => {
    const worker = await startWorker('live-worker-proof')
    const client = new Client({ name: 'atrib-local-compat', version: '1.0.0' })
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://${worker.address}:${worker.port}/mcp`),
      )
      // The SDK getter permits undefined; Transport types its optional sessionId as string.
      await client.connect(transport as Parameters<Client['connect']>[0])
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('record_outcome')
      const invalid = await client
        .callTool({ name: 'record_outcome', arguments: { action: 'invalid' } })
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(McpError)
          expect((error as McpError).code).toBe(ErrorCode.InvalidParams)
          return { isError: true }
        })
      expect(invalid.isError).toBe(true)
      const absent = await client.callTool({
        name: 'recall_outcomes',
        arguments: { action: 'invalid' },
      })
      expect(JSON.parse(text(absent)).count).toBe(0)
      await client.callTool({
        name: 'record_outcome',
        arguments: { action: 'compat', outcome: 'ok', diagnostic: 'private fixture detail' },
      })
      const found = await client.callTool({
        name: 'recall_outcomes',
        arguments: { action: 'compat' },
      })
      expect(JSON.parse(text(found)).count).toBe(1)
      const captured = await client.callTool({ name: 'list_signed_records', arguments: {} })
      const records = JSON.parse(text(captured)).records as Array<{ record: AtribRecord }>
      expect(records.some(({ record }) => record.tool_name === 'record_outcome')).toBe(true)
      for (const { record } of records) expect(await verifyRecord(record)).toBe(true)
      expect(JSON.stringify(records.map(({ record }) => record))).not.toContain(
        'private fixture detail',
      )
      await client.callTool({ name: 'flush_atrib_queue', arguments: {} })
      expect(log.size).toBeGreaterThan(0)
    } finally {
      await client.close()
    }
  }, 60_000)
})
