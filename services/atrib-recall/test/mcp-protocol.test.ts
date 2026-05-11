// SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end MCP protocol smoke test.
 *
 * Spawns the built atrib-recall binary as a child process and exercises the
 * real JSON-RPC stdio loop the way Claude Code does. Without this, regressions
 * in the MCP wiring (request schemas, transport, tool registration) only
 * surface in production. The function-level recall.test.ts can pass while the
 * MCP surface is broken.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  signRecord,
  getPublicKey,
  base64urlEncode,
  genesisChainRoot,
  EVENT_TYPE_TOOL_CALL_URI,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

const KEY = new Uint8Array(32).fill(31)
const CTX = 'a'.repeat(32)

const BINARY = resolve(__dirname, '..', 'dist', 'index.js')

async function makeSigned(timestamp = 1700000000000): Promise<AtribRecord> {
  const pub = await getPublicKey(KEY)
  const record = {
    spec_version: 'atrib/1.0' as const,
    // URI form per spec §1.2.4 + §1.4.5; verifyRecord rejects the legacy
    // short form 'tool_call' that this fixture used pre-URI-migration.
    event_type: EVENT_TYPE_TOOL_CALL_URI,
    context_id: CTX,
    creator_key: base64urlEncode(pub),
    chain_root: genesisChainRoot(CTX),
    content_id: `sha256:${timestamp.toString(16).padStart(64, '0')}`,
    timestamp,
    signature: '',
  }
  return signRecord(record as AtribRecord, KEY)
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

class McpClient {
  private child: ChildProcessWithoutNullStreams
  private buffer = ''
  private pending = new Map<number, (msg: JsonRpcResponse) => void>()

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn('node', [BINARY], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let idx = this.buffer.indexOf('\n')
      while (idx >= 0) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        if (line) {
          try {
            const msg = JSON.parse(line) as JsonRpcResponse
            const cb = this.pending.get(msg.id)
            if (cb) {
              this.pending.delete(msg.id)
              cb(msg)
            }
          } catch {
            // ignore malformed line
          }
        }
        idx = this.buffer.indexOf('\n')
      }
    })
  }

  send(method: string, params: unknown, id: number): Promise<JsonRpcResponse> {
    return new Promise((resolveResp, rejectResp) => {
      this.pending.set(id, resolveResp)
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      this.child.stdin.write(payload + '\n')
      // 4 second per-call timeout - plenty for local stdio.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rejectResp(new Error(`mcp call ${method} timed out`))
        }
      }, 4000)
    })
  }

  async initialize(): Promise<void> {
    await this.send(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'atrib-recall-test', version: '0.0.0' },
      },
      0,
    )
    // notifications/initialized has no response per spec - fire-and-forget.
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n',
    )
  }

  close(): void {
    this.child.stdin.end()
    this.child.kill('SIGTERM')
  }
}

let tmp: string
let recordFile: string

beforeAll(() => {
  // Ensure the binary is built. Tests run after `npm test`, which is invoked
  // post-build in CI; locally a stale dist will surface here as a missing-file
  // child process error.
})

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-recall-mcp-'))
  recordFile = join(tmp, 'records.jsonl')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

afterAll(() => {
  // no-op
})

describe('MCP protocol surface', () => {
  it('lists recall_my_attribution_history under tools/list', async () => {
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send('tools/list', {}, 1)
      expect(res.error).toBeUndefined()
      const tools = (res.result as { tools: { name: string }[] }).tools
      // Layer 1 (0.5.0-alpha) registers the existing recall_my_attribution_history
      // tool plus four new stub tools (recall_walk, recall_annotations,
      // recall_revisions, recall_by_content). Stubs return a "Layer 1 in progress"
      // notice; full handler implementation lands in subsequent commits during
      // the May 17 sprint.
      expect(tools).toHaveLength(5)
      const names = tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'recall_annotations',
        'recall_by_content',
        'recall_my_attribution_history',
        'recall_revisions',
        'recall_walk',
      ])
    } finally {
      client.close()
    }
  })

  it('returns the local mirror via tools/call', async () => {
    const r = await makeSigned(1700000000000)
    writeFileSync(recordFile, JSON.stringify(r))

    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        {
          name: 'recall_my_attribution_history',
          arguments: { compact: true },
        },
        2,
      )
      expect(res.error).toBeUndefined()
      const result = res.result as { content: { type: string; text: string }[] }
      expect(result.content).toHaveLength(1)
      const payload = JSON.parse(result.content[0]!.text) as {
        total: number
        records: { signature_verified: boolean; context_id: string }[]
      }
      expect(payload.total).toBe(1)
      expect(payload.records[0]!.signature_verified).toBe(true)
      expect(payload.records[0]!.context_id).toBe(CTX)
    } finally {
      client.close()
    }
  })

  it('rejects unknown tool names with a JSON-RPC error', async () => {
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send(
        'tools/call',
        { name: 'nonexistent_tool', arguments: {} },
        3,
      )
      // The MCP SDK surfaces unknown tools either as a JSON-RPC error or as
      // an error-bearing result (isError: true). Accept either shape.
      const errored =
        res.error !== undefined ||
        (res.result as { isError?: boolean })?.isError === true
      expect(errored).toBe(true)
    } finally {
      client.close()
    }
  })
})
