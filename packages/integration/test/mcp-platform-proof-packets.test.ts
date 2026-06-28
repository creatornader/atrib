// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  redactUpstreamDiagnostic,
  runWrappedMcpPacket,
} from '../examples/wrapped-mcp-proof-runner.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

async function runPacket(script: string, outPrefix: string) {
  const outDir = mkdtempSync(join(tmpdir(), outPrefix))
  try {
    const { stdout } = await execFileAsync(tsxBin, [script], {
      cwd: process.cwd(),
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        ATRIB_PACKET_OUT_DIR: outDir,
      },
    })
    return {
      outDir,
      stdout,
      result: JSON.parse(stdout.trim()) as {
        ok: boolean
        packet: string
        signed_records: number
        operations: string[]
        record_hashes: string[]
        log_indexes: number[]
        verifier: { record_valid: boolean }
        privacy: { public_records_hash_only: boolean }
        policy_decision?: {
          artifact: string
          decision: string
          decision_hash: string
        }
        artifact_dir: string
      },
      cleanup: () => rmSync(outDir, { recursive: true, force: true }),
    }
  } catch (err) {
    rmSync(outDir, { recursive: true, force: true })
    throw err
  }
}

function artifactText(
  outDir: string,
  files = ['README.md', 'verifier-output.json', 'redaction-manifest.json'],
): string {
  return files
    .map((file) => {
      const path = join(outDir, file)
      expect(existsSync(path)).toBe(true)
      return readFileSync(path, 'utf8')
    })
    .join('\n')
}

describe('MCP platform proof packets', () => {
  beforeAll(async () => {
    await execFileAsync('pnpm', ['--filter', '@atrib/mcp', 'build'], {
      cwd: workspaceRoot,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
    await execFileAsync('pnpm', ['--filter', '@atrib/mcp-wrap', 'build'], {
      cwd: workspaceRoot,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
  }, 60000)

  it('generates a Browserbase Stagehand packet with hash-only public records', async () => {
    const run = await runPacket(
      'examples/browserbase-stagehand/browserbase-stagehand-packet-smoke.ts',
      'atrib-browserbase-packet-',
    )
    try {
      expect(run.result.ok).toBe(true)
      expect(run.result.packet).toBe('browserbase-stagehand')
      expect(run.result.signed_records).toBe(6)
      expect(run.result.operations).toEqual([
        'start',
        'navigate',
        'observe',
        'act',
        'extract',
        'end',
      ])
      expect(run.result.record_hashes).toHaveLength(6)
      expect(run.result.log_indexes).toEqual([0, 1, 2, 3, 4, 5])
      expect(run.result.verifier.record_valid).toBe(true)
      expect(run.result.privacy.public_records_hash_only).toBe(true)

      const text = `${run.stdout}\n${artifactText(run.outDir)}`
      for (const needle of [
        'bb_session_private_20260623',
        'https://browserbase.example.invalid/sessions/private-replay-20260623',
        '#private-checkout-control',
        'private browserbase note',
        '<html><body><button id="private-checkout-control">Ship</button></body></html>',
        'Internal quote: private browserbase note',
      ]) {
        expect(text).not.toContain(needle)
      }
    } finally {
      run.cleanup()
    }
  }, 60000)

  it('generates a Firecrawl ingestion packet with a bounded crawl record', async () => {
    const run = await runPacket(
      'examples/firecrawl-web-ingestion/firecrawl-web-ingestion-packet-smoke.ts',
      'atrib-firecrawl-packet-',
    )
    try {
      expect(run.result.ok).toBe(true)
      expect(run.result.packet).toBe('firecrawl-web-ingestion')
      expect(run.result.signed_records).toBe(4)
      expect(run.result.operations).toEqual([
        'firecrawl_search',
        'firecrawl_scrape',
        'firecrawl_extract',
        'firecrawl_crawl',
      ])
      expect(run.result.record_hashes).toHaveLength(4)
      expect(run.result.log_indexes).toEqual([0, 1, 2, 3])
      expect(run.result.verifier.record_valid).toBe(true)
      expect(run.result.privacy.public_records_hash_only).toBe(true)
      expect(run.result.policy_decision).toMatchObject({
        artifact: 'policy-decision.json',
        decision: 'escalate_before_customer_email',
      })
      expect(run.result.policy_decision?.decision_hash).toMatch(/^sha256:[0-9a-f]{64}$/u)

      const text = `${run.stdout}\n${artifactText(run.outDir, [
        'README.md',
        'verifier-output.json',
        'redaction-manifest.json',
        'policy-decision.json',
      ])}`
      expect(text).toContain('signed_ingestion_records_present')
      expect(text).toContain('bounded_crawl_cap_present')
      expect(text).toContain('raw_web_content_private')
      expect(text).toContain('customer_message_requires_review')
      expect(text).toContain('escalate_before_customer_email')
      for (const needle of [
        'private acquisition research query',
        'https://example.invalid/private-firecrawl-source',
        'Confidential pricing: private firecrawl text',
        '<main><h1>Private vendor page</h1><p>Confidential pricing</p></main>',
        'private firecrawl extracted account note',
        'crawl_private_job_20260623',
      ]) {
        expect(text).not.toContain(needle)
      }
    } finally {
      run.cleanup()
    }
  }, 60000)

  it('redacts private material from upstream error diagnostics', () => {
    const diagnostic = redactUpstreamDiagnostic(
      'Error for https://example.invalid/private-firecrawl-source with key fc-secret and Google key AIzaSecret plus https://browserbase.com/sessions/private-session',
      ['https://example.invalid/private-firecrawl-source'],
    )

    expect(diagnostic).toContain('[redacted-private-field]')
    expect(diagnostic).toContain('[redacted-firecrawl-key]')
    expect(diagnostic).toContain('[redacted-google-key]')
    expect(diagnostic).toContain('[redacted-browserbase-url]')
    expect(diagnostic).not.toContain('private-firecrawl-source')
    expect(diagnostic).not.toContain('fc-secret')
    expect(diagnostic).not.toContain('AIzaSecret')
  })

  it('does not publish public log records until packet checks pass', async () => {
    const publicLog = await startCountingPublicLog()
    try {
      await expect(
        runWrappedMcpPacket({
          packet: 'browserbase-stagehand',
          mode: 'fixture',
          logMode: 'public',
          publicLogEndpoint: publicLog.endpoint,
          upstreamShape: 'Browserbase fixture',
          exampleDir: join(process.cwd(), 'examples', 'browserbase-stagehand'),
          integrationDir: process.cwd(),
          fixtureServer: join(
            process.cwd(),
            'examples',
            'browserbase-stagehand',
            'browserbase-fixture-mcp.ts',
          ),
          expectedTools: ['start'],
          calls: [{ name: 'start', expectText: 'marker-that-is-not-present' }],
          privateNeedles: [],
        }),
      ).rejects.toThrow('unexpected start result')

      expect(publicLog.submissions).toHaveLength(0)
    } finally {
      await publicLog.close()
    }
  }, 60000)

  it('times out a stalled upstream call inside the shared runner', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'atrib-hanging-mcp-'))
    const fixtureServer = join(tempDir, 'hanging-mcp.ts')
    writeFileSync(
      fixtureServer,
      `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new McpServer(
  { name: 'hanging-fixture', version: '0.1.0' },
  { capabilities: { tools: {} } },
)
const underlying = server.server
underlying.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'start',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}))
underlying.setRequestHandler(CallToolRequestSchema, async () => new Promise(() => {}))
await server.connect(new StdioServerTransport())
`,
    )
    try {
      await expect(
        runWrappedMcpPacket({
          packet: 'hanging-upstream',
          mode: 'fixture',
          logMode: 'local',
          upstreamShape: 'Hanging upstream fixture',
          exampleDir: tempDir,
          integrationDir: process.cwd(),
          fixtureServer,
          expectedTools: ['start'],
          calls: [{ name: 'start' }],
          timeoutMs: 100,
          privateNeedles: [],
        }),
      ).rejects.toThrow('packet timed out after 100ms')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 10000)
})

async function startCountingPublicLog(): Promise<{
  endpoint: string
  submissions: unknown[]
  close(): Promise<void>
}> {
  const submissions: unknown[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/entries') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not_found' }))
      return
    }

    let body = ''
    for await (const chunk of request) body += String(chunk)
    submissions.push(JSON.parse(body) as unknown)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        log_index: submissions.length - 1,
        checkpoint: 'test-log\n1\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n',
        inclusion_proof: [],
        leaf_hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      }),
    )
  })
  await listen(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('public log did not bind')
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/entries`,
    submissions,
    close: () => close(server),
  }
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
