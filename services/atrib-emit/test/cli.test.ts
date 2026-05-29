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

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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

  it('happy path: uses the per-agent mirror path when ATRIB_MIRROR_FILE is unset', async () => {
    delete process.env['ATRIB_MIRROR_FILE']
    const home = join(tmpDir, 'home')
    await mkdir(home, { recursive: true })
    const envelope = {
      event_type: 'https://atrib.dev/v1/types/observation',
      content: { what: 'cli-default-mirror-path', topics: ['cli-test'] },
      context_id: 'aaaabbbbccccddddeeeeffff00001113',
    }

    const r = await runCli(['--log-endpoint', log.url], JSON.stringify(envelope), {
      HOME: home,
      ATRIB_PRIVATE_KEY: seedHex,
      ATRIB_AGENT: 'cli-default-test',
    })

    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string }
    expect(out.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    const defaultMirrorPath = join(home, '.atrib', 'records', 'atrib-emit-cli-default-test.jsonl')
    const mirrorText = await readFile(defaultMirrorPath, 'utf8')
    expect(mirrorText).toContain('cli-default-mirror-path')
  })

  it('unknown CLI flag: exits 0 with an invalid-arguments fallback', async () => {
    const r = await runCli(['--bogus'], '')
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string; warnings: string[] }
    expect(out.record_hash).toBe('sha256:unknown')
    expect(out.warnings.some((w) => w.includes('invalid CLI arguments'))).toBe(true)
    expect(r.stderr).toContain('unknown argument')
  })

  it('--describe: emits a stable JSON description of the CLI contract', async () => {
    const r = await runCli(['--describe'], '')
    expect(r.code).toBe(0)
    const desc = JSON.parse(r.stdout) as {
      name: string
      version: string
      subcommands: Record<string, { description: string; reads_stdin: boolean }>
      options: Array<{ flag: string; takes_value: boolean }>
      envelope_schema: { required: Record<string, string>; optional: Record<string, string> }
      env_vars: Array<{ name: string }>
    }
    expect(desc.name).toBe('atrib-emit-cli')
    expect(desc.version).toMatch(/^\d+\.\d+\.\d+/)
    // Both subcommands must be discoverable
    expect(desc.subcommands.emit).toBeDefined()
    expect(desc.subcommands.doctor).toBeDefined()
    expect(desc.subcommands.emit.reads_stdin).toBe(true)
    expect(desc.subcommands.doctor.reads_stdin).toBe(false)
    // Required envelope fields are listed
    expect(desc.envelope_schema.required['event_type']).toBeDefined()
    expect(desc.envelope_schema.required['content']).toBeDefined()
    // Documented env vars include the decision-critical ones
    const envNames = desc.env_vars.map((v) => v.name)
    expect(envNames).toContain('ATRIB_PRIVATE_KEY')
    expect(envNames).toContain('ATRIB_LOG_ENDPOINT')
    expect(envNames).toContain('ATRIB_CONTEXT_ID')
    expect(envNames).toContain('CLAUDE_CODE_SESSION_ID')
    // Options include --describe itself (self-documenting)
    expect(desc.options.some((o) => o.flag === '--describe')).toBe(true)
  })

  it('doctor: exits 0 when all checks pass against a reachable log stub', async () => {
    // Re-use the log stub from the happy-path test by overriding the endpoint.
    // The log stub doesn't have /v1/checkpoint, so we point doctor at a route
    // that returns 200 from any well-formed origin. Easier: spin a tiny stub
    // that responds to /v1/checkpoint with a parseable signed-note.
    const stubServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/v1/checkpoint') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('log.atrib.dev/v1\n42\nfakefakefakefake\n\n— log.atrib.dev/v1 stubsig\n')
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => stubServer.listen(0, '127.0.0.1', resolve))
    const addr = stubServer.address()
    if (!addr || typeof addr === 'string') throw new Error('no address')
    const stubUrl = `http://127.0.0.1:${addr.port}/v1/entries`

    const r = await runCli(['doctor', '--json', '--log-endpoint', stubUrl], '', {
      ATRIB_PRIVATE_KEY: seedHex,
      ATRIB_MIRROR_FILE: mirrorPath,
    })
    stubServer.close()

    expect(r.code).toBe(0)
    const report = JSON.parse(r.stdout) as {
      ok: boolean
      checks: { key: { ok: boolean }; log_endpoint: { ok: boolean; data?: { tree_size?: number } }; mirror_writable: { ok: boolean } }
    }
    expect(report.ok).toBe(true)
    expect(report.checks.key.ok).toBe(true)
    expect(report.checks.log_endpoint.ok).toBe(true)
    expect(report.checks.log_endpoint.data?.tree_size).toBe(42)
    expect(report.checks.mirror_writable.ok).toBe(true)
  })

  it('doctor: exits 1 with diagnostic when log endpoint is unreachable', async () => {
    const r = await runCli(['doctor', '--json', '--log-endpoint', 'http://127.0.0.1:1/v1/entries'], '', {
      ATRIB_PRIVATE_KEY: seedHex,
      ATRIB_MIRROR_FILE: mirrorPath,
    })
    expect(r.code).toBe(1)
    const report = JSON.parse(r.stdout) as {
      ok: boolean
      checks: { log_endpoint: { ok: boolean; detail: string } }
    }
    expect(report.ok).toBe(false)
    expect(report.checks.log_endpoint.ok).toBe(false)
    expect(report.checks.log_endpoint.detail).toMatch(/unreachable|fetch failed|ECONN/)
  })

  it('doctor: text output (default) names each check on its own line', async () => {
    // Even if log is unreachable, doctor should still produce three readable lines.
    const r = await runCli(['doctor', '--log-endpoint', 'http://127.0.0.1:1/v1/entries'], '', {
      ATRIB_PRIVATE_KEY: seedHex,
      ATRIB_MIRROR_FILE: mirrorPath,
    })
    // Doctor exits non-zero on failure; text still printed.
    expect(r.code).toBe(1)
    expect(r.stdout).toMatch(/key\s+key resolved/)
    expect(r.stdout).toMatch(/log_endpoint\s+log endpoint (reachable|unreachable)/)
    expect(r.stdout).toMatch(/mirror_writable\s+mirror parent (writable|not writable)/)
  })

  it('explicit `emit` subcommand: behaves identically to the default', async () => {
    const envelope = {
      event_type: 'https://atrib.dev/v1/types/observation',
      content: { what: 'explicit-emit-subcommand', topics: ['cli-test'] },
      context_id: 'aaaabbbbccccddddeeeeffff00001112',
    }
    const r = await runCli(['emit', '--log-endpoint', log.url], JSON.stringify(envelope), {
      ATRIB_PRIVATE_KEY: seedHex,
      ATRIB_MIRROR_FILE: mirrorPath,
      ATRIB_AUTOCHAIN_SOURCE: mirrorPath,
    })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout) as { record_hash: string }
    expect(out.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})
