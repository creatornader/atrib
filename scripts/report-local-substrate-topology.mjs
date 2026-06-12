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
const ROUTE_REGISTRY_SCHEMA = 'atrib.local-substrate-route-registry.v0'
const DEFAULT_ROUTE_REGISTRY_PATH = join(HOME, '.atrib/local-substrate/routes.json')
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
const LOCAL_SUBSTRATE_INFRA_LABELS = new Set(['com.nader.atrib-drain'])
const LOCAL_SUBSTRATE_INFRA_LABEL_PREFIXES = [
  'com.nader.atrib-local-substrate.',
  'com.nader.atrib-primitives.',
]
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
  --route-registry <path> Read supervised agent routes from a JSON registry.
  --timeout-ms <n>        Live coordinator health timeout. Defaults to 400.
  --help                  Print this help.

The live report reads process rows, local MCP config summaries, launchd
service metadata, an optional route registry for supervised agents and
startup-spawn config summaries, and local-substrate health probes. It does not
print raw config files or environment secrets.
`
}

function parseArgs(argv) {
  const out = {
    json: false,
    snapshotPath: undefined,
    routeRegistryPath: DEFAULT_ROUTE_REGISTRY_PATH,
    timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      out.json = true
    } else if (arg === '--snapshot') {
      out.snapshotPath = requireValue(argv, ++i, '--snapshot')
    } else if (arg === '--route-registry') {
      out.routeRegistryPath = requireValue(argv, ++i, '--route-registry')
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

function expandHomePath(path) {
  if (!path) return undefined
  if (path === '~') return HOME
  if (path.startsWith('~/')) return join(HOME, path.slice(2))
  return path
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
  if (command.includes('/bridge-wrapper/dist/')) return 'bridge-wrapper'
  if (command.includes('/agent-bridge/dist/') || command.includes('/upstream-bridge/dist/')) {
    return 'bridge-upstream'
  }
  if (command.includes('codex app-server')) return 'codex-app-server'
  if (command === 'claude' || command.startsWith('claude ') || /\/claude(?:\s|$)/.test(command)) {
    return 'claude-code'
  }
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
  const bridgeSummary = summarizeBridgeProcesses(rows, byPid)
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
    ...bridgeSummary,
    runtime_groups: runtimeGroups,
    standalone_groups: standaloneGroups,
  }
}

function summarizeBridgeProcesses(rows, byPid) {
  const upstreams = rows.filter((row) => row.service === 'bridge-upstream')
  const explicitWrappers = rows.filter((row) => row.service === 'bridge-wrapper')
  const inferredWrappers = upstreams
    .map((row) => byPid.get(row.ppid))
    .filter(Boolean)
    .filter((row) => row.service !== 'bridge-upstream')
  const wrapperByPid = new Map()
  for (const row of [...explicitWrappers, ...inferredWrappers]) {
    wrapperByPid.set(row.pid, { ...row, service: 'bridge-wrapper' })
  }
  const wrappers = [...wrapperByPid.values()]
  const upstreamsByWrapperPid = groupBy(
    upstreams.filter((row) => wrapperByPid.has(row.ppid)),
    (row) => row.ppid,
  )
  const wrapperGroups = [...groupBy(wrappers, (row) => row.ppid).entries()]
    .map(([ppid, group]) => {
      const parent = byPid.get(ppid)
      const upstreamChildren = group.flatMap(
        (wrapper) => upstreamsByWrapperPid.get(wrapper.pid) ?? [],
      )
      return {
        ppid,
        parent_service: parent?.service ?? 'unknown',
        parent_label: parent ? processLabel(parent) : 'unknown',
        config_surface: startupSurfaceForParentService(parent?.service),
        process_count: group.length,
        upstream_child_processes: upstreamChildren.length,
        pids: group.map((row) => row.pid).sort((a, b) => a - b),
        upstream_pids: upstreamChildren.map((row) => row.pid).sort((a, b) => a - b),
        ...startWindow(group),
      }
    })
    .sort((a, b) => b.process_count - a.process_count || a.ppid - b.ppid)
  const wrappersWithoutUpstream = wrappers.filter(
    (row) => (upstreamsByWrapperPid.get(row.pid) ?? []).length === 0,
  )
  const upstreamsWithoutWrapper = upstreams.filter((row) => !wrapperByPid.has(row.ppid))
  return {
    bridge_processes: wrappers.length + upstreams.length,
    bridge_wrapper_processes: wrappers.length,
    bridge_upstream_processes: upstreams.length,
    bridge_wrapper_groups: wrapperGroups.length,
    duplicate_bridge_wrapper_groups: wrapperGroups.filter((group) => group.process_count > 1)
      .length,
    bridge_wrappers_without_upstream: wrappersWithoutUpstream.length,
    bridge_upstreams_without_wrapper: upstreamsWithoutWrapper.length,
    bridge_groups: wrapperGroups,
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
    bridgeHttpEndpoints: serverNames.includes('agent-bridge')
      ? unique([urlFromTomlBlock(blocks.get('agent-bridge'))])
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
    const bridgeHttpEndpoints = []
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
    const bridgeServer = servers['agent-bridge']
    if (bridgeServer && typeof bridgeServer === 'object' && typeof bridgeServer.url === 'string') {
      bridgeHttpEndpoints.push(bridgeServer.url)
    }
    return summarizeServerConfig({
      name: 'claude-code',
      path,
      serverNames,
      endpointValues,
      primitiveHttpEndpoints,
      bridgeHttpEndpoints,
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
      bridge_http_endpoints: [],
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
    bridge_http_endpoints: [],
  }
}

function summarizeServerConfig({
  name,
  path,
  serverNames,
  text,
  endpointValues = [],
  primitiveHttpEndpoints = [],
  bridgeHttpEndpoints = [],
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
    bridge_http_endpoints: unique(bridgeHttpEndpoints),
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
    if (isLocalSubstrateInfraLabel(label)) return undefined

    const args = Array.isArray(parsed.ProgramArguments) ? parsed.ProgramArguments.map(String) : []
    const env =
      parsed.EnvironmentVariables && typeof parsed.EnvironmentVariables === 'object'
        ? parsed.EnvironmentVariables
        : {}
    const envFile = longLivedEnvFileFromProgramArguments(args)
    const fileEnv = envFile ? readSafeEnvFile(envFile) : {}
    const endpoint =
      firstEnvValue(env, SAFE_ENDPOINT_ENV_KEYS) ?? firstEnvValue(fileEnv, SAFE_ENDPOINT_ENV_KEYS)
    const agent =
      firstEnvValue(env, SAFE_AGENT_ENV_KEYS) ??
      firstEnvValue(fileEnv, SAFE_AGENT_ENV_KEYS) ??
      agentNameFromLongLivedLabel(label)
    const isKnownLongLivedAgent = LONG_LIVED_AGENT_LABELS.has(label)
    const isSelfDeclaredLongLivedAgent = Boolean(endpoint && agent)
    if (!isKnownLongLivedAgent && !isSelfDeclaredLongLivedAgent) return undefined

    return {
      label,
      path: displayPath(path),
      kind: 'long-lived-agent',
      source: 'launchd',
      program: args[0] ?? undefined,
      endpoint,
      agent,
      env_file: envFile ? displayPath(envFile) : undefined,
      start_interval: parsed.StartInterval ?? undefined,
    }
  } catch {
    return undefined
  }
}

function isLocalSubstrateInfraLabel(label) {
  return (
    LOCAL_SUBSTRATE_INFRA_LABELS.has(label) ||
    LOCAL_SUBSTRATE_INFRA_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix))
  )
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
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const rawLine of text.split('\n')) {
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

function collectRegisteredLongLivedAgents(routeRegistryPath = DEFAULT_ROUTE_REGISTRY_PATH) {
  const expandedPath = expandHomePath(routeRegistryPath)
  if (!expandedPath || !existsSync(expandedPath)) return []
  try {
    return registeredLongLivedAgentsFromRegistry(readJson(expandedPath), {
      registryPath: expandedPath,
    })
  } catch (error) {
    return [
      {
        label: 'route-registry-parse-error',
        path: displayPath(expandedPath),
        kind: 'long-lived-agent',
        source: 'registry',
        parse_error: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

function collectRegisteredStartupSpawnConfigs(routeRegistryPath = DEFAULT_ROUTE_REGISTRY_PATH) {
  const expandedPath = expandHomePath(routeRegistryPath)
  if (!expandedPath || !existsSync(expandedPath)) return []
  try {
    return registeredStartupSpawnConfigsFromRegistry(readJson(expandedPath), {
      registryPath: expandedPath,
    })
  } catch {
    return []
  }
}

function registeredLongLivedAgentsFromRegistry(registry, { registryPath } = {}) {
  const routes = routeRegistryEntries(registry)
  const out = []
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index]
    const normalized = normalizeRegistryLongLivedAgent(route, {
      index,
      registryPath,
    })
    if (normalized) out.push(normalized)
  }
  return dedupeLongLivedAgents(out)
}

function registeredStartupSpawnConfigsFromRegistry(registry, { registryPath } = {}) {
  const routes = routeRegistryEntries(registry)
  const out = []
  for (let index = 0; index < routes.length; index++) {
    const route = routes[index]
    const normalized = normalizeRegistryStartupSpawnConfig(route, {
      index,
      registryPath,
    })
    if (normalized) out.push(normalized)
  }
  return dedupeServerConfigs(out)
}

function routeRegistryEntries(registry) {
  if (Array.isArray(registry)) return registry
  if (!registry || typeof registry !== 'object') return []
  if (registry.schema && registry.schema !== ROUTE_REGISTRY_SCHEMA) {
    return []
  }
  if (Array.isArray(registry.routes)) return registry.routes
  if (Array.isArray(registry.long_lived_agents)) return registry.long_lived_agents
  return []
}

function normalizeRegistryLongLivedAgent(route, { index, registryPath } = {}) {
  if (!route || typeof route !== 'object') return undefined
  const kind = stringValue(route.kind) ?? 'long-lived-agent'
  if (kind !== 'long-lived-agent') return undefined

  const rawEnvFile = stringValue(route.env_file) ?? stringValue(route.envFile)
  const envFile = rawEnvFile ? expandHomePath(rawEnvFile) : undefined
  const fileEnv = envFile && existsSync(envFile) ? readSafeEnvFile(envFile) : {}
  const endpoint = stringValue(route.endpoint) ?? firstEnvValue(fileEnv, SAFE_ENDPOINT_ENV_KEYS)
  const agent = stringValue(route.agent) ?? firstEnvValue(fileEnv, SAFE_AGENT_ENV_KEYS)
  const label =
    stringValue(route.label) ??
    (agent ? `registry:${agent}` : undefined) ??
    (endpoint ? `registry:${endpoint}` : undefined) ??
    `registry:${index + 1}`
  const hasRouteEvidence = Boolean(label || agent || endpoint || rawEnvFile)
  if (!hasRouteEvidence) return undefined

  return withoutUndefinedValues({
    label,
    path: registryPath ? displayPath(registryPath) : undefined,
    kind: 'long-lived-agent',
    source: 'registry',
    program: stringValue(route.program),
    endpoint,
    agent,
    env_file: envFile ? displayPath(envFile) : rawEnvFile,
    env_file_exists: envFile ? existsSync(envFile) : undefined,
    start_interval: route.start_interval,
  })
}

function normalizeRegistryStartupSpawnConfig(route, { index, registryPath } = {}) {
  if (!route || typeof route !== 'object') return undefined
  const kind = stringValue(route.kind)
  if (kind !== 'startup-spawn-config') return undefined

  const serverNames = stringList(route.server_names ?? route.serverNames)
  const name =
    stringValue(route.name) ??
    stringValue(route.agent) ??
    stringValue(route.profile) ??
    `registry-startup-spawn-${index + 1}`
  const standalone = unique([
    ...stringList(route.standalone_primitive_servers ?? route.standalonePrimitiveServers),
    ...serverNames,
  ])
    .filter((serverName) => PRIMITIVE_SERVERS.includes(serverName))
    .sort()
  const primitiveHttpEndpoints = endpointList(
    route.primitive_http_endpoints ??
      route.primitiveHttpEndpoints ??
      route.primitive_http_endpoint ??
      route.primitiveHttpEndpoint,
  )
  const bridgeHttpEndpoints = endpointList(
    route.bridge_http_endpoints ??
      route.bridgeHttpEndpoints ??
      route.bridge_http_endpoint ??
      route.bridgeHttpEndpoint,
  )
  const localSubstrateEndpoints = endpointList(
    route.local_substrate_endpoints ??
      route.localSubstrateEndpoints ??
      route.local_substrate_endpoint ??
      route.localSubstrateEndpoint,
  )
  const declaresPrimitivesRuntime =
    typeof route.has_primitives_runtime === 'boolean'
      ? route.has_primitives_runtime
      : serverNames.includes('atrib-primitives') || primitiveHttpEndpoints.length > 0
  const serverCount =
    positiveInteger(route.server_count) ??
    (serverNames.length > 0
      ? serverNames.length
      : unique([
          ...(declaresPrimitivesRuntime ? ['atrib-primitives'] : []),
          ...standalone,
          ...(bridgeHttpEndpoints.length > 0 ? ['agent-bridge'] : []),
        ]).length)

  return {
    name,
    path: stringValue(route.path)
      ? displayPath(expandHomePath(route.path))
      : registryPath
        ? displayPath(registryPath)
        : undefined,
    source: 'registry',
    exists: route.exists === false ? false : true,
    server_count: serverCount,
    has_primitives_runtime: declaresPrimitivesRuntime,
    standalone_primitive_servers: standalone,
    local_substrate_endpoints: localSubstrateEndpoints,
    primitive_http_endpoints: primitiveHttpEndpoints,
    bridge_http_endpoints: bridgeHttpEndpoints,
  }
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringList(value) {
  if (Array.isArray(value)) {
    return unique(value.map((item) => stringValue(item)))
  }
  const single = stringValue(value)
  return single ? [single] : []
}

function endpointList(value) {
  return stringList(value).filter((item) => {
    try {
      const url = new URL(item)
      return (
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      )
    } catch {
      return false
    }
  })
}

function positiveInteger(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

function withoutUndefinedValues(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
}

function dedupeServerConfigs(configs) {
  const byName = new Map()
  for (const config of configs) {
    const key = config.name
    const existing = byName.get(key)
    byName.set(key, existing ? mergeServerConfig(existing, config) : config)
  }
  return [...byName.values()]
}

function mergeServerConfig(a, b) {
  const paths = unique([a.path, b.path])
  const merged = {
    ...a,
    ...b,
    path: a.path ?? b.path,
    exists: Boolean(a.exists || b.exists),
    server_count: Math.max(Number(a.server_count ?? 0), Number(b.server_count ?? 0)),
    has_primitives_runtime: Boolean(a.has_primitives_runtime || b.has_primitives_runtime),
    standalone_primitive_servers: unique([
      ...(a.standalone_primitive_servers ?? []),
      ...(b.standalone_primitive_servers ?? []),
    ]).sort(),
    local_substrate_endpoints: unique([
      ...(a.local_substrate_endpoints ?? []),
      ...(b.local_substrate_endpoints ?? []),
    ]),
    primitive_http_endpoints: unique([
      ...(a.primitive_http_endpoints ?? []),
      ...(b.primitive_http_endpoints ?? []),
    ]),
    bridge_http_endpoints: unique([
      ...(a.bridge_http_endpoints ?? []),
      ...(b.bridge_http_endpoints ?? []),
    ]),
  }
  if (paths.length > 1) merged.paths = paths
  return merged
}

function dedupeLongLivedAgents(agents) {
  const byKey = new Map()
  for (const agent of agents) {
    const key = longLivedAgentKey(agent)
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, agent)
      continue
    }
    byKey.set(key, mergeLongLivedAgent(existing, agent))
  }
  return [...byKey.values()].sort((a, b) =>
    String(a.agent ?? a.label).localeCompare(String(b.agent ?? b.label)),
  )
}

function longLivedAgentKey(agent) {
  if (agent.label) return `label:${agent.label}`
  if (agent.agent) return `agent:${agent.agent}`
  if (agent.endpoint) return `endpoint:${agent.endpoint}`
  return `path:${agent.path ?? 'unknown'}`
}

function mergeLongLivedAgent(a, b) {
  const paths = unique([a.path, b.path])
  const merged = {
    ...withoutUndefinedValues(a),
    ...withoutUndefinedValues(b),
    source: uniqueSourceValues(a.source, b.source).join('+'),
    path: a.path ?? b.path,
  }
  if (paths.length > 1) merged.paths = paths
  if (!a.endpoint && b.endpoint) merged.endpoint = b.endpoint
  if (!a.agent && b.agent) merged.agent = b.agent
  if (a.env_file && b.env_file && a.env_file !== b.env_file) {
    merged.env_file = unique([a.env_file, b.env_file]).join(', ')
  }
  return merged
}

function uniqueSourceValues(...values) {
  return unique(
    values.flatMap((value) =>
      typeof value === 'string' ? value.split('+').map((item) => item.trim()) : [],
    ),
  )
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

function collectLongLivedAgents({ routeRegistryPath = DEFAULT_ROUTE_REGISTRY_PATH } = {}) {
  const dir = join(HOME, 'Library/LaunchAgents')
  const launchdAgents = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.plist'))
        .map((name) => parseLongLivedAgent(join(dir, name)))
        .filter(Boolean)
    : []
  return dedupeLongLivedAgents([
    ...launchdAgents,
    ...collectRegisteredLongLivedAgents(routeRegistryPath),
  ])
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

async function collectLiveSnapshot({
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  routeRegistryPath = DEFAULT_ROUTE_REGISTRY_PATH,
} = {}) {
  const launchAgents = collectLaunchAgents()
  const longLivedAgents = collectLongLivedAgents({ routeRegistryPath })
  const configs = dedupeServerConfigs([
    summarizeCodexConfig(join(HOME, '.codex/config.toml')),
    summarizeClaudeConfig(join(HOME, '.claude.json')),
    ...collectRegisteredStartupSpawnConfigs(routeRegistryPath),
  ])
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
  const bridgeRuntimeEndpoints = unique(
    configs.flatMap((config) => config.bridge_http_endpoints ?? []),
  )
  const bridgeRuntimeHealth = []
  for (const endpoint of bridgeRuntimeEndpoints) {
    if (!endpoint) continue
    bridgeRuntimeHealth.push(await fetchHealth(endpoint, timeoutMs))
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
    bridge_runtime_health: bridgeRuntimeHealth,
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

function bridgeRuntimeHealthSummary(items) {
  return items.map((item) => {
    const report = item.report ?? {}
    return {
      endpoint: item.endpoint,
      reachable: Boolean(item.reachable),
      status: item.status,
      pid: report.bridge_runtime?.pid,
      version: report.bridge_runtime?.version,
      transport: report.bridge_runtime?.transport,
      upstream: report.bridge_runtime?.upstream,
      tool_count: report.bridge_runtime?.tool_count,
      agent: report.profile?.agent,
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
  bridgeHealth,
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
  const configsWithBridgeHttp = existingConfigs.filter(
    (config) => (config.bridge_http_endpoints ?? []).length > 0,
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

  const healthyBridgeHttp = bridgeHealth.filter(
    (item) => item.reachable && item.status === 'healthy',
  )
  const healthyBridgeHttpByEndpoint = new Map(
    healthyBridgeHttp.map((item) => [item.endpoint, item]),
  )
  const bridgeHttpConfigRoutes = configsWithBridgeHttp.flatMap((config) =>
    (config.bridge_http_endpoints ?? []).map((endpoint) => ({
      config: config.name,
      endpoint,
      profileAgent: healthyBridgeHttpByEndpoint.get(endpoint)?.report?.profile?.agent,
    })),
  )
  const configuredBridgeHttpEndpoints = unique(
    configsWithBridgeHttp.flatMap((config) => config.bridge_http_endpoints ?? []),
  )
  const healthyBridgeHttpEndpoints = new Set(healthyBridgeHttp.map((item) => item.endpoint))
  const unhealthyConfiguredBridgeEndpoints = configuredBridgeHttpEndpoints.filter(
    (endpoint) => !healthyBridgeHttpEndpoints.has(endpoint),
  )
  const bridgeAgentScopedEndpointCountOk =
    configuredBridgeHttpEndpoints.length >= configsWithBridgeHttp.length
  const bridgeProfileMismatches = bridgeHttpConfigRoutes.filter(
    (route) => route.profileAgent !== route.config,
  )
  if (
    existingConfigs.length > 0 &&
    configsWithBridgeHttp.length === existingConfigs.length &&
    unhealthyConfiguredBridgeEndpoints.length === 0 &&
    bridgeAgentScopedEndpointCountOk &&
    bridgeProfileMismatches.length === 0
  ) {
    gates.push(
      gate(
        'host-owned-bridge-http',
        'pass',
        `${configuredBridgeHttpEndpoints.length} healthy agent-scoped bridge HTTP endpoint(s), ${configsWithBridgeHttp.length}/${existingConfigs.length} config(s) point at HTTP`,
      ),
    )
  } else if (healthyBridgeHttp.length > 0 || configsWithBridgeHttp.length > 0) {
    gates.push(
      gate(
        'host-owned-bridge-http',
        'warn',
        `${healthyBridgeHttp.length} healthy endpoint(s), ${configuredBridgeHttpEndpoints.length} configured endpoint(s), ${configsWithBridgeHttp.length}/${existingConfigs.length} config(s) point at HTTP, ${bridgeProfileMismatches.length} profile mismatch(es)`,
      ),
    )
  } else {
    gates.push(
      gate(
        'host-owned-bridge-http',
        'fail',
        'no agent-scoped bridge HTTP runtime is running or configured',
      ),
    )
  }

  if (processSummary.bridge_processes === 0) {
    gates.push(gate('bridge-wrapper-footprint', 'pass', 'no bridge wrapper process evidence found'))
  } else if (
    processSummary.duplicate_bridge_wrapper_groups === 0 &&
    processSummary.bridge_wrappers_without_upstream === 0 &&
    processSummary.bridge_upstreams_without_wrapper === 0
  ) {
    gates.push(
      gate(
        'bridge-wrapper-footprint',
        'pass',
        `${processSummary.bridge_wrapper_processes} bridge wrapper process(es), ${processSummary.bridge_upstream_processes} upstream child process(es), no duplicate wrapper groups`,
      ),
    )
  } else {
    gates.push(
      gate(
        'bridge-wrapper-footprint',
        'warn',
        `${processSummary.bridge_wrapper_processes} bridge wrapper process(es), ${processSummary.bridge_upstream_processes} upstream child process(es), ${processSummary.duplicate_bridge_wrapper_groups} duplicate wrapper group(s), ${processSummary.bridge_wrappers_without_upstream} wrapper(s) without upstream, ${processSummary.bridge_upstreams_without_wrapper} upstream process(es) without wrapper`,
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
        `${longLivedRoutes.healthy}/${longLivedRoutes.total} known long-lived agent route(s) point at a healthy coordinator endpoint`,
      ),
    )
  } else if (longLivedRoutes.configured > 0) {
    gates.push(
      gate(
        'long-lived-agent-route',
        'warn',
        `${longLivedRoutes.healthy}/${longLivedRoutes.total} known long-lived agent route(s) point at a healthy coordinator endpoint; ${longLivedRoutes.missing} missing endpoint(s), ${longLivedRoutes.unhealthy} unhealthy endpoint(s)`,
      ),
    )
  } else if (longLivedRoutes.total > 0) {
    gates.push(
      gate(
        'long-lived-agent-route',
        'warn',
        'known long-lived agent route evidence exists, but no coordinator endpoint is configured',
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
  const bridgeHealth = Array.isArray(snapshot.bridge_runtime_health)
    ? snapshot.bridge_runtime_health
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
    bridgeHealth,
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
      bridge_processes: processSummary.bridge_processes,
      bridge_wrapper_processes: processSummary.bridge_wrapper_processes,
      bridge_upstream_processes: processSummary.bridge_upstream_processes,
      bridge_runtime_http_endpoints: unique(
        configs.flatMap((config) => config.bridge_http_endpoints ?? []),
      ).length,
      bridge_runtime_http_healthy: bridgeHealth.filter(
        (item) => item.reachable && item.status === 'healthy',
      ).length,
      duplicate_bridge_wrapper_groups: processSummary.duplicate_bridge_wrapper_groups,
      bridge_wrappers_without_upstream: processSummary.bridge_wrappers_without_upstream,
      bridge_upstreams_without_wrapper: processSummary.bridge_upstreams_without_wrapper,
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
    bridge_runtimes: bridgeRuntimeHealthSummary(bridgeHealth),
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
  const gateStatus = (name) => gates.find((item) => item.name === name)?.status
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
  if (gates.find((item) => item.name === 'host-owned-bridge-http')?.status !== 'pass') {
    recommendations.push(
      'start one loopback Agent Bridge Streamable HTTP host per startup-spawn agent profile before removing per-thread bridge wrappers',
    )
  }
  if (gates.find((item) => item.name === 'startup-spawn-config')?.status !== 'pass') {
    recommendations.push(
      'keep Codex and Claude Code config on atrib-primitives plus explicit local-substrate endpoints',
    )
  }
  if (gateStatus('bridge-wrapper-footprint') !== 'pass') {
    if (gateStatus('host-owned-bridge-http') === 'pass') {
      recommendations.push(
        'fully quit or restart startup-spawn hosts that still own duplicate bridge wrapper/upstream pairs',
      )
    } else {
      recommendations.push(
        'move startup-spawn bridge config to host-owned HTTP, then restart hosts that own duplicate bridge wrappers',
      )
    }
  }
  if (gates.find((item) => item.name === 'watcher-wal-route')?.status !== 'pass') {
    recommendations.push(
      'point watcher-WAL launch agents at a healthy coordinator endpoint before making watcher commit mode default',
    )
  }
  if (gates.find((item) => item.name === 'long-lived-agent-route')?.status !== 'pass') {
    recommendations.push(
      'point every known long-lived agent route at a healthy coordinator endpoint before broad rollout',
    )
  }
  return recommendations
}

function formatTextReport(report) {
  const lines = [
    `local-substrate topology: ${report.summary.status}`,
    `coordinators: healthy=${report.summary.healthy_coordinators}, configured=${report.summary.configured_coordinators}`,
    `startup-spawn processes: atrib-primitives=${report.summary.primitive_runtime_processes} (http=${report.summary.primitive_runtime_http_processes}, stdio=${report.summary.primitive_runtime_stdio_processes}), standalone-primitives=${report.summary.standalone_primitive_processes}, generations=${report.summary.standalone_primitive_generations}, obsolete=${report.summary.obsolete_standalone_primitive_processes}, duplicate-groups=${report.summary.duplicate_primitive_groups}`,
    `bridge processes: wrappers=${report.summary.bridge_wrapper_processes}, upstream=${report.summary.bridge_upstream_processes}, duplicate-groups=${report.summary.duplicate_bridge_wrapper_groups}`,
    `host-owned bridge HTTP: healthy=${report.summary.bridge_runtime_http_healthy}/${report.summary.bridge_runtime_http_endpoints}`,
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
    : await collectLiveSnapshot({
        timeoutMs: args.timeoutMs,
        routeRegistryPath: args.routeRegistryPath,
      })
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

export {
  SNAPSHOT_SCHEMA,
  buildReport,
  collectLiveSnapshot,
  collectRegisteredLongLivedAgents,
  collectRegisteredStartupSpawnConfigs,
  formatTextReport,
  registeredLongLivedAgentsFromRegistry,
  registeredStartupSpawnConfigsFromRegistry,
  summarizeProcesses,
}
