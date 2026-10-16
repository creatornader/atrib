// SPDX-License-Identifier: Apache-2.0
import canonicalize from 'canonicalize'
import { verifyEvidencePublication, type EvidencePublicationInput } from './evidence-publication.js'
import { sha256, hexEncode, verifyRecord, type AtribRecord } from '@atrib/mcp'
import { genesisChainRoot } from '@atrib/mcp'
import {
  DECLARED_METHOD,
  EVIDENCE_PREFIX,
  evidenceBodySchemas,
  commitEvidenceBody,
  evaluationSchema,
  policySchema,
  authoritySnapshotSchema,
  isValidEventTypeUri,
  type EvidenceKind,
  type EvidencePolicy,
  type EvidenceEvaluation,
  type EvidenceScopedId,
} from '@atrib/mcp'

type Obj = Record<string, unknown>
export type EvidenceState = 'supported' | 'rejected' | 'unresolved' | 'conflict' | 'not_applicable'
export type EvidenceDimension = { state: EvidenceState; basis: string[]; reasons: string[] }
const names = ['source', 'binding', 'authority', 'effect', 'coverage', 'publication'] as const
const object = (value: unknown): Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {}
const jcs = (value: unknown): string => canonicalize(value) ?? 'null'
const digest = (value: unknown): string =>
  `sha256:${hexEncode(sha256(new TextEncoder().encode(jcs(value))))}`
const bytesHash = (value: Uint8Array) => `sha256:${hexEncode(sha256(value))}`
const eq = (a: unknown, b: unknown) => jcs(a) === jcs(b)
const dim = (state: EvidenceState, reason?: string, hashes: string[] = []): EvidenceDimension => ({
  state,
  basis: [...new Set(hashes)].sort(),
  reasons: reason ? [reason] : [],
})
const dimensions = () =>
  ({
    integrity: { ...dim('unresolved'), record: dim('unresolved'), body: dim('unresolved') },
    ...Object.fromEntries(names.map((name) => [name, dim('not_applicable')])),
  }) as EvidenceDimensions
export type EvidenceDimensions = {
  integrity: EvidenceDimension & { record: EvidenceDimension; body: EvidenceDimension }
} & Record<(typeof names)[number], EvidenceDimension>
interface Info {
  hash: string
  record: Obj
  body: Obj
  assertion: Obj
  kind: string
  dimensions: EvidenceDimensions
  facts: Obj
  sourceBasis?: string[]
  rule?: EvidencePolicy['rules'][number]
}
export interface VerifyEvidenceSetInput {
  publication?: EvidencePublicationInput
  records: readonly (Obj | AtribRecord)[]
  openings: ReadonlyMap<string, unknown>
  artifacts: ReadonlyMap<string, Uint8Array>
  policy: unknown
  evaluation: EvidenceEvaluation
  requestHash?: string
  sourceVerifiers: Readonly<Record<string, EvidenceSourceVerifier>>
}
export interface EvidenceSourceVerifier {
  verify(input: {
    record: Readonly<Obj>
    body: Readonly<Obj>
    artifacts: ReadonlyMap<string, Uint8Array>
    sourceKeys: readonly string[]
    evaluatedAt: number
  }): Promise<EvidenceSourceResult>
  compareCursors?: (a: string, b: string) => number | undefined
  singleDestinationPerDelivery?: boolean
}
export interface EvidenceSourceResult {
  state: 'supported' | 'rejected' | 'unresolved' | 'conflict'
  reasons: string[]
  basis: string[]
  facts?: {
    claim: Obj
    authority?: string[]
    cursor?: string
    native_event_hash?: string
    native_events?: Array<{ id: unknown; hash: string }>
  }
}
export interface EvidenceSetResult {
  policy: { id: string; hash: string } | null
  evaluation: EvidenceEvaluation
  statements: Array<{ record_hash: string; dimensions: EvidenceDimensions }>
  request: null | {
    record_hash: string
    dimensions: EvidenceDimensions
    execution: {
      deliveries: Array<{
        delivery: EvidenceScopedId
        state: 'success' | 'error' | 'unknown' | 'conflict'
        basis: string[]
      }>
    }
    destination_states: Array<{
      record_hash: string
      object: EvidenceScopedId
      version: { kind: 'native' | 'snapshot'; value: string }
      state: unknown
      source: EvidenceDimension
      binding: EvidenceDimension
    }>
    reliance: { accepted: boolean; deficient: Array<keyof EvidenceDimensions> }
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
function validOptionalCarrier(record: Obj): boolean {
  const hash = (value: unknown) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
  if ('content_id' in record && !hash(record.content_id)) return false
  if ('session_token' in record && typeof record.session_token !== 'string') return false
  if ('tool_name' in record && typeof record.tool_name !== 'string') return false
  if (
    'informed_by' in record &&
    (!Array.isArray(record.informed_by) || !record.informed_by.every(hash))
  )
    return false
  if (
    'provenance_token' in record &&
    (typeof record.provenance_token !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test(record.provenance_token) ||
      record.chain_root !== genesisChainRoot(String(record.context_id)))
  )
    return false
  if ('timestamp_granularity' in record) {
    const units: Record<string, number> = { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 }
    const unit = Object.hasOwn(units, String(record.timestamp_granularity))
      ? units[String(record.timestamp_granularity)]
      : undefined
    if (unit === undefined || Number(record.timestamp) % unit !== 0) return false
  }
  return true
}
export function validEvidenceCarrier(record: Obj): boolean {
  return (
    !forbidden.some((key) => key in record) &&
    validOptionalCarrier(record) &&
    requiredCarrier.every((key) => key in record) &&
    /^sha256:[0-9a-f]{64}$/.test(String(record.chain_root))
  )
}
const artifactFailure = (error: unknown): EvidenceDimension =>
  error instanceof Error && error.message === 'resource_limit'
    ? dim('unresolved', 'resource_limit')
    : dim('rejected', 'dependency_invalid')
function artifactBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 1_048_576) throw new Error('resource_limit')
  return bytes
}
function artifact(input: VerifyEvidenceSetInput, hash: string): Obj | undefined {
  const bytes = input.artifacts.get(hash)
  if (!bytes) return undefined
  artifactBytes(bytes)
  if (bytesHash(bytes) !== hash) throw new Error('dependency_invalid')
  return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
}
function claim(info: Info): Obj {
  const { nonce: _nonce, basis: _basis, ...rest } = info.body
  return rest
}
function effectPayloadMatches(info: Info, input: VerifyEvidenceSetInput): boolean {
  const payloadHash = String(info.assertion.payload_hash)
  const raw = input.artifacts.get(payloadHash)
  const cited = refs(info).some(
    (ref) => ref.kind === 'artifact' && ref.relation === 'source' && ref.hash === payloadHash,
  )
  return (
    cited &&
    !!raw &&
    bytesHash(raw) === payloadHash &&
    (object(info.assertion.version).kind !== 'snapshot' ||
      object(info.assertion.version).value === payloadHash)
  )
}
async function inspectSource(
  info: Info,
  input: VerifyEvidenceSetInput,
  policy: EvidencePolicy | undefined,
  evaluatedAt: number,
) {
  const set = (state: EvidenceState, reason?: string) => {
    info.dimensions.source = dim(state, reason, [info.hash, ...(info.sourceBasis ?? [])])
  }
  if (info.dimensions.integrity.state !== 'supported') {
    info.dimensions.source = {
      state: info.dimensions.integrity.state,
      basis: [info.hash],
      reasons: [...info.dimensions.integrity.reasons],
    }
    return
  }
  if (!policy) return set('unresolved', 'policy_invalid')
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
    const verifier = Object.hasOwn(input.sourceVerifiers, String(src.method))
      ? input.sourceVerifiers[String(src.method)]
      : undefined
    if (!verifier) return set('unresolved', 'source_untrusted')
    if (refs(info).length > 256) return set('unresolved', 'resource_limit')
    const artifacts = new Map<string, Uint8Array>()
    let artifactSize = 0
    for (const ref of refs(info).filter((ref) => ref.kind === 'artifact')) {
      const bytes = input.artifacts.get(String(ref.hash))
      if (!bytes) continue
      if (ref.relation !== 'source' && (bytes.length > 1_048_576 || bytesHash(bytes) !== ref.hash))
        continue
      artifactBytes(bytes)
      artifactSize += bytes.length
      if (artifactSize > 16_777_216) return set('unresolved', 'resource_limit')
      if (bytesHash(bytes) !== ref.hash) throw new Error('dependency_invalid')
      artifacts.set(String(ref.hash), Uint8Array.from(bytes))
    }
    const result = await verifier.verify({
      record: structuredClone(info.record),
      body: structuredClone(info.body),
      artifacts,
      sourceKeys: [...rule.source_keys],
      evaluatedAt,
    })
    if (result.state !== 'supported') {
      info.dimensions.source = {
        state: result.state,
        basis: [...new Set(result.basis)].sort(),
        reasons: [...new Set(result.reasons)].sort(),
      }
      return
    }
    const facts = result.facts
    if (!result.basis.length || result.basis.some((hash) => !artifacts.has(hash)))
      return set('rejected', 'dependency_invalid')
    if (
      !result.basis.some((hash) =>
        refs(info).some(
          (ref) => ref.relation === 'source' && ref.kind === 'artifact' && ref.hash === hash,
        ),
      )
    )
      return set('rejected', 'source_untrusted')
    if (
      !facts ||
      !eq(facts.claim, claim(info)) ||
      !eq(
        facts.authority ?? [],
        refs(info)
          .filter((ref) => ref.relation === 'authority' && ref.kind === 'record')
          .map((ref) => ref.hash)
          .sort(),
      )
    )
      return set('rejected', 'source_untrusted')
    info.facts = facts as unknown as Obj
    info.sourceBasis = result.basis
  }
  if (info.kind === 'effect' && !effectPayloadMatches(info, input))
    return set('rejected', 'dependency_invalid')
  const age =
    evaluatedAt - Number(src.kind === 'declared' ? info.record.timestamp : src.observed_at)
  if (age < 0 || age > rule.max_age_ms) return set('unresolved', 'freshness_unknown')
  return set('supported')
}

function preflight(options: VerifyEvidenceSetInput): void {
  if (
    options.records.length > 4096 ||
    options.openings.size > 4096 ||
    options.artifacts.size > 4096
  )
    throw new RangeError('resource_limit')
  let nodes = 0
  let bytes = 0
  const path = new Set<object>()
  function json(value: unknown, depth: number): void {
    if (++nodes > 100_000 || depth > 64) throw new RangeError('resource_limit')
    if (typeof value === 'string') {
      bytes += new TextEncoder().encode(value).length
      if (bytes > 67_108_864) throw new RangeError('resource_limit')
      return
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw new TypeError('invalid_evidence_input: JSON values required')
    if (path.has(value)) throw new TypeError('invalid_evidence_input: cyclic JSON')
    path.add(value)
    for (const child of Object.values(value)) json(child, depth + 1)
    path.delete(value)
  }
  for (const record of options.records) json(record, 0)
  for (const body of options.openings.values()) json(body, 0)
  if (options.policy !== undefined) json(options.policy, 0)
  json(options.evaluation, 0)
  for (const artifact of options.artifacts.values()) {
    if (!(artifact instanceof Uint8Array))
      throw new TypeError('invalid_evidence_input: artifact bytes required')
    bytes += artifact.length
    if (bytes > 67_108_864) throw new RangeError('resource_limit')
  }
}

export async function verifyEvidenceSet(
  options: VerifyEvidenceSetInput,
): Promise<EvidenceSetResult> {
  preflight(options)
  const { sourceVerifiers, publication, openings, artifacts, ...data } = options
  const input = {
    ...structuredClone({ ...data, openings: new Map(openings) }),
    artifacts: new Map([...artifacts].map(([hash, bytes]) => [hash, Uint8Array.from(bytes)])),
    sourceVerifiers,
    ...(publication === undefined ? {} : { publication }),
  }
  const parsedPolicy = policySchema.safeParse(input.policy)
  const policy = parsedPolicy.success ? parsedPolicy.data : undefined
  const evaluation = evaluationSchema.parse(input.evaluation)
  const infos: Info[] = []
  const uniqueRecords = new Map<string, { canonical: string; record: Obj }>()
  for (const record of input.records) {
    const hash = digest(record)
    const canonical = jcs(record)
    const existing = uniqueRecords.get(hash)
    if (existing && existing.canonical !== canonical)
      throw new TypeError('invalid_evidence_input: conflicting record hash')
    if (!existing) uniqueRecords.set(hash, { canonical, record: object(record) })
  }
  for (const [hash, { record }] of uniqueRecords) {
    const body = object(input.openings.get(hash))
    const kind = String(record.event_type).startsWith(EVIDENCE_PREFIX)
      ? String(record.event_type).slice(EVIDENCE_PREFIX.length)
      : 'unknown'
    const dimensions_ = dimensions()
    const recordSchemaOk =
      record.spec_version === 'atrib/1.0' &&
      isValidEventTypeUri(record.event_type) &&
      /^[0-9a-f]{32}$/.test(String(record.context_id)) &&
      Number.isSafeInteger(record.timestamp) &&
      Number(record.timestamp) >= 0 &&
      Number(record.timestamp) <= evaluation.evaluated_at + 300_000
    const recordOk =
      recordSchemaOk &&
      (await verifyRecord(record as unknown as AtribRecord, { nowMs: evaluation.evaluated_at }))
    dimensions_.integrity.record = dim(
      recordOk ? 'supported' : 'rejected',
      recordOk ? undefined : recordSchemaOk ? 'signature_invalid' : 'schema_invalid',
      [hash],
    )
    let bodyResult = dim('supported', undefined, [hash])
    if (!Object.hasOwn(evidenceBodySchemas, kind)) bodyResult = dim('unresolved', 'unknown_type')
    else if (!validEvidenceCarrier(record)) bodyResult = dim('rejected', 'schema_invalid')
    else if (!input.openings.has(hash)) bodyResult = dim('unresolved', 'body_missing')
    else {
      try {
        if (commitEvidenceBody(kind as EvidenceKind, body) !== record.args_hash)
          bodyResult = dim('rejected', 'opening_mismatch')
      } catch (error) {
        bodyResult =
          error instanceof Error && error.message === 'resource_limit'
            ? dim('unresolved', 'resource_limit')
            : dim('rejected', 'schema_invalid')
      }
    }
    dimensions_.integrity.body = bodyResult
    dimensions_.publication = await verifyEvidencePublication(hash, input.publication)
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
  function dependencies(
    info: Info,
    _path: string[] = [],
    relations = ['source'],
  ): EvidenceDimension {
    const failures: EvidenceDimension[] = []
    let count = 0
    let bytesSeen = 0
    function walk(node: Info, path: string[], selectedRelations: string[]) {
      if (path.includes(node.hash)) {
        failures.push(dim('unresolved', 'dependency_cycle'))
        return
      }
      if (path.length > 32) {
        failures.push(dim('unresolved', 'resource_limit'))
        return
      }
      const entries = refs(node)
        .filter((ref) => selectedRelations.includes(String(ref.relation)))
        .sort((a, b) => jcs(a).localeCompare(jcs(b)))
      for (const ref of entries) {
        if (++count > 256) {
          failures.push(dim('unresolved', 'resource_limit'))
          break
        }
        if (ref.kind === 'artifact') {
          const bytes = input.artifacts.get(String(ref.hash))
          if (!bytes) {
            failures.push(dim('unresolved', 'dependency_missing'))
            continue
          }
          bytesSeen += bytes.length
          if (bytesSeen > 16_777_216) {
            failures.push(dim('unresolved', 'resource_limit'))
            break
          }
          try {
            artifactBytes(bytes)
            if (bytesHash(bytes) !== ref.hash) failures.push(dim('rejected', 'dependency_invalid'))
          } catch (error) {
            failures.push(artifactFailure(error))
          }
        } else {
          const linked = byHash.get(String(ref.hash))
          if (!linked || linked.dimensions.integrity.state === 'unresolved')
            failures.push(dim('unresolved', 'dependency_missing'))
          else if (linked.dimensions.integrity.state === 'rejected')
            failures.push(dim('rejected', 'dependency_invalid'))
          else
            walk(
              linked,
              [...path, node.hash],
              ['source', 'authority', 'expected', 'captured', 'binding'],
            )
        }
      }
    }
    walk(info, [], relations)
    if (!failures.length) return dim('supported')
    return {
      state: failures.some((value) => value.state === 'rejected') ? 'rejected' : 'unresolved',
      basis: [],
      reasons: [...new Set(failures.flatMap((value) => value.reasons))].sort(),
    }
  }
  for (const info of infos) {
    const dependency = dependencies(info)
    if (dependency.state !== 'supported') {
      const current = info.dimensions.source
      const precedence: Record<EvidenceState, number> = {
        rejected: 4,
        conflict: 3,
        unresolved: 2,
        supported: 1,
        not_applicable: 0,
      }
      info.dimensions.source = {
        state:
          precedence[current.state] >= precedence[dependency.state]
            ? current.state
            : dependency.state,
        basis: [...new Set([...current.basis, ...dependency.basis])].sort(),
        reasons: [...new Set([...current.reasons, ...dependency.reasons])].sort(),
      }
    }
  }
  const requested = byHash.get(String(input.requestHash))
  const request = requested?.kind === 'request' ? requested : undefined
  const targetOf = (info: Info) => object(info.body.target).record_hash
  const target = (info: Info) => byHash.get(String(targetOf(info)))
  function binding(info: Info): EvidenceDimension {
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
  const singleDestinationPerDelivery = (info: Info) =>
    input.sourceVerifiers[String(source(info).method)]?.singleDestinationPerDelivery === true
  const destinationConflict = (a: Info, b: Info) =>
    singleDestinationPerDelivery(a) &&
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
  const applicableAuthorizations = new Set<string>()
  function authorize(info: Info): EvidenceDimension {
    if (!request || decisionTime === undefined) return dim('unresolved', 'authority_invalid')
    if (info.kind !== 'authorization' || targetOf(info) !== request.hash)
      return dim('rejected', 'target_mismatch')
    if (info.dimensions.source.state === 'rejected' || info.dimensions.binding.state === 'rejected')
      return dim('rejected', 'authority_invalid')
    if (info.dimensions.source.state === 'conflict') return dim('conflict', 'authority_invalid')
    if (info.dimensions.binding.state !== 'supported' || !sourceSupported(info))
      return dim('unresolved', 'authority_invalid')
    const authorityDependencies = dependencies(info, [], ['authority'])
    if (authorityDependencies.state !== 'supported') return authorityDependencies
    const a = assertion(info),
      rule = info.rule!
    if (
      !rule.authority_versions.includes(String(a.authority_version)) ||
      !rule.authorized_descriptors.some((value) => eq(value, request.assertion.descriptor))
    )
      return dim('rejected', 'authority_invalid')
    if (!(Number(a.not_before) <= decisionTime && decisionTime < Number(a.expires_at)))
      return dim('rejected', 'authority_invalid')
    const grants = new Map<string, Obj>()
    for (const ref of refs(info).filter(
      (ref) => ref.relation === 'authority' && ref.kind === 'artifact',
    )) {
      try {
        const grant = artifact(input, String(ref.hash))
        if (!grant) return dim('unresolved', 'dependency_missing')
        grants.set(String(ref.hash), grant)
      } catch (error) {
        return artifactFailure(error)
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
      const grant = grants.get(String(ref.hash))!
      if (!authoritySnapshotSchema.safeParse(grant).success)
        return dim('rejected', 'authority_invalid')
      if (
        grant.version !== a.authority_version ||
        grant.revoked !== false ||
        !(Number(grant.not_before) <= decisionTime && decisionTime < Number(grant.expires_at))
      )
        return dim('rejected', 'authority_invalid')
    }
    applicableAuthorizations.add(info.hash)
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
        : selectedOk || (selected && !sourceSupported(selected))
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
      const destinationConflicts = new Set<Info>()
      for (const [index, a] of sameOccurrence.entries())
        for (const b of sameOccurrence.slice(index + 1))
          if (destinationConflict(a, b)) {
            destinationConflicts.add(a)
            destinationConflicts.add(b)
          }
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
    if (
      evaluation.purpose === 'historical' &&
      selectedOk &&
      resultDimensions.binding.state !== 'supported'
    )
      resultDimensions.authority = dim(
        resultDimensions.binding.state === 'rejected'
          ? 'rejected'
          : resultDimensions.binding.state === 'conflict'
            ? 'conflict'
            : 'unresolved',
        'authority_invalid',
      )
    else if (evaluation.purpose === 'current' && dispatches.length)
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
          .filter((info) => applicableAuthorizations.has(info.hash))
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
      eq(selected.body.subject, observed.body.subject) &&
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
      object: info.assertion.object as EvidenceScopedId,
      version: info.assertion.version as { kind: 'native' | 'snapshot'; value: string },
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
        ((selectedOk && singleDestinationPerDelivery(selected)) ||
          joinedEffects.some((info) => {
            const observed = byHash.get(String(object(info.assertion.binding).observation_record))
            return observed && singleDestinationPerDelivery(observed)
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
    if (source(info).method !== source(dispatch).method) return undefined
    const compare = input.sourceVerifiers[String(source(info).method)]?.compareCursors
    if (!compare || typeof dispatch.facts.cursor !== 'string') return undefined
    const start = compare(String(info.assertion.start), dispatch.facts.cursor)
    const end = compare(dispatch.facts.cursor, String(info.assertion.end))
    return start === undefined || end === undefined ? undefined : start < 0 && end <= 0
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
    const expectedOk = refs(info).some(
      (ref) => ref.relation === 'expected' && ref.kind === 'artifact',
    )
    const capturedOk = refs(info).some(
      (ref) => ref.relation === 'captured' && ref.kind === 'artifact',
    )
    if (!expectedOk || !capturedOk) {
      info.dimensions.coverage = dim('unresolved', 'dependency_missing')
      continue
    }
    const nativeEvents = info.facts.native_events
    if (nativeEvents !== undefined || selected.facts.native_event_hash !== undefined) {
      if (!Array.isArray(nativeEvents) || typeof selected.facts.native_event_hash !== 'string') {
        info.dimensions.coverage = dim('unresolved', 'dependency_missing')
        continue
      }
      const native = nativeEvents
        .map(object)
        .find((event) => eq(event.id, selected.assertion.native_invocation))
      if (!native) {
        info.dimensions.coverage = dim('unresolved', 'dependency_missing')
        continue
      }
      if (native.hash !== selected.facts.native_event_hash) {
        info.dimensions.coverage = dim('rejected', 'dependency_invalid')
        continue
      }
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
      inCoverageWindow(info, selected) &&
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
        delivery: JSON.parse(id) as EvidenceScopedId,
        state: (outcomes.length > 1 ? 'conflict' : (outcomes[0] ?? 'unknown')) as
          'success' | 'error' | 'unknown' | 'conflict',
        basis: [...new Set(records.map((info) => info.hash))].sort(),
      }
    })
  if (request) resultDimensions.publication = request.dimensions.publication
  const deficient = request
    ? (['integrity', ...(policy?.required ?? ['source'])]
        .filter((name) => resultDimensions[name as keyof EvidenceDimensions].state !== 'supported')
        .sort() as Array<keyof EvidenceDimensions>)
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
