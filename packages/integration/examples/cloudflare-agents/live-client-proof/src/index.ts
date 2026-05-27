// SPDX-License-Identifier: Apache-2.0

import { Agent, getAgentByName } from 'agents'
import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { atrib, attributeCloudflareAgentMcp } from '@atrib/agent'
import {
  canonicalRecord,
  hexEncode,
  sha256,
  type AtribRecord,
  type ProofBundle,
} from '@atrib/mcp/worker'
import { z } from 'zod'

const LOG_ENDPOINT = 'https://log.atrib.dev/v1/entries'

interface Env {
  ATRIB_PRIVATE_KEY: string
  UpstreamMcp: DurableObjectNamespace<UpstreamMcp>
  ClientProofAgent: DurableObjectNamespace<ClientProofAgent>
  CaptureAgent: DurableObjectNamespace<CaptureAgent>
}

interface CaptureRow {
  record_hash: string
  record_json: string
  proof_json: string
  created_at: number
}

interface RunClientProofInput {
  runId: string
  workerUrl: string
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    ...init,
    headers,
  })
}

function normalizeWorkerUrl(workerUrl: string): string {
  return workerUrl.replace(/\/$/u, '')
}

export class UpstreamMcp extends McpAgent<Env> {
  server = new McpServer({
    name: 'atrib-cloudflare-live-client-upstream',
    version: '1.0.0',
  })

  async init() {
    this.server.registerTool(
      'complete_checkout',
      {
        description: 'Complete a checkout and return an ACP-style completion shape.',
        inputSchema: {
          sku: z.string(),
        },
      },
      async ({ sku }, extra) => {
        const orderId = `order_${crypto.randomUUID()}`
        const response = {
          id: `checkout_${crypto.randomUUID()}`,
          status: 'completed',
          order: {
            id: orderId,
            permalink_url: `https://merchant.example.com/orders/${orderId}`,
          },
          sku,
          meta_seen: {
            has_traceparent: typeof extra._meta?.traceparent === 'string',
            has_baggage: typeof extra._meta?.baggage === 'string',
            keys: Object.keys(extra._meta ?? {}).sort(),
          },
        }

        return {
          ...response,
          structuredContent: response,
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        }
      },
    )
  }
}

export class CaptureAgent extends Agent<Env> {
  private discardRows(rows: unknown[]): void {
    void rows.length
  }

  private ensureCaptureSchema(): void {
    this.discardRows(
      this.sql`
        CREATE TABLE IF NOT EXISTS captured_records (
          record_hash TEXT PRIMARY KEY,
          record_json TEXT NOT NULL,
          proof_json TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `,
    )
  }

  async clear(): Promise<void> {
    this.ensureCaptureSchema()
    this.discardRows(this.sql`DELETE FROM captured_records`)
  }

  async capture(record: AtribRecord, proof: ProofBundle): Promise<void> {
    this.ensureCaptureSchema()
    this.discardRows(
      this.sql`
        INSERT OR REPLACE INTO captured_records
          (record_hash, record_json, proof_json, created_at)
        VALUES
          (${recordHash(record)}, ${JSON.stringify(record)}, ${JSON.stringify(proof)}, ${Date.now()})
      `,
    )
  }

  async list(limit = 10): Promise<
    Array<{
      record_hash: string
      record: AtribRecord
      proof: ProofBundle
      created_at: number
    }>
  > {
    this.ensureCaptureSchema()
    const rows = this.sql<CaptureRow>`
      SELECT record_hash, record_json, proof_json, created_at
      FROM captured_records
      ORDER BY created_at ASC
      LIMIT ${limit}
    `

    return rows.map((row) => ({
      record_hash: row.record_hash,
      record: JSON.parse(row.record_json) as AtribRecord,
      proof: JSON.parse(row.proof_json) as ProofBundle,
      created_at: row.created_at,
    }))
  }
}

export class ClientProofAgent extends Agent<Env> {
  async runClientProof(input: RunClientProofInput) {
    const workerUrl = normalizeWorkerUrl(input.workerUrl)
    const upstreamUrl = `${workerUrl}/upstream-mcp`
    const logEndpoint = `${workerUrl}/atrib-log-proxy?run=${encodeURIComponent(input.runId)}`
    const interceptor = atrib({
      creatorKey: this.env.ATRIB_PRIVATE_KEY,
      merchantDomain: workerUrl,
      serverUrls: [upstreamUrl],
      logEndpoint,
      sessionToken: input.runId,
    })

    const connection = await this.addMcpServer('checkout-upstream', upstreamUrl, {
      transport: { type: 'streamable-http' },
    })
    const wrappedCount = attributeCloudflareAgentMcp(this, {
      interceptor,
      serverUrls: {
        'checkout-upstream': upstreamUrl,
      },
    })

    const toolResult = await this.mcp.callTool({
      serverId: connection.id,
      name: 'complete_checkout',
      arguments: {
        sku: 'p16-client-proof',
      },
    })

    await interceptor.flush()

    return {
      run_id: input.runId,
      upstream_url: upstreamUrl,
      connection,
      wrapped_count: wrappedCount,
      tool_result: toolResult,
      gap_nodes: interceptor.getGapNodes(),
      policy_record: interceptor.getSessionPolicyRecord(),
      mcp_state: this.getMcpServers(),
    }
  }
}

const upstreamHandler = UpstreamMcp.serve('/upstream-mcp', { binding: 'UpstreamMcp' })

async function handleRunClientProof(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405 })
  }

  const url = new URL(request.url)
  const runId = crypto.randomUUID()
  const capture = await getAgentByName(env.CaptureAgent, runId)
  await capture.clear()

  const agent = await getAgentByName(env.ClientProofAgent, runId)
  const result = (await agent.runClientProof({
    runId,
    workerUrl: url.origin,
  })) as Record<string, unknown>
  const captured = await capture.list(10)

  return json({
    ...result,
    captured,
  })
}

async function handleLogProxy(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, { status: 405 })
  }

  const url = new URL(request.url)
  const runId = url.searchParams.get('run')
  if (!runId) {
    return json({ error: 'missing_run' }, { status: 400 })
  }

  const body = await request.text()
  const response = await fetch(LOG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-atrib-Priority': request.headers.get('X-atrib-Priority') ?? 'normal',
    },
    body,
  })
  const text = await response.text()

  if (response.ok) {
    const record = JSON.parse(body) as AtribRecord
    const proof = JSON.parse(text) as ProofBundle
    const capture = await getAgentByName(env.CaptureAgent, runId)
    await capture.capture(record, proof)
  }

  return new Response(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
    },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/upstream-mcp')) {
      return upstreamHandler.fetch(request, env, ctx)
    }

    if (url.pathname === '/run-client-proof') {
      return handleRunClientProof(request, env)
    }

    if (url.pathname === '/atrib-log-proxy') {
      return handleLogProxy(request, env)
    }

    return json({
      ok: true,
      endpoints: ['/run-client-proof', '/upstream-mcp'],
    })
  },
}
