// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  getPublicKey,
  signRecord,
  commitEvidenceBody,
  DECLARED_METHOD,
  HOST_CAPTURE_TYPE,
  type AtribRecord,
} from '@atrib/mcp'
import { verifyEvidenceSet } from '@atrib/verify'
import {
  createCoverageManifest,
  createLogWindowManifest,
  hashCanonical,
  hashCoverageAttestationContent,
  hashLogWindowManifest,
  projectCoverageEvidence,
  runtimeCoverageSourceVerifier,
  RUNTIME_COVERAGE_METHOD,
  type CoverageActionRef,
} from '../src/index.js'

const seed = new Uint8Array(32).fill(73)
const context = '73000000000000000000000000000000'
const now = 1_800_000_000_000
const identity = { namespace: 'https://host.example/surfaces', id: 'native-tools' }
const invocationNamespace = `${identity.namespace}/invocations`
const descriptor = {
  service: 'urn:mcp:',
  operation: 'tools/call',
  resource: { namespace: 'urn:tools:', id: 'write' },
  parameters: { value: 'exact' },
}
const subject = { namespace: 'urn:requests:', id: 'request' }
const execution = { namespace: 'urn:executions:', id: 'execution' }
async function signed(
  args_hash: string,
  event_type = 'https://atrib.dev/v1/types/observation',
  contextId = context,
): Promise<AtribRecord> {
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      event_type,
      creator_key: base64urlEncode(await getPublicKey(seed)),
      chain_root: hashCanonical(context),
      context_id: contextId,
      timestamp: now,
      args_hash,
      signature: '',
    } as AtribRecord,
    seed,
  )
}
async function fixture(
  state: 'captured' | 'skipped' | 'degraded' | 'omitted' = 'captured',
  offset = 0,
  contextId = context,
) {
  const requestBody = {
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    subject,
    assertion: { descriptor, execution },
    source: { kind: 'declared', identity, method: DECLARED_METHOD },
    basis: [],
  }
  const request = await signed(
    commitEvidenceBody('request', requestBody),
    'https://atrib.dev/evidence/v1/request',
    contextId,
  )
  const frames = [1, 2].map((position) => ({
    event_id: `native-${position}`,
    context_id: contextId,
    position: position + offset,
    kind: 'tools/call',
    descriptor,
  }))
  const capturedEvents = await Promise.all(
    frames.map(async (frame) => {
      const claim = {
        subject,
        target: { record_hash: hashCanonical(request) },
        assertion: {
          phase: 'dispatch',
          outcome: 'pending',
          descriptor,
          execution,
          native_invocation: { namespace: invocationNamespace, id: frame.event_id },
          delivery: { namespace: 'urn:deliveries:', id: frame.event_id },
        },
        source: { kind: 'boundary', identity, method: RUNTIME_COVERAGE_METHOD, observed_at: now },
      }
      const payload = {
        nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
        claim,
        authority: [],
        payload: { runtime_event: frame },
      }
      return { record: await signed(hashCanonical(payload), HOST_CAPTURE_TYPE, contextId), payload }
    }),
  )
  const events = frames.map((frame) => ({
    event_id: frame.event_id,
    position: frame.position,
    event_hash: hashCanonical(frame),
    kind: 'tools/call',
  }))
  const logWindowManifest = createLogWindowManifest({
    source: { id: identity.id },
    runtime: { name: 'native-host', version: '1' },
    session: { id: contextId, digest: hashCanonical(contextId) },
    window: { start: 1 + offset, end: 2 + offset },
    events,
    privacy_posture: 'host-owned',
    verifier_policy: { require_event_root: true },
  })
  const actions: CoverageActionRef[] = events.flatMap((event, index) => {
    if (index === 1 && state === 'omitted') return []
    const common = { action_id: event.event_id, surface_id: 'tools', action_hash: event.event_hash }
    return [
      index === 1 && (state === 'skipped' || state === 'degraded')
        ? { ...common, state, reason_code: 'retention-failed' }
        : {
            ...common,
            state: 'captured' as const,
            record_hash: hashCanonical(capturedEvents[index]!.record),
          },
    ]
  })
  const manifest = createCoverageManifest({
    log_window_manifest: logWindowManifest,
    surfaces: [
      {
        id: 'tools',
        boundary: 'native-dispatch',
        owner: 'host',
        required: true,
        action_kinds: ['tools/call'],
      },
    ],
    actions,
  })
  const input = {
    manifest,
    logWindowManifest,
    events,
    surfaceId: 'tools',
    sourceIdentity: identity,
    invocationNamespace,
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    observedAt: now,
    coverageAttestationRecord: await signed(
      hashCoverageAttestationContent(manifest),
      undefined,
      contextId,
    ),
    logWindowRecord: await signed(hashLogWindowManifest(logWindowManifest), undefined, contextId),
    capturedEvents: capturedEvents.filter((_, index) => index === 0 || state === 'captured'),
  }
  const projected = projectCoverageEvidence(input)
  const verify = (
    body = projected.body,
    artifacts = projected.artifacts,
    sourceKeys = [input.logWindowRecord.creator_key],
  ) =>
    runtimeCoverageSourceVerifier.verify({
      record: { context_id: contextId },
      body,
      artifacts,
      sourceKeys,
      evaluatedAt: now,
    })
  const wrapper = capturedEvents[0]!
  const observationBody = {
    ...wrapper.payload.claim,
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    basis: [{ relation: 'source', kind: 'artifact', hash: hashCanonical(wrapper) }],
  }
  const observation = await signed(
    commitEvidenceBody('observation', observationBody),
    'https://atrib.dev/evidence/v1/observation',
    contextId,
  )
  const coverage = await signed(
    commitEvidenceBody('coverage', projected.body),
    'https://atrib.dev/evidence/v1/coverage',
    contextId,
  )
  const rule = (type: string, namespace: string, methods: string[]) => ({
    type,
    signer_keys: [request.creator_key],
    source_keys: [request.creator_key],
    source: identity,
    methods,
    subject_namespace: namespace,
    max_age_ms: 10000,
    authority_versions: [],
    authorized_descriptors: [],
    authority_basis: [],
  })
  const receiverInput = {
    records: [request, observation, coverage],
    openings: new Map([
      [hashCanonical(request), requestBody],
      [hashCanonical(observation), observationBody],
      [hashCanonical(coverage), projected.body],
    ]),
    artifacts: projected.artifacts,
    policy: {
      id: 'bounded-host',
      required: ['coverage'],
      rules: [
        rule(request.event_type, subject.namespace, [DECLARED_METHOD]),
        rule(observation.event_type, subject.namespace, [RUNTIME_COVERAGE_METHOD]),
        rule(coverage.event_type, identity.namespace, [RUNTIME_COVERAGE_METHOD]),
      ],
    },
    evaluation: {
      purpose: 'historical' as const,
      evaluated_at: now,
      dispatch_record: hashCanonical(observation),
    },
    requestHash: hashCanonical(request),
    sourceVerifiers: { [RUNTIME_COVERAGE_METHOD]: runtimeCoverageSourceVerifier },
  }
  return { input, projected, verify, receiverInput, observationBody, observation }
}

describe('D168 coverage evidence projection', () => {
  it('authenticates a complete bounded native inventory independently of captured actions', async () => {
    const { projected, verify } = await fixture()
    expect(projected.body.source.method).toBe(RUNTIME_COVERAGE_METHOD)
    expect(projected.body.assertion).toMatchObject({
      surface: identity,
      start: '0',
      end: '2',
      gaps: [],
      expected: [
        { namespace: invocationNamespace, id: 'native-1' },
        { namespace: invocationNamespace, id: 'native-2' },
      ],
      captured: [
        { namespace: invocationNamespace, id: 'native-1' },
        { namespace: invocationNamespace, id: 'native-2' },
      ],
    })
    expect(await verify()).toMatchObject({
      state: 'supported',
      facts: {
        coverage: {
          surface: identity,
          start: '0',
          end: '2',
          expected: projected.body.assertion.expected,
          captured: projected.body.assertion.captured,
        },
      },
    })
  })

  it('supports exact request coverage using its authenticated native dispatch cursor', async () => {
    const { receiverInput } = await fixture()
    const result = await verifyEvidenceSet(receiverInput)
    expect(result.request?.dimensions.coverage.state).toBe('supported')
    expect(result.request?.reliance.accepted).toBe(true)
  })

  it.each(['observation', 'coverage'] as const)(
    'leaves the native-byte join unresolved when %s hash facts are absent',
    async (kind) => {
      const { receiverInput } = await fixture()
      receiverInput.sourceVerifiers[RUNTIME_COVERAGE_METHOD] = {
        ...runtimeCoverageSourceVerifier,
        async verify(input) {
          const result = await runtimeCoverageSourceVerifier.verify(input)
          if (result.facts) {
            if (kind === 'observation') delete result.facts.native_event_hash
            else if (result.facts.coverage) delete result.facts.coverage.native_events
          }
          return result
        },
      }
      expect((await verifyEvidenceSet(receiverInput)).request?.dimensions.coverage.state).toBe(
        'unresolved',
      )
    },
  )

  it('rejects a different signed native frame that reuses the covered invocation and cursor', async () => {
    const fixture_ = await fixture()
    const { input, receiverInput, observationBody, observation } = fixture_
    const wrapper = structuredClone(input.capturedEvents[0]!)
    wrapper.payload.payload.runtime_event.extra_native_field = 'different transport event'
    wrapper.record = await signed(hashCanonical(wrapper.payload), HOST_CAPTURE_TYPE)
    const hash = hashCanonical(wrapper)
    const body = { ...observationBody, basis: [{ relation: 'source', kind: 'artifact', hash }] }
    const changed = await signed(commitEvidenceBody('observation', body), observation.event_type)
    receiverInput.records[1] = changed
    receiverInput.openings.set(hashCanonical(changed), body)
    receiverInput.artifacts.set(hash, new TextEncoder().encode(canonicalize(wrapper)!))
    receiverInput.evaluation.dispatch_record = hashCanonical(changed)
    const received = await verifyEvidenceSet(receiverInput)
    expect(
      received.statements.find((item) => item.record_hash === hashCanonical(changed))?.dimensions
        .source.state,
    ).toBe('supported')
    expect(received.request?.dimensions.coverage.state).toBe('rejected')
  })

  it('leaves an observation without signed native input unresolved', async () => {
    const { receiverInput, input, observationBody, observation } = await fixture()
    const wrapper = structuredClone(input.capturedEvents[0]!)
    delete wrapper.payload.payload
    wrapper.record = await signed(hashCanonical(wrapper.payload), HOST_CAPTURE_TYPE)
    const hash = hashCanonical(wrapper)
    const body = { ...observationBody, basis: [{ relation: 'source', kind: 'artifact', hash }] }
    const changed = await signed(commitEvidenceBody('observation', body), observation.event_type)
    receiverInput.records[1] = changed
    receiverInput.openings.set(hashCanonical(changed), body)
    receiverInput.artifacts.set(hash, new TextEncoder().encode(canonicalize(wrapper)!))
    receiverInput.evaluation.dispatch_record = hashCanonical(changed)
    expect((await verifyEvidenceSet(receiverInput)).request?.dimensions.coverage.state).toBe(
      'unresolved',
    )
  })

  it('rejects an authenticated inventory for another window with the same invocation IDs', async () => {
    const original = await fixture()
    const other = await fixture('captured', 10)
    const coverage = other.receiverInput.records[2]!
    original.receiverInput.records[2] = coverage
    original.receiverInput.openings.set(hashCanonical(coverage), other.projected.body)
    for (const [hash, bytes] of other.projected.artifacts)
      original.receiverInput.artifacts.set(hash, bytes)
    const received = await verifyEvidenceSet(original.receiverInput)
    expect(
      received.statements.find((item) => item.record_hash === hashCanonical(coverage))?.dimensions
        .coverage.state,
    ).toBe('rejected')
    expect(received.request?.reliance.accepted).toBe(false)
  })

  it('rejects another session inventory that reuses native IDs and cursor positions', async () => {
    const original = await fixture()
    const other = await fixture('captured', 0, '74000000000000000000000000000000')
    const coverage = other.receiverInput.records[2]!
    original.receiverInput.records[2] = coverage
    original.receiverInput.openings.set(hashCanonical(coverage), other.projected.body)
    for (const [hash, bytes] of other.projected.artifacts)
      original.receiverInput.artifacts.set(hash, bytes)
    const received = await verifyEvidenceSet(original.receiverInput)
    expect(
      received.statements.find((item) => item.record_hash === hashCanonical(coverage))?.dimensions
        .source.state,
    ).toBe('supported')
    expect(received.request?.dimensions.coverage.state).toBe('rejected')
  })

  it.each(['skipped', 'degraded', 'omitted'] as const)(
    'rejects %s coverage at the receiver',
    async (state) => {
      const { receiverInput } = await fixture(state)
      expect((await verifyEvidenceSet(receiverInput)).request?.dimensions.coverage.state).toBe(
        'rejected',
      )
    },
  )

  it.each(['skipped', 'degraded', 'omitted'] as const)(
    'retains %s actions as explicit gaps',
    async (state) => {
      const { projected, verify } = await fixture(state)
      expect(projected.body.assertion.expected).toHaveLength(2)
      expect(projected.body.assertion.captured).toHaveLength(1)
      expect(projected.body.assertion.gaps).toHaveLength(1)
      expect(await verify()).toMatchObject({ state: 'supported' })
      const erased = structuredClone(projected.body)
      erased.assertion.gaps = []
      expect(await verify(erased)).toMatchObject({ state: 'rejected' })
    },
  )

  it('leaves withheld authenticated expected provenance unresolved', async () => {
    const { projected, input, verify } = await fixture()
    const artifacts = new Map(projected.artifacts)
    artifacts.delete(hashCanonical(input.events))
    expect(await verify(projected.body, artifacts)).toMatchObject({ state: 'unresolved' })
    artifacts.set(
      hashCanonical(input.events),
      new TextEncoder().encode(JSON.stringify(input.manifest.actions)),
    )
    expect(await verify(projected.body, artifacts)).toMatchObject({ state: 'rejected' })
  })

  it('rejects a changed window or inventory projection', async () => {
    const { projected, verify } = await fixture()
    const body = structuredClone(projected.body)
    body.assertion.end = '3'
    expect(await verify(body)).toMatchObject({ state: 'rejected' })
    body.assertion.end = '2'
    body.assertion.expected.pop()
    expect(await verify(body)).toMatchObject({ state: 'rejected' })
  })

  it('rejects a newer observation time unsupported by the signed coverage attestation', async () => {
    const { projected, verify } = await fixture()
    const body = structuredClone(projected.body)
    body.source.observed_at++
    expect(await verify(body)).toMatchObject({ state: 'rejected' })
  })

  it('rejects an excluded host signer and a changed signed record', async () => {
    const { projected, input, verify } = await fixture()
    expect(await verify(projected.body, projected.artifacts, [])).toMatchObject({
      state: 'rejected',
    })
    const artifacts = new Map(projected.artifacts)
    artifacts.set(
      hashCanonical(input.logWindowRecord),
      new TextEncoder().encode(JSON.stringify({ ...input.logWindowRecord, timestamp: now + 1 })),
    )
    expect(await verify(projected.body, artifacts)).toMatchObject({ state: 'rejected' })
  })

  it('rejects a rehashed invalid source signature and withholds missing captured records', async () => {
    const { input, projected, verify } = await fixture()
    const artifacts = new Map(projected.artifacts)
    const body = structuredClone(projected.body)
    const altered = { ...input.logWindowRecord, signature: 'A'.repeat(86) }
    const oldHash = hashCanonical(input.logWindowRecord),
      hash = hashCanonical(altered)
    body.basis.find((ref) => ref.hash === oldHash)!.hash = hash
    artifacts.set(hash, new TextEncoder().encode(canonicalize(altered)!))
    expect(await verify(body, artifacts)).toMatchObject({ state: 'rejected' })
    const capturedHash = hashCanonical(input.capturedEvents[0])
    const missing = new Map(projected.artifacts)
    missing.delete(capturedHash)
    expect(await verify(projected.body, missing)).toMatchObject({ state: 'unresolved' })
  })

  it('rejects unsupported noncontiguous or string cursor profiles', async () => {
    const { input } = await fixture()
    expect(() =>
      projectCoverageEvidence({
        ...input,
        events: [input.events[0]!, { ...input.events[1]!, position: 3 }],
      }),
    ).toThrow()
    expect(() =>
      projectCoverageEvidence({
        ...input,
        events: input.events.map((event) => ({ ...event, position: String(event.position) })),
      }),
    ).toThrow()
    expect(runtimeCoverageSourceVerifier.compareCursors?.('2', '10')).toBeLessThan(0)
    expect(runtimeCoverageSourceVerifier.compareCursors?.('02', '2')).toBeUndefined()
  })
})
