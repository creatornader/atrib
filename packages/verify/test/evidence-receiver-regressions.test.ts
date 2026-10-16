// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { z } from 'zod'
import {
  commitEvidenceBody,
  signRecord,
  evidenceBodySchemas,
  evaluationSchema,
  policySchema,
  DECLARED_METHOD,
  type EvidenceBody,
} from '@atrib/mcp'
import { verifyEvidenceSet, type EvidenceSourceVerifier } from '../src/evidence-statements.js'
import { loadSourceBoundFixture } from './source-bound-corpus.js'
import { digest, fixtureSourceVerifier, SNAPSHOT_METHOD } from './source-bound-reference.js'

const fixtureRecordSchema = z.looseObject({
  spec_version: z.literal('atrib/1.0'),
  creator_key: z.string(),
  chain_root: z.string(),
  event_type: z.string(),
  context_id: z.string(),
  timestamp: z.number(),
  args_hash: z.string(),
  signature: z.string(),
})
type FixtureRecord = z.infer<typeof fixtureRecordSchema>
const sourceWrapperSchema = z.looseObject({
  payload: z.record(z.string(), z.unknown()),
  signer_key: z.string(),
  signature: z.string(),
})
function fixture(name = 'C01-complete') {
  const { input } = loadSourceBoundFixture(
    join(__dirname, '../../../spec/conformance/1.12/cases', `${name}.json`),
  )
  const sourceVerifiers: Record<string, EvidenceSourceVerifier> = {
    [SNAPSHOT_METHOD]: fixtureSourceVerifier,
  }
  return {
    records: input.records.map((record) => fixtureRecordSchema.parse(record)),
    openings: new Map(Object.entries(input.openings)),
    artifacts: new Map(
      Object.entries(input.artifacts).map(([hash, bytes]) => [hash, Buffer.from(bytes, 'base64')]),
    ),
    policy: policySchema.parse(input.policy),
    evaluation: evaluationSchema.parse(input.evaluation),
    requestHash: input.request_hash!,
    sourceVerifiers,
  }
}
type Input = ReturnType<typeof fixture>
const openingOf = (input: Input, record: FixtureRecord) => input.openings.get(digest(record))
const executionBodyOf = (input: Input, record: FixtureRecord) =>
  evidenceBodySchemas.observation.options[0].parse(openingOf(input, record))
const authorizationBodyOf = (input: Input, record: FixtureRecord) =>
  evidenceBodySchemas.authorization.parse(openingOf(input, record))
const dispatchOf = (input: Input) =>
  input.records.find(
    (record) =>
      record.event_type === 'https://atrib.dev/evidence/v1/observation' &&
      executionBodyOf(input, record).assertion.phase === 'dispatch',
  )!
async function seedFor(key: string) {
  for (let n = 1; n <= 8; n++) {
    const seed = new Uint8Array(32).fill(n)
    if (Buffer.from(await ed.getPublicKeyAsync(seed)).toString('base64url') === key) return seed
  }
  throw new Error('unknown public fixture key')
}
async function addStatement(input: Input, original: FixtureRecord, body: EvidenceBody) {
  const record = await signRecord(
    { ...original, args_hash: digest(body) },
    await seedFor(original.creator_key),
  )
  const parsed = fixtureRecordSchema.parse(record)
  input.records.push(parsed)
  input.openings.set(digest(record), body)
  return parsed
}
async function addObservation(input: Input, original: FixtureRecord, body: EvidenceBody) {
  for (const ref of body.basis.filter(
    (ref) => ref.kind === 'artifact' && ref.relation === 'source',
  )) {
    const parsed = sourceWrapperSchema.safeParse(
      JSON.parse(input.artifacts.get(ref.hash)!.toString('utf8')),
    )
    if (!parsed.success) continue
    const wrapper = parsed.data
    wrapper.payload.claim = Object.fromEntries(
      Object.entries(body).filter(([key]) => !['nonce', 'basis'].includes(key)),
    )
    wrapper.payload.authority = body.basis
      .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
      .map((ref) => ref.hash)
      .sort()
    wrapper.signature = Buffer.from(
      await ed.signAsync(
        new TextEncoder().encode(canonicalize(wrapper.payload)!),
        await seedFor(wrapper.signer_key),
      ),
    ).toString('base64url')
    ref.hash = digest(wrapper)
    input.artifacts.set(ref.hash, Buffer.from(canonicalize(wrapper)!))
  }
  return addStatement(input, original, body)
}

describe('receiver finding regressions', () => {
  it('rejects a normalized claim that differs from its opened assertion', async () => {
    const input = fixture()
    input.sourceVerifiers[SNAPSHOT_METHOD] = {
      ...fixtureSourceVerifier,
      async verify(args) {
        const result = await fixtureSourceVerifier.verify(args)
        if (result.facts && args.record.event_type === 'https://atrib.dev/evidence/v1/effect')
          result.facts.claim = { ...result.facts.claim, assertion: { state: 'invented' } }
        return result
      },
    }
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.effect.state).toBe('unresolved')
    expect(result.request!.reliance.accepted).toBe(false)
  })
  it('preserves a custom source signed by a separate pinned key', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const body = executionBodyOf(input, dispatch)
    const ref = body.basis.find((ref) => ref.relation === 'source' && ref.kind === 'artifact')!
    const wrapper = sourceWrapperSchema.parse(
      JSON.parse(input.artifacts.get(ref.hash)!.toString('utf8')),
    )
    const sourceSeed = new Uint8Array(32).fill(8)
    wrapper.signer_key = Buffer.from(await ed.getPublicKeyAsync(sourceSeed)).toString('base64url')
    wrapper.signature = Buffer.from(
      await ed.signAsync(new TextEncoder().encode(canonicalize(wrapper.payload)!), sourceSeed),
    ).toString('base64url')
    ref.hash = digest(wrapper)
    input.artifacts.set(ref.hash, Buffer.from(canonicalize(wrapper)!))
    const rule = input.policy.rules.find((rule) => rule.type === dispatch.event_type)!
    rule.source_keys.push(wrapper.signer_key)
    input.records = input.records.filter((record) => record !== dispatch)
    const changed = await addStatement(input, dispatch, body)
    input.evaluation = {
      purpose: 'historical',
      evaluated_at: input.evaluation.evaluated_at,
      dispatch_record: digest(changed),
    }
    expect(wrapper.signer_key).not.toBe(dispatch.creator_key)
    expect((await verifyEvidenceSet(input)).request!.reliance.accepted).toBe(true)
    rule.source_keys = rule.source_keys.filter((key) => key !== wrapper.signer_key)
    expect((await verifyEvidenceSet(input)).request!.dimensions.source.state).toBe('rejected')
  })
  it.each(['signature_invalid', 'opening_mismatch'] as const)(
    'preserves %s as the selected source failure',
    async (reason) => {
      const input = fixture()
      const dispatch = dispatchOf(input)
      const body = executionBodyOf(input, dispatch)
      if (reason === 'signature_invalid') {
        input.records = input.records.filter((record) => record !== dispatch)
        const forged = { ...dispatch, signature: Buffer.alloc(64, 9).toString('base64url') }
        input.records.push(forged)
        input.openings.set(digest(forged), body)
        input.evaluation = {
          ...input.evaluation,
          purpose: 'historical',
          dispatch_record: digest(forged),
        }
      } else {
        body.assertion.descriptor.operation = 'changed'
        input.openings.set(digest(dispatch), body)
      }
      const result = await verifyEvidenceSet(input)
      expect(result.request!.dimensions.source).toMatchObject({
        state: 'rejected',
        reasons: [reason],
      })
    },
  )
  it('retains selected dispatch trust rejection instead of reporting a missing dependency', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    input.policy.rules = input.policy.rules.filter((rule) => rule.type !== dispatch.event_type)
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.source).toMatchObject({
      state: 'rejected',
      reasons: ['source_untrusted'],
    })
  })
  it('keeps a missing selected dispatch unresolved', async () => {
    const input = fixture()
    input.evaluation = {
      purpose: 'historical',
      evaluated_at: input.evaluation.evaluated_at,
      dispatch_record: `sha256:${'f'.repeat(64)}`,
    }
    expect((await verifyEvidenceSet(input)).request!.dimensions.source).toMatchObject({
      state: 'unresolved',
      reasons: ['dependency_missing'],
    })
  })
  it.each(['missing', 'invalid', 'invalid-with-missing-disclosure'] as const)(
    'preserves %s binding artifact status before invoking the synthetic source verifier',
    async (condition) => {
      const input = fixture()
      const dispatch = dispatchOf(input)
      const body = executionBodyOf(input, dispatch)
      const binding = { native_binding: 'required' }
      const bindingHash = digest(binding)
      const disclosureHash = digest({ disclosure: 'optional' })
      body.basis.push(
        { relation: 'binding', kind: 'artifact', hash: bindingHash },
        { relation: 'captured', kind: 'artifact', hash: disclosureHash },
      )
      input.records = input.records.filter((record) => record !== dispatch)
      const changed = await addObservation(input, dispatch, body)
      input.evaluation = {
        purpose: 'historical',
        evaluated_at: input.evaluation.evaluated_at,
        dispatch_record: digest(changed),
      }
      input.sourceVerifiers[SNAPSHOT_METHOD] = {
        ...fixtureSourceVerifier,
        verify: (args) =>
          args.artifacts.has(bindingHash)
            ? fixtureSourceVerifier.verify(args)
            : Promise.resolve({ state: 'unresolved', reasons: ['dependency_missing'], basis: [] }),
      }
      if (condition !== 'missing') input.artifacts.set(bindingHash, Buffer.from('malformed'))
      if (condition !== 'invalid-with-missing-disclosure')
        input.artifacts.set(disclosureHash, Buffer.from(canonicalize({ disclosure: 'optional' })!))
      const result = await verifyEvidenceSet(input)
      const source = result.statements.find(
        (statement) => statement.record_hash === digest(changed),
      )!.dimensions.source
      expect(source.state).toBe(condition === 'missing' ? 'unresolved' : 'rejected')
      expect(source.reasons).toContain(
        condition === 'missing' ? 'dependency_missing' : 'dependency_invalid',
      )
      expect(result.request!.reliance.accepted).toBe(false)
    },
  )
  it.each(['scope', 'time'] as const)(
    'does not count an allow with invalid %s as contrary to an applicable deny',
    async (failure) => {
      const input = fixture()
      input.records = input.records.filter(
        (record) =>
          !['observation', 'effect'].some(
            (kind) => record.event_type === `https://atrib.dev/evidence/v1/${kind}`,
          ),
      )
      input.evaluation = { purpose: 'current', evaluated_at: input.evaluation.evaluated_at }
      const allow = input.records.find(
        (record) => record.event_type === 'https://atrib.dev/evidence/v1/authorization',
      )!
      const denyBody = authorizationBodyOf(input, allow)
      denyBody.assertion.decision = 'deny'
      await addStatement(input, allow, denyBody)
      const invalid = authorizationBodyOf(input, allow)
      let issuer = allow
      if (failure === 'time') invalid.assertion.expires_at = input.evaluation.evaluated_at
      else {
        const key = Buffer.from(await ed.getPublicKeyAsync(new Uint8Array(32).fill(8))).toString(
          'base64url',
        )
        issuer = { ...allow, creator_key: key }
        const rule = structuredClone(
          input.policy.rules.find((rule) => rule.type === allow.event_type)!,
        )
        rule.signer_keys = [key]
        rule.authorized_descriptors = [
          { ...rule.authorized_descriptors[0]!, operation: 'outside-approved-scope' },
        ]
        input.policy.rules.push(rule)
      }
      input.records = input.records.filter((record) => record !== allow)
      await addStatement(input, issuer, invalid)
      expect((await verifyEvidenceSet(input)).request!.dimensions.authority.state).toBe('rejected')
    },
  )
  it('counts an applicable deny as contrary to an applicable allow', async () => {
    const input = fixture()
    input.records = input.records.filter(
      (record) =>
        !['observation', 'effect'].some(
          (kind) => record.event_type === `https://atrib.dev/evidence/v1/${kind}`,
        ),
    )
    input.evaluation = { purpose: 'current', evaluated_at: input.evaluation.evaluated_at }
    const allow = input.records.find(
      (record) => record.event_type === 'https://atrib.dev/evidence/v1/authorization',
    )!
    const body = authorizationBodyOf(input, allow)
    body.assertion.decision = 'deny'
    await addStatement(input, allow, body)
    expect((await verifyEvidenceSet(input)).request!.dimensions.authority.state).toBe('conflict')
  })
  it.each(['request', 'authorization', 'report'] as const)(
    'rejects declared %s source timestamps in the producer grammar and receiver integrity',
    async (kind) => {
      const input = fixture()
      const request = input.records.find(
        (record) => record.event_type === `https://atrib.dev/evidence/v1/${kind}`,
      )!
      const body = evidenceBodySchemas[kind].parse(openingOf(input, request))
      body.source.observed_at = input.evaluation.evaluated_at
      const signed = await addStatement(input, request, body)
      const result = await verifyEvidenceSet(input)
      expect(
        result.statements.find((statement) => statement.record_hash === digest(signed))!.dimensions
          .integrity.body,
      ).toMatchObject({ state: 'rejected', reasons: ['schema_invalid'] })
      expect(() => commitEvidenceBody(kind, body)).toThrow()
    },
  )
  it('allows explicitly requested integrity-only reliance without source trust or authority', async () => {
    const input = fixture()
    input.policy = { id: 'integrity-only', rules: [], required: [] }
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.source.state).toBe('rejected')
    expect(result.request!.dimensions.authority.state).not.toBe('supported')
    expect(result.request!.reliance).toEqual({ accepted: true, deficient: [] })
  })
  it('conflicts on different native invocations claimed for one source delivery', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const body = executionBodyOf(input, dispatch)
    body.assertion.native_invocation.id = 'different-native-invocation'
    await addObservation(input, dispatch, body)
    expect((await verifyEvidenceSet(input)).request!.dimensions.binding).toMatchObject({
      state: 'conflict',
      reasons: ['source_conflict'],
    })
  })
  it('conflicts on different executions claimed for one source native invocation across deliveries', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const body = executionBodyOf(input, dispatch)
    body.assertion.delivery.id = 'other-delivery'
    body.assertion.execution.id = 'other-execution'
    await addObservation(input, dispatch, body)
    expect((await verifyEvidenceSet(input)).request!.dimensions.binding).toMatchObject({
      state: 'conflict',
      reasons: ['execution_mismatch'],
    })
  })
  it('keeps the same scoped occurrence IDs from another trusted source separate', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const body = executionBodyOf(input, dispatch)
    const originalSource = structuredClone(body.source.identity)
    body.source.identity.id = 'other-source'
    body.assertion.execution.id = 'other-execution'
    const rule = structuredClone(
      input.policy.rules.find(
        (rule) =>
          rule.type === dispatch.event_type &&
          canonicalize(rule.source) === canonicalize(originalSource),
      )!,
    )
    rule.source = body.source.identity
    input.policy.rules.push(rule)
    await addObservation(input, dispatch, body)
    expect((await verifyEvidenceSet(input)).request!.dimensions.binding.state).toBe('supported')
  })
  it('preserves legitimate redelivery of the same native invocation', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const body = executionBodyOf(input, dispatch)
    body.assertion.delivery.id = 'redelivery'
    await addObservation(input, dispatch, body)
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.binding.state).toBe('supported')
    expect(result.request!.execution.deliveries).toHaveLength(2)
  })
  it('supports the synthetic source method authenticated native membership', async () => {
    const input = fixture('coverage-complete')
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.coverage.state).toBe('supported')
    expect(result.request!.reliance.accepted).toBe(true)
  })
  it.each([true, false])(
    'uses the observation method single-destination promise (%s) for effect conflicts',
    async (singleDestination) => {
      const input = fixture()
      const effectMethod = 'https://atrib.dev/conformance/method/destination-query-v1'
      input.sourceVerifiers[SNAPSHOT_METHOD] = {
        ...fixtureSourceVerifier,
        singleDestinationPerDelivery: singleDestination,
      }
      input.sourceVerifiers[effectMethod] = {
        ...fixtureSourceVerifier,
        singleDestinationPerDelivery: !singleDestination,
      }
      const effect = input.records.find(
        (record) => record.event_type === 'https://atrib.dev/evidence/v1/effect',
      )!
      const originalEffect = evidenceBodySchemas.effect.parse(openingOf(input, effect))
      input.records = input.records.filter((record) => record !== effect)
      input.policy.rules.find((rule) => rule.type === effect.event_type)!.methods = [effectMethod]
      originalEffect.source.method = effectMethod
      await addObservation(input, effect, originalEffect)
      const response = input.records.find(
        (record) =>
          record.event_type === 'https://atrib.dev/evidence/v1/observation' &&
          executionBodyOf(input, record).assertion.phase === 'response',
      )!
      const otherResponse = executionBodyOf(input, response)
      otherResponse.assertion.destination_request!.id = 'second-destination-request'
      const changedResponse = await addObservation(input, response, otherResponse)
      const secondEffect = evidenceBodySchemas.effect.parse(openingOf(input, effect))
      secondEffect.source.method = effectMethod
      secondEffect.assertion.binding = {
        observation_record: digest(changedResponse),
        destination_request: otherResponse.assertion.destination_request!,
      }
      await addObservation(input, effect, secondEffect)
      const result = await verifyEvidenceSet(input)
      expect(result.request!.dimensions.binding.state).toBe(
        singleDestination ? 'conflict' : 'supported',
      )
      expect(result.request!.dimensions.effect.state).toBe(
        singleDestination ? 'conflict' : 'supported',
      )
    },
  )
  it.each([true, false])(
    'compares response destination IDs when dispatch has none and the method promise is %s',
    async (singleDestination) => {
      const input = fixture('F11-single-destination-without-dispatch-id')
      expect(
        executionBodyOf(input, dispatchOf(input)).assertion.destination_request,
      ).toBeUndefined()
      for (const method of input.policy.rules.flatMap((rule) => rule.methods))
        if (method !== DECLARED_METHOD)
          input.sourceVerifiers[method] = {
            ...fixtureSourceVerifier,
            singleDestinationPerDelivery: method === SNAPSHOT_METHOD && singleDestination,
          }
      const result = await verifyEvidenceSet(input)
      expect(result.request!.dimensions.binding).toMatchObject({
        state: singleDestination ? 'conflict' : 'supported',
        reasons: singleDestination ? ['source_conflict'] : [],
      })
      expect(result.request!.dimensions.effect.state).toBe(
        singleDestination ? 'conflict' : 'supported',
      )
    },
  )
  it.each(['different-method', 'unknown-comparison'] as const)(
    'leaves coverage membership unresolved for %s',
    async (scenario) => {
      const input = fixture('coverage-complete')
      const coverage = input.records.find(
        (record) => record.event_type === 'https://atrib.dev/evidence/v1/coverage',
      )!
      let coverageHash = digest(coverage)
      if (scenario === 'unknown-comparison')
        input.sourceVerifiers[SNAPSHOT_METHOD] = {
          ...fixtureSourceVerifier,
          compareCursors: () => undefined,
        }
      else {
        const method = 'https://atrib.dev/conformance/method/other-cursor-contract-v1'
        const body = evidenceBodySchemas.coverage.parse(openingOf(input, coverage))
        body.source.method = method
        input.policy.rules.find((rule) => rule.type === coverage.event_type)!.methods = [method]
        input.sourceVerifiers[method] = fixtureSourceVerifier
        input.records = input.records.filter((record) => record !== coverage)
        coverageHash = digest(await addObservation(input, coverage, body))
      }
      const result = await verifyEvidenceSet(input)
      expect(
        result.statements.find((statement) => statement.record_hash === coverageHash)!.dimensions
          .coverage,
      ).toMatchObject({ state: 'unresolved', reasons: ['dependency_missing'] })
    },
  )
  it('reports a correctly signed future timestamp as a schema failure', async () => {
    const input = fixture()
    const request = input.records.find(
      (record) => record.event_type === 'https://atrib.dev/evidence/v1/request',
    )!
    const body = evidenceBodySchemas.request.parse(openingOf(input, request))
    const future = await addStatement(
      input,
      { ...request, timestamp: input.evaluation.evaluated_at + 400_000 },
      body,
    )
    input.requestHash = digest(future)
    const result = await verifyEvidenceSet(input)
    expect(result.request!.dimensions.integrity.record).toMatchObject({
      state: 'rejected',
      reasons: ['schema_invalid'],
    })
  })
  it.each([
    ['not-an-absolute-uri', 'rejected', ['schema_invalid']],
    ['urn:example:unknown-evidence', 'supported', []],
  ] as const)(
    'classifies the signed event type %s independently of its signature',
    async (eventType, state, reasons) => {
      const input = fixture()
      const request = input.records.find(
        (record) => record.event_type === 'https://atrib.dev/evidence/v1/request',
      )!
      const body = evidenceBodySchemas.request.parse(openingOf(input, request))
      const signed = await addStatement(input, { ...request, event_type: eventType }, body)
      const result = await verifyEvidenceSet(input)
      const integrity = result.statements.find(
        (statement) => statement.record_hash === digest(signed),
      )!.dimensions.integrity
      expect(integrity.record).toMatchObject({ state, reasons })
      expect(integrity.body).toMatchObject({ state: 'unresolved', reasons: ['unknown_type'] })
    },
  )
  it('deduplicates repeated signed records and delivery basis independently of object key order', async () => {
    const input = fixture()
    const expected = await verifyEvidenceSet(input)
    input.records.push(
      ...input.records.map((record) =>
        fixtureRecordSchema.parse(Object.fromEntries(Object.entries(record).reverse())),
      ),
    )
    expect(await verifyEvidenceSet(input)).toEqual(expected)
  })
  it('keeps tampered record bytes separate from their valid signed record in either input order', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const tampered = { ...dispatch, signature: Buffer.alloc(64, 4).toString('base64url') }
    input.records.push(tampered)
    input.openings.set(digest(tampered), openingOf(input, dispatch))
    const forward = await verifyEvidenceSet(input)
    input.records.reverse()
    expect(await verifyEvidenceSet(input)).toEqual(forward)
    expect(
      forward.statements.find((statement) => statement.record_hash === digest(dispatch))!.dimensions
        .integrity.record.state,
    ).toBe('supported')
    expect(
      forward.statements.find((statement) => statement.record_hash === digest(tampered))!.dimensions
        .integrity.record,
    ).toMatchObject({ state: 'rejected', reasons: ['signature_invalid'] })
  })
  it('rejects a historical authority citation to a present non-authorization record', async () => {
    const input = fixture()
    const dispatch = dispatchOf(input)
    const body = executionBodyOf(input, dispatch)
    body.basis = body.basis.map((ref) =>
      ref.relation === 'authority' && ref.kind === 'record'
        ? { ...ref, hash: input.requestHash }
        : ref,
    )
    const changed = await addObservation(input, dispatch, body)
    input.evaluation = {
      purpose: 'historical',
      evaluated_at: input.evaluation.evaluated_at,
      dispatch_record: digest(changed),
    }
    expect((await verifyEvidenceSet(input)).request!.dimensions.authority).toMatchObject({
      state: 'rejected',
      reasons: ['dependency_invalid'],
    })
  })
})
