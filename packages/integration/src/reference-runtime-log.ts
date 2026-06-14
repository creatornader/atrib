// SPDX-License-Identifier: Apache-2.0

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  createLogWindowManifest,
  hashCanonical,
  hashLogWindow,
  hashLogWindowManifest,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  verifyLogWindowManifest,
  type LogWindowBounds,
  type LogWindowManifest,
  type LogWindowRequest,
  type ManifestVerificationResult,
  type RuntimeLogEventRef,
  type RuntimeLogPosition,
  type RuntimeLogPrivacyPosture,
  type RuntimeLogProjectionRef,
  type RuntimeLogRedactionPolicy,
  type RuntimeLogRuntimeRef,
  type RuntimeLogSideEffectReceiptRef,
  type RuntimeLogSource,
  type RuntimeLogSourceRef,
  type RuntimeLogVerifierPolicy,
  type SessionDefinitionRef,
  type Sha256Uri,
} from '@atrib/runtime-log'

export const REFERENCE_RUNTIME_LOG_ROW_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/reference-jsonl-row/v0' as const
export const REFERENCE_RUNTIME_LOG_SESSION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/reference-session/v0' as const
export const REFERENCE_RUNTIME_LOG_PROJECTION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/reference-event-kind-projection/v0' as const
export const REFERENCE_RUNTIME_LOG_RECEIPT_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/reference-side-effect-receipt/v0' as const
export const REFERENCE_RUNTIME_LOG_EVENT_KIND_PROJECTION =
  'reference-runtime-log.event_kinds' as const
export const REFERENCE_RUNTIME_LOG_SIDE_EFFECT_PROTOCOL =
  'reference-runtime-log.side_effect' as const

export interface ReferenceRuntimeLogSideEffectReceiptBody {
  readonly schema?: typeof REFERENCE_RUNTIME_LOG_RECEIPT_SCHEMA
  readonly idempotency_key: string
  readonly external_ref: string
  readonly operation: string
  readonly [key: string]: unknown
}

export interface ReferenceRuntimeLogSideEffectReceipt {
  readonly protocol: string
  readonly body: ReferenceRuntimeLogSideEffectReceiptBody
  readonly record_hash?: Sha256Uri
  readonly uri?: string
}

export interface ReferenceRuntimeLogRow {
  readonly schema: typeof REFERENCE_RUNTIME_LOG_ROW_SCHEMA
  readonly session_id: string
  readonly event_id: string
  readonly position: RuntimeLogPosition
  readonly kind: string
  readonly body: unknown
  readonly body_hash: Sha256Uri
  readonly timestamp?: string
  readonly parent_event_hashes?: readonly Sha256Uri[]
  readonly side_effect_receipts?: readonly ReferenceRuntimeLogSideEffectReceipt[]
}

export interface ReferenceRuntimeLogSessionDefinition {
  readonly schema: typeof REFERENCE_RUNTIME_LOG_SESSION_SCHEMA
  readonly id: string
  readonly source: {
    readonly id: string
    readonly kind: string
    readonly version: string
  }
  readonly runtime: RuntimeLogRuntimeRef
  readonly storage: {
    readonly kind: 'append-only-jsonl'
    readonly raw_bodies: 'local-only'
    readonly manifest_material: 'hashes-and-refs'
  }
}

export interface ReferenceRuntimeLogAppendInput {
  readonly session_id: string
  readonly kind: string
  readonly body: unknown
  readonly event_id?: string
  readonly position?: RuntimeLogPosition
  readonly timestamp?: string
  readonly parent_event_hashes?: readonly Sha256Uri[]
  readonly side_effect_receipts?: readonly ReferenceRuntimeLogSideEffectReceipt[]
}

export interface ReferenceRuntimeLogJsonlSourceOptions {
  readonly path: string
  readonly source?: RuntimeLogSourceRef
  readonly runtime?: RuntimeLogRuntimeRef
  readonly privacy_posture?: RuntimeLogPrivacyPosture
  readonly redaction?: RuntimeLogRedactionPolicy
  readonly verifier_policy?: RuntimeLogVerifierPolicy
}

export interface ReferenceRuntimeLogWindowBundle {
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly side_effect_receipts: readonly RuntimeLogSideEffectReceiptRef[]
  readonly session_definition: ReferenceRuntimeLogSessionDefinition
  readonly verification: ManifestVerificationResult
}

export interface ReferenceRuntimeLogFixture {
  readonly session_id: string
  readonly fork_session_id: string
  readonly compaction_session_id: string
  readonly main_window: LogWindowBounds
  readonly fork_window: LogWindowBounds
  readonly compaction_window: LogWindowBounds
  readonly source_event_root: Sha256Uri
  readonly compaction_summary_hash: Sha256Uri
}

export interface ReferenceRuntimeLogProof {
  readonly ok: boolean
  readonly strategy: 'reference-runtime-log-jsonl-v0'
  readonly log_path: string
  readonly fixture: ReferenceRuntimeLogFixture
  readonly main: ReferenceRuntimeLogWindowBundle
  readonly fork: ReferenceRuntimeLogWindowBundle
  readonly compaction: ReferenceRuntimeLogWindowBundle
  readonly manifest_hashes: {
    readonly main: Sha256Uri
    readonly fork: Sha256Uri
    readonly compaction: Sha256Uri
  }
  readonly privacy: {
    readonly raw_bodies_in_jsonl: true
    readonly manifests_are_hash_only: true
    readonly public_log_not_required: true
  }
}

interface WindowBuildInput {
  readonly request: LogWindowRequest
  readonly label: string
  readonly fork?: {
    readonly parent_manifest: LogWindowManifest
    readonly reason: string
    readonly fork_event_hash?: Sha256Uri
  }
  readonly compaction?: {
    readonly source_manifest: LogWindowManifest
    readonly compacted_events: readonly RuntimeLogEventRef[]
    readonly summary_hash?: Sha256Uri
  }
}

export class ReferenceRuntimeLogJsonlSource implements RuntimeLogSource {
  readonly path: string
  readonly source: RuntimeLogSourceRef

  private readonly runtime: RuntimeLogRuntimeRef
  private readonly privacyPosture: RuntimeLogPrivacyPosture
  private readonly redaction: RuntimeLogRedactionPolicy
  private readonly verifierPolicy: RuntimeLogVerifierPolicy

  constructor(options: ReferenceRuntimeLogJsonlSourceOptions) {
    this.path = options.path
    this.source = options.source ?? {
      id: 'reference-runtime-log.jsonl',
      kind: 'append-only-jsonl',
      version: '0.1.0',
    }
    this.runtime = options.runtime ?? {
      name: 'reference-runtime-log',
      version: '0.1.0',
    }
    this.privacyPosture = options.privacy_posture ?? 'host-owned'
    this.redaction = options.redaction ?? {
      mode: 'hash-only',
      fields: ['body'],
    }
    this.verifierPolicy = options.verifier_policy ?? {}
  }

  async append(input: ReferenceRuntimeLogAppendInput): Promise<ReferenceRuntimeLogRow> {
    const existingRows = await this.readRows()
    const sessionRows = existingRows.filter((row) => row.session_id === input.session_id)
    const position = input.position ?? sessionRows.length + 1
    const eventId =
      input.event_id ?? `${input.session_id}-evt-${String(sessionRows.length + 1).padStart(3, '0')}`
    const bodyHash = hashRuntimeLogEvent(input.body)
    const parentHashes = input.parent_event_hashes ?? []
    const receipts = input.side_effect_receipts ?? []

    const row: ReferenceRuntimeLogRow = {
      schema: REFERENCE_RUNTIME_LOG_ROW_SCHEMA,
      session_id: input.session_id,
      event_id: eventId,
      position,
      kind: input.kind,
      body: input.body,
      body_hash: bodyHash,
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
      ...(parentHashes.length > 0 ? { parent_event_hashes: parentHashes } : {}),
      ...(receipts.length > 0 ? { side_effect_receipts: receipts } : {}),
    }

    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${JSON.stringify(row)}\n`)
    return row
  }

  async exportWindow(request: LogWindowRequest): Promise<ReferenceRuntimeLogWindowBundle> {
    return this.buildWindowBundle({
      request,
      label: 'reference runtime-log window',
    })
  }

  async exportFork(
    parentManifest: LogWindowManifest,
    request: LogWindowRequest,
    reason = 'reference runtime-log fork',
  ): Promise<ReferenceRuntimeLogWindowBundle> {
    const rows = await this.readWindowRows(request)
    const firstEvent = referenceRuntimeLogRowToEventRef(rows[0]!)
    return this.buildWindowBundle({
      request,
      label: 'reference runtime-log fork',
      fork: {
        parent_manifest: parentManifest,
        reason,
        fork_event_hash: firstEvent.event_hash,
      },
    })
  }

  async exportCompaction(
    sourceManifest: LogWindowManifest,
    request: LogWindowRequest,
    compactedEvents: readonly RuntimeLogEventRef[],
    summaryHash?: Sha256Uri,
  ): Promise<ReferenceRuntimeLogWindowBundle> {
    return this.buildWindowBundle({
      request,
      label: 'reference runtime-log compaction',
      compaction: {
        source_manifest: sourceManifest,
        compacted_events: compactedEvents,
        ...(summaryHash ? { summary_hash: summaryHash } : {}),
      },
    })
  }

  async exportProjection(
    request: LogWindowRequest,
    name = REFERENCE_RUNTIME_LOG_EVENT_KIND_PROJECTION,
  ): Promise<RuntimeLogProjectionRef> {
    const rows = await this.readWindowRows(request)
    return createEventKindProjection(request, rows, name)
  }

  async getSideEffectReceipts(
    request: LogWindowRequest,
  ): Promise<readonly RuntimeLogSideEffectReceiptRef[]> {
    const rows = await this.readWindowRows(request)
    return rows.flatMap((row) => sideEffectReceiptRefs(row))
  }

  async readRows(): Promise<readonly ReferenceRuntimeLogRow[]> {
    return readReferenceRuntimeLogRows(this.path)
  }

  private async buildWindowBundle(
    input: WindowBuildInput,
  ): Promise<ReferenceRuntimeLogWindowBundle> {
    const rows = await this.readWindowRows(input.request)
    const events = rows.map(referenceRuntimeLogRowToEventRef)
    const projections = [createEventKindProjection(input.request, rows)]
    const receipts = rows.flatMap((row) => sideEffectReceiptRefs(row))
    const sessionDefinition = this.createSessionDefinition(input.request.session_id)
    const session: SessionDefinitionRef = {
      id: input.request.session_id,
      digest: hashSessionDefinition(sessionDefinition),
      format: 'reference-runtime-log-session-v0',
    }
    const fork = input.fork
      ? {
          parent_window_manifest_hash: hashLogWindowManifest(input.fork.parent_manifest),
          reason: input.fork.reason,
          ...(input.fork.fork_event_hash ? { fork_event_hash: input.fork.fork_event_hash } : {}),
        }
      : undefined
    const compaction = input.compaction
      ? {
          source_window_manifest_hash: hashLogWindowManifest(input.compaction.source_manifest),
          compacted_event_root: hashLogWindow(input.compaction.compacted_events),
          ...(input.compaction.summary_hash ? { summary_hash: input.compaction.summary_hash } : {}),
        }
      : undefined
    const verifierPolicy: RuntimeLogVerifierPolicy = {
      require_event_root: true,
      require_session_definition: true,
      require_projection_roots: projections.map((projection) => projection.name),
      trusted_sources: [this.source.id],
      ...(receipts.length > 0
        ? { require_receipt_protocols: uniqueStrings(receipts.map((receipt) => receipt.protocol)) }
        : {}),
      ...(fork ? { require_fork_parent: true } : {}),
      ...(compaction ? { require_compaction_source: true } : {}),
      ...this.verifierPolicy,
    }

    const manifest = createLogWindowManifest({
      source: this.source,
      runtime: this.runtime,
      session,
      window: {
        start: input.request.start,
        end: input.request.end,
        label: input.label,
      },
      events,
      projections,
      ...(fork ? { fork } : {}),
      ...(compaction ? { compaction } : {}),
      ...(receipts.length > 0 ? { side_effect_receipts: receipts } : {}),
      redaction: this.redaction,
      privacy_posture: this.privacyPosture,
      verifier_policy: verifierPolicy,
    })
    const verification = verifyLogWindowManifest(manifest, {
      session_definition: sessionDefinition,
      events,
      projections,
      ...(receipts.length > 0 ? { side_effect_receipts: receipts } : {}),
      ...(input.fork ? { fork_parent_manifest: input.fork.parent_manifest } : {}),
      ...(input.compaction
        ? {
            compaction_source_manifest: input.compaction.source_manifest,
            compaction_events: input.compaction.compacted_events,
          }
        : {}),
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

  private async readWindowRows(
    request: LogWindowRequest,
  ): Promise<readonly ReferenceRuntimeLogRow[]> {
    const rows = (await this.readRows())
      .filter((row) => row.session_id === request.session_id)
      .filter((row) => positionInRange(row.position, request.start, request.end))
      .sort(compareRowsByPosition)

    if (rows.length === 0) {
      throw new Error(
        `reference runtime log has no events for ${request.session_id} ${formatPosition(
          request.start,
        )}..${formatPosition(request.end)}`,
      )
    }
    const first = rows[0]!
    const last = rows[rows.length - 1]!
    if (
      !positionsEqual(first.position, request.start) ||
      !positionsEqual(last.position, request.end)
    ) {
      throw new Error(
        `reference runtime log window must start and end on event positions: requested ${formatPosition(
          request.start,
        )}..${formatPosition(request.end)}, got ${formatPosition(first.position)}..${formatPosition(
          last.position,
        )}`,
      )
    }
    return rows
  }

  private createSessionDefinition(sessionId: string): ReferenceRuntimeLogSessionDefinition {
    return {
      schema: REFERENCE_RUNTIME_LOG_SESSION_SCHEMA,
      id: sessionId,
      source: {
        id: this.source.id,
        kind: this.source.kind ?? 'append-only-jsonl',
        version: this.source.version ?? '0.1.0',
      },
      runtime: this.runtime,
      storage: {
        kind: 'append-only-jsonl',
        raw_bodies: 'local-only',
        manifest_material: 'hashes-and-refs',
      },
    }
  }
}

export async function readReferenceRuntimeLogRows(
  path: string,
): Promise<readonly ReferenceRuntimeLogRow[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseReferenceRuntimeLogRow(line, `${path}:${index + 1}`))
}

export function referenceRuntimeLogRowToEventRef(row: ReferenceRuntimeLogRow): RuntimeLogEventRef {
  return {
    event_id: row.event_id,
    position: row.position,
    event_hash: row.body_hash,
    kind: row.kind,
    ...(row.timestamp ? { timestamp: row.timestamp } : {}),
    ...(row.parent_event_hashes ? { parent_event_hashes: row.parent_event_hashes } : {}),
  }
}

export async function writeReferenceRuntimeLogFixture(
  source: ReferenceRuntimeLogJsonlSource,
): Promise<ReferenceRuntimeLogFixture> {
  const sessionId = 'reference-run-001'
  const forkSessionId = 'reference-run-001-fork'
  const compactionSessionId = 'reference-run-001-compact'

  const rows = [
    await source.append({
      session_id: sessionId,
      event_id: 'ref-evt-001',
      position: 1,
      timestamp: '2026-06-14T12:00:00.000Z',
      kind: 'user.message',
      body: referenceEventBody('user.message', {
        actor: 'demo-user',
        content: 'Draft the customer payment clause from the uploaded notes.',
      }),
    }),
    await source.append({
      session_id: sessionId,
      event_id: 'ref-evt-002',
      position: 2,
      timestamp: '2026-06-14T12:00:01.000Z',
      kind: 'model.plan',
      body: referenceEventBody('model.plan', {
        model: 'fixture-model',
        plan_steps: ['read-notes', 'draft-clause', 'request-approval'],
      }),
    }),
    await source.append({
      session_id: sessionId,
      event_id: 'ref-evt-003',
      position: 3,
      timestamp: '2026-06-14T12:00:02.000Z',
      kind: 'tool.call',
      body: referenceEventBody('tool.call', {
        tool: 'docs.create_draft',
        args_hash: hashCanonical({ title: 'Payment clause', source: 'uploaded-notes' }),
      }),
      side_effect_receipts: [
        {
          protocol: REFERENCE_RUNTIME_LOG_SIDE_EFFECT_PROTOCOL,
          body: {
            schema: REFERENCE_RUNTIME_LOG_RECEIPT_SCHEMA,
            idempotency_key: 'idem-ref-001',
            external_ref: 'draft://payment-clause-001',
            operation: 'docs.create_draft',
            status: 'created',
          },
          uri: 'reference-runtime-log://side-effects/draft/payment-clause-001',
        },
      ],
    }),
    await source.append({
      session_id: sessionId,
      event_id: 'ref-evt-004',
      position: 4,
      timestamp: '2026-06-14T12:00:03.000Z',
      kind: 'approval.granted',
      body: referenceEventBody('approval.granted', {
        reviewer: 'demo-reviewer',
        approved_event_id: 'ref-evt-003',
      }),
    }),
    await source.append({
      session_id: sessionId,
      event_id: 'ref-evt-005',
      position: 5,
      timestamp: '2026-06-14T12:00:04.000Z',
      kind: 'tool.result',
      body: referenceEventBody('tool.result', {
        tool: 'docs.create_draft',
        result_hash: hashCanonical({ draft_id: 'payment-clause-001', revision: 1 }),
      }),
    }),
    await source.append({
      session_id: sessionId,
      event_id: 'ref-evt-006',
      position: 6,
      timestamp: '2026-06-14T12:00:05.000Z',
      kind: 'model.final',
      body: referenceEventBody('model.final', {
        output_hash: hashCanonical({ final: 'payment clause draft ready for review' }),
      }),
    }),
  ]
  const mainEvents = rows.map(referenceRuntimeLogRowToEventRef)
  const sourceEventRoot = hashLogWindow(mainEvents)
  const forkParentHash = mainEvents[1]!.event_hash

  await source.append({
    session_id: forkSessionId,
    event_id: 'fork-evt-001',
    position: 1,
    timestamp: '2026-06-14T12:01:00.000Z',
    kind: 'fork.started',
    parent_event_hashes: [forkParentHash],
    body: referenceEventBody('fork.started', {
      parent_session_id: sessionId,
      parent_event_id: 'ref-evt-002',
      reason: 'try a shorter clause variant',
    }),
  })
  await source.append({
    session_id: forkSessionId,
    event_id: 'fork-evt-002',
    position: 2,
    timestamp: '2026-06-14T12:01:01.000Z',
    kind: 'model.final',
    body: referenceEventBody('model.final', {
      output_hash: hashCanonical({ final: 'short payment clause variant ready' }),
    }),
  })

  const compactionSummaryHash = hashCanonical({
    source_event_root: sourceEventRoot,
    summary: 'Six runtime events compacted into one local continuation summary.',
  })
  await source.append({
    session_id: compactionSessionId,
    event_id: 'compact-evt-001',
    position: 1,
    timestamp: '2026-06-14T12:02:00.000Z',
    kind: 'compaction.summary',
    body: referenceEventBody('compaction.summary', {
      source_session_id: sessionId,
      source_event_root: sourceEventRoot,
      summary_hash: compactionSummaryHash,
      retained_event_count: mainEvents.length,
    }),
  })

  return {
    session_id: sessionId,
    fork_session_id: forkSessionId,
    compaction_session_id: compactionSessionId,
    main_window: { start: 1, end: 6, label: 'reference main window' },
    fork_window: { start: 1, end: 2, label: 'reference fork window' },
    compaction_window: { start: 1, end: 1, label: 'reference compaction window' },
    source_event_root: sourceEventRoot,
    compaction_summary_hash: compactionSummaryHash,
  }
}

export async function buildReferenceRuntimeLogProof(
  path: string,
): Promise<ReferenceRuntimeLogProof> {
  const source = new ReferenceRuntimeLogJsonlSource({ path })
  const fixture = await writeReferenceRuntimeLogFixture(source)
  const main = await source.exportWindow({
    session_id: fixture.session_id,
    start: fixture.main_window.start,
    end: fixture.main_window.end,
  })
  const fork = await source.exportFork(
    main.manifest,
    {
      session_id: fixture.fork_session_id,
      start: fixture.fork_window.start,
      end: fixture.fork_window.end,
    },
    'try a shorter clause variant',
  )
  const compaction = await source.exportCompaction(
    main.manifest,
    {
      session_id: fixture.compaction_session_id,
      start: fixture.compaction_window.start,
      end: fixture.compaction_window.end,
    },
    main.events,
    fixture.compaction_summary_hash,
  )

  return {
    ok: main.verification.valid && fork.verification.valid && compaction.verification.valid,
    strategy: 'reference-runtime-log-jsonl-v0',
    log_path: path,
    fixture,
    main,
    fork,
    compaction,
    manifest_hashes: {
      main: hashLogWindowManifest(main.manifest),
      fork: hashLogWindowManifest(fork.manifest),
      compaction: hashLogWindowManifest(compaction.manifest),
    },
    privacy: {
      raw_bodies_in_jsonl: true,
      manifests_are_hash_only: true,
      public_log_not_required: true,
    },
  }
}

function parseReferenceRuntimeLogRow(line: string, label: string): ReferenceRuntimeLogRow {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${errorMessage(error)}`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  const schema = readLiteral(parsed, 'schema', REFERENCE_RUNTIME_LOG_ROW_SCHEMA, label)
  const sessionId = readString(parsed, 'session_id', label)
  const eventId = readString(parsed, 'event_id', label)
  const position = readPosition(parsed, 'position', label)
  const kind = readString(parsed, 'kind', label)
  const body = parsed.body
  const bodyHash = readSha256Uri(parsed, 'body_hash', label)
  const expectedBodyHash = hashRuntimeLogEvent(body)
  if (bodyHash !== expectedBodyHash) {
    throw new Error(`${label}.body_hash mismatch: expected ${expectedBodyHash}, got ${bodyHash}`)
  }
  const timestamp = readOptionalString(parsed, 'timestamp', label)
  const parentEventHashes = readOptionalSha256UriArray(parsed, 'parent_event_hashes', label)
  const receipts = readOptionalSideEffectReceipts(parsed, label)

  return {
    schema,
    session_id: sessionId,
    event_id: eventId,
    position,
    kind,
    body,
    body_hash: bodyHash,
    ...(timestamp ? { timestamp } : {}),
    ...(parentEventHashes ? { parent_event_hashes: parentEventHashes } : {}),
    ...(receipts ? { side_effect_receipts: receipts } : {}),
  }
}

function createEventKindProjection(
  request: LogWindowRequest,
  rows: readonly ReferenceRuntimeLogRow[],
  name = REFERENCE_RUNTIME_LOG_EVENT_KIND_PROJECTION,
): RuntimeLogProjectionRef {
  return {
    name,
    format: 'reference-runtime-log.event-kind-window.v0',
    root_hash: hashCanonical(
      {
        schema: REFERENCE_RUNTIME_LOG_PROJECTION_SCHEMA,
        session_id: request.session_id,
        window: {
          start: request.start,
          end: request.end,
        },
        events: rows.map((row) => ({
          event_id: row.event_id,
          position: row.position,
          kind: row.kind,
          event_hash: row.body_hash,
        })),
      },
      'reference runtime-log projection',
    ),
    event_count: rows.length,
  }
}

function sideEffectReceiptRefs(row: ReferenceRuntimeLogRow): RuntimeLogSideEffectReceiptRef[] {
  return (row.side_effect_receipts ?? []).map((receipt) => ({
    protocol: receipt.protocol,
    receipt_hash: hashCanonical(
      {
        schema: 'https://atrib.dev/schemas/runtime-log/reference-side-effect-receipt-ref/v0',
        session_id: row.session_id,
        event_id: row.event_id,
        position: row.position,
        receipt: receipt.body,
      },
      'reference runtime-log side-effect receipt',
    ),
    ...(receipt.record_hash ? { record_hash: receipt.record_hash } : {}),
    ...(receipt.uri ? { uri: receipt.uri } : {}),
  }))
}

function referenceEventBody(
  kind: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema: 'https://atrib.dev/schemas/runtime-log/reference-event-body/v0',
    kind,
    payload,
  }
}

function positionInRange(
  position: RuntimeLogPosition,
  start: RuntimeLogPosition,
  end: RuntimeLogPosition,
): boolean {
  return comparePositions(position, start) >= 0 && comparePositions(position, end) <= 0
}

function compareRowsByPosition(
  left: ReferenceRuntimeLogRow,
  right: ReferenceRuntimeLogRow,
): number {
  const positionComparison = comparePositions(left.position, right.position)
  if (positionComparison !== 0) return positionComparison
  if (left.event_id < right.event_id) return -1
  if (left.event_id > right.event_id) return 1
  return 0
}

function comparePositions(left: RuntimeLogPosition, right: RuntimeLogPosition): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
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

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function readLiteral<T extends string>(
  value: Record<string, unknown>,
  key: string,
  expected: T,
  label: string,
): T {
  const actual = readString(value, key, label)
  if (actual !== expected) {
    throw new Error(`${label}.${key} must be ${expected}`)
  }
  return expected
}

function readString(value: Record<string, unknown>, key: string, label: string): string {
  const child = value[key]
  if (typeof child !== 'string' || child.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`)
  }
  return child
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (value[key] === undefined) return undefined
  return readString(value, key, label)
}

function readPosition(
  value: Record<string, unknown>,
  key: string,
  label: string,
): RuntimeLogPosition {
  const child = value[key]
  if (typeof child !== 'string' && typeof child !== 'number') {
    throw new Error(`${label}.${key} must be a string or number`)
  }
  return child
}

function readSha256Uri(value: Record<string, unknown>, key: string, label: string): Sha256Uri {
  const child = readString(value, key, label)
  if (!/^sha256:[0-9a-f]{64}$/.test(child)) {
    throw new Error(`${label}.${key} must be sha256:<64 lowercase hex chars>`)
  }
  return child as Sha256Uri
}

function readOptionalSha256UriArray(
  value: Record<string, unknown>,
  key: string,
  label: string,
): readonly Sha256Uri[] | undefined {
  const child = value[key]
  if (child === undefined) return undefined
  if (!Array.isArray(child)) {
    throw new Error(`${label}.${key} must be an array`)
  }
  return child.map((entry, index) => {
    if (typeof entry !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(entry)) {
      throw new Error(`${label}.${key}[${index}] must be sha256:<64 lowercase hex chars>`)
    }
    return entry as Sha256Uri
  })
}

function readOptionalSideEffectReceipts(
  value: Record<string, unknown>,
  label: string,
): readonly ReferenceRuntimeLogSideEffectReceipt[] | undefined {
  const child = value.side_effect_receipts
  if (child === undefined) return undefined
  if (!Array.isArray(child)) {
    throw new Error(`${label}.side_effect_receipts must be an array`)
  }
  return child.map((entry, index) =>
    parseSideEffectReceipt(entry, `${label}.side_effect_receipts[${index}]`),
  )
}

function parseSideEffectReceipt(
  value: unknown,
  label: string,
): ReferenceRuntimeLogSideEffectReceipt {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  const body = value.body
  if (!isRecord(body)) {
    throw new Error(`${label}.body must be a JSON object`)
  }
  const parsedBody = {
    ...body,
    idempotency_key: readString(body, 'idempotency_key', `${label}.body`),
    external_ref: readString(body, 'external_ref', `${label}.body`),
    operation: readString(body, 'operation', `${label}.body`),
  }
  const recordHash =
    value.record_hash === undefined ? undefined : readSha256Uri(value, 'record_hash', label)
  const uri = readOptionalString(value, 'uri', label)

  return {
    protocol: readString(value, 'protocol', label),
    body: parsedBody,
    ...(recordHash ? { record_hash: recordHash } : {}),
    ...(uri ? { uri } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
