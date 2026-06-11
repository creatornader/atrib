#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildReport } from './report-local-substrate-topology.mjs'

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

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate topology report fixtures ok\n')
}

main()
