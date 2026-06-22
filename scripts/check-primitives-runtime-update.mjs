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
  validateToolSurfacePayload,
} from './update-primitives-runtime.mjs'

const root = '/workspace/atrib'
const expectedPrimitiveVersions = {
  emit: { package: '@atrib/emit', version: '0.16.2' },
  annotate: { package: '@atrib/annotate', version: '0.2.37' },
  revise: { package: '@atrib/revise', version: '0.2.37' },
  recall: { package: '@atrib/recall', version: '0.14.3' },
  trace: { package: '@atrib/trace', version: '0.5.17' },
  summarize: { package: '@atrib/summarize', version: '0.4.19' },
  verify: { package: '@atrib/verify-mcp', version: '0.2.17' },
}
const expectedPrimitiveTools = {
  emit: ['emit'],
  annotate: ['atrib-annotate'],
  revise: ['atrib-revise'],
  recall: [
    'recall_annotations',
    'recall_by_content',
    'recall_by_signer',
    'recall_my_attribution_history',
    'recall_orphans',
    'recall_revisions',
    'recall_session_chain',
    'recall_walk',
  ],
  trace: ['trace', 'trace_forward'],
  summarize: ['summarize'],
  verify: ['atrib-verify'],
}
const allExpectedTools = Object.values(expectedPrimitiveTools).flat()

function primitiveContractsFixture() {
  return Object.fromEntries(
    Object.entries(expectedPrimitiveTools).map(([primitive, mountedTools]) => [
      primitive,
      {
        status: 'pass',
        package: expectedPrimitiveVersions[primitive].package,
        version: expectedPrimitiveVersions[primitive].version,
        mounted_tools: mountedTools,
        missing_tools: [],
        unexpected_tools: [],
      },
    ]),
  )
}

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
        primitive_contracts: primitiveContractsFixture(),
      },
    },
  },
  { expectedRuntimeVersion: '0.1.17', expectedPrimitiveVersions },
)
assert.equal(health.pid, 123)
assert.equal(health.recall_contract, 'pass')
assert.equal(health.primitive_contracts.emit.status, 'pass')
assert.equal(health.primitive_contracts.recall.tool_count, 8)

assert.throws(
  () =>
    validateHealthPayload(
      {
        status: 'healthy',
        report: {
          primitive_runtime: {
            version: '0.1.16',
            recall_contract: {},
            primitive_contracts: {},
          },
        },
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

const toolSurface = validateToolSurfacePayload(allExpectedTools.map((name) => ({ name })))
assert.equal(toolSurface.tool_count, 15)

assert.throws(
  () => validateToolSurfacePayload([{ name: 'emit' }]),
  /primitive tool surface probe failed/,
)

assert.throws(
  () =>
    validateRecallProbePayload({
      runtime: { coverage_version: 'coverage-v1' },
      coverage: {},
    }),
  /runtime.content_index_version/,
)

process.stdout.write('primitives runtime update checks ok\n')
