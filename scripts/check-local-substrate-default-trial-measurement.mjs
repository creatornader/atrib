#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDefaultTrialMeasurement } from './measure-local-substrate-default-trial.mjs'
import { buildReport } from './report-local-substrate-topology.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURE_DIR = join(ROOT, 'spec/conformance/local-substrate-coordinator/topology')
const GENERATED_AT = '2026-06-12T00:00:00.000Z'
const failures = []

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function fail(message) {
  failures.push(message)
}

function fixtureReport(file) {
  const fixture = readJson(join(FIXTURE_DIR, file))
  return buildReport(fixture.snapshot, { generatedAt: GENERATED_AT })
}

function measurementForReport(report) {
  return buildDefaultTrialMeasurement(report, { generatedAt: GENERATED_AT })
}

function statusFor(measurement, gateName) {
  return measurement.gates.find((gate) => gate.name === gateName)?.status
}

function checkHealthyMeasurement() {
  const measurement = measurementForReport(fixtureReport('healthy-collapsed-startup-spawn.json'))
  if (measurement.status !== 'ready_for_default_trial') {
    fail(`healthy measurement: expected ready_for_default_trial, got ${measurement.status}`)
  }
  for (const gate of measurement.gates) {
    if (gate.status !== 'pass') {
      fail(`healthy measurement: expected ${gate.name}=pass, got ${gate.status}`)
    }
  }
  if (measurement.process_footprint.startup_spawn.standalone_primitive_processes !== 0) {
    fail('healthy measurement: expected zero standalone primitive processes')
  }
  if (measurement.process_footprint.bridge.wrapper_processes !== 0) {
    fail('healthy measurement: expected zero bridge wrapper processes')
  }
  if (measurement.process_footprint.watcher_wal.receipt_pending_total !== 0) {
    fail('healthy measurement: expected zero pending receipt joins')
  }
}

function checkRestartResidueFailsMeasurement() {
  const measurement = measurementForReport(
    fixtureReport('restart-required-obsolete-agent-bridge-wrappers.json'),
  )
  if (measurement.status !== 'not_ready') {
    fail(`restart residue measurement: expected not_ready, got ${measurement.status}`)
  }
  if (statusFor(measurement, 'topology-ready') !== 'fail') {
    fail('restart residue measurement: expected topology-ready=fail')
  }
  if (statusFor(measurement, 'no-stale-startup-spawn-processes') !== 'fail') {
    fail('restart residue measurement: expected no-stale-startup-spawn-processes=fail')
  }
  if (measurement.blockers.length === 0) {
    fail('restart residue measurement: expected blockers')
  }
}

function checkReceiptBacklogFailsMeasurement() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.knowledge_base_receipt_report.status = 'backlog'
  snapshot.knowledge_base_receipt_report.observations.pending_receipt_joins = 1
  snapshot.knowledge_base_receipt_report.pending = {
    observations: 1,
    annotations: 0,
    wal_queued: 0,
    wal_quarantined: 0,
    total: 1,
  }
  const measurement = measurementForReport(buildReport(snapshot, { generatedAt: GENERATED_AT }))
  if (measurement.status !== 'not_ready') {
    fail(`receipt backlog measurement: expected not_ready, got ${measurement.status}`)
  }
  if (statusFor(measurement, 'watcher-wal-and-receipts-clean') !== 'fail') {
    fail('receipt backlog measurement: expected watcher-wal-and-receipts-clean=fail')
  }
}

function checkLongLivedGapFailsMeasurement() {
  const measurement = measurementForReport(fixtureReport('missing-long-lived-agent-route.json'))
  if (measurement.status !== 'not_ready') {
    fail(`long-lived gap measurement: expected not_ready, got ${measurement.status}`)
  }
  if (statusFor(measurement, 'long-lived-routes-healthy') !== 'fail') {
    fail('long-lived gap measurement: expected long-lived-routes-healthy=fail')
  }
}

function main() {
  checkHealthyMeasurement()
  checkRestartResidueFailsMeasurement()
  checkReceiptBacklogFailsMeasurement()
  checkLongLivedGapFailsMeasurement()

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate default-trial measurement fixtures ok\n')
}

main()
