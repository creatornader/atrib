// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const BINARY = resolve(__dirname, '..', 'dist', 'index.js')
const EXPECTED_TOOL_NAMES = [
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
]

interface HttpHost {
  child: ChildProcessWithoutNullStreams
  endpoint: string
  healthEndpoint: string
  close(): Promise<void>
}

function processEnvWith(env: NodeJS.ProcessEnv): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (typeof value === 'string') merged[key] = value
  }
  return merged
}

async function connectStdioClient(env: NodeJS.ProcessEnv): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [BINARY],
    env: processEnvWith(env),
    stderr: 'pipe',
  })
  const client = new Client({
    name: 'atrib-primitives-stdio-test',
    version: '0.0.0',
  })
  try {
    await client.connect(transport)
    return client
  } catch (error) {
    await transport.close().catch(() => {})
    throw error
  }
}

function startHttpHost(env: NodeJS.ProcessEnv): Promise<HttpHost> {
  return new Promise((resolveHost, rejectHost) => {
    const child = spawn(
      'node',
      [
        BINARY,
        '--transport',
        'streamable-http',
        '--port',
        '0',
        '--json',
        '--session-idle-ms',
        '60000',
      ],
      {
        env: processEnvWith(env),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let settled = false
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      rejectHost(new Error(`HTTP host did not become ready. stderr=${stderr}`))
    }, 5000)

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      let idx = stdout.indexOf('\n')
      while (idx >= 0) {
        const line = stdout.slice(0, idx).trim()
        stdout = stdout.slice(idx + 1)
        if (line) {
          try {
            const ready = JSON.parse(line) as {
              status?: string
              endpoint?: string
              health_endpoint?: string
            }
            if (ready.status === 'ready' && ready.endpoint && ready.health_endpoint) {
              settled = true
              clearTimeout(timer)
              resolveHost({
                child,
                endpoint: ready.endpoint,
                healthEndpoint: ready.health_endpoint,
                close: () => stopChild(child),
              })
              return
            }
          } catch {
            // Ignore non-ready stdout lines from child startup.
          }
        }
        idx = stdout.indexOf('\n')
      }
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectHost(
        new Error(
          `HTTP host exited before ready: code=${code ?? 'null'} signal=${signal ?? 'null'} stderr=${stderr}`,
        ),
      )
    })
  })
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveStop()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolveStop()
    }, 2000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
    child.kill('SIGTERM')
  })
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
    const client = await connectStdioClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      const listed = await client.listTools()
      const tools = listed.tools
      expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES)
    } finally {
      await client.close()
    }
  })

  it('routes a child primitive tool call through the combined server', async () => {
    const client = await connectStdioClient({ ATRIB_RECORD_FILE: recordFile })
    try {
      const result = await client.callTool({
        name: 'recall_my_attribution_history',
        arguments: { compact: true },
      })
      const payload = JSON.parse(result.content[0]!.text) as { total: number; returned: number }
      expect(payload.total).toBe(0)
      expect(payload.returned).toBe(0)
    } finally {
      await client.close()
    }
  })

  it('serves the same tools from one host-owned Streamable HTTP process', async () => {
    const host = await startHttpHost({ ATRIB_RECORD_FILE: recordFile })
    try {
      const health = (await (await fetch(host.healthEndpoint)).json()) as {
        status?: string
        report?: { primitive_runtime?: { transport?: string; tool_count?: number } }
      }
      expect(health.status).toBe('healthy')
      expect(health.report?.primitive_runtime?.transport).toBe('streamable-http')
      expect(health.report?.primitive_runtime?.tool_count).toBe(EXPECTED_TOOL_NAMES.length)

      const transport = new StreamableHTTPClientTransport(new URL(host.endpoint))
      const client = new Client({
        name: 'atrib-primitives-http-test',
        version: '0.0.0',
      })
      try {
        await client.connect(transport)
        const listed = await client.listTools()
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES)
        const result = await client.callTool({
          name: 'recall_my_attribution_history',
          arguments: { compact: true },
        })
        const payload = JSON.parse(result.content[0]!.text) as {
          total: number
          returned: number
        }
        expect(payload.total).toBe(0)
        expect(payload.returned).toBe(0)
      } finally {
        await client.close()
      }
    } finally {
      await host.close()
    }
  })
})
