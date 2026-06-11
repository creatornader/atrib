// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  createHttpLocalSubstrateTransport,
  tryLocalSubstrateCoordinator,
  type LocalSubstrateCoordinatorRequest,
  type LocalSubstrateCoordinatorResponse,
  type LocalSubstrateFixture,
} from '@atrib/mcp'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const corpusRoot = fileURLToPath(
  new URL('../../../spec/conformance/local-substrate-coordinator/', import.meta.url),
)

interface HostReadyEvent {
  event: 'ready'
  name: 'atrib-local-substrate'
  version: string
  pid: number
  url: string
  endpoint: string
  health_endpoint: string
}

interface SpawnedHost {
  child: ChildProcess
  ready: HostReadyEvent
  stderr: () => string
  close: () => Promise<void>
}

const spawned: SpawnedHost[] = []

afterEach(async () => {
  await Promise.all(spawned.splice(0).map((host) => host.close()))
})

function readFixture(relativePath: string): LocalSubstrateFixture {
  return JSON.parse(readFileSync(new URL(relativePath, `file://${corpusRoot}/`), 'utf8'))
}

function fixtureSeed(): string {
  return base64urlEncode(new Uint8Array(32).fill(0x11))
}

function spawnHost(args: string[] = []): Promise<SpawnedHost> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [
        join(__dirname, '..', 'dist', 'local-substrate-host.js'),
        '--json',
        '--port',
        '0',
        '--log-submission',
        'disabled',
        '--shutdown-timeout-ms',
        '50',
        ...args,
      ],
      {
        env: {
          ...process.env,
          ATRIB_PRIVATE_KEY: fixtureSeed(),
          ATRIB_AGENT: 'local-substrate-host-test',
          ATRIB_KEYCHAIN_TIMEOUT_MS: '1',
          ATRIB_OP_TIMEOUT_MS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    let resolved = false
    const cleanup = (): void => {
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onStderr = (chunk: Buffer): void => {
      stderr += String(chunk)
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number | null): void => {
      if (resolved) return
      cleanup()
      reject(new Error(`host exited before ready with code ${code}; stderr: ${stderr}`))
    }
    const onStdout = (chunk: Buffer): void => {
      stdout += String(chunk)
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      try {
        const ready = JSON.parse(stdout.slice(0, newline)) as HostReadyEvent
        resolved = true
        cleanup()
        const host: SpawnedHost = {
          child,
          ready,
          stderr: () => stderr,
          close: () => closeChild(child),
        }
        spawned.push(host)
        resolve(host)
      } catch (error) {
        cleanup()
        reject(error)
      }
    }

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.on('error', onError)
    child.on('exit', onExit)
  })
}

function closeChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('host did not exit after SIGTERM'))
    }, 1500)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function postFixture(
  host: SpawnedHost,
  fixture: LocalSubstrateFixture,
): Promise<LocalSubstrateCoordinatorResponse> {
  const request = fixture.input.coordinator_request
  const result = await tryLocalSubstrateCoordinator(request, {
    transport: createHttpLocalSubstrateTransport(host.ready.endpoint),
    expectedHarnessClass: fixture.harness_class,
    directRecordBody: fixture.input.direct_record_body,
  })

  if (!result.ok) {
    throw new Error(`unexpected ${result.status}: ${JSON.stringify(result)}`)
  }

  return result.response
}

describe('atrib-local-substrate host binary', () => {
  it('prints version and contract metadata', async () => {
    const version = await runOneShot(['--version'])
    expect(version.code).toBe(0)
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)

    const describeResult = await runOneShot(['--describe'])
    expect(describeResult.code).toBe(0)
    const description = JSON.parse(describeResult.stdout) as { name: string; options: unknown[] }
    expect(description.name).toBe('atrib-local-substrate')
    expect(description.options.length).toBeGreaterThan(0)
  })

  it('serves startup-spawn, long-lived-agent, and watcher-WAL requests over HTTP', async () => {
    const host = await spawnHost()
    expect(host.ready.name).toBe('atrib-local-substrate')
    expect(host.ready.endpoint).toContain('/atrib/local-substrate')

    const startup = readFixture('cases/startup-spawn-codex-tool-call.json')
    const longLived = readFixture('cases/long-lived-assistant-observation.json')
    const watcher = readFixture('cases/watcher-wal-annotation.json')

    for (const fixture of [startup, longLived, watcher]) {
      const response = await postFixture(host, fixture)
      expect(response.status).toBe('accepted')
      expect(response.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(response.health_report?.coordinator.pid).toBe(host.ready.pid)
      expect(response.health_report?.contexts.active).toContain(
        fixture.input.coordinator_request.record_body.context_id,
      )
      if (fixture.input.coordinator_request.operation === 'enqueue_record_and_join_receipt') {
        expect(response.receipt_id).toBeTruthy()
      }
    }

    const healthResponse = await fetch(host.ready.health_endpoint)
    expect(healthResponse.status).toBe(200)
    const health = (await healthResponse.json()) as {
      ok: boolean
      report: { coordinator: { transport: string }; contexts: { active: string[] } }
    }
    expect(health.ok).toBe(true)
    expect(health.report.coordinator.transport).toBe('node-http')
    expect(health.report.contexts.active).toEqual(
      expect.arrayContaining([
        startup.input.coordinator_request.record_body.context_id,
        longLived.input.coordinator_request.record_body.context_id,
        watcher.input.coordinator_request.record_body.context_id,
      ]),
    )
  })

  it('honors the harness class allow-list', async () => {
    const host = await spawnHost(['--harness-classes', 'startup-spawn'])
    const watcher = readFixture('cases/watcher-wal-annotation.json')
    const request: LocalSubstrateCoordinatorRequest = watcher.input.coordinator_request

    const raw = await fetch(host.ready.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    expect(raw.status).toBe(200)
    const response = (await raw.json()) as LocalSubstrateCoordinatorResponse
    expect(response.status).toBe('rejected')
    expect(response.rejection_reason).toContain('unsupported harness class')
  })
})

interface OneShotResult {
  stdout: string
  stderr: string
  code: number | null
}

function runOneShot(args: string[]): Promise<OneShotResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      [join(__dirname, '..', 'dist', 'local-substrate-host.js'), ...args],
      {
        env: {
          ...process.env,
          ATRIB_PRIVATE_KEY: fixtureSeed(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code }))
  })
}
