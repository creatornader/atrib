// SPDX-License-Identifier: Apache-2.0

import canonicalize from 'canonicalize'
import { sha256 } from '@noble/hashes/sha2.js'
import { verifyRecord, commitEvidenceBody, type AtribRecord } from '@atrib/mcp'
import {
  createHostCaptureSourceVerifier,
  type EvidenceSourceVerifier,
  type EvidenceSourceResult,
} from '@atrib/verify'

import {
  hashCanonical,
  hashLogWindowManifest,
  isSha256Uri,
  verifyLogWindowManifest,
  type LogWindowBounds,
  type LogWindowManifest,
  type RuntimeLogRuntimeRef,
  type RuntimeLogSourceRef,
  type RuntimeLogEventRef,
  type SessionDefinitionRef,
  type Sha256Uri,
} from './index.js'

export const RUNTIME_COVERAGE_METHOD =
  'https://atrib.dev/evidence/v1/method/runtime-coverage/1' as const

type ScopedId = { namespace: string; id: string }
type SignedRecord = AtribRecord
export interface CapturedCoverageEvent {
  readonly record: SignedRecord
  readonly payload: Record<string, unknown>
}
export interface ProjectCoverageEvidenceInput {
  readonly manifest: CoverageManifest
  readonly logWindowManifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly surfaceId: string
  readonly sourceIdentity: ScopedId
  readonly invocationNamespace: string
  readonly nonce: string
  readonly observedAt: number
  readonly coverageAttestationRecord: SignedRecord
  readonly logWindowRecord: SignedRecord
  readonly capturedEvents: readonly CapturedCoverageEvent[]
}

/** Projects D168's inventory. The pinned native host remains the trust boundary. */
export function projectCoverageEvidence(input: ProjectCoverageEvidenceInput) {
  const assertion = coverageAssertion(input)
  const artifacts = new Map<string, Uint8Array>()
  const add = (value: unknown) => {
    const bytes = new TextEncoder().encode(canonicalize(value)!)
    const hash = hashCanonical(value)
    artifacts.set(hash, bytes)
    return hash
  }
  const body = {
    nonce: input.nonce,
    subject: input.sourceIdentity,
    source: {
      kind: 'manifest' as const,
      identity: input.sourceIdentity,
      method: RUNTIME_COVERAGE_METHOD,
      observed_at: input.observedAt,
    },
    assertion,
    basis: [
      { relation: 'source', kind: 'artifact', hash: add(input.coverageAttestationRecord) },
      { relation: 'source', kind: 'artifact', hash: add(input.logWindowRecord) },
      { relation: 'captured', kind: 'artifact', hash: add(input.manifest) },
      { relation: 'expected', kind: 'artifact', hash: add(input.logWindowManifest) },
      { relation: 'expected', kind: 'artifact', hash: add(input.events) },
      ...input.capturedEvents.map((event) => ({
        relation: 'captured',
        kind: 'artifact',
        hash: add(event),
      })),
    ],
  }
  commitEvidenceBody('coverage', body)
  return { body, artifacts }
}

function coverageAssertion(
  input: Omit<
    ProjectCoverageEvidenceInput,
    'nonce' | 'observedAt' | 'coverageAttestationRecord' | 'logWindowRecord' | 'capturedEvents'
  >,
) {
  const { manifest, logWindowManifest, events, surfaceId, sourceIdentity, invocationNamespace } =
    input
  const surface = manifest.surfaces[0]
  if (
    manifest.surfaces.length !== 1 ||
    surface?.id !== surfaceId ||
    surface.action_kinds?.length !== 1 ||
    sourceIdentity.id !== manifest.source.id ||
    invocationNamespace !== `${sourceIdentity.namespace}/invocations` ||
    events.length === 0 ||
    events.length > 128 ||
    manifest.actions.some((action) => action.surface_id !== surfaceId)
  )
    throw new Error('unsupported_coverage_profile')
  const first = events[0]!.position
  if (
    typeof first !== 'number' ||
    !Number.isSafeInteger(first) ||
    first <= 0 ||
    events.some(
      (event, index) =>
        !event.event_id ||
        event.kind !== surface.action_kinds![0] ||
        typeof event.position !== 'number' ||
        !Number.isSafeInteger(event.position) ||
        event.position !== first + index,
    ) ||
    new Set(events.map((event) => event.event_id)).size !== events.length
  )
    throw new Error('unsupported_coverage_cursor')
  if (!verifyLogWindowManifest(logWindowManifest, { events }).valid)
    throw new Error('runtime_window_invalid')
  const expected = events.map((event) => ({
    action_id: event.event_id,
    surface_id: surfaceId,
    action_hash: event.event_hash,
  }))
  const validation = verifyCoverageManifest(
    manifest,
    { log_window_manifest: logWindowManifest, expected_actions: expected },
    { allow_skipped_required: true, allow_degraded_required: true },
  )
  if (validation.issues.some((issue) => issue.code !== 'expected_action_omitted'))
    throw new Error('coverage_manifest_invalid')
  const id = (value: string): ScopedId => ({ namespace: invocationNamespace, id: value })
  const actions = new Map(manifest.actions.map((action) => [action.action_id, action]))
  return {
    surface: sourceIdentity,
    start: String(first - 1),
    end: String(events.at(-1)!.position),
    expected: events.map((event) => id(event.event_id)),
    captured: events
      .filter((event) => actions.get(event.event_id)?.state === 'captured')
      .map((event) => id(event.event_id)),
    gaps: events.flatMap((event) => {
      const action = actions.get(event.event_id)
      return action?.state === 'captured'
        ? []
        : [{ id: id(event.event_id), reason: action?.reason_code ?? 'expected_action_omitted' }]
    }),
  }
}

const coverageObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('coverage_artifact_invalid')
  return value as Record<string, unknown>
}
const coverageBytesHash = (bytes: Uint8Array) =>
  `sha256:${Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
const coverageFailure = (
  state: 'rejected' | 'unresolved',
  reason: string,
): EvidenceSourceResult => ({
  state,
  reasons: [`https://atrib.dev/evidence/v1/reason/${reason}`],
  basis: [],
})
const runtimeHostVerifier = createHostCaptureSourceVerifier(RUNTIME_COVERAGE_METHOD)

async function nativeCapture(input: Parameters<EvidenceSourceVerifier['verify']>[0]) {
  const result = await runtimeHostVerifier.verify(input)
  if (result.state !== 'supported') return { result }
  const refs = input.body.basis as Array<{ relation: string; hash: string }>
  const hash = refs.find((ref) => ref.relation === 'source')!.hash
  const wrapper = coverageObject(JSON.parse(new TextDecoder().decode(input.artifacts.get(hash)!)))
  const captured = coverageObject(wrapper.payload)
  if (
    captured.payload === undefined ||
    coverageObject(captured.payload).runtime_event === undefined
  )
    return { result: coverageFailure('unresolved', 'coverage-native-event-missing') }
  const native = coverageObject(coverageObject(captured.payload).runtime_event)
  const assertion = coverageObject(input.body.assertion)
  const source = coverageObject(input.body.source)
  const identity = coverageObject(source.identity)
  const invocation = coverageObject(assertion.native_invocation)
  if (
    !Number.isSafeInteger(native.position) ||
    Number(native.position) <= 0 ||
    native.context_id !== input.record.context_id ||
    !native.event_id ||
    typeof native.kind !== 'string' ||
    invocation.namespace !== `${identity.namespace}/invocations` ||
    invocation.id !== native.event_id ||
    canonicalize(native.descriptor) !== canonicalize(assertion.descriptor)
  )
    return { result: coverageFailure('rejected', 'coverage-native-event-mismatch') }
  return {
    result: {
      ...result,
      facts: {
        ...result.facts!,
        cursor: String(native.position),
        native_event_hash: hashCanonical(native),
      },
    },
    native,
    wrapper,
  }
}

/** Replays exact native inventory bytes and both existing host commitments. */
export const runtimeCoverageSourceVerifier: EvidenceSourceVerifier = {
  compareCursors(a, b) {
    const cursor = (value: string) =>
      /^(0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value))
        ? Number(value)
        : undefined
    const left = cursor(a),
      right = cursor(b)
    return left === undefined || right === undefined ? undefined : Math.sign(left - right)
  },
  async verify({ record, body, artifacts, sourceKeys, evaluatedAt }) {
    try {
      const source = coverageObject(body.source)
      if (source.kind === 'boundary')
        return (await nativeCapture({ record, body, artifacts, sourceKeys, evaluatedAt })).result
      if (source.kind !== 'manifest' || source.method !== RUNTIME_COVERAGE_METHOD)
        return coverageFailure('rejected', 'coverage-method-mismatch')
      const refs = body.basis as Array<{ kind: string; relation: string; hash: string }>
      if (!Array.isArray(refs) || refs.length > 256 || refs.some((ref) => ref.kind !== 'artifact'))
        return coverageFailure('rejected', 'coverage-basis-invalid')
      const parsed: Array<{ relation: string; hash: string; value: unknown }> = []
      for (const ref of refs) {
        const bytes = artifacts.get(ref.hash)
        if (!bytes) return coverageFailure('unresolved', 'coverage-input-missing')
        if (bytes.length > 1_048_576 || coverageBytesHash(bytes) !== ref.hash)
          return coverageFailure('rejected', 'coverage-hash-mismatch')
        parsed.push({
          ...ref,
          value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        })
      }
      if (
        parsed.filter((entry) => entry.relation === 'source').length < 2 ||
        parsed.filter((entry) => entry.relation === 'expected').length < 2
      )
        return coverageFailure('unresolved', 'coverage-input-missing')
      const one = (relation: string, test: (value: unknown) => boolean) => {
        const matches = parsed.filter((entry) => entry.relation === relation && test(entry.value))
        if (matches.length !== 1) throw new Error('coverage_artifact_ambiguous')
        return matches[0]!.value
      }
      const manifest = one(
        'captured',
        (value) =>
          !Array.isArray(value) && coverageObject(value).schema === COVERAGE_MANIFEST_SCHEMA,
      ) as CoverageManifest
      const logWindowManifest = one(
        'expected',
        (value) =>
          !Array.isArray(value) &&
          coverageObject(value).schema ===
            'https://atrib.dev/schemas/runtime-log/log-window-manifest/v0',
      ) as LogWindowManifest
      const events = one('expected', Array.isArray) as RuntimeLogEventRef[]
      const coverageCommitment = hashCoverageAttestationContent(manifest)
      for (const commitment of [coverageCommitment, hashLogWindowManifest(logWindowManifest)]) {
        const signed = one(
          'source',
          (value) => coverageObject(value).args_hash === commitment,
        ) as SignedRecord
        if (!sourceKeys.includes(signed.creator_key))
          return coverageFailure('rejected', 'coverage-key-untrusted')
        if (
          signed.context_id !== record.context_id ||
          signed.timestamp > evaluatedAt ||
          signed.timestamp > Number(source.observed_at) ||
          (commitment === coverageCommitment && signed.timestamp !== source.observed_at) ||
          signed.args_salt !== undefined ||
          signed.event_type !== 'https://atrib.dev/v1/types/observation' ||
          !(await verifyRecord(signed, { nowMs: evaluatedAt }))
        )
          return coverageFailure('rejected', 'coverage-signature-invalid')
      }
      if (manifest.session.id !== record.context_id)
        return coverageFailure('rejected', 'coverage-session-mismatch')
      const sourceIdentity = coverageObject(source.identity) as ScopedId
      const assertion = coverageAssertion({
        manifest,
        logWindowManifest,
        events,
        surfaceId: manifest.surfaces[0]!.id,
        sourceIdentity,
        invocationNamespace: `${sourceIdentity.namespace}/invocations`,
      })
      const capturedRecordHashes: Sha256Uri[] = []
      for (const action of manifest.actions.filter((action) => action.state === 'captured')) {
        const item = parsed.find(
          (entry) =>
            entry.relation === 'captured' &&
            !Array.isArray(entry.value) &&
            coverageObject(entry.value).record &&
            hashCanonical(coverageObject(entry.value).record) === action.record_hash,
        )
        if (!item) return coverageFailure('unresolved', 'coverage-captured-event-missing')
        const wrapper = coverageObject(item.value)
        const payload = coverageObject(wrapper.payload)
        const claim = coverageObject(payload.claim)
        const authorities = payload.authority as string[]
        const native = await nativeCapture({
          record,
          body: {
            ...claim,
            basis: [
              { relation: 'source', kind: 'artifact', hash: item.hash },
              ...authorities.map((hash) => ({ relation: 'authority', kind: 'record', hash })),
            ],
          },
          artifacts: new Map([[item.hash, artifacts.get(item.hash)!]]),
          sourceKeys,
          evaluatedAt,
        })
        if (native.result.state !== 'supported') return native.result
        const event = events.find((event) => event.event_id === action.action_id)
        if (
          !event ||
          event.event_hash !== hashCanonical(native.native) ||
          event.position !== native.native!.position ||
          event.kind !== native.native!.kind ||
          canonicalize(coverageObject(claim.source).identity) !== canonicalize(sourceIdentity) ||
          coverageObject(claim.assertion).phase !== 'dispatch'
        )
          return coverageFailure('rejected', 'coverage-native-event-mismatch')
        capturedRecordHashes.push(action.record_hash!)
      }
      const compared = verifyCoverageManifest(
        manifest,
        { record_hashes: capturedRecordHashes },
        {
          require_record_evidence: true,
          allow_skipped_required: true,
          allow_degraded_required: true,
        },
      )
      if (!compared.valid) return coverageFailure('rejected', 'coverage-captured-event-invalid')
      if (
        canonicalize(assertion) !== canonicalize(body.assertion) ||
        canonicalize(sourceIdentity) !== canonicalize(body.subject)
      )
        return coverageFailure('rejected', 'coverage-projection-mismatch')
      const { nonce: _nonce, basis: _basis, ...claim } = body
      return {
        state: 'supported',
        reasons: [],
        basis: parsed.map((entry) => entry.hash),
        facts: {
          claim,
          coverage: {
            ...assertion,
            native_events: events.map((event) => ({
              id: { namespace: `${sourceIdentity.namespace}/invocations`, id: event.event_id },
              hash: event.event_hash,
            })),
          },
        },
      }
    } catch {
      return coverageFailure('rejected', 'coverage-input-invalid')
    }
  },
}

export const COVERAGE_MANIFEST_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/coverage-manifest/v0' as const

export const COVERAGE_ATTESTATION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/coverage-attestation/v0' as const

export type CoverageActionState = 'captured' | 'skipped' | 'degraded'

export interface CoverageSurface {
  readonly id: string
  readonly boundary: string
  readonly owner: string
  readonly required: boolean
  readonly action_kinds?: readonly string[]
}

export interface CoverageActionRef {
  readonly action_id: string
  readonly surface_id: string
  readonly action_hash: Sha256Uri
  readonly state: CoverageActionState
  readonly record_hash?: Sha256Uri
  readonly reason_code?: string
}

export interface ExpectedCoverageAction {
  readonly action_id: string
  readonly surface_id: string
  readonly action_hash: Sha256Uri
}

export interface CoverageSummary {
  readonly expected: number
  readonly captured: number
  readonly skipped: number
  readonly degraded: number
}

export interface CoverageCanonicalization {
  readonly algorithm: 'jcs-sha256-v0'
  readonly surfaces_root_rule: string
  readonly actions_root_rule: string
  readonly manifest_hash_rule: string
}

export const COVERAGE_CANONICALIZATION_V0 = {
  algorithm: 'jcs-sha256-v0',
  surfaces_root_rule: 'sha256(JCS(surfaces sorted by id))',
  actions_root_rule: 'sha256(JCS(actions sorted by action_id))',
  manifest_hash_rule: 'sha256(JCS(coverage_manifest))',
} as const satisfies CoverageCanonicalization

export interface CoverageManifest {
  readonly schema: typeof COVERAGE_MANIFEST_SCHEMA
  readonly source: RuntimeLogSourceRef
  readonly runtime: RuntimeLogRuntimeRef
  readonly session: SessionDefinitionRef
  readonly window: LogWindowBounds
  readonly log_window_manifest_hash: Sha256Uri
  readonly surfaces_root: Sha256Uri
  readonly actions_root: Sha256Uri
  readonly surfaces: readonly CoverageSurface[]
  readonly actions: readonly CoverageActionRef[]
  readonly summary: CoverageSummary
  readonly canonicalization: CoverageCanonicalization
  readonly created_at?: string
}

export interface CreateCoverageManifestInput {
  readonly log_window_manifest: LogWindowManifest
  readonly surfaces: readonly CoverageSurface[]
  readonly actions: readonly CoverageActionRef[]
  readonly created_at?: string
}

export interface CoverageAttestationContent {
  readonly schema: typeof COVERAGE_ATTESTATION_SCHEMA
  readonly coverage_manifest_hash: Sha256Uri
  readonly log_window_manifest_hash: Sha256Uri
  readonly summary: CoverageSummary
}

export interface CoverageVerificationPolicy {
  readonly require_attestation?: boolean
  readonly require_log_window_manifest?: boolean
  readonly require_expected_action_evidence?: boolean
  readonly require_record_evidence?: boolean
  readonly allow_skipped_required?: boolean
  readonly allow_degraded_required?: boolean
}

export interface CoverageVerificationEvidence {
  readonly attestation_args_hash?: Sha256Uri
  readonly log_window_manifest?: LogWindowManifest
  readonly expected_actions?: readonly ExpectedCoverageAction[]
  readonly record_hashes?: readonly Sha256Uri[]
}

export type CoverageVerificationIssueCode =
  | 'unsupported_coverage_schema'
  | 'surface_definition_invalid'
  | 'surface_id_duplicate'
  | 'surface_root_mismatch'
  | 'action_definition_invalid'
  | 'action_id_duplicate'
  | 'action_surface_unknown'
  | 'action_state_invalid'
  | 'action_root_mismatch'
  | 'summary_mismatch'
  | 'attestation_missing'
  | 'attestation_mismatch'
  | 'log_window_manifest_missing'
  | 'log_window_manifest_mismatch'
  | 'expected_action_evidence_missing'
  | 'expected_action_evidence_invalid'
  | 'expected_action_evidence_duplicate'
  | 'expected_action_omitted'
  | 'expected_action_mismatch'
  | 'unexpected_action_claim'
  | 'record_evidence_missing'
  | 'captured_record_missing'
  | 'required_action_skipped'
  | 'required_action_degraded'

export interface CoverageVerificationIssue {
  readonly severity: 'error' | 'warning'
  readonly code: CoverageVerificationIssueCode
  readonly message: string
  readonly action_id?: string
  readonly surface_id?: string
}

export interface CoverageVerificationResult {
  readonly valid: boolean
  readonly basis: 'manifest-claim' | 'runtime-compared'
  readonly summary: CoverageSummary
  readonly issues: readonly CoverageVerificationIssue[]
}

export function createCoverageManifest(input: CreateCoverageManifestInput): CoverageManifest {
  const surfaces = [...input.surfaces].sort((left, right) => left.id.localeCompare(right.id))
  const actions = [...input.actions].sort((left, right) =>
    left.action_id.localeCompare(right.action_id),
  )
  assertCoverageDefinitions(surfaces, actions)
  const manifest: CoverageManifest = {
    schema: COVERAGE_MANIFEST_SCHEMA,
    source: input.log_window_manifest.source,
    runtime: input.log_window_manifest.runtime,
    session: input.log_window_manifest.session,
    window: input.log_window_manifest.window,
    log_window_manifest_hash: hashLogWindowManifest(input.log_window_manifest),
    surfaces_root: hashCoverageSurfaces(surfaces),
    actions_root: hashCoverageActions(actions),
    surfaces,
    actions,
    summary: summarizeCoverage(actions),
    canonicalization: COVERAGE_CANONICALIZATION_V0,
    ...(input.created_at ? { created_at: input.created_at } : {}),
  }
  return manifest
}

export function hashCoverageSurfaces(surfaces: readonly CoverageSurface[]): Sha256Uri {
  return hashCanonical(
    [...surfaces].sort((left, right) => left.id.localeCompare(right.id)),
    'coverage surfaces',
  )
}

export function hashCoverageActions(actions: readonly CoverageActionRef[]): Sha256Uri {
  return hashCanonical(
    [...actions].sort((left, right) => left.action_id.localeCompare(right.action_id)),
    'coverage actions',
  )
}

export function hashCoverageManifest(manifest: CoverageManifest): Sha256Uri {
  return hashCanonical(manifest, 'coverage manifest')
}

export function buildCoverageAttestationContent(
  manifest: CoverageManifest,
): CoverageAttestationContent {
  return {
    schema: COVERAGE_ATTESTATION_SCHEMA,
    coverage_manifest_hash: hashCoverageManifest(manifest),
    log_window_manifest_hash: manifest.log_window_manifest_hash,
    summary: manifest.summary,
  }
}

export function hashCoverageAttestationContent(manifest: CoverageManifest): Sha256Uri {
  return hashCanonical(buildCoverageAttestationContent(manifest), 'coverage attestation content')
}

export function verifyCoverageManifest(
  manifest: CoverageManifest,
  evidence: CoverageVerificationEvidence = {},
  policy: CoverageVerificationPolicy = {},
): CoverageVerificationResult {
  const issues: CoverageVerificationIssue[] = []
  const add = (
    code: CoverageVerificationIssueCode,
    message: string,
    fields: Pick<CoverageVerificationIssue, 'action_id' | 'surface_id'> = {},
    severity: 'error' | 'warning' = 'error',
  ): void => {
    issues.push({ severity, code, message, ...fields })
  }

  if (manifest.schema !== COVERAGE_MANIFEST_SCHEMA) {
    add('unsupported_coverage_schema', `unsupported coverage schema: ${String(manifest.schema)}`)
  }

  const surfaceIds = new Set<string>()
  for (const surface of manifest.surfaces) {
    if (!validSurface(surface)) {
      add('surface_definition_invalid', `surface ${surface.id || '<empty>'} is malformed`, {
        surface_id: surface.id,
      })
    }
    if (surfaceIds.has(surface.id)) {
      add('surface_id_duplicate', `surface ${surface.id} appears more than once`, {
        surface_id: surface.id,
      })
    }
    surfaceIds.add(surface.id)
  }
  if (manifest.surfaces_root !== hashCoverageSurfaces(manifest.surfaces)) {
    add('surface_root_mismatch', 'coverage surface root does not match the surface definitions')
  }

  const actionIds = new Set<string>()
  for (const action of manifest.actions) {
    if (!validActionShape(action)) {
      add('action_definition_invalid', `action ${action.action_id || '<empty>'} is malformed`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    }
    if (actionIds.has(action.action_id)) {
      add('action_id_duplicate', `action ${action.action_id} appears more than once`, {
        action_id: action.action_id,
      })
    }
    actionIds.add(action.action_id)
    if (!surfaceIds.has(action.surface_id)) {
      add('action_surface_unknown', `action ${action.action_id} names an unknown surface`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    }
    if (
      (action.state === 'captured' && !action.record_hash) ||
      (action.state !== 'captured' && !action.reason_code)
    ) {
      add(
        'action_state_invalid',
        `action ${action.action_id} lacks evidence required by state ${action.state}`,
        { action_id: action.action_id, surface_id: action.surface_id },
      )
    }
  }
  if (manifest.actions_root !== hashCoverageActions(manifest.actions)) {
    add('action_root_mismatch', 'coverage action root does not match the action entries')
  }
  const summary = summarizeCoverage(manifest.actions)
  if (hashCanonical(manifest.summary) !== hashCanonical(summary)) {
    add('summary_mismatch', 'coverage summary does not match the action entries')
  }

  if (evidence.attestation_args_hash) {
    if (evidence.attestation_args_hash !== hashCoverageAttestationContent(manifest)) {
      add('attestation_mismatch', 'signed args_hash does not commit to this coverage manifest')
    }
  } else if (policy.require_attestation) {
    add('attestation_missing', 'coverage attestation args_hash is required')
  }

  if (evidence.log_window_manifest) {
    if (
      manifest.log_window_manifest_hash !== hashLogWindowManifest(evidence.log_window_manifest) ||
      hashCanonical({
        source: manifest.source,
        runtime: manifest.runtime,
        session: manifest.session,
        window: manifest.window,
      }) !==
        hashCanonical({
          source: evidence.log_window_manifest.source,
          runtime: evidence.log_window_manifest.runtime,
          session: evidence.log_window_manifest.session,
          window: evidence.log_window_manifest.window,
        })
    ) {
      add(
        'log_window_manifest_mismatch',
        'coverage manifest is bound to a different runtime window',
      )
    }
  } else if (policy.require_log_window_manifest) {
    add('log_window_manifest_missing', 'the bound runtime-log manifest is required')
  }

  if (evidence.expected_actions) {
    compareExpectedActions(manifest.actions, evidence.expected_actions, add)
  } else if (policy.require_expected_action_evidence) {
    add('expected_action_evidence_missing', 'runtime-owned expected action evidence is required')
  }

  const recordHashes = evidence.record_hashes ? new Set(evidence.record_hashes) : undefined
  if (recordHashes) {
    for (const action of manifest.actions) {
      if (
        action.state === 'captured' &&
        action.record_hash &&
        !recordHashes.has(action.record_hash)
      ) {
        add(
          'captured_record_missing',
          `captured action ${action.action_id} has no supplied signed record`,
          { action_id: action.action_id, surface_id: action.surface_id },
        )
      }
    }
  } else if (policy.require_record_evidence) {
    add('record_evidence_missing', 'signed record evidence is required for captured actions')
  }

  const surfaces = new Map(manifest.surfaces.map((surface) => [surface.id, surface]))
  for (const action of manifest.actions) {
    if (!surfaces.get(action.surface_id)?.required) continue
    if (action.state === 'skipped' && !policy.allow_skipped_required) {
      add('required_action_skipped', `required action ${action.action_id} was skipped`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    }
    if (action.state === 'degraded' && !policy.allow_degraded_required) {
      add('required_action_degraded', `required action ${action.action_id} was degraded`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    }
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    basis: evidence.expected_actions ? 'runtime-compared' : 'manifest-claim',
    summary,
    issues,
  }
}

function assertCoverageDefinitions(
  surfaces: readonly CoverageSurface[],
  actions: readonly CoverageActionRef[],
): void {
  const surfaceIds = new Set<string>()
  for (const surface of surfaces) {
    if (!validSurface(surface))
      throw new Error(`coverage surface ${surface.id || '<empty>'} is malformed`)
    if (surfaceIds.has(surface.id)) throw new Error(`duplicate coverage surface: ${surface.id}`)
    surfaceIds.add(surface.id)
  }
  const actionIds = new Set<string>()
  for (const action of actions) {
    if (!validActionShape(action))
      throw new Error(`coverage action ${action.action_id || '<empty>'} is malformed`)
    if (actionIds.has(action.action_id))
      throw new Error(`duplicate coverage action: ${action.action_id}`)
    if (!surfaceIds.has(action.surface_id)) {
      throw new Error(
        `coverage action ${action.action_id} names unknown surface ${action.surface_id}`,
      )
    }
    if (action.state === 'captured' && !action.record_hash) {
      throw new Error(`captured coverage action ${action.action_id} requires record_hash`)
    }
    if (action.state !== 'captured' && !action.reason_code) {
      throw new Error(`${action.state} coverage action ${action.action_id} requires reason_code`)
    }
    actionIds.add(action.action_id)
  }
}

function validSurface(surface: CoverageSurface): boolean {
  return (
    nonEmpty(surface.id) &&
    nonEmpty(surface.boundary) &&
    nonEmpty(surface.owner) &&
    typeof surface.required === 'boolean' &&
    (surface.action_kinds === undefined || surface.action_kinds.every((kind) => nonEmpty(kind)))
  )
}

function validActionShape(action: CoverageActionRef): boolean {
  return (
    nonEmpty(action.action_id) &&
    nonEmpty(action.surface_id) &&
    isSha256Uri(action.action_hash) &&
    ['captured', 'skipped', 'degraded'].includes(action.state) &&
    (action.record_hash === undefined || isSha256Uri(action.record_hash)) &&
    (action.reason_code === undefined || nonEmpty(action.reason_code))
  )
}

function summarizeCoverage(actions: readonly CoverageActionRef[]): CoverageSummary {
  return {
    expected: actions.length,
    captured: actions.filter((action) => action.state === 'captured').length,
    skipped: actions.filter((action) => action.state === 'skipped').length,
    degraded: actions.filter((action) => action.state === 'degraded').length,
  }
}

function compareExpectedActions(
  actions: readonly CoverageActionRef[],
  expected: readonly ExpectedCoverageAction[],
  add: (
    code: CoverageVerificationIssueCode,
    message: string,
    fields?: Pick<CoverageVerificationIssue, 'action_id' | 'surface_id'>,
    severity?: 'error' | 'warning',
  ) => void,
): void {
  const expectedById = new Map<string, ExpectedCoverageAction>()
  const actualById = new Map(actions.map((action) => [action.action_id, action]))
  for (const action of expected) {
    if (
      !nonEmpty(action.action_id) ||
      !nonEmpty(action.surface_id) ||
      !isSha256Uri(action.action_hash)
    ) {
      add(
        'expected_action_evidence_invalid',
        `expected action ${action.action_id || '<empty>'} is malformed`,
        { action_id: action.action_id, surface_id: action.surface_id },
      )
      continue
    }
    if (expectedById.has(action.action_id)) {
      add(
        'expected_action_evidence_duplicate',
        `expected action ${action.action_id} appears more than once`,
        { action_id: action.action_id, surface_id: action.surface_id },
      )
      continue
    }
    expectedById.set(action.action_id, action)
    const actual = actualById.get(action.action_id)
    if (!actual) {
      add('expected_action_omitted', `expected action ${action.action_id} is absent`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    } else if (
      actual.surface_id !== action.surface_id ||
      actual.action_hash !== action.action_hash
    ) {
      add('expected_action_mismatch', `expected action ${action.action_id} does not match`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    }
  }
  for (const action of actions) {
    if (!expectedById.has(action.action_id)) {
      add('unexpected_action_claim', `manifest claims unexpected action ${action.action_id}`, {
        action_id: action.action_id,
        surface_id: action.surface_id,
      })
    }
  }
}

function nonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0
}
