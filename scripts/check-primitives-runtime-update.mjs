#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/* global process */

import assert from 'node:assert/strict'
import {
  endpointProbeSettled,
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

function behavioralProbesFixture() {
  return {
    recall: {
      status: 'pass',
      probe_kind: 'read-only',
      mutates_log_on_call: false,
      tool_names: expectedPrimitiveTools.recall,
    },
    trace: {
      status: 'pass',
      probe_kind: 'read-only',
      mutates_log_on_call: false,
      tool_names: expectedPrimitiveTools.trace,
    },
    summarize: {
      status: 'pass',
      probe_kind: 'schema-only',
      mutates_log_on_call: false,
      tool_names: expectedPrimitiveTools.summarize,
    },
    verify: {
      status: 'pass',
      probe_kind: 'read-only',
      mutates_log_on_call: false,
      tool_names: expectedPrimitiveTools.verify,
    },
    emit: {
      status: 'skipped',
      probe_kind: 'not-available',
      mutates_log_on_call: true,
      tool_names: expectedPrimitiveTools.emit,
      reason: 'write primitive has no validate-only contract',
    },
    annotate: {
      status: 'skipped',
      probe_kind: 'not-available',
      mutates_log_on_call: true,
      tool_names: expectedPrimitiveTools.annotate,
      reason: 'write primitive has no validate-only contract',
    },
    revise: {
      status: 'skipped',
      probe_kind: 'not-available',
      mutates_log_on_call: true,
      tool_names: expectedPrimitiveTools.revise,
      reason: 'write primitive has no validate-only contract',
    },
  }
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

assert.equal(
  endpointProbeSettled({
    report: {
      sessions: {
        active: 1,
        active_http_requests: 1,
        active_http_connections: 1,
      },
      tool_calls: {
        active_tool_calls: 0,
      },
    },
  }),
  true,
)

assert.equal(
  endpointProbeSettled({
    report: {
      sessions: {
        active: 1,
        active_http_requests: 1,
        active_http_connections: 1,
      },
      tool_calls: {
        active_tool_calls: 1,
      },
    },
  }),
  false,
)

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
        behavioral_probes: behavioralProbesFixture(),
      },
    },
  },
  { expectedRuntimeVersion: '0.1.17', expectedPrimitiveVersions },
)
assert.equal(health.pid, 123)
assert.equal(health.recall_contract, 'pass')
assert.equal(health.primitive_contracts.emit.status, 'pass')
assert.equal(health.primitive_contracts.recall.tool_count, 8)
assert.equal(health.behavioral_probes.verify.status, 'pass')
assert.equal(health.behavioral_probes.emit.status, 'skipped')

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
            behavioral_probes: {},
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

// atribd runtime mode (P046): stateless daemon LaunchAgents, daemon health
// shape with top-level contract blocks, requests counters, and no sessions
// block.

const atribdPlist = {
  Label: 'com.nader.atribd.claude-code',
  WorkingDirectory: root,
  ProgramArguments: [
    '/opt/homebrew/bin/node',
    '/workspace/atrib/services/atribd/dist/index.js',
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

const atribdAgent = normalizePrimitiveLaunchAgent(atribdPlist, '/tmp/atribd.plist', {
  root,
  mode: 'atribd',
})
assert.equal(atribdAgent.eligible, true)
assert.equal(atribdAgent.profile, 'claude-code')
assert.equal(atribdAgent.endpoint, 'http://127.0.0.1:8796/mcp')

const legacyUnderAtribd = normalizePrimitiveLaunchAgent(validPlist, '/tmp/codex.plist', {
  root,
  mode: 'atribd',
})
assert.equal(legacyUnderAtribd.eligible, false)
assert.match(legacyUnderAtribd.reasons.join('\n'), /not a atribd host/)

assert.equal(parseArgs(['--runtime', 'atribd']).runtime, 'atribd')
assert.throws(() => parseArgs(['--runtime', 'nonsense']), /unknown runtime mode/)

function atribdHealthBody() {
  return {
    status: 'healthy',
    report: {
      daemon: {
        name: 'atribd',
        pid: 456,
        version: '0.1.0',
        transport: 'streamable-http-stateless',
        transport_adapter: 'session-sdk-per-request',
      },
      recall_contract: {
        status: 'pass',
        coverage_version: 'coverage-v1',
        content_index_version: 'content-index-v1',
      },
      primitive_contracts: primitiveContractsFixture(),
      behavioral_probes: behavioralProbesFixture(),
      requests: {
        served: 3,
        rejected_header_mismatch: 0,
        rejected_missing_context: 0,
      },
    },
  }
}

const atribdHealth = validateHealthPayload(atribdHealthBody(), {
  expectedRuntimeVersion: '0.1.0',
  expectedPrimitiveVersions,
  mode: 'atribd',
})
assert.equal(atribdHealth.pid, 456)
assert.equal(atribdHealth.recall_contract, 'pass')
assert.equal(atribdHealth.primitive_contracts.recall.tool_count, 8)
assert.equal(atribdHealth.behavioral_probes.emit.status, 'skipped')

assert.throws(() => {
  const withSessions = atribdHealthBody()
  withSessions.report.sessions = { active: 1 }
  validateHealthPayload(withSessions, {
    expectedRuntimeVersion: '0.1.0',
    expectedPrimitiveVersions,
    mode: 'atribd',
  })
}, /retired sessions block/)

assert.throws(() => {
  const withoutRequests = atribdHealthBody()
  delete withoutRequests.report.requests
  validateHealthPayload(withoutRequests, {
    expectedRuntimeVersion: '0.1.0',
    expectedPrimitiveVersions,
    mode: 'atribd',
  })
}, /missing report.requests/)

assert.equal(
  endpointProbeSettled({
    report: {
      requests: { served: 4 },
      tool_calls: { active_tool_calls: 0 },
    },
  }),
  true,
)

process.stdout.write('primitives runtime update checks ok\n')
