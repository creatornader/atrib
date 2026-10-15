// SPDX-License-Identifier: Apache-2.0
// Public fixture seeds only. These regressions exercise the offline model.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ed from '@noble/ed25519'
import { signRecord, verifyRecord as verifySignature, type AtribRecord } from '@atrib/mcp'
import { describe, expect, it } from 'vitest'
import {
  digest,
  evaluateEvidenceFixture,
  jcs,
  type FixtureInput,
} from './source-bound-reference.js'
import { DECLARED_METHOD, type EvidencePolicy } from './source-bound-schemas.js'

type Obj = Record<string, unknown>
type ScopedId = { namespace: string; id: string }
type Ref = { relation: string; kind: string; hash: string }
// Test bodies intentionally permit invalid kind/version mutations.
type TestBody = {
  nonce: string
  subject: ScopedId
  target: { record_hash: string }
  source: { kind: string; method: string; observed_at?: number }
  basis: Ref[]
  assertion: {
    phase?: string
    descriptor: { resource: ScopedId }
    object: unknown
    state: unknown
    payload_hash: string
    version: { kind: string; value: string }
  }
}
type SourceWrapper = { payload: Obj; signer_key: string; signature: string }
const root = join(__dirname, '../../../spec/conformance/1.12/cases')
const load = (name = 'C01-complete'): FixtureInput =>
  JSON.parse(readFileSync(join(root, `${name}.json`), 'utf8')).input
const bodyOf = (input: FixtureInput, record: Obj): TestBody =>
  input.openings[digest(record)] as TestBody
const find = (input: FixtureInput, kind: string, phase?: string): Obj => {
  const record = input.records.find(
    (record) =>
      record.event_type === `https://atrib.dev/evidence/v1/${kind}` &&
      (!phase || bodyOf(input, record).assertion.phase === phase),
  )
  if (!record) throw new Error(`Missing fixture statement: ${kind}/${phase ?? ''}`)
  return record
}
const artifact = (input: FixtureInput, value: unknown): string => {
  const hash = digest(value)
  input.artifacts[hash] = Buffer.from(jcs(value)).toString('base64')
  return hash
}
async function seedFor(key: string): Promise<Uint8Array> {
  for (let index = 1; index <= 6; index++) {
    const seed = new Uint8Array(32).fill(index)
    if (Buffer.from(await ed.getPublicKeyAsync(seed)).toString('base64url') === key) return seed
  }
  throw new Error('Key is not a public corpus fixture key')
}
async function seal(
  input: FixtureInput,
  record: Obj,
  body: TestBody,
  append = false,
): Promise<string> {
  // Reauthenticate the actual mutated claim, rather than retaining a stale proof.
  for (const ref of body.basis.filter(
    (ref) => ref.relation === 'source' && ref.kind === 'artifact',
  )) {
    const wrapper = JSON.parse(
      Buffer.from(input.artifacts[ref.hash]!, 'base64').toString('utf8'),
    ) as SourceWrapper
    if (!wrapper.payload || !wrapper.signer_key) continue
    wrapper.payload.claim = Object.fromEntries(
      Object.entries(body).filter(([key]) => !['nonce', 'basis'].includes(key)),
    )
    wrapper.payload.authority = body.basis
      .filter((entry) => entry.relation === 'authority' && entry.kind === 'record')
      .map((entry) => entry.hash)
      .sort()
    wrapper.signature = Buffer.from(
      await ed.signAsync(
        new TextEncoder().encode(jcs(wrapper.payload)),
        await seedFor(wrapper.signer_key),
      ),
    ).toString('base64url')
    expect(
      await ed.verifyAsync(
        Buffer.from(wrapper.signature, 'base64url'),
        new TextEncoder().encode(jcs(wrapper.payload)),
        Buffer.from(wrapper.signer_key, 'base64url'),
        { zip215: false },
      ),
    ).toBe(true)
    ref.hash = artifact(input, wrapper)
  }
  const signed = await signRecord(
    { ...record, args_hash: digest(body) } as AtribRecord,
    await seedFor(String(record.creator_key)),
  )
  expect(await verifySignature(signed)).toBe(true)
  const hash = digest(signed)
  if (append) input.records.push(signed as unknown as Obj)
  else input.records[input.records.indexOf(record)] = signed as unknown as Obj
  input.openings[hash] = body
  return hash
}
async function citeAllow(input: FixtureInput, allowHash: string) {
  const dispatch = find(input, 'observation', 'dispatch')
  const body = structuredClone(bodyOf(input, dispatch))
  const authority = body.basis.find((ref) => ref.relation === 'authority')
  if (!authority) throw new Error('Fixture dispatch has no authority reference')
  authority.hash = allowHash
  ;(input.evaluation as { dispatch_record: string }).dispatch_record = await seal(
    input,
    dispatch,
    body,
  )
}
async function checkFixtureSignatures(input: FixtureInput) {
  for (const record of input.records)
    expect(await verifySignature(record as unknown as AtribRecord)).toBe(true)
}

describe('independent adversarial source-bound regressions', () => {
  it('does not accept an allow targeting a different exact request', async () => {
    const input = load()
    const request = find(input, 'request')
    const other = structuredClone(bodyOf(input, request))
    other.nonce = 'AQEBAQEBAQEBAQEBAQEBAQ'
    const otherHash = await seal(input, request, other, true)
    const allow = find(input, 'authorization')
    const body = structuredClone(bodyOf(input, allow))
    body.target.record_hash = otherHash
    await citeAllow(input, await seal(input, allow, body))
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.authority.state).not.toBe('supported')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('leaves an additional unpinned missing authority dependency unresolved', async () => {
    const input = load()
    const allow = find(input, 'authorization')
    const body = structuredClone(bodyOf(input, allow))
    body.basis.push({ relation: 'authority', kind: 'artifact', hash: `sha256:${'0'.repeat(64)}` })
    await citeAllow(input, await seal(input, allow, body))
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.authority.state).toBe('unresolved')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('does not join an effect with a different invocation subject', async () => {
    const input = load()
    const effect = find(input, 'effect')
    const body = structuredClone(bodyOf(input, effect))
    body.subject.id = 'other-invocation'
    const hash = await seal(input, effect, body)
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(
      result.statements.find((statement) => statement.record_hash === hash)!.dimensions.binding
        .state,
    ).toBe('rejected')
    expect(result.request!.dimensions.effect.state).not.toBe('supported')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('checks snapshot versions against a separate exact destination payload artifact', async () => {
    // A wrapper cannot contain its own hash. The destination payload is separate
    // from the signed source wrapper, which authenticates the snapshot claim.
    const states: string[] = []
    for (const valid of [true, false]) {
      const input = load()
      const effect = find(input, 'effect')
      const body = structuredClone(bodyOf(input, effect))
      const payloadHash = artifact(input, {
        object: body.assertion.object,
        state: body.assertion.state,
      })
      body.assertion.payload_hash = payloadHash
      body.assertion.version = { kind: 'snapshot', value: valid ? payloadHash : 'arbitrary' }
      body.basis.push({ relation: 'source', kind: 'artifact', hash: payloadHash })
      await seal(input, effect, body)
      await checkFixtureSignatures(input)
      states.push((await evaluateEvidenceFixture(input)).request!.dimensions.effect.state)
    }
    expect(states[0]).toBe('supported')
    expect(states[1]).not.toBe('supported')
  })

  it('does not treat a declared effect as authenticated destination evidence', async () => {
    const input = load()
    const effect = find(input, 'effect')
    const body = structuredClone(bodyOf(input, effect))
    body.source.kind = 'declared'
    body.source.method = DECLARED_METHOD
    delete body.source.observed_at
    body.basis = []
    const effectRule = (input.policy as EvidencePolicy).rules.find((rule) =>
      rule.type.endsWith('/effect'),
    )
    if (!effectRule) throw new Error('Fixture has no effect policy rule')
    effectRule.methods = [DECLARED_METHOD]
    await seal(input, effect, body)
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.effect.state).not.toBe('supported')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('does not expose native state that disagrees with the exact destination payload', async () => {
    const input = load()
    const effect = find(input, 'effect')
    const body = structuredClone(bodyOf(input, effect))
    body.assertion.state = { invented: true }
    await seal(input, effect, body)
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.destination_states).toHaveLength(0)
    expect(result.request!.dimensions.effect.state).not.toBe('supported')
  })

  it('requires captured basis before supporting claimed complete coverage', async () => {
    const input = load('coverage-complete')
    const coverage = find(input, 'coverage')
    const body = structuredClone(bodyOf(input, coverage))
    body.basis = body.basis.filter((ref) => ref.relation !== 'captured')
    await seal(input, coverage, body)
    expect(body.basis.filter((ref) => ref.relation === 'captured')).toHaveLength(0)
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.coverage.state).not.toBe('supported')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('reports conflicting descriptors for the selected native invocation and delivery', async () => {
    const input = load()
    const response = find(input, 'observation', 'response')
    const body = structuredClone(bodyOf(input, response))
    body.assertion.descriptor.resource.id = 'production'
    await seal(input, response, body, true)
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.binding.state).toBe('conflict')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('never treats an authorization selected as a request as accepted request reliance', async () => {
    const input = load()
    input.request_hash = digest(find(input, 'authorization'))
    input.evaluation = { purpose: 'current', evaluated_at: 1_700_000_000_100 }
    ;(input.policy as EvidencePolicy).required = ['source']
    expect((await evaluateEvidenceFixture(input)).request).toBeNull()
  })

  it('keeps a missing binding dependency unresolved', async () => {
    const input = load()
    const dispatch = find(input, 'observation', 'dispatch')
    const body = structuredClone(bodyOf(input, dispatch))
    body.basis.push({ relation: 'binding', kind: 'artifact', hash: `sha256:${'0'.repeat(64)}` })
    ;(input.evaluation as { dispatch_record: string }).dispatch_record = await seal(
      input,
      dispatch,
      body,
    )
    await checkFixtureSignatures(input)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.binding.state).toBe('unresolved')
    expect(result.request!.reliance.accepted).toBe(false)
  })

  it('does not ignore an additional expected dependency in either reference order', async () => {
    for (const reverse of [false, true]) {
      const input = load('coverage-complete')
      const coverage = find(input, 'coverage')
      const body = structuredClone(bodyOf(input, coverage))
      body.basis.push({ relation: 'expected', kind: 'artifact', hash: `sha256:${'0'.repeat(64)}` })
      if (reverse) body.basis.reverse()
      await seal(input, coverage, body)
      await checkFixtureSignatures(input)
      const result = await evaluateEvidenceFixture(input)
      expect(result.request!.dimensions.coverage.state).toBe('unresolved')
      expect(result.request!.reliance.accepted).toBe(false)
    }
  })

  it('applies the artifact byte bound to authority before parsing', async () => {
    const input = load()
    const allow = find(input, 'authorization')
    const body = structuredClone(bodyOf(input, allow))
    body.basis.push({
      relation: 'authority',
      kind: 'artifact',
      hash: artifact(input, { padding: 'x'.repeat(1_048_576) }),
    })
    await citeAllow(input, await seal(input, allow, body))
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.authority.state).toBe('unresolved')
    expect(
      result.statements.some((statement) =>
        statement.dimensions.authority.reasons.includes('resource_limit'),
      ),
    ).toBe(true)
  })

  it('applies the artifact byte bound to expected manifests before parsing', async () => {
    const input = load('coverage-complete')
    const coverage = find(input, 'coverage')
    const body = structuredClone(bodyOf(input, coverage))
    body.basis.push({
      relation: 'expected',
      kind: 'artifact',
      hash: artifact(input, { padding: 'x'.repeat(1_048_576) }),
    })
    await seal(input, coverage, body)
    const result = await evaluateEvidenceFixture(input)
    expect(result.request!.dimensions.coverage.state).toBe('unresolved')
    expect(
      result.statements.some((statement) =>
        statement.dimensions.coverage.reasons.includes('resource_limit'),
      ),
    ).toBe(true)
  })
})
