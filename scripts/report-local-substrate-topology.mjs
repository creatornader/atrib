#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global AbortController, URL, clearTimeout, fetch, process, setTimeout */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HOME = process.env.HOME || ''
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA = 'atrib.local-substrate-topology-report.v0'
const SNAPSHOT_SCHEMA = 'atrib.local-substrate-topology-snapshot.v0'
const ROUTE_REGISTRY_SCHEMA = 'atrib.local-substrate-route-registry.v0'
const EXPECTED_RUNTIME_PACKAGE_PATHS = {
  coordinator: join(ROOT, 'services/atrib-emit/package.json'),
  primitive_runtime: join(ROOT, 'services/atrib-primitives/package.json'),
}
const DEFAULT_ROUTE_REGISTRY_PATH = join(HOME, '.atrib/local-substrate/routes.json')
const LEGACY_KNOWLEDGE_BASE_RECEIPT_REPORT_ENV = ['ATRIB_HEALTH_SECOND', 'BRAIN_REPORT'].join('_')
const DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_GENERIC_PATH = join(
  HOME,
  '.atrib/state/knowledge-base-reports/receipt-join-latest.json',
)
const DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_LEGACY_PATH = join(
  HOME,
  '.atrib',
  'state',
  ['second', 'brain-reports'].join('-'),
  'receipt-join-latest.json',
)
const DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_PATH =
  process.env.ATRIB_HEALTH_KNOWLEDGE_BASE_REPORT ??
  process.env[LEGACY_KNOWLEDGE_BASE_RECEIPT_REPORT_ENV] ??
  (existsSync(DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_GENERIC_PATH)
    ? DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_GENERIC_PATH
    : DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_LEGACY_PATH)
const LONG_LIVED_ACTIVITY_REPORT_SCHEMA = 'atrib.long-lived-agent-activity-report.v0'
const DEFAULT_LONG_LIVED_ACTIVITY_REPORT_PATH = join(
  HOME,
  '.atrib/state/local-substrate/long-lived-activity-latest.json',
)
const DEFAULT_HEALTH_TIMEOUT_MS = 1500
const DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_MAX_AGE_MS = 30 * 3_600_000
const DEFAULT_LONG_LIVED_ACTIVITY_REPORT_MAX_AGE_MS = 12 * 3_600_000
const HEX_32 = /^[0-9a-f]{32}$/
const RECORD_HASH = /^sha256:[0-9a-f]{64}$/
const ACTIVE_SESSION_STATE_MAX_BYTES = 128
const ACTIVE_SESSION_STATE_MAX_AGE_MS = 4 * 3_600_000
const SAFE_ACTIVE_SESSION_PROFILE = /^[A-Za-z0-9._-]{1,64}$/
const ACTIVE_SESSION_STATE_DIR = join(HOME, '.claude', 'state')
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
const AGENT_BRIDGE_ATTRIBUTED_SERVICE = ['agent', 'bridge', 'atrib'].join('-')
const SAFE_ENDPOINT_ENV_KEYS = [
  'ATRIB_LOCAL_SUBSTRATE_ENDPOINT',
  'KNOWLEDGE_BASE_ATRIB_LOCAL_SUBSTRATE_ENDPOINT',
  ['SECOND', 'BRAIN_ATRIB_LOCAL_SUBSTRATE_ENDPOINT'].join('_'),
]
const SAFE_AGENT_ENV_KEYS = [
  'ATRIB_AGENT',
  'KNOWLEDGE_BASE_ATRIB_AGENT',
  ['SECOND', 'BRAIN_ATRIB_AGENT'].join('_'),
]

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
  --knowledge-base-receipt-report <path>
                          Read the knowledge-base receipt join-back report.
  --long-lived-activity-report <path>
                          Read the long-lived producer activity report.
  --timeout-ms <n>        Live coordinator health timeout. Defaults to 1500.
  --help                  Print this help.

The live report reads process rows, local MCP config summaries, launchd
service metadata, an optional route registry for supervised agents and
startup-spawn config summaries, the knowledge-base receipt join-back report, and
the long-lived producer activity report, and local-substrate health probes. It
does not print raw config files, raw pending receipt rows, raw producer logs, or
environment secrets.
`
}

function parseArgs(argv) {
  const out = {
    json: false,
    snapshotPath: undefined,
    routeRegistryPath: DEFAULT_ROUTE_REGISTRY_PATH,
    knowledgeBaseReceiptReportPath: DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_PATH,
    longLivedActivityReportPath: DEFAULT_LONG_LIVED_ACTIVITY_REPORT_PATH,
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
    } else if (arg === '--knowledge-base-receipt-report') {
      out.knowledgeBaseReceiptReportPath = requireValue(
        argv,
        ++i,
        '--knowledge-base-receipt-report',
      )
    } else if (arg === '--long-lived-activity-report') {
      out.longLivedActivityReportPath = requireValue(argv, ++i, '--long-lived-activity-report')
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

function readPackageVersion(path) {
  try {
    const parsed = readJson(path)
    return typeof parsed.version === 'string' && parsed.version.trim()
      ? parsed.version.trim()
      : null
  } catch {
    return null
  }
}

function collectExpectedRuntimeVersions() {
  return {
    checked: true,
    coordinator: readPackageVersion(EXPECTED_RUNTIME_PACKAGE_PATHS.coordinator),
    primitive_runtime: readPackageVersion(EXPECTED_RUNTIME_PACKAGE_PATHS.primitive_runtime),
  }
}

function safeFileMtimeMs(path) {
  try {
    return statSync(path).mtimeMs
  } catch {
    return Number.NaN
  }
}

function parseSessionContextId(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const candidate = value.trim().replace(/-/g, '').toLowerCase()
  return HEX_32.test(candidate) ? candidate : undefined
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
  if (command.includes('/services/atrib-primitives/dist/index.js')) {
    return primitiveRuntimeTransport({ command }) === 'stdio-http-proxy'
      ? 'atrib-primitives-proxy'
      : 'atrib-primitives'
  }
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
  if (command.includes(`/${AGENT_BRIDGE_ATTRIBUTED_SERVICE}/dist/`)) {
    return bridgeRuntimeTransport({ command }) === 'stdio-http-proxy'
      ? 'agent-bridge-proxy'
      : 'agent-bridge-runtime'
  }
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
  const primitiveProxy = rows.filter((row) => row.service === 'atrib-primitives-proxy')
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

  const proxyGroups = [...groupBy(primitiveProxy, (row) => row.ppid).entries()]
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
    primitive_proxy_processes: primitiveProxy.length,
    primitive_proxy_stdio_processes: primitiveProxy.filter(
      (row) => primitiveRuntimeTransport(row) === 'stdio-http-proxy',
    ).length,
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
    proxy_groups: proxyGroups,
    standalone_groups: standaloneGroups,
  }
}

function summarizeBridgeProcesses(rows, byPid) {
  const runtime = rows.filter((row) => row.service === 'agent-bridge-runtime')
  const runtimeHttp = runtime.filter((row) => bridgeRuntimeTransport(row) === 'streamable-http')
  const proxy = rows.filter((row) => row.service === 'agent-bridge-proxy')
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
    bridge_runtime_processes: runtime.length,
    bridge_runtime_http_processes: runtimeHttp.length,
    bridge_proxy_processes: proxy.length,
    bridge_proxy_stdio_processes: proxy.filter(
      (row) => bridgeRuntimeTransport(row) === 'stdio-http-proxy',
    ).length,
    bridge_wrapper_processes: wrappers.length,
    bridge_upstream_processes: upstreams.length,
    obsolete_bridge_wrapper_processes: 0,
    obsolete_bridge_upstream_processes: 0,
    obsolete_bridge_wrapper_groups: 0,
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

function annotateBridgeConfigDrift(processSummary, configs) {
  const byName = new Map(configs.map((config) => [config.name, config]))
  const bridgeGroups = processSummary.bridge_groups.map((group) => {
    const config = group.config_surface ? byName.get(group.config_surface) : undefined
    const configDeclaresBridgeHttp = (config?.bridge_http_endpoints ?? []).length > 0
    const obsolete_config_drift = Boolean(config?.exists) && configDeclaresBridgeHttp
    return {
      ...group,
      config_declares_bridge_http: configDeclaresBridgeHttp,
      obsolete_config_drift,
    }
  })

  const obsoleteGroups = bridgeGroups.filter((group) => group.obsolete_config_drift)
  return {
    ...processSummary,
    bridge_groups: bridgeGroups,
    obsolete_bridge_wrapper_processes: obsoleteGroups.reduce(
      (sum, group) => sum + group.process_count,
      0,
    ),
    obsolete_bridge_upstream_processes: obsoleteGroups.reduce(
      (sum, group) => sum + group.upstream_child_processes,
      0,
    ),
    obsolete_bridge_wrapper_groups: obsoleteGroups.length,
  }
}

function primitiveRuntimeTransport(row) {
  if (row.command.includes('--transport stdio-http-proxy')) return 'stdio-http-proxy'
  return row.command.includes('--transport streamable-http') || row.command.includes('--http')
    ? 'streamable-http'
    : 'stdio'
}

function bridgeRuntimeTransport(row) {
  if (row.command.includes('--transport stdio-http-proxy')) return 'stdio-http-proxy'
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

function summarizeClaudeConfig(path, name = 'claude-code') {
  if (!existsSync(path)) {
    return missingConfig(name, path)
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
    const primitiveEndpoint = httpEndpointFromMcpServer(primitiveServer)
    if (primitiveEndpoint) {
      primitiveHttpEndpoints.push(primitiveEndpoint)
    }
    const bridgeServer = servers['agent-bridge']
    const bridgeEndpoint = httpEndpointFromMcpServer(bridgeServer)
    if (bridgeEndpoint) {
      bridgeHttpEndpoints.push(bridgeEndpoint)
    }
    return summarizeServerConfig({
      name,
      path,
      serverNames,
      endpointValues,
      primitiveHttpEndpoints,
      bridgeHttpEndpoints,
      text: JSON.stringify(servers),
    })
  } catch (error) {
    return {
      name,
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

function httpEndpointFromMcpServer(server) {
  if (!server || typeof server !== 'object') return undefined
  if (typeof server.url === 'string') return server.url
  const env = server.env && typeof server.env === 'object' ? server.env : {}
  if (typeof env.ATRIB_PRIMITIVES_HTTP_ENDPOINT === 'string') {
    return env.ATRIB_PRIMITIVES_HTTP_ENDPOINT
  }
  if (typeof env.AGENT_BRIDGE_HTTP_ENDPOINT === 'string') {
    return env.AGENT_BRIDGE_HTTP_ENDPOINT
  }
  const args = Array.isArray(server.args) ? server.args : []
  const endpointIndex = args.indexOf('--endpoint')
  const endpoint = endpointIndex >= 0 ? args[endpointIndex + 1] : undefined
  return typeof endpoint === 'string' ? endpoint : undefined
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
      firstEnvValue(env, SAFE_ENDPOINT_ENV_KEYS) || endpointFromProgramArguments(args)
    return {
      label: parsed.Label ?? undefined,
      path: displayPath(path),
      kind: String(parsed.Label ?? '').includes('atrib-drain') ? 'watcher-wal' : 'coordinator',
      program: args[0] ?? undefined,
      endpoint,
      agent: firstEnvValue(env, SAFE_AGENT_ENV_KEYS),
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
    const agent =
      firstEnvValue(env, SAFE_AGENT_ENV_KEYS) ??
      firstEnvValue(fileEnv, SAFE_AGENT_ENV_KEYS) ??
      agentNameFromLongLivedLabel(label)
    const endpoint =
      firstEnvValue(env, SAFE_ENDPOINT_ENV_KEYS) ??
      firstEnvValue(fileEnv, SAFE_ENDPOINT_ENV_KEYS) ??
      openClawEndpointFor(label, agent)
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
  let text
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

function loopbackEndpoint(value) {
  const endpoints = endpointList(value)
  return endpoints[0]
}

function readOpenClawConfigEndpoint() {
  const stdout = run('openclaw', ['config', 'get', 'env', '--json'])
  if (!stdout) return undefined
  try {
    return loopbackEndpoint(JSON.parse(stdout)?.vars?.ATRIB_LOCAL_SUBSTRATE_ENDPOINT)
  } catch {
    return undefined
  }
}

function openClawEndpointFor(label, agent) {
  return label === 'ai.openclaw.gateway' || agent === 'openclaw'
    ? readOpenClawConfigEndpoint()
    : undefined
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

function collectRouteRegistryDiagnostics(routeRegistryPath = DEFAULT_ROUTE_REGISTRY_PATH) {
  const expandedPath = expandHomePath(routeRegistryPath)
  if (!expandedPath) return []
  const path = displayPath(expandedPath)
  if (!existsSync(expandedPath)) {
    return [{ path, exists: false, status: 'absent' }]
  }
  try {
    return routeRegistryDiagnosticsFromRegistry(readJson(expandedPath), {
      registryPath: expandedPath,
    })
  } catch (error) {
    return [
      {
        path,
        exists: true,
        status: 'parse_error',
        reason: error instanceof Error ? error.message : String(error),
      },
    ]
  }
}

function collectKnowledgeBaseReceiptReport({
  path = DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_PATH,
  maxAgeMs = DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_MAX_AGE_MS,
} = {}) {
  const expandedPath = expandHomePath(path)
  const display = expandedPath ? displayPath(expandedPath) : path
  if (!expandedPath || !existsSync(expandedPath)) {
    return {
      path: display,
      exists: false,
      status: 'absent',
      max_age_ms: maxAgeMs,
    }
  }

  let raw
  try {
    raw = readJson(expandedPath)
  } catch (error) {
    return {
      path: display,
      exists: true,
      status: 'parse_error',
      reason: error instanceof Error ? error.message : String(error),
      max_age_ms: maxAgeMs,
    }
  }

  const rawReceiptIntegrity = raw?.receipt_integrity
  const receiptIntegrityNumericFields =
    rawReceiptIntegrity && typeof rawReceiptIntegrity === 'object'
      ? {
          receipt_integrity_active_receipt_files: rawReceiptIntegrity.active_receipt_files,
          receipt_integrity_active_joinable_receipt_files:
            rawReceiptIntegrity.active_joinable_receipt_files,
          receipt_integrity_non_joinable_receipt_files:
            rawReceiptIntegrity.non_joinable_receipt_files,
          receipt_integrity_invalid_receipt_files: rawReceiptIntegrity.invalid_receipt_files,
          receipt_integrity_orphan_receipt_files: rawReceiptIntegrity.orphan_receipt_files,
          receipt_integrity_receipt_mismatches: rawReceiptIntegrity.receipt_mismatches,
          receipt_integrity_ready_to_join_receipt_files:
            rawReceiptIntegrity.ready_to_join_receipt_files,
          receipt_integrity_already_joined_receipt_files:
            rawReceiptIntegrity.already_joined_receipt_files,
        }
      : {}
  const numericFields = {
    observation_entries: raw?.observations?.entries,
    observation_pending_receipt_joins: raw?.observations?.pending_receipt_joins,
    annotation_entries: raw?.annotations?.entries,
    annotation_pending_receipt_or_parent_joins: raw?.annotations?.pending_receipt_or_parent_joins,
    wal_queued: raw?.wal?.queued,
    wal_quarantined: raw?.wal?.quarantined,
    wal_receipted: raw?.wal?.receipted,
  }
  const missingFields = Object.entries(numericFields)
    .filter(([, value]) => !isNonNegativeInteger(value))
    .map(([name]) => name)
  const malformedOptionalFields = Object.entries(receiptIntegrityNumericFields)
    .filter(([, value]) => value !== undefined && !isNonNegativeInteger(value))
    .map(([name]) => name)
  if (rawReceiptIntegrity !== undefined && typeof rawReceiptIntegrity !== 'object') {
    malformedOptionalFields.push('receipt_integrity')
  }
  if (
    rawReceiptIntegrity &&
    typeof rawReceiptIntegrity === 'object' &&
    rawReceiptIntegrity.issues !== undefined &&
    !Array.isArray(rawReceiptIntegrity.issues)
  ) {
    malformedOptionalFields.push('receipt_integrity_issues')
  }

  const generatedAtMs =
    typeof raw?.generated_at === 'string' ? Date.parse(raw.generated_at) : Number.NaN
  const fileMtimeMs = safeFileMtimeMs(expandedPath)
  const ageSourceMs = Number.isFinite(generatedAtMs) ? generatedAtMs : fileMtimeMs
  const ageMs = Number.isFinite(ageSourceMs) ? Math.max(0, Date.now() - ageSourceMs) : undefined

  if (missingFields.length > 0 || malformedOptionalFields.length > 0) {
    return {
      path: display,
      exists: true,
      status: 'invalid_shape',
      reason: `missing, malformed, or non-negative-integer field(s): ${missingFields.concat(malformedOptionalFields).join(', ')}`,
      generated_at: typeof raw?.generated_at === 'string' ? raw.generated_at : undefined,
      age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
      max_age_ms: maxAgeMs,
    }
  }

  const observationPending = Number(raw.observations.pending_receipt_joins)
  const annotationPending = Number(raw.annotations.pending_receipt_or_parent_joins)
  const walQueued = Number(raw.wal.queued)
  const walQuarantined = Number(raw.wal.quarantined)
  const walReceipted = Number(raw.wal.receipted)
  const recomputedPending =
    observationPending + annotationPending + walQueued + walQuarantined + walReceipted
  const receiptIntegrity =
    rawReceiptIntegrity && typeof rawReceiptIntegrity === 'object'
      ? {
          active_receipt_files: Number(rawReceiptIntegrity.active_receipt_files ?? walReceipted),
          active_joinable_receipt_files: Number(
            rawReceiptIntegrity.active_joinable_receipt_files ?? walReceipted,
          ),
          non_joinable_receipt_files: Number(rawReceiptIntegrity.non_joinable_receipt_files ?? 0),
          invalid_receipt_files: Number(rawReceiptIntegrity.invalid_receipt_files ?? 0),
          orphan_receipt_files: Number(rawReceiptIntegrity.orphan_receipt_files ?? 0),
          receipt_mismatches: Number(rawReceiptIntegrity.receipt_mismatches ?? 0),
          ready_to_join_receipt_files: Number(rawReceiptIntegrity.ready_to_join_receipt_files ?? 0),
          already_joined_receipt_files: Number(
            rawReceiptIntegrity.already_joined_receipt_files ?? 0,
          ),
          issues: Array.isArray(rawReceiptIntegrity.issues) ? rawReceiptIntegrity.issues.length : 0,
        }
      : {
          active_receipt_files: walReceipted,
          active_joinable_receipt_files: walReceipted,
          non_joinable_receipt_files: 0,
          invalid_receipt_files: 0,
          orphan_receipt_files: 0,
          receipt_mismatches: 0,
          ready_to_join_receipt_files: 0,
          already_joined_receipt_files: 0,
          issues: undefined,
        }
  const activity = normalizeKnowledgeBaseActivity(raw?.activity)
  const declaredPending = Number.isFinite(Number(raw?.pending?.total))
    ? Number(raw.pending.total)
    : 0
  const totalPending = Math.max(
    declaredPending,
    recomputedPending,
    knowledgeBaseReceiptIntegrityBlockingTotal({
      receipt_integrity: receiptIntegrity,
      wal: { receipted: walReceipted },
    }),
  )
  const stale = ageMs === undefined ? true : ageMs > maxAgeMs
  const status = totalPending > 0 ? 'backlog' : stale ? 'stale' : 'clean'

  return {
    path: display,
    exists: true,
    status,
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : undefined,
    age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
    max_age_ms: maxAgeMs,
    stale,
    days: Number.isFinite(Number(raw.days)) ? Number(raw.days) : undefined,
    observations: {
      entries: Number(raw.observations.entries),
      pending_receipt_joins: observationPending,
    },
    annotations: {
      entries: Number(raw.annotations.entries),
      pending_receipt_or_parent_joins: annotationPending,
    },
    wal: {
      queued: walQueued,
      non_joinable_queued: Number(raw?.wal?.non_joinable_queued ?? 0),
      quarantined: walQuarantined,
      receipted: walReceipted,
      non_joinable_receipted: Number(raw?.wal?.non_joinable_receipted ?? 0),
    },
    pending: {
      observations: observationPending,
      annotations: annotationPending,
      wal_receipted: Number(raw?.pending?.wal_receipted ?? walReceipted),
      wal_queued: walQueued,
      wal_quarantined: walQuarantined,
      total: totalPending,
    },
    receipt_integrity: receiptIntegrity,
    activity,
    caveats: Array.isArray(raw.caveats) ? raw.caveats.length : undefined,
  }
}

function normalizeKnowledgeBaseActivity(activity) {
  if (!activity || typeof activity !== 'object') {
    return { status: 'missing' }
  }
  const status = stringValue(activity.status) ?? 'unknown'
  const lastActivityAt = stringValue(activity.last_activity_at)
  const lastActivityMs = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN
  const declaredAge = Number(activity.age_ms)
  const declaredAgeMs = Number.isFinite(declaredAge)
    ? Math.max(0, Math.round(declaredAge))
    : undefined
  const currentAgeMs = Number.isFinite(lastActivityMs)
    ? Math.max(0, Math.round(Date.now() - lastActivityMs))
    : undefined
  const ageMs =
    declaredAgeMs !== undefined && currentAgeMs !== undefined
      ? Math.max(declaredAgeMs, currentAgeMs)
      : (declaredAgeMs ?? currentAgeMs)
  const maxAgeMs = positiveInteger(activity.max_age_ms)
  const recordHash = stringValue(activity.record_hash)
  const contextId = parseSessionContextId(stringValue(activity.context_id))
  return withoutUndefinedValues({
    status,
    source: safeLabel(stringValue(activity.source)),
    producer: safeLabel(stringValue(activity.producer)),
    last_activity_at: Number.isFinite(lastActivityMs) ? lastActivityAt : undefined,
    age_ms: ageMs,
    max_age_ms: maxAgeMs,
    stale:
      status === 'stale' ||
      (ageMs !== undefined && maxAgeMs !== undefined ? ageMs > maxAgeMs : undefined),
    event_type: stringValue(activity.event_type),
    context_id: contextId,
    record_hash: recordHash && RECORD_HASH.test(recordHash) ? recordHash : undefined,
    topics: Array.isArray(activity.topics)
      ? activity.topics.map((topic) => safeLabel(stringValue(topic))).filter(Boolean)
      : undefined,
  })
}

function collectLongLivedActivityReport({
  path = DEFAULT_LONG_LIVED_ACTIVITY_REPORT_PATH,
  maxAgeMs = DEFAULT_LONG_LIVED_ACTIVITY_REPORT_MAX_AGE_MS,
} = {}) {
  const expandedPath = expandHomePath(path)
  const display = expandedPath ? displayPath(expandedPath) : path
  if (!expandedPath || !existsSync(expandedPath)) {
    return {
      path: display,
      exists: false,
      status: 'absent',
      max_age_ms: maxAgeMs,
      activities: [],
    }
  }

  let raw
  try {
    raw = readJson(expandedPath)
  } catch (error) {
    return {
      path: display,
      exists: true,
      status: 'parse_error',
      reason: error instanceof Error ? error.message : String(error),
      max_age_ms: maxAgeMs,
      activities: [],
    }
  }

  const generatedAtMs =
    typeof raw?.generated_at === 'string' ? Date.parse(raw.generated_at) : Number.NaN
  const fileMtimeMs = safeFileMtimeMs(expandedPath)
  const ageSourceMs = Number.isFinite(generatedAtMs) ? generatedAtMs : fileMtimeMs
  const ageMs = Number.isFinite(ageSourceMs) ? Math.max(0, Date.now() - ageSourceMs) : undefined
  const reportMaxAgeMs = positiveInteger(raw?.max_age_ms) ?? maxAgeMs
  const activityMaxAgeMs = positiveInteger(raw?.max_activity_age_ms) ?? reportMaxAgeMs
  const rawActivities = Array.isArray(raw?.activities)
    ? raw.activities
    : Array.isArray(raw?.agents)
      ? raw.agents
      : undefined

  if (raw?.schema !== undefined && raw.schema !== LONG_LIVED_ACTIVITY_REPORT_SCHEMA) {
    return {
      path: display,
      exists: true,
      status: 'invalid_shape',
      reason: `schema must be ${LONG_LIVED_ACTIVITY_REPORT_SCHEMA}`,
      generated_at: typeof raw?.generated_at === 'string' ? raw.generated_at : undefined,
      age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
      max_age_ms: reportMaxAgeMs,
      activities: [],
    }
  }

  if (!Array.isArray(rawActivities)) {
    return {
      path: display,
      exists: true,
      status: 'invalid_shape',
      reason: 'activities must be an array',
      generated_at: typeof raw?.generated_at === 'string' ? raw.generated_at : undefined,
      age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
      max_age_ms: reportMaxAgeMs,
      activities: [],
    }
  }

  const normalized = []
  const invalid = []
  for (const [index, activity] of rawActivities.entries()) {
    const item = normalizeLongLivedActivity(activity, {
      index,
      maxAgeMs: activityMaxAgeMs,
    })
    if (item.invalid) invalid.push(item.invalid)
    else normalized.push(item)
  }

  if (invalid.length > 0) {
    return {
      path: display,
      exists: true,
      status: 'invalid_shape',
      reason: invalid.slice(0, 3).join('; '),
      generated_at: typeof raw?.generated_at === 'string' ? raw.generated_at : undefined,
      age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
      max_age_ms: reportMaxAgeMs,
      max_activity_age_ms: activityMaxAgeMs,
      activities: [],
    }
  }

  const stale = ageMs === undefined ? true : ageMs > reportMaxAgeMs
  const ok = normalized.filter((item) => item.status === 'ok' && !item.stale).length
  const staleActivities = normalized.filter((item) => item.status === 'ok' && item.stale).length
  const errors = normalized.filter((item) => item.status !== 'ok').length
  const status =
    errors > 0
      ? 'backlog'
      : stale || staleActivities > 0
        ? 'stale'
        : normalized.length > 0
          ? 'clean'
          : 'empty'

  return {
    path: display,
    exists: true,
    status,
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : undefined,
    age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
    max_age_ms: reportMaxAgeMs,
    max_activity_age_ms: activityMaxAgeMs,
    stale,
    activities: normalized,
    counts: {
      total: normalized.length,
      ok,
      stale: staleActivities,
      error: errors,
    },
  }
}

function normalizeLongLivedActivity(activity, { index, maxAgeMs }) {
  if (!activity || typeof activity !== 'object') {
    return { invalid: `activities[${index}] must be an object` }
  }
  const label = safeLabel(stringValue(activity.label))
  const agent = safeLabel(stringValue(activity.agent))
  if (!label && !agent) {
    return { invalid: `activities[${index}] requires label or agent` }
  }
  const status = stringValue(activity.status) ?? 'unknown'
  const lastActivityAt = stringValue(activity.last_activity_at)
  const lastActivityMs = lastActivityAt ? Date.parse(lastActivityAt) : Number.NaN
  if (!Number.isFinite(lastActivityMs)) {
    return { invalid: `activities[${index}] requires valid last_activity_at` }
  }
  const ageMs = Number.isFinite(lastActivityMs)
    ? Math.max(0, Date.now() - lastActivityMs)
    : undefined
  const recordHash = stringValue(activity.record_hash)
  if (!recordHash || !RECORD_HASH.test(recordHash)) {
    return { invalid: `activities[${index}] requires valid record_hash` }
  }
  const endpoint = endpointList(
    stringValue(activity.route_endpoint) ??
      stringValue(activity.endpoint) ??
      stringValue(activity.coordinator_endpoint),
  )[0]
  if (!endpoint) {
    return { invalid: `activities[${index}] requires loopback route_endpoint` }
  }

  return withoutUndefinedValues({
    label,
    agent,
    status,
    last_activity_at: Number.isFinite(lastActivityMs) ? lastActivityAt : undefined,
    age_ms: ageMs === undefined ? undefined : Math.round(ageMs),
    stale: ageMs === undefined ? true : ageMs > maxAgeMs,
    record_hash: recordHash,
    route_endpoint: endpoint,
    producer: safeLabel(stringValue(activity.producer)),
    local_substrate_mode: safeLabel(stringValue(activity.local_substrate_mode)),
    submission: safeLabel(stringValue(activity.submission)),
  })
}

function safeLabel(value) {
  if (!value) return undefined
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined
}

function isNonNegativeInteger(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0
}

function routeRegistryDiagnosticsFromRegistry(registry, { registryPath } = {}) {
  const path = registryPath ? displayPath(registryPath) : undefined
  if (Array.isArray(registry)) {
    return [{ path, exists: true, status: 'valid', entries: registry.length }]
  }
  if (!registry || typeof registry !== 'object') {
    return [
      {
        path,
        exists: true,
        status: 'invalid_shape',
        reason: 'registry root must be an object or array',
      },
    ]
  }
  if (registry.schema && registry.schema !== ROUTE_REGISTRY_SCHEMA) {
    return [
      {
        path,
        exists: true,
        status: 'invalid_schema',
        schema: stringValue(registry.schema),
        expected_schema: ROUTE_REGISTRY_SCHEMA,
      },
    ]
  }
  const routes = routeRegistryEntries(registry)
  if (
    routes.length === 0 &&
    !Array.isArray(registry.routes) &&
    !Array.isArray(registry.long_lived_agents)
  ) {
    return [
      {
        path,
        exists: true,
        status: 'invalid_shape',
        reason: 'registry object must include routes[] or long_lived_agents[]',
      },
    ]
  }
  return [{ path, exists: true, status: 'valid', entries: routes.length }]
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
  const agent = stringValue(route.agent) ?? firstEnvValue(fileEnv, SAFE_AGENT_ENV_KEYS)
  const routeLabel = stringValue(route.label)
  const endpoint =
    stringValue(route.endpoint) ??
    firstEnvValue(fileEnv, SAFE_ENDPOINT_ENV_KEYS) ??
    openClawEndpointFor(routeLabel, agent)
  const label =
    routeLabel ??
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
  knowledgeBaseReceiptReportPath = DEFAULT_KNOWLEDGE_BASE_RECEIPT_REPORT_PATH,
  longLivedActivityReportPath = DEFAULT_LONG_LIVED_ACTIVITY_REPORT_PATH,
} = {}) {
  const launchAgents = collectLaunchAgents()
  const longLivedAgents = collectLongLivedAgents({ routeRegistryPath })
  const routeRegistryDiagnostics = collectRouteRegistryDiagnostics(routeRegistryPath)
  const configs = dedupeServerConfigs([
    summarizeCodexConfig(join(HOME, '.codex/config.toml')),
    summarizeClaudeConfig(join(HOME, '.claude.json')),
    summarizeClaudeConfig(
      join(HOME, 'Library/Application Support/Claude/claude_desktop_config.json'),
      'claude-desktop',
    ),
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
  const activeSessionState = collectActiveSessionState(
    unique(primitiveRuntimeHealth.map((item) => item.report?.profile?.agent).filter(Boolean)),
  )
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
    route_registry: routeRegistryDiagnostics,
    coordinator_health: coordinatorHealth,
    primitive_runtime_health: primitiveRuntimeHealth,
    expected_runtime_versions: collectExpectedRuntimeVersions(),
    active_session_state: activeSessionState,
    bridge_runtime_health: bridgeRuntimeHealth,
    knowledge_base_receipt_report: collectKnowledgeBaseReceiptReport({
      path: knowledgeBaseReceiptReportPath,
    }),
    long_lived_activity_report: collectLongLivedActivityReport({
      path: longLivedActivityReportPath,
    }),
  }
}

function collectActiveSessionState(profiles) {
  return profiles.map((profile) => {
    if (!SAFE_ACTIVE_SESSION_PROFILE.test(profile)) {
      return {
        profile,
        exists: false,
        valid_context_id: false,
        reason: 'unsafe profile name',
      }
    }
    const path = join(ACTIVE_SESSION_STATE_DIR, `active-session-id-${profile}`)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) {
        return {
          profile,
          path: displayPath(path),
          exists: false,
          valid_context_id: false,
          reason: 'not a file',
        }
      }
      if (stat.size > ACTIVE_SESSION_STATE_MAX_BYTES) {
        return {
          profile,
          path: displayPath(path),
          exists: true,
          valid_context_id: false,
          fresh_context_id: false,
          mtime_ms: Math.round(stat.mtimeMs),
          age_ms: Math.max(0, Math.round(Date.now() - stat.mtimeMs)),
          max_age_ms: ACTIVE_SESSION_STATE_MAX_AGE_MS,
          reason: 'oversize',
        }
      }
      const contextId = parseSessionContextId(readFileSync(path, 'utf8'))
      const ageMs = Math.max(0, Math.round(Date.now() - stat.mtimeMs))
      const validContextId = Boolean(contextId)
      const freshContextId = validContextId && ageMs <= ACTIVE_SESSION_STATE_MAX_AGE_MS
      return {
        profile,
        path: displayPath(path),
        exists: true,
        valid_context_id: validContextId,
        fresh_context_id: freshContextId,
        mtime_ms: Math.round(stat.mtimeMs),
        age_ms: ageMs,
        max_age_ms: ACTIVE_SESSION_STATE_MAX_AGE_MS,
        reason: validContextId && !freshContextId ? 'stale' : undefined,
      }
    } catch {
      return {
        profile,
        path: displayPath(path),
        exists: false,
        valid_context_id: false,
        fresh_context_id: false,
        reason: 'missing',
      }
    }
  })
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
      backend: report.primitive_runtime?.backend,
      session_model: report.primitive_runtime?.session_model,
      tool_count: report.primitive_runtime?.tool_count,
      mounted_primitive_count: report.primitive_runtime?.mounted_primitive_count,
      agent: report.profile?.agent,
      mirror_file: report.profile?.mirror_file,
      local_substrate_endpoint: report.profile?.local_substrate_endpoint,
      context_id_policy: report.profile?.context_id_policy,
      requires_explicit_context_id: report.profile?.requires_explicit_context_id,
      active_sessions: report.sessions?.active,
      opened_sessions: report.sessions?.opened,
      active_http_requests: report.sessions?.active_http_requests,
      active_http_connections: report.sessions?.active_http_connections,
      active_tool_calls: report.tool_calls?.active_tool_calls,
      calls_timed_out: report.tool_calls?.calls_timed_out,
      calls_settled_after_timeout: report.tool_calls?.calls_settled_after_timeout,
      in_flight_tool_calls: report.tool_calls?.in_flight_tool_calls,
      reason: item.reason,
      http_status: item.http_status,
    }
  })
}

function expectedRuntimeVersion(expectedRuntimeVersions, key) {
  return typeof expectedRuntimeVersions?.[key] === 'string' && expectedRuntimeVersions[key].trim()
    ? expectedRuntimeVersions[key].trim()
    : undefined
}

function runtimeVersionCheckEnabled(expectedRuntimeVersions, key) {
  return (
    expectedRuntimeVersions?.checked === true ||
    Object.prototype.hasOwnProperty.call(expectedRuntimeVersions ?? {}, key)
  )
}

function coordinatorVersion(item) {
  return stringValue(item.report?.coordinator?.version)
}

function primitiveRuntimeVersion(item) {
  return stringValue(item.report?.primitive_runtime?.version)
}

function healthyItems(items) {
  return items.filter((item) => item.reachable && item.status === 'healthy')
}

function versionMismatches(items, expectedVersion, versionFn) {
  if (!expectedVersion) return []
  return healthyItems(items)
    .filter((item) => versionFn(item) !== expectedVersion)
    .map((item) => ({
      endpoint: item.endpoint,
      pid: item.report?.coordinator?.pid ?? item.report?.primitive_runtime?.pid,
      version: versionFn(item),
    }))
}

function hasSharedPrimitiveHttpBackend(item) {
  const runtime = item.report?.primitive_runtime ?? {}
  return (
    item.reachable === true &&
    item.status === 'healthy' &&
    runtime.transport === 'streamable-http' &&
    runtime.backend === 'shared' &&
    runtime.session_model === 'per-session-transport-shared-backend' &&
    Number(runtime.mounted_primitive_count) === 7 &&
    Number(runtime.tool_count) === 15
  )
}

function hasExplicitContextIdPolicy(item) {
  return (
    item.reachable === true &&
    item.status === 'healthy' &&
    item.report?.profile?.requires_explicit_context_id === true
  )
}

function primitiveRuntimeHasNoLiveClientSessions(item) {
  const sessions = item?.report?.sessions
  const activeHttpConnections = Number(sessions?.active_http_connections)
  if (Number.isFinite(activeHttpConnections)) return activeHttpConnections === 0
  const activeHttpRequests = Number(sessions?.active_http_requests)
  if (Number.isFinite(activeHttpRequests)) return activeHttpRequests === 0
  return Number(sessions?.active) === 0 && Number(sessions?.opened) === 0
}

function primitiveRuntimeActiveToolCalls(item) {
  const active = Number(item?.report?.tool_calls?.active_tool_calls)
  return Number.isFinite(active) ? active : 0
}

function primitiveRuntimeTimedOutToolCallTotal(item) {
  const timedOut = Number(item?.report?.tool_calls?.calls_timed_out)
  return Number.isFinite(timedOut) ? timedOut : 0
}

function primitiveRuntimeActiveTimedOutToolCalls(item) {
  const toolCalls = item?.report?.tool_calls
  const timeoutMs = Number(toolCalls?.tool_timeout_ms)
  return Array.isArray(toolCalls?.in_flight_tool_calls)
    ? toolCalls.in_flight_tool_calls.filter((call) => {
        if (call?.timed_out === true) return true
        const elapsedMs = Number(call?.elapsed_ms)
        return Number.isFinite(timeoutMs) && Number.isFinite(elapsedMs) && elapsedMs >= timeoutMs
      })
    : []
}

function primitiveRuntimeToolDispatchProblem(item) {
  return (
    item.reachable === true &&
    (item.status === 'degraded' || primitiveRuntimeActiveTimedOutToolCalls(item).length > 0)
  )
}

function activeSessionStateAgeMs(item) {
  if (Number.isFinite(item?.age_ms)) return Math.max(0, Math.round(item.age_ms))
  if (Number.isFinite(item?.mtime_ms)) return Math.max(0, Math.round(Date.now() - item.mtime_ms))
  return undefined
}

function activeSessionStateMaxAgeMs(item) {
  return Number.isFinite(item?.max_age_ms)
    ? Math.max(0, Math.round(item.max_age_ms))
    : ACTIVE_SESSION_STATE_MAX_AGE_MS
}

function hasFreshActiveSessionState(item) {
  if (!item?.valid_context_id) return false
  if (typeof item.fresh_context_id === 'boolean') return item.fresh_context_id
  const ageMs = activeSessionStateAgeMs(item)
  return Number.isFinite(ageMs) && ageMs <= activeSessionStateMaxAgeMs(item)
}

function activeSessionCoverage(primitiveHealth, activeSessionState) {
  const healthyPrimitiveHttp = primitiveHealth.filter(
    (item) => item.reachable && item.status === 'healthy',
  )
  const runtimeProfiles = unique(healthyPrimitiveHttp.map((item) => item.report?.profile?.agent))
  const primitiveHttpByProfile = new Map(
    healthyPrimitiveHttp.map((item) => [item.report?.profile?.agent, item]),
  )
  const activeSessionStateByProfile = new Map(
    activeSessionState.map((item) => [item.profile, item]),
  )
  const explicitContextProfiles = unique(
    healthyPrimitiveHttp
      .filter(hasExplicitContextIdPolicy)
      .map((item) => item.report?.profile?.agent),
  )
  const explicitContextProfileSet = new Set(explicitContextProfiles)
  const validStateProfiles = runtimeProfiles.filter(
    (profile) => activeSessionStateByProfile.get(profile)?.valid_context_id,
  )
  const freshStateProfiles = runtimeProfiles.filter((profile) =>
    hasFreshActiveSessionState(activeSessionStateByProfile.get(profile)),
  )
  const idleProfiles = runtimeProfiles.filter((profile) =>
    primitiveRuntimeHasNoLiveClientSessions(primitiveHttpByProfile.get(profile)),
  )
  const idleProfileSet = new Set(idleProfiles)
  const readyProfiles = runtimeProfiles.filter(
    (profile) =>
      hasFreshActiveSessionState(activeSessionStateByProfile.get(profile)) ||
      explicitContextProfileSet.has(profile) ||
      idleProfileSet.has(profile),
  )
  const missingProfiles = runtimeProfiles.filter(
    (profile) =>
      !hasFreshActiveSessionState(activeSessionStateByProfile.get(profile)) &&
      !explicitContextProfileSet.has(profile) &&
      !idleProfileSet.has(profile),
  )
  return {
    runtimeProfiles,
    validStateProfiles,
    freshStateProfiles,
    idleProfiles,
    explicitContextProfiles,
    readyProfiles,
    missingProfiles,
  }
}

function activeSessionStateSummary(items) {
  return items.map((item) => {
    const ageMs = activeSessionStateAgeMs(item)
    const freshContextId = hasFreshActiveSessionState(item)
    return {
      profile: item.profile,
      path: item.path,
      exists: Boolean(item.exists),
      valid_context_id: Boolean(item.valid_context_id),
      fresh_context_id: freshContextId,
      mtime_ms: item.mtime_ms,
      age_ms: ageMs,
      max_age_ms: activeSessionStateMaxAgeMs(item),
      reason: item.reason ?? (item.valid_context_id && !freshContextId ? 'stale' : undefined),
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

function localSubstrateEndpointEvidenceForConfig(config, primitiveHealthByEndpoint) {
  const evidence = []
  for (const endpoint of config.local_substrate_endpoints ?? []) {
    evidence.push({
      source: config.source === 'registry' ? 'route-registry' : 'config',
      endpoint,
    })
  }
  for (const primitiveEndpoint of config.primitive_http_endpoints ?? []) {
    const health = primitiveHealthByEndpoint.get(primitiveEndpoint)
    const endpoint = health?.report?.profile?.local_substrate_endpoint
    if (endpoint) {
      evidence.push({
        source: 'primitive-runtime-profile',
        endpoint,
        primitive_http_endpoint: primitiveEndpoint,
        profile: health?.report?.profile?.agent,
      })
    }
  }
  const seen = new Set()
  return evidence.filter((item) => {
    const key = `${item.source}:${item.endpoint}:${item.primitive_http_endpoint ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function configSurfaceSummary(configs, primitiveHealth) {
  const healthyPrimitiveHttpByEndpoint = new Map(
    primitiveHealth
      .filter((item) => item.reachable && item.status === 'healthy')
      .map((item) => [item.endpoint, item]),
  )
  return configs.map((config) => {
    const localSubstrateEndpointEvidence = localSubstrateEndpointEvidenceForConfig(
      config,
      healthyPrimitiveHttpByEndpoint,
    )
    return {
      ...config,
      effective_local_substrate_endpoints: unique(
        localSubstrateEndpointEvidence.map((item) => item.endpoint),
      ),
      local_substrate_endpoint_evidence: localSubstrateEndpointEvidence,
    }
  })
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

function summarizeLongLivedActivity(longLivedAgents, activityReport) {
  const reportStatus = longLivedActivityReportStatus(activityReport)
  const activities = Array.isArray(activityReport?.activities) ? activityReport.activities : []
  const byLabel = new Map(activities.filter((item) => item.label).map((item) => [item.label, item]))
  const byAgent = new Map(activities.filter((item) => item.agent).map((item) => [item.agent, item]))
  const reportClean = reportStatus === 'clean'
  const agents = longLivedAgents.map((agent) => {
    const activity = byLabel.get(agent.label) ?? byAgent.get(agent.agent)
    const routeEndpointMatches =
      Boolean(activity?.route_endpoint) && activity?.route_endpoint === agent.endpoint
    const delegatedCommit =
      activity?.local_substrate_mode === 'commit' &&
      activity?.submission === 'local_substrate_delegated'
    const activityOk = Boolean(
      reportClean &&
      activity &&
      activity.status === 'ok' &&
      activity.stale !== true &&
      activity.record_hash &&
      routeEndpointMatches &&
      delegatedCommit,
    )
    return withoutUndefinedValues({
      label: agent.label,
      agent: agent.agent,
      route_endpoint: agent.endpoint,
      activity_route_endpoint: activity?.route_endpoint,
      activity_route_endpoint_matches: routeEndpointMatches,
      activity_status: activity?.status ?? 'missing',
      last_activity_at: activity?.last_activity_at,
      activity_age_ms: activity?.age_ms,
      activity_stale: activity?.stale,
      record_hash: activity?.record_hash,
      local_substrate_mode: activity?.local_substrate_mode,
      submission: activity?.submission,
      delegated_commit: delegatedCommit,
      route_activity_ok: activityOk,
    })
  })
  const present = agents.filter((agent) => agent.activity_status !== 'missing')
  return {
    status: reportStatus,
    age_ms: activityReport?.age_ms,
    total: agents.length,
    ok: agents.filter((agent) => agent.route_activity_ok).length,
    missing: agents.filter((agent) => agent.activity_status === 'missing').length,
    stale: present.filter((agent) => agent.activity_stale === true).length,
    endpoint_mismatch: present.filter(
      (agent) =>
        agent.activity_status === 'ok' &&
        agent.activity_stale !== true &&
        agent.activity_route_endpoint_matches !== true,
    ).length,
    not_delegated: present.filter(
      (agent) =>
        agent.activity_status === 'ok' &&
        agent.activity_stale !== true &&
        agent.activity_route_endpoint_matches === true &&
        agent.delegated_commit !== true,
    ).length,
    agents,
  }
}

function longLivedActivityReportStatus(report) {
  if (!report || report.exists === false) return 'absent'
  if (report.status === 'parse_error' || report.status === 'invalid_shape') return report.status
  if (report.status === 'clean') return 'clean'
  if (report.status === 'stale') return 'stale'
  if (report.status === 'backlog') return 'backlog'
  if (report.status === 'empty') return 'empty'
  return 'unknown'
}

function knowledgeBaseReceiptReportStatus(report) {
  if (!report || report.exists === false) return 'absent'
  if (report.status === 'parse_error' || report.status === 'invalid_shape') return report.status
  if (knowledgeBaseReceiptPendingTotal(report) > 0) return 'backlog'
  if (report.stale || report.status === 'stale') return 'stale'
  return 'clean'
}

function knowledgeBaseReceiptPendingTotal(report) {
  const recomputed =
    Number(report?.observations?.pending_receipt_joins ?? 0) +
    Number(report?.annotations?.pending_receipt_or_parent_joins ?? 0) +
    Number(report?.wal?.queued ?? 0) +
    Number(report?.wal?.quarantined ?? 0) +
    Number(report?.wal?.receipted ?? 0)
  const declared = Number(report?.pending?.total ?? 0)
  return Math.max(
    Number.isFinite(declared) ? declared : 0,
    recomputed,
    knowledgeBaseReceiptIntegrityBlockingTotal(report),
  )
}

function knowledgeBaseReceiptIntegrityBlockingTotal(report) {
  const integrity = report?.receipt_integrity
  if (!integrity || typeof integrity !== 'object') return 0
  const activeJoinable = isNonNegativeInteger(integrity.active_joinable_receipt_files)
    ? Number(integrity.active_joinable_receipt_files)
    : nonNegativeIntegerOrZero(integrity.active_receipt_files ?? report?.wal?.receipted)
  return Math.max(
    0,
    activeJoinable,
    nonNegativeIntegerOrZero(integrity.invalid_receipt_files),
    nonNegativeIntegerOrZero(integrity.orphan_receipt_files),
    nonNegativeIntegerOrZero(integrity.receipt_mismatches),
    nonNegativeIntegerOrZero(integrity.ready_to_join_receipt_files),
    nonNegativeIntegerOrZero(integrity.issues),
  )
}

function nonNegativeIntegerOrZero(value) {
  return isNonNegativeInteger(value) ? Number(value) : 0
}

function knowledgeBaseReceiptSummary(report) {
  const status = knowledgeBaseReceiptReportStatus(report)
  const activity =
    report?.activity && typeof report.activity === 'object'
      ? normalizeKnowledgeBaseActivity(report.activity)
      : { status: 'missing' }
  return {
    status,
    age_ms: Number.isFinite(Number(report?.age_ms)) ? Number(report.age_ms) : undefined,
    pending_total: knowledgeBaseReceiptPendingTotal(report),
    observation_pending: Number(report?.observations?.pending_receipt_joins ?? 0),
    annotation_pending: Number(report?.annotations?.pending_receipt_or_parent_joins ?? 0),
    wal_queued: Number(report?.wal?.queued ?? 0),
    wal_non_joinable_queued: Number(report?.wal?.non_joinable_queued ?? 0),
    wal_quarantined: Number(report?.wal?.quarantined ?? 0),
    wal_receipted: Number(report?.wal?.receipted ?? 0),
    wal_non_joinable_receipted: Number(report?.wal?.non_joinable_receipted ?? 0),
    receipt_integrity: report?.receipt_integrity,
    activity,
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
  activeSessionState,
  bridgeHealth,
  routeRegistry,
  knowledgeBaseReceiptReport,
  longLivedActivityReport,
  expectedRuntimeVersions,
}) {
  const registryProblems = routeRegistry.filter(
    (item) => item.exists && item.status !== 'valid' && item.status !== 'absent',
  )
  const registryValid = routeRegistry.filter((item) => item.exists && item.status === 'valid')

  const gates = []
  if (registryProblems.length > 0) {
    gates.push(
      gate(
        'route-registry',
        'fail',
        `${registryProblems.length} route registry problem(s); future harness routes may be invisible`,
      ),
    )
  } else if (registryValid.length > 0) {
    const entries = registryValid.reduce((sum, item) => sum + Number(item.entries ?? 0), 0)
    gates.push(gate('route-registry', 'pass', `${entries} registered route entries`))
  } else {
    gates.push(gate('route-registry', 'pass', 'optional route registry absent'))
  }

  const reachableHealth = health.filter((item) => item.reachable && item.status === 'healthy')
  const unhealthyReachable = health.filter((item) => item.reachable && item.status !== 'healthy')
  const unreachable = health.filter((item) => !item.reachable)
  const healthHasBacklog = reachableHealth.some(
    (item) =>
      Number(item.report?.processes?.stale_children ?? 0) > 0 ||
      Number(item.report?.wal?.orphan_receipts ?? 0) > 0,
  )

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

  const expectedCoordinatorVersion = expectedRuntimeVersion(expectedRuntimeVersions, 'coordinator')
  if (runtimeVersionCheckEnabled(expectedRuntimeVersions, 'coordinator')) {
    const stale = versionMismatches(health, expectedCoordinatorVersion, coordinatorVersion)
    const ok = Boolean(expectedCoordinatorVersion) && stale.length === 0
    const detail = ok
      ? `all healthy coordinator endpoint(s) report @atrib/emit ${expectedCoordinatorVersion}`
      : expectedCoordinatorVersion
        ? `${stale.length} healthy coordinator endpoint(s) do not report @atrib/emit ${expectedCoordinatorVersion}`
        : 'checked-out @atrib/emit package version could not be read'
    gates.push(gate('coordinator-version-freshness', ok ? 'pass' : 'fail', detail))
  }

  if (
    processSummary.primitive_runtime_processes > 0 &&
    processSummary.primitive_runtime_stdio_processes === 0 &&
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
    const obsoleteAll = obsoleteStandaloneResidue(processSummary)
    gates.push(
      gate(
        'startup-spawn-mcp-collapse',
        'warn',
        processSummary.primitive_runtime_stdio_processes > 0
          ? `${processSummary.primitive_runtime_stdio_processes} direct stdio atrib-primitives runtime process(es); stdio-only clients should use the proxy backed by shared HTTP`
          : obsoleteAll
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
  const sharedPrimitiveHttp = healthyPrimitiveHttp.filter(hasSharedPrimitiveHttpBackend)
  const expectedPrimitiveVersion = expectedRuntimeVersion(
    expectedRuntimeVersions,
    'primitive_runtime',
  )
  if (runtimeVersionCheckEnabled(expectedRuntimeVersions, 'primitive_runtime')) {
    const stale = versionMismatches(
      primitiveHealth,
      expectedPrimitiveVersion,
      primitiveRuntimeVersion,
    )
    const ok = Boolean(expectedPrimitiveVersion) && stale.length === 0
    const detail = ok
      ? `all healthy primitive HTTP endpoint(s) report @atrib/primitives-runtime ${expectedPrimitiveVersion}`
      : expectedPrimitiveVersion
        ? `${stale.length} healthy primitive HTTP endpoint(s) do not report @atrib/primitives-runtime ${expectedPrimitiveVersion}`
        : 'checked-out @atrib/primitives-runtime package version could not be read'
    gates.push(gate('primitive-runtime-version-freshness', ok ? 'pass' : 'fail', detail))
  }
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
  const sharedPrimitiveHttpEndpoints = new Set(sharedPrimitiveHttp.map((item) => item.endpoint))
  const unhealthyConfiguredPrimitiveEndpoints = configuredPrimitiveHttpEndpoints.filter(
    (endpoint) => !healthyPrimitiveHttpEndpoints.has(endpoint),
  )
  const nonSharedConfiguredPrimitiveEndpoints = configuredPrimitiveHttpEndpoints.filter(
    (endpoint) => !sharedPrimitiveHttpEndpoints.has(endpoint),
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
    nonSharedConfiguredPrimitiveEndpoints.length === 0 &&
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
        `${processSummary.primitive_runtime_http_processes} primitive HTTP process(es), ${healthyPrimitiveHttp.length} healthy endpoint(s), ${sharedPrimitiveHttp.length} shared backend endpoint(s), ${configuredPrimitiveHttpEndpoints.length} configured endpoint(s), ${configsWithPrimitiveHttp.length}/${existingConfigs.length} config(s) point at HTTP, ${profileMismatches.length} profile mismatch(es)`,
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

  const primitiveDispatchProblems = primitiveHealth.filter(primitiveRuntimeToolDispatchProblem)
  const activeTimedOutToolCalls = primitiveDispatchProblems.reduce(
    (sum, item) => sum + primitiveRuntimeActiveTimedOutToolCalls(item).length,
    0,
  )
  if (primitiveDispatchProblems.length === 0) {
    gates.push(
      gate(
        'primitive-runtime-tool-dispatch',
        'pass',
        'no active timed-out primitive tool dispatches reported',
      ),
    )
  } else {
    gates.push(
      gate(
        'primitive-runtime-tool-dispatch',
        'warn',
        `${primitiveDispatchProblems.length} primitive HTTP endpoint(s) degraded by tool dispatch; ${activeTimedOutToolCalls} active timed-out call(s)`,
      ),
    )
  }

  const contextCoverage = activeSessionCoverage(primitiveHealth, activeSessionState)
  if (contextCoverage.runtimeProfiles.length === 0) {
    gates.push(
      gate(
        'host-owned-active-session-context',
        'fail',
        'no healthy primitive HTTP profile can prove active-session context resolution',
      ),
    )
  } else if (contextCoverage.missingProfiles.length === 0) {
    gates.push(
      gate(
        'host-owned-active-session-context',
        'pass',
        `${contextCoverage.readyProfiles.length}/${contextCoverage.runtimeProfiles.length} primitive HTTP profile(s) have context routing coverage (${contextCoverage.freshStateProfiles.length} fresh active-session state, ${contextCoverage.explicitContextProfiles.length} explicit-context-required, ${contextCoverage.idleProfiles.length} idle)`,
      ),
    )
  } else {
    gates.push(
      gate(
        'host-owned-active-session-context',
        'warn',
        `${contextCoverage.readyProfiles.length}/${contextCoverage.runtimeProfiles.length} primitive HTTP profile(s) have context routing coverage (${contextCoverage.freshStateProfiles.length} fresh active-session state, ${contextCoverage.explicitContextProfiles.length} explicit-context-required, ${contextCoverage.idleProfiles.length} idle); missing, invalid, or stale while active: ${contextCoverage.missingProfiles.join(', ')}`,
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
    const proxyDetail =
      processSummary.bridge_proxy_processes > 0
        ? `; ${processSummary.bridge_proxy_processes} stdio-http bridge proxy adapter(s)`
        : ''
    gates.push(
      gate(
        'bridge-wrapper-footprint',
        'pass',
        `no legacy bridge wrapper process evidence found${proxyDetail}`,
      ),
    )
  } else if (processSummary.obsolete_bridge_wrapper_processes > 0) {
    gates.push(
      gate(
        'bridge-wrapper-footprint',
        'warn',
        `${processSummary.obsolete_bridge_wrapper_processes} obsolete bridge wrapper process(es) plus ${processSummary.obsolete_bridge_upstream_processes} upstream child process(es) across ${processSummary.obsolete_bridge_wrapper_groups} group(s); current config points at host-owned bridge HTTP`,
      ),
    )
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

  const receiptSummary = knowledgeBaseReceiptSummary(knowledgeBaseReceiptReport)
  if (receiptSummary.status === 'clean') {
    gates.push(
      gate(
        'knowledge-base-receipt-join-back',
        'pass',
        'knowledge-base receipt join-back report is fresh and has no pending joins, active joinable receipts, orphan receipts, or mismatches',
      ),
    )
  } else if (receiptSummary.status === 'parse_error' || receiptSummary.status === 'invalid_shape') {
    gates.push(
      gate(
        'knowledge-base-receipt-join-back',
        'fail',
        `knowledge-base receipt join-back report is ${receiptSummary.status}`,
      ),
    )
  } else if (receiptSummary.status === 'backlog') {
    gates.push(
      gate(
        'knowledge-base-receipt-join-back',
        'warn',
        `${receiptSummary.pending_total} pending knowledge-base receipt or integrity item(s)`,
      ),
    )
  } else if (receiptSummary.status === 'stale') {
    gates.push(
      gate(
        'knowledge-base-receipt-join-back',
        'warn',
        'knowledge-base receipt join-back report is stale',
      ),
    )
  } else {
    gates.push(
      gate(
        'knowledge-base-receipt-join-back',
        'warn',
        'knowledge-base receipt join-back report is absent',
      ),
    )
  }

  const watcherActivity = receiptSummary.activity ?? { status: 'missing' }
  if (watcherActivity.status === 'ok' && watcherActivity.stale !== true) {
    gates.push(
      gate(
        'knowledge-base-watcher-activity',
        'pass',
        `knowledge-base watcher has recent activity evidence from ${watcherActivity.source ?? 'unknown source'}`,
      ),
    )
  } else if (watcherActivity.status === 'invalid' || watcherActivity.status === 'invalid_shape') {
    gates.push(
      gate(
        'knowledge-base-watcher-activity',
        'fail',
        `knowledge-base watcher activity evidence is ${watcherActivity.status}`,
      ),
    )
  } else {
    gates.push(
      gate(
        'knowledge-base-watcher-activity',
        'warn',
        `knowledge-base watcher activity evidence is ${watcherActivity.status ?? 'missing'}`,
      ),
    )
  }

  const longLivedRoutes = summarizeLongLivedRoutes(longLivedAgents, reachableEndpoints)
  const longLivedActivity = summarizeLongLivedActivity(longLivedAgents, longLivedActivityReport)
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

  if (longLivedRoutes.total === 0) {
    gates.push(
      gate(
        'long-lived-agent-activity',
        'warn',
        'no long-lived agent route evidence exists to match against activity',
      ),
    )
  } else if (
    longLivedActivity.status === 'parse_error' ||
    longLivedActivity.status === 'invalid_shape'
  ) {
    gates.push(
      gate(
        'long-lived-agent-activity',
        'fail',
        `long-lived activity report is ${longLivedActivity.status}`,
      ),
    )
  } else if (
    longLivedActivity.status === 'clean' &&
    longLivedActivity.ok === longLivedActivity.total
  ) {
    gates.push(
      gate(
        'long-lived-agent-activity',
        'pass',
        `${longLivedActivity.ok}/${longLivedActivity.total} known long-lived agent route(s) have recent delegated commit evidence`,
      ),
    )
  } else {
    gates.push(
      gate(
        'long-lived-agent-activity',
        'warn',
        `${longLivedActivity.ok}/${longLivedActivity.total} known long-lived agent route(s) have recent delegated commit evidence; report=${longLivedActivity.status}, missing=${longLivedActivity.missing}, stale=${longLivedActivity.stale}, endpoint_mismatch=${longLivedActivity.endpoint_mismatch}, not_delegated=${longLivedActivity.not_delegated}`,
      ),
    )
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

function obsoleteStandaloneResidue(processSummary) {
  return (
    processSummary.obsolete_standalone_primitive_processes > 0 &&
    processSummary.obsolete_standalone_primitive_processes ===
      processSummary.standalone_primitive_processes
  )
}

function obsoleteBridgeResidue(processSummary) {
  return (
    processSummary.obsolete_bridge_wrapper_processes > 0 &&
    processSummary.obsolete_bridge_wrapper_processes === processSummary.bridge_wrapper_processes &&
    processSummary.obsolete_bridge_upstream_processes === processSummary.bridge_upstream_processes
  )
}

function restartResidueGate(gateResult, processSummary) {
  if (gateResult.status === 'pass') return true
  if (gateResult.name === 'broad-default-readiness') return true
  if (gateResult.name === 'startup-spawn-mcp-collapse') {
    return gateResult.status === 'warn' && obsoleteStandaloneResidue(processSummary)
  }
  if (gateResult.name === 'bridge-wrapper-footprint') {
    return gateResult.status === 'warn' && obsoleteBridgeResidue(processSummary)
  }
  return false
}

function onlyRestartResidueRemains(gates, processSummary) {
  const nonPassGates = gates.filter(
    (gateResult) => gateResult.status !== 'pass' && gateResult.name !== 'broad-default-readiness',
  )
  return (
    nonPassGates.length > 0 &&
    nonPassGates.every((gateResult) => restartResidueGate(gateResult, processSummary))
  )
}

function statusFromGates(gates, processSummary) {
  if (gates.find((item) => item.name === 'broad-default-readiness')?.status === 'pass') {
    return 'ready_for_default_trial'
  }
  if (gates.some((item) => item.status === 'fail' && item.name === 'coordinator-health')) {
    return 'blocked'
  }
  if (onlyRestartResidueRemains(gates, processSummary)) {
    return 'restart_required'
  }
  return 'mixed'
}

function addRestartTarget(targets, group, reason, fields) {
  const key = `${group.parent_service}:${group.ppid}`
  const target = targets.get(key) ?? {
    parent_pid: group.ppid,
    parent_service: group.parent_service,
    parent_label: group.parent_label,
    config_surface: group.config_surface,
    reasons: [],
    child_pids: [],
    primitive_pids: [],
    bridge_wrapper_pids: [],
    bridge_upstream_pids: [],
    oldest_started_at: undefined,
    newest_started_at: undefined,
  }
  if (!target.reasons.includes(reason)) target.reasons.push(reason)
  for (const [field, values] of Object.entries(fields)) {
    target[field] = unique([...(target[field] ?? []), ...(values ?? [])]).sort((a, b) => a - b)
  }
  target.child_pids = unique([
    ...target.child_pids,
    ...target.primitive_pids,
    ...target.bridge_wrapper_pids,
    ...target.bridge_upstream_pids,
  ]).sort((a, b) => a - b)
  if (
    group.oldest_started_at &&
    (!target.oldest_started_at ||
      timestampMs(group.oldest_started_at) < timestampMs(target.oldest_started_at))
  ) {
    target.oldest_started_at = group.oldest_started_at
  }
  if (
    group.newest_started_at &&
    (!target.newest_started_at ||
      timestampMs(group.newest_started_at) > timestampMs(target.newest_started_at))
  ) {
    target.newest_started_at = group.newest_started_at
  }
  targets.set(key, target)
}

function restartTargetsFor(processSummary) {
  const targets = new Map()
  for (const group of processSummary.standalone_groups) {
    if (!group.obsolete_config_drift) continue
    addRestartTarget(targets, group, 'obsolete-standalone-primitives', {
      primitive_pids: group.pids,
    })
  }
  for (const group of processSummary.bridge_groups) {
    if (!group.obsolete_config_drift) continue
    addRestartTarget(targets, group, 'obsolete-bridge-wrapper', {
      bridge_wrapper_pids: group.pids,
      bridge_upstream_pids: group.upstream_pids,
    })
  }
  return [...targets.values()].sort(
    (a, b) =>
      String(a.config_surface ?? a.parent_service).localeCompare(
        String(b.config_surface ?? b.parent_service),
      ) || a.parent_pid - b.parent_pid,
  )
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
  const activeSessionState = Array.isArray(snapshot.active_session_state)
    ? snapshot.active_session_state
    : []
  const bridgeHealth = Array.isArray(snapshot.bridge_runtime_health)
    ? snapshot.bridge_runtime_health
    : []
  const expectedRuntimeVersions =
    snapshot.expected_runtime_versions && typeof snapshot.expected_runtime_versions === 'object'
      ? snapshot.expected_runtime_versions
      : undefined
  const routeRegistry = Array.isArray(snapshot.route_registry) ? snapshot.route_registry : []
  const knowledgeBaseReceiptReport = snapshot.knowledge_base_receipt_report
  const longLivedActivityReport = snapshot.long_lived_activity_report
  const processSummary = annotateBridgeConfigDrift(
    annotateStandaloneConfigDrift(summarizeProcesses(processes), configs),
    configs,
  )
  const contextCoverage = activeSessionCoverage(primitiveHealth, activeSessionState)
  const reachableEndpoints = new Set(
    health
      .filter((item) => item.reachable && item.status === 'healthy')
      .map((item) => item.endpoint),
  )
  const longLivedRoutes = summarizeLongLivedRoutes(longLivedAgents, reachableEndpoints)
  const longLivedActivity = summarizeLongLivedActivity(longLivedAgents, longLivedActivityReport)
  const sharedPrimitiveHttp = primitiveHealth.filter(hasSharedPrimitiveHttpBackend)
  const receiptSummary = knowledgeBaseReceiptSummary(knowledgeBaseReceiptReport)
  const gates = buildGates({
    processSummary,
    configs,
    launchAgents,
    longLivedAgents,
    health,
    primitiveHealth,
    activeSessionState,
    bridgeHealth,
    routeRegistry,
    knowledgeBaseReceiptReport,
    longLivedActivityReport,
    expectedRuntimeVersions,
  })
  const status = statusFromGates(gates, processSummary)
  const restartTargets = restartTargetsFor(processSummary)
  const registryProblems = routeRegistry.filter(
    (item) => item.exists && item.status !== 'valid' && item.status !== 'absent',
  )
  const registryValid = routeRegistry.filter((item) => item.exists && item.status === 'valid')

  return {
    schema: SCHEMA,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    source: snapshot.source ?? 'snapshot',
    summary: {
      status,
      healthy_coordinators: health.filter((item) => item.reachable && item.status === 'healthy')
        .length,
      configured_coordinators: launchAgents.filter((agent) => agent.kind === 'coordinator').length,
      runtime_versions_checked:
        runtimeVersionCheckEnabled(expectedRuntimeVersions, 'coordinator') ||
        runtimeVersionCheckEnabled(expectedRuntimeVersions, 'primitive_runtime'),
      coordinator_version_expected: expectedRuntimeVersion(expectedRuntimeVersions, 'coordinator'),
      coordinator_version_mismatches: versionMismatches(
        health,
        expectedRuntimeVersion(expectedRuntimeVersions, 'coordinator'),
        coordinatorVersion,
      ).length,
      primitive_runtime_version_expected: expectedRuntimeVersion(
        expectedRuntimeVersions,
        'primitive_runtime',
      ),
      primitive_runtime_version_mismatches: versionMismatches(
        primitiveHealth,
        expectedRuntimeVersion(expectedRuntimeVersions, 'primitive_runtime'),
        primitiveRuntimeVersion,
      ).length,
      route_registry_status:
        registryProblems.length > 0 ? 'problem' : registryValid.length > 0 ? 'valid' : 'absent',
      primitive_runtime_processes: processSummary.primitive_runtime_processes,
      primitive_runtime_http_processes: processSummary.primitive_runtime_http_processes,
      primitive_runtime_stdio_processes: processSummary.primitive_runtime_stdio_processes,
      primitive_proxy_processes: processSummary.primitive_proxy_processes,
      primitive_proxy_stdio_processes: processSummary.primitive_proxy_stdio_processes,
      primitive_runtime_http_shared: sharedPrimitiveHttp.length,
      primitive_runtime_tool_calls_active: primitiveHealth.reduce(
        (sum, item) => sum + primitiveRuntimeActiveToolCalls(item),
        0,
      ),
      primitive_runtime_tool_calls_timed_out: primitiveHealth.reduce(
        (sum, item) => sum + primitiveRuntimeTimedOutToolCallTotal(item),
        0,
      ),
      primitive_runtime_tool_calls_active_timed_out: primitiveHealth.reduce(
        (sum, item) => sum + primitiveRuntimeActiveTimedOutToolCalls(item).length,
        0,
      ),
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
      bridge_runtime_processes: processSummary.bridge_runtime_processes,
      bridge_runtime_http_processes: processSummary.bridge_runtime_http_processes,
      bridge_proxy_processes: processSummary.bridge_proxy_processes,
      bridge_proxy_stdio_processes: processSummary.bridge_proxy_stdio_processes,
      bridge_wrapper_processes: processSummary.bridge_wrapper_processes,
      bridge_upstream_processes: processSummary.bridge_upstream_processes,
      obsolete_bridge_wrapper_processes: processSummary.obsolete_bridge_wrapper_processes,
      obsolete_bridge_upstream_processes: processSummary.obsolete_bridge_upstream_processes,
      obsolete_bridge_wrapper_groups: processSummary.obsolete_bridge_wrapper_groups,
      bridge_runtime_http_endpoints: unique(
        configs.flatMap((config) => config.bridge_http_endpoints ?? []),
      ).length,
      bridge_runtime_http_healthy: bridgeHealth.filter(
        (item) => item.reachable && item.status === 'healthy',
      ).length,
      active_session_profiles: contextCoverage.runtimeProfiles.length,
      active_session_profiles_valid: contextCoverage.validStateProfiles.length,
      active_session_profiles_fresh: contextCoverage.freshStateProfiles.length,
      active_session_profiles_idle: contextCoverage.idleProfiles.length,
      active_session_profiles_explicit_required: contextCoverage.explicitContextProfiles.length,
      active_session_profiles_ready: contextCoverage.readyProfiles.length,
      duplicate_bridge_wrapper_groups: processSummary.duplicate_bridge_wrapper_groups,
      bridge_wrappers_without_upstream: processSummary.bridge_wrappers_without_upstream,
      bridge_upstreams_without_wrapper: processSummary.bridge_upstreams_without_wrapper,
      watcher_wal_launch_agents: launchAgents.filter((agent) => agent.kind === 'watcher-wal')
        .length,
      knowledge_base_receipt_report_status: receiptSummary.status,
      knowledge_base_receipt_report_age_ms: receiptSummary.age_ms,
      knowledge_base_receipt_pending_total: receiptSummary.pending_total,
      knowledge_base_receipt_observation_pending: receiptSummary.observation_pending,
      knowledge_base_receipt_annotation_pending: receiptSummary.annotation_pending,
      knowledge_base_wal_queued: receiptSummary.wal_queued,
      knowledge_base_wal_non_joinable_queued: receiptSummary.wal_non_joinable_queued,
      knowledge_base_wal_quarantined: receiptSummary.wal_quarantined,
      knowledge_base_wal_receipted: receiptSummary.wal_receipted,
      knowledge_base_wal_non_joinable_receipted: receiptSummary.wal_non_joinable_receipted,
      knowledge_base_receipt_integrity_active:
        receiptSummary.receipt_integrity?.active_receipt_files,
      knowledge_base_receipt_integrity_active_joinable:
        receiptSummary.receipt_integrity?.active_joinable_receipt_files,
      knowledge_base_receipt_integrity_non_joinable:
        receiptSummary.receipt_integrity?.non_joinable_receipt_files,
      knowledge_base_receipt_integrity_mismatches:
        receiptSummary.receipt_integrity?.receipt_mismatches,
      knowledge_base_receipt_integrity_orphans:
        receiptSummary.receipt_integrity?.orphan_receipt_files,
      knowledge_base_receipt_integrity_invalid:
        receiptSummary.receipt_integrity?.invalid_receipt_files,
      knowledge_base_activity_status: receiptSummary.activity?.status,
      knowledge_base_activity_age_ms: receiptSummary.activity?.age_ms,
      knowledge_base_activity_stale: receiptSummary.activity?.stale,
      knowledge_base_activity_source: receiptSummary.activity?.source,
      long_lived_agents: longLivedAgents.length,
      long_lived_agent_routes: longLivedRoutes.total,
      long_lived_agent_route_endpoints: unique(longLivedAgents.map((agent) => agent.endpoint))
        .length,
      long_lived_agent_routes_configured: longLivedRoutes.configured,
      long_lived_agent_routes_healthy: longLivedRoutes.healthy,
      long_lived_agent_routes_missing: longLivedRoutes.missing,
      long_lived_activity_report_status: longLivedActivity.status,
      long_lived_activity_report_age_ms: longLivedActivity.age_ms,
      long_lived_agent_activity_ok: longLivedActivity.ok,
      long_lived_agent_activity_missing: longLivedActivity.missing,
      long_lived_agent_activity_stale: longLivedActivity.stale,
      long_lived_agent_activity_endpoint_mismatch: longLivedActivity.endpoint_mismatch,
      long_lived_agent_activity_not_delegated: longLivedActivity.not_delegated,
      restart_targets: restartTargets.length,
    },
    gates,
    expected_runtime_versions: expectedRuntimeVersions,
    coordinators: healthSummary(health),
    primitive_runtimes: primitiveRuntimeHealthSummary(primitiveHealth),
    active_session_state: activeSessionStateSummary(activeSessionState),
    bridge_runtimes: bridgeRuntimeHealthSummary(bridgeHealth),
    knowledge_base_receipt_report: knowledgeBaseReceiptReport,
    long_lived_activity_report: longLivedActivityReport,
    long_lived_activity: longLivedActivity.agents,
    route_registry: routeRegistry,
    process_inventory: processSummary,
    restart_targets: restartTargets,
    config_surfaces: configSurfaceSummary(configs, primitiveHealth),
    launch_agents: launchAgents,
    long_lived_agents: longLivedAgents,
    recommendations: recommendationsFor({ status, gates, processSummary }),
  }
}

function recommendationsFor({ status, gates, processSummary }) {
  if (status === 'ready_for_default_trial') {
    return ['run pnpm measure:local-substrate after every startup-spawn restart or route edit']
  }
  const recommendations = []
  const gateStatus = (name) => gates.find((item) => item.name === name)?.status
  if (gates.find((item) => item.name === 'coordinator-health')?.status !== 'pass') {
    recommendations.push(
      'restore healthy local-substrate coordinator endpoints before relying on coordinator-owned paths',
    )
  }
  if (gates.find((item) => item.name === 'coordinator-version-freshness')?.status === 'fail') {
    recommendations.push(
      'restart stale local-substrate coordinator LaunchAgents so they run the checked-out @atrib/emit package version',
    )
  }
  if (gates.find((item) => item.name === 'route-registry')?.status !== 'pass') {
    recommendations.push(
      'fix the local route registry before relying on future harness coverage in the topology report',
    )
  }
  if (obsoleteStandaloneResidue(processSummary)) {
    recommendations.push(
      'fully quit or restart startup-spawn hosts that still own obsolete standalone primitive generations',
    )
  } else if (processSummary.primitive_runtime_stdio_processes > 0) {
    recommendations.push(
      'route stdio-only startup-spawn clients through the atrib-primitives stdio-http-proxy backed by a shared Streamable HTTP host',
    )
  } else if (processSummary.standalone_primitive_processes > 0) {
    recommendations.push(
      'restart or reconfigure startup-spawn harnesses that still launch standalone atrib primitive servers',
    )
  }
  if (gates.find((item) => item.name === 'host-owned-primitives-http')?.status !== 'pass') {
    recommendations.push(
      'start or restart one loopback atrib-primitives Streamable HTTP host with a shared primitive backend per startup-spawn agent profile before broad process-sharing rollout',
    )
  }
  if (gates.find((item) => item.name === 'primitive-runtime-tool-dispatch')?.status !== 'pass') {
    recommendations.push(
      'inspect primitive runtime health tool_calls and restart any host with active timed-out tool dispatches after preserving evidence',
    )
  }
  if (
    gates.find((item) => item.name === 'primitive-runtime-version-freshness')?.status === 'fail'
  ) {
    recommendations.push(
      'restart stale atrib-primitives LaunchAgents so they run the checked-out @atrib/primitives-runtime package version',
    )
  }
  if (gates.find((item) => item.name === 'host-owned-active-session-context')?.status !== 'pass') {
    recommendations.push(
      'make every active host-owned primitive profile either write fresh valid active-session state or require explicit context_id before relying on profile fallback',
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
      if (processSummary.obsolete_bridge_wrapper_processes > 0) {
        recommendations.push(
          'fully quit or restart startup-spawn hosts that still own obsolete bridge wrapper/upstream pairs',
        )
      } else {
        recommendations.push(
          'fully quit or restart startup-spawn hosts that still own duplicate bridge wrapper/upstream pairs',
        )
      }
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
  if (gates.find((item) => item.name === 'knowledge-base-receipt-join-back')?.status !== 'pass') {
    recommendations.push(
      'refresh or repair the knowledge-base receipt join-back report before treating watcher-WAL routing as clean',
    )
  }
  if (gates.find((item) => item.name === 'knowledge-base-watcher-activity')?.status !== 'pass') {
    recommendations.push(
      'refresh or repair knowledge-base watcher activity evidence before treating watcher-WAL routing as active',
    )
  }
  if (gates.find((item) => item.name === 'long-lived-agent-route')?.status !== 'pass') {
    recommendations.push(
      'point every known long-lived agent route at a healthy coordinator endpoint before broad rollout',
    )
  }
  if (gates.find((item) => item.name === 'long-lived-agent-activity')?.status !== 'pass') {
    recommendations.push(
      'refresh or repair the long-lived activity report before treating supervised agent routing as clean',
    )
  }
  return recommendations
}

function formatTextReport(report) {
  const lines = [
    `local-substrate topology: ${report.summary.status}`,
    `coordinators: healthy=${report.summary.healthy_coordinators}, configured=${report.summary.configured_coordinators}`,
    `runtime versions: coordinator=${report.summary.coordinator_version_expected ?? 'unchecked'} mismatches=${report.summary.coordinator_version_mismatches ?? 0}, primitive=${report.summary.primitive_runtime_version_expected ?? 'unchecked'} mismatches=${report.summary.primitive_runtime_version_mismatches ?? 0}`,
    `route registry: ${report.summary.route_registry_status}`,
    `startup-spawn processes: atrib-primitives=${report.summary.primitive_runtime_processes} (http=${report.summary.primitive_runtime_http_processes}, shared-http=${report.summary.primitive_runtime_http_shared}, direct-stdio=${report.summary.primitive_runtime_stdio_processes}, proxy=${report.summary.primitive_proxy_processes}), standalone-primitives=${report.summary.standalone_primitive_processes}, generations=${report.summary.standalone_primitive_generations}, obsolete=${report.summary.obsolete_standalone_primitive_processes}, duplicate-groups=${report.summary.duplicate_primitive_groups}`,
    `primitive tool dispatch: active=${report.summary.primitive_runtime_tool_calls_active ?? 0}, active-timed-out=${report.summary.primitive_runtime_tool_calls_active_timed_out ?? 0}, timed-out-total=${report.summary.primitive_runtime_tool_calls_timed_out ?? 0}`,
    `bridge processes: runtimes=${report.summary.bridge_runtime_processes} (http=${report.summary.bridge_runtime_http_processes}, proxy=${report.summary.bridge_proxy_processes}, stdio-proxy=${report.summary.bridge_proxy_stdio_processes}), legacy-wrappers=${report.summary.bridge_wrapper_processes}, upstream=${report.summary.bridge_upstream_processes}, duplicate-groups=${report.summary.duplicate_bridge_wrapper_groups}`,
    `host-owned bridge HTTP: healthy=${report.summary.bridge_runtime_http_healthy}/${report.summary.bridge_runtime_http_endpoints}`,
    `context routing profiles: ready=${report.summary.active_session_profiles_ready}/${report.summary.active_session_profiles}, active-session=${report.summary.active_session_profiles_valid}, fresh=${report.summary.active_session_profiles_fresh}, idle=${report.summary.active_session_profiles_idle}, explicit-required=${report.summary.active_session_profiles_explicit_required}`,
    `watcher-WAL launch agents: ${report.summary.watcher_wal_launch_agents}`,
    `knowledge-base receipt join-back: status=${report.summary.knowledge_base_receipt_report_status}, pending=${report.summary.knowledge_base_receipt_pending_total}, obs=${report.summary.knowledge_base_receipt_observation_pending}, annotations=${report.summary.knowledge_base_receipt_annotation_pending}, wal-queued=${report.summary.knowledge_base_wal_queued}, wal-receipted=${report.summary.knowledge_base_wal_receipted}, non-joinable-receipted=${report.summary.knowledge_base_wal_non_joinable_receipted}, wal-quarantined=${report.summary.knowledge_base_wal_quarantined}, receipt-mismatches=${report.summary.knowledge_base_receipt_integrity_mismatches}, receipt-orphans=${report.summary.knowledge_base_receipt_integrity_orphans}`,
    `knowledge-base watcher activity: status=${report.summary.knowledge_base_activity_status}, source=${report.summary.knowledge_base_activity_source ?? 'unknown'}, age-ms=${report.summary.knowledge_base_activity_age_ms ?? 'unknown'}`,
    `long-lived agent routes: healthy=${report.summary.long_lived_agent_routes_healthy}/${report.summary.long_lived_agent_routes}, configured=${report.summary.long_lived_agent_routes_configured}, missing=${report.summary.long_lived_agent_routes_missing}, endpoints=${report.summary.long_lived_agent_route_endpoints}`,
    `long-lived activity: status=${report.summary.long_lived_activity_report_status}, ok=${report.summary.long_lived_agent_activity_ok}/${report.summary.long_lived_agent_routes}, missing=${report.summary.long_lived_agent_activity_missing}, stale=${report.summary.long_lived_agent_activity_stale}, endpoint_mismatch=${report.summary.long_lived_agent_activity_endpoint_mismatch}, not_delegated=${report.summary.long_lived_agent_activity_not_delegated}`,
    '',
    'gates:',
  ]
  for (const gateResult of report.gates) {
    lines.push(`  ${gateResult.status.toUpperCase()} ${gateResult.name}: ${gateResult.detail}`)
  }
  if (report.restart_targets.length > 0) {
    lines.push('', 'restart targets:')
    for (const target of report.restart_targets) {
      const pidGroups = [
        target.primitive_pids.length > 0 ? `primitive=${target.primitive_pids.join(',')}` : '',
        target.bridge_wrapper_pids.length > 0
          ? `bridge-wrapper=${target.bridge_wrapper_pids.join(',')}`
          : '',
        target.bridge_upstream_pids.length > 0
          ? `bridge-upstream=${target.bridge_upstream_pids.join(',')}`
          : '',
      ].filter(Boolean)
      lines.push(
        `  - ${target.parent_label} pid=${target.parent_pid} surface=${target.config_surface ?? 'unknown'} reasons=${target.reasons.join(',')} children=${pidGroups.join(' ')}`,
      )
    }
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
        knowledgeBaseReceiptReportPath: args.knowledgeBaseReceiptReportPath,
        longLivedActivityReportPath: args.longLivedActivityReportPath,
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
  collectKnowledgeBaseReceiptReport,
  collectLongLivedActivityReport,
  collectLiveSnapshot,
  collectRegisteredLongLivedAgents,
  collectRegisteredStartupSpawnConfigs,
  collectRouteRegistryDiagnostics,
  formatTextReport,
  registeredLongLivedAgentsFromRegistry,
  registeredStartupSpawnConfigsFromRegistry,
  routeRegistryDiagnosticsFromRegistry,
  summarizeProcesses,
}
