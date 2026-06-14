// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import {
  createLogWindowManifest,
  hashCanonical,
  hashLogWindowManifest,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  verifyLogWindowManifest,
  type LogWindowManifest,
  type LogWindowRequest,
  type ManifestVerificationResult,
  type RuntimeLogEventRef,
  type RuntimeLogPosition,
  type RuntimeLogProjectionRef,
  type RuntimeLogSideEffectReceiptRef,
  type RuntimeLogSource,
  type RuntimeLogSourceRef,
  type Sha256Uri,
} from '@atrib/runtime-log'

export const DOGFOOD_RUNTIME_LOG_FIXTURE_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/dogfood-agent-bridge-fixture/v0' as const
export const DOGFOOD_SESSION_DEFINITION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/dogfood-agent-bridge-session/v0' as const
export const DOGFOOD_STATUS_PROJECTION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/dogfood-job-status-projection/v0' as const
export const DOGFOOD_SIGNED_REF_PROJECTION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/dogfood-signed-ref-projection/v0' as const
export const DOGFOOD_JOB_STATUS_PROJECTION = 'dogfood.job_status' as const
export const DOGFOOD_SIGNED_REF_PROJECTION = 'dogfood.signed_refs' as const
export const DOGFOOD_AGENT_BRIDGE_RECEIPT_PROTOCOL = 'agent-bridge.goal_update' as const

export interface DogfoodJobPacketRef {
  readonly job_id: string
  readonly workstream: string
  readonly goal: string
  readonly status_before: string
  readonly status_after: string
  readonly source_of_truth_paths: readonly string[]
  readonly result_packet_path: string
  readonly private_body_policy: 'omitted'
}

export interface DogfoodResultPacketRef {
  readonly status: string
  readonly bridge_entry_id: number
  readonly result_record_hash: Sha256Uri
  readonly annotation_record_hash: Sha256Uri
  readonly next_job: string
  readonly checks_passed: readonly string[]
  readonly public_artifact_refs: readonly string[]
  readonly private_artifact_refs: readonly string[]
}

export interface DogfoodAgentBridgeEntryRef {
  readonly id: number
  readonly source: string
  readonly category: string
  readonly kind: string
  readonly priority: string
  readonly project: string
  readonly created_at: string
  readonly message_id: string
  readonly atrib_receipt_id: string
  readonly job_id?: string
  readonly accepted_job?: string
  readonly status?: string
  readonly next_job?: string
  readonly informed_by: readonly Sha256Uri[]
  readonly content_summary: string
  readonly content_hash: Sha256Uri
}

export interface DogfoodRuntimeLogFixture {
  readonly schema: typeof DOGFOOD_RUNTIME_LOG_FIXTURE_SCHEMA
  readonly captured_at: string
  readonly source: {
    readonly id: string
    readonly kind: 'agent-bridge-sanitized-window'
    readonly version: string
  }
  readonly job_packet: DogfoodJobPacketRef
  readonly result_packet: DogfoodResultPacketRef
  readonly bridge_entries: readonly DogfoodAgentBridgeEntryRef[]
  readonly signed_refs: readonly Sha256Uri[]
  readonly privacy: {
    readonly raw_bridge_content: 'omitted'
    readonly private_note_bodies: 'omitted'
    readonly fixture_contains: 'ids-hashes-statuses-and-summaries'
  }
}

export interface DogfoodSessionDefinition {
  readonly schema: typeof DOGFOOD_SESSION_DEFINITION_SCHEMA
  readonly id: string
  readonly source: DogfoodRuntimeLogFixture['source']
  readonly job_id: string
  readonly workstream: string
  readonly control_plane: {
    readonly goal_anchor: 'codex-goal'
    readonly packet_state: 'private-runtime-plan'
    readonly status_channel: 'agent-bridge'
  }
  readonly private_body_policy: 'omitted'
}

export interface DogfoodRuntimeLogWindowBundle {
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly side_effect_receipts: readonly RuntimeLogSideEffectReceiptRef[]
  readonly session_definition: DogfoodSessionDefinition
  readonly verification: ManifestVerificationResult
}

export interface DogfoodRuntimeLogProof {
  readonly ok: boolean
  readonly strategy: 'dogfood-agent-bridge-runtime-log-v0'
  readonly manifest_hash: Sha256Uri
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly side_effect_receipts: readonly RuntimeLogSideEffectReceiptRef[]
  readonly session_definition: DogfoodSessionDefinition
  readonly verification: ManifestVerificationResult
  readonly fixture: {
    readonly job_id: string
    readonly status: string
    readonly bridge_entry_ids: readonly number[]
    readonly signed_refs: readonly Sha256Uri[]
  }
  readonly privacy: DogfoodRuntimeLogFixture['privacy']
}

interface DogfoodEventBody {
  readonly schema: string
  readonly kind: string
  readonly job_id: string
  readonly payload: Record<string, unknown>
}

export class DogfoodAgentBridgeRuntimeLogSource implements RuntimeLogSource {
  readonly source: RuntimeLogSourceRef

  private readonly fixture: DogfoodRuntimeLogFixture

  constructor(fixture: DogfoodRuntimeLogFixture) {
    validateDogfoodRuntimeLogFixture(fixture)
    this.fixture = fixture
    this.source = {
      id: fixture.source.id,
      kind: fixture.source.kind,
      version: fixture.source.version,
    }
  }

  exportWindow(request: LogWindowRequest): DogfoodRuntimeLogWindowBundle {
    if (request.session_id !== this.fixture.job_packet.job_id) {
      throw new Error(`unknown dogfood job session: ${request.session_id}`)
    }
    const events = dogfoodFixtureToEventRefs(this.fixture).filter(
      (event) =>
        comparePositions(event.position, request.start) >= 0 &&
        comparePositions(event.position, request.end) <= 0,
    )
    if (events.length === 0) {
      throw new Error(`dogfood job window has no events for ${request.session_id}`)
    }
    const first = events[0]!
    const last = events[events.length - 1]!
    if (
      !positionsEqual(first.position, request.start) ||
      !positionsEqual(last.position, request.end)
    ) {
      throw new Error(
        `dogfood job window must start and end on event positions: requested ${formatPosition(
          request.start,
        )}..${formatPosition(request.end)}, got ${formatPosition(first.position)}..${formatPosition(
          last.position,
        )}`,
      )
    }

    const projections = dogfoodProjections(this.fixture)
    const receipts = dogfoodSideEffectReceipts(this.fixture)
    const sessionDefinition = dogfoodSessionDefinition(this.fixture)
    const manifest = createLogWindowManifest({
      source: this.source,
      runtime: {
        name: 'atrib-dogfood-agent-bridge',
        version: '0.1.0',
        environment: 'local',
      },
      session: {
        id: this.fixture.job_packet.job_id,
        digest: hashSessionDefinition(sessionDefinition),
        format: 'dogfood-agent-bridge-session-v0',
      },
      window: {
        start: request.start,
        end: request.end,
        label: 'RL-007 dogfood job window',
      },
      events,
      projections,
      side_effect_receipts: receipts,
      redaction: {
        mode: 'hash-only',
        fields: ['content', 'private_note_body', 'payload_body'],
      },
      privacy_posture: 'local-mirror',
      verifier_policy: {
        require_event_root: true,
        require_session_definition: true,
        require_projection_roots: [DOGFOOD_JOB_STATUS_PROJECTION, DOGFOOD_SIGNED_REF_PROJECTION],
        require_receipt_protocols: [DOGFOOD_AGENT_BRIDGE_RECEIPT_PROTOCOL],
        trusted_sources: [this.source.id],
      },
    })
    const verification = verifyLogWindowManifest(manifest, {
      session_definition: sessionDefinition,
      events,
      projections,
      side_effect_receipts: receipts,
    })

    return {
      manifest,
      events,
      projections,
      side_effect_receipts: receipts,
      session_definition: sessionDefinition,
      verification,
    }
  }
}

export async function readDogfoodRuntimeLogFixture(
  path: string,
): Promise<DogfoodRuntimeLogFixture> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`)
  }
  return parsed as unknown as DogfoodRuntimeLogFixture
}

export async function buildDogfoodRuntimeLogProof(
  fixturePath: string,
): Promise<DogfoodRuntimeLogProof> {
  const fixture = await readDogfoodRuntimeLogFixture(fixturePath)
  const source = new DogfoodAgentBridgeRuntimeLogSource(fixture)
  const bundle = source.exportWindow({
    session_id: fixture.job_packet.job_id,
    start: 1,
    end: dogfoodFixtureToEventRefs(fixture).length,
  })

  return {
    ok: bundle.verification.valid,
    strategy: 'dogfood-agent-bridge-runtime-log-v0',
    manifest_hash: hashLogWindowManifest(bundle.manifest),
    manifest: bundle.manifest,
    events: bundle.events,
    projections: bundle.projections,
    side_effect_receipts: bundle.side_effect_receipts,
    session_definition: bundle.session_definition,
    verification: bundle.verification,
    fixture: {
      job_id: fixture.job_packet.job_id,
      status: fixture.result_packet.status,
      bridge_entry_ids: fixture.bridge_entries.map((entry) => entry.id),
      signed_refs: fixture.signed_refs,
    },
    privacy: fixture.privacy,
  }
}

export function dogfoodFixtureToEventRefs(
  fixture: DogfoodRuntimeLogFixture,
): readonly RuntimeLogEventRef[] {
  validateDogfoodRuntimeLogFixture(fixture)
  const bodies = dogfoodEventBodies(fixture)
  return bodies.map((body, index) => {
    const timestamp = eventTimestamp(fixture, body.kind)
    return {
      event_id: `${fixture.job_packet.job_id.toLowerCase()}-${String(index + 1).padStart(3, '0')}`,
      position: index + 1,
      event_hash: hashRuntimeLogEvent(body),
      kind: body.kind,
      ...(timestamp ? { timestamp } : {}),
    }
  })
}

export function dogfoodProjections(
  fixture: DogfoodRuntimeLogFixture,
): readonly RuntimeLogProjectionRef[] {
  validateDogfoodRuntimeLogFixture(fixture)
  return [
    {
      name: DOGFOOD_JOB_STATUS_PROJECTION,
      format: 'dogfood-job-status-v0',
      root_hash: hashCanonical(
        {
          schema: DOGFOOD_STATUS_PROJECTION_SCHEMA,
          job_id: fixture.job_packet.job_id,
          status_before: fixture.job_packet.status_before,
          status_after: fixture.job_packet.status_after,
          result_status: fixture.result_packet.status,
          bridge_entry_id: fixture.result_packet.bridge_entry_id,
          next_job: fixture.result_packet.next_job,
        },
        'dogfood job status projection',
      ),
      event_count: 1,
    },
    {
      name: DOGFOOD_SIGNED_REF_PROJECTION,
      format: 'dogfood-signed-refs-v0',
      root_hash: hashCanonical(
        {
          schema: DOGFOOD_SIGNED_REF_PROJECTION_SCHEMA,
          job_id: fixture.job_packet.job_id,
          signed_refs: fixture.signed_refs,
          bridge_receipts: fixture.bridge_entries.map((entry) => ({
            id: entry.id,
            atrib_receipt_id: entry.atrib_receipt_id,
            informed_by: entry.informed_by,
          })),
        },
        'dogfood signed refs projection',
      ),
      event_count: fixture.signed_refs.length,
    },
  ]
}

export function dogfoodSideEffectReceipts(
  fixture: DogfoodRuntimeLogFixture,
): readonly RuntimeLogSideEffectReceiptRef[] {
  validateDogfoodRuntimeLogFixture(fixture)
  return fixture.bridge_entries.map((entry) => ({
    protocol: DOGFOOD_AGENT_BRIDGE_RECEIPT_PROTOCOL,
    receipt_hash: hashCanonical(
      {
        schema: 'https://atrib.dev/schemas/runtime-log/dogfood-agent-bridge-receipt/v0',
        bridge_entry_id: entry.id,
        message_id: entry.message_id,
        atrib_receipt_id: entry.atrib_receipt_id,
        informed_by: entry.informed_by,
      },
      'dogfood agent bridge receipt',
    ),
    uri: `agent-bridge://atrib/entries/${entry.id}`,
  }))
}

export function dogfoodSessionDefinition(
  fixture: DogfoodRuntimeLogFixture,
): DogfoodSessionDefinition {
  validateDogfoodRuntimeLogFixture(fixture)
  return {
    schema: DOGFOOD_SESSION_DEFINITION_SCHEMA,
    id: fixture.job_packet.job_id,
    source: fixture.source,
    job_id: fixture.job_packet.job_id,
    workstream: fixture.job_packet.workstream,
    control_plane: {
      goal_anchor: 'codex-goal',
      packet_state: 'private-runtime-plan',
      status_channel: 'agent-bridge',
    },
    private_body_policy: fixture.job_packet.private_body_policy,
  }
}

function dogfoodEventBodies(fixture: DogfoodRuntimeLogFixture): readonly DogfoodEventBody[] {
  return [
    {
      schema: 'https://atrib.dev/schemas/runtime-log/dogfood-event/v0',
      kind: 'agent_job.packet_selected',
      job_id: fixture.job_packet.job_id,
      payload: {
        workstream: fixture.job_packet.workstream,
        goal_hash: hashCanonical({ goal: fixture.job_packet.goal }, 'dogfood job goal'),
        status_before: fixture.job_packet.status_before,
        source_of_truth_paths: fixture.job_packet.source_of_truth_paths,
        result_packet_path: fixture.job_packet.result_packet_path,
        private_body_policy: fixture.job_packet.private_body_policy,
      },
    },
    ...fixture.bridge_entries.map((entry) => ({
      schema: 'https://atrib.dev/schemas/runtime-log/dogfood-event/v0',
      kind: 'agent_bridge.goal_update',
      job_id: fixture.job_packet.job_id,
      payload: {
        bridge_entry_id: entry.id,
        source: entry.source,
        category: entry.category,
        priority: entry.priority,
        project: entry.project,
        message_id: entry.message_id,
        atrib_receipt_id: entry.atrib_receipt_id,
        job_id: entry.job_id ?? entry.accepted_job,
        status: entry.status,
        next_job: entry.next_job,
        informed_by: entry.informed_by,
        content_hash: entry.content_hash,
        content_summary_hash: hashCanonical(
          { summary: entry.content_summary },
          'dogfood bridge content summary',
        ),
      },
    })),
    {
      schema: 'https://atrib.dev/schemas/runtime-log/dogfood-event/v0',
      kind: 'agent_job.result_packet',
      job_id: fixture.job_packet.job_id,
      payload: {
        status: fixture.result_packet.status,
        bridge_entry_id: fixture.result_packet.bridge_entry_id,
        result_record_hash: fixture.result_packet.result_record_hash,
        annotation_record_hash: fixture.result_packet.annotation_record_hash,
        next_job: fixture.result_packet.next_job,
        checks_hash: hashCanonical(
          { checks_passed: fixture.result_packet.checks_passed },
          'dogfood checks',
        ),
        public_artifact_refs: fixture.result_packet.public_artifact_refs,
        private_artifact_refs: fixture.result_packet.private_artifact_refs,
      },
    },
  ]
}

function validateDogfoodRuntimeLogFixture(fixture: DogfoodRuntimeLogFixture): void {
  if (fixture.schema !== DOGFOOD_RUNTIME_LOG_FIXTURE_SCHEMA) {
    throw new Error('dogfood runtime-log fixture schema is unsupported')
  }
  if (fixture.job_packet.private_body_policy !== 'omitted') {
    throw new Error('dogfood fixture must omit private bodies')
  }
  if (fixture.privacy.raw_bridge_content !== 'omitted') {
    throw new Error('dogfood fixture must omit raw bridge content')
  }
  if (fixture.privacy.private_note_bodies !== 'omitted') {
    throw new Error('dogfood fixture must omit private note bodies')
  }
  for (const hash of fixture.signed_refs) assertSha256Uri(hash, 'signed_refs')
  for (const entry of fixture.bridge_entries) {
    assertSha256Uri(entry.content_hash, `bridge entry ${entry.id} content_hash`)
    for (const hash of entry.informed_by) assertSha256Uri(hash, `bridge entry ${entry.id}`)
  }
  assertSha256Uri(fixture.result_packet.result_record_hash, 'result_record_hash')
  assertSha256Uri(fixture.result_packet.annotation_record_hash, 'annotation_record_hash')
}

function eventTimestamp(fixture: DogfoodRuntimeLogFixture, kind: string): string | undefined {
  if (kind === 'agent_job.packet_selected') return fixture.captured_at
  if (kind === 'agent_job.result_packet') {
    return fixture.bridge_entries.find(
      (entry) => entry.id === fixture.result_packet.bridge_entry_id,
    )?.created_at
  }
  return undefined
}

function comparePositions(left: RuntimeLogPosition, right: RuntimeLogPosition): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  const leftValue = String(left)
  const rightValue = String(right)
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}

function positionsEqual(left: RuntimeLogPosition, right: RuntimeLogPosition): boolean {
  return left === right
}

function formatPosition(position: RuntimeLogPosition): string {
  return JSON.stringify(position)
}

function assertSha256Uri(value: string, label: string): asserts value is Sha256Uri {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be sha256:<64 lowercase hex chars>`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
