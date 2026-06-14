// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import {
  createLogWindowManifest,
  hashCanonical,
  hashLogWindow,
  hashLogWindowManifest,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  verifyLogWindowManifest,
  type LogWindowManifest,
  type ManifestVerificationResult,
  type RuntimeLogEventRef,
  type RuntimeLogProjectionRef,
  type RuntimeLogSideEffectReceiptRef,
  type Sha256Uri,
} from '@atrib/runtime-log'

export const ACTIVEGRAPH_APPROVAL_GATE_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/activegraph-approval-gate/v0' as const
export const ACTIVEGRAPH_APPROVAL_GATE_BUNDLE_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/activegraph-approval-gate-bundle/v0' as const
export const ACTIVEGRAPH_SESSION_DEFINITION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/activegraph-session-definition/v0' as const
export const ACTIVEGRAPH_APPROVAL_GATE_PROTOCOL = 'activegraph.approval_gate' as const
export const ACTIVEGRAPH_APPROVAL_GATE_PROJECTION = 'activegraph.approval_gates' as const

export interface ActiveGraphEvent {
  readonly id: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly actor?: string | null
  readonly frame_id?: string | null
  readonly caused_by?: string | null
  readonly timestamp?: string
  readonly [key: string]: unknown
}

export interface ActiveGraphSessionDefinition {
  readonly schema: typeof ACTIVEGRAPH_SESSION_DEFINITION_SCHEMA
  readonly runtime: {
    readonly name: 'activegraph'
    readonly version: string
    readonly source_repo: string
    readonly source_commit: string
  }
  readonly export: {
    readonly command: string
    readonly format: 'jsonl'
    readonly source_path: string
  }
  readonly run: {
    readonly id: string
    readonly pack: 'diligence'
    readonly selected_window: 'approval-gate-events'
  }
  readonly source_evidence: {
    readonly verified_at: string
    readonly release_tag: string
  }
}

export interface ActiveGraphApprovalGateReceipt {
  readonly schema: typeof ACTIVEGRAPH_APPROVAL_GATE_SCHEMA
  readonly runtime: 'activegraph'
  readonly runtime_version: string
  readonly run_id: string
  readonly approval_id: string
  readonly object_type: string
  readonly pack: string
  readonly approved_by: string
  readonly proposal_event_id: string
  readonly grant_event_id: string
  readonly result_object_event_id: string
  readonly result_object_id: string
  readonly reason_hash: Sha256Uri
  readonly proposal_payload_hash: Sha256Uri
  readonly grant_payload_hash: Sha256Uri
  readonly result_object_hash: Sha256Uri
  readonly event_window_hash: Sha256Uri
  readonly checks: {
    readonly matching_approval_id: true
    readonly matching_object_type: true
    readonly grant_precedes_result_object: true
    readonly approved_by_matches_actor: true
    readonly result_object_run_id_matches: true
  }
}

export interface ActiveGraphRuntimeLogProof {
  readonly ok: boolean
  readonly strategy: 'activegraph-runtime-log-v0'
  readonly note: string
  readonly manifest_hash: Sha256Uri
  readonly manifest: LogWindowManifest
  readonly session_definition: ActiveGraphSessionDefinition
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly side_effect_receipts: readonly RuntimeLogSideEffectReceiptRef[]
  readonly approval_gate_receipts: readonly ActiveGraphApprovalGateReceipt[]
  readonly verification: ManifestVerificationResult
  readonly source: {
    readonly runtime: 'activegraph'
    readonly version: string
    readonly source_commit: string
    readonly trace_path: string
    readonly raw_event_rows: number
  }
  readonly privacy: {
    readonly activegraph_owns_runtime_log: true
    readonly public_manifest_hash_only: true
    readonly raw_trace_body_outside_manifest: true
  }
}

export interface ActiveGraphRuntimeLogProofOptions {
  readonly tracePath: string
  readonly activegraphVersion?: string
  readonly activegraphCommit?: string
  readonly releaseTag?: string
  readonly sourceId?: string
  readonly sourceVerifiedAt?: string
  readonly requireApprovalReceipts?: boolean
}

const DEFAULT_ACTIVEGRAPH_VERSION = '1.1.0'
const DEFAULT_ACTIVEGRAPH_COMMIT = '27c2901b86119b676f1da985100d2d2c397b6969'
const DEFAULT_RELEASE_TAG = 'v1.1.0'
const DEFAULT_SOURCE_ID = 'activegraph.v1.1.0.diligence'
const ACTIVEGRAPH_REPO = 'https://github.com/yoheinakajima/activegraph'

export async function buildActiveGraphRuntimeLogProof(
  options: ActiveGraphRuntimeLogProofOptions,
): Promise<ActiveGraphRuntimeLogProof> {
  const rawEvents = await readActiveGraphTraceJsonl(options.tracePath)
  const events = activeGraphEventsToRuntimeLogRefs(rawEvents)
  const approvalGateReceipts = extractActiveGraphApprovalGateReceipts(rawEvents, {
    activegraphVersion: options.activegraphVersion ?? DEFAULT_ACTIVEGRAPH_VERSION,
    requireApprovalReceipts: options.requireApprovalReceipts ?? true,
  })
  const runId = inferSingleRunId(approvalGateReceipts)
  const sessionDefinition = createActiveGraphSessionDefinition({
    tracePath: options.tracePath,
    runId,
    activegraphVersion: options.activegraphVersion ?? DEFAULT_ACTIVEGRAPH_VERSION,
    activegraphCommit: options.activegraphCommit ?? DEFAULT_ACTIVEGRAPH_COMMIT,
    releaseTag: options.releaseTag ?? DEFAULT_RELEASE_TAG,
    sourceVerifiedAt: options.sourceVerifiedAt ?? '2026-06-14',
  })
  const approvalGateProjection = createApprovalGateProjection(approvalGateReceipts)
  const sideEffectReceipts = approvalGateReceipts.map((receipt) => ({
    protocol: ACTIVEGRAPH_APPROVAL_GATE_PROTOCOL,
    receipt_hash: hashCanonical(receipt, 'activegraph approval gate receipt'),
    uri: `activegraph://run/${receipt.run_id}/approval/${receipt.approval_id}`,
  }))

  const manifest = createLogWindowManifest({
    source: {
      id: options.sourceId ?? DEFAULT_SOURCE_ID,
      kind: 'activegraph-export-trace-jsonl',
      version: options.activegraphVersion ?? DEFAULT_ACTIVEGRAPH_VERSION,
      uri: pathToFileURL(options.tracePath).href,
    },
    runtime: {
      name: 'activegraph',
      version: options.activegraphVersion ?? DEFAULT_ACTIVEGRAPH_VERSION,
    },
    session: {
      id: runId,
      digest: hashSessionDefinition(sessionDefinition),
      format: 'activegraph-session-definition-v0',
    },
    window: {
      start: events[0]!.position,
      end: events[events.length - 1]!.position,
      label: 'selected approval-gate events',
    },
    events,
    projections: [approvalGateProjection],
    side_effect_receipts: sideEffectReceipts,
    privacy_posture: 'host-owned',
    verifier_policy: {
      require_event_root: true,
      require_session_definition: true,
      require_projection_roots: [ACTIVEGRAPH_APPROVAL_GATE_PROJECTION],
      require_receipt_protocols: [ACTIVEGRAPH_APPROVAL_GATE_PROTOCOL],
      trusted_sources: [options.sourceId ?? DEFAULT_SOURCE_ID],
    },
  })
  const verification = verifyLogWindowManifest(manifest, {
    session_definition: sessionDefinition,
    events,
    projections: [approvalGateProjection],
    side_effect_receipts: sideEffectReceipts,
  })

  return {
    ok: verification.valid,
    strategy: 'activegraph-runtime-log-v0',
    note: 'Verifies a bounded ActiveGraph export-trace JSONL window and approval-gate receipts without taking ownership of the raw runtime log.',
    manifest_hash: hashLogWindowManifest(manifest),
    manifest,
    session_definition: sessionDefinition,
    events,
    projections: [approvalGateProjection],
    side_effect_receipts: sideEffectReceipts,
    approval_gate_receipts: approvalGateReceipts,
    verification,
    source: {
      runtime: 'activegraph',
      version: options.activegraphVersion ?? DEFAULT_ACTIVEGRAPH_VERSION,
      source_commit: options.activegraphCommit ?? DEFAULT_ACTIVEGRAPH_COMMIT,
      trace_path: options.tracePath,
      raw_event_rows: rawEvents.length,
    },
    privacy: {
      activegraph_owns_runtime_log: true,
      public_manifest_hash_only: true,
      raw_trace_body_outside_manifest: true,
    },
  }
}

export async function readActiveGraphTraceJsonl(path: string): Promise<ActiveGraphEvent[]> {
  const text = await readFile(path, 'utf8')
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return rows.map((line, index) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line) as unknown
    } catch (error) {
      throw new Error(`invalid ActiveGraph JSONL at ${path}:${index + 1}: ${errorMessage(error)}`)
    }
    return activeGraphEvent(parsed, `${path}:${index + 1}`)
  })
}

export function activeGraphEventsToRuntimeLogRefs(
  events: readonly ActiveGraphEvent[],
): RuntimeLogEventRef[] {
  if (events.length === 0) {
    throw new Error('ActiveGraph trace must contain at least one event')
  }

  return events.map((event, index) => ({
    event_id: event.id,
    position: activeGraphEventPosition(event, index),
    event_hash: hashRuntimeLogEvent(event),
    kind: event.type,
    ...(typeof event.timestamp === 'string' ? { timestamp: event.timestamp } : {}),
  }))
}

export function extractActiveGraphApprovalGateReceipts(
  events: readonly ActiveGraphEvent[],
  options: {
    readonly activegraphVersion?: string
    readonly requireApprovalReceipts?: boolean
  } = {},
): ActiveGraphApprovalGateReceipt[] {
  const proposals = new Map<string, { event: ActiveGraphEvent; index: number }>()
  const grants = new Map<string, { event: ActiveGraphEvent; index: number }>()

  for (const [index, event] of events.entries()) {
    if (event.type !== 'approval.proposed' && event.type !== 'approval.granted') continue
    const approvalId = readString(event.payload, 'approval_id', `${event.id}.payload.approval_id`)
    if (event.type === 'approval.proposed') proposals.set(approvalId, { event, index })
    if (event.type === 'approval.granted') grants.set(approvalId, { event, index })
  }

  const receipts: ActiveGraphApprovalGateReceipt[] = []
  for (const [approvalId, proposal] of proposals) {
    const grant = grants.get(approvalId)
    if (!grant) {
      throw new Error(`ActiveGraph approval ${approvalId} is missing approval.granted`)
    }
    if (grant.index <= proposal.index) {
      throw new Error(`ActiveGraph approval ${approvalId} grant does not follow proposal`)
    }
    const result = events[grant.index + 1]
    if (!result || result.type !== 'object.created') {
      throw new Error(`ActiveGraph approval ${approvalId} grant is not followed by object.created`)
    }
    receipts.push(
      createApprovalGateReceipt({
        proposal: proposal.event,
        grant: grant.event,
        result,
        activegraphVersion: options.activegraphVersion ?? DEFAULT_ACTIVEGRAPH_VERSION,
      }),
    )
  }

  if ((options.requireApprovalReceipts ?? true) && receipts.length === 0) {
    throw new Error('ActiveGraph trace did not include approval-gate events')
  }
  return receipts
}

function createApprovalGateReceipt(input: {
  readonly proposal: ActiveGraphEvent
  readonly grant: ActiveGraphEvent
  readonly result: ActiveGraphEvent
  readonly activegraphVersion: string
}): ActiveGraphApprovalGateReceipt {
  const proposal = input.proposal
  const grant = input.grant
  const result = input.result
  const approvalId = readString(proposal.payload, 'approval_id', `${proposal.id}.approval_id`)
  const grantApprovalId = readString(grant.payload, 'approval_id', `${grant.id}.approval_id`)
  if (approvalId !== grantApprovalId) {
    throw new Error(
      `approval id mismatch: ${proposal.id}=${approvalId}, ${grant.id}=${grantApprovalId}`,
    )
  }

  const objectType = readString(proposal.payload, 'object_type', `${proposal.id}.object_type`)
  const grantObjectType = readString(grant.payload, 'object_type', `${grant.id}.object_type`)
  if (objectType !== grantObjectType) {
    throw new Error(
      `approval object_type mismatch: ${proposal.id}=${objectType}, ${grant.id}=${grantObjectType}`,
    )
  }

  const approvedBy = readString(grant.payload, 'approved_by', `${grant.id}.approved_by`)
  if (result.actor !== approvedBy) {
    throw new Error(`approval ${approvalId} result actor ${String(result.actor)} != ${approvedBy}`)
  }

  const resultObject = readObject(result.payload, 'object', `${result.id}.payload.object`)
  const resultObjectType = readString(resultObject, 'type', `${result.id}.payload.object.type`)
  if (resultObjectType !== objectType) {
    throw new Error(
      `approval ${approvalId} result object type ${resultObjectType} != ${objectType}`,
    )
  }
  const provenance = readObject(
    resultObject,
    'provenance',
    `${result.id}.payload.object.provenance`,
  )
  const runId = readString(provenance, 'run_id', `${result.id}.payload.object.provenance.run_id`)
  const createdBy = readString(
    provenance,
    'created_by',
    `${result.id}.payload.object.provenance.created_by`,
  )
  if (createdBy !== approvedBy) {
    throw new Error(`approval ${approvalId} provenance created_by ${createdBy} != ${approvedBy}`)
  }

  const gateEvents = activeGraphEventsToRuntimeLogRefs([proposal, grant, result])
  return {
    schema: ACTIVEGRAPH_APPROVAL_GATE_SCHEMA,
    runtime: 'activegraph',
    runtime_version: input.activegraphVersion,
    run_id: runId,
    approval_id: approvalId,
    object_type: objectType,
    pack: readString(proposal.payload, 'pack', `${proposal.id}.pack`),
    approved_by: approvedBy,
    proposal_event_id: proposal.id,
    grant_event_id: grant.id,
    result_object_event_id: result.id,
    result_object_id: readString(resultObject, 'id', `${result.id}.payload.object.id`),
    reason_hash: hashCanonical(
      { reason: readString(proposal.payload, 'reason', `${proposal.id}.reason`) },
      'activegraph approval reason',
    ),
    proposal_payload_hash: hashCanonical(proposal.payload, 'activegraph approval proposal payload'),
    grant_payload_hash: hashCanonical(grant.payload, 'activegraph approval grant payload'),
    result_object_hash: hashCanonical(resultObject, 'activegraph approval result object'),
    event_window_hash: hashLogWindow(gateEvents),
    checks: {
      matching_approval_id: true,
      matching_object_type: true,
      grant_precedes_result_object: true,
      approved_by_matches_actor: true,
      result_object_run_id_matches: true,
    },
  }
}

function createActiveGraphSessionDefinition(input: {
  readonly tracePath: string
  readonly runId: string
  readonly activegraphVersion: string
  readonly activegraphCommit: string
  readonly releaseTag: string
  readonly sourceVerifiedAt: string
}): ActiveGraphSessionDefinition {
  return {
    schema: ACTIVEGRAPH_SESSION_DEFINITION_SCHEMA,
    runtime: {
      name: 'activegraph',
      version: input.activegraphVersion,
      source_repo: ACTIVEGRAPH_REPO,
      source_commit: input.activegraphCommit,
    },
    export: {
      command:
        'activegraph export-trace <store-url> --run-id <run-id> --format jsonl --output <path>',
      format: 'jsonl',
      source_path: input.tracePath,
    },
    run: {
      id: input.runId,
      pack: 'diligence',
      selected_window: 'approval-gate-events',
    },
    source_evidence: {
      verified_at: input.sourceVerifiedAt,
      release_tag: input.releaseTag,
    },
  }
}

function createApprovalGateProjection(
  receipts: readonly ActiveGraphApprovalGateReceipt[],
): RuntimeLogProjectionRef {
  return {
    name: ACTIVEGRAPH_APPROVAL_GATE_PROJECTION,
    format: 'activegraph-approval-gate-bundle-v0',
    root_hash: hashCanonical(
      {
        schema: ACTIVEGRAPH_APPROVAL_GATE_BUNDLE_SCHEMA,
        receipts,
      },
      'activegraph approval gate bundle',
    ),
    event_count: receipts.length,
  }
}

function inferSingleRunId(receipts: readonly ActiveGraphApprovalGateReceipt[]): string {
  const runIds = new Set(receipts.map((receipt) => receipt.run_id))
  if (runIds.size !== 1) {
    throw new Error(`ActiveGraph approval receipts had ${runIds.size} run ids`)
  }
  const [runId] = [...runIds]
  if (!runId) {
    throw new Error('ActiveGraph approval receipts did not carry a run id')
  }
  return runId
}

function activeGraphEventPosition(event: ActiveGraphEvent, index: number): number | string {
  const match = /^evt_(\d+)$/.exec(event.id)
  const position = match?.[1] ? Number(match[1]) : NaN
  return Number.isSafeInteger(position) ? position : index + 1
}

function activeGraphEvent(value: unknown, label: string): ActiveGraphEvent {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  if (typeof value.id !== 'string') {
    throw new Error(`${label}.id must be a string`)
  }
  if (typeof value.type !== 'string') {
    throw new Error(`${label}.type must be a string`)
  }
  if (!isRecord(value.payload)) {
    throw new Error(`${label}.payload must be an object`)
  }
  return value as ActiveGraphEvent
}

function readObject(
  value: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  const child = value[key]
  if (!isRecord(child)) {
    throw new Error(`${label} must be an object`)
  }
  return child
}

function readString(value: Record<string, unknown>, key: string, label: string): string {
  const child = value[key]
  if (typeof child !== 'string' || child.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return child
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
