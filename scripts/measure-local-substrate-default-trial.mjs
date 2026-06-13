#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildReport, collectLiveSnapshot } from './report-local-substrate-topology.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCHEMA = 'atrib.local-substrate-default-trial-measurement.v0'
const DEFAULT_HEALTH_TIMEOUT_MS = 1500

function usage() {
  return `Usage:
  node scripts/measure-local-substrate-default-trial.mjs [options]

Options:
  --json                  Print JSON instead of the text summary.
  --report <path>         Write the measurement report to a JSON file.
  --snapshot <path>       Build the measurement from a topology fixture snapshot.
  --route-registry <path> Read supervised agent routes from a JSON registry.
  --knowledge-base-receipt-report <path>
                          Read the knowledge-base receipt join-back report.
  --long-lived-activity-report <path>
                          Read the long-lived producer activity report.
  --timeout-ms <n>        Live coordinator health timeout. Defaults to 1500.
  --help                  Print this help.

The measurement consumes the same topology evidence as
report-local-substrate-topology.mjs and fails closed unless the process
footprint, shared HTTP surfaces, coordinator health, watcher receipt join-back,
long-lived routes, and long-lived producer activity are all ready for a
controlled default trial.
`
}

function parseArgs(argv) {
  const out = {
    json: false,
    reportPath: undefined,
    snapshotPath: undefined,
    routeRegistryPath: undefined,
    knowledgeBaseReceiptReportPath: undefined,
    longLivedActivityReportPath: undefined,
    timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    help: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      out.json = true
    } else if (arg === '--report') {
      out.reportPath = requireValue(argv, ++i, '--report')
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function gate(name, passed, detail) {
  return {
    name,
    status: passed ? 'pass' : 'fail',
    detail,
  }
}

function gateStatus(report, name) {
  return report.gates.find((item) => item.name === name)?.status
}

function allCoordinatorsClean(report) {
  return (
    report.coordinators.length > 0 &&
    report.coordinators.every(
      (coordinator) =>
        coordinator.reachable === true &&
        coordinator.status === 'healthy' &&
        Number(coordinator.log_submission_depth ?? 0) === 0 &&
        Number(coordinator.stale_children ?? 0) === 0 &&
        Number(coordinator.orphan_receipts ?? 0) === 0,
    )
  )
}

function buildDefaultTrialGates(report) {
  const summary = report.summary
  const topologyReady =
    summary.status === 'ready_for_default_trial' &&
    gateStatus(report, 'broad-default-readiness') === 'pass'
  const noStaleStartupSpawnProcesses =
    summary.standalone_primitive_processes === 0 &&
    summary.bridge_wrapper_processes === 0 &&
    summary.bridge_upstream_processes === 0 &&
    summary.duplicate_primitive_groups === 0 &&
    summary.duplicate_bridge_wrapper_groups === 0 &&
    summary.restart_targets === 0
  const hostOwnedHttpSurfaces =
    summary.primitive_runtime_processes > 0 &&
    summary.primitive_runtime_processes === summary.primitive_runtime_http_processes &&
    summary.primitive_runtime_stdio_processes === 0 &&
    summary.primitive_runtime_http_shared === summary.primitive_runtime_http_processes &&
    summary.active_session_profiles > 0 &&
    summary.active_session_profiles_ready === summary.active_session_profiles &&
    summary.bridge_runtime_http_endpoints > 0 &&
    summary.bridge_runtime_http_healthy === summary.bridge_runtime_http_endpoints
  const coordinatorHealthClean = allCoordinatorsClean(report)
  const watcherWalAndReceiptsClean =
    summary.watcher_wal_launch_agents > 0 &&
    summary.knowledge_base_receipt_report_status === 'clean' &&
    summary.knowledge_base_receipt_pending_total === 0 &&
    summary.knowledge_base_wal_queued === 0 &&
    Number(summary.knowledge_base_wal_receipted ?? 0) === 0 &&
    summary.knowledge_base_wal_quarantined === 0
  const watcherWalActivityClean =
    summary.watcher_wal_launch_agents > 0 &&
    summary.knowledge_base_activity_status === 'ok' &&
    summary.knowledge_base_activity_stale !== true
  const longLivedRoutesHealthy =
    summary.long_lived_agent_routes > 0 &&
    summary.long_lived_agent_routes_healthy === summary.long_lived_agent_routes &&
    summary.long_lived_agent_routes_missing === 0
  const longLivedActivityHealthy =
    summary.long_lived_agent_routes > 0 &&
    summary.long_lived_activity_report_status === 'clean' &&
    summary.long_lived_agent_activity_ok === summary.long_lived_agent_routes &&
    summary.long_lived_agent_activity_missing === 0 &&
    summary.long_lived_agent_activity_stale === 0

  return [
    gate(
      'topology-ready',
      topologyReady,
      topologyReady
        ? 'topology report status is ready_for_default_trial'
        : `topology report status is ${summary.status}`,
    ),
    gate(
      'no-stale-startup-spawn-processes',
      noStaleStartupSpawnProcesses,
      noStaleStartupSpawnProcesses
        ? 'no standalone primitive children, bridge wrappers, duplicate groups, or restart targets remain'
        : `standalone=${summary.standalone_primitive_processes}, bridge_wrappers=${summary.bridge_wrapper_processes}, bridge_upstream=${summary.bridge_upstream_processes}, restart_targets=${summary.restart_targets}`,
    ),
    gate(
      'host-owned-http-surfaces',
      hostOwnedHttpSurfaces,
      hostOwnedHttpSurfaces
        ? 'startup-spawn profiles use shared primitive HTTP and healthy bridge HTTP surfaces'
        : `primitive_http_shared=${summary.primitive_runtime_http_shared}/${summary.primitive_runtime_http_processes}, context_profiles_ready=${summary.active_session_profiles_ready}/${summary.active_session_profiles}, active_session_profiles=${summary.active_session_profiles_valid}, explicit_context_profiles=${summary.active_session_profiles_explicit_required}, bridge_http=${summary.bridge_runtime_http_healthy}/${summary.bridge_runtime_http_endpoints}`,
    ),
    gate(
      'coordinator-health-clean',
      coordinatorHealthClean,
      coordinatorHealthClean
        ? 'all known coordinators are healthy with empty queues and no stale children or orphan receipts'
        : 'one or more known coordinators are unreachable, unhealthy, queued, stale, or orphaned',
    ),
    gate(
      'watcher-wal-and-receipts-clean',
      watcherWalAndReceiptsClean,
      watcherWalAndReceiptsClean
        ? 'watcher-WAL route is present and the receipt join-back report is clean'
        : `watchers=${summary.watcher_wal_launch_agents}, receipt_status=${summary.knowledge_base_receipt_report_status}, pending=${summary.knowledge_base_receipt_pending_total}, wal_queued=${summary.knowledge_base_wal_queued}, wal_quarantined=${summary.knowledge_base_wal_quarantined}`,
    ),
    gate(
      'watcher-wal-activity-clean',
      watcherWalActivityClean,
      watcherWalActivityClean
        ? 'watcher-WAL route has recent knowledge-base producer activity evidence'
        : `watchers=${summary.watcher_wal_launch_agents}, activity_status=${summary.knowledge_base_activity_status}, activity_age_ms=${summary.knowledge_base_activity_age_ms}, activity_stale=${summary.knowledge_base_activity_stale}`,
    ),
    gate(
      'long-lived-routes-healthy',
      longLivedRoutesHealthy,
      longLivedRoutesHealthy
        ? 'every known long-lived route points at a healthy coordinator endpoint'
        : `healthy=${summary.long_lived_agent_routes_healthy}/${summary.long_lived_agent_routes}, missing=${summary.long_lived_agent_routes_missing}`,
    ),
    gate(
      'long-lived-activity-clean',
      longLivedActivityHealthy,
      longLivedActivityHealthy
        ? 'every known long-lived route has recent activity evidence'
        : `activity_status=${summary.long_lived_activity_report_status}, ok=${summary.long_lived_agent_activity_ok}/${summary.long_lived_agent_routes}, missing=${summary.long_lived_agent_activity_missing}, stale=${summary.long_lived_agent_activity_stale}`,
    ),
  ]
}

function buildDefaultTrialMeasurement(report, options = {}) {
  const gates = buildDefaultTrialGates(report)
  const ready = gates.every((item) => item.status === 'pass')
  const summary = report.summary
  const blockers = gates
    .filter((item) => item.status !== 'pass')
    .map((item) => ({ gate: item.name, detail: item.detail }))

  return {
    schema: SCHEMA,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    source: report.source,
    status: ready ? 'ready_for_default_trial' : 'not_ready',
    topology: {
      generated_at: report.generated_at,
      status: summary.status,
      gates: report.gates.map((item) => ({
        name: item.name,
        status: item.status,
      })),
    },
    process_footprint: {
      coordinators: {
        configured: summary.configured_coordinators,
        healthy: summary.healthy_coordinators,
      },
      startup_spawn: {
        primitive_runtime_processes: summary.primitive_runtime_processes,
        primitive_runtime_http_processes: summary.primitive_runtime_http_processes,
        primitive_runtime_http_shared: summary.primitive_runtime_http_shared,
        primitive_runtime_stdio_processes: summary.primitive_runtime_stdio_processes,
        primitive_proxy_processes: summary.primitive_proxy_processes,
        standalone_primitive_processes: summary.standalone_primitive_processes,
        standalone_primitive_generations: summary.standalone_primitive_generations,
        duplicate_primitive_groups: summary.duplicate_primitive_groups,
        restart_targets: summary.restart_targets,
      },
      bridge: {
        runtime_http_endpoints: summary.bridge_runtime_http_endpoints,
        runtime_http_healthy: summary.bridge_runtime_http_healthy,
        runtime_processes: summary.bridge_runtime_processes,
        runtime_http_processes: summary.bridge_runtime_http_processes,
        proxy_processes: summary.bridge_proxy_processes,
        proxy_stdio_processes: summary.bridge_proxy_stdio_processes,
        wrapper_processes: summary.bridge_wrapper_processes,
        upstream_processes: summary.bridge_upstream_processes,
        duplicate_wrapper_groups: summary.duplicate_bridge_wrapper_groups,
      },
      active_session_profiles: {
        total: summary.active_session_profiles,
        valid: summary.active_session_profiles_valid,
        explicit_required: summary.active_session_profiles_explicit_required,
        ready: summary.active_session_profiles_ready,
      },
      watcher_wal: {
        launch_agents: summary.watcher_wal_launch_agents,
        receipt_report_status: summary.knowledge_base_receipt_report_status,
        receipt_pending_total: summary.knowledge_base_receipt_pending_total,
        wal_queued: summary.knowledge_base_wal_queued,
        wal_non_joinable_queued: Number(summary.knowledge_base_wal_non_joinable_queued ?? 0),
        wal_receipted: Number(summary.knowledge_base_wal_receipted ?? 0),
        wal_non_joinable_receipted: Number(
          summary.knowledge_base_wal_non_joinable_receipted ?? 0,
        ),
        wal_quarantined: summary.knowledge_base_wal_quarantined,
        receipt_active_joinable: Number(
          summary.knowledge_base_receipt_integrity_active_joinable ?? 0,
        ),
        receipt_non_joinable: Number(
          summary.knowledge_base_receipt_integrity_non_joinable ?? 0,
        ),
        receipt_mismatches: Number(summary.knowledge_base_receipt_integrity_mismatches ?? 0),
        receipt_orphans: Number(summary.knowledge_base_receipt_integrity_orphans ?? 0),
        receipt_invalid: Number(summary.knowledge_base_receipt_integrity_invalid ?? 0),
        activity_status: summary.knowledge_base_activity_status,
        activity_source: summary.knowledge_base_activity_source,
        activity_age_ms: summary.knowledge_base_activity_age_ms,
        activity_stale: summary.knowledge_base_activity_stale,
      },
      long_lived_agents: {
        total: summary.long_lived_agents,
        routes: summary.long_lived_agent_routes,
        healthy_routes: summary.long_lived_agent_routes_healthy,
        missing_routes: summary.long_lived_agent_routes_missing,
        route_endpoints: summary.long_lived_agent_route_endpoints,
        activity_report_status: summary.long_lived_activity_report_status,
        activity_ok: summary.long_lived_agent_activity_ok,
        activity_missing: summary.long_lived_agent_activity_missing,
        activity_stale: summary.long_lived_agent_activity_stale,
      },
    },
    gates,
    blockers,
    recommendations: ready
      ? [
          'use this measurement as the controlled default-trial baseline and rerun it after every startup-spawn restart or route config edit',
        ]
      : report.recommendations,
  }
}

function formatTextMeasurement(measurement) {
  const lines = [
    `local-substrate default-trial measurement: ${measurement.status}`,
    `topology: ${measurement.topology.status}`,
    `coordinators: healthy=${measurement.process_footprint.coordinators.healthy}/${measurement.process_footprint.coordinators.configured}`,
    `startup-spawn: primitive-http-shared=${measurement.process_footprint.startup_spawn.primitive_runtime_http_shared}/${measurement.process_footprint.startup_spawn.primitive_runtime_http_processes}, direct-stdio=${measurement.process_footprint.startup_spawn.primitive_runtime_stdio_processes}, proxy=${measurement.process_footprint.startup_spawn.primitive_proxy_processes}, standalone=${measurement.process_footprint.startup_spawn.standalone_primitive_processes}, restart-targets=${measurement.process_footprint.startup_spawn.restart_targets}`,
    `bridge: http=${measurement.process_footprint.bridge.runtime_http_healthy}/${measurement.process_footprint.bridge.runtime_http_endpoints}, proxy=${measurement.process_footprint.bridge.proxy_processes}, wrappers=${measurement.process_footprint.bridge.wrapper_processes}, upstream=${measurement.process_footprint.bridge.upstream_processes}`,
    `watcher-WAL: launch-agents=${measurement.process_footprint.watcher_wal.launch_agents}, receipt-status=${measurement.process_footprint.watcher_wal.receipt_report_status}, pending=${measurement.process_footprint.watcher_wal.receipt_pending_total}, receipted=${measurement.process_footprint.watcher_wal.wal_receipted}, non-joinable-receipted=${measurement.process_footprint.watcher_wal.wal_non_joinable_receipted}, mismatches=${measurement.process_footprint.watcher_wal.receipt_mismatches}, orphans=${measurement.process_footprint.watcher_wal.receipt_orphans}`,
    `watcher-WAL activity: status=${measurement.process_footprint.watcher_wal.activity_status}, source=${measurement.process_footprint.watcher_wal.activity_source ?? 'unknown'}, age-ms=${measurement.process_footprint.watcher_wal.activity_age_ms ?? 'unknown'}`,
    `long-lived routes: healthy=${measurement.process_footprint.long_lived_agents.healthy_routes}/${measurement.process_footprint.long_lived_agents.routes}, missing=${measurement.process_footprint.long_lived_agents.missing_routes}`,
    `long-lived activity: status=${measurement.process_footprint.long_lived_agents.activity_report_status}, ok=${measurement.process_footprint.long_lived_agents.activity_ok}/${measurement.process_footprint.long_lived_agents.routes}, missing=${measurement.process_footprint.long_lived_agents.activity_missing}, stale=${measurement.process_footprint.long_lived_agents.activity_stale}`,
    '',
    'measurement gates:',
  ]
  for (const item of measurement.gates) {
    lines.push(`  ${item.status.toUpperCase()} ${item.name}: ${item.detail}`)
  }
  if (measurement.recommendations.length > 0) {
    lines.push('', 'next:')
    for (const recommendation of measurement.recommendations) {
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

  const snapshotInput = args.snapshotPath
    ? readJson(args.snapshotPath)
    : await collectLiveSnapshot({
        timeoutMs: args.timeoutMs,
        routeRegistryPath: args.routeRegistryPath,
        knowledgeBaseReceiptReportPath: args.knowledgeBaseReceiptReportPath,
        longLivedActivityReportPath: args.longLivedActivityReportPath,
      })
  const snapshot = snapshotInput?.snapshot ?? snapshotInput
  const topology = buildReport(snapshot)
  const measurement = buildDefaultTrialMeasurement(topology)

  if (args.reportPath) {
    const absolute = resolve(ROOT, args.reportPath)
    writeFileSync(absolute, `${JSON.stringify(measurement, null, 2)}\n`)
  }

  process.stdout.write(
    args.json ? `${JSON.stringify(measurement, null, 2)}\n` : formatTextMeasurement(measurement),
  )

  if (measurement.status !== 'ready_for_default_trial') {
    process.exitCode = 1
  }
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

export { SCHEMA, buildDefaultTrialMeasurement, formatTextMeasurement }
