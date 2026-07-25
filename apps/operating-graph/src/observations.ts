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
  parseAgentRef,
  parseNamedRef,
  parseOperatingEvent,
  type AgentRef,
  type NamedRef,
  type OperatingEvent,
} from './model.js'

export const BUZZ_RUNTIME_OBSERVATION_SCHEMA =
  'atrib.operating-runtime-observation.buzz.v1' as const

export interface BuzzObservationMapping {
  readonly workspace: NamedRef
  readonly task?: NamedRef
  readonly team?: NamedRef
  readonly mapped_agent?: AgentRef
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
  readonly observation: BuzzRuntimeObservation
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

export interface BuzzSemanticPromotion {
  readonly event: OperatingEvent
  readonly informed_by: readonly [string]
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
  const task = optionalNamedRef(value, 'task')
  const team = optionalNamedRef(value, 'team')
  if ('agent' in value) return null
  const mappedAgent = optionalAgentRef(value, 'mapped_agent')
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

function optionalNamedRef(
  object: Record<string, unknown>,
  field: string,
): { valid: boolean; value?: NamedRef } {
  if (!(field in object)) return { valid: true }
  const value = parseNamedRef(object[field])
  return value ? { valid: true, value } : { valid: false }
}

function optionalAgentRef(
  object: Record<string, unknown>,
  field: string,
): { valid: boolean; value?: AgentRef } {
  if (!(field in object)) return { valid: true }
  const value = parseAgentRef(object[field])
  return value ? { valid: true, value } : { valid: false }
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
