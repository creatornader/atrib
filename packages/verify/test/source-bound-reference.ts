// SPDX-License-Identifier: Apache-2.0
// Offline corpus model. No public API, network adapter, persistence or execution.
import canonicalize from 'canonicalize'
import * as ed from '@noble/ed25519'
import { createHash } from 'node:crypto'
import { canonicalSigningInput, type AtribRecord } from '@atrib/mcp'
import {
  verifyAnchorProofElement,
  type AnchorProofElement,
  type AnchorTrustConfig,
} from '../src/anchor-plurality.js'
import {
  DECLARED_METHOD,
  EVIDENCE_PREFIX,
  evidenceBodySchemas,
  evaluationSchema,
  policySchema,
  authoritySnapshotSchema,
  type EvidenceKind,
  type EvidencePolicy,
} from './source-bound-schemas.js'

type Obj = Record<string, unknown>
type State = 'supported' | 'rejected' | 'unresolved' | 'conflict' | 'not_applicable'
type Dimension = { state: State; basis: string[]; reasons: string[] }
const names = ['source', 'binding', 'authority', 'effect', 'coverage', 'publication'] as const
export const object = (value: unknown): Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {}
export const jcs = (value: unknown): string => canonicalize(value) ?? 'null'
export const digest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(jcs(value)).digest('hex')}`
const bytesHash = (value: Uint8Array) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`
const eq = (a: unknown, b: unknown) => jcs(a) === jcs(b)
const dim = (state: State, reason?: string, hashes: string[] = []): Dimension => ({
  state,
  basis: [...new Set(hashes)].sort(),
  reasons: reason ? [reason] : [],
})
const dimensions = () =>
  ({
    integrity: { ...dim('unresolved'), record: dim('unresolved'), body: dim('unresolved') },
    ...Object.fromEntries(names.map((name) => [name, dim('not_applicable')])),
  }) as Dimensions
type Dimensions = { integrity: Dimension & { record: Dimension; body: Dimension } } & Record<
  (typeof names)[number],
  Dimension
>
interface Info {
  hash: string
  record: Obj
  body: Obj
  assertion: Obj
  kind: string
  dimensions: Dimensions
  facts: Obj
  rule?: EvidencePolicy['rules'][number]
}
export interface FixtureInput {
  records: Obj[]
  openings: Record<string, unknown>
  artifacts: Record<string, string>
  policy: unknown
  evaluation: unknown
  request_hash?: string
  publication?: { proofs: Record<string, unknown>; trust: unknown }
}

async function inspectPublication(hash: string, input: FixtureInput): Promise<Dimension> {
  const publication = input.publication
  if (!publication || !Object.hasOwn(publication.proofs, hash))
    return dim('unresolved', 'not_submitted')
  const invalid = () => dim('rejected', 'dependency_invalid', [hash])
  try {
    const proof = object(publication.proofs[hash])
    if (proof.record_hash !== hash || !Array.isArray(proof.log_proofs) || !proof.log_proofs.length)
      return invalid()
    let failed = false
    for (const element of proof.log_proofs) {
      const result = await verifyAnchorProofElement(
        element as AnchorProofElement,
        hash,
        publication.trust as AnchorTrustConfig,
      )
      if (result.status === 'invalid' || result.status === 'malformed') failed = true
      if (result.anchorType === 'atrib-log' && result.status === 'verified')
        return dim('supported', undefined, [hash])
    }
    return failed
      ? invalid()
      : dim('unresolved', 'https://atrib.dev/evidence/v1/reason/publication-anchor-unsupported', [
          hash,
        ])
  } catch {
    return invalid()
  }
}
const assertion = (info: Info) => info.assertion
const refs = (info: Info): Obj[] =>
  Array.isArray(info.body.basis) ? info.body.basis.map(object) : []
const source = (info: Info) => object(info.body.source)
const isExecution = (info: Info) =>
  info.kind === 'observation' && assertion(info).phase !== 'capture'
const sourceSupported = (info: Info) => info.dimensions.source.state === 'supported'
const forbidden = [
  'result_hash',
  'result_salt',
  'args_salt',
  'signers',
  'checkpoint',
  'annotates',
  'revises',
]
const requiredCarrier = [
  'spec_version',
  'creator_key',
  'chain_root',
  'event_type',
  'context_id',
  'timestamp',
  'args_hash',
  'signature',
]
export const SNAPSHOT_METHOD = 'https://atrib.dev/conformance/method/signed-snapshot-v1'
export const MULTI_DESTINATION_METHOD =
  'https://atrib.dev/conformance/method/signed-snapshot-multiple-v1'
export const OTHER_CURSOR_METHOD =
  'https://atrib.dev/conformance/method/signed-snapshot-other-cursor-v1'
export const UNKNOWN_CURSOR_METHOD =
  'https://atrib.dev/conformance/method/signed-snapshot-unknown-cursor-v1'
const artifactFailure = (error: unknown): Dimension =>
  error instanceof Error && error.message === 'resource_limit'
    ? dim('unresolved', 'resource_limit')
    : dim('rejected', 'dependency_invalid')
function artifactBytes(encoded: string): Uint8Array {
  if (encoded.length > 1_398_104) throw new Error('resource_limit')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > 1_048_576) throw new Error('resource_limit')
  return bytes
}
function artifact(input: FixtureInput, hash: string): Obj | undefined {
  const encoded = input.artifacts[hash]
  if (!encoded) return undefined
  const bytes = artifactBytes(encoded)
  if (bytesHash(bytes) !== hash) throw new Error('dependency_invalid')
  return object(JSON.parse(Buffer.from(bytes).toString('utf8')))
}
async function signedPayload(value: Obj, keys: string[]): Promise<Obj | undefined> {
  if (!keys.includes(String(value.signer_key))) return undefined
  const ok = await ed.verifyAsync(
    Buffer.from(String(value.signature), 'base64url'),
    new TextEncoder().encode(jcs(value.payload)),
    Buffer.from(String(value.signer_key), 'base64url'),
    { zip215: false },
  )
  return ok ? object(value.payload) : undefined
}
function claim(info: Info): Obj {
  const { nonce: _nonce, basis: _basis, ...rest } = info.body
  return rest
}
function effectPayloadMatches(info: Info, input: FixtureInput): boolean {
  const payloadHash = String(info.assertion.payload_hash)
  const raw = artifact(input, payloadHash)
  const cited = refs(info).some(
    (ref) => ref.kind === 'artifact' && ref.relation === 'source' && ref.hash === payloadHash,
  )
  return (
    cited &&
    !!raw &&
    eq(raw.object, info.assertion.object) &&
    eq(raw.state, info.assertion.state) &&
    (object(info.assertion.version).kind !== 'snapshot' ||
      object(info.assertion.version).value === payloadHash) &&
    (object(info.assertion.version).kind !== 'native' ||
      raw.version === object(info.assertion.version).value)
  )
}
async function inspectSource(
  info: Info,
  input: FixtureInput,
  policy: EvidencePolicy | undefined,
  evaluatedAt: number,
) {
  const set = (state: State, reason?: string) => {
    info.dimensions.source = dim(state, reason, [info.hash])
  }
  if (info.dimensions.integrity.state !== 'supported') {
    info.dimensions.source = {
      state: info.dimensions.integrity.state,
      basis: [...info.dimensions.integrity.basis],
      reasons: [...info.dimensions.integrity.reasons],
    }
    return
  }
  if (!policy) return set('unresolved', input.policy == null ? 'policy_missing' : 'policy_invalid')
  const src = source(info)
  const rule = policy.rules.find(
    (rule) =>
      rule.type === info.record.event_type &&
      rule.signer_keys.includes(String(info.record.creator_key)) &&
      eq(rule.source, src.identity) &&
      rule.methods.includes(String(src.method)) &&
      rule.subject_namespace === object(info.body.subject).namespace,
  )
  if (!rule) return set('rejected', 'source_untrusted')
  info.rule = rule
  if (src.kind === 'declared') {
    if (src.method !== DECLARED_METHOD || 'observed_at' in src)
      return set('rejected', 'schema_invalid')
  } else {
    if (!Number.isSafeInteger(src.observed_at)) return set('rejected', 'schema_invalid')
    if (
      ![
        SNAPSHOT_METHOD,
        MULTI_DESTINATION_METHOD,
        OTHER_CURSOR_METHOD,
        UNKNOWN_CURSOR_METHOD,
      ].includes(String(src.method))
    )
      return set('unresolved', 'source_untrusted')
    const sourceRefs = refs(info).filter(
      (ref) => ref.relation === 'source' && ref.kind === 'artifact',
    )
    let found = false
    for (const ref of sourceRefs) {
      const value = artifact(input, String(ref.hash))
      if (!value) continue
      const payload = await signedPayload(value, rule.source_keys)
      if (
        payload &&
        eq(payload.claim, claim(info)) &&
        eq(
          payload.authority ?? [],
          refs(info)
            .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
            .map((ref) => ref.hash)
            .sort(),
        )
      ) {
        if (found && !eq(info.facts, payload)) return set('conflict', 'source_conflict')
        info.facts = payload
        found = true
      }
    }
    if (!found) return set('rejected', 'source_untrusted')
    if (info.facts.native_event_hash !== undefined) {
      const event = artifact(input, String(info.facts.native_event_hash))
      if (
        !event ||
        !eq(event.surface, src.identity) ||
        !eq(event.id, info.assertion.native_invocation) ||
        event.cursor !== info.facts.cursor ||
        !eq(event.assertion, info.assertion)
      )
        return set('rejected', 'dependency_invalid')
    }
  }
  if (info.kind === 'effect' && !effectPayloadMatches(info, input))
    return set('rejected', 'dependency_invalid')
  const age =
    evaluatedAt - Number(src.kind === 'declared' ? info.record.timestamp : src.observed_at)
  if (age < 0 || age > rule.max_age_ms) return set('unresolved', 'freshness_unknown')
  return set('supported')
}

export async function evaluateEvidenceFixture(input: FixtureInput) {
  const parsedPolicy = policySchema.safeParse(input.policy)
  const policy = parsedPolicy.success ? (input.policy as EvidencePolicy) : undefined
  const evaluation = evaluationSchema.parse(input.evaluation)
  const infos: Info[] = []
  const uniqueRecords = new Map<string, { canonical: string; record: Obj }>()
  for (const record of input.records) {
    const hash = digest(record)
    const canonical = jcs(record)
    const existing = uniqueRecords.get(hash)
    if (existing && existing.canonical !== canonical)
      throw new TypeError('invalid_evidence_input: conflicting record hash')
    if (!existing) uniqueRecords.set(hash, { canonical, record })
  }
  for (const [hash, { record }] of uniqueRecords) {
    const opening = input.openings[hash]
    const body = object(opening)
    const kind = String(record.event_type).startsWith(EVIDENCE_PREFIX)
      ? String(record.event_type).slice(EVIDENCE_PREFIX.length)
      : 'unknown'
    const dimensions_ = dimensions()
    const recordSchemaOk =
      record.spec_version === 'atrib/1.0' &&
      /^[0-9a-f]{32}$/.test(String(record.context_id)) &&
      Number.isSafeInteger(record.timestamp) &&
      Number(record.timestamp) >= 0 &&
      Number(record.timestamp) <= evaluation.evaluated_at + 300_000
    let recordOk: boolean
    try {
      recordOk =
        recordSchemaOk &&
        (await ed.verifyAsync(
          Buffer.from(String(record.signature), 'base64url'),
          canonicalSigningInput(record as unknown as AtribRecord),
          Buffer.from(String(record.creator_key), 'base64url'),
          { zip215: false },
        ))
    } catch {
      recordOk = false
    }
    dimensions_.integrity.record = dim(
      recordOk ? 'supported' : 'rejected',
      recordOk ? undefined : recordSchemaOk ? 'signature_invalid' : 'schema_invalid',
      [hash],
    )
    let bodyResult = dim('supported', undefined, [hash])
    if (!(kind in evidenceBodySchemas)) bodyResult = dim('unresolved', 'unknown_type')
    else if (
      forbidden.some((key) => key in record) ||
      requiredCarrier.some((key) => !(key in record)) ||
      ('content_id' in record &&
        (typeof record.content_id !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/.test(record.content_id))) ||
      !/^sha256:[0-9a-f]{64}$/.test(String(record.chain_root))
    )
      bodyResult = dim('rejected', 'schema_invalid')
    else if (!(hash in input.openings)) bodyResult = dim('unresolved', 'body_missing')
    else if (digest(opening) !== record.args_hash) bodyResult = dim('rejected', 'opening_mismatch')
    else if (!evidenceBodySchemas[kind as EvidenceKind].safeParse(opening).success)
      bodyResult = dim('rejected', 'schema_invalid')
    dimensions_.integrity.body = bodyResult
    dimensions_.integrity.state =
      !recordOk || bodyResult.state === 'rejected' ? 'rejected' : bodyResult.state
    dimensions_.integrity.reasons = [
      ...new Set([...dimensions_.integrity.record.reasons, ...bodyResult.reasons]),
    ].sort()
    infos.push({
      hash,
      record,
      body,
      assertion: object(body.assertion),
      kind,
      dimensions: dimensions_,
      facts: {},
    })
  }
  for (const info of infos) {
    try {
      await inspectSource(info, input, policy, evaluation.evaluated_at)
    } catch (error) {
      info.dimensions.source = artifactFailure(error)
    }
  }
  const byHash = new Map(infos.map((info) => [info.hash, info]))
  function dependencies(info: Info, path: string[] = [], relations = ['source']): Dimension {
    if (path.includes(info.hash)) return dim('unresolved', 'dependency_cycle')
    if (path.length > 32) return dim('unresolved', 'resource_limit')
    if (refs(info).length > 256) return dim('unresolved', 'resource_limit')
    for (const ref of refs(info)) {
      if (!relations.includes(String(ref.relation))) continue
      if (ref.kind === 'artifact') {
        if (!input.artifacts[String(ref.hash)]) return dim('unresolved', 'dependency_missing')
        let bytes: Uint8Array
        try {
          bytes = artifactBytes(input.artifacts[String(ref.hash)]!)
        } catch (error) {
          return artifactFailure(error)
        }
        if (bytesHash(bytes) !== ref.hash) return dim('rejected', 'dependency_invalid')
      } else {
        const linked = byHash.get(String(ref.hash))
        if (!linked || linked.dimensions.integrity.state === 'unresolved')
          return dim('unresolved', 'dependency_missing')
        if (linked.dimensions.integrity.state === 'rejected')
          return dim('rejected', 'dependency_invalid')
        const dependency = dependencies(
          linked,
          [...path, info.hash],
          ['source', 'authority', 'expected', 'captured', 'binding'],
        )
        if (dependency.state !== 'supported') return dependency
      }
    }
    return dim('supported')
  }
  for (const info of infos) {
    const dependency = dependencies(info)
    if (dependency.state !== 'supported') info.dimensions.source = dependency
  }
  const requested = byHash.get(String(input.request_hash))
  const request = requested?.kind === 'request' ? requested : undefined
  const targetOf = (info: Info) => object(info.body.target).record_hash
  const target = (info: Info) => byHash.get(String(targetOf(info)))
  function binding(info: Info): Dimension {
    const dependency = dependencies(info, [], ['binding'])
    if (dependency.state !== 'supported') return dependency
    const req = target(info)
    if (!req || req.kind !== 'request' || req.dimensions.integrity.state !== 'supported')
      return dim('unresolved', 'dependency_missing')
    if (!sourceSupported(info)) return dim('unresolved', 'source_untrusted')
    if (!eq(info.body.subject, req.body.subject)) return dim('rejected', 'target_mismatch')
    if (isExecution(info) && !eq(assertion(info).descriptor, assertion(req).descriptor))
      return dim('rejected', 'descriptor_mismatch')
    if (isExecution(info) && !eq(assertion(info).execution, assertion(req).execution))
      return dim('rejected', 'execution_mismatch')
    return dim('supported', undefined, [info.hash, req.hash])
  }
  for (const info of infos)
    if (isExecution(info) || ['authorization', 'report', 'effect'].includes(info.kind))
      info.dimensions.binding = binding(info)
  const selected =
    evaluation.purpose === 'historical' ? byHash.get(evaluation.dispatch_record) : undefined
  const dispatches = infos.filter(
    (info) =>
      isExecution(info) &&
      info.assertion.phase === 'dispatch' &&
      sourceSupported(info) &&
      targetOf(info) === request?.hash,
  )
  const selectedOk = selected && dispatches.includes(selected)
  const singleDestination = (info: Info) => source(info).method !== MULTI_DESTINATION_METHOD
  const destinationConflict = (a: Info, b: Info) =>
    singleDestination(a) &&
    eq(a.assertion.delivery, b.assertion.delivery) &&
    a.assertion.destination_request !== undefined &&
    b.assertion.destination_request !== undefined &&
    !eq(a.assertion.destination_request, b.assertion.destination_request)
  const decisionTime =
    evaluation.purpose === 'current'
      ? evaluation.evaluated_at
      : selectedOk
        ? Number(source(selected).observed_at)
        : undefined
  function authorize(info: Info): Dimension {
    if (!request || decisionTime === undefined) return dim('unresolved', 'authority_invalid')
    if (info.kind !== 'authorization' || targetOf(info) !== request.hash)
      return dim('rejected', 'target_mismatch')
    if (info.dimensions.source.state === 'rejected' || info.dimensions.binding.state === 'rejected')
      return dim('rejected', 'authority_invalid')
    if (info.dimensions.source.state === 'conflict') return dim('conflict', 'authority_invalid')
    if (info.dimensions.binding.state !== 'supported' || !sourceSupported(info))
      return dim('unresolved', 'authority_invalid')
    const a = assertion(info),
      rule = info.rule!
    if (
      !rule.authority_versions.includes(String(a.authority_version)) ||
      !rule.authorized_descriptors.some((value) => eq(value, request.assertion.descriptor))
    )
      return dim('rejected', 'authority_invalid')
    if (!(Number(a.not_before) <= decisionTime && decisionTime < Number(a.expires_at)))
      return dim('rejected', 'authority_invalid')
    for (const ref of refs(info).filter((ref) => ref.relation === 'authority')) {
      if (ref.kind === 'record') {
        const dependency = byHash.get(String(ref.hash))
        if (!dependency || dependency.dimensions.integrity.state === 'unresolved')
          return dim('unresolved', 'dependency_missing')
        if (dependency.dimensions.integrity.state !== 'supported')
          return dim('rejected', 'dependency_invalid')
      } else {
        try {
          if (!artifact(input, String(ref.hash))) return dim('unresolved', 'dependency_missing')
        } catch (error) {
          return artifactFailure(error)
        }
      }
    }
    const pinned = refs(info).filter(
      (ref) =>
        ref.relation === 'authority' &&
        ref.kind === 'artifact' &&
        rule.authority_basis.includes(String(ref.hash)),
    )
    if (!pinned.length) return dim('rejected', 'authority_invalid')
    for (const ref of pinned) {
      let grant: Obj | undefined
      try {
        grant = artifact(input, String(ref.hash))
      } catch {
        return dim('rejected', 'dependency_invalid')
      }
      if (!grant) return dim('unresolved', 'dependency_missing')
      if (!authoritySnapshotSchema.safeParse(grant).success)
        return dim('rejected', 'authority_invalid')
      if (
        grant.version !== a.authority_version ||
        grant.revoked !== false ||
        !(Number(grant.not_before) <= decisionTime && decisionTime < Number(grant.expires_at))
      )
        return dim('rejected', 'authority_invalid')
    }
    return dim(
      a.decision === 'allow' ? 'supported' : 'rejected',
      a.decision === 'allow' ? undefined : 'authority_invalid',
      [info.hash, ...pinned.map((ref) => String(ref.hash))],
    )
  }
  for (const info of infos)
    if (info.kind === 'authorization') info.dimensions.authority = authorize(info)
  const resultDimensions = request ? structuredClone(request.dimensions) : dimensions()
  if (request) {
    resultDimensions.source =
      evaluation.purpose === 'current'
        ? request.dimensions.source
        : selected &&
            isExecution(selected) &&
            selected.assertion.phase === 'dispatch' &&
            targetOf(selected) === request.hash
          ? selected.dimensions.source
          : dim('unresolved', 'dependency_missing')
    resultDimensions.binding =
      evaluation.purpose === 'current'
        ? dim('not_applicable')
        : selectedOk
          ? selected.dimensions.binding
          : dim('unresolved', 'dependency_missing')
    if (selectedOk) {
      const sameOccurrence = infos.filter(
        (info) =>
          isExecution(info) &&
          sourceSupported(info) &&
          targetOf(info) === request.hash &&
          eq(source(info).identity, source(selected).identity) &&
          source(info).method === source(selected).method &&
          (eq(info.assertion.native_invocation, selected.assertion.native_invocation) ||
            eq(info.assertion.delivery, selected.assertion.delivery)),
      )
      const destinationConflicts = new Set(
        sameOccurrence.filter((info) =>
          sameOccurrence.some((other) => destinationConflict(info, other)),
        ),
      )
      const conflicting = sameOccurrence.filter(
        (info) =>
          !eq(info.assertion.descriptor, selected.assertion.descriptor) ||
          !eq(info.assertion.execution, selected.assertion.execution) ||
          (eq(info.assertion.delivery, selected.assertion.delivery) &&
            !eq(info.assertion.native_invocation, selected.assertion.native_invocation)) ||
          destinationConflicts.has(info),
      )
      if (conflicting.length) {
        resultDimensions.binding = dim('conflict', undefined, [
          selected.hash,
          ...conflicting.map((info) => info.hash),
        ])
        resultDimensions.binding.reasons = [
          ...new Set(
            conflicting.flatMap((info) => [
              ...(!eq(info.assertion.descriptor, selected.assertion.descriptor)
                ? ['descriptor_mismatch']
                : []),
              ...(!eq(info.assertion.execution, selected.assertion.execution)
                ? ['execution_mismatch']
                : []),
              ...(!eq(info.assertion.native_invocation, selected.assertion.native_invocation) ||
              destinationConflicts.has(info)
                ? ['source_conflict']
                : []),
            ]),
          ),
        ].sort()
      }
    }
    if (evaluation.purpose === 'current' && dispatches.length)
      resultDimensions.authority = dim('unresolved', 'purpose_mismatch')
    else if (evaluation.purpose === 'historical' && !selectedOk)
      resultDimensions.authority = dim('unresolved', 'authority_unordered')
    else {
      const authorityRefs = selected
        ? refs(selected)
            .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
            .map((ref) => String(ref.hash))
        : []
      const grants = selected
        ? authorityRefs.map((hash) => byHash.get(hash))
        : infos.filter(
            (info) =>
              info.kind === 'authorization' &&
              targetOf(info) === request.hash &&
              sourceSupported(info),
          )
      const valid = grants.filter((info): info is Info => !!info)
      const decisions = new Set(
        valid
          .filter((info) => ['supported', 'rejected'].includes(info.dimensions.authority.state))
          .map((info) => info.assertion.decision),
      )
      resultDimensions.authority = valid.some((info) => info.kind !== 'authorization')
        ? dim('rejected', 'dependency_invalid')
        : decisions.size > 1
          ? dim('conflict', 'authority_invalid')
          : grants.length === 0
            ? dim('unresolved', selected ? 'authority_unordered' : 'authority_invalid')
            : valid.some((info) => info.dimensions.authority.state === 'rejected')
              ? dim('rejected', 'authority_invalid')
              : valid.length !== grants.length ||
                  valid.some((info) => info.dimensions.authority.state !== 'supported')
                ? dim('unresolved', 'dependency_missing')
                : dim(
                    'supported',
                    evaluation.purpose === 'current' ? 'no_dispatch_observed' : undefined,
                    valid.map((info) => info.hash),
                  )
    }
  }
  const effectInfos = infos.filter(
    (info) => info.kind === 'effect' && targetOf(info) === request?.hash && sourceSupported(info),
  )
  for (const info of effectInfos) {
    const link = object(info.assertion.binding),
      observed = byHash.get(String(link.observation_record))
    const joined =
      selectedOk &&
      info.dimensions.binding.state === 'supported' &&
      observed &&
      sourceSupported(observed) &&
      observed.dimensions.binding.state === 'supported' &&
      targetOf(observed) === request?.hash &&
      eq(observed.assertion.native_invocation, selected.assertion.native_invocation) &&
      eq(observed.assertion.delivery, selected.assertion.delivery) &&
      eq(observed.assertion.execution, selected.assertion.execution) &&
      eq(link.destination_request, observed.assertion.destination_request)
    info.dimensions.effect = dim(
      joined ? 'supported' : 'unresolved',
      joined ? undefined : 'effect_unbound',
      joined ? [info.hash, observed.hash] : [],
    )
  }
  const destinationStates = effectInfos
    .map((info) => ({
      record_hash: info.hash,
      object: info.assertion.object,
      version: info.assertion.version,
      state: info.assertion.state,
      source: info.dimensions.source,
      binding: info.dimensions.effect,
    }))
    .sort((a, b) => a.record_hash.localeCompare(b.record_hash))
  const conflictingState = effectInfos.some((a, i) =>
    effectInfos
      .slice(i + 1)
      .some(
        (b) =>
          object(a.assertion.version).kind === 'native' &&
          eq(a.assertion.object, b.assertion.object) &&
          eq(a.assertion.version, b.assertion.version) &&
          !eq(a.assertion.state, b.assertion.state),
      ),
  )
  const joinedEffects = effectInfos.filter((info) => info.dimensions.effect.state === 'supported')
  const destinations = new Set(
    joinedEffects.map((info) => jcs(object(info.assertion.binding).destination_request)),
  )
  if (request)
    resultDimensions.effect =
      conflictingState ||
      (destinations.size > 1 &&
        ((selectedOk && singleDestination(selected)) ||
          joinedEffects.some((info) => {
            const observed = byHash.get(String(object(info.assertion.binding).observation_record))
            return observed && singleDestination(observed)
          })))
        ? dim('conflict', 'effect_conflict')
        : joinedEffects.length
          ? dim(
              'supported',
              undefined,
              joinedEffects.map((info) => info.hash),
            )
          : dim('unresolved', 'effect_unbound')
  function inCoverageWindow(info: Info, dispatch: Info): boolean | undefined {
    if (
      source(info).method !== source(dispatch).method ||
      source(info).method === UNKNOWN_CURSOR_METHOD
    )
      return undefined
    const start = Number(info.assertion.start)
    const cursor = Number(dispatch.facts.cursor)
    const end = Number(info.assertion.end)
    if (![start, cursor, end].every(Number.isSafeInteger)) return undefined
    return start < cursor && cursor <= end
  }
  const coverageInfos = infos.filter((info) => info.kind === 'coverage')
  for (const info of coverageInfos) {
    if (!sourceSupported(info) || !selectedOk) {
      info.dimensions.coverage = dim('unresolved', 'dependency_missing')
      continue
    }
    const a = info.assertion,
      sameSurface = eq(a.surface, source(selected).identity)
    const inWindow = inCoverageWindow(info, selected)
    if (!sameSurface || inWindow === false) {
      info.dimensions.coverage = dim('rejected', 'target_mismatch')
      continue
    }
    if (inWindow === undefined) {
      info.dimensions.coverage = dim('unresolved', 'dependency_missing')
      continue
    }
    const manifestDependencies = dependencies(info, [], ['expected', 'captured'])
    if (manifestDependencies.state !== 'supported') {
      info.dimensions.coverage = manifestDependencies
      continue
    }
    const expectedRefs = refs(info).filter(
      (ref) => ref.relation === 'expected' && ref.kind === 'artifact',
    )
    let nativeEvents: Obj[] | undefined
    async function checkManifest(entries: Obj[], ids: unknown) {
      if (!entries.length) return false
      for (const ref of entries) {
        const value = artifact(input, String(ref.hash))
        const payload = value && (await signedPayload(value, info.rule!.source_keys))
        if (!(
          payload &&
          eq(payload.surface, a.surface) &&
          payload.start === a.start &&
          payload.end === a.end &&
          eq(payload.ids, ids)
        ))
          throw new Error('dependency_invalid')
        if (!Array.isArray(payload.native_events)) return false
        if (nativeEvents && !eq(nativeEvents, payload.native_events))
          throw new Error('dependency_invalid')
        nativeEvents = payload.native_events.map(object)
        for (const entry of nativeEvents) {
          const event = artifact(input, String(entry.hash))
          if (!event || !eq(event.id, entry.id)) throw new Error('dependency_invalid')
        }
      }
      return true
    }
    let expectedOk: boolean, capturedOk: boolean
    try {
      expectedOk = await checkManifest(expectedRefs, a.expected)
      capturedOk = await checkManifest(
        refs(info).filter((ref) => ref.relation === 'captured' && ref.kind === 'artifact'),
        a.captured,
      )
    } catch (error) {
      info.dimensions.coverage = artifactFailure(error)
      continue
    }
    if (!expectedOk || !capturedOk) {
      info.dimensions.coverage = dim('unresolved', 'dependency_missing')
      continue
    }
    const native = nativeEvents?.find((event) => eq(event.id, selected.assertion.native_invocation))
    if (!native || typeof selected.facts.native_event_hash !== 'string') {
      info.dimensions.coverage = dim('unresolved', 'dependency_missing')
      continue
    }
    if (native.hash !== selected.facts.native_event_hash) {
      info.dimensions.coverage = dim('rejected', 'dependency_invalid')
      continue
    }
    const ids = Array.isArray(a.expected) ? a.expected : [],
      captured = Array.isArray(a.captured) ? a.captured : []
    const gaps = Array.isArray(a.gaps) ? a.gaps : []
    info.dimensions.coverage =
      gaps.length || ids.some((id) => !captured.some((value) => eq(value, id)))
        ? dim('rejected', 'coverage_gap')
        : !ids.some((id) => eq(id, selected.assertion.native_invocation))
          ? dim('rejected', 'target_mismatch')
          : dim('supported', undefined, [info.hash, selected.hash])
  }
  const applicableCoverage = coverageInfos.filter(
    (info) =>
      selectedOk &&
      eq(info.assertion.surface, source(selected).identity) &&
      inCoverageWindow(info, selected) === true &&
      sourceSupported(info),
  )
  if (request)
    resultDimensions.coverage = applicableCoverage.some(
      (info) => info.dimensions.coverage.state === 'rejected',
    )
      ? dim('rejected', 'coverage_gap')
      : applicableCoverage.some((info) => info.dimensions.coverage.state === 'supported')
        ? dim('supported')
        : dim(
            coverageInfos.length ? 'unresolved' : 'not_applicable',
            coverageInfos.length ? 'dependency_missing' : undefined,
          )
  const executions = infos.filter(
    (info) => isExecution(info) && sourceSupported(info) && targetOf(info) === request?.hash,
  )
  const deliveries = [...new Set(executions.map((info) => jcs(info.assertion.delivery)))]
    .sort()
    .map((id) => {
      const records = executions.filter((info) => jcs(info.assertion.delivery) === id)
      const terminal = records.filter((info) => info.assertion.phase !== 'dispatch')
      const outcomes = [...new Set(terminal.map((info) => String(info.assertion.outcome)))]
      return {
        delivery: JSON.parse(id) as unknown,
        state: outcomes.length > 1 ? 'conflict' : (outcomes[0] ?? 'unknown'),
        basis: [...new Set(records.map((info) => info.hash))].sort(),
      }
    })
  if (request) resultDimensions.publication = await inspectPublication(request.hash, input)
  const deficient = request
    ? ['integrity', ...(policy?.required ?? ['source'])]
        .filter((name) => resultDimensions[name as keyof Dimensions].state !== 'supported')
        .sort()
    : []
  return {
    policy: policy ? { id: policy.id, hash: digest(policy) } : null,
    evaluation,
    statements: infos
      .sort((a, b) => a.hash.localeCompare(b.hash))
      .map((info) => ({ record_hash: info.hash, dimensions: info.dimensions })),
    request: request
      ? {
          record_hash: request.hash,
          dimensions: resultDimensions,
          execution: { deliveries },
          destination_states: destinationStates,
          reliance: { accepted: deficient.length === 0, deficient },
        }
      : null,
  }
}
