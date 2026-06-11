#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global AbortController, URL, clearTimeout, fetch, process, setTimeout */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const HOME = process.env.HOME || ''
const SCHEMA = 'atrib.local-substrate-topology-report.v0'
const SNAPSHOT_SCHEMA = 'atrib.local-substrate-topology-snapshot.v0'
const DEFAULT_HEALTH_TIMEOUT_MS = 400
const PRIMITIVE_SERVERS = [
  'atrib-emit',
  'atrib-annotate',
  'atrib-revise',
  'atrib-recall',
  'atrib-trace',
  'atrib-summarize',
  'atrib-verify',
]

function usage() {
  return `Usage:
  node scripts/report-local-substrate-topology.mjs [options]

Options:
  --json                  Print JSON instead of the text summary.
  --snapshot <path>       Build the report from a fixture snapshot.
  --timeout-ms <n>        Live coordinator health timeout. Defaults to 400.
  --help                  Print this help.

The live report reads process rows, local MCP config summaries, launchd
service metadata, and local-substrate health probes. It does not print raw
config files or environment secrets.
`
}

function parseArgs(argv) {
  const out = {
    json: false,
    snapshotPath: undefined,
    timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      out.json = true
    } else if (arg === '--snapshot') {
      out.snapshotPath = requireValue(argv, ++i, '--snapshot')
    } else if (arg === '--timeout-ms') {
      out.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms')
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

function parsePositiveInt(raw, name) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return n
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function displayPath(path) {
  if (!HOME || !path.startsWith(HOME)) return path
  return `~${path.slice(HOME.length)}`
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) return undefined
  return result.stdout
}

function collectProcessRows() {
  const stdout = run('ps', ['-axo', 'pid=,ppid=,lstart=,command='])
  if (!stdout) return []
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const withStart = line.match(
        /^(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/,
      )
      if (withStart) {
        return {
          pid: Number(withStart[1]),
          ppid: Number(withStart[2]),
          started_at: parsePsStart(withStart[3]),
          command: withStart[4],
        }
      }
      const fallback = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (!fallback) return undefined
      return {
        pid: Number(fallback[1]),
        ppid: Number(fallback[2]),
        command: fallback[3],
      }
    })
    .filter(Boolean)
}

function parsePsStart(raw) {
  const date = new Date(raw)
  return Number.isNaN(date.valueOf()) ? raw : date.toISOString()
}

function serviceNameForCommand(command) {
  if (command.includes('/services/atrib-primitives/dist/index.js')) return 'atrib-primitives'
  if (command.includes('/local-substrate-host.js')) return 'atrib-local-substrate'
  for (const name of PRIMITIVE_SERVERS) {
    const stem = name.replace('atrib-', '')
    if (
      command.includes(`/services/${name}/dist/`) ||
      command.includes(`/services/${name}/dist/${stem}`)
    ) {
      return name
    }
  }
  if (command.includes('/agent-bridge')) return 'agent-bridge'
  if (command.includes('codex app-server')) return 'codex-app-server'
  if (command === 'claude' || command.endsWith('/claude')) return 'claude-code'
  return undefined
}

function processLabel(row) {
  return serviceNameForCommand(row.command) ?? 'other'
}

function summarizeProcesses(processes) {
  const rows = processes.map((row) => ({
    ...row,
    service: row.service ?? processLabel(row),
  }))
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const primitiveRuntime = rows.filter((row) => row.service === 'atrib-primitives')
  const coordinator = rows.filter((row) => row.service === 'atrib-local-substrate')
  const bridge = rows.filter((row) => row.service === 'agent-bridge')
  const standalone = rows.filter((row) => PRIMITIVE_SERVERS.includes(row.service))

  const standaloneGroups = [...groupBy(standalone, (row) => row.ppid).entries()]
    .map(([ppid, group]) => {
      const parent = byPid.get(ppid)
      return {
        ppid,
        parent_service: parent?.service ?? 'unknown',
        parent_label: parent ? processLabel(parent) : 'unknown',
        process_count: group.length,
        services: unique(group.map((row) => row.service)).sort(),
        pids: group.map((row) => row.pid).sort((a, b) => a - b),
        ...startWindow(group),
      }
    })
    .sort((a, b) => b.process_count - a.process_count || a.ppid - b.ppid)

  const runtimeGroups = [...groupBy(primitiveRuntime, (row) => row.ppid).entries()]
    .map(([ppid, group]) => {
      const parent = byPid.get(ppid)
      return {
        ppid,
        parent_service: parent?.service ?? 'unknown',
        process_count: group.length,
        pids: group.map((row) => row.pid).sort((a, b) => a - b),
        ...startWindow(group),
      }
    })
    .sort((a, b) => b.process_count - a.process_count || a.ppid - b.ppid)

  return {
    total_processes_seen: rows.length,
    coordinator_processes: coordinator.length,
    primitive_runtime_processes: primitiveRuntime.length,
    standalone_primitive_processes: standalone.length,
    standalone_primitive_groups: standaloneGroups.length,
    duplicate_primitive_groups: standaloneGroups.filter((group) => group.process_count >= 3).length,
    bridge_processes: bridge.length,
    runtime_groups: runtimeGroups,
    standalone_groups: standaloneGroups,
  }
}

function startWindow(rows) {
  const started = rows
    .map((row) => row.started_at)
    .filter(Boolean)
    .sort()
  if (started.length === 0) return {}
  return {
    oldest_started_at: started[0],
    newest_started_at: started[started.length - 1],
  }
}

function groupBy(values, keyFn) {
  const grouped = new Map()
  for (const value of values) {
    const key = keyFn(value)
    const list = grouped.get(key) ?? []
    list.push(value)
    grouped.set(key, list)
  }
  return grouped
}

function summarizeCodexConfig(path) {
  if (!existsSync(path)) {
    return missingConfig('codex', path)
  }
  const text = readFileSync(path, 'utf8')
  const serverNames = [...text.matchAll(/^\[mcp_servers\.([^\]\s]+)\]/gm)].map((match) =>
    match[1].replace(/^"|"$/g, ''),
  )
  return summarizeServerConfig({
    name: 'codex',
    path,
    serverNames,
    text,
  })
}

function summarizeClaudeConfig(path) {
  if (!existsSync(path)) {
    return missingConfig('claude-code', path)
  }
  try {
    const parsed = readJson(path)
    const servers =
      parsed.mcpServers && typeof parsed.mcpServers === 'object' ? parsed.mcpServers : {}
    const serverNames = Object.keys(servers)
    const endpointValues = []
    for (const server of Object.values(servers)) {
      const env = server && typeof server === 'object' ? server.env : undefined
      if (env?.ATRIB_LOCAL_SUBSTRATE_ENDPOINT)
        endpointValues.push(env.ATRIB_LOCAL_SUBSTRATE_ENDPOINT)
    }
    return summarizeServerConfig({
      name: 'claude-code',
      path,
      serverNames,
      endpointValues,
      text: JSON.stringify(servers),
    })
  } catch (error) {
    return {
      name: 'claude-code',
      path: displayPath(path),
      exists: true,
      parse_error: error instanceof Error ? error.message : String(error),
      has_primitives_runtime: false,
      standalone_primitive_servers: [],
      local_substrate_endpoints: [],
    }
  }
}

function missingConfig(name, path) {
  return {
    name,
    path: displayPath(path),
    exists: false,
    has_primitives_runtime: false,
    standalone_primitive_servers: [],
    local_substrate_endpoints: [],
  }
}

function summarizeServerConfig({ name, path, serverNames, text, endpointValues = [] }) {
  const standalone = serverNames
    .filter((serverName) => PRIMITIVE_SERVERS.includes(serverName))
    .sort()
  const endpoints = [
    ...endpointValues,
    ...[...text.matchAll(/ATRIB_LOCAL_SUBSTRATE_ENDPOINT["'\s:=]+["']([^"']+)["']/g)].map(
      (match) => match[1],
    ),
  ]
  return {
    name,
    path: displayPath(path),
    exists: true,
    server_count: serverNames.length,
    has_primitives_runtime: serverNames.includes('atrib-primitives'),
    standalone_primitive_servers: standalone,
    local_substrate_endpoints: unique(endpoints),
  }
}

function parseLaunchAgent(path) {
  const stdout = run('plutil', ['-convert', 'json', '-o', '-', path])
  if (!stdout) return undefined
  try {
    const parsed = JSON.parse(stdout)
    const args = Array.isArray(parsed.ProgramArguments) ? parsed.ProgramArguments.map(String) : []
    const env =
      parsed.EnvironmentVariables && typeof parsed.EnvironmentVariables === 'object'
        ? parsed.EnvironmentVariables
        : {}
    const endpoint =
      env.ATRIB_LOCAL_SUBSTRATE_ENDPOINT ||
      env.SECOND_BRAIN_ATRIB_LOCAL_SUBSTRATE_ENDPOINT ||
      endpointFromProgramArguments(args)
    return {
      label: parsed.Label ?? undefined,
      path: displayPath(path),
      kind: String(parsed.Label ?? '').includes('atrib-drain') ? 'watcher-wal' : 'coordinator',
      program: args[0] ?? undefined,
      endpoint,
      agent: env.ATRIB_AGENT || env.SECOND_BRAIN_ATRIB_AGENT || undefined,
      start_interval: parsed.StartInterval ?? undefined,
    }
  } catch {
    return undefined
  }
}

function endpointFromProgramArguments(args) {
  const host = valueAfter(args, '--host') ?? '127.0.0.1'
  const port = valueAfter(args, '--port')
  if (!port) return undefined
  return `http://${host}:${port}/atrib/local-substrate`
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

function collectLaunchAgents() {
  const dir = join(HOME, 'Library/LaunchAgents')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(
      (name) =>
        name === 'com.nader.atrib-drain.plist' ||
        name.startsWith('com.nader.atrib-local-substrate.'),
    )
    .map((name) => parseLaunchAgent(join(dir, name)))
    .filter(Boolean)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

function healthEndpointFor(endpoint) {
  try {
    const url = new URL(endpoint)
    if (!url.pathname.endsWith('/health')) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/health'
    }
    return url.toString()
  } catch {
    return endpoint
  }
}

async function fetchHealth(endpoint, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(healthEndpointFor(endpoint), { signal: controller.signal })
    if (!response.ok) {
      return {
        endpoint,
        reachable: false,
        status: 'http-error',
        http_status: response.status,
        elapsed_ms: Date.now() - startedAt,
      }
    }
    const body = await response.json()
    const report = body?.report ?? body
    return {
      endpoint,
      reachable: true,
      status: body?.status ?? 'unknown',
      elapsed_ms: Date.now() - startedAt,
      report,
    }
  } catch (error) {
    return {
      endpoint,
      reachable: false,
      status: 'unreachable',
      reason: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function collectLiveSnapshot({ timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS } = {}) {
  const launchAgents = collectLaunchAgents()
  const configs = [
    summarizeCodexConfig(join(HOME, '.codex/config.toml')),
    summarizeClaudeConfig(join(HOME, '.claude.json')),
  ]
  const endpoints = unique([
    ...launchAgents.map((agent) => agent.endpoint),
    ...configs.flatMap((config) => config.local_substrate_endpoints ?? []),
  ])
  const coordinatorHealth = []
  for (const endpoint of endpoints) {
    if (!endpoint) continue
    coordinatorHealth.push(await fetchHealth(endpoint, timeoutMs))
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    source: 'live',
    generated_at: new Date().toISOString(),
    processes: collectProcessRows(),
    configs,
    launch_agents: launchAgents,
    coordinator_health: coordinatorHealth,
  }
}

function normalizeSnapshot(snapshot) {
  if (snapshot.snapshot && typeof snapshot.snapshot === 'object') return snapshot.snapshot
  return snapshot
}

function healthSummary(items) {
  return items.map((item) => {
    const report = item.report ?? {}
    return {
      endpoint: item.endpoint,
      reachable: Boolean(item.reachable),
      status: item.status,
      pid: report.coordinator?.pid,
      version: report.coordinator?.version,
      transport: report.coordinator?.transport,
      creator_key_scope: report.coordinator?.creator_key_scope,
      log_submission_depth: report.queues?.log_submission_depth,
      stale_children: report.processes?.stale_children,
      orphan_receipts: report.wal?.orphan_receipts,
      active_contexts: report.contexts?.active?.length,
      reason: item.reason,
      http_status: item.http_status,
    }
  })
}

function gate(name, status, detail) {
  return { name, status, detail }
}

function buildGates({ processSummary, configs, launchAgents, health }) {
  const reachableHealth = health.filter((item) => item.reachable && item.status === 'healthy')
  const unhealthyReachable = health.filter((item) => item.reachable && item.status !== 'healthy')
  const unreachable = health.filter((item) => !item.reachable)
  const healthHasBacklog = reachableHealth.some(
    (item) =>
      Number(item.report?.processes?.stale_children ?? 0) > 0 ||
      Number(item.report?.wal?.orphan_receipts ?? 0) > 0,
  )

  const gates = []
  if (reachableHealth.length === 0) {
    gates.push(
      gate(
        'coordinator-health',
        'fail',
        'no healthy local-substrate coordinator endpoint responded',
      ),
    )
  } else if (unreachable.length > 0 || unhealthyReachable.length > 0 || healthHasBacklog) {
    gates.push(
      gate(
        'coordinator-health',
        'warn',
        `${reachableHealth.length} healthy endpoint(s), ${unreachable.length} unreachable, ${unhealthyReachable.length} unhealthy or unknown`,
      ),
    )
  } else {
    gates.push(gate('coordinator-health', 'pass', `${reachableHealth.length} healthy endpoint(s)`))
  }

  if (
    processSummary.primitive_runtime_processes > 0 &&
    processSummary.standalone_primitive_processes === 0
  ) {
    gates.push(
      gate(
        'startup-spawn-mcp-collapse',
        'pass',
        'startup-spawn process list uses atrib-primitives without standalone primitive bundles',
      ),
    )
  } else if (processSummary.primitive_runtime_processes > 0) {
    gates.push(
      gate(
        'startup-spawn-mcp-collapse',
        'warn',
        `${processSummary.primitive_runtime_processes} atrib-primitives process(es) plus ${processSummary.standalone_primitive_processes} standalone primitive process(es)`,
      ),
    )
  } else if (processSummary.standalone_primitive_processes > 0) {
    gates.push(
      gate(
        'startup-spawn-mcp-collapse',
        'fail',
        `${processSummary.standalone_primitive_processes} standalone primitive process(es), no atrib-primitives process`,
      ),
    )
  } else {
    gates.push(
      gate(
        'startup-spawn-mcp-collapse',
        'warn',
        'no startup-spawn atrib primitive process evidence found',
      ),
    )
  }

  const existingConfigs = configs.filter((config) => config.exists)
  const configsWithRuntime = existingConfigs.filter((config) => config.has_primitives_runtime)
  const configsWithEndpoint = existingConfigs.filter(
    (config) => (config.local_substrate_endpoints ?? []).length > 0,
  )
  const configsWithStandalone = existingConfigs.filter(
    (config) => (config.standalone_primitive_servers ?? []).length > 0,
  )
  if (
    existingConfigs.length > 0 &&
    configsWithRuntime.length === existingConfigs.length &&
    configsWithEndpoint.length === existingConfigs.length &&
    configsWithStandalone.length === 0
  ) {
    gates.push(
      gate(
        'startup-spawn-config',
        'pass',
        'configured startup-spawn surfaces point at atrib-primitives and local-substrate endpoints',
      ),
    )
  } else {
    gates.push(
      gate(
        'startup-spawn-config',
        configsWithRuntime.length > 0 ? 'warn' : 'fail',
        `${configsWithRuntime.length}/${existingConfigs.length} config(s) use atrib-primitives, ${configsWithEndpoint.length}/${existingConfigs.length} have local-substrate endpoints, ${configsWithStandalone.length} still declare standalone primitives`,
      ),
    )
  }

  const watcherAgents = launchAgents.filter((agent) => agent.kind === 'watcher-wal')
  const watcherEndpoints = unique(watcherAgents.map((agent) => agent.endpoint))
  const reachableEndpoints = new Set(reachableHealth.map((item) => item.endpoint))
  const watcherReachable = watcherEndpoints.some((endpoint) => reachableEndpoints.has(endpoint))
  if (watcherAgents.length > 0 && watcherReachable) {
    gates.push(
      gate(
        'watcher-wal-route',
        'pass',
        'watcher-WAL launch agent points at a healthy coordinator endpoint',
      ),
    )
  } else if (watcherAgents.length > 0) {
    gates.push(
      gate(
        'watcher-wal-route',
        'warn',
        'watcher-WAL launch agent exists, but its coordinator endpoint is not healthy',
      ),
    )
  } else {
    gates.push(gate('watcher-wal-route', 'warn', 'no watcher-WAL launch agent evidence found'))
  }

  const broadReady = gates.every((item) => item.status === 'pass')
  gates.push(
    gate(
      'broad-default-readiness',
      broadReady ? 'pass' : 'fail',
      broadReady
        ? 'all topology gates passed'
        : 'do not make coordinator or collapsed primitive runtime broad defaults yet',
    ),
  )

  return gates
}

function statusFromGates(gates) {
  if (gates.find((item) => item.name === 'broad-default-readiness')?.status === 'pass') {
    return 'ready_for_default_trial'
  }
  if (gates.some((item) => item.status === 'fail' && item.name === 'coordinator-health')) {
    return 'blocked'
  }
  return 'mixed'
}

function buildReport(input, options = {}) {
  const snapshot = normalizeSnapshot(input)
  const processes = Array.isArray(snapshot.processes) ? snapshot.processes : []
  const configs = Array.isArray(snapshot.configs) ? snapshot.configs : []
  const launchAgents = Array.isArray(snapshot.launch_agents) ? snapshot.launch_agents : []
  const health = Array.isArray(snapshot.coordinator_health) ? snapshot.coordinator_health : []
  const processSummary = summarizeProcesses(processes)
  const gates = buildGates({ processSummary, configs, launchAgents, health })
  const status = statusFromGates(gates)

  return {
    schema: SCHEMA,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    source: snapshot.source ?? 'snapshot',
    summary: {
      status,
      healthy_coordinators: health.filter((item) => item.reachable && item.status === 'healthy')
        .length,
      configured_coordinators: launchAgents.filter((agent) => agent.kind === 'coordinator').length,
      primitive_runtime_processes: processSummary.primitive_runtime_processes,
      standalone_primitive_processes: processSummary.standalone_primitive_processes,
      duplicate_primitive_groups: processSummary.duplicate_primitive_groups,
      watcher_wal_launch_agents: launchAgents.filter((agent) => agent.kind === 'watcher-wal')
        .length,
    },
    gates,
    coordinators: healthSummary(health),
    process_inventory: processSummary,
    config_surfaces: configs,
    launch_agents: launchAgents,
    recommendations: recommendationsFor({ status, gates, processSummary }),
  }
}

function recommendationsFor({ status, gates, processSummary }) {
  if (status === 'ready_for_default_trial') {
    return ['run a restart-to-measure pass before widening default config']
  }
  const recommendations = []
  if (gates.find((item) => item.name === 'coordinator-health')?.status !== 'pass') {
    recommendations.push(
      'restore healthy local-substrate coordinator endpoints before relying on coordinator-owned paths',
    )
  }
  if (processSummary.standalone_primitive_processes > 0) {
    recommendations.push(
      'restart or reconfigure startup-spawn harnesses that still launch standalone atrib primitive servers',
    )
  }
  if (gates.find((item) => item.name === 'startup-spawn-config')?.status !== 'pass') {
    recommendations.push(
      'keep Codex and Claude Code config on atrib-primitives plus explicit local-substrate endpoints',
    )
  }
  if (gates.find((item) => item.name === 'watcher-wal-route')?.status !== 'pass') {
    recommendations.push(
      'point watcher-WAL launch agents at a healthy coordinator endpoint before making watcher commit mode default',
    )
  }
  return recommendations
}

function formatTextReport(report) {
  const lines = [
    `local-substrate topology: ${report.summary.status}`,
    `coordinators: healthy=${report.summary.healthy_coordinators}, configured=${report.summary.configured_coordinators}`,
    `startup-spawn processes: atrib-primitives=${report.summary.primitive_runtime_processes}, standalone-primitives=${report.summary.standalone_primitive_processes}, duplicate-groups=${report.summary.duplicate_primitive_groups}`,
    `watcher-WAL launch agents: ${report.summary.watcher_wal_launch_agents}`,
    '',
    'gates:',
  ]
  for (const gateResult of report.gates) {
    lines.push(`  ${gateResult.status.toUpperCase()} ${gateResult.name}: ${gateResult.detail}`)
  }
  if (report.recommendations.length > 0) {
    lines.push('', 'next:')
    for (const recommendation of report.recommendations) {
      lines.push(`  - ${recommendation}`)
    }
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }
  const snapshot = args.snapshotPath
    ? readJson(args.snapshotPath)
    : await collectLiveSnapshot({ timeoutMs: args.timeoutMs })
  const report = buildReport(snapshot)
  process.stdout.write(
    args.json ? `${JSON.stringify(report, null, 2)}\n` : formatTextReport(report),
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exit(1)
  })
}

export { SNAPSHOT_SCHEMA, buildReport, collectLiveSnapshot, formatTextReport, summarizeProcesses }
