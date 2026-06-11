// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BINARY = resolve(__dirname, '..', 'dist', 'index.js')

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
          const msg = JSON.parse(line) as JsonRpcResponse
          const cb = this.pending.get(msg.id)
          if (cb) {
            this.pending.delete(msg.id)
            cb(msg)
          }
        }
        idx = this.buffer.indexOf('\n')
      }
    })
  }

  send(method: string, params: unknown, id: number): Promise<JsonRpcResponse> {
    return new Promise((resolveResp, rejectResp) => {
      this.pending.set(id, resolveResp)
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
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
        clientInfo: { name: 'atrib-primitives-test', version: '0.0.0' },
      },
      0,
    )
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

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'atrib-primitives-mcp-'))
  recordFile = join(tmp, 'records.jsonl')
  writeFileSync(recordFile, '')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('atrib-primitives MCP runtime', () => {
  it('lists every cognitive primitive tool from one stdio process', async () => {
    const client = new McpClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      await client.initialize()
      const res = await client.send('tools/list', {}, 1)
      expect(res.error).toBeUndefined()
      const tools = (res.result as { tools: { name: string }[] }).tools
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'atrib-annotate',
        'atrib-revise',
        'atrib-verify',
        'emit',
        'recall_annotations',
        'recall_by_content',
        'recall_by_signer',
        'recall_my_attribution_history',
        'recall_orphans',
        'recall_revisions',
        'recall_session_chain',
        'recall_walk',
        'summarize',
        'trace',
        'trace_forward',
      ])
    } finally {
      client.close()
    }
  })

  it('routes a child primitive tool call through the combined server', async () => {
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
      const payload = JSON.parse(result.content[0]!.text) as { total: number; returned: number }
      expect(payload.total).toBe(0)
      expect(payload.returned).toBe(0)
    } finally {
      client.close()
    }
  })
})
