#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildDefaultTrialMeasurement,
  formatTextMeasurement,
} from './measure-local-substrate-default-trial.mjs'
import { buildReport } from './report-local-substrate-topology.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURE_DIR = join(ROOT, 'spec/conformance/local-substrate-coordinator/topology')
const GENERATED_AT = '2026-06-12T00:00:00.000Z'
const FIXTURE_NOW_MS = Date.parse('2026-06-10T23:00:00.000Z')
const BRIDGE_SERVICE_DIR = ['agent', 'bridge', 'atrib'].join('-')
const failures = []

Date.now = () => FIXTURE_NOW_MS

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
    fail('healthy measurement: expected zero active joinable receipted WAL files')
  }
  if (measurement.process_footprint.watcher_wal.activity_status !== 'ok') {
    fail('healthy measurement: expected watcher-WAL activity status ok')
  }
  if (measurement.process_footprint.long_lived_agents.activity_not_delegated !== 0) {
    fail('healthy measurement: expected zero non-delegated long-lived activities')
  }
  if (measurement.process_footprint.long_lived_agents.activity_endpoint_mismatch !== 0) {
    fail('healthy measurement: expected zero long-lived activity endpoint mismatches')
  }
  if (!measurement.profile_coverage.primitive_http_shared_profiles.includes('claude-desktop')) {
    fail('healthy measurement: expected named startup profile coverage to include claude-desktop')
  }
  if (!measurement.long_lived_profile_coverage.activity_ok_profiles.includes('hermes')) {
    fail('healthy measurement: expected named long-lived activity coverage to include hermes')
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
    fail('receipt backlog measurement: expected active joinable receipted WAL count 1')
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
  const text = formatTextMeasurement(measurement)
  if (!text.includes('runtime=1 (http=1, proxy=1, stdio-proxy=1)')) {
    fail('bridge proxy process footprint: expected text output to show stdio-proxy count')
  }
}

function checkRequiredNamedProfiles() {
  const report = fixtureReport('healthy-collapsed-startup-spawn.json')
  const measurement = buildDefaultTrialMeasurement(report, {
    generatedAt: GENERATED_AT,
    requiredStartupProfiles: ['codex', 'claude-code', 'claude-desktop'],
    requiredLongLivedProfiles: ['hermes'],
  })
  if (measurement.status !== 'ready_for_default_trial') {
    fail(`required named profiles: expected ready, got ${measurement.status}`)
  }
  if (statusFor(measurement, 'required-startup-profiles') !== 'pass') {
    fail('required named profiles: expected required-startup-profiles=pass')
  }
  if (statusFor(measurement, 'required-long-lived-profiles') !== 'pass') {
    fail('required named profiles: expected required-long-lived-profiles=pass')
  }

  const missing = buildDefaultTrialMeasurement(report, {
    generatedAt: GENERATED_AT,
    requiredStartupProfiles: ['future-spawn'],
    requiredLongLivedProfiles: ['openclaw'],
  })
  if (missing.status !== 'not_ready') {
    fail(`missing named profiles: expected not_ready, got ${missing.status}`)
  }
  if (statusFor(missing, 'required-startup-profiles') !== 'fail') {
    fail('missing named profiles: expected required-startup-profiles=fail')
  }
  if (statusFor(missing, 'required-long-lived-profiles') !== 'fail') {
    fail('missing named profiles: expected required-long-lived-profiles=fail')
  }
  const details = missing.blockers.map((blocker) => blocker.detail).join('\n')
  if (!details.includes('config_profiles missing future-spawn')) {
    fail('missing named profiles: expected startup profile missing detail')
  }
  if (!details.includes('route_profiles missing openclaw')) {
    fail('missing named profiles: expected long-lived profile missing detail')
  }
}

function checkRegisteredFutureHarnessProfiles() {
  const futureStartup = buildDefaultTrialMeasurement(
    fixtureReport('registered-future-startup-spawn-config.json'),
    {
      generatedAt: GENERATED_AT,
      requiredStartupProfiles: ['future-spawn'],
      requiredLongLivedProfiles: ['future-agent'],
    },
  )
  if (futureStartup.status !== 'ready_for_default_trial') {
    fail(`registered future startup profile: expected ready, got ${futureStartup.status}`)
  }
  if (statusFor(futureStartup, 'required-startup-profiles') !== 'pass') {
    fail('registered future startup profile: expected required-startup-profiles=pass')
  }
  if (statusFor(futureStartup, 'required-long-lived-profiles') !== 'pass') {
    fail('registered future startup profile: expected required-long-lived-profiles=pass')
  }
  if (!futureStartup.profile_coverage.bridge_http_healthy_profiles.includes('future-spawn')) {
    fail('registered future startup profile: expected bridge HTTP coverage for future-spawn')
  }

  const futureLongLived = buildDefaultTrialMeasurement(
    fixtureReport('registered-future-long-lived-agent-route.json'),
    {
      generatedAt: GENERATED_AT,
      requiredLongLivedProfiles: ['future-agent'],
    },
  )
  if (futureLongLived.status !== 'ready_for_default_trial') {
    fail(`registered future long-lived profile: expected ready, got ${futureLongLived.status}`)
  }
  if (statusFor(futureLongLived, 'required-long-lived-profiles') !== 'pass') {
    fail('registered future long-lived profile: expected required-long-lived-profiles=pass')
  }
  if (!futureLongLived.long_lived_profile_coverage.activity_ok_profiles.includes('future-agent')) {
    fail('registered future long-lived profile: expected activity coverage for future-agent')
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

function checkWatcherActivityFailsMeasurement() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  delete snapshot.knowledge_base_receipt_report.activity
  const measurement = measurementForReport(buildReport(snapshot, { generatedAt: GENERATED_AT }))
  if (measurement.status !== 'not_ready') {
    fail(`watcher activity measurement: expected not_ready, got ${measurement.status}`)
  }
  if (statusFor(measurement, 'watcher-wal-and-receipts-clean') !== 'pass') {
    fail('watcher activity measurement: expected watcher-wal-and-receipts-clean=pass')
  }
  if (statusFor(measurement, 'watcher-wal-activity-clean') !== 'fail') {
    fail('watcher activity measurement: expected watcher-wal-activity-clean=fail')
  }

  const staleSnapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  staleSnapshot.knowledge_base_receipt_report.activity = {
    status: 'ok',
    source: 'synthesize',
    producer: 'atrib-emit-cli',
    last_activity_at: '2000-01-01T00:00:00.000Z',
    age_ms: 1000,
    max_age_ms: 3_600_000,
  }
  const staleMeasurement = measurementForReport(
    buildReport(staleSnapshot, { generatedAt: GENERATED_AT }),
  )
  if (staleMeasurement.status !== 'not_ready') {
    fail(`stale watcher activity measurement: expected not_ready, got ${staleMeasurement.status}`)
  }
  if (statusFor(staleMeasurement, 'watcher-wal-and-receipts-clean') !== 'pass') {
    fail('stale watcher activity measurement: expected watcher-wal-and-receipts-clean=pass')
  }
  if (statusFor(staleMeasurement, 'watcher-wal-activity-clean') !== 'fail') {
    fail('stale watcher activity measurement: expected watcher-wal-activity-clean=fail')
  }
  if (staleMeasurement.process_footprint.watcher_wal.activity_stale !== true) {
    fail('stale watcher activity measurement: expected activity_stale=true')
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

  const nonDelegatedFixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const nonDelegatedSnapshot = JSON.parse(JSON.stringify(nonDelegatedFixture.snapshot))
  for (const activity of nonDelegatedSnapshot.long_lived_activity_report.activities) {
    delete activity.local_substrate_mode
    delete activity.submission
  }
  const nonDelegated = measurementForReport(
    buildReport(nonDelegatedSnapshot, { generatedAt: GENERATED_AT }),
  )
  if (nonDelegated.status !== 'not_ready') {
    fail(`non-delegated long-lived measurement: expected not_ready, got ${nonDelegated.status}`)
  }
  if (statusFor(nonDelegated, 'long-lived-activity-clean') !== 'fail') {
    fail('non-delegated long-lived measurement: expected long-lived-activity-clean=fail')
  }
  if (nonDelegated.process_footprint.long_lived_agents.activity_not_delegated !== 1) {
    fail('non-delegated long-lived measurement: expected one non-delegated activity')
  }
  if (nonDelegated.process_footprint.long_lived_agents.activity_stale !== 0) {
    fail('non-delegated long-lived measurement: expected freshness to stay clean')
  }

  const endpointMismatchFixture = readJson(
    join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'),
  )
  const endpointMismatchSnapshot = JSON.parse(JSON.stringify(endpointMismatchFixture.snapshot))
  for (const activity of endpointMismatchSnapshot.long_lived_activity_report.activities) {
    activity.route_endpoint = 'http://127.0.0.1:9999/atrib/local-substrate'
  }
  const endpointMismatch = measurementForReport(
    buildReport(endpointMismatchSnapshot, { generatedAt: GENERATED_AT }),
  )
  if (endpointMismatch.status !== 'not_ready') {
    fail(
      `endpoint-mismatch long-lived measurement: expected not_ready, got ${endpointMismatch.status}`,
    )
  }
  if (statusFor(endpointMismatch, 'long-lived-activity-clean') !== 'fail') {
    fail('endpoint-mismatch long-lived measurement: expected long-lived-activity-clean=fail')
  }
  if (endpointMismatch.process_footprint.long_lived_agents.activity_endpoint_mismatch !== 1) {
    fail('endpoint-mismatch long-lived measurement: expected one endpoint mismatch')
  }
  if (endpointMismatch.process_footprint.long_lived_agents.activity_not_delegated !== 0) {
    fail('endpoint-mismatch long-lived measurement: expected zero non-delegated activities')
  }
}

function main() {
  checkHealthyMeasurement()
  checkRestartResidueFailsMeasurement()
  checkReceiptBacklogFailsMeasurement()
  checkBridgeProxyProcessFootprint()
  checkWatcherActivityFailsMeasurement()
  checkLongLivedGapFailsMeasurement()
  checkLongLivedActivityFailsMeasurement()
  checkRequiredNamedProfiles()
  checkRegisteredFutureHarnessProfiles()

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate default-trial measurement fixtures ok\n')
}

main()
