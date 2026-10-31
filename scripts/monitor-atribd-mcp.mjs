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
  let notifyTo
  let reminderHours = 24
  let now = Date.now()
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
    if (arg === '--notify-to') {
      notifyTo = argv[++index]
      if (!notifyTo) throw new Error('--notify-to requires a selector, such as @atrib')
      continue
    }
    if (arg === '--reminder-hours') {
      reminderHours = Number(argv[++index])
      if (!(reminderHours > 0)) throw new Error('--reminder-hours must be a positive number')
      continue
    }
    if (arg === '--now') {
      now = Date.parse(argv[++index])
      if (!Number.isFinite(now)) throw new Error('--now requires an ISO timestamp')
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
    notifyTo,
    reminderMs: reminderHours * 60 * 60 * 1000,
    now,
  }
}

const ALERTS = ['compatibility', 'availability']

function isoOrNull(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function loadState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      compatibility_alert: parsed?.compatibility_alert === true,
      availability_alert: parsed?.availability_alert === true,
      availability_failures:
        Number.isSafeInteger(parsed?.availability_failures) && parsed.availability_failures > 0
          ? parsed.availability_failures
          : 0,
      reminded_at: Object.fromEntries(
        ALERTS.map((alert) => [alert, isoOrNull(parsed?.reminded_at?.[alert])]),
      ),
      agent_pending: Object.fromEntries(
        ALERTS.map((alert) => {
          const pending = parsed?.agent_pending?.[alert]
          return [alert, pending === 'firing' || pending === 'resolved' ? pending : null]
        }),
      ),
    }
  } catch {
    return {
      compatibility_alert: false,
      availability_alert: false,
      availability_failures: 0,
      reminded_at: { compatibility: null, availability: null },
      agent_pending: { compatibility: null, availability: null },
    }
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

// Phone pushes go through the notifier as source atribd-monitor, as before.
// With --notify-to, the monitor also keeps one agent-facing alert per check:
// a separate notifier call with a stable key, no push, and --rousr-strict, so
// a call that did not land is reported and retried on the next cycle instead
// of being lost. A notifier failure never aborts the cycle.
function runNotifier(options, args, timeout) {
  if (options.dryRun) return { status: 'dry-run' }
  const result = spawnSync(NODE, [options.notifier, '--source', 'atribd-monitor', ...args], {
    encoding: 'utf8',
    timeout,
  })
  if (result.status === 0) return { status: 'sent' }
  return {
    status: 'failed',
    exit: result.status,
    error: (result.error?.message || result.stderr || result.stdout || '').trim().slice(0, 300),
  }
}

function pushNotice(options, title, message) {
  // Leaves room for the notifier's own retries (three attempts, 8 s each).
  return runNotifier(options, ['--title', title, '--message', message], 45_000)
}

function agentNotice(options, alert, title, message, resolve) {
  const args = [
    '--title',
    title,
    '--message',
    message,
    '--rousr-key',
    `atribd-mcp:${alert}`,
    '--to',
    options.notifyTo,
    '--no-push',
    '--rousr-strict',
  ]
  if (resolve) args.push('--resolve')
  return runNotifier(options, args, 20_000)
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
  const availabilityFailing = availability.status !== 'pass'
  const availabilityFailures = availabilityFailing ? prior.availability_failures + 1 : 0
  const next = {
    compatibility_alert: compatibility.status === 'alert',
    availability_alert:
      availabilityFailing && (prior.availability_alert || availabilityFailures >= 2),
    availability_failures: availabilityFailures,
  }
  const notifications = []
  const nowIso = new Date(options.now).toISOString()
  const notices = {
    compatibility: {
      opened: [
        'atribd MCP legacy regression',
        `Modern traffic was followed by legacy MCP traffic. ${summary(compatibility.reports)}`,
      ],
      recovered: [
        'atribd MCP legacy regression recovered',
        'No active legacy-after-modern regression remains.',
      ],
      reminder: [
        'atribd MCP legacy regression still open',
        `Legacy MCP traffic after modern traffic is still reported. ${summary(compatibility.reports)}`,
      ],
    },
    availability: {
      opened: [
        'atribd profile availability degraded',
        `Readiness probes failed in two scheduled monitor cycles. ${summary(availability.reports)}`,
      ],
      recovered: [
        'atribd profile availability recovered',
        'All configured atribd readiness probes are passing.',
      ],
      reminder: [
        'atribd profile availability still degraded',
        `Readiness probes are still failing (${availabilityFailures} consecutive cycles). ${summary(availability.reports)}`,
      ],
    },
  }
  next.reminded_at = { ...prior.reminded_at }
  next.agent_pending = { ...prior.agent_pending }
  for (const alert of ALERTS) {
    const open = next[`${alert}_alert`]
    const wasOpen = prior[`${alert}_alert`]
    let agent
    if (open !== wasOpen) {
      const [title, message] = open ? notices[alert].opened : notices[alert].recovered
      notifications.push({
        kind: `${alert}_${open ? 'opened' : 'recovered'}`,
        ...pushNotice(options, title, message),
      })
      agent = open ? { title, message, resolve: false } : { title, message, resolve: true }
    } else if (next.agent_pending[alert] === (open ? 'firing' : 'resolved')) {
      // The last agent notice for this state did not land: send it again.
      const [title, message] = open ? notices[alert].reminder : notices[alert].recovered
      agent = { title, message, resolve: !open, retry: true }
    } else if (open) {
      // Still open: remind the agent sessions (never the phone) once per
      // reminder interval. An alert opened before agent notices existed has
      // no reminded_at, so the first run with --notify-to raises it at once.
      const last = next.reminded_at[alert] ? Date.parse(next.reminded_at[alert]) : -Infinity
      if (options.now - last >= options.reminderMs) {
        const [title, message] = notices[alert].reminder
        agent = { title, message, resolve: false, reminder: true }
      }
    }
    if (!options.notifyTo) {
      // No agent notices: keep no reminder clock, so enabling --notify-to
      // later raises an open alert at once.
      next.reminded_at[alert] = null
      next.agent_pending[alert] = null
      continue
    }
    if (!agent) continue
    const sent = agentNotice(options, alert, agent.title, agent.message, agent.resolve)
    notifications.push({
      kind: `${alert}_agent_${agent.resolve ? 'resolve' : agent.reminder ? 'reminder' : agent.retry ? 'retry' : 'open'}`,
      ...sent,
    })
    if (sent.status === 'failed') {
      next.agent_pending[alert] = agent.resolve ? 'resolved' : 'firing'
    } else {
      next.agent_pending[alert] = null
      next.reminded_at[alert] = agent.resolve ? null : nowIso
    }
  }
  if (!options.dryRun) saveState(options.stateFile, next)
  process.stdout.write(
    `${JSON.stringify({
      schema: 'atrib.atribd-mcp-monitor.v1',
      checked_at: nowIso,
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
