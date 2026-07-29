#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { pathToFileURL } from 'node:url'

function parseArgs(argv) {
  const endpoints = []
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--endpoint') {
      const endpoint = argv[index + 1]
      if (!endpoint) throw new Error('--endpoint requires a URL')
      endpoints.push(endpoint)
      index += 1
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (endpoints.length === 0) {
    throw new Error('pass at least one --endpoint')
  }
  return { endpoints, json }
}

export function evaluateCompatibilityReport(endpoint, payload) {
  const compatibility = payload?.report?.compatibility
  const daemon = payload?.report?.daemon
  if (!compatibility || !daemon) {
    return {
      endpoint,
      status: 'invalid',
      reason: 'health response lacks daemon or compatibility facts',
    }
  }
  const regression =
    compatibility.expected_modern === true && compatibility.legacy_after_modern_requests > 0
  return {
    endpoint,
    profile: compatibility.profile,
    daemon_version: daemon.version,
    protocol_version: daemon.protocol_version,
    transport_adapter: daemon.transport_adapter,
    modern_requests: compatibility.modern_requests,
    legacy_requests: compatibility.legacy_requests,
    legacy_after_modern_requests: compatibility.legacy_after_modern_requests,
    last_legacy_after_modern_at: compatibility.last_legacy_after_modern_at ?? null,
    clients: compatibility.clients,
    status: regression ? 'alert' : 'pass',
    reason: regression ? 'legacy traffic observed after modern traffic' : null,
  }
}

async function inspectEndpoint(endpoint) {
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) {
      return { endpoint, status: 'unavailable', reason: `HTTP ${response.status}` }
    }
    return evaluateCompatibilityReport(endpoint, await response.json())
  } catch (error) {
    return {
      endpoint,
      status: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const reports = await Promise.all(options.endpoints.map(inspectEndpoint))
  const status = reports.every((report) => report.status === 'pass') ? 'pass' : 'alert'
  const output = {
    schema: 'atrib.mcp-compatibility-alert.v1',
    checked_at: new Date().toISOString(),
    status,
    reports,
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  } else {
    for (const report of reports) {
      process.stdout.write(
        `${report.status.toUpperCase()} ${report.profile ?? report.endpoint}: ${report.reason ?? 'no legacy regression'}\n`,
      )
    }
  }
  if (status !== 'pass') process.exitCode = 1
}

const isDirect =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
