// SPDX-License-Identifier: Apache-2.0

/**
 * D082 CLI binary tests: the atrib-emit-cli wraps emitInProcess over
 * stdin/stdout. The byte-identicality claim of D081 + D082 is covered by
 * byte-identical.test.ts (the underlying emitInProcess path). These tests
 * pin the CLI's wire contract:
 *
 *   - happy path: a valid envelope produces an EmitOutput on stdout with
 *     a real record_hash, log_index, and zero warnings (against a stub log)
 *   - degradation: invalid stdin and missing fields produce a structured
 *     fallback object on stdout, never throw, exit code stays 0
 *   - flags: --version / --help short-circuit before reading stdin
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { base64urlEncode } from '@atrib/mcp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface LogStub {
  url: string
  received: unknown[]
  close: () => Promise<void>
}

async function startLogStub(): Promise<LogStub> {
  const received: unknown[] = []
  let nextIdx = 0
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST' && req.url === '/v1/entries') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push(JSON.parse(body))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            log_index: nextIdx++,
            checkpoint: 'stub',
            inclusion_proof: [],
            leaf_hash: 'stub',
          }),
        )
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no address')
  return {
    url: `http://127.0.0.1:${addr.port}/v1/entries`,
    received,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

interface CliResult {
  stdout: string
  stderr: string
  code: number | null
}

function runCli(args: string[], stdin: string, env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const cliPath = join(__dirname, '..', 'dist', 'cli.js')
    const child: ChildProcess = spawn('node', [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c) => (stdout += String(c)))
    child.stderr?.on('data', (c) => (stderr += String(c)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code }))
    if (stdin.length > 0) child.stdin?.write(stdin)
    child.stdin?.end()
  })
}

let tmpDir: string
let mirrorPath: string
let priorMirror: string | undefined
let priorAutochain: string | undefined
let log: LogStub
let seedHex: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'atrib-cli-test-'))
  mirrorPath = join(tmpDir, 'mirror.jsonl')
  log = await startLogStub()
  priorMirror = process.env['ATRIB_MIRROR_FILE']
  priorAutochain = process.env['ATRIB_AUTOCHAIN_SOURCE']
  // Use a deterministic seed so resolveKey returns a known key without
  // touching Keychain. ATRIB_PRIVATE_KEY is base64url-encoded per keys.ts.
  const seed = new Uint8Array(32).fill(13)
  await ed.getPublicKeyAsync(seed)
  seedHex = base64urlEncode(seed)
})

afterEach(async () => {
  await log.close()
  await rm(tmpDir, { recursive: true, force: true })
  if (priorMirror === undefined) delete process.env['ATRIB_MIRROR_FILE']
  else process.env['ATRIB_MIRROR_FILE'] = priorMirror
  if (priorAutochain === undefined) delete process.env['ATRIB_AUTOCHAIN_SOURCE']
  else process.env['ATRIB_AUTOCHAIN_SOURCE'] = priorAutochain
})

describe('atrib-emit-cli wire contract', () => {
  it('--version prints the package version and exits 0', async () => {
    const r = await runCli(['--version'], '')
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('--help prints usage to stderr and exits 0', async () => {
    const r = await runCli(['--help'], '')
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('USAGE')
    expect(r.stderr).toContain('atrib-emit-cli')
  })

  it('empty stdin: exits 0 with a structured fallback result', async () => {
    const r = await runCli([], '')
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string; warnings: string[] }
    expect(out.record_hash).toBe('sha256:unknown')
    expect(out.warnings.some((w) => w.includes('empty stdin'))).toBe(true)
    expect(r.stderr).toContain('empty stdin')
  })

  it('malformed JSON: exits 0 with a parse-error fallback', async () => {
    const r = await runCli([], 'not-json')
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string; warnings: string[] }
    expect(out.record_hash).toBe('sha256:unknown')
    expect(out.warnings.some((w) => w.includes('stdin parse error'))).toBe(true)
  })

  it('envelope missing event_type or content: exits 0 with a missing-fields fallback', async () => {
    const r = await runCli([], JSON.stringify({ event_type: 'foo' }))
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string; warnings: string[] }
    expect(out.record_hash).toBe('sha256:unknown')
    expect(out.warnings.some((w) => w.includes('missing event_type or content'))).toBe(true)
  })

  it('happy path: a valid envelope produces a real record_hash on stdout', async () => {
    const envelope = {
      event_type: 'https://atrib.dev/v1/types/observation',
      content: { what: 'cli-happy-path', topics: ['cli-test'] },
      context_id: 'aaaabbbbccccddddeeeeffff00001111',
    }
    const r = await runCli(['--log-endpoint', log.url], JSON.stringify(envelope), {
      ATRIB_PRIVATE_KEY: seedHex,
      ATRIB_MIRROR_FILE: mirrorPath,
      ATRIB_AUTOCHAIN_SOURCE: mirrorPath,
    })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as {
      record_hash: string
      log_index: number | null
      warnings: string[]
    }
    expect(out.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(out.log_index).not.toBeNull()
    expect(typeof out.log_index).toBe('number')
    expect(log.received.length).toBe(1)
    // After flush the "submission queued" warning must NOT survive — same
    // contract as emitInProcess (see byte-identical.test.ts).
    expect(
      out.warnings.some((w) => w.startsWith('submission queued; proof not yet available')),
    ).toBe(false)
  })

  it('unknown CLI flag: exits 0 with an invalid-arguments fallback', async () => {
    const r = await runCli(['--bogus'], '')
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string; warnings: string[] }
    expect(out.record_hash).toBe('sha256:unknown')
    expect(out.warnings.some((w) => w.includes('invalid CLI arguments'))).toBe(true)
    expect(r.stderr).toContain('unknown argument')
  })
})
