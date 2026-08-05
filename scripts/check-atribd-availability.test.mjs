#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { evaluateReadinessReport } from './check-atribd-availability.mjs'

const ready = {
  status: 'ready',
  report: {
    daemon: {
      version: '0.4.2',
      protocol_version: '2026-07-28',
      event_loop_lag_ms: { mean: 1, p95: 2, max: 3 },
    },
    compatibility: { profile: 'codex' },
  },
}

const pass = evaluateReadinessReport('http://example/ready', ready, 200, 12.5)
assert.equal(pass.status, 'pass')
assert.equal(pass.profile, 'codex')
assert.equal(pass.latency_ms, 12.5)

const starting = evaluateReadinessReport(
  'http://example/ready',
  { ...ready, status: 'starting' },
  503,
  8,
)
assert.equal(starting.status, 'degraded')
assert.equal(starting.reason, 'readiness status starting')

assert.equal(evaluateReadinessReport('http://example/ready', {}, 200, 1).status, 'invalid')

process.stdout.write('atribd availability checks passed\n')
