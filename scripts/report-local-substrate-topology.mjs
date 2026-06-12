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
const PRIMITIVE_GENERATION_WINDOW_MS = 5000
const LONG_LIVED_AGENT_LABELS = new Set(['ai.hermes.gateway', 'ai.openclaw.gateway'])
const SAFE_ENDPOINT_ENV_KEYS = [
  'ATRIB_LOCAL_SUBSTRATE_ENDPOINT',
  'SECOND_BRAIN_ATRIB_LOCAL_SUBSTRATE_ENDPOINT',
]
const SAFE_AGENT_ENV_KEYS = ['ATRIB_AGENT', 'SECOND_BRAIN_ATRIB_AGENT']

process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') process.exit(0)
  throw error
})

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
  const primitiveRuntimeHttp = primitiveRuntime.filter(
    (row) => primitiveRuntimeTransport(row) === 'streamable-http',
  )
  const primitiveRuntimeStdio = primitiveRuntime.filter(
    (row) => primitiveRuntimeTransport(row) === 'stdio',
  )
  const coordinator = rows.filter((row) => row.service === 'atrib-local-substrate')
  const bridge = rows.filter((row) => row.service === 'agent-bridge')
  const standalone = rows.filter((row) => PRIMITIVE_SERVERS.includes(row.service))

  const standaloneGroups = [...groupBy(standalone, (row) => row.ppid).entries()]
    .map(([ppid, group]) => {
      const parent = byPid.get(ppid)
      const generations = standalonePrimitiveGenerations(group)
      return {
        ppid,
        parent_service: parent?.service ?? 'unknown',
        parent_label: parent ? processLabel(parent) : 'unknown',
        config_surface: startupSurfaceForParentService(parent?.service),
        process_count: group.length,
        services: unique(group.map((row) => row.service)).sort(),
        generation_count: generations.length,
        complete_generation_count: generations.filter((generation) => generation.complete).length,
        generations,
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
        transport: unique(group.map((row) => primitiveRuntimeTransport(row))).join('+'),
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
    primitive_runtime_http_processes: primitiveRuntimeHttp.length,
    primitive_runtime_stdio_processes: primitiveRuntimeStdio.length,
    standalone_primitive_processes: standalone.length,
    standalone_primitive_groups: standaloneGroups.length,
    standalone_primitive_generations: standaloneGroups.reduce(
      (sum, group) => sum + group.generation_count,
      0,
    ),
    complete_standalone_primitive_generations: standaloneGroups.reduce(
      (sum, group) => sum + group.complete_generation_count,
      0,
    ),
    duplicate_primitive_groups: standaloneGroups.filter((group) => group.process_count >= 3).length,
    obsolete_standalone_primitive_processes: 0,
    obsolete_standalone_primitive_generations: 0,
    bridge_processes: bridge.length,
    runtime_groups: runtimeGroups,
    standalone_groups: standaloneGroups,
  }
}

function startupSurfaceForParentService(service) {
  if (service === 'codex-app-server') return 'codex'
  if (service === 'claude-code') return 'claude-code'
  return undefined
}

function standalonePrimitiveGenerations(rows) {
  const sorted = [...rows].sort((a, b) => {
    const aTime = timestampMs(a.started_at)
    const bTime = timestampMs(b.started_at)
    if (aTime !== undefined && bTime !== undefined && aTime !== bTime) return aTime - bTime
    if (aTime !== undefined && bTime === undefined) return -1
    if (aTime === undefined && bTime !== undefined) return 1
    return a.pid - b.pid
  })

  const generations = []
  for (const row of sorted) {
    const time = timestampMs(row.started_at)
    const current = generations[generations.length - 1]
    const startsNewGeneration =
      !current ||
      (current.reference_ms === undefined && time !== undefined) ||
      (current.reference_ms !== undefined && time === undefined) ||
      (current.reference_ms !== undefined &&
        time !== undefined &&
        time - current.reference_ms > PRIMITIVE_GENERATION_WINDOW_MS)
    if (startsNewGeneration) {
      generations.push({
        reference_ms: time,
        rows: [row],
      })
    } else {
      current.rows.push(row)
    }
  }

  return generations.map((generation) => {
    const services = unique(generation.rows.map((row) => row.service)).sort()
    return {
      process_count: generation.rows.length,
      complete: PRIMITIVE_SERVERS.every((service) => services.includes(service)),
      services,
      pids: generation.rows.map((row) => row.pid).sort((a, b) => a - b),
      ...startWindow(generation.rows),
    }
  })
}

function timestampMs(value) {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function annotateStandaloneConfigDrift(processSummary, configs) {
  const byName = new Map(configs.map((config) => [config.name, config]))
  const standaloneGroups = processSummary.standalone_groups.map((group) => {
    const config = group.config_surface ? byName.get(group.config_surface) : undefined
    const configDeclaresRuntime = Boolean(config?.has_primitives_runtime)
    const configDeclaresStandalone = (config?.standalone_primitive_servers ?? []).length > 0
    const obsolete_config_drift =
      Boolean(config?.exists) && configDeclaresRuntime && !configDeclaresStandalone
    return {
      ...group,
      config_declares_primitives_runtime: configDeclaresRuntime,
      config_declares_standalone_primitives: configDeclaresStandalone,
      obsolete_config_drift,
    }
  })

  const obsoleteGroups = standaloneGroups.filter((group) => group.obsolete_config_drift)
  return {
    ...processSummary,
    standalone_groups: standaloneGroups,
    obsolete_standalone_primitive_processes: obsoleteGroups.reduce(
      (sum, group) => sum + group.process_count,
      0,
    ),
    obsolete_standalone_primitive_generations: obsoleteGroups.reduce(
      (sum, group) => sum + group.generation_count,
      0,
    ),
  }
}

function primitiveRuntimeTransport(row) {
  return row.command.includes('--transport streamable-http') || row.command.includes('--http')
    ? 'streamable-http'
    : 'stdio'
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
  const blocks = parseTomlMcpServerBlocks(text)
  const serverNames = [...text.matchAll(/^\[mcp_servers\.([^\]\s]+)\]/gm)].map((match) =>
    match[1].replace(/^"|"$/g, ''),
  )
  return summarizeServerConfig({
    name: 'codex',
    path,
    serverNames,
    text,
    primitiveHttpEndpoints: serverNames.includes('atrib-primitives')
      ? unique([urlFromTomlBlock(blocks.get('atrib-primitives'))])
      : [],
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
    const primitiveHttpEndpoints = []
    for (const server of Object.values(servers)) {
      const env = server && typeof server === 'object' ? server.env : undefined
      if (env?.ATRIB_LOCAL_SUBSTRATE_ENDPOINT)
        endpointValues.push(env.ATRIB_LOCAL_SUBSTRATE_ENDPOINT)
    }
    const primitiveServer = servers['atrib-primitives']
    if (
      primitiveServer &&
      typeof primitiveServer === 'object' &&
      typeof primitiveServer.url === 'string'
    ) {
      primitiveHttpEndpoints.push(primitiveServer.url)
    }
    return summarizeServerConfig({
      name: 'claude-code',
      path,
      serverNames,
      endpointValues,
      primitiveHttpEndpoints,
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
      primitive_http_endpoints: [],
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
    primitive_http_endpoints: [],
  }
}

function summarizeServerConfig({
  name,
  path,
  serverNames,
  text,
  endpointValues = [],
  primitiveHttpEndpoints = [],
}) {
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
    primitive_http_endpoints: unique(primitiveHttpEndpoints),
  }
}

function parseTomlMcpServerBlocks(text) {
  const blocks = new Map()
  let current = null
  let lines = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\[mcp_servers\.([^\]]+)\]\s*$/)
    if (match) {
      if (current) blocks.set(current, lines.join('\n'))
      current = match[1].replace(/^["']|["']$/g, '')
      lines = []
    } else if (current) {
      lines.push(line)
    }
  }
  if (current) blocks.set(current, lines.join('\n'))
  return blocks
}

function urlFromTomlBlock(block) {
  if (!block) return undefined
  const match = block.match(/^\s*url\s*=\s*["']([^"']+)["']/m)
  return match?.[1]
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

function parseLongLivedAgent(path) {
  const stdout = run('plutil', ['-convert', 'json', '-o', '-', path])
  if (!stdout) return undefined
  try {
    const parsed = JSON.parse(stdout)
    const label = String(parsed.Label ?? '')
    if (!LONG_LIVED_AGENT_LABELS.has(label)) return undefined

    const args = Array.isArray(parsed.ProgramArguments) ? parsed.ProgramArguments.map(String) : []
    const env =
      parsed.EnvironmentVariables && typeof parsed.EnvironmentVariables === 'object'
        ? parsed.EnvironmentVariables
        : {}
    const envFile = longLivedEnvFileFromProgramArguments(args)
    const fileEnv = envFile ? readSafeEnvFile(envFile) : {}

    return {
      label,
      path: displayPath(path),
      kind: 'long-lived-agent',
      program: args[0] ?? undefined,
      endpoint:
        firstEnvValue(env, SAFE_ENDPOINT_ENV_KEYS) ??
        firstEnvValue(fileEnv, SAFE_ENDPOINT_ENV_KEYS),
      agent:
        firstEnvValue(env, SAFE_AGENT_ENV_KEYS) ??
        firstEnvValue(fileEnv, SAFE_AGENT_ENV_KEYS) ??
        agentNameFromLongLivedLabel(label),
      env_file: envFile ? displayPath(envFile) : undefined,
      start_interval: parsed.StartInterval ?? undefined,
    }
  } catch {
    return undefined
  }
}

function firstEnvValue(env, keys) {
  for (const key of keys) {
    if (typeof env?.[key] === 'string' && env[key]) return env[key]
  }
  return undefined
}

function longLivedEnvFileFromProgramArguments(args) {
  if (args.length < 2) return undefined
  if (!args[0]?.endsWith('/service-env/ai.openclaw.gateway-env-wrapper.sh')) return undefined
  const envFile = args[1]
  return envFile && existsSync(envFile) ? envFile : undefined
}

function readSafeEnvFile(path) {
  const out = {}
  const safeKeys = new Set([...SAFE_ENDPOINT_ENV_KEYS, ...SAFE_AGENT_ENV_KEYS])
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/)
    if (!match || !safeKeys.has(match[1])) continue
    out[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return out
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function agentNameFromLongLivedLabel(label) {
  if (label === 'ai.hermes.gateway') return 'hermes'
  if (label === 'ai.openclaw.gateway') return 'openclaw'
  return undefined
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
        name.endsWith('.plist') &&
        (name === 'com.nader.atrib-drain.plist' ||
          name.startsWith('com.nader.atrib-local-substrate.')),
    )
    .map((name) => parseLaunchAgent(join(dir, name)))
    .filter(Boolean)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

function collectLongLivedAgents() {
  const dir = join(HOME, 'Library/LaunchAgents')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.plist'))
    .map((name) => parseLongLivedAgent(join(dir, name)))
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
  const longLivedAgents = collectLongLivedAgents()
  const configs = [
    summarizeCodexConfig(join(HOME, '.codex/config.toml')),
    summarizeClaudeConfig(join(HOME, '.claude.json')),
  ]
  const endpoints = unique([
    ...launchAgents.map((agent) => agent.endpoint),
    ...longLivedAgents.map((agent) => agent.endpoint),
    ...configs.flatMap((config) => config.local_substrate_endpoints ?? []),
  ])
  const coordinatorHealth = []
  for (const endpoint of endpoints) {
    if (!endpoint) continue
    coordinatorHealth.push(await fetchHealth(endpoint, timeoutMs))
  }
  const primitiveRuntimeEndpoints = unique(
    configs.flatMap((config) => config.primitive_http_endpoints ?? []),
  )
  const primitiveRuntimeHealth = []
  for (const endpoint of primitiveRuntimeEndpoints) {
    if (!endpoint) continue
    primitiveRuntimeHealth.push(await fetchHealth(endpoint, timeoutMs))
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    source: 'live',
    generated_at: new Date().toISOString(),
    processes: collectProcessRows(),
    configs,
    launch_agents: launchAgents,
    long_lived_agents: longLivedAgents,
    coordinator_health: coordinatorHealth,
    primitive_runtime_health: primitiveRuntimeHealth,
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

function primitiveRuntimeHealthSummary(items) {
  return items.map((item) => {
    const report = item.report ?? {}
    return {
      endpoint: item.endpoint,
      reachable: Boolean(item.reachable),
      status: item.status,
      pid: report.primitive_runtime?.pid,
      version: report.primitive_runtime?.version,
      transport: report.primitive_runtime?.transport,
      tool_count: report.primitive_runtime?.tool_count,
      agent: report.profile?.agent,
      mirror_file: report.profile?.mirror_file,
      local_substrate_endpoint: report.profile?.local_substrate_endpoint,
      active_sessions: report.sessions?.active,
      opened_sessions: report.sessions?.opened,
      reason: item.reason,
      http_status: item.http_status,
    }
  })
}

function localSubstrateEndpointsForConfig(config, primitiveHealthByEndpoint) {
  return unique([
    ...(config.local_substrate_endpoints ?? []),
    ...(config.primitive_http_endpoints ?? []).map(
      (endpoint) =>
        primitiveHealthByEndpoint.get(endpoint)?.report?.profile?.local_substrate_endpoint,
    ),
  ])
}

function summarizeLongLivedRoutes(longLivedAgents, reachableEndpoints) {
  const agents = longLivedAgents.map((agent) => {
    const endpoint = agent.endpoint
    return {
      ...agent,
      route_configured: Boolean(endpoint),
      route_healthy: Boolean(endpoint && reachableEndpoints.has(endpoint)),
    }
  })
  return {
    agents,
    total: agents.length,
    configured: agents.filter((agent) => agent.route_configured).length,
    healthy: agents.filter((agent) => agent.route_healthy).length,
    missing: agents.filter((agent) => !agent.route_configured).length,
    unhealthy: agents.filter((agent) => agent.route_configured && !agent.route_healthy).length,
  }
}

function gate(name, status, detail) {
  return { name, status, detail }
}

function buildGates({
  processSummary,
  configs,
  launchAgents,
  longLivedAgents,
  health,
  primitiveHealth,
}) {
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
    const obsoleteAll =
      processSummary.obsolete_standalone_primitive_processes > 0 &&
      processSummary.obsolete_standalone_primitive_processes ===
        processSummary.standalone_primitive_processes
    gates.push(
      gate(
        'startup-spawn-mcp-collapse',
        'warn',
        obsoleteAll
          ? `${processSummary.primitive_runtime_processes} atrib-primitives process(es) plus ${processSummary.standalone_primitive_processes} obsolete standalone primitive process(es) across ${processSummary.obsolete_standalone_primitive_generations} generation(s); current config no longer declares them`
          : `${processSummary.primitive_runtime_processes} atrib-primitives process(es) plus ${processSummary.standalone_primitive_processes} standalone primitive process(es)`,
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
  const configsWithPrimitiveHttp = existingConfigs.filter(
    (config) => (config.primitive_http_endpoints ?? []).length > 0,
  )
  const healthyPrimitiveHttp = primitiveHealth.filter(
    (item) => item.reachable && item.status === 'healthy',
  )
  const healthyPrimitiveHttpByEndpoint = new Map(
    healthyPrimitiveHttp.map((item) => [item.endpoint, item]),
  )
  const configsWithEndpoint = existingConfigs.filter(
    (config) => localSubstrateEndpointsForConfig(config, healthyPrimitiveHttpByEndpoint).length > 0,
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

  const primitiveHttpConfigRoutes = configsWithPrimitiveHttp.flatMap((config) =>
    (config.primitive_http_endpoints ?? []).map((endpoint) => ({
      config: config.name,
      endpoint,
      profileAgent: healthyPrimitiveHttpByEndpoint.get(endpoint)?.report?.profile?.agent,
    })),
  )
  const configuredPrimitiveHttpEndpoints = unique(
    configsWithPrimitiveHttp.flatMap((config) => config.primitive_http_endpoints ?? []),
  )
  const healthyPrimitiveHttpEndpoints = new Set(healthyPrimitiveHttp.map((item) => item.endpoint))
  const unhealthyConfiguredPrimitiveEndpoints = configuredPrimitiveHttpEndpoints.filter(
    (endpoint) => !healthyPrimitiveHttpEndpoints.has(endpoint),
  )
  const agentScopedEndpointCountOk =
    configuredPrimitiveHttpEndpoints.length >= configsWithPrimitiveHttp.length
  const profileMismatches = primitiveHttpConfigRoutes.filter(
    (route) => route.profileAgent !== route.config,
  )
  if (
    existingConfigs.length > 0 &&
    configsWithPrimitiveHttp.length === existingConfigs.length &&
    unhealthyConfiguredPrimitiveEndpoints.length === 0 &&
    agentScopedEndpointCountOk &&
    profileMismatches.length === 0 &&
    processSummary.primitive_runtime_http_processes >= configuredPrimitiveHttpEndpoints.length
  ) {
    gates.push(
      gate(
        'host-owned-primitives-http',
        'pass',
        `${configuredPrimitiveHttpEndpoints.length} healthy agent-scoped primitive HTTP endpoint(s), ${configsWithPrimitiveHttp.length}/${existingConfigs.length} config(s) point at HTTP`,
      ),
    )
  } else if (
    processSummary.primitive_runtime_http_processes > 0 ||
    healthyPrimitiveHttp.length > 0 ||
    configsWithPrimitiveHttp.length > 0
  ) {
    gates.push(
      gate(
        'host-owned-primitives-http',
        'warn',
        `${processSummary.primitive_runtime_http_processes} primitive HTTP process(es), ${healthyPrimitiveHttp.length} healthy endpoint(s), ${configuredPrimitiveHttpEndpoints.length} configured endpoint(s), ${configsWithPrimitiveHttp.length}/${existingConfigs.length} config(s) point at HTTP, ${profileMismatches.length} profile mismatch(es)`,
      ),
    )
  } else {
    gates.push(
      gate(
        'host-owned-primitives-http',
        'fail',
        'no agent-scoped primitive HTTP runtime is running or configured',
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

  const longLivedRoutes = summarizeLongLivedRoutes(longLivedAgents, reachableEndpoints)
  if (longLivedRoutes.total > 0 && longLivedRoutes.healthy === longLivedRoutes.total) {
    gates.push(
      gate(
        'long-lived-agent-route',
        'pass',
        `${longLivedRoutes.healthy}/${longLivedRoutes.total} known long-lived launch agent(s) point at a healthy coordinator endpoint`,
      ),
    )
  } else if (longLivedRoutes.configured > 0) {
    gates.push(
      gate(
        'long-lived-agent-route',
        'warn',
        `${longLivedRoutes.healthy}/${longLivedRoutes.total} known long-lived launch agent(s) point at a healthy coordinator endpoint; ${longLivedRoutes.missing} missing endpoint(s), ${longLivedRoutes.unhealthy} unhealthy endpoint(s)`,
      ),
    )
  } else if (longLivedRoutes.total > 0) {
    gates.push(
      gate(
        'long-lived-agent-route',
        'warn',
        'known long-lived launch agent evidence exists, but no coordinator endpoint is configured',
      ),
    )
  } else {
    gates.push(gate('long-lived-agent-route', 'warn', 'no long-lived agent route evidence found'))
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
  const longLivedAgents = Array.isArray(snapshot.long_lived_agents)
    ? snapshot.long_lived_agents
    : []
  const health = Array.isArray(snapshot.coordinator_health) ? snapshot.coordinator_health : []
  const primitiveHealth = Array.isArray(snapshot.primitive_runtime_health)
    ? snapshot.primitive_runtime_health
    : []
  const processSummary = annotateStandaloneConfigDrift(summarizeProcesses(processes), configs)
  const reachableEndpoints = new Set(
    health
      .filter((item) => item.reachable && item.status === 'healthy')
      .map((item) => item.endpoint),
  )
  const longLivedRoutes = summarizeLongLivedRoutes(longLivedAgents, reachableEndpoints)
  const gates = buildGates({
    processSummary,
    configs,
    launchAgents,
    longLivedAgents,
    health,
    primitiveHealth,
  })
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
      primitive_runtime_http_processes: processSummary.primitive_runtime_http_processes,
      primitive_runtime_stdio_processes: processSummary.primitive_runtime_stdio_processes,
      standalone_primitive_processes: processSummary.standalone_primitive_processes,
      standalone_primitive_generations: processSummary.standalone_primitive_generations,
      complete_standalone_primitive_generations:
        processSummary.complete_standalone_primitive_generations,
      obsolete_standalone_primitive_processes:
        processSummary.obsolete_standalone_primitive_processes,
      obsolete_standalone_primitive_generations:
        processSummary.obsolete_standalone_primitive_generations,
      duplicate_primitive_groups: processSummary.duplicate_primitive_groups,
      watcher_wal_launch_agents: launchAgents.filter((agent) => agent.kind === 'watcher-wal')
        .length,
      long_lived_agents: longLivedAgents.length,
      long_lived_agent_routes: unique(longLivedAgents.map((agent) => agent.endpoint)).length,
      long_lived_agent_routes_configured: longLivedRoutes.configured,
      long_lived_agent_routes_healthy: longLivedRoutes.healthy,
      long_lived_agent_routes_missing: longLivedRoutes.missing,
    },
    gates,
    coordinators: healthSummary(health),
    primitive_runtimes: primitiveRuntimeHealthSummary(primitiveHealth),
    process_inventory: processSummary,
    config_surfaces: configs,
    launch_agents: launchAgents,
    long_lived_agents: longLivedAgents,
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
  if (
    processSummary.obsolete_standalone_primitive_processes > 0 &&
    processSummary.obsolete_standalone_primitive_processes ===
      processSummary.standalone_primitive_processes
  ) {
    recommendations.push(
      'fully quit or restart startup-spawn hosts that still own obsolete standalone primitive generations',
    )
  } else if (processSummary.standalone_primitive_processes > 0) {
    recommendations.push(
      'restart or reconfigure startup-spawn harnesses that still launch standalone atrib primitive servers',
    )
  }
  if (gates.find((item) => item.name === 'host-owned-primitives-http')?.status !== 'pass') {
    recommendations.push(
      'start one loopback atrib-primitives Streamable HTTP host per startup-spawn agent profile before broad process-sharing rollout',
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
  if (gates.find((item) => item.name === 'long-lived-agent-route')?.status !== 'pass') {
    recommendations.push(
      'point every known long-lived launch agent at a healthy coordinator endpoint before broad rollout',
    )
  }
  return recommendations
}

function formatTextReport(report) {
  const lines = [
    `local-substrate topology: ${report.summary.status}`,
    `coordinators: healthy=${report.summary.healthy_coordinators}, configured=${report.summary.configured_coordinators}`,
    `startup-spawn processes: atrib-primitives=${report.summary.primitive_runtime_processes} (http=${report.summary.primitive_runtime_http_processes}, stdio=${report.summary.primitive_runtime_stdio_processes}), standalone-primitives=${report.summary.standalone_primitive_processes}, generations=${report.summary.standalone_primitive_generations}, obsolete=${report.summary.obsolete_standalone_primitive_processes}, duplicate-groups=${report.summary.duplicate_primitive_groups}`,
    `watcher-WAL launch agents: ${report.summary.watcher_wal_launch_agents}`,
    `long-lived agent routes: healthy=${report.summary.long_lived_agent_routes_healthy}/${report.summary.long_lived_agents}, configured=${report.summary.long_lived_agent_routes_configured}, missing=${report.summary.long_lived_agent_routes_missing}`,
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
