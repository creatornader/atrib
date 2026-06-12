#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  collectRegisteredLongLivedAgents,
  collectRegisteredStartupSpawnConfigs,
  registeredLongLivedAgentsFromRegistry,
  registeredStartupSpawnConfigsFromRegistry,
} from './report-local-substrate-topology.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURE_DIR = join(ROOT, 'spec/conformance/local-substrate-coordinator/topology')
const failures = []

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function fail(message) {
  failures.push(message)
}

function checkFixture(path) {
  const fixture = readJson(path)
  const report = buildReport(fixture.snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const label = fixture.name ?? path

  if (report.summary.status !== fixture.expected?.status) {
    fail(`${label}: expected status ${fixture.expected?.status}, got ${report.summary.status}`)
  }

  for (const [gateName, expectedStatus] of Object.entries(fixture.expected?.gates ?? {})) {
    const actual = report.gates.find((gate) => gate.name === gateName)
    if (!actual) {
      fail(`${label}: missing gate ${gateName}`)
    } else if (actual.status !== expectedStatus) {
      fail(`${label}: expected gate ${gateName}=${expectedStatus}, got ${actual.status}`)
    }
  }

  for (const [field, expectedValue] of Object.entries(fixture.expected?.summary ?? {})) {
    if (report.summary[field] !== expectedValue) {
      fail(`${label}: expected summary.${field}=${expectedValue}, got ${report.summary[field]}`)
    }
  }

  if (Array.isArray(fixture.expected?.recommendations)) {
    const actual = JSON.stringify(report.recommendations)
    const expected = JSON.stringify(fixture.expected.recommendations)
    if (actual !== expected) {
      fail(`${label}: expected recommendations ${expected}, got ${actual}`)
    }
  }
}

function checkRouteRegistryNormalization() {
  const registry = {
    schema: 'atrib.local-substrate-route-registry.v0',
    routes: [
      {
        kind: 'long-lived-agent',
        label: 'ai.future.gateway',
        agent: 'future',
        endpoint: 'http://127.0.0.1:8899/atrib/local-substrate',
      },
      {
        kind: 'startup-spawn-config',
        name: 'future-spawn',
        server_names: ['atrib-primitives', 'agent-bridge'],
        primitive_http_endpoint: 'http://127.0.0.1:8896/mcp',
        bridge_http_endpoint: 'http://127.0.0.1:8894/mcp',
        local_substrate_endpoint: 'http://127.0.0.1:8897/atrib/local-substrate',
      },
    ],
  }
  const routes = registeredLongLivedAgentsFromRegistry(registry, {
    registryPath: '/tmp/atrib-local-substrate-routes.json',
  })
  if (routes.length !== 1) {
    fail(`route registry: expected 1 normalized route, got ${routes.length}`)
  } else if (routes[0].source !== 'registry' || routes[0].agent !== 'future') {
    fail('route registry: direct route did not preserve source and agent')
  }

  const startupConfigs = registeredStartupSpawnConfigsFromRegistry(registry, {
    registryPath: '/tmp/atrib-local-substrate-routes.json',
  })
  if (startupConfigs.length !== 1) {
    fail(
      `route registry startup config: expected 1 normalized config, got ${startupConfigs.length}`,
    )
  } else {
    const config = startupConfigs[0]
    if (config.name !== 'future-spawn') {
      fail(`route registry startup config: expected future-spawn name, got ${config.name}`)
    } else if (!config.has_primitives_runtime) {
      fail('route registry startup config: expected primitives runtime declaration')
    } else if (config.primitive_http_endpoints[0] !== 'http://127.0.0.1:8896/mcp') {
      fail('route registry startup config: primitive HTTP endpoint was not preserved')
    } else if (config.bridge_http_endpoints[0] !== 'http://127.0.0.1:8894/mcp') {
      fail('route registry startup config: bridge HTTP endpoint was not preserved')
    } else if (
      config.local_substrate_endpoints[0] !== 'http://127.0.0.1:8897/atrib/local-substrate'
    ) {
      fail('route registry startup config: local-substrate endpoint was not preserved')
    }
  }

  const ignoredRemoteConfig = registeredStartupSpawnConfigsFromRegistry(
    {
      schema: 'atrib.local-substrate-route-registry.v0',
      routes: [
        {
          kind: 'startup-spawn-config',
          name: 'remote-spawn',
          primitive_http_endpoint: 'https://example.com/mcp',
        },
      ],
    },
    { registryPath: '/tmp/atrib-local-substrate-routes.json' },
  )
  if (
    ignoredRemoteConfig.length !== 1 ||
    ignoredRemoteConfig[0].primitive_http_endpoints.length !== 0
  ) {
    fail('route registry startup config: non-loopback primitive endpoint was not ignored')
  }

  const dir = mkdtempSync(join(tmpdir(), 'atrib-topology-'))
  try {
    const envPath = join(dir, 'future.env')
    const registryPath = join(dir, 'routes.json')
    writeFileSync(
      envPath,
      [
        'ATRIB_AGENT=future-env',
        'ATRIB_LOCAL_SUBSTRATE_ENDPOINT=http://127.0.0.1:8898/atrib/local-substrate',
        'SECRET_TOKEN=must-not-leak',
      ].join('\n'),
    )
    writeFileSync(
      registryPath,
      JSON.stringify({
        schema: 'atrib.local-substrate-route-registry.v0',
        routes: [
          {
            kind: 'long-lived-agent',
            label: 'ai.future-env.gateway',
            env_file: envPath,
          },
          {
            kind: 'startup-spawn-config',
            name: 'future-env-spawn',
            primitive_http_endpoint: 'http://127.0.0.1:8895/mcp',
          },
        ],
      }),
    )

    const envRoutes = collectRegisteredLongLivedAgents(registryPath)
    const envStartupConfigs = collectRegisteredStartupSpawnConfigs(registryPath)
    const route = envRoutes[0]
    const serialized = JSON.stringify([envRoutes, envStartupConfigs])
    if (envRoutes.length !== 1) {
      fail(`route registry env file: expected 1 normalized route, got ${envRoutes.length}`)
    } else if (route.agent !== 'future-env') {
      fail(`route registry env file: expected future-env agent, got ${route.agent}`)
    } else if (route.endpoint !== 'http://127.0.0.1:8898/atrib/local-substrate') {
      fail(`route registry env file: endpoint was not read from safe env keys`)
    } else if (envStartupConfigs.length !== 1) {
      fail(`route registry env file: expected 1 startup config, got ${envStartupConfigs.length}`)
    } else if (serialized.includes('must-not-leak') || serialized.includes('SECRET_TOKEN')) {
      fail('route registry env file: unsafe env value leaked into normalized route')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkCombinedRestartResidueClassification() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.processes.push(
    {
      pid: 100,
      ppid: 1,
      service: 'codex-app-server',
      command: 'codex app-server',
    },
    {
      pid: 120,
      ppid: 100,
      service: 'atrib-emit',
      command: 'node services/atrib-emit/dist/main.js',
    },
    {
      pid: 121,
      ppid: 100,
      service: 'atrib-annotate',
      command: 'node services/atrib-annotate/dist/main.js',
    },
    {
      pid: 122,
      ppid: 100,
      service: 'atrib-revise',
      command: 'node services/atrib-revise/dist/main.js',
    },
    {
      pid: 123,
      ppid: 100,
      service: 'atrib-recall',
      command: 'node services/atrib-recall/dist/index.js',
    },
    {
      pid: 124,
      ppid: 100,
      service: 'atrib-trace',
      command: 'node services/atrib-trace/dist/main.js',
    },
    {
      pid: 125,
      ppid: 100,
      service: 'atrib-summarize',
      command: 'node services/atrib-summarize/dist/main.js',
    },
    {
      pid: 126,
      ppid: 100,
      service: 'atrib-verify',
      command: 'node services/atrib-verify/dist/main.js',
    },
    {
      pid: 130,
      ppid: 100,
      command: 'node /opt/atrib/bridge-wrapper/dist/index.js',
    },
    {
      pid: 131,
      ppid: 130,
      command: 'node /opt/atrib/upstream-bridge/dist/index.js',
    },
  )

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'restart_required') {
    fail(`combined restart residue: expected status restart_required, got ${report.summary.status}`)
  }
  const gateStatus = (name) => report.gates.find((gate) => gate.name === name)?.status
  if (gateStatus('startup-spawn-mcp-collapse') !== 'warn') {
    fail('combined restart residue: expected startup-spawn-mcp-collapse=warn')
  }
  if (gateStatus('bridge-wrapper-footprint') !== 'warn') {
    fail('combined restart residue: expected bridge-wrapper-footprint=warn')
  }
  if (gateStatus('host-owned-primitives-http') !== 'pass') {
    fail('combined restart residue: expected host-owned-primitives-http=pass')
  }
  if (gateStatus('host-owned-bridge-http') !== 'pass') {
    fail('combined restart residue: expected host-owned-bridge-http=pass')
  }
  if (gateStatus('host-owned-active-session-context') !== 'pass') {
    fail('combined restart residue: expected host-owned-active-session-context=pass')
  }
}

function main() {
  if (!existsSync(FIXTURE_DIR)) {
    fail(`missing fixture directory ${FIXTURE_DIR}`)
  } else {
    const files = readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
    if (files.length === 0) fail('missing local-substrate topology fixtures')
    for (const file of files) checkFixture(join(FIXTURE_DIR, file))
  }
  checkRouteRegistryNormalization()
  checkCombinedRestartResidueClassification()

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate topology report fixtures ok\n')
}

main()
