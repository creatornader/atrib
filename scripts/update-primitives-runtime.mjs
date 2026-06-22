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
const LAUNCH_AGENT_PREFIX = 'com.nader.atrib-primitives.'
const PRIMITIVES_PACKAGE = join(ROOT, 'services/atrib-primitives/package.json')
const RECALL_PACKAGE = join(ROOT, 'services/atrib-recall/package.json')
const EXPECTED_RECALL_COVERAGE_VERSION = 'coverage-v1'
const EXPECTED_RECALL_CONTENT_INDEX_VERSION = 'content-index-v1'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_PROBE_QUERY = 'atrib primitive runtime content index health probe'
const REPORT_SCHEMA = 'atrib.primitives-runtime-update-report.v0'

function usage() {
  return `Usage:
  node scripts/update-primitives-runtime.mjs [options]

Options:
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
@atrib/recall and @atrib/primitives-runtime, restarts those LaunchAgents, then
directly calls recall_by_content over each Streamable HTTP MCP endpoint.
`
}

export function parseArgs(argv) {
  const out = {
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

function scriptPathFromProgramArguments(args) {
  return args.find((arg) => arg.endsWith('/services/atrib-primitives/dist/index.js'))
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

export function normalizePrimitiveLaunchAgent(plist, plistPath, { root = ROOT } = {}) {
  const label = typeof plist.Label === 'string' ? plist.Label : undefined
  const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments.map(String) : []
  const workingDirectory =
    typeof plist.WorkingDirectory === 'string' ? plist.WorkingDirectory : undefined
  const scriptPath = scriptPathFromProgramArguments(args)
  const transport = valueAfter(args, '--transport') ?? 'stdio'
  const endpoint = transport === 'streamable-http' ? endpointFromProgramArguments(args) : undefined
  const profile = label?.startsWith(LAUNCH_AGENT_PREFIX)
    ? label.slice(LAUNCH_AGENT_PREFIX.length)
    : undefined
  const expectedDistEntry = join(root, 'services/atrib-primitives/dist/index.js')
  const reasons = []

  if (!label?.startsWith(LAUNCH_AGENT_PREFIX)) reasons.push('label is not an atrib-primitives host')
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
} = {}) {
  if (!launchAgentsDir || !existsSync(launchAgentsDir)) return []
  return readdirSync(launchAgentsDir)
    .filter((name) => name.endsWith('.plist') && name.startsWith(LAUNCH_AGENT_PREFIX))
    .map((name) => {
      const path = join(launchAgentsDir, name)
      return normalizePrimitiveLaunchAgent(parsePlist(path), path, { root })
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
  return [
    runCommand('pnpm', ['--filter', '@atrib/recall', 'build'], {
      label: 'build @atrib/recall',
      dryRun: options.dryRun,
    }),
    runCommand('pnpm', ['--filter', '@atrib/primitives-runtime', 'build'], {
      label: 'build @atrib/primitives-runtime',
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

export function validateHealthPayload(body, { expectedRuntimeVersion }) {
  const runtime = body?.report?.primitive_runtime
  const contract = runtime?.recall_contract
  const issues = []
  if (!runtime) issues.push('missing report.primitive_runtime')
  if (runtime?.version !== expectedRuntimeVersion) {
    issues.push(`expected primitive runtime ${expectedRuntimeVersion}, got ${runtime?.version}`)
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
  }
}

function idleSummary(body) {
  const sessions = body?.report?.sessions ?? {}
  const toolCalls = body?.report?.tool_calls ?? {}
  return {
    active_http_requests: sessions.active_http_requests,
    active_http_connections: sessions.active_http_connections,
    active_tool_calls: toolCalls.active_tool_calls,
  }
}

function endpointIdle(body) {
  const idle = idleSummary(body)
  return (
    idle.active_http_requests === 0 &&
    idle.active_http_connections === 0 &&
    idle.active_tool_calls === 0
  )
}

async function waitForEndpointIdle(agent, { timeoutMs }) {
  const deadline = Date.now() + Math.min(timeoutMs, 5000)
  let body
  while (Date.now() <= deadline) {
    body = await fetchJson(agent.health_endpoint, Math.min(1500, timeoutMs))
    if (endpointIdle(body)) {
      return idleSummary(body)
    }
    await delay(100)
  }
  throw new Error(
    `${agent.label} did not settle after direct MCP probe: ${JSON.stringify(idleSummary(body))}`,
  )
}

function serviceRequire() {
  return createRequire(pathToFileURL(PRIMITIVES_PACKAGE))
}

async function loadMcpClientModules() {
  const req = serviceRequire()
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

async function probeRecallByContent(agent, { timeoutMs, probeQuery }) {
  const { Client, StreamableHTTPClientTransport } = await loadMcpClientModules()
  const transport = new StreamableHTTPClientTransport(new URL(agent.endpoint))
  const client = new Client({
    name: `atrib-primitives-runtime-update-${agent.profile}`,
    version: '0.0.0',
  })
  try {
    await withTimeout(client.connect(transport), timeoutMs, `connect ${agent.endpoint}`)
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
    return validateRecallProbePayload(parseToolTextResult(result))
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}

function topologyGateStatus(report, name) {
  return report.gates?.find((gate) => gate.name === name)?.status
}

function checkTopology({ dryRun = false } = {}) {
  if (dryRun) return { status: 'skipped' }
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
    primitive_runtime_recall_contract_mismatches:
      report.summary?.primitive_runtime_recall_contract_mismatches,
    non_pass_gates: (report.gates ?? []).filter((gate) => gate.status !== 'pass'),
    gates: Object.fromEntries(
      requiredGates.map((name) => [name, topologyGateStatus(report, name)]),
    ),
  }
}

function expectedVersions() {
  return {
    primitive_runtime: readJson(PRIMITIVES_PACKAGE).version,
    recall: readJson(RECALL_PACKAGE).version,
  }
}

function assertTargets(discovered, targets, profiles) {
  if (targets.length) return
  const wanted = profiles.length ? ` for profile(s) ${profiles.join(', ')}` : ''
  const candidates = discovered.map((agent) => ({
    label: agent.label,
    profile: agent.profile,
    eligible: agent.eligible,
    reasons: agent.reasons,
  }))
  throw new Error(
    `no eligible atrib-primitives LaunchAgents found${wanted}: ${JSON.stringify(candidates)}`,
  )
}

async function run(options) {
  const versions = expectedVersions()
  const discovered = discoverPrimitiveLaunchAgents()
  const targets = selectTargetLaunchAgents(discovered, options.profiles)
  assertTargets(discovered, targets, options.profiles)

  const report = {
    schema: REPORT_SCHEMA,
    generated_at: new Date().toISOString(),
    root: ROOT,
    expected_versions: versions,
    options: {
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
    })
    const recall = await probeRecallByContent(agent, options)
    report.probes.push({
      label: agent.label,
      profile: agent.profile,
      endpoint: agent.endpoint,
      health,
      recall,
    })
  }
  for (const agent of targets) {
    report.settled.push({
      label: agent.label,
      profile: agent.profile,
      endpoint: agent.endpoint,
      idle: await waitForEndpointIdle(agent, options),
    })
  }
  if (!options.noTopology) {
    report.topology = checkTopology(options)
  }
  return report
}

function formatTextReport(report) {
  const lines = [
    'atrib primitives runtime update proof passed',
    `root: ${report.root}`,
    `expected: @atrib/primitives-runtime ${report.expected_versions.primitive_runtime}, @atrib/recall ${report.expected_versions.recall}`,
  ]
  for (const probe of report.probes) {
    lines.push(
      `${probe.profile}: ${probe.endpoint} pid=${probe.health.pid} runtime=${probe.health.version} recall=${probe.health.recall_contract} coverage.index=${probe.recall.coverage_index_status}`,
    )
  }
  if (report.topology) {
    lines.push(
      `topology: primitive-gates=${report.topology.status}, global=${report.topology.global_status}, primitive mismatches=${report.topology.primitive_runtime_version_mismatches}, recall mismatches=${report.topology.primitive_runtime_recall_contract_mismatches}`,
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
