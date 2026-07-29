#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { evaluateCompatibilityReport } from './check-mcp-compatibility-alerts.mjs'

function health(legacyAfterModernRequests) {
  return {
    report: {
      daemon: {
        version: '0.4.2',
        protocol_version: '2026-07-28',
        transport_adapter: 'v2-dual-era-per-request',
      },
      compatibility: {
        profile: 'codex',
        expected_modern: true,
        modern_requests: 12,
        legacy_requests: legacyAfterModernRequests,
        legacy_after_modern_requests: legacyAfterModernRequests,
        clients: { 'codex@1.0.0': { requests: 12 } },
      },
    },
  }
}

assert.equal(evaluateCompatibilityReport('http://example/health', health(0)).status, 'pass')

const regression = evaluateCompatibilityReport('http://example/health', health(1))
assert.equal(regression.status, 'alert')
assert.equal(regression.reason, 'legacy traffic observed after modern traffic')

assert.equal(evaluateCompatibilityReport('http://example/health', {}).status, 'invalid')

process.stdout.write('MCP compatibility alert checks passed\n')
