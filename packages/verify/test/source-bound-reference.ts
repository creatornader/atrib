// SPDX-License-Identifier: Apache-2.0
// Public test keys authenticate only the synthetic corpus source.
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { createHash } from 'node:crypto'
import {
  verifyEvidenceSet,
  type EvidenceSourceVerifier,
  type VerifyEvidenceSetInput,
} from '../src/evidence-statements.js'
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export const jcs = (value: unknown): string => canonicalize(value) ?? 'null'
export const digest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(jcs(value)).digest('hex')}`
export const SNAPSHOT_METHOD = 'https://atrib.dev/conformance/method/signed-snapshot-v1'
export const MULTI_DESTINATION_METHOD =
  'https://atrib.dev/conformance/method/signed-snapshot-multiple-v1'
export const OTHER_CURSOR_METHOD =
  'https://atrib.dev/conformance/method/signed-snapshot-other-cursor-v1'
export const UNKNOWN_CURSOR_METHOD =
  'https://atrib.dev/conformance/method/signed-snapshot-unknown-cursor-v1'
export interface FixtureInput {
  records: Record<string, unknown>[]
  openings: Record<string, unknown>
  artifacts: Record<string, string>
  policy: unknown
  evaluation: unknown
  request_hash?: string
  publication?: {
    proofs: Record<string, unknown>
    trust: unknown
  }
}

const eq = (a: unknown, b: unknown) => jcs(a) === jcs(b)
export const fixtureSourceVerifier: EvidenceSourceVerifier = {
  singleDestinationPerDelivery: true,
  compareCursors(a, b) {
    const left = Number(a),
      right = Number(b)
    return Number.isSafeInteger(left) && Number.isSafeInteger(right) ? left - right : undefined
  },
  async verify({ body, artifacts, sourceKeys }) {
    const refs = Array.isArray(body.basis) ? body.basis.map(object) : []
    async function payload(hash: string) {
      const bytes = artifacts.get(hash)
      if (!bytes) return undefined
      const wrapper = object(JSON.parse(Buffer.from(bytes).toString('utf8')))
      if (!sourceKeys.includes(String(wrapper.signer_key))) return undefined
      const valid = await ed.verifyAsync(
        Buffer.from(String(wrapper.signature), 'base64url'),
        new TextEncoder().encode(jcs(wrapper.payload)),
        Buffer.from(String(wrapper.signer_key), 'base64url'),
        { zip215: false },
      )
      return valid ? object(wrapper.payload) : undefined
    }
    const claim = Object.fromEntries(
      Object.entries(body).filter(([name]) => !['nonce', 'basis'].includes(name)),
    )
    const authority = refs
      .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
      .map((ref) => ref.hash)
      .sort()
    let facts: Record<string, unknown> | undefined
    const basis: string[] = []
    for (const ref of refs.filter((ref) => ref.relation === 'source' && ref.kind === 'artifact')) {
      const value = await payload(String(ref.hash))
      if (!value || !eq(value.claim, claim) || !eq(value.authority ?? [], authority)) continue
      if (facts && !eq(facts, value))
        return { state: 'conflict', reasons: ['source_conflict'], basis }
      facts = value
      basis.push(String(ref.hash))
    }
    if (!facts) return { state: 'rejected', reasons: ['source_untrusted'], basis }
    const normalizedClaim = object(facts.claim)
    const assertion = object(normalizedClaim.assertion)
    if (facts.native_event_hash !== undefined) {
      const bytes = artifacts.get(String(facts.native_event_hash))
      const event = bytes && object(JSON.parse(Buffer.from(bytes).toString('utf8')))
      if (
        !event ||
        !eq(event.surface, object(body.source).identity) ||
        !eq(event.id, assertion.native_invocation) ||
        event.cursor !== facts.cursor ||
        !eq(event.assertion, assertion)
      )
        return { state: 'rejected', reasons: ['dependency_invalid'], basis }
    }
    if (assertion.payload_hash !== undefined) {
      const bytes = artifacts.get(String(assertion.payload_hash))
      const raw = bytes && object(JSON.parse(Buffer.from(bytes).toString('utf8')))
      const version = object(assertion.version)
      if (
        !raw ||
        !eq(raw.object, assertion.object) ||
        !eq(raw.state, assertion.state) ||
        (version.kind === 'native' && raw.version !== version.value)
      )
        return { state: 'rejected', reasons: ['dependency_invalid'], basis }
      normalizedClaim.assertion = {
        ...assertion,
        object: raw.object,
        state: raw.state,
        version:
          version.kind === 'native'
            ? { kind: 'native', value: raw.version }
            : { kind: 'snapshot', value: assertion.payload_hash },
      }
    }
    let nativeEvents: Array<{ id: unknown; hash: string }> | undefined
    if (String(object(body.source).kind) === 'manifest') {
      let complete = true
      for (const relation of ['expected', 'captured'] as const) {
        const entries = refs.filter((ref) => ref.relation === relation && ref.kind === 'artifact')
        if (!entries.length) complete = false
        for (const ref of entries) {
          const value = await payload(String(ref.hash))
          if (!value) {
            complete = false
            continue
          }
          if (
            !eq(value.surface, assertion.surface) ||
            value.start !== assertion.start ||
            value.end !== assertion.end ||
            !eq(value.ids, assertion[relation])
          )
            return { state: 'rejected', reasons: ['dependency_invalid'], basis }
          normalizedClaim.assertion = {
            ...object(normalizedClaim.assertion),
            surface: value.surface,
            start: value.start,
            end: value.end,
            [relation]: value.ids,
          }
          if (!Array.isArray(value.native_events)) complete = false
          else {
            if (nativeEvents && !eq(nativeEvents, value.native_events))
              return { state: 'rejected', reasons: ['dependency_invalid'], basis }
            nativeEvents = value.native_events as Array<{ id: unknown; hash: string }>
            for (const entry of nativeEvents) {
              const bytes = artifacts.get(entry.hash)
              const event = bytes && object(JSON.parse(Buffer.from(bytes).toString('utf8')))
              if (!event || !eq(event.id, entry.id))
                return { state: 'rejected', reasons: ['dependency_invalid'], basis }
            }
          }
        }
      }
      if (!complete) nativeEvents = undefined
    }
    return {
      state: 'supported',
      reasons: [],
      basis,
      facts: {
        claim: normalizedClaim,
        authority: (facts.authority ?? []) as string[],
        ...(facts.cursor === undefined ? {} : { cursor: String(facts.cursor) }),
        ...(facts.native_event_hash === undefined
          ? {}
          : { native_event_hash: String(facts.native_event_hash) }),
        ...(nativeEvents ? { native_events: nativeEvents } : {}),
      },
    }
  },
}
export async function evaluateEvidenceFixture(input: FixtureInput) {
  return verifyEvidenceSet({
    records: input.records,
    openings: new Map(Object.entries(input.openings)),
    artifacts: new Map(
      Object.entries(input.artifacts).map(([hash, bytes]) => [hash, Buffer.from(bytes, 'base64')]),
    ),
    policy: input.policy,
    evaluation: input.evaluation as Parameters<typeof verifyEvidenceSet>[0]['evaluation'],
    requestHash: input.request_hash,
    sourceVerifiers: {
      [SNAPSHOT_METHOD]: fixtureSourceVerifier,
      [MULTI_DESTINATION_METHOD]: { ...fixtureSourceVerifier, singleDestinationPerDelivery: false },
      [OTHER_CURSOR_METHOD]: fixtureSourceVerifier,
      [UNKNOWN_CURSOR_METHOD]: { ...fixtureSourceVerifier, compareCursors: () => undefined },
    },
    ...(input.publication
      ? {
          publication: {
            proofs: new Map(Object.entries(input.publication.proofs)),
            trust: input.publication.trust,
          } as VerifyEvidenceSetInput['publication'],
        }
      : {}),
  })
}
