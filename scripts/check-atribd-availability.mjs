#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const endpoints = []
  let attempts = 3
  let timeoutMs = 1_000
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--endpoint') {
      const endpoint = argv[++index]
      if (!endpoint) throw new Error('--endpoint requires a URL')
      endpoints.push(endpoint)
      continue
    }
    if (arg === '--attempts') {
      attempts = Number(argv[++index])
      if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
        throw new Error('--attempts must be an integer from 1 to 10')
      }
      continue
    }
    if (arg === '--timeout-ms') {
      timeoutMs = Number(argv[++index])
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000) {
        throw new Error('--timeout-ms must be an integer from 50 to 60000')
      }
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (endpoints.length === 0) throw new Error('pass at least one --endpoint')
  return { endpoints, attempts, timeoutMs, json }
}

function errorReason(error) {
  return error instanceof Error ? error.message : String(error)
}

export function evaluateReadinessReport(endpoint, payload, httpStatus, latencyMs) {
  const daemon = payload?.report?.daemon
  const compatibility = payload?.report?.compatibility
  if (!daemon || !compatibility) {
    return {
      endpoint,
      status: 'invalid',
      reason: 'readiness response lacks daemon or compatibility facts',
      http_status: httpStatus,
      latency_ms: latencyMs,
    }
  }
  const ready = httpStatus === 200 && payload.status === 'ready'
  return {
    endpoint,
    profile: compatibility.profile,
    status: ready ? 'pass' : 'degraded',
    reason: ready ? null : `readiness status ${String(payload.status)}`,
    http_status: httpStatus,
    latency_ms: latencyMs,
    daemon_version: daemon.version,
    protocol_version: daemon.protocol_version,
    event_loop_lag_ms: daemon.event_loop_lag_ms ?? null,
  }
}

async function inspectAttempt(endpoint, timeoutMs) {
  const startedAt = performance.now()
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) })
    const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10
    let payload
    try {
      payload = await response.json()
    } catch (error) {
      return {
        endpoint,
        status: 'invalid',
        reason: `invalid JSON response: ${errorReason(error)}`,
        http_status: response.status,
        latency_ms: latencyMs,
      }
    }
    return evaluateReadinessReport(endpoint, payload, response.status, latencyMs)
  } catch (error) {
    return {
      endpoint,
      status: 'unavailable',
      reason: errorReason(error),
      http_status: null,
      latency_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    }
  }
}

async function inspectEndpoint(endpoint, attempts, timeoutMs) {
  const observations = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const observation = await inspectAttempt(endpoint, timeoutMs)
    observations.push({ attempt, ...observation })
    if (observation.status === 'pass') {
      return { ...observation, attempts: observations, status: 'pass' }
    }
  }
  const last = observations.at(-1)
  return {
    ...last,
    status: last?.status ?? 'unavailable',
    attempts: observations,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const reports = await Promise.all(
    options.endpoints.map((endpoint) =>
      inspectEndpoint(endpoint, options.attempts, options.timeoutMs),
    ),
  )
  const status = reports.every((report) => report.status === 'pass') ? 'pass' : 'degraded'
  const output = {
    schema: 'atrib.atribd-availability.v1',
    checked_at: new Date().toISOString(),
    status,
    attempts: options.attempts,
    timeout_ms: options.timeoutMs,
    reports,
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } else {
    for (const report of reports) {
      process.stdout.write(
        `${report.status.toUpperCase()} ${report.profile ?? report.endpoint}: ${report.reason ?? 'ready'}\n`,
      )
    }
  }
  if (status !== 'pass') process.exitCode = 1
}

const isDirect =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${errorReason(error)}\n`)
    process.exitCode = 2
  })
}
