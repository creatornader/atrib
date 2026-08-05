#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const NODE = process.execPath
const DEFAULT_ENDPOINTS = [
  'http://127.0.0.1:8792/mcp/ready',
  'http://127.0.0.1:8795/mcp/ready',
  'http://127.0.0.1:8796/mcp/ready',
]

function parseArgs(argv) {
  const endpoints = []
  let notifier = join(homedir(), '.claude', 'scripts', 'moshi-notify.mjs')
  let stateFile = join(homedir(), '.atrib', 'state', 'atribd-mcp-monitor.json')
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--endpoint') {
      const endpoint = argv[++index]
      if (!endpoint) throw new Error('--endpoint requires a URL')
      endpoints.push(endpoint)
      continue
    }
    if (arg === '--notifier') {
      notifier = argv[++index]
      if (!notifier) throw new Error('--notifier requires a path')
      continue
    }
    if (arg === '--state-file') {
      stateFile = argv[++index]
      if (!stateFile) throw new Error('--state-file requires a path')
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return {
    endpoints: endpoints.length ? endpoints : DEFAULT_ENDPOINTS,
    notifier,
    stateFile,
    dryRun,
  }
}

function loadState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      compatibility_alert: parsed?.compatibility_alert === true,
      availability_alert: parsed?.availability_alert === true,
    }
  } catch {
    return { compatibility_alert: false, availability_alert: false }
  }
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function runJson(script, args) {
  const result = spawnSync(NODE, [script, '--json', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error(`${script} did not return JSON: ${result.stderr || result.stdout}`)
  }
}

function summary(reports) {
  return reports
    .filter((report) => report.status !== 'pass')
    .map((report) => `${report.profile ?? report.endpoint}: ${report.reason ?? report.status}`)
    .join('; ')
}

function notify(notifier, title, message, dryRun) {
  if (dryRun) return { status: 'dry-run' }
  const result = spawnSync(
    NODE,
    [notifier, '--source', 'codex', '--title', title, '--message', message],
    {
      encoding: 'utf8',
      timeout: 15_000,
    },
  )
  if (result.status !== 0) {
    throw new Error(`notification failed: ${result.stderr || result.stdout}`)
  }
  return { status: 'sent' }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const compatibilityEndpoints = options.endpoints.map((endpoint) =>
    endpoint.replace(/\/ready$/, '/health'),
  )
  const endpointArgs = options.endpoints.flatMap((endpoint) => ['--endpoint', endpoint])
  const compatibilityArgs = compatibilityEndpoints.flatMap((endpoint) => ['--endpoint', endpoint])
  const compatibility = runJson(
    join(SCRIPT_DIR, 'check-mcp-compatibility-alerts.mjs'),
    compatibilityArgs,
  )
  const availability = runJson(join(SCRIPT_DIR, 'check-atribd-availability.mjs'), [
    '--attempts',
    '3',
    '--timeout-ms',
    '1000',
    ...endpointArgs,
  ])
  const prior = loadState(options.stateFile)
  const next = {
    compatibility_alert: compatibility.status === 'alert',
    availability_alert: availability.status !== 'pass',
  }
  const notifications = []
  if (next.compatibility_alert && !prior.compatibility_alert) {
    notifications.push({
      kind: 'compatibility_opened',
      ...notify(
        options.notifier,
        'atribd MCP legacy regression',
        `Modern traffic was followed by legacy MCP traffic. ${summary(compatibility.reports)}`,
        options.dryRun,
      ),
    })
  }
  if (!next.compatibility_alert && prior.compatibility_alert) {
    notifications.push({
      kind: 'compatibility_recovered',
      ...notify(
        options.notifier,
        'atribd MCP legacy regression recovered',
        'No active legacy-after-modern regression remains.',
        options.dryRun,
      ),
    })
  }
  if (next.availability_alert && !prior.availability_alert) {
    notifications.push({
      kind: 'availability_opened',
      ...notify(
        options.notifier,
        'atribd profile availability degraded',
        `Three readiness probes failed before alerting. ${summary(availability.reports)}`,
        options.dryRun,
      ),
    })
  }
  if (!next.availability_alert && prior.availability_alert) {
    notifications.push({
      kind: 'availability_recovered',
      ...notify(
        options.notifier,
        'atribd profile availability recovered',
        'All configured atribd readiness probes are passing.',
        options.dryRun,
      ),
    })
  }
  if (!options.dryRun) saveState(options.stateFile, next)
  process.stdout.write(
    `${JSON.stringify({
      schema: 'atrib.atribd-mcp-monitor.v1',
      checked_at: new Date().toISOString(),
      compatibility,
      availability,
      alerts: next,
      notifications,
    })}\n`,
  )
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 2
}
