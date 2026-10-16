// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  getPublicKey,
  signRecord,
  commitEvidenceBody,
  DECLARED_METHOD,
  EVIDENCE_TYPES,
  type AtribRecord,
  type StrictMirrorUnit,
  evidenceBodySchemas,
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
  COVERAGE_MANIFEST_SCHEMA,
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
  signingKey: Uint8Array = seed,
): Promise<AtribRecord> {
  return signRecord(
    {
      spec_version: 'atrib/1.0',
      event_type,
      creator_key: base64urlEncode(await getPublicKey(signingKey)),
      chain_root: hashCanonical(context),
      context_id: contextId,
      timestamp: now,
      args_hash,
      signature: '',
    } as AtribRecord,
    signingKey,
  )
}
async function fixture(
  state: 'captured' | 'skipped' | 'degraded' | 'omitted' = 'captured',
  offset = 0,
  contextId = context,
  options: {
    count?: number
    captureKey?: Uint8Array
    alter?: (unit: StrictMirrorUnit) => void | Promise<void>
    nativeSchema?: string
  } = {},
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
  const frames = Array.from({ length: options.count ?? 2 }, (_, index) => index + 1).map(
    (position) => ({
      event_id: `native-${position}`,
      context_id: contextId,
      position: position + offset,
      kind: 'tools/call',
      descriptor,
      ...(options.nativeSchema ? { schema: options.nativeSchema } : {}),
    }),
  )
  const capturedEvents = await Promise.all(
    frames.map(async (frame) => {
      const claim = {
        subject,
        target: { record_hash: hashCanonical(request) },
        assertion: {
          phase: 'dispatch' as const,
          outcome: 'pending' as const,
          descriptor,
          execution,
          native_invocation: { namespace: invocationNamespace, id: frame.event_id },
          delivery: { namespace: 'urn:deliveries:', id: frame.event_id },
        },
        source: {
          kind: 'boundary' as const,
          identity,
          method: RUNTIME_COVERAGE_METHOD,
          observed_at: now,
        },
      }
      const bytes = new TextEncoder().encode(canonicalize(frame)!)
      const hash = hashCanonical(frame)
      const opening = {
        nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
        ...claim,
        basis: [{ relation: 'source' as const, kind: 'artifact' as const, hash }],
      }
      return {
        record: await signed(
          commitEvidenceBody('observation', opening),
          EVIDENCE_TYPES.observation,
          contextId,
          options.captureKey,
        ),
        opening,
        artifacts: [{ hash, bytes }],
      }
    }),
  )
  if (options.alter) await options.alter(capturedEvents[0]!)
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
    window: { start: 1 + offset, end: frames.length + offset },
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
  const { record: observation, opening: observationBody } = capturedEvents[0]!
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
    openings: new Map<string, unknown>([
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
        claim: {
          assertion: {
            surface: identity,
            start: '0',
            end: '2',
            expected: projected.body.assertion.expected,
            captured: projected.body.assertion.captured,
          },
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
            else delete result.facts.native_events
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
    const frame = JSON.parse(new TextDecoder().decode(input.capturedEvents[0]!.artifacts[0]!.bytes))
    frame.extra_native_field = 'different transport event'
    const hash = hashCanonical(frame)
    const body = { ...observationBody, basis: [{ relation: 'source', kind: 'artifact', hash }] }
    const changed = await signed(commitEvidenceBody('observation', body), observation.event_type)
    receiverInput.records[1] = changed
    receiverInput.openings.set(hashCanonical(changed), body)
    receiverInput.artifacts.set(hash, new TextEncoder().encode(canonicalize(frame)!))
    receiverInput.evaluation.dispatch_record = hashCanonical(changed)
    const received = await verifyEvidenceSet(receiverInput)
    expect(
      received.statements.find((item) => item.record_hash === hashCanonical(changed))?.dimensions
        .source.state,
    ).toBe('supported')
    expect(received.request?.dimensions.coverage.state).toBe('rejected')
  })

  it('leaves an observation without signed native input unresolved', async () => {
    const { receiverInput, input } = await fixture()
    receiverInput.artifacts.delete(input.capturedEvents[0]!.artifacts[0]!.hash)
    expect((await verifyEvidenceSet(receiverInput)).request?.dimensions.coverage.state).toBe(
      'unresolved',
    )
  })

  it.each(['missing', 'invalid', 'invalid-with-missing-disclosure'] as const)(
    'preserves %s native binding frame status at the receiver',
    async (condition) => {
      const { input, receiverInput } = await fixture()
      const frameHash = input.capturedEvents[1]!.artifacts[0]!.hash
      if (condition === 'missing') receiverInput.artifacts.delete(frameHash)
      else receiverInput.artifacts.set(frameHash, new TextEncoder().encode('malformed'))
      if (condition === 'invalid-with-missing-disclosure') {
        const disclosure = receiverInput.records[2]!
        const body = evidenceBodySchemas.coverage.parse(
          receiverInput.openings.get(hashCanonical(disclosure)),
        )
        const group = body.basis.find(
          (ref) =>
            ref.relation === 'captured' &&
            Array.isArray(
              JSON.parse(new TextDecoder().decode(receiverInput.artifacts.get(ref.hash)!)),
            ),
        )!
        receiverInput.artifacts.delete(group.hash)
      }
      const received = await verifyEvidenceSet(receiverInput)
      const coverage = received.statements.find(
        (statement) => statement.record_hash === hashCanonical(receiverInput.records[2]!),
      )!
      expect(coverage.dimensions.source.state).toBe(
        condition === 'missing' ? 'unresolved' : 'rejected',
      )
      if (condition !== 'missing')
        expect(coverage.dimensions.source.reasons).toContain('dependency_invalid')
      expect(received.request?.reliance.accepted).toBe(false)
    },
  )

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
    const capturedHash = hashCanonical(
      input.capturedEvents.map(({ record, opening }) => ({ record, opening })),
    )
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
  it('supports 128 independently authenticated captures without exceeding the basis limit', async () => {
    const { projected, verify } = await fixture('captured', 0, context, { count: 128 })
    expect(projected.body.basis.length).toBeLessThanOrEqual(256)
    expect(await verify()).toMatchObject({ state: 'supported' })
  })
  it('bounds raw captured references before emitting coverage', async () => {
    const { input } = await fixture()
    const basis = input.capturedEvents[0]!.opening.basis
    for (let index = 0; index < 248; index++)
      basis.push({ relation: 'source', kind: 'artifact', hash: hashCanonical(`frame-${index}`) })
    expect(projectCoverageEvidence(input).body.basis).toHaveLength(256)
    basis.push({ relation: 'source', kind: 'artifact', hash: hashCanonical('frame-over-limit') })
    expect(() => projectCoverageEvidence(input)).toThrow('coverage_artifact_limit')
  })
  it('keeps native schema fields separate from the committed coverage manifest', async () => {
    const { verify } = await fixture('captured', 0, context, {
      nativeSchema: COVERAGE_MANIFEST_SCHEMA,
    })
    expect(await verify()).toMatchObject({ state: 'supported' })
  })
  it('splits disclosures at the exact 1 MiB artifact boundary', async () => {
    const { projected, verify, input } = await fixture('captured', 0, context, {
      async alter(unit) {
        unit.record.tool_name = ''
        const size = new TextEncoder().encode(
          canonicalize([{ record: unit.record, opening: unit.opening }])!,
        ).length
        unit.record.tool_name = 'x'.repeat(1_048_576 - size)
        Object.assign(unit.record, await signRecord(unit.record, seed))
      },
    })
    const groups = projected.body.basis
      .filter((ref) => ref.relation === 'captured')
      .map((ref) => projected.artifacts.get(ref.hash)!)
      .filter((bytes) => Array.isArray(JSON.parse(new TextDecoder().decode(bytes))))
    expect(groups).toHaveLength(2)
    expect(groups[0]!.length).toBe(1_048_576)
    expect(await verify()).toMatchObject({ state: 'supported' })
    input.capturedEvents[0]!.record.tool_name += 'x'
    expect(() => projectCoverageEvidence(input)).toThrow('coverage_artifact_limit')
  })
  it('distinguishes a missing captured opening from a malformed present opening', async () => {
    const { projected, verify } = await fixture()
    const ref = projected.body.basis.find(
      (ref) =>
        ref.relation === 'captured' &&
        Array.isArray(JSON.parse(new TextDecoder().decode(projected.artifacts.get(ref.hash)!))),
    )!
    const group = JSON.parse(new TextDecoder().decode(projected.artifacts.get(ref.hash)!))
    for (const missing of [true, false]) {
      if (missing) delete group[0].opening
      else group[0].opening = null
      const bytes = new TextEncoder().encode(canonicalize(group)!)
      ref.hash = hashCanonical(group)
      projected.artifacts.set(ref.hash, bytes)
      expect(await verify()).toMatchObject({ state: missing ? 'unresolved' : 'rejected' })
    }
  })
  it.each(['result_hash', 'context', 'timestamp', 'phase', 'method'] as const)(
    'rejects a signed captured %s mismatch',
    async (field) => {
      const { verify } = await fixture('captured', 0, context, {
        async alter(unit) {
          const body = evidenceBodySchemas.observation.options[0].parse(unit.opening)
          if (field === 'result_hash') unit.record.result_hash = `sha256:${'1'.repeat(64)}`
          if (field === 'context') unit.record.context_id = 'f'.repeat(32)
          if (field === 'timestamp') unit.record.timestamp++
          if (field === 'phase') {
            body.assertion.phase = 'response'
            body.assertion.outcome = 'success'
          }
          if (field === 'method') body.source.method = 'urn:another:method'
          Object.assign(unit.opening, body)
          unit.record.args_hash = commitEvidenceBody('observation', body)
          Object.assign(unit.record, await signRecord(unit.record, seed))
        },
      })
      expect(await verify()).toMatchObject({ state: 'rejected' })
    },
  )
  it.each(['position', 'event_id', 'context_id', 'descriptor', 'malformed'] as const)(
    'rejects a signed native %s mismatch',
    async (field) => {
      const { verify } = await fixture('captured', 0, context, {
        async alter(unit) {
          const frame =
            field === 'malformed'
              ? null
              : JSON.parse(new TextDecoder().decode(unit.artifacts[0]!.bytes))
          if (field === 'position') frame.position++
          if (field === 'event_id') frame.event_id = 'other-native-id'
          if (field === 'context_id') frame.context_id = 'f'.repeat(32)
          if (field === 'descriptor') frame.descriptor.parameters = { changed: true }
          const bytes = new TextEncoder().encode(canonicalize(frame)!)
          const hash = hashCanonical(frame)
          Object.assign(unit.artifacts[0]!, { hash, bytes })
          unit.opening.basis[0]!.hash = hash
          unit.record.args_hash = commitEvidenceBody('observation', unit.opening)
          Object.assign(unit.record, await signRecord(unit.record, seed))
        },
      })
      expect(await verify()).toMatchObject({ state: 'rejected' })
    },
  )
  it('checks each captured signer while allowing a separately pinned rotated key', async () => {
    const captureKey = new Uint8Array(32).fill(74)
    const { projected, input, verify } = await fixture('captured', 0, context, { captureKey })
    expect(await verify()).toMatchObject({ state: 'rejected' })
    const keys = [
      input.logWindowRecord.creator_key,
      base64urlEncode(await getPublicKey(captureKey)),
    ]
    expect(await verify(projected.body, projected.artifacts, keys)).toMatchObject({
      state: 'supported',
    })
  })
  it.each(['signature', 'opening'] as const)(
    'rejects a captured own %s mismatch under a valid coverage signer',
    async (field) => {
      const { verify } = await fixture('captured', 0, context, {
        alter(unit) {
          if (field === 'signature') unit.record.signature = 'A'.repeat(86)
          else unit.opening.subject.id = 'different-subject'
        },
      })
      expect(await verify()).toMatchObject({ state: 'rejected' })
    },
  )
})
