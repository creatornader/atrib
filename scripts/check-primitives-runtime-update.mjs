#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import assert from 'node:assert/strict'
import {
  normalizePrimitiveLaunchAgent,
  parseArgs,
  selectTargetLaunchAgents,
  validateHealthPayload,
  validateRecallProbePayload,
} from './update-primitives-runtime.mjs'

const root = '/workspace/atrib'
const validPlist = {
  Label: 'com.nader.atrib-primitives.codex',
  WorkingDirectory: root,
  ProgramArguments: [
    '/opt/homebrew/bin/node',
    '/workspace/atrib/services/atrib-primitives/dist/index.js',
    '--transport',
    'streamable-http',
    '--host',
    '127.0.0.1',
    '--port',
    '8796',
    '--path',
    '/mcp',
    '--json',
  ],
}

const valid = normalizePrimitiveLaunchAgent(validPlist, '/tmp/codex.plist', { root })
assert.equal(valid.eligible, true)
assert.equal(valid.profile, 'codex')
assert.equal(valid.endpoint, 'http://127.0.0.1:8796/mcp')
assert.equal(valid.health_endpoint, 'http://127.0.0.1:8796/mcp/health')

const wrongRoot = normalizePrimitiveLaunchAgent(
  { ...validPlist, WorkingDirectory: '/workspace/other' },
  '/tmp/codex.plist',
  { root },
)
assert.equal(wrongRoot.eligible, false)
assert.match(wrongRoot.reasons.join('\n'), /working directory/)

const remoteEndpoint = normalizePrimitiveLaunchAgent(
  {
    ...validPlist,
    ProgramArguments: validPlist.ProgramArguments.map((arg) =>
      arg === '127.0.0.1' ? 'example.com' : arg,
    ),
  },
  '/tmp/codex.plist',
  { root },
)
assert.equal(remoteEndpoint.eligible, false)
assert.match(remoteEndpoint.reasons.join('\n'), /endpoint is not loopback/)

const selected = selectTargetLaunchAgents([valid, wrongRoot], ['codex'])
assert.deepEqual(
  selected.map((agent) => agent.label),
  ['com.nader.atrib-primitives.codex'],
)

assert.deepEqual(parseArgs(['--', '--profile', 'codex,claude-code', '--skip-build']).profiles, [
  'codex',
  'claude-code',
])

const health = validateHealthPayload(
  {
    status: 'healthy',
    report: {
      primitive_runtime: {
        pid: 123,
        version: '0.1.17',
        recall_contract: {
          status: 'pass',
          coverage_version: 'coverage-v1',
          content_index_version: 'content-index-v1',
        },
      },
    },
  },
  { expectedRuntimeVersion: '0.1.17' },
)
assert.equal(health.pid, 123)
assert.equal(health.recall_contract, 'pass')

assert.throws(
  () =>
    validateHealthPayload(
      {
        status: 'healthy',
        report: { primitive_runtime: { version: '0.1.16', recall_contract: {} } },
      },
      { expectedRuntimeVersion: '0.1.17' },
    ),
  /primitive health contract failed/,
)

const recall = validateRecallProbePayload({
  runtime: {
    package: '@atrib/recall',
    version: '0.14.3',
    coverage_version: 'coverage-v1',
    content_index_version: 'content-index-v1',
  },
  evidence_mode: 'bounded',
  evidence_status: 'partial',
  searched_records: 10,
  coverage: {
    index: {
      version: 'content-index-v1',
      status: 'memory_only',
    },
  },
})
assert.equal(recall.coverage_index_status, 'memory_only')
assert.equal(recall.content_index_version, 'content-index-v1')

assert.throws(
  () =>
    validateRecallProbePayload({
      runtime: { coverage_version: 'coverage-v1' },
      coverage: {},
    }),
  /runtime.content_index_version/,
)

process.stdout.write('primitives runtime update checks ok\n')
