#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global URL, clearTimeout, fetch, process, setTimeout */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MCP_DIST = join(ROOT, 'packages/mcp/dist/index.js')
const HOST_BINARY = join(ROOT, 'services/atrib-emit/dist/local-substrate-host.js')
const CORPUS_ROOT = join(ROOT, 'spec/conformance/local-substrate-coordinator')
const MANIFEST_PATH = join(CORPUS_ROOT, 'manifest.json')
const PROOF_SCHEMA = 'atrib.local-substrate-process-health-proof.v0'
const DEFAULT_TIMEOUT_MS = 750
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 100

function usage() {
  return `Usage:
  node scripts/prove-local-substrate-process-health.mjs [options]

Options:
  --json                         Print the proof report as JSON.
  --report <path>                Write the proof report to a JSON file.
  --use-existing <endpoint>      Probe an already-running coordinator endpoint.
  --health-endpoint <endpoint>   Health endpoint for --use-existing.
  --port <n>                     Port for spawned host. Defaults to 0.
  --host <host>                  Host for spawned host. Defaults to 127.0.0.1.
  --timeout-ms <n>               Per-request timeout. Defaults to 750.
  --log-submission <mode>        enabled or disabled. Defaults to disabled.
  --help                         Print this help.

Run package builds first:
  pnpm --filter @atrib/mcp build
  pnpm --filter @atrib/emit... build
`
}

function parseArgs(argv) {
  const out = {
    json: false,
    reportPath: undefined,
    useExisting: undefined,
    healthEndpoint: undefined,
    host: '127.0.0.1',
    port: 0,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    logSubmission: 'disabled',
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      out.json = true
    } else if (arg === '--report') {
      out.reportPath = requireValue(argv, ++i, '--report')
    } else if (arg === '--use-existing') {
      out.useExisting = requireValue(argv, ++i, '--use-existing')
    } else if (arg === '--health-endpoint') {
      out.healthEndpoint = requireValue(argv, ++i, '--health-endpoint')
    } else if (arg === '--host') {
      out.host = requireValue(argv, ++i, '--host')
    } else if (arg === '--port') {
      out.port = parsePort(requireValue(argv, ++i, '--port'), '--port')
    } else if (arg === '--timeout-ms') {
      out.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms')
    } else if (arg === '--log-submission') {
      out.logSubmission = parseLogSubmission(requireValue(argv, ++i, '--log-submission'))
    } else if (arg === '--help' || arg === '-h') {
      out.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return out
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined) throw new Error(`${flag} requires a value`)
  return value
}

function parsePort(raw, name) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > 65_535) {
    throw new Error(`${name} must be an integer from 0 to 65535`)
  }
  return n
}

function parsePositiveInt(raw, name) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return n
}

function parseLogSubmission(raw) {
  if (raw === 'enabled' || raw === 'disabled') return raw
  throw new Error('--log-submission must be enabled or disabled')
}

function assertFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} is missing at ${path}; run the package builds first`)
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function fixtureSeed(base64urlEncode) {
  return base64urlEncode(new Uint8Array(32).fill(0x11))
}

function deriveHealthEndpoint(endpoint) {
  const url = new URL(endpoint)
  if (url.pathname.endsWith('/health')) return url.toString()
  url.pathname = url.pathname.replace(/\/$/, '') + '/health'
  return url.toString()
}

function psRows() {
  const child = spawn('ps', ['-axo', 'pid=,ppid=,command='], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolveRows) => {
    let stdout = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', () => resolveRows([]))
    child.on('exit', () => {
      const rows = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
          if (!match) return undefined
          return {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            command: match[3],
          }
        })
        .filter(Boolean)
      resolveRows(rows)
    })
  })
}

async function hostChildPids(hostPid) {
  const rows = await psRows()
  return rows.filter((row) => row.ppid === hostPid).map((row) => row.pid).sort((a, b) => a - b)
}

function spawnHost(options, seed) {
  return new Promise((resolveHost, reject) => {
    const child = spawn(
      'node',
      [
        HOST_BINARY,
        '--json',
        '--host',
        options.host,
        '--port',
        String(options.port),
        '--log-submission',
        options.logSubmission,
        '--shutdown-timeout-ms',
        String(DEFAULT_SHUTDOWN_TIMEOUT_MS),
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ATRIB_PRIVATE_KEY: seed,
          ATRIB_AGENT: 'local-substrate-process-health-proof',
          ATRIB_KEYCHAIN_TIMEOUT_MS: '1',
          ATRIB_OP_TIMEOUT_MS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    let resolved = false
    const timer = setTimeout(() => {
      cleanup()
      child.kill('SIGKILL')
      reject(new Error(`host did not become ready; stderr: ${stderr}`))
    }, 5000)
    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
    }
    const onStderr = (chunk) => {
      stderr += String(chunk)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      if (resolved) return
      cleanup()
      reject(new Error(`host exited before ready with code ${code}; stderr: ${stderr}`))
    }
    const onStdout = (chunk) => {
      stdout += String(chunk)
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      try {
        const ready = JSON.parse(stdout.slice(0, newline))
        resolved = true
        cleanup()
        resolveHost({
          mode: 'spawned',
          child,
          pid: ready.pid,
          endpoint: ready.endpoint,
          healthEndpoint: ready.health_endpoint,
          ready,
          stderr: () => stderr,
        })
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

async function closeHost(host) {
  if (host.mode !== 'spawned') return
  await new Promise((resolveClose, reject) => {
    if (host.child.exitCode !== null || host.child.signalCode !== null) {
      resolveClose()
      return
    }
    const timer = setTimeout(() => {
      host.child.kill('SIGKILL')
      reject(new Error('spawned host did not exit after SIGTERM'))
    }, 1500)
    host.child.once('exit', () => {
      clearTimeout(timer)
      resolveClose()
    })
    host.child.kill('SIGTERM')
  })
}

function fail(message, details) {
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : ''
  throw new Error(`${message}${suffix}`)
}

async function fetchHealth(healthEndpoint, validateLocalSubstrateHealthReport) {
  const response = await fetch(healthEndpoint)
  if (!response.ok) {
    fail(`health endpoint returned HTTP ${response.status}`)
  }
  const body = await response.json()
  const report = body?.report ?? body
  const validation = validateLocalSubstrateHealthReport(report)
  if (!validation.ok) {
    fail('health report failed schema validation', validation.issues)
  }
  return { body, report }
}

function loadFixtures(validateLocalSubstrateFixture) {
  const manifest = readJson(MANIFEST_PATH)
  const fixtures = manifest.cases.map((entry) => {
    const fixture = readJson(join(CORPUS_ROOT, entry.file))
    const validation = validateLocalSubstrateFixture(fixture, {
      expectedName: entry.name,
      expectedHarnessClass: fixture.harness_class,
    })
    if (!validation.ok) {
      fail(`fixture ${entry.file} failed validation`, validation.issues)
    }
    return fixture
  })
  const seen = new Set(fixtures.map((fixture) => fixture.harness_class))
  for (const required of manifest.required_harness_classes ?? []) {
    if (!seen.has(required)) fail(`missing required harness fixture: ${required}`)
  }
  return { manifest, fixtures }
}

async function runHarnessProof({
  fixtures,
  host,
  createHttpLocalSubstrateTransport,
  tryLocalSubstrateCoordinator,
  timeoutMs,
}) {
  const transport = createHttpLocalSubstrateTransport(host.endpoint)
  const harnesses = []
  for (const fixture of fixtures) {
    const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
      transport,
      timeoutMs,
      expectedHarnessClass: fixture.harness_class,
      directRecordBody: fixture.input.direct_record_body,
    })
    if (!result.ok) {
      fail(`coordinator did not accept ${fixture.name}`, result)
    }
    const response = result.response
    if (fixture.harness_class === 'watcher-wal' && !response.receipt_id) {
      fail('watcher-wal response did not include a receipt id', response)
    }
    if (response.health_report?.processes?.stale_children !== 0) {
      fail(`${fixture.name} returned stale child health`, response.health_report)
    }
    if (response.health_report?.wal?.orphan_receipts !== 0) {
      fail(`${fixture.name} returned orphan receipt health`, response.health_report)
    }
    harnesses.push({
      name: fixture.name,
      harness_class: fixture.harness_class,
      operation: fixture.input.coordinator_request.operation,
      record_hash: response.record_hash,
      receipt_id: response.receipt_id,
      elapsed_ms: result.elapsed_ms,
      active_context_count: response.health_report?.contexts?.active?.length ?? null,
    })
  }
  return harnesses
}

async function proveFallback({
  fixture,
  createHttpLocalSubstrateTransport,
  tryLocalSubstrateCoordinator,
}) {
  const unavailableEndpoint = 'http://127.0.0.1:9/atrib/local-substrate'
  const result = await tryLocalSubstrateCoordinator(fixture.input.coordinator_request, {
    transport: createHttpLocalSubstrateTransport(unavailableEndpoint),
    timeoutMs: 100,
    expectedHarnessClass: fixture.harness_class,
    directRecordBody: fixture.input.direct_record_body,
  })
  if (result.ok || result.status !== 'unavailable') {
    fail('unavailable coordinator did not classify as fallback-safe unavailable', result)
  }
  return {
    status: result.status,
    reason: result.reason,
    elapsed_ms: result.elapsed_ms,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }

  assertFile(MCP_DIST, '@atrib/mcp dist entrypoint')
  assertFile(HOST_BINARY, 'atrib-local-substrate host binary')
  assertFile(MANIFEST_PATH, 'local-substrate coordinator manifest')

  const mcp = await import(pathToFileURL(MCP_DIST).href)
  const {
    base64urlEncode,
    createHttpLocalSubstrateTransport,
    tryLocalSubstrateCoordinator,
    validateLocalSubstrateFixture,
    validateLocalSubstrateHealthReport,
  } = mcp

  const { manifest, fixtures } = loadFixtures(validateLocalSubstrateFixture)
  let host
  const startedAt = Date.now()

  if (args.useExisting) {
    host = {
      mode: 'existing',
      pid: null,
      endpoint: args.useExisting,
      healthEndpoint: args.healthEndpoint ?? deriveHealthEndpoint(args.useExisting),
      ready: null,
    }
  } else {
    host = await spawnHost(args, fixtureSeed(base64urlEncode))
  }

  try {
    const childPidsBefore = host.pid ? await hostChildPids(host.pid) : []
    const harnesses = await runHarnessProof({
      fixtures,
      host,
      createHttpLocalSubstrateTransport,
      tryLocalSubstrateCoordinator,
      timeoutMs: args.timeoutMs,
    })
    const health = await fetchHealth(host.healthEndpoint, validateLocalSubstrateHealthReport)
    const childPidsAfter = host.pid ? await hostChildPids(host.pid) : []
    const fallback = await proveFallback({
      fixture: fixtures.find((fixture) => fixture.harness_class === 'startup-spawn') ?? fixtures[0],
      createHttpLocalSubstrateTransport,
      tryLocalSubstrateCoordinator,
    })

    if (health.report.processes.stale_children !== 0) {
      fail('final health report has stale children', health.report)
    }
    if (health.report.wal.orphan_receipts !== 0) {
      fail('final health report has orphan receipts', health.report)
    }
    if (childPidsAfter.length > 0) {
      fail('spawned coordinator left child processes alive', childPidsAfter)
    }

    const expectedContexts = fixtures.map(
      (fixture) => fixture.input.coordinator_request.record_body.context_id,
    )
    const missingContexts = expectedContexts.filter(
      (contextId) => !health.report.contexts.active.includes(contextId),
    )
    if (missingContexts.length > 0) {
      fail('final health report is missing active harness contexts', missingContexts)
    }

    const report = {
      schema: PROOF_SCHEMA,
      generated_at: new Date().toISOString(),
      manifest: {
        path: 'spec/conformance/local-substrate-coordinator/manifest.json',
        spec_section: manifest.spec_section,
        required_harness_classes: manifest.required_harness_classes,
      },
      host: {
        mode: host.mode,
        pid: host.pid,
        endpoint: host.endpoint,
        health_endpoint: host.healthEndpoint,
        version: health.report.coordinator.version,
        transport: health.report.coordinator.transport,
      },
      checks: {
        harness_count: harnesses.length,
        fallback_unavailable_classified: fallback.status === 'unavailable',
        final_stale_children: health.report.processes.stale_children,
        final_orphan_receipts: health.report.wal.orphan_receipts,
        spawned_child_pids_before: childPidsBefore,
        spawned_child_pids_after: childPidsAfter,
        elapsed_ms: Date.now() - startedAt,
      },
      harnesses,
      fallback,
      final_health_report: health.report,
    }

    if (args.reportPath) {
      const absolute = resolve(ROOT, args.reportPath)
      writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`)
    }

    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(
        [
          'local-substrate process-health proof passed',
          `host: ${report.host.mode} ${report.host.endpoint}`,
          `harnesses: ${harnesses.map((harness) => harness.harness_class).join(', ')}`,
          `fallback: ${fallback.status}`,
          `health: stale_children=${report.checks.final_stale_children}, orphan_receipts=${report.checks.final_orphan_receipts}`,
        ].join('\n') + '\n',
      )
    }
  } finally {
    await closeHost(host)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
