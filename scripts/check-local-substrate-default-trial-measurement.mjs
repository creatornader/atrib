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
const BRIDGE_SERVICE_DIR = ['agent', 'bridge', 'atrib'].join('-')
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
  if (measurement.process_footprint.watcher_wal.wal_receipted !== 0) {
    fail('healthy measurement: expected zero active receipted WAL files')
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
  snapshot.knowledge_base_receipt_report.wal.receipted = 1
  snapshot.knowledge_base_receipt_report.receipt_integrity = {
    active_receipt_files: 1,
    invalid_receipt_files: 0,
    orphan_receipt_files: 1,
    receipt_mismatches: 0,
    ready_to_join_receipt_files: 0,
    already_joined_receipt_files: 0,
    issues: [],
  }
  snapshot.knowledge_base_receipt_report.pending = {
    observations: 1,
    annotations: 0,
    wal_receipted: 0,
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
  if (measurement.process_footprint.watcher_wal.wal_receipted !== 1) {
    fail('receipt backlog measurement: expected active receipted WAL count 1')
  }
  if (measurement.process_footprint.watcher_wal.receipt_orphans !== 1) {
    fail('receipt backlog measurement: expected orphan receipt count 1')
  }
}

function checkBridgeProxyProcessFootprint() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.processes.push(
    {
      pid: 210,
      ppid: 1,
      service: 'claude-desktop',
      command: '/Applications/Claude.app/Contents/MacOS/Claude',
    },
    {
      pid: 230,
      ppid: 1,
      command: `node /workspace/private/services/${BRIDGE_SERVICE_DIR}/dist/index.js --transport streamable-http --host 127.0.0.1 --port 8791 --path /mcp`,
    },
    {
      pid: 231,
      ppid: 210,
      command: `node /workspace/private/services/${BRIDGE_SERVICE_DIR}/dist/index.js --transport stdio-http-proxy --endpoint http://127.0.0.1:8791/mcp`,
    },
  )
  const measurement = measurementForReport(buildReport(snapshot, { generatedAt: GENERATED_AT }))
  if (measurement.status !== 'ready_for_default_trial') {
    fail(`bridge proxy process footprint: expected ready, got ${measurement.status}`)
  }
  if (measurement.process_footprint.bridge.runtime_processes !== 1) {
    fail('bridge proxy process footprint: expected one bridge runtime process')
  }
  if (measurement.process_footprint.bridge.proxy_processes !== 1) {
    fail('bridge proxy process footprint: expected one bridge proxy process')
  }
  if (measurement.process_footprint.bridge.wrapper_processes !== 0) {
    fail('bridge proxy process footprint: expected zero legacy bridge wrappers')
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

function checkLongLivedActivityFailsMeasurement() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.long_lived_activity_report = {
    path: '~/.atrib/state/local-substrate/long-lived-activity-latest.json',
    exists: false,
    status: 'absent',
    activities: [],
  }
  const measurement = measurementForReport(buildReport(snapshot, { generatedAt: GENERATED_AT }))
  if (measurement.status !== 'not_ready') {
    fail(`long-lived activity measurement: expected not_ready, got ${measurement.status}`)
  }
  if (statusFor(measurement, 'long-lived-routes-healthy') !== 'pass') {
    fail('long-lived activity measurement: expected long-lived-routes-healthy=pass')
  }
  if (statusFor(measurement, 'long-lived-activity-clean') !== 'fail') {
    fail('long-lived activity measurement: expected long-lived-activity-clean=fail')
  }
}

function main() {
  checkHealthyMeasurement()
  checkRestartResidueFailsMeasurement()
  checkReceiptBacklogFailsMeasurement()
  checkBridgeProxyProcessFootprint()
  checkLongLivedGapFailsMeasurement()
  checkLongLivedActivityFailsMeasurement()

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate default-trial measurement fixtures ok\n')
}

main()
