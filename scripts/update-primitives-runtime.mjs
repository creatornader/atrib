#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global AbortController, URL, clearTimeout, fetch, process, setTimeout */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HOME = process.env.HOME ?? ''
const RECALL_PACKAGE = join(ROOT, 'services/atrib-recall/package.json')

/**
 * Runtime modes (D128). The legacy mode targets the private
 * @atrib/primitives-runtime host with its per-session HTTP shape; atribd
 * mode targets the stateless daemon, whose health report carries a
 * `daemon` block plus top-level `primitive_contracts`, `behavioral_probes`,
 * `recall_contract`, and `requests` (no `sessions` block).
 */
export const RUNTIME_MODES = {
  'atrib-primitives': {
    name: 'atrib-primitives',
    launchAgentPrefix: 'com.nader.atrib-primitives.',
    packagePath: join(ROOT, 'services/atrib-primitives/package.json'),
    distEntrySuffix: '/services/atrib-primitives/dist/index.js',
    buildFilter: '@atrib/primitives-runtime...',
    healthShape: 'primitive-runtime',
    topology: 'required',
  },
  atribd: {
    name: 'atribd',
    launchAgentPrefix: 'com.nader.atribd.',
    packagePath: join(ROOT, 'services/atribd/package.json'),
    distEntrySuffix: '/services/atribd/dist/index.js',
    buildFilter: '@atrib/daemon...',
    healthShape: 'daemon',
    // The topology report still reads the legacy primitive-runtime health
    // shape; its atribd gates land with the operator cutover (D120:
    // measure, then flip). Skipping is recorded in the report, not silent.
    topology: 'skipped-until-cutover',
  },
}

function runtimeMode(name = 'atrib-primitives') {
  const mode = RUNTIME_MODES[name]
  if (!mode) {
    throw new Error(`unknown runtime mode: ${name} (expected atrib-primitives or atribd)`)
  }
  return mode
}
// The attest/recall two-verb surface: three mounts serve the seventeen-tool
// alias-window union (fifteen legacy names + attest + recall).
const PRIMITIVE_PACKAGE_PATHS = {
  attest: join(ROOT, 'services/atrib-attest/package.json'),
  recall: RECALL_PACKAGE,
  summarize: join(ROOT, 'services/atrib-summarize/package.json'),
}
const EXPECTED_PRIMITIVE_TOOLS = {
  attest: ['atrib-annotate', 'atrib-revise', 'attest', 'emit'],
  recall: [
    'atrib-verify',
    'recall',
    'recall_annotations',
    'recall_by_content',
    'recall_by_signer',
    'recall_my_attribution_history',
    'recall_orphans',
    'recall_revisions',
    'recall_session_chain',
    'recall_walk',
    'trace',
    'trace_forward',
  ],
  summarize: ['summarize'],
}
const EXPECTED_TOOL_NAMES = Object.values(EXPECTED_PRIMITIVE_TOOLS)
  .flat()
  .sort((a, b) => a.localeCompare(b))
const EXPECTED_BEHAVIORAL_PROBES = {
  recall: 'pass',
  summarize: 'pass',
  attest: 'skipped',
}
const EXPECTED_RECALL_COVERAGE_VERSION = 'coverage-v1'
const EXPECTED_RECALL_CONTENT_INDEX_VERSION = 'content-index-v1'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_PROBE_QUERY = 'atrib primitive runtime content index health probe'
const REPORT_SCHEMA = 'atrib.primitives-runtime-update-report.v0'

function usage() {
  return `Usage:
  node scripts/update-primitives-runtime.mjs [options]

Options:
  --runtime <name>       Runtime mode: atrib-primitives (default) or atribd.
  --profile <name>       Target one profile. May be repeated or comma-separated.
  --skip-build           Do not run package builds before restart.
  --skip-restart         Do not restart launchd services. Still probes live endpoints.
  --no-topology          Skip final topology gate check.
  --dry-run              Print the discovered plan without build, restart, or probe.
  --json                 Print JSON report.
  --timeout-ms <n>       Total wait per endpoint. Defaults to 15000.
  --probe-query <text>   Query used for recall_by_content health probe.
  --help                 Print this help.

Default behavior discovers host-owned com.nader.atrib-primitives.* LaunchAgents
that run this checkout's services/atrib-primitives/dist/index.js, builds
the @atrib/primitives-runtime dependency closure, restarts those LaunchAgents,
then lists tools and directly calls recall_by_content over each Streamable HTTP
MCP endpoint. With --runtime atribd the same build, restart, direct-probe, gate
sequence targets com.nader.atribd.* LaunchAgents running
services/atribd/dist/index.js and validates the stateless daemon health shape
(daemon block, top-level contract blocks, requests counters, no sessions block).
`
}

export function parseArgs(argv) {
  const out = {
    runtime: 'atrib-primitives',
    profiles: [],
    skipBuild: false,
    skipRestart: false,
    noTopology: false,
    dryRun: false,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    probeQuery: DEFAULT_PROBE_QUERY,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    } else if (arg === '--runtime') {
      out.runtime = requireValue(argv, ++i, '--runtime')
      runtimeMode(out.runtime)
    } else if (arg === '--profile') {
      out.profiles.push(...parseProfiles(requireValue(argv, ++i, '--profile')))
    } else if (arg === '--skip-build') {
      out.skipBuild = true
    } else if (arg === '--skip-restart') {
      out.skipRestart = true
    } else if (arg === '--no-topology') {
      out.noTopology = true
    } else if (arg === '--dry-run') {
      out.dryRun = true
    } else if (arg === '--json') {
      out.json = true
    } else if (arg === '--timeout-ms') {
      out.timeoutMs = parsePositiveInt(requireValue(argv, ++i, '--timeout-ms'), '--timeout-ms')
    } else if (arg === '--probe-query') {
      out.probeQuery = requireValue(argv, ++i, '--probe-query')
    } else if (arg === '--help' || arg === '-h') {
      out.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  out.profiles = unique(out.profiles)
  return out
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parseProfiles(raw) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function parsePositiveInt(raw, name) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return n
}

function unique(values) {
  return [...new Set(values)]
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

function endpointFromProgramArguments(args) {
  const host = valueAfter(args, '--host') ?? '127.0.0.1'
  const port = valueAfter(args, '--port')
  const path = valueAfter(args, '--path') ?? '/mcp'
  if (!port) return undefined
  return `http://${host}:${port}${path.startsWith('/') ? path : `/${path}`}`
}

function healthEndpointFor(endpoint) {
  const url = new URL(endpoint)
  url.pathname = url.pathname.replace(/\/$/, '') + '/health'
  return url.toString()
}

function isLoopbackEndpoint(endpoint) {
  try {
    const url = new URL(endpoint)
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function normalizePrimitiveLaunchAgent(
  plist,
  plistPath,
  { root = ROOT, mode = 'atrib-primitives' } = {},
) {
  const runtime = runtimeMode(mode)
  const label = typeof plist.Label === 'string' ? plist.Label : undefined
  const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments.map(String) : []
  const workingDirectory =
    typeof plist.WorkingDirectory === 'string' ? plist.WorkingDirectory : undefined
  const scriptPath = args.find((arg) => arg.endsWith(runtime.distEntrySuffix))
  const transport = valueAfter(args, '--transport') ?? 'stdio'
  const endpoint = transport === 'streamable-http' ? endpointFromProgramArguments(args) : undefined
  const profile = label?.startsWith(runtime.launchAgentPrefix)
    ? label.slice(runtime.launchAgentPrefix.length)
    : undefined
  const expectedDistEntry = join(root, runtime.distEntrySuffix.replace(/^\//, ''))
  const reasons = []

  if (!label?.startsWith(runtime.launchAgentPrefix)) {
    reasons.push(`label is not a ${runtime.name} host`)
  }
  if (!profile) reasons.push('profile could not be derived from launchd label')
  if (workingDirectory !== root) reasons.push(`working directory is not ${root}`)
  if (scriptPath !== expectedDistEntry) reasons.push(`program does not run ${expectedDistEntry}`)
  if (transport !== 'streamable-http') reasons.push('transport is not streamable-http')
  if (!endpoint) reasons.push('streamable-http endpoint could not be derived')
  if (endpoint && !isLoopbackEndpoint(endpoint)) reasons.push('endpoint is not loopback')

  return {
    label,
    profile,
    plist_path: plistPath,
    working_directory: workingDirectory,
    program: args[0],
    script_path: scriptPath,
    transport,
    endpoint,
    health_endpoint: endpoint ? healthEndpointFor(endpoint) : undefined,
    eligible: reasons.length === 0,
    reasons,
  }
}

function parsePlist(path) {
  const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', path], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`plutil failed for ${path}: ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout)
}

export function discoverPrimitiveLaunchAgents({
  home = HOME,
  root = ROOT,
  launchAgentsDir = join(home, 'Library/LaunchAgents'),
  mode = 'atrib-primitives',
} = {}) {
  const runtime = runtimeMode(mode)
  if (!launchAgentsDir || !existsSync(launchAgentsDir)) return []
  return readdirSync(launchAgentsDir)
    .filter((name) => name.endsWith('.plist') && name.startsWith(runtime.launchAgentPrefix))
    .map((name) => {
      const path = join(launchAgentsDir, name)
      return normalizePrimitiveLaunchAgent(parsePlist(path), path, { root, mode })
    })
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
}

export function selectTargetLaunchAgents(launchAgents, profiles = []) {
  const wanted = new Set(profiles)
  return launchAgents.filter(
    (agent) =>
      agent.eligible &&
      (!wanted.size || (agent.profile !== undefined && wanted.has(agent.profile))),
  )
}

function runCommand(command, args, { label, dryRun = false } = {}) {
  if (dryRun) return { label, command, args, status: 'skipped' }
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`${label ?? command} failed with status ${result.status}`)
  }
  return { label, command, args, status: 'ok' }
}

function buildPackages(options) {
  const runtime = runtimeMode(options.runtime)
  return [
    runCommand('pnpm', ['--filter', runtime.buildFilter, 'build'], {
      label: `build ${runtime.buildFilter} dependency closure`,
      dryRun: options.dryRun,
    }),
  ]
}

function launchctlDomain() {
  const result = spawnSync('id', ['-u'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`id -u failed: ${result.stderr.trim()}`)
  }
  return `gui/${result.stdout.trim()}`
}

function restartLaunchAgent(agent, { dryRun = false } = {}) {
  const domain = launchctlDomain()
  const service = `${domain}/${agent.label}`
  return runCommand('launchctl', ['kickstart', '-k', service], {
    label: `restart ${agent.label}`,
    dryRun,
  })
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function waitForHealth(agent, { timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() <= deadline) {
    try {
      const body = await fetchJson(agent.health_endpoint, Math.min(1500, timeoutMs))
      if (body?.status !== 'starting') return body
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }
  throw new Error(
    `${agent.label} did not return non-starting health within ${timeoutMs}ms${
      lastError instanceof Error ? `: ${lastError.message}` : ''
    }`,
  )
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function expectedPrimitivePackageVersions() {
  return Object.fromEntries(
    Object.entries(PRIMITIVE_PACKAGE_PATHS).map(([primitive, path]) => {
      const pkg = readJson(path)
      return [
        primitive,
        {
          package: pkg.name,
          version: pkg.version,
        },
      ]
    }),
  )
}

function sortedStrings(values) {
  return values.map(String).sort((a, b) => a.localeCompare(b))
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function validateHealthPayload(
  body,
  {
    expectedRuntimeVersion,
    expectedPrimitiveVersions = expectedPrimitivePackageVersions(),
    mode = 'atrib-primitives',
  },
) {
  const healthShape = runtimeMode(mode).healthShape
  const runtime = healthShape === 'daemon' ? body?.report?.daemon : body?.report?.primitive_runtime
  const contractSource = healthShape === 'daemon' ? body?.report : body?.report?.primitive_runtime
  const runtimeLabel = healthShape === 'daemon' ? 'report.daemon' : 'report.primitive_runtime'
  const contractLabel = healthShape === 'daemon' ? 'report' : 'report.primitive_runtime'
  const contract = contractSource?.recall_contract
  const primitiveContracts = contractSource?.primitive_contracts
  const behavioralProbes = contractSource?.behavioral_probes
  const issues = []
  if (!runtime) issues.push(`missing ${runtimeLabel}`)
  if (runtime?.version !== expectedRuntimeVersion) {
    issues.push(`expected primitive runtime ${expectedRuntimeVersion}, got ${runtime?.version}`)
  }
  if (healthShape === 'daemon') {
    if (body?.report?.sessions !== undefined) {
      issues.push('retired sessions block present in daemon report')
    }
    if (!body?.report?.requests || typeof body.report.requests !== 'object') {
      issues.push('missing report.requests counters')
    }
    if (runtime && runtime.transport !== 'streamable-http-stateless') {
      issues.push(
        `expected daemon.transport streamable-http-stateless, got ${runtime?.transport}`,
      )
    }
  }
  if (contract?.status !== 'pass') {
    issues.push(`expected recall_contract.status pass, got ${contract?.status}`)
  }
  if (contract?.coverage_version !== EXPECTED_RECALL_COVERAGE_VERSION) {
    issues.push(
      `expected recall_contract.coverage_version ${EXPECTED_RECALL_COVERAGE_VERSION}, got ${contract?.coverage_version}`,
    )
  }
  if (contract?.content_index_version !== EXPECTED_RECALL_CONTENT_INDEX_VERSION) {
    issues.push(
      `expected recall_contract.content_index_version ${EXPECTED_RECALL_CONTENT_INDEX_VERSION}, got ${contract?.content_index_version}`,
    )
  }
  if (!primitiveContracts || typeof primitiveContracts !== 'object') {
    issues.push(`missing ${contractLabel}.primitive_contracts`)
  } else {
    for (const [primitive, expectedTools] of Object.entries(EXPECTED_PRIMITIVE_TOOLS)) {
      const primitiveContract = primitiveContracts[primitive]
      const expected = expectedPrimitiveVersions[primitive]
      const mountedTools = Array.isArray(primitiveContract?.mounted_tools)
        ? sortedStrings(primitiveContract.mounted_tools)
        : []
      const expectedToolList = sortedStrings(expectedTools)
      if (!primitiveContract || typeof primitiveContract !== 'object') {
        issues.push(`missing primitive_contracts.${primitive}`)
        continue
      }
      if (primitiveContract.status !== 'pass') {
        issues.push(
          `expected primitive_contracts.${primitive}.status pass, got ${primitiveContract.status}`,
        )
      }
      if (expected?.package && primitiveContract.package !== expected.package) {
        issues.push(
          `expected primitive_contracts.${primitive}.package ${expected.package}, got ${primitiveContract.package}`,
        )
      }
      if (expected?.version && primitiveContract.version !== expected.version) {
        issues.push(
          `expected primitive_contracts.${primitive}.version ${expected.version}, got ${primitiveContract.version}`,
        )
      }
      if (!arraysEqual(mountedTools, expectedToolList)) {
        issues.push(
          `expected primitive_contracts.${primitive}.mounted_tools ${expectedToolList.join(', ')}, got ${mountedTools.join(', ')}`,
        )
      }
      if ((primitiveContract.missing_tools ?? []).length) {
        issues.push(
          `primitive_contracts.${primitive}.missing_tools=${primitiveContract.missing_tools.join(', ')}`,
        )
      }
      if ((primitiveContract.unexpected_tools ?? []).length) {
        issues.push(
          `primitive_contracts.${primitive}.unexpected_tools=${primitiveContract.unexpected_tools.join(', ')}`,
        )
      }
    }
  }
  if (!behavioralProbes || typeof behavioralProbes !== 'object') {
    issues.push(`missing ${contractLabel}.behavioral_probes`)
  } else {
    for (const [primitive, expectedStatus] of Object.entries(EXPECTED_BEHAVIORAL_PROBES)) {
      const probe = behavioralProbes[primitive]
      if (!probe || typeof probe !== 'object') {
        issues.push(`missing behavioral_probes.${primitive}`)
        continue
      }
      if (probe.status !== expectedStatus) {
        issues.push(
          `expected behavioral_probes.${primitive}.status ${expectedStatus}, got ${probe.status}`,
        )
      }
      if (
        expectedStatus === 'skipped' &&
        (probe.mutates_log_on_call !== true || typeof probe.reason !== 'string')
      ) {
        issues.push(`behavioral_probes.${primitive} must explain skipped write probe`)
      }
    }
  }
  if (issues.length) {
    throw new Error(`primitive health contract failed: ${issues.join('; ')}`)
  }
  return {
    status: body.status,
    pid: runtime.pid,
    version: runtime.version,
    recall_contract: contract.status,
    coverage_version: contract.coverage_version,
    content_index_version: contract.content_index_version,
    primitive_contracts: Object.fromEntries(
      Object.entries(primitiveContracts).map(([primitive, primitiveContract]) => [
        primitive,
        {
          status: primitiveContract.status,
          package: primitiveContract.package,
          version: primitiveContract.version,
          tool_count: Array.isArray(primitiveContract.mounted_tools)
            ? primitiveContract.mounted_tools.length
            : 0,
        },
      ]),
    ),
    behavioral_probes: Object.fromEntries(
      Object.entries(behavioralProbes).map(([primitive, probe]) => [
        primitive,
        {
          status: probe.status,
          probe_kind: probe.probe_kind,
          mutates_log_on_call: probe.mutates_log_on_call,
          tool_count: Array.isArray(probe.tool_names) ? probe.tool_names.length : 0,
        },
      ]),
    ),
  }
}

function endpointActivity(body) {
  const sessions = body?.report?.sessions ?? {}
  const toolCalls = body?.report?.tool_calls ?? {}
  return {
    active_sessions: sessions.active,
    active_http_requests: sessions.active_http_requests,
    active_http_connections: sessions.active_http_connections,
    active_tool_calls: toolCalls.active_tool_calls,
  }
}

export function endpointProbeSettled(body) {
  const activity = endpointActivity(body)
  return activity.active_tool_calls === 0
}

async function waitForEndpointSettled(agent, { timeoutMs }) {
  const deadline = Date.now() + Math.min(timeoutMs, 5000)
  let body
  while (Date.now() <= deadline) {
    body = await fetchJson(agent.health_endpoint, Math.min(1500, timeoutMs))
    if (endpointProbeSettled(body)) {
      return endpointActivity(body)
    }
    await delay(100)
  }
  throw new Error(
    `${agent.label} still has active primitive tool calls after direct MCP probe: ${JSON.stringify(
      endpointActivity(body),
    )}`,
  )
}

function serviceRequire(mode = 'atrib-primitives') {
  return createRequire(pathToFileURL(runtimeMode(mode).packagePath))
}

async function loadMcpClientModules(mode) {
  const req = serviceRequire(mode)
  const clientPath = req.resolve('@modelcontextprotocol/sdk/client/index.js')
  const transportPath = req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import(pathToFileURL(clientPath).href),
    import(pathToFileURL(transportPath).href),
  ])
  return { Client, StreamableHTTPClientTransport }
}

async function withTimeout(promise, timeoutMs, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function parseToolTextResult(result) {
  const text = result?.content?.find(
    (item) => item?.type === 'text' && typeof item.text === 'string',
  )?.text
  if (!text) {
    throw new Error('recall_by_content returned no text content')
  }
  return JSON.parse(text)
}

export function validateRecallProbePayload(payload) {
  const issues = []
  const runtime = payload?.runtime
  const coverage = payload?.coverage
  const index = coverage?.index
  if (runtime?.content_index_version !== EXPECTED_RECALL_CONTENT_INDEX_VERSION) {
    issues.push(
      `expected runtime.content_index_version ${EXPECTED_RECALL_CONTENT_INDEX_VERSION}, got ${runtime?.content_index_version}`,
    )
  }
  if (runtime?.coverage_version !== EXPECTED_RECALL_COVERAGE_VERSION) {
    issues.push(
      `expected runtime.coverage_version ${EXPECTED_RECALL_COVERAGE_VERSION}, got ${runtime?.coverage_version}`,
    )
  }
  if (!index || typeof index !== 'object') {
    issues.push('missing coverage.index')
  } else {
    if (index.version !== EXPECTED_RECALL_CONTENT_INDEX_VERSION) {
      issues.push(
        `expected coverage.index.version ${EXPECTED_RECALL_CONTENT_INDEX_VERSION}, got ${index.version}`,
      )
    }
    if (typeof index.status !== 'string' || !index.status) {
      issues.push('missing coverage.index.status')
    }
  }
  if (issues.length) {
    throw new Error(`recall_by_content contract probe failed: ${issues.join('; ')}`)
  }
  return {
    runtime_package: runtime.package,
    runtime_version: runtime.version,
    content_index_version: runtime.content_index_version,
    coverage_version: runtime.coverage_version,
    coverage_index_status: index.status,
    coverage_index_version: index.version,
    evidence_mode: payload.evidence_mode,
    evidence_status: payload.evidence_status,
    searched_records: payload.searched_records,
  }
}

export function validateToolSurfacePayload(tools) {
  const names = sortedStrings((tools ?? []).map((tool) => tool?.name).filter(Boolean))
  const missing = EXPECTED_TOOL_NAMES.filter((tool) => !names.includes(tool))
  const unexpected = names.filter((tool) => !EXPECTED_TOOL_NAMES.includes(tool))
  if (missing.length || unexpected.length) {
    throw new Error(
      `primitive tool surface probe failed: missing=${missing.join(', ') || 'none'}; unexpected=${unexpected.join(', ') || 'none'}`,
    )
  }
  return {
    tool_count: names.length,
    tools: names,
  }
}

async function probeMcpEndpoint(agent, { timeoutMs, probeQuery, runtime }) {
  const { Client, StreamableHTTPClientTransport } = await loadMcpClientModules(runtime)
  const transport = new StreamableHTTPClientTransport(new URL(agent.endpoint))
  const client = new Client({
    name: `atrib-primitives-runtime-update-${agent.profile}`,
    version: '0.0.0',
  })
  try {
    await withTimeout(client.connect(transport), timeoutMs, `connect ${agent.endpoint}`)
    const listed = await withTimeout(client.listTools(), timeoutMs, `listTools ${agent.endpoint}`)
    const tools = validateToolSurfacePayload(listed.tools)
    const result = await withTimeout(
      client.callTool({
        name: 'recall_by_content',
        arguments: {
          query: probeQuery,
          k: 1,
          max_records: 10,
          evidence_mode: 'bounded',
        },
      }),
      timeoutMs,
      `recall_by_content ${agent.endpoint}`,
    )
    return {
      tools,
      recall: validateRecallProbePayload(parseToolTextResult(result)),
    }
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

function topologyGateStatus(report, name) {
  return report.gates?.find((gate) => gate.name === name)?.status
}

function checkTopology({ dryRun = false, runtime = 'atrib-primitives' } = {}) {
  if (dryRun) return { status: 'skipped' }
  if (runtimeMode(runtime).topology === 'skipped-until-cutover') {
    return {
      status: 'skipped',
      reason:
        'topology gates read the legacy primitive-runtime health shape; ' +
        'atribd topology gates land with the operator LaunchAgent cutover',
    }
  }
  const result = spawnSync('node', ['scripts/report-local-substrate-topology.mjs', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`topology report failed: ${result.stderr.trim()}`)
  }
  const report = JSON.parse(result.stdout)
  const requiredGates = [
    'primitive-runtime-version-freshness',
    'primitive-runtime-surface-contracts',
    'primitive-runtime-behavioral-probes',
    'primitive-runtime-recall-contract',
    'host-owned-primitives-http',
  ]
  const failures = requiredGates
    .map((name) => ({ name, status: topologyGateStatus(report, name) }))
    .filter((gate) => gate.status !== 'pass')
  if (failures.length) {
    throw new Error(`topology primitive gates failed: ${JSON.stringify(failures)}`)
  }
  return {
    status: 'pass',
    global_status: report.summary?.status,
    primitive_runtime_version_expected: report.expected_runtime_versions?.primitive_runtime,
    primitive_runtime_version_mismatches: report.summary?.primitive_runtime_version_mismatches,
    primitive_runtime_surface_contract_mismatches:
      report.summary?.primitive_runtime_surface_contract_mismatches,
    primitive_runtime_behavioral_probe_failures:
      report.summary?.primitive_runtime_behavioral_probe_failures,
    primitive_runtime_recall_contract_mismatches:
      report.summary?.primitive_runtime_recall_contract_mismatches,
    non_pass_gates: (report.gates ?? []).filter((gate) => gate.status !== 'pass'),
    gates: Object.fromEntries(
      requiredGates.map((name) => [name, topologyGateStatus(report, name)]),
    ),
  }
}

function expectedVersions(mode = 'atrib-primitives') {
  return {
    primitive_runtime: readJson(runtimeMode(mode).packagePath).version,
    primitives: expectedPrimitivePackageVersions(),
    recall: readJson(RECALL_PACKAGE).version,
  }
}

function assertTargets(discovered, targets, profiles, mode = 'atrib-primitives') {
  if (targets.length) return
  const wanted = profiles.length ? ` for profile(s) ${profiles.join(', ')}` : ''
  const candidates = discovered.map((agent) => ({
    label: agent.label,
    profile: agent.profile,
    eligible: agent.eligible,
    reasons: agent.reasons,
  }))
  throw new Error(
    `no eligible ${runtimeMode(mode).name} LaunchAgents found${wanted}: ${JSON.stringify(candidates)}`,
  )
}

async function run(options) {
  const versions = expectedVersions(options.runtime)
  const discovered = discoverPrimitiveLaunchAgents({ mode: options.runtime })
  const targets = selectTargetLaunchAgents(discovered, options.profiles)
  assertTargets(discovered, targets, options.profiles, options.runtime)

  const report = {
    schema: REPORT_SCHEMA,
    generated_at: new Date().toISOString(),
    root: ROOT,
    runtime: options.runtime,
    expected_versions: versions,
    options: {
      runtime: options.runtime,
      profiles: options.profiles,
      skip_build: options.skipBuild,
      skip_restart: options.skipRestart,
      no_topology: options.noTopology,
      dry_run: options.dryRun,
      timeout_ms: options.timeoutMs,
    },
    discovered,
    targets: targets.map((agent) => ({
      label: agent.label,
      profile: agent.profile,
      endpoint: agent.endpoint,
      health_endpoint: agent.health_endpoint,
    })),
    steps: [],
    probes: [],
    settled: [],
    topology: undefined,
  }

  if (options.dryRun) return report

  if (!options.skipBuild) {
    report.steps.push(...buildPackages(options))
  }
  if (!options.skipRestart) {
    for (const agent of targets) {
      report.steps.push(restartLaunchAgent(agent, options))
    }
  }
  for (const agent of targets) {
    const health = validateHealthPayload(await waitForHealth(agent, options), {
      expectedRuntimeVersion: versions.primitive_runtime,
      expectedPrimitiveVersions: versions.primitives,
      mode: options.runtime,
    })
    const probe = await probeMcpEndpoint(agent, options)
    report.probes.push({
      label: agent.label,
      profile: agent.profile,
      endpoint: agent.endpoint,
      health,
      tools: probe.tools,
      recall: probe.recall,
    })
  }
  for (const agent of targets) {
    report.settled.push({
      label: agent.label,
      profile: agent.profile,
      endpoint: agent.endpoint,
      activity: await waitForEndpointSettled(agent, options),
    })
  }
  if (!options.noTopology) {
    report.topology = checkTopology(options)
  }
  return report
}

function formatTextReport(report) {
  const lines = [
    `atrib primitives runtime update proof passed (runtime: ${report.runtime})`,
    `root: ${report.root}`,
    `expected: @atrib/primitives-runtime ${report.expected_versions.primitive_runtime}, ${Object.values(
      report.expected_versions.primitives,
    )
      .map((item) => `${item.package} ${item.version}`)
      .join(', ')}`,
  ]
  for (const probe of report.probes) {
    lines.push(
      `${probe.profile}: ${probe.endpoint} pid=${probe.health.pid} runtime=${probe.health.version} tools=${probe.tools.tool_count} behavioral=${Object.values(probe.health.behavioral_probes).filter((item) => item.status === 'pass').length} recall=${probe.health.recall_contract} coverage.index=${probe.recall.coverage_index_status}`,
    )
  }
  if (report.topology) {
    lines.push(
      `topology: primitive-gates=${report.topology.status}, global=${report.topology.global_status}, primitive mismatches=${report.topology.primitive_runtime_version_mismatches}, surface mismatches=${report.topology.primitive_runtime_surface_contract_mismatches}, behavioral failures=${report.topology.primitive_runtime_behavioral_probe_failures}, recall mismatches=${report.topology.primitive_runtime_recall_contract_mismatches}`,
    )
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const report = await run(options)
  process.stdout.write(
    options.json ? `${JSON.stringify(report, null, 2)}\n` : formatTextReport(report),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exit(1)
  })
}
