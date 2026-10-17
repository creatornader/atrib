// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { verifyEvidenceSet } from '../src/index.js'
import { createEvidenceNonce, commitEvidenceBody, signRecord, type AtribRecord } from '@atrib/mcp'
import * as ed from '@noble/ed25519'
import {
  fixtureSourceVerifier,
  digest,
  SNAPSHOT_METHOD,
  type FixtureInput,
} from './source-bound-reference.js'
import { loadSourceBoundFixture } from './source-bound-corpus.js'

const corpusCases = join(__dirname, '../../../spec/conformance/1.12/cases')
const caseInput = (name: string): FixtureInput =>
  loadSourceBoundFixture(join(corpusCases, `${name}.json`)).input

function fixture(name = 'C01-complete') {
  const input = caseInput(name)
  return {
    records: input.records,
    openings: new Map(Object.entries(input.openings)),
    artifacts: new Map(
      Object.entries(input.artifacts).map(([hash, bytes]) => [hash, Buffer.from(bytes, 'base64')]),
    ),
    policy: input.policy,
    evaluation: input.evaluation as Parameters<typeof verifyEvidenceSet>[0]['evaluation'],
    requestHash: input.request_hash!,
    sourceVerifiers: { [SNAPSHOT_METHOD]: fixtureSourceVerifier },
  }
}

describe('public source-bound evidence API', () => {
  it('preserves rejected source trust when the rogue artifact is withheld', async () => {
    const input = fixture('C10-untrusted-injection')
    const trustedKeys = new Set(
      (input.policy as { rules: Array<{ signer_keys: string[] }> }).rules.flatMap(
        (rule) => rule.signer_keys,
      ),
    )
    const rogue = input.records.find((record) => !trustedKeys.has(String(record.creator_key)))!
    const opening = input.openings.get(digest(rogue)) as {
      basis: Array<{ relation: string; kind: string; hash: string }>
    }
    for (const ref of opening.basis)
      if (ref.relation === 'source' && ref.kind === 'artifact') input.artifacts.delete(ref.hash)
    const result = await verifyEvidenceSet(input)
    const source = result.statements.find((statement) => statement.record_hash === digest(rogue))!
      .dimensions.source
    expect(source.state).toBe('rejected')
    expect(source.reasons).toEqual(['dependency_missing', 'source_untrusted'])
  })
  it.each(['authorization', 'observation', 'effect', 'coverage'] as const)(
    'rejects missing required basis in the shared %s body schema',
    (kind) => {
      const input: FixtureInput =
        kind === 'coverage' ? caseInput('C13-expected-set-missing') : caseInput('C01-complete')
      const record = input.records.find(
        (record) => record.event_type === `https://atrib.dev/evidence/v1/${kind}`,
      )!
      const body = structuredClone(input.openings[digest(record)]) as {
        basis: Array<{ relation: string }>
      }
      body.basis = body.basis.filter(
        (ref) => ref.relation !== (kind === 'authorization' ? 'authority' : 'source'),
      )
      expect(() => commitEvidenceBody(kind, body)).toThrow()
    },
  )
  it('requires source basis even when an adapter authenticates a relabelled artifact', async () => {
    const input = fixture()
    const dispatch = input.records.find(
      (record) =>
        record.event_type === 'https://atrib.dev/evidence/v1/observation' &&
        (input.openings.get(digest(record)) as { assertion: { phase: string } }).assertion.phase ===
          'dispatch',
    )!
    const body = structuredClone(input.openings.get(digest(dispatch))) as {
      basis: Array<{ relation: string; kind: string; hash: string }>
    }
    for (const ref of body.basis) if (ref.relation === 'source') ref.relation = 'binding'
    const seed = new Uint8Array(32)
    for (let i = 1; i <= 6; i++) {
      seed.fill(i)
      if (
        Buffer.from(await ed.getPublicKeyAsync(seed)).toString('base64url') === dispatch.creator_key
      )
        break
    }
    const signed = await signRecord({ ...dispatch, args_hash: digest(body) } as AtribRecord, seed)
    const hash = digest(signed)
    const adapter = {
      ...fixtureSourceVerifier,
      async verify(args: Parameters<typeof fixtureSourceVerifier.verify>[0]) {
        const authenticated = structuredClone(args.body) as {
          basis: Array<{ relation: string; kind: string; hash: string }>
        }
        for (const ref of authenticated.basis)
          if (ref.relation === 'binding' && ref.kind === 'artifact') ref.relation = 'source'
        return fixtureSourceVerifier.verify({ ...args, body: authenticated })
      },
    }
    const result = await verifyEvidenceSet({
      ...input,
      records: input.records.map((record) => (record === dispatch ? signed : record)),
      openings: new Map([...input.openings, [hash, body]]),
      evaluation: { purpose: 'historical', evaluated_at: 1_700_000_000_100, dispatch_record: hash },
      policy: { ...(input.policy as object), required: ['source'] },
      sourceVerifiers: { [SNAPSHOT_METHOD]: adapter },
    })
    expect(
      result.statements.find((value) => value.record_hash === hash)!.dimensions.integrity.body
        .state,
    ).toBe('rejected')
    expect(result.request!.reliance.accepted).toBe(false)
  })
  it('rejects cyclic and excessively deep direct inputs before parsing or hashing', async () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    await expect(verifyEvidenceSet({ ...fixture(), records: [cycle] })).rejects.toThrow(
      'cyclic JSON',
    )
    await expect(
      verifyEvidenceSet({ ...fixture(), openings: new Map([['unused', cycle]]) }),
    ).rejects.toThrow('cyclic JSON')
    let deep: unknown = null
    for (let i = 0; i < 70; i++) deep = { nested: deep }
    await expect(verifyEvidenceSet({ ...fixture(), policy: deep })).rejects.toThrow(
      'resource_limit',
    )
    await expect(
      verifyEvidenceSet({ ...fixture(), records: Array.from({ length: 4097 }, () => ({})) }),
    ).rejects.toThrow('resource_limit')
  })
  it('exports a capture-only receiver without implicit sources', async () => {
    const result = await verifyEvidenceSet({
      records: [],
      openings: new Map(),
      artifacts: new Map(),
      policy: { id: 'empty', rules: [], required: [] },
      evaluation: { purpose: 'current', evaluated_at: 1 },
      sourceVerifiers: {},
    })
    expect(result.request).toBeNull()
    expect(result.statements).toEqual([])
  })
  it('generates independent cryptographic nonces', () => {
    const nonces = Array.from({ length: 100 }, createEvidenceNonce)
    expect(new Set(nonces).size).toBe(100)
    expect(nonces.every((value) => /^[A-Za-z0-9_-]{22}$/.test(value))).toBe(true)
    expect(() => commitEvidenceBody('request', {})).toThrow()
  })
  it('leaves unsupported source methods unresolved through the exported API', async () => {
    const input = fixture()
    input.sourceVerifiers = {}
    const result = await verifyEvidenceSet(input)
    expect(result.request!.reliance.accepted).toBe(false)
    expect(result.request!.dimensions.source.state).toBe('unresolved')
    expect(
      result.statements.every((value) => value.dimensions.integrity.state === 'supported'),
    ).toBe(true)
  })
  it('reports adapter exceptions without discarding record integrity', async () => {
    const input = fixture()
    input.sourceVerifiers[SNAPSHOT_METHOD] = {
      async verify() {
        throw new Error('invalid native receipt')
      },
    }
    const result = await verifyEvidenceSet(input)
    expect(result.request!.reliance.accepted).toBe(false)
    expect(
      result.statements.some((value) =>
        value.dimensions.source.reasons.includes('dependency_invalid'),
      ),
    ).toBe(true)
    expect(
      result.statements.every((value) => value.dimensions.integrity.record.state === 'supported'),
    ).toBe(true)
  })
  it('isolates adapter mutations from caller bytes and subsequent checks', async () => {
    const input = fixture()
    const before = [...input.artifacts].map(([hash, bytes]) => [
      hash,
      Buffer.from(bytes).toString('base64'),
    ])
    input.sourceVerifiers[SNAPSHOT_METHOD] = {
      ...fixtureSourceVerifier,
      async verify(args) {
        const result = await fixtureSourceVerifier.verify(args)
        for (const bytes of args.artifacts.values()) bytes.fill(0)
        return result
      },
    }
    expect((await verifyEvidenceSet(input)).request!.reliance.accepted).toBe(true)
    expect(
      [...input.artifacts].map(([hash, bytes]) => [hash, Buffer.from(bytes).toString('base64')]),
    ).toEqual(before)
  })
  it.each(['C05-dispatch-substitution', 'C06-execution-substitution'])(
    'rejects authority-only reliance for a substituted dispatch: %s',
    async (name) => {
      const input = caseInput(name)
      input.policy.required = ['authority']
      const result = await verifyEvidenceSet({
        records: input.records,
        openings: new Map(Object.entries(input.openings)),
        artifacts: new Map(
          Object.entries(input.artifacts).map(([hash, bytes]) => [
            hash,
            Buffer.from(bytes as string, 'base64'),
          ]),
        ),
        policy: input.policy,
        evaluation: input.evaluation,
        requestHash: input.request_hash,
        sourceVerifiers: { [SNAPSHOT_METHOD]: fixtureSourceVerifier },
      })
      expect(result.request!.dimensions.binding.state).toBe('rejected')
      expect(result.request!.dimensions.authority.state).toBe('rejected')
      expect(result.request!.reliance.accepted).toBe(false)
    },
  )
  it.each([
    ['content_id', null],
    ['session_token', null],
    ['informed_by', null],
    ['timestamp_granularity', 'unrecognized'],
  ])('rejects malformed optional carrier field %s', async (field, value) => {
    const input = fixture()
    const request = input.records.find(
      (record) => record.event_type === 'https://atrib.dev/evidence/v1/request',
    )!
    const opening = input.openings.get(digest(request))
    const seed = new Uint8Array(32)
    for (let i = 1; i <= 6; i++) {
      seed.fill(i)
      if (
        Buffer.from(await ed.getPublicKeyAsync(seed)).toString('base64url') === request.creator_key
      )
        break
    }
    const signed = await signRecord({ ...request, [String(field)]: value } as AtribRecord, seed)
    const hash = digest(signed)
    const result = await verifyEvidenceSet({
      ...input,
      records: [signed],
      openings: new Map([[hash, opening]]),
      requestHash: hash,
      evaluation: { purpose: 'current', evaluated_at: 1_700_000_000_100 },
      policy: { ...(input.policy as object), required: ['source'] },
    })
    expect(result.request!.dimensions.integrity.body.state).toBe('rejected')
    expect(result.request!.reliance.accepted).toBe(false)
  })
  it('rejects credentials and non-JSON optional fields before committing a body', () => {
    const input = fixture()
    const request = input.records.find(
      (record) => record.event_type === 'https://atrib.dev/evidence/v1/request',
    )!
    const original = input.openings.get(digest(request)) as Record<string, unknown>
    for (const locator of [
      ['https://', 'user', ':', 'password', '@', 'example.test', '/private'].join(''),
      'https://example.test?X-Amz-Signature=secret',
      'Bearer secret',
    ]) {
      expect(() =>
        commitEvidenceBody('request', {
          ...original,
          source: { ...(original.source as object), locator },
        }),
      ).toThrow()
    }
    expect(() => commitEvidenceBody('request', { ...original, target: undefined })).toThrow()
  })
})
