// SPDX-License-Identifier: Apache-2.0

import type { AtribRecord } from '@atrib/mcp'
import {
  BuzzObserverRuntimeLogSource,
  type BuzzObserverSequenceAudit,
  type BuzzObserverWindowBundle,
} from '@atrib/runtime-log/buzz'
import {
  hashCanonical,
  hashLogWindowManifest,
  type LogWindowRequest,
  type Sha256Uri,
} from '@atrib/runtime-log'
import {
  RUNTIME_OBSERVATION_CLAIM_BOUNDARY,
  verifyRuntimeObservationBatchTransition,
  type RuntimeObservationBatch,
  type RuntimeObservationClaim,
  type RuntimeObservationCoverage,
  type RuntimeObservationGap,
} from '@atrib/runtime-log/observation'
import {
  parseNamedRef,
  parseOperatingEvent,
  parseOptionalAgentRef,
  parseOptionalNamedRef,
  type AgentRef,
  type NamedRef,
  type OperatingEvent,
} from './model.js'

export const BUZZ_RUNTIME_OBSERVATION_SCHEMA =
  'atrib.operating-runtime-observation.buzz.v1' as const
export const RUNTIME_OBSERVATION_SCHEMA = 'atrib.operating-runtime-observation.v1' as const

export interface RuntimeObservationMapping {
  readonly workspace: NamedRef
  readonly task?: NamedRef
  readonly team?: NamedRef
  readonly mapped_agent?: AgentRef
}

export type BuzzObservationMapping = RuntimeObservationMapping

export type PortableObservationBatch = RuntimeObservationBatch<
  object,
  RuntimeObservationClaim,
  RuntimeObservationCoverage,
  RuntimeObservationGap,
  object
>

export interface PortableRuntimeObservation {
  readonly schema: typeof RUNTIME_OBSERVATION_SCHEMA
  readonly kind: 'runtime_observation'
  readonly workspace: NamedRef
  readonly task?: NamedRef
  readonly team?: NamedRef
  /** Caller-owned placement. This is not the observed runtime subject. */
  readonly mapped_agent?: AgentRef
  readonly source: {
    readonly adapter_id: string
    readonly adapter_version: string
    readonly source_ref: string
    readonly generation_ref: string
    readonly runtime: {
      readonly name: string
      readonly version: string
      readonly environment?: string
    }
    readonly session_id: string
  }
  readonly batch: {
    /** Commits to the complete external batch, including cursors and observations. */
    readonly batch_id: string
    readonly status: 'ok' | 'gap'
    readonly observation_count: number
    readonly history_completeness: RuntimeObservationCoverage['history_completeness']
    readonly parsing_status: RuntimeObservationCoverage['parsing_status']
    readonly complete_window_eligible: boolean
    readonly gap_kinds: readonly string[]
    readonly observed_at: string
  }
  readonly claim_boundary: typeof RUNTIME_OBSERVATION_CLAIM_BOUNDARY
  readonly source_artifact_replay: 'not-performed-by-reader'
  readonly execution_evidence: false
  readonly semantic_effects: {
    readonly accepted_state: false
    readonly decision: false
    readonly outcome: false
    readonly handoff: false
    readonly resolution: false
  }
  readonly raw_observations: 'omitted'
}

export interface BuzzRuntimeObservation {
  readonly schema: typeof BUZZ_RUNTIME_OBSERVATION_SCHEMA
  readonly kind: 'runtime_observation'
  readonly workspace: NamedRef
  readonly task?: NamedRef
  readonly team?: NamedRef
  /** Caller-owned placement. This is not a Buzz Nostr signer. */
  readonly mapped_agent?: AgentRef
  readonly source: {
    readonly id: 'buzz-observer-frames'
    readonly kind: 'buzz-nip-ao-capture'
    readonly version: string
    readonly capture_id: string
    readonly owner_pubkey: string
    readonly observed_agent_pubkeys: readonly string[]
    readonly capture_kind: 'live-subscription' | 'desktop-local-archive'
  }
  readonly runtime_window: {
    readonly runtime_window_hash: Sha256Uri
    readonly session_id: string
    readonly session_definition_digest: Sha256Uri
    readonly start: number
    readonly end: number
    readonly event_count: number
    readonly event_root: Sha256Uri
    readonly projection_root: Sha256Uri
    readonly sequence_audit_root: Sha256Uri
  }
  readonly coverage: {
    readonly bounded_to_capture: true
    readonly sequence_complete: boolean
    readonly basis: 'complete-captured-window' | 'incomplete-captured-window'
    readonly missing_ranges: readonly { readonly start: number; readonly end: number }[]
    readonly duplicate_seq: readonly number[]
    readonly duplicate_event_ids: readonly string[]
    readonly out_of_order_count: number
  }
  readonly trust: {
    readonly nostr_event_signatures: 'verified-by-observer-adapter'
    readonly recipient_owner_binding: 'verified-by-observer-adapter'
    readonly owner_authorization: 'not-asserted'
    readonly relay_admission: 'not-claimed'
    readonly relay_persistence: 'not-claimed'
    readonly audit_inclusion: 'not-claimed'
    readonly runtime_execution: 'observer-telemetry-only'
    readonly result_truth: 'not-claimed'
    readonly capture_completeness: 'captured-window-only'
    readonly source_artifact_replay: 'not-performed-by-reader'
  }
  readonly execution_evidence: false
  readonly semantic_effects: {
    readonly accepted_state: false
    readonly decision: false
    readonly outcome: false
    readonly handoff: false
    readonly resolution: false
  }
  readonly raw_payloads: 'omitted'
}

export interface RuntimeObservationEntry {
  readonly record_hash: string
  readonly record: AtribRecord
  readonly observation: PortableRuntimeObservation | BuzzRuntimeObservation
  readonly signature_verified: boolean
  readonly content_commitment_verified: true
  readonly proof_supplied: boolean
  readonly producer: string | null
}

export interface RuntimeObservationQuery {
  readonly workspace_id: string
  readonly task_id?: string
  readonly team_id?: string
  readonly agent_id?: string
  readonly trusted_creator_keys?: readonly string[]
  readonly limit?: number
}

export interface RuntimeSemanticPromotion {
  readonly event: OperatingEvent
  readonly informed_by: readonly [string]
}

export type BuzzSemanticPromotion = RuntimeSemanticPromotion

/**
 * Places a verified D183 observation batch in an application-owned scope.
 * The signed body carries the batch commitment and bounded summary, not raw
 * transcript observations. The complete batch remains an external artifact.
 */
export function buildRuntimeObservation(
  batch: PortableObservationBatch,
  authoritativeCursor: object,
  mapping: RuntimeObservationMapping,
): PortableRuntimeObservation {
  const transition = verifyRuntimeObservationBatchTransition(batch, authoritativeCursor)
  if (!transition.valid) {
    throw new Error(
      `runtime observation batch transition is invalid: ${transition.issues
        .map((issue) => issue.code)
        .join(', ')}`,
    )
  }
  const observation: PortableRuntimeObservation = {
    schema: RUNTIME_OBSERVATION_SCHEMA,
    kind: 'runtime_observation',
    workspace: mapping.workspace,
    ...(mapping.task ? { task: mapping.task } : {}),
    ...(mapping.team ? { team: mapping.team } : {}),
    ...(mapping.mapped_agent ? { mapped_agent: mapping.mapped_agent } : {}),
    source: {
      adapter_id: batch.adapter.id,
      adapter_version: batch.adapter.version,
      source_ref: batch.source.source_ref,
      generation_ref: batch.source.generation_ref,
      runtime: batch.source.runtime,
      session_id: batch.source.session_id,
    },
    batch: {
      batch_id: batch.batch_id,
      status: batch.status,
      observation_count: batch.observations.length,
      history_completeness: batch.coverage.history_completeness,
      parsing_status: batch.coverage.parsing_status,
      complete_window_eligible: batch.coverage.complete_window_eligible,
      gap_kinds: [...new Set(batch.gaps.map((gap) => gap.kind))].sort(),
      observed_at: batch.observed_at,
    },
    claim_boundary: RUNTIME_OBSERVATION_CLAIM_BOUNDARY,
    source_artifact_replay: 'not-performed-by-reader',
    execution_evidence: false,
    semantic_effects: noSemanticEffects(),
    raw_observations: 'omitted',
  }
  const parsed = parseRuntimeObservation(observation)
  if (!parsed) throw new Error('runtime observation mapping is invalid')
  return parsed
}

/**
 * Builds the private body for one signed, bounded Buzz observer observation.
 * The caller owns mapping the capture to its workspace, task, team, or agent.
 * It must sign this body through the normal attest path before the reference
 * client will expose it in the observation feed.
 */
export async function buildBuzzRuntimeObservation(
  source: BuzzObserverRuntimeLogSource,
  request: LogWindowRequest,
  mapping: BuzzObservationMapping,
): Promise<BuzzRuntimeObservation> {
  const bundle = await source.exportWindow(request)
  if (!bundle.verification.valid) {
    throw new Error('Buzz observer runtime window failed local manifest verification')
  }
  const observation = observationFromBundle(bundle, mapping)
  const parsed = parseBuzzRuntimeObservation(observation)
  if (!parsed) throw new Error('Buzz observation mapping is invalid')
  return parsed
}

/**
 * Creates the application-level promotion input for a prior runtime observation.
 * Callers sign the returned event through normal attest. The operating reader
 * rejects a promotion that names this observation without citing it in
 * informed_by.
 */
export function buildBuzzSemanticPromotion(
  observationRecordHash: string,
  event: OperatingEvent,
): BuzzSemanticPromotion {
  return buildRuntimeSemanticPromotion(observationRecordHash, event)
}

export function buildRuntimeSemanticPromotion(
  observationRecordHash: string,
  event: OperatingEvent,
): RuntimeSemanticPromotion {
  if (!/^sha256:[0-9a-f]{64}$/.test(observationRecordHash)) {
    throw new Error('observationRecordHash must be a sha256 URI')
  }
  const promotedEvent = parseOperatingEvent({
    ...event,
    source_observation: observationRecordHash,
  })
  if (!promotedEvent) throw new Error('event must be a valid operating event')
  return {
    event: promotedEvent,
    informed_by: [observationRecordHash],
  }
}

export function parseRuntimeObservation(value: unknown): PortableRuntimeObservation | null {
  if (!isObject(value) || value['schema'] !== RUNTIME_OBSERVATION_SCHEMA) return null
  if (value['kind'] !== 'runtime_observation') return null
  if (
    'payload' in value ||
    'frames' in value ||
    'raw_events' in value ||
    'observations' in value ||
    'result' in value ||
    'outcome' in value
  ) {
    return null
  }
  const placement = parseObservationPlacement(value)
  if (!placement) return null
  const source = parsePortableSource(value['source'])
  const batch = parsePortableBatch(value['batch'])
  if (
    !source ||
    !batch ||
    !isExactClaimBoundary(value['claim_boundary']) ||
    value['source_artifact_replay'] !== 'not-performed-by-reader' ||
    value['execution_evidence'] !== false ||
    !isNoSemanticEffect(value['semantic_effects']) ||
    value['raw_observations'] !== 'omitted'
  ) {
    return null
  }
  return {
    schema: RUNTIME_OBSERVATION_SCHEMA,
    kind: 'runtime_observation',
    ...placement,
    source,
    batch,
    claim_boundary: RUNTIME_OBSERVATION_CLAIM_BOUNDARY,
    source_artifact_replay: 'not-performed-by-reader',
    execution_evidence: false,
    semantic_effects: noSemanticEffects(),
    raw_observations: 'omitted',
  }
}

export function parseBuzzRuntimeObservation(value: unknown): BuzzRuntimeObservation | null {
  if (!isObject(value) || value['schema'] !== BUZZ_RUNTIME_OBSERVATION_SCHEMA) return null
  if (value['kind'] !== 'runtime_observation') return null
  if (
    'payload' in value ||
    'frames' in value ||
    'raw_events' in value ||
    'result' in value ||
    'result_claim' in value ||
    'outcome' in value ||
    'outcome_claim' in value
  ) {
    return null
  }

  const workspace = parseNamedRef(value['workspace'])
  if (!workspace) return null
  const task = parseOptionalNamedRef(value, 'task')
  const team = parseOptionalNamedRef(value, 'team')
  if ('agent' in value) return null
  const mappedAgent = parseOptionalAgentRef(value, 'mapped_agent')
  if (!task.valid || !team.valid || !mappedAgent.valid) return null
  const source = parseSource(value['source'])
  const runtimeWindow = parseRuntimeWindow(value['runtime_window'])
  if (!source || !runtimeWindow) return null
  const coverage = parseCoverage(
    value['coverage'],
    runtimeWindow.start,
    runtimeWindow.end,
    runtimeWindow.event_count,
  )
  if (!coverage) return null
  if (
    !isExactTrust(value['trust']) ||
    value['execution_evidence'] !== false ||
    !isNoSemanticEffect(value['semantic_effects']) ||
    value['raw_payloads'] !== 'omitted'
  ) {
    return null
  }
  return {
    schema: BUZZ_RUNTIME_OBSERVATION_SCHEMA,
    kind: 'runtime_observation',
    workspace,
    ...(task.value ? { task: task.value } : {}),
    ...(team.value ? { team: team.value } : {}),
    ...(mappedAgent.value ? { mapped_agent: mappedAgent.value } : {}),
    source,
    runtime_window: runtimeWindow,
    coverage,
    trust: trustFacts(),
    execution_evidence: false,
    semantic_effects: noSemanticEffects(),
    raw_payloads: 'omitted',
  }
}

export function parseAnyRuntimeObservation(
  value: unknown,
): PortableRuntimeObservation | BuzzRuntimeObservation | null {
  return parseRuntimeObservation(value) ?? parseBuzzRuntimeObservation(value)
}

function parseObservationPlacement(
  value: Record<string, unknown>,
): Pick<PortableRuntimeObservation, 'workspace' | 'task' | 'team' | 'mapped_agent'> | null {
  const workspace = parseNamedRef(value['workspace'])
  if (!workspace || 'agent' in value) return null
  const task = parseOptionalNamedRef(value, 'task')
  const team = parseOptionalNamedRef(value, 'team')
  const mappedAgent = parseOptionalAgentRef(value, 'mapped_agent')
  if (!task.valid || !team.valid || !mappedAgent.valid) return null
  return {
    workspace,
    ...(task.value ? { task: task.value } : {}),
    ...(team.value ? { team: team.value } : {}),
    ...(mappedAgent.value ? { mapped_agent: mappedAgent.value } : {}),
  }
}

function parsePortableSource(value: unknown): PortableRuntimeObservation['source'] | null {
  if (!isObject(value) || !isObject(value['runtime'])) return null
  const runtime = value['runtime']
  const environment = runtime['environment']
  if (
    !nonEmptyString(value['adapter_id']) ||
    !nonEmptyString(value['adapter_version']) ||
    !nonEmptyString(value['source_ref']) ||
    !nonEmptyString(value['generation_ref']) ||
    !nonEmptyString(value['session_id']) ||
    !nonEmptyString(runtime['name']) ||
    !nonEmptyString(runtime['version']) ||
    (environment !== undefined && !nonEmptyString(environment))
  ) {
    return null
  }
  return {
    adapter_id: value['adapter_id'],
    adapter_version: value['adapter_version'],
    source_ref: value['source_ref'],
    generation_ref: value['generation_ref'],
    runtime: {
      name: runtime['name'],
      version: runtime['version'],
      ...(environment !== undefined ? { environment } : {}),
    },
    session_id: value['session_id'],
  }
}

function parsePortableBatch(value: unknown): PortableRuntimeObservation['batch'] | null {
  if (!isObject(value)) return null
  const observationCount = value['observation_count']
  const gapKinds = value['gap_kinds']
  if (
    !nonEmptyString(value['batch_id']) ||
    (value['status'] !== 'ok' && value['status'] !== 'gap') ||
    !nonNegativeInteger(observationCount) ||
    !['tail-only', 'bounded-backfill', 'continuous'].includes(
      String(value['history_completeness']),
    ) ||
    !['ok', 'degraded', 'blocked'].includes(String(value['parsing_status'])) ||
    typeof value['complete_window_eligible'] !== 'boolean' ||
    !Array.isArray(gapKinds) ||
    !gapKinds.every(nonEmptyString) ||
    new Set(gapKinds).size !== gapKinds.length ||
    !isSorted(gapKinds) ||
    !nonEmptyString(value['observed_at']) ||
    !Number.isFinite(Date.parse(value['observed_at']))
  ) {
    return null
  }
  return {
    batch_id: value['batch_id'],
    status: value['status'],
    observation_count: observationCount,
    history_completeness: value[
      'history_completeness'
    ] as RuntimeObservationCoverage['history_completeness'],
    parsing_status: value['parsing_status'] as RuntimeObservationCoverage['parsing_status'],
    complete_window_eligible: value['complete_window_eligible'],
    gap_kinds: gapKinds,
    observed_at: value['observed_at'],
  }
}

function isExactClaimBoundary(value: unknown): boolean {
  return (
    isObject(value) &&
    value['runtime_telemetry'] === 'host-observed' &&
    value['execution'] === 'not-established' &&
    value['capture_completeness'] === 'coverage-reported' &&
    value['runtime_vendor_provenance'] === 'not-established' &&
    value['accepted_state'] === 'not-inferred' &&
    value['effect_outcome'] === 'not-established'
  )
}

export function selectRuntimeObservations(
  entries: readonly RuntimeObservationEntry[],
  query: RuntimeObservationQuery,
): RuntimeObservationEntry[] {
  const visible = entries.filter((entry) => {
    const observation = entry.observation
    if (!entry.signature_verified || observation.workspace.id !== query.workspace_id) return false
    if (query.task_id && observation.task?.id !== query.task_id) return false
    if (query.team_id && observation.team?.id !== query.team_id) return false
    if (query.agent_id && observation.mapped_agent?.id !== query.agent_id) return false
    return (
      !query.trusted_creator_keys || query.trusted_creator_keys.includes(entry.record.creator_key)
    )
  })
  const limit = query.limit ?? 200
  return [...visible]
    .sort(
      (left, right) =>
        right.record.timestamp - left.record.timestamp ||
        right.record_hash.localeCompare(left.record_hash),
    )
    .slice(0, limit)
}

function observationFromBundle(
  bundle: BuzzObserverWindowBundle,
  mapping: BuzzObservationMapping,
): BuzzRuntimeObservation {
  const { manifest, session_definition: sessionDefinition, sequence_audit: sequenceAudit } = bundle
  return {
    schema: BUZZ_RUNTIME_OBSERVATION_SCHEMA,
    kind: 'runtime_observation',
    workspace: mapping.workspace,
    ...(mapping.task ? { task: mapping.task } : {}),
    ...(mapping.team ? { team: mapping.team } : {}),
    ...(mapping.mapped_agent ? { mapped_agent: mapping.mapped_agent } : {}),
    source: {
      id: 'buzz-observer-frames',
      kind: 'buzz-nip-ao-capture',
      version: sessionDefinition.source.version,
      capture_id: sessionDefinition.id,
      owner_pubkey: sessionDefinition.owner_pubkey,
      observed_agent_pubkeys: [...new Set(bundle.frames.map((frame) => frame.agent_pubkey))].sort(),
      capture_kind: sessionDefinition.capture_kind,
    },
    runtime_window: {
      runtime_window_hash: hashLogWindowManifest(manifest),
      session_id: manifest.session.id,
      session_definition_digest: manifest.session.digest,
      start: sequenceAudit.requested_window.start,
      end: sequenceAudit.requested_window.end,
      event_count: manifest.event_count,
      event_root: manifest.event_root,
      projection_root: requireSha256(manifest.projection_root, 'projection_root'),
      sequence_audit_root: hashCanonical(sequenceAudit, 'Buzz observer sequence audit'),
    },
    coverage: coverageFromAudit(sequenceAudit),
    trust: trustFacts(),
    execution_evidence: false,
    semantic_effects: noSemanticEffects(),
    raw_payloads: 'omitted',
  }
}

function coverageFromAudit(audit: BuzzObserverSequenceAudit): BuzzRuntimeObservation['coverage'] {
  return {
    bounded_to_capture: true,
    sequence_complete: audit.sequence_complete,
    basis: audit.basis,
    missing_ranges: audit.missing_ranges,
    duplicate_seq: audit.duplicate_seq,
    duplicate_event_ids: audit.duplicate_event_ids,
    out_of_order_count: audit.out_of_order.length,
  }
}

function trustFacts(): BuzzRuntimeObservation['trust'] {
  return {
    nostr_event_signatures: 'verified-by-observer-adapter',
    recipient_owner_binding: 'verified-by-observer-adapter',
    owner_authorization: 'not-asserted',
    relay_admission: 'not-claimed',
    relay_persistence: 'not-claimed',
    audit_inclusion: 'not-claimed',
    runtime_execution: 'observer-telemetry-only',
    result_truth: 'not-claimed',
    capture_completeness: 'captured-window-only',
    source_artifact_replay: 'not-performed-by-reader',
  }
}

function noSemanticEffects(): BuzzRuntimeObservation['semantic_effects'] {
  return {
    accepted_state: false,
    decision: false,
    outcome: false,
    handoff: false,
    resolution: false,
  }
}

function parseSource(value: unknown): BuzzRuntimeObservation['source'] | null {
  if (!isObject(value)) return null
  if (
    value['id'] !== 'buzz-observer-frames' ||
    value['kind'] !== 'buzz-nip-ao-capture' ||
    typeof value['version'] !== 'string' ||
    !nonEmptyString(value['capture_id']) ||
    !hex32(value['owner_pubkey']) ||
    !Array.isArray(value['observed_agent_pubkeys']) ||
    value['observed_agent_pubkeys'].length === 0 ||
    !value['observed_agent_pubkeys'].every(hex32) ||
    new Set(value['observed_agent_pubkeys']).size !== value['observed_agent_pubkeys'].length ||
    !isSorted(value['observed_agent_pubkeys']) ||
    (value['capture_kind'] !== 'live-subscription' &&
      value['capture_kind'] !== 'desktop-local-archive')
  ) {
    return null
  }
  return {
    id: 'buzz-observer-frames',
    kind: 'buzz-nip-ao-capture',
    version: value['version'],
    capture_id: value['capture_id'],
    owner_pubkey: value['owner_pubkey'],
    observed_agent_pubkeys: value['observed_agent_pubkeys'],
    capture_kind: value['capture_kind'],
  }
}

function parseRuntimeWindow(value: unknown): BuzzRuntimeObservation['runtime_window'] | null {
  if (!isObject(value)) return null
  const start = value['start']
  const end = value['end']
  const eventCount = value['event_count']
  if (
    !nonEmptyString(value['session_id']) ||
    !sha256Uri(value['runtime_window_hash']) ||
    !sha256Uri(value['session_definition_digest']) ||
    !nonNegativeInteger(start) ||
    !nonNegativeInteger(end) ||
    end < start ||
    !Number.isSafeInteger(eventCount) ||
    (eventCount as number) < 1 ||
    !sha256Uri(value['event_root']) ||
    !sha256Uri(value['sequence_audit_root']) ||
    !sha256Uri(value['projection_root'])
  ) {
    return null
  }
  return {
    runtime_window_hash: value['runtime_window_hash'],
    session_id: value['session_id'],
    session_definition_digest: value['session_definition_digest'],
    start,
    end,
    event_count: eventCount as number,
    event_root: value['event_root'],
    projection_root: value['projection_root'],
    sequence_audit_root: value['sequence_audit_root'],
  }
}

function parseCoverage(
  value: unknown,
  windowStart: number,
  windowEnd: number,
  eventCount: number,
): BuzzRuntimeObservation['coverage'] | null {
  if (!isObject(value) || value['bounded_to_capture'] !== true) return null
  const outOfOrderCount = value['out_of_order_count']
  if (
    typeof value['sequence_complete'] !== 'boolean' ||
    (value['basis'] !== 'complete-captured-window' &&
      value['basis'] !== 'incomplete-captured-window') ||
    !Array.isArray(value['missing_ranges']) ||
    !Array.isArray(value['duplicate_seq']) ||
    !Array.isArray(value['duplicate_event_ids']) ||
    !Number.isSafeInteger(outOfOrderCount) ||
    (outOfOrderCount as number) < 0
  ) {
    return null
  }
  const missingRanges = value['missing_ranges']
  if (
    !missingRanges.every(
      (range) =>
        isObject(range) &&
        Number.isSafeInteger(range['start']) &&
        Number.isSafeInteger(range['end']) &&
        (range['start'] as number) >= windowStart &&
        (range['end'] as number) >= (range['start'] as number) &&
        (range['end'] as number) <= windowEnd,
    ) ||
    !value['duplicate_seq'].every((entry) => Number.isSafeInteger(entry) && entry >= 0) ||
    !value['duplicate_event_ids'].every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    return null
  }
  const parsedMissingRanges = missingRanges as Array<{ start: number; end: number }>
  if (
    parsedMissingRanges.some(
      (range, index) => index > 0 && range.start <= parsedMissingRanges[index - 1]!.end,
    ) ||
    !value['duplicate_seq'].every(
      (entry) => (entry as number) >= windowStart && (entry as number) <= windowEnd,
    )
  ) {
    return null
  }
  const hasGaps =
    missingRanges.length > 0 ||
    value['duplicate_seq'].length > 0 ||
    value['duplicate_event_ids'].length > 0 ||
    (outOfOrderCount as number) > 0
  if (
    (value['sequence_complete'] && (value['basis'] !== 'complete-captured-window' || hasGaps)) ||
    (!value['sequence_complete'] && value['basis'] !== 'incomplete-captured-window') ||
    (value['sequence_complete'] && eventCount !== windowEnd - windowStart + 1)
  ) {
    return null
  }
  return {
    bounded_to_capture: true,
    sequence_complete: value['sequence_complete'],
    basis: value['basis'],
    missing_ranges: parsedMissingRanges,
    duplicate_seq: value['duplicate_seq'] as number[],
    duplicate_event_ids: value['duplicate_event_ids'] as string[],
    out_of_order_count: outOfOrderCount as number,
  }
}

function isExactTrust(value: unknown): boolean {
  return (
    isObject(value) &&
    value['nostr_event_signatures'] === 'verified-by-observer-adapter' &&
    value['recipient_owner_binding'] === 'verified-by-observer-adapter' &&
    value['owner_authorization'] === 'not-asserted' &&
    value['relay_admission'] === 'not-claimed' &&
    value['relay_persistence'] === 'not-claimed' &&
    value['audit_inclusion'] === 'not-claimed' &&
    value['runtime_execution'] === 'observer-telemetry-only' &&
    value['result_truth'] === 'not-claimed' &&
    value['capture_completeness'] === 'captured-window-only' &&
    value['source_artifact_replay'] === 'not-performed-by-reader'
  )
}

function isNoSemanticEffect(value: unknown): boolean {
  return (
    isObject(value) &&
    value['accepted_state'] === false &&
    value['decision'] === false &&
    value['outcome'] === false &&
    value['handoff'] === false &&
    value['resolution'] === false
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function sha256Uri(value: unknown): value is Sha256Uri {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

function hex32(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function isSorted(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! <= value)
}

function requireSha256(value: string | undefined, field: string): Sha256Uri {
  if (!value || !sha256Uri(value)) throw new Error(`${field} must be a sha256 URI`)
  return value
}
