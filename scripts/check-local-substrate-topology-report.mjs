#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  collectKnowledgeBaseReceiptReport,
  collectLongLivedActivityReport,
  collectRegisteredLongLivedAgents,
  collectRegisteredStartupSpawnConfigs,
  formatTextReport,
  registeredLongLivedAgentsFromRegistry,
  registeredStartupSpawnConfigsFromRegistry,
  routeRegistryDiagnosticsFromRegistry,
} from './report-local-substrate-topology.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURE_DIR = join(ROOT, 'spec/conformance/local-substrate-coordinator/topology')
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

  const wrongSchemaDiagnostics = routeRegistryDiagnosticsFromRegistry(
    {
      schema: 'atrib.local-substrate-route-registry.v99',
      routes: [],
    },
    { registryPath: '/tmp/atrib-local-substrate-routes.json' },
  )
  if (
    wrongSchemaDiagnostics.length !== 1 ||
    wrongSchemaDiagnostics[0].status !== 'invalid_schema'
  ) {
    fail('route registry diagnostics: wrong schema was not reported')
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

function checkRouteRegistryDiagnosticsGate() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.route_registry = [
    {
      path: '~/.atrib/local-substrate/routes.json',
      exists: true,
      status: 'invalid_schema',
      schema: 'atrib.local-substrate-route-registry.v99',
      expected_schema: 'atrib.local-substrate-route-registry.v0',
    },
  ]

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'mixed') {
    fail(`route registry diagnostics gate: expected status mixed, got ${report.summary.status}`)
  }
  if (report.summary.route_registry_status !== 'problem') {
    fail(
      `route registry diagnostics gate: expected summary.route_registry_status=problem, got ${report.summary.route_registry_status}`,
    )
  }
  const routeRegistryGate = report.gates.find((gate) => gate.name === 'route-registry')
  if (routeRegistryGate?.status !== 'fail') {
    fail('route registry diagnostics gate: expected route-registry=fail')
  }
  const broadGate = report.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (broadGate?.status !== 'fail') {
    fail('route registry diagnostics gate: expected broad-default-readiness=fail')
  }
  if (
    !report.recommendations.includes(
      'fix the local route registry before relying on future harness coverage in the topology report',
    )
  ) {
    fail('route registry diagnostics gate: expected route-registry recommendation')
  }
}

function checkConfigSurfaceEndpointEvidence() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const report = buildReport(fixture.snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const codex = report.config_surfaces.find((config) => config.name === 'codex')
  const claudeCode = report.config_surfaces.find((config) => config.name === 'claude-code')
  const claudeDesktop = report.config_surfaces.find((config) => config.name === 'claude-desktop')
  if (!codex) {
    fail('config endpoint evidence: missing codex config surface')
  } else if (codex.local_substrate_endpoints.length !== 0) {
    fail('config endpoint evidence: expected raw Codex config endpoint list to stay empty')
  } else if (
    codex.effective_local_substrate_endpoints[0] !== 'http://127.0.0.1:8797/atrib/local-substrate'
  ) {
    fail('config endpoint evidence: expected Codex effective endpoint from primitive profile')
  } else if (codex.local_substrate_endpoint_evidence[0]?.source !== 'primitive-runtime-profile') {
    fail('config endpoint evidence: expected Codex primitive-runtime-profile evidence source')
  }
  if (!claudeCode) {
    fail('config endpoint evidence: missing claude-code config surface')
  } else if (
    claudeCode.effective_local_substrate_endpoints[0] !==
    'http://127.0.0.1:8788/atrib/local-substrate'
  ) {
    fail('config endpoint evidence: expected Claude Code effective endpoint from primitive profile')
  }
  if (!claudeDesktop) {
    fail('config endpoint evidence: missing claude-desktop config surface')
  } else if (
    claudeDesktop.local_substrate_endpoints[0] !== 'http://127.0.0.1:8786/atrib/local-substrate'
  ) {
    fail('config endpoint evidence: expected raw Claude Desktop local-substrate endpoint')
  } else if (
    claudeDesktop.effective_local_substrate_endpoints[0] !==
    'http://127.0.0.1:8786/atrib/local-substrate'
  ) {
    fail('config endpoint evidence: expected Claude Desktop effective endpoint')
  } else if (
    !claudeDesktop.local_substrate_endpoint_evidence.some(
      (evidence) => evidence.source === 'primitive-runtime-profile',
    )
  ) {
    fail('config endpoint evidence: expected Claude Desktop primitive profile evidence')
  }
}

function checkPrimitiveBackendContractGate() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  for (const item of snapshot.primitive_runtime_health ?? []) {
    const runtime = item.report?.primitive_runtime
    if (!runtime) continue
    delete runtime.backend
    delete runtime.session_model
    delete runtime.mounted_primitive_count
  }

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'mixed') {
    fail(`primitive backend contract gate: expected status mixed, got ${report.summary.status}`)
  }
  if (report.summary.primitive_runtime_http_shared !== 0) {
    fail(
      `primitive backend contract gate: expected summary.primitive_runtime_http_shared=0, got ${report.summary.primitive_runtime_http_shared}`,
    )
  }
  const primitiveGate = report.gates.find((gate) => gate.name === 'host-owned-primitives-http')
  if (primitiveGate?.status !== 'warn') {
    fail('primitive backend contract gate: expected host-owned-primitives-http=warn')
  }
  const broadGate = report.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (broadGate?.status !== 'fail') {
    fail('primitive backend contract gate: expected broad-default-readiness=fail')
  }
  if (
    !report.recommendations.includes(
      'start or restart one loopback atrib-primitives Streamable HTTP host with a shared primitive backend per startup-spawn agent profile before broad process-sharing rollout',
    )
  ) {
    fail('primitive backend contract gate: expected shared-backend recommendation')
  }
}

function checkExplicitContextPolicyGate() {
  const fixture = readJson(join(FIXTURE_DIR, 'missing-active-session-profile-state.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  for (const item of snapshot.primitive_runtime_health ?? []) {
    if (item.report?.profile?.agent !== 'claude-code') continue
    item.report.profile.context_id_policy = 'explicit-required'
    item.report.profile.requires_explicit_context_id = true
  }

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'ready_for_default_trial') {
    fail(
      `explicit context policy gate: expected ready_for_default_trial, got ${report.summary.status}`,
    )
  }
  if (report.summary.active_session_profiles_valid !== 1) {
    fail(
      `explicit context policy gate: expected 1 active-session profile, got ${report.summary.active_session_profiles_valid}`,
    )
  }
  if (report.summary.active_session_profiles_explicit_required !== 1) {
    fail(
      `explicit context policy gate: expected 1 explicit-context profile, got ${report.summary.active_session_profiles_explicit_required}`,
    )
  }
  if (report.summary.active_session_profiles_ready !== 2) {
    fail(
      `explicit context policy gate: expected 2 ready context profiles, got ${report.summary.active_session_profiles_ready}`,
    )
  }
  const activeSessionGate = report.gates.find(
    (gate) => gate.name === 'host-owned-active-session-context',
  )
  if (activeSessionGate?.status !== 'pass') {
    fail('explicit context policy gate: expected host-owned-active-session-context=pass')
  }
  const broadGate = report.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (broadGate?.status !== 'pass') {
    fail('explicit context policy gate: expected broad-default-readiness=pass')
  }
}

function checkKnowledgeBaseReceiptJoinGate() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.knowledge_base_receipt_report.status = 'backlog'
  snapshot.knowledge_base_receipt_report.observations.pending_receipt_joins = 2
  snapshot.knowledge_base_receipt_report.annotations.pending_receipt_or_parent_joins = 3
  snapshot.knowledge_base_receipt_report.wal.queued = 1
  snapshot.knowledge_base_receipt_report.wal.receipted = 1
  snapshot.knowledge_base_receipt_report.wal.quarantined = 0
  snapshot.knowledge_base_receipt_report.receipt_integrity = {
    active_receipt_files: 1,
    invalid_receipt_files: 0,
    orphan_receipt_files: 0,
    receipt_mismatches: 1,
    ready_to_join_receipt_files: 0,
    already_joined_receipt_files: 0,
    issues: [],
  }
  snapshot.knowledge_base_receipt_report.pending = {
    observations: 2,
    annotations: 3,
    wal_receipted: 0,
    wal_queued: 1,
    wal_quarantined: 0,
    total: 6,
  }

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'mixed') {
    fail(`knowledge-base receipt join gate: expected status mixed, got ${report.summary.status}`)
  }
  if (report.summary.knowledge_base_receipt_report_status !== 'backlog') {
    fail(
      `knowledge-base receipt join gate: expected summary.knowledge_base_receipt_report_status=backlog, got ${report.summary.knowledge_base_receipt_report_status}`,
    )
  }
  if (report.summary.knowledge_base_receipt_pending_total !== 7) {
    fail(
      `knowledge-base receipt join gate: expected pending total 7, got ${report.summary.knowledge_base_receipt_pending_total}`,
    )
  }
  if (report.summary.knowledge_base_wal_receipted !== 1) {
    fail('knowledge-base receipt join gate: expected active joinable receipted WAL count 1')
  }
  if (report.summary.knowledge_base_receipt_integrity_mismatches !== 1) {
    fail('knowledge-base receipt join gate: expected receipt mismatch count 1')
  }
  const receiptGate = report.gates.find((gate) => gate.name === 'knowledge-base-receipt-join-back')
  if (receiptGate?.status !== 'warn') {
    fail('knowledge-base receipt join gate: expected knowledge-base-receipt-join-back=warn')
  }
  const broadGate = report.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (broadGate?.status !== 'fail') {
    fail('knowledge-base receipt join gate: expected broad-default-readiness=fail')
  }
  if (
    !report.recommendations.includes(
      'refresh or repair the knowledge-base receipt join-back report before treating watcher-WAL routing as clean',
    )
  ) {
    fail('knowledge-base receipt join gate: expected receipt join-back recommendation')
  }
}

function checkKnowledgeBaseWatcherActivityGate() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  delete snapshot.knowledge_base_receipt_report.activity

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'mixed') {
    fail(
      `knowledge-base watcher activity gate: expected status mixed, got ${report.summary.status}`,
    )
  }
  if (report.summary.knowledge_base_receipt_report_status !== 'clean') {
    fail('knowledge-base watcher activity gate: expected receipt report to stay clean')
  }
  if (report.summary.knowledge_base_activity_status !== 'missing') {
    fail(
      `knowledge-base watcher activity gate: expected activity status missing, got ${report.summary.knowledge_base_activity_status}`,
    )
  }
  const receiptGate = report.gates.find((gate) => gate.name === 'knowledge-base-receipt-join-back')
  if (receiptGate?.status !== 'pass') {
    fail('knowledge-base watcher activity gate: expected knowledge-base-receipt-join-back=pass')
  }
  const activityGate = report.gates.find((gate) => gate.name === 'knowledge-base-watcher-activity')
  if (activityGate?.status !== 'warn') {
    fail('knowledge-base watcher activity gate: expected knowledge-base-watcher-activity=warn')
  }
  const broadGate = report.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (broadGate?.status !== 'fail') {
    fail('knowledge-base watcher activity gate: expected broad-default-readiness=fail')
  }
  if (
    !report.recommendations.includes(
      'refresh or repair knowledge-base watcher activity evidence before treating watcher-WAL routing as active',
    )
  ) {
    fail('knowledge-base watcher activity gate: expected watcher activity recommendation')
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
  const staleReport = buildReport(staleSnapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (staleReport.summary.status !== 'mixed') {
    fail(
      `knowledge-base watcher stale activity gate: expected status mixed, got ${staleReport.summary.status}`,
    )
  }
  if (staleReport.summary.knowledge_base_activity_status !== 'ok') {
    fail('knowledge-base watcher stale activity gate: expected activity status ok')
  }
  if (staleReport.summary.knowledge_base_activity_stale !== true) {
    fail('knowledge-base watcher stale activity gate: expected activity_stale=true')
  }
  if (Number(staleReport.summary.knowledge_base_activity_age_ms ?? 0) <= 1000) {
    fail('knowledge-base watcher stale activity gate: expected recomputed activity age')
  }
  const staleActivityGate = staleReport.gates.find(
    (gate) => gate.name === 'knowledge-base-watcher-activity',
  )
  if (staleActivityGate?.status !== 'warn') {
    fail(
      'knowledge-base watcher stale activity gate: expected knowledge-base-watcher-activity=warn',
    )
  }
  const staleBroadGate = staleReport.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (staleBroadGate?.status !== 'fail') {
    fail('knowledge-base watcher stale activity gate: expected broad-default-readiness=fail')
  }
}

function checkKnowledgeBaseReceiptCollector() {
  const dir = mkdtempSync(join(tmpdir(), 'atrib-receipt-report-'))
  try {
    const missing = collectKnowledgeBaseReceiptReport({ path: join(dir, 'missing.json') })
    if (missing.status !== 'absent' || missing.exists !== false) {
      fail(
        `knowledge-base receipt collector: expected missing report to be absent, got ${missing.status}`,
      )
    }

    const malformedPath = join(dir, 'malformed.json')
    writeFileSync(malformedPath, '{')
    const malformed = collectKnowledgeBaseReceiptReport({ path: malformedPath })
    if (malformed.status !== 'parse_error') {
      fail(
        `knowledge-base receipt collector: expected malformed report parse_error, got ${malformed.status}`,
      )
    }

    const invalidPath = join(dir, 'invalid.json')
    writeFileSync(
      invalidPath,
      JSON.stringify({
        generated_at: '2026-06-12T00:00:00.000Z',
        observations: { entries: 1, pending_receipt_joins: -1 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: { queued: 0, quarantined: 0, receipted: 0 },
      }),
    )
    const invalid = collectKnowledgeBaseReceiptReport({ path: invalidPath })
    if (invalid.status !== 'invalid_shape') {
      fail(
        `knowledge-base receipt collector: expected invalid report invalid_shape, got ${invalid.status}`,
      )
    }

    const invalidIntegrityPath = join(dir, 'invalid-integrity.json')
    writeFileSync(
      invalidIntegrityPath,
      JSON.stringify({
        generated_at: '2026-06-12T00:00:00.000Z',
        observations: { entries: 1, pending_receipt_joins: 0 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: { queued: 0, quarantined: 0, receipted: 0 },
        receipt_integrity: {
          active_receipt_files: 'bad-count',
          issues: { kind: 'bad-shape' },
        },
      }),
    )
    const invalidIntegrity = collectKnowledgeBaseReceiptReport({ path: invalidIntegrityPath })
    if (invalidIntegrity.status !== 'invalid_shape') {
      fail(
        `knowledge-base receipt collector: expected invalid integrity report invalid_shape, got ${invalidIntegrity.status}`,
      )
    }

    const stalePath = join(dir, 'stale.json')
    writeFileSync(
      stalePath,
      JSON.stringify({
        generated_at: '2000-01-01T00:00:00.000Z',
        days: 7,
        observations: { entries: 1, pending_receipt_joins: 0 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: { queued: 0, quarantined: 0, receipted: 0 },
      }),
    )
    const stale = collectKnowledgeBaseReceiptReport({
      path: stalePath,
      maxAgeMs: 3_600_000,
    })
    if (stale.status !== 'stale' || stale.pending.total !== 0) {
      fail(
        `knowledge-base receipt collector: expected stale clean-count report, got ${stale.status}`,
      )
    }

    const cleanPath = join(dir, 'clean.json')
    writeFileSync(
      cleanPath,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        days: 7,
        observations: { entries: 1, pending_receipt_joins: 0 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: { queued: 0, quarantined: 0, receipted: 0 },
        activity: {
          status: 'ok',
          source: 'bridge-poller',
          producer: 'atrib-emit',
          last_activity_at: new Date().toISOString(),
          age_ms: 1000,
          max_age_ms: 108000000,
          secret: 'must-not-leak',
        },
        caveats: ['join state, not public log inclusion'],
      }),
    )
    const clean = collectKnowledgeBaseReceiptReport({ path: cleanPath })
    if (clean.status !== 'clean' || clean.pending.total !== 0 || clean.caveats !== 1) {
      fail(`knowledge-base receipt collector: expected clean report, got ${clean.status}`)
    } else if (clean.activity.status !== 'ok' || clean.activity.source !== 'bridge-poller') {
      fail('knowledge-base receipt collector: expected normalized watcher activity')
    } else if (JSON.stringify(clean).includes('must-not-leak')) {
      fail('knowledge-base receipt collector: unsafe activity field leaked into normalized report')
    }

    const activeReceiptPath = join(dir, 'active-receipt.json')
    writeFileSync(
      activeReceiptPath,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        days: 7,
        observations: { entries: 1, pending_receipt_joins: 0 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: { queued: 0, quarantined: 0, receipted: 1 },
        pending: { observations: 0, annotations: 0, wal_queued: 0, wal_quarantined: 0, total: 0 },
        receipt_integrity: {
          active_receipt_files: 1,
          invalid_receipt_files: 0,
          orphan_receipt_files: 1,
          receipt_mismatches: 0,
          ready_to_join_receipt_files: 0,
          already_joined_receipt_files: 0,
          issues: [{ kind: 'orphan_receipt_file' }],
        },
        caveats: ['receipt integrity scan checks markdown join state'],
      }),
    )
    const activeReceipt = collectKnowledgeBaseReceiptReport({ path: activeReceiptPath })
    if (activeReceipt.status !== 'backlog' || activeReceipt.pending.total !== 1) {
      fail('knowledge-base receipt collector: expected active joinable receipted WAL backlog')
    }
    if (activeReceipt.receipt_integrity.orphan_receipt_files !== 1) {
      fail('knowledge-base receipt collector: expected orphan receipt integrity count')
    }

    const integrityOnlyBacklogPath = join(dir, 'integrity-only-backlog.json')
    writeFileSync(
      integrityOnlyBacklogPath,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        days: 7,
        observations: { entries: 1, pending_receipt_joins: 0 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: { queued: 0, quarantined: 0, receipted: 0 },
        pending: { observations: 0, annotations: 0, wal_queued: 0, wal_quarantined: 0, total: 0 },
        receipt_integrity: {
          active_receipt_files: 0,
          active_joinable_receipt_files: 0,
          non_joinable_receipt_files: 0,
          invalid_receipt_files: 0,
          orphan_receipt_files: 0,
          receipt_mismatches: 1,
          ready_to_join_receipt_files: 0,
          already_joined_receipt_files: 0,
          issues: [{ kind: 'receipt_hash_mismatch' }],
        },
      }),
    )
    const integrityOnlyBacklog = collectKnowledgeBaseReceiptReport({
      path: integrityOnlyBacklogPath,
    })
    if (integrityOnlyBacklog.status !== 'backlog' || integrityOnlyBacklog.pending.total !== 1) {
      fail('knowledge-base receipt collector: expected integrity-only backlog')
    }

    const diagnosticReceiptPath = join(dir, 'diagnostic-receipt.json')
    writeFileSync(
      diagnosticReceiptPath,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        days: 7,
        observations: { entries: 1, pending_receipt_joins: 0 },
        annotations: { entries: 1, pending_receipt_or_parent_joins: 0 },
        wal: {
          queued: 0,
          non_joinable_queued: 0,
          quarantined: 0,
          receipted: 0,
          non_joinable_receipted: 2,
        },
        pending: { observations: 0, annotations: 0, wal_queued: 0, wal_quarantined: 0, total: 0 },
        receipt_integrity: {
          active_receipt_files: 2,
          active_joinable_receipt_files: 0,
          non_joinable_receipt_files: 2,
          invalid_receipt_files: 0,
          orphan_receipt_files: 0,
          receipt_mismatches: 0,
          ready_to_join_receipt_files: 0,
          already_joined_receipt_files: 0,
          issues: [],
        },
      }),
    )
    const diagnosticReceipt = collectKnowledgeBaseReceiptReport({ path: diagnosticReceiptPath })
    if (diagnosticReceipt.status !== 'clean' || diagnosticReceipt.pending.total !== 0) {
      fail('knowledge-base receipt collector: expected diagnostic receipts to stay clean')
    }
    if (diagnosticReceipt.wal.non_joinable_receipted !== 2) {
      fail('knowledge-base receipt collector: expected non-joinable receipt count')
    }
    if (diagnosticReceipt.receipt_integrity.non_joinable_receipt_files !== 2) {
      fail('knowledge-base receipt collector: expected non-joinable integrity count')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkLongLivedActivityCollector() {
  const dir = mkdtempSync(join(tmpdir(), 'atrib-long-lived-activity-'))
  try {
    const missing = collectLongLivedActivityReport({ path: join(dir, 'missing.json') })
    if (missing.status !== 'absent' || missing.exists !== false) {
      fail(
        `long-lived activity collector: expected missing report to be absent, got ${missing.status}`,
      )
    }

    const malformedPath = join(dir, 'malformed.json')
    writeFileSync(malformedPath, '{')
    const malformed = collectLongLivedActivityReport({ path: malformedPath })
    if (malformed.status !== 'parse_error') {
      fail(
        `long-lived activity collector: expected malformed report parse_error, got ${malformed.status}`,
      )
    }

    const wrongSchemaPath = join(dir, 'wrong-schema.json')
    writeFileSync(
      wrongSchemaPath,
      JSON.stringify({
        schema: 'atrib.long-lived-agent-activity-report.v99',
        generated_at: new Date().toISOString(),
        activities: [],
      }),
    )
    const wrongSchema = collectLongLivedActivityReport({ path: wrongSchemaPath })
    if (wrongSchema.status !== 'invalid_shape') {
      fail(
        `long-lived activity collector: expected wrong schema invalid_shape, got ${wrongSchema.status}`,
      )
    }

    const invalidActivityPath = join(dir, 'invalid-activity.json')
    writeFileSync(
      invalidActivityPath,
      JSON.stringify({
        schema: 'atrib.long-lived-agent-activity-report.v0',
        generated_at: new Date().toISOString(),
        activities: [{ status: 'ok' }],
      }),
    )
    const invalidActivity = collectLongLivedActivityReport({ path: invalidActivityPath })
    if (invalidActivity.status !== 'invalid_shape') {
      fail(
        `long-lived activity collector: expected missing identity invalid_shape, got ${invalidActivity.status}`,
      )
    }

    const missingHashPath = join(dir, 'missing-hash.json')
    writeFileSync(
      missingHashPath,
      JSON.stringify({
        schema: 'atrib.long-lived-agent-activity-report.v0',
        generated_at: new Date().toISOString(),
        activities: [
          {
            label: 'ai.future.gateway',
            agent: 'future',
            status: 'ok',
            last_activity_at: new Date().toISOString(),
            route_endpoint: 'http://127.0.0.1:8898/atrib/local-substrate',
          },
        ],
      }),
    )
    const missingHash = collectLongLivedActivityReport({ path: missingHashPath })
    if (missingHash.status !== 'invalid_shape') {
      fail(
        `long-lived activity collector: expected missing record_hash invalid_shape, got ${missingHash.status}`,
      )
    }

    const missingEndpointPath = join(dir, 'missing-endpoint.json')
    writeFileSync(
      missingEndpointPath,
      JSON.stringify({
        schema: 'atrib.long-lived-agent-activity-report.v0',
        generated_at: new Date().toISOString(),
        activities: [
          {
            label: 'ai.future.gateway',
            agent: 'future',
            status: 'ok',
            last_activity_at: new Date().toISOString(),
            record_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          },
        ],
      }),
    )
    const missingEndpoint = collectLongLivedActivityReport({ path: missingEndpointPath })
    if (missingEndpoint.status !== 'invalid_shape') {
      fail(
        `long-lived activity collector: expected missing route_endpoint invalid_shape, got ${missingEndpoint.status}`,
      )
    }

    const stalePath = join(dir, 'stale.json')
    writeFileSync(
      stalePath,
      JSON.stringify({
        schema: 'atrib.long-lived-agent-activity-report.v0',
        generated_at: '2000-01-01T00:00:00.000Z',
        max_activity_age_ms: 1,
        activities: [
          {
            label: 'ai.future.gateway',
            agent: 'future',
            status: 'ok',
            last_activity_at: '2000-01-01T00:00:00.000Z',
            record_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            route_endpoint: 'http://127.0.0.1:8898/atrib/local-substrate',
          },
        ],
      }),
    )
    const stale = collectLongLivedActivityReport({ path: stalePath, maxAgeMs: 3_600_000 })
    if (stale.status !== 'stale' || stale.counts?.stale !== 1) {
      fail(`long-lived activity collector: expected stale activity report, got ${stale.status}`)
    }

    const cleanPath = join(dir, 'clean.json')
    writeFileSync(
      cleanPath,
      JSON.stringify({
        schema: 'atrib.long-lived-agent-activity-report.v0',
        generated_at: new Date().toISOString(),
        activities: [
          {
            label: 'ai.future.gateway',
            agent: 'future',
            status: 'ok',
            last_activity_at: new Date().toISOString(),
            record_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            route_endpoint: 'http://127.0.0.1:8898/atrib/local-substrate',
            producer: 'future-prerun',
            local_substrate_mode: 'commit',
            submission: 'local_substrate_delegated',
            secret: 'must-not-leak',
          },
        ],
      }),
    )
    const clean = collectLongLivedActivityReport({ path: cleanPath })
    const serialized = JSON.stringify(clean)
    if (clean.status !== 'clean' || clean.counts?.ok !== 1) {
      fail(`long-lived activity collector: expected clean report, got ${clean.status}`)
    } else if (serialized.includes('must-not-leak') || serialized.includes('secret')) {
      fail('long-lived activity collector: unsafe activity field leaked into normalized report')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function checkLongLivedActivityGate() {
  const fixture = readJson(join(FIXTURE_DIR, 'healthy-collapsed-startup-spawn.json'))
  const snapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  snapshot.long_lived_activity_report = {
    path: '~/.atrib/state/local-substrate/long-lived-activity-latest.json',
    exists: false,
    status: 'absent',
    activities: [],
  }

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  if (report.summary.status !== 'mixed') {
    fail(`long-lived activity gate: expected status mixed, got ${report.summary.status}`)
  }
  if (report.summary.long_lived_agent_routes_healthy !== report.summary.long_lived_agent_routes) {
    fail('long-lived activity gate: expected route health to stay green')
  }
  if (report.summary.long_lived_agent_activity_missing !== report.summary.long_lived_agent_routes) {
    fail(
      `long-lived activity gate: expected all activity evidence missing, got ${report.summary.long_lived_agent_activity_missing}`,
    )
  }
  const routeGate = report.gates.find((gate) => gate.name === 'long-lived-agent-route')
  if (routeGate?.status !== 'pass') {
    fail('long-lived activity gate: expected long-lived-agent-route=pass')
  }
  const activityGate = report.gates.find((gate) => gate.name === 'long-lived-agent-activity')
  if (activityGate?.status !== 'warn') {
    fail('long-lived activity gate: expected long-lived-agent-activity=warn')
  }
  const broadGate = report.gates.find((gate) => gate.name === 'broad-default-readiness')
  if (broadGate?.status !== 'fail') {
    fail('long-lived activity gate: expected broad-default-readiness=fail')
  }
  if (
    !report.recommendations.includes(
      'refresh or repair the long-lived activity report before treating supervised agent routing as clean',
    )
  ) {
    fail('long-lived activity gate: expected activity report recommendation')
  }

  const invalidSnapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  invalidSnapshot.long_lived_activity_report = {
    path: '~/.atrib/state/local-substrate/long-lived-activity-latest.json',
    exists: true,
    status: 'invalid_shape',
    reason: 'activities must be an array',
    activities: [],
  }
  const invalidReport = buildReport(invalidSnapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const invalidGate = invalidReport.gates.find((gate) => gate.name === 'long-lived-agent-activity')
  if (invalidGate?.status !== 'fail') {
    fail('long-lived activity gate: expected invalid report to fail activity gate')
  }

  const nonDelegatedSnapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  for (const activity of nonDelegatedSnapshot.long_lived_activity_report.activities) {
    delete activity.local_substrate_mode
    delete activity.submission
  }
  const nonDelegatedReport = buildReport(nonDelegatedSnapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const nonDelegatedGate = nonDelegatedReport.gates.find(
    (gate) => gate.name === 'long-lived-agent-activity',
  )
  if (nonDelegatedGate?.status !== 'warn') {
    fail('long-lived activity gate: expected non-delegated activity to warn')
  }
  if (nonDelegatedReport.summary.long_lived_agent_activity_not_delegated !== 1) {
    fail('long-lived activity gate: expected one non-delegated activity')
  }
  if (nonDelegatedReport.summary.long_lived_agent_activity_stale !== 0) {
    fail('long-lived activity gate: expected non-delegated activity to stay freshness-clean')
  }

  const endpointMismatchSnapshot = JSON.parse(JSON.stringify(fixture.snapshot))
  for (const activity of endpointMismatchSnapshot.long_lived_activity_report.activities) {
    activity.route_endpoint = 'http://127.0.0.1:9999/atrib/local-substrate'
  }
  const endpointMismatchReport = buildReport(endpointMismatchSnapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const endpointMismatchGate = endpointMismatchReport.gates.find(
    (gate) => gate.name === 'long-lived-agent-activity',
  )
  if (endpointMismatchGate?.status !== 'warn') {
    fail('long-lived activity gate: expected endpoint mismatch activity to warn')
  }
  if (!endpointMismatchGate.detail.includes('endpoint_mismatch=1')) {
    fail('long-lived activity gate: expected endpoint mismatch detail to be visible')
  }
  if (endpointMismatchReport.summary.long_lived_agent_activity_endpoint_mismatch !== 1) {
    fail('long-lived activity gate: expected one endpoint mismatch activity')
  }
  if (endpointMismatchReport.summary.long_lived_agent_activity_not_delegated !== 0) {
    fail('long-lived activity gate: expected endpoint mismatch not to count as non-delegated')
  }
  const endpointMismatchText = formatTextReport(endpointMismatchReport)
  if (!endpointMismatchText.includes('endpoint_mismatch=1')) {
    fail('long-lived activity gate: expected endpoint mismatch text output to be visible')
  }
  if (!endpointMismatchText.includes('not_delegated=0')) {
    fail('long-lived activity gate: expected non-delegated text output to stay visible')
  }
}

function checkDirectStdioRuntimeGate() {
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
      pid: 222,
      ppid: 210,
      command: 'node /workspace/atrib/services/atrib-primitives/dist/index.js',
    },
  )

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const gateStatus = (name) => report.gates.find((gate) => gate.name === name)?.status
  if (gateStatus('startup-spawn-mcp-collapse') !== 'warn') {
    fail('direct stdio runtime gate: expected startup-spawn-mcp-collapse=warn')
  }
  if (gateStatus('broad-default-readiness') !== 'fail') {
    fail('direct stdio runtime gate: expected broad-default-readiness=fail')
  }
  if (report.summary.status !== 'mixed') {
    fail(`direct stdio runtime gate: expected status mixed, got ${report.summary.status}`)
  }
  if (report.summary.primitive_runtime_stdio_processes !== 1) {
    fail(
      `direct stdio runtime gate: expected 1 direct stdio runtime, got ${report.summary.primitive_runtime_stdio_processes}`,
    )
  }
  if (
    !report.recommendations.includes(
      'route stdio-only startup-spawn clients through the atrib-primitives stdio-http-proxy backed by a shared Streamable HTTP host',
    )
  ) {
    fail('direct stdio runtime gate: expected proxy recommendation')
  }
}

function checkStdioProxyClassification() {
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
      pid: 222,
      ppid: 210,
      command:
        'node /workspace/atrib/services/atrib-primitives/dist/index.js --transport stdio-http-proxy --endpoint http://127.0.0.1:8792/mcp',
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

  const report = buildReport(snapshot, {
    generatedAt: '2026-06-11T00:00:00.000Z',
  })
  const gateStatus = (name) => report.gates.find((gate) => gate.name === name)?.status
  if (gateStatus('startup-spawn-mcp-collapse') !== 'pass') {
    fail('stdio proxy classification: expected startup-spawn-mcp-collapse=pass')
  }
  if (gateStatus('broad-default-readiness') !== 'pass') {
    fail('stdio proxy classification: expected broad-default-readiness=pass')
  }
  if (report.summary.primitive_runtime_stdio_processes !== 0) {
    fail('stdio proxy classification: expected no direct stdio runtime processes')
  }
  if (report.summary.primitive_proxy_processes !== 1) {
    fail(
      `stdio proxy classification: expected 1 proxy process, got ${report.summary.primitive_proxy_processes}`,
    )
  }
  if (report.summary.bridge_runtime_processes !== 1) {
    fail(
      `stdio proxy classification: expected 1 bridge runtime, got ${report.summary.bridge_runtime_processes}`,
    )
  }
  if (report.summary.bridge_proxy_processes !== 1) {
    fail(
      `stdio proxy classification: expected 1 bridge proxy, got ${report.summary.bridge_proxy_processes}`,
    )
  }
  if (report.summary.bridge_wrapper_processes !== 0) {
    fail('stdio proxy classification: expected no legacy bridge wrapper processes')
  }
  const text = formatTextReport(report)
  if (
    !text.includes(
      'bridge processes: runtimes=1 (http=1, proxy=1, stdio-proxy=1), legacy-wrappers=0, upstream=0, duplicate-groups=0',
    )
  ) {
    fail('stdio proxy classification: expected bridge runtime and proxy counts in text output')
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
  if (report.summary.restart_targets !== 1) {
    fail(
      `combined restart residue: expected summary.restart_targets=1, got ${report.summary.restart_targets}`,
    )
  } else {
    const target = report.restart_targets[0]
    if (target.parent_pid !== 100 || target.config_surface !== 'codex') {
      fail('combined restart residue: expected restart target to point at codex parent pid 100')
    }
    if (!target.reasons.includes('obsolete-standalone-primitives')) {
      fail('combined restart residue: expected obsolete-standalone-primitives reason')
    }
    if (!target.reasons.includes('obsolete-bridge-wrapper')) {
      fail('combined restart residue: expected obsolete-bridge-wrapper reason')
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
  checkRouteRegistryNormalization()
  checkRouteRegistryDiagnosticsGate()
  checkConfigSurfaceEndpointEvidence()
  checkPrimitiveBackendContractGate()
  checkExplicitContextPolicyGate()
  checkKnowledgeBaseReceiptJoinGate()
  checkKnowledgeBaseWatcherActivityGate()
  checkKnowledgeBaseReceiptCollector()
  checkLongLivedActivityCollector()
  checkLongLivedActivityGate()
  checkDirectStdioRuntimeGate()
  checkStdioProxyClassification()
  checkCombinedRestartResidueClassification()

  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`)
    process.exit(1)
  }
  process.stdout.write('local-substrate topology report fixtures ok\n')
}

main()
