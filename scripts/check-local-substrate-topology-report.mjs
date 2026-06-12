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
  registeredLongLivedAgentsFromRegistry,
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
  const routes = registeredLongLivedAgentsFromRegistry(
    {
      schema: 'atrib.local-substrate-route-registry.v0',
      routes: [
        {
          kind: 'long-lived-agent',
          label: 'ai.future.gateway',
          agent: 'future',
          endpoint: 'http://127.0.0.1:8899/atrib/local-substrate',
        },
      ],
    },
    { registryPath: '/tmp/atrib-local-substrate-routes.json' },
  )
  if (routes.length !== 1) {
    fail(`route registry: expected 1 normalized route, got ${routes.length}`)
  } else if (routes[0].source !== 'registry' || routes[0].agent !== 'future') {
    fail('route registry: direct route did not preserve source and agent')
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
        ],
      }),
    )

    const envRoutes = collectRegisteredLongLivedAgents(registryPath)
    const route = envRoutes[0]
    const serialized = JSON.stringify(envRoutes)
    if (envRoutes.length !== 1) {
      fail(`route registry env file: expected 1 normalized route, got ${envRoutes.length}`)
    } else if (route.agent !== 'future-env') {
      fail(`route registry env file: expected future-env agent, got ${route.agent}`)
    } else if (route.endpoint !== 'http://127.0.0.1:8898/atrib/local-substrate') {
      fail(`route registry env file: endpoint was not read from safe env keys`)
    } else if (serialized.includes('must-not-leak') || serialized.includes('SECRET_TOKEN')) {
      fail('route registry env file: unsafe env value leaked into normalized route')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
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

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate topology report fixtures ok\n')
}

main()
