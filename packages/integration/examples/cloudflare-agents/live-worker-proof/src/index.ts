// SPDX-License-Identifier: Apache-2.0

import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  atrib,
  canonicalRecord,
  hexEncode,
  sha256,
  type AtribRecord,
  type OnRecordSidecar,
} from '@atrib/mcp/worker'
import { z } from 'zod'

interface Env {
  ATRIB_PRIVATE_KEY: string
  ATRIB_LOG_ENDPOINT?: string
  ATRIB_SERVER_URL?: string
}

interface OutcomeRow {
  id: string
  action: string
  outcome: string
  diagnostic: string
  created_at: number
}

interface AtribRecordRow {
  record_hash: string
  record_json: string
  sidecar_json: string
  tool_name: string | null
  created_at: number
}

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export class ProofMcp extends McpAgent<Env> {
  server = new McpServer({
    name: 'atrib-cloudflare-live-proof',
    version: '1.0.0',
  })

  async init() {
    this.sql`
      CREATE TABLE IF NOT EXISTS proof_outcomes (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        diagnostic TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `

    this.sql`
      CREATE TABLE IF NOT EXISTS atrib_records (
        record_hash TEXT PRIMARY KEY,
        record_json TEXT NOT NULL,
        sidecar_json TEXT NOT NULL,
        tool_name TEXT,
        created_at INTEGER NOT NULL
      )
    `

    this.server.registerTool(
      'record_outcome',
      {
        description: 'Store an action outcome with diagnostic evidence.',
        inputSchema: {
          action: z.string(),
          outcome: z.string(),
          diagnostic: z.string(),
        },
      },
      async ({ action, outcome, diagnostic }) => {
        const id = crypto.randomUUID()
        const createdAt = Date.now()

        this.sql`
          INSERT INTO proof_outcomes (id, action, outcome, diagnostic, created_at)
          VALUES (${id}, ${action}, ${outcome}, ${diagnostic}, ${createdAt})
        `

        return {
          content: [
            {
              type: 'text',
              text: jsonText({ id, action, outcome, diagnostic, created_at: createdAt }),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'recall_outcomes',
      {
        description: 'Read prior diagnostic outcomes from this Durable Object.',
        inputSchema: {
          action: z.string(),
          limit: z.number().int().min(1).max(10).optional(),
        },
      },
      async ({ action, limit = 5 }) => {
        const rows = this.sql<OutcomeRow>`
          SELECT id, action, outcome, diagnostic, created_at
          FROM proof_outcomes
          WHERE action = ${action}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `

        return {
          content: [
            {
              type: 'text',
              text: jsonText({ action, count: rows.length, rows }),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'list_signed_records',
      {
        description: 'Return signed atrib records captured by the Durable Object.',
        inputSchema: {
          limit: z.number().int().min(1).max(25).optional(),
        },
      },
      async ({ limit = 10 }) => {
        const rows = this.sql<AtribRecordRow>`
          SELECT record_hash, record_json, sidecar_json, tool_name, created_at
          FROM atrib_records
          ORDER BY created_at ASC
          LIMIT ${limit}
        `

        return {
          content: [
            {
              type: 'text',
              text: jsonText({
                count: rows.length,
                records: rows.map((row) => ({
                  record_hash: row.record_hash,
                  tool_name: row.tool_name,
                  created_at: row.created_at,
                  record: JSON.parse(row.record_json) as AtribRecord,
                  sidecar: JSON.parse(row.sidecar_json) as OnRecordSidecar,
                })),
              }),
            },
          ],
        }
      },
    )

    this.server.registerTool(
      'flush_atrib_queue',
      {
        description: 'Flush pending atrib log submissions.',
        inputSchema: {},
      },
      async () => {
        const flush = (this.server as unknown as { flush?: () => Promise<void> }).flush
        if (flush) {
          await flush()
        }

        return {
          content: [{ type: 'text', text: jsonText({ flushed: Boolean(flush) }) }],
        }
      },
    )

    atrib(this.server, {
      creatorKey: this.env.ATRIB_PRIVATE_KEY,
      logEndpoint: this.env.ATRIB_LOG_ENDPOINT,
      serverUrl: this.env.ATRIB_SERVER_URL,
      autoChain: true,
      disclosure: {
        tool_name: 'verbatim',
        args: 'plain-sha256',
        result: 'plain-sha256',
      },
      onRecord: (record, sidecar) => {
        const hash = recordHash(record)
        this.sql`
          INSERT OR REPLACE INTO atrib_records
            (record_hash, record_json, sidecar_json, tool_name, created_at)
          VALUES
            (${hash}, ${JSON.stringify(record)}, ${JSON.stringify(sidecar ?? {})}, ${sidecar?.toolName ?? null}, ${Date.now()})
        `
      },
    })
  }
}

export default ProofMcp.serve('/mcp', { binding: 'ProofMcp' })
