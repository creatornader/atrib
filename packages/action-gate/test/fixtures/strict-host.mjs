// SPDX-License-Identifier: Apache-2.0
// Local subprocess fixture. Its only effect is a synced file inside the test directory.
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createProtectedMcpExecutor } from '../../dist/index.js'
import {
  base64urlEncode,
  getPublicKey,
  createJsonCommitment,
  canonicalRecord,
  sha256,
  hexEncode,
  EVIDENCE_TYPES,
  DECLARED_METHOD,
  HOST_CAPTURE_METHOD,
  signRecord,
  createStrictMirrorRetention,
  createEvidenceNonce,
  commitEvidenceBody,
} from '@atrib/mcp'

const [directory, mode = 'success'] = process.argv.slice(2)
if (!directory) throw new Error('fixture requires an isolated temporary directory')
const privateKey = new Uint8Array(32).fill(23)
const liveClock = mode === 'live-clock'
const evaluatedAt = liveClock ? Date.now() : 1_780_000_000_000
const creatorKey = base64urlEncode(await getPublicKey(privateKey))
const mirrorPath = join(directory, 'mirror.jsonl')
const policyPath = join(directory, 'policy.json')
const effectPath = join(directory, 'effect.txt')
const source = { namespace: 'urn:host:', id: 'fixture' }
const runtimeMethod = 'https://atrib.dev/evidence/v1/method/runtime-coverage/1'
const routedRequest = { name: 'write', arguments: { text: 'fixture' } }
const descriptor = {
  service: 'urn:mcp:',
  operation: routedRequest.name,
  resource: { namespace: 'urn:file:', id: 'fixture' },
  parameters: routedRequest.arguments,
}
const nativeEvent = {
  event_id: 'invocation',
  context_id: 'a'.repeat(32),
  position: 1,
  kind: 'mcp.tools.call',
  descriptor,
}
const authorityStart = liveClock
  ? Math.floor(evaluatedAt / 86_400_000) * 86_400_000
  : evaluatedAt - 60_000
const authoritySnapshot = {
  version: 'fixture:1',
  revoked: false,
  not_before: authorityStart,
  expires_at: authorityStart + 86_400_000,
}
const authorityHash = createJsonCommitment(authoritySnapshot, 'plain-sha256').hash
const policy = {
  id: 'fixture-pinned-policy',
  required: ['source', 'binding', 'authority'],
  rules: ['request', 'authorization', 'observation'].map((kind) => ({
    type: EVIDENCE_TYPES[kind],
    signer_keys: [creatorKey],
    source_keys: [creatorKey],
    source,
    methods:
      kind === 'observation' && mode === 'coverage'
        ? [HOST_CAPTURE_METHOD, runtimeMethod]
        : [kind === 'observation' ? HOST_CAPTURE_METHOD : DECLARED_METHOD],
    subject_namespace: 'urn:action:',
    max_age_ms: 30_000,
    authority_versions: ['fixture:1'],
    authorized_descriptors: [descriptor],
    authority_basis: [authorityHash],
  })),
}
await writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 })
const executor = createProtectedMcpExecutor({
  privateKey,
  contextId: 'a'.repeat(32),
  ...(liveClock ? {} : { now: () => evaluatedAt }),
  strictEvidence: {
    mirrorPath,
    source,
    authoritySnapshot,
    ...(mode === 'coverage'
      ? {
          capture: {
            method: runtimeMethod,
            nativeEvent: (phase) => (phase === 'dispatch' ? nativeEvent : undefined),
          },
        }
      : {}),
    identify: () => ({
      subject: { namespace: 'urn:action:', id: 'action' },
      execution: { namespace: 'urn:run:', id: 'run' },
      native_invocation: {
        namespace: mode === 'coverage' ? source.namespace + '/invocations' : 'urn:invocation:',
        id: nativeEvent.event_id,
      },
      delivery: { namespace: 'urn:delivery:', id: 'delivery' },
    }),
    describe: (request) => ({
      ...descriptor,
      operation: request.name,
      parameters: request.arguments,
    }),
  },
  evaluate: () => ({
    outcome: mode === 'deny' ? 'block' : 'allow',
    policy_id: 'fixture',
    policy_version: '1',
  }),
  executeUpstream: () => {
    const file = openSync(effectPath, 'a', 0o600)
    try {
      writeSync(file, 'fixture effect\n')
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    if (mode === 'crash') process.exit(73)
    if (mode === 'unknown') throw new Error('connection lost after destination write')
    return mode === 'oversized' ? 'x'.repeat(2 * 1024 * 1024) : { accepted: true }
  },
})
const result = await executor.authorizeAndExecute({
  action: { run_id: 'run', action_id: 'action', agent_id: 'fixture' },
  request: routedRequest,
})
const records = (await readFile(mirrorPath, 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line).record)
const hash = (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
const request = records.find((record) => record.event_type === EVIDENCE_TYPES.request)
const envelopes = (await readFile(mirrorPath, 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
const dispatch = envelopes.find(
  (envelope) => envelope._local.evidence.opening.assertion.phase === 'dispatch',
)
if (mode === 'coverage') {
  const {
    createLogWindowManifest,
    createCoverageManifest,
    hashCanonical,
    hashCoverageAttestationContent,
    hashLogWindowManifest,
    projectCoverageEvidence,
  } = await import('../../../runtime-log/dist/index.js')
  const captured = {
    record: dispatch.record,
    opening: dispatch._local.evidence.opening,
    artifacts: dispatch._local.evidence.artifacts.map(({ hash, base64 }) => ({
      hash,
      bytes: Buffer.from(base64, 'base64'),
    })),
  }
  const frame = nativeEvent
  const events = [
    {
      event_id: frame.event_id,
      position: frame.position,
      kind: frame.kind,
      event_hash: hashCanonical(frame),
    },
  ]
  const logWindowManifest = createLogWindowManifest({
    source: { id: source.id },
    runtime: { name: 'strict-mcp-fixture', version: '1' },
    session: { id: 'a'.repeat(32), digest: hashCanonical({ id: 'fixture-run' }) },
    window: { start: 1, end: 1 },
    events,
    privacy_posture: 'host-owned',
    verifier_policy: { require_event_root: true },
  })
  const manifest = createCoverageManifest({
    log_window_manifest: logWindowManifest,
    surfaces: [
      {
        id: 'mcp',
        boundary: 'mcp-dispatch',
        owner: 'fixture-host',
        required: true,
        action_kinds: [frame.kind],
      },
    ],
    actions: [
      {
        action_id: frame.event_id,
        action_hash: hashCanonical(frame),
        surface_id: 'mcp',
        state: 'captured',
        record_hash: hashCanonical(captured.record),
      },
    ],
  })
  const sign = (args_hash, event_type = 'https://atrib.dev/v1/types/observation') =>
    signRecord(
      {
        spec_version: 'atrib/1.0',
        creator_key: creatorKey,
        context_id: 'a'.repeat(32),
        chain_root: hash(request),
        timestamp: evaluatedAt,
        event_type,
        args_hash,
        signature: '',
      },
      privateKey,
    )
  const projection = projectCoverageEvidence({
    manifest,
    logWindowManifest,
    events,
    surfaceId: 'mcp',
    sourceIdentity: source,
    invocationNamespace: source.namespace + '/invocations',
    nonce: createEvidenceNonce(),
    observedAt: evaluatedAt,
    coverageAttestationRecord: await sign(hashCoverageAttestationContent(manifest)),
    logWindowRecord: await sign(hashLogWindowManifest(logWindowManifest)),
    capturedEvents: [captured],
  })
  await createStrictMirrorRetention({ path: mirrorPath }).retain({
    record: await sign(commitEvidenceBody('coverage', projection.body), EVIDENCE_TYPES.coverage),
    opening: projection.body,
    artifacts: [...projection.artifacts].map(([hash, bytes]) => ({ hash, bytes })),
  })
  policy.required.push('coverage')
  policy.rules.push({
    ...policy.rules[0],
    type: EVIDENCE_TYPES.coverage,
    methods: [runtimeMethod],
    subject_namespace: source.namespace,
  })
  await writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 })
}
process.stdout.write(
  JSON.stringify({
    mirrorPath,
    policyPath,
    effectPath,
    requestHash: hash(request),
    ...(dispatch ? { dispatchHash: hash(dispatch.record) } : {}),
    evaluatedAt: liveClock ? Date.now() : evaluatedAt,
    status: result.status,
  }) + '\n',
)
