// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
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
  type RuntimeLogProjectionRef,
  type RuntimeLogSource,
  type RuntimeLogSourceRef,
  type Sha256Uri,
} from '@atrib/runtime-log'

export const LANGGRAPH_CHECKPOINT_FIXTURE_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/langgraph-checkpoint-fixture/v0' as const
export const LANGGRAPH_CHECKPOINT_SESSION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/langgraph-checkpoint-session/v0' as const
export const LANGGRAPH_CHECKPOINT_KIND_PROJECTION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/langgraph-checkpoint-kind-projection/v0' as const
export const LANGGRAPH_CHECKPOINT_KIND_PROJECTION = 'langgraph.checkpoint_kinds' as const

export const OPENINFERENCE_TRACE_PROJECTION_FIXTURE_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/openinference-trace-projection-fixture/v0' as const
export const OPENINFERENCE_TRACE_PROJECTION_SESSION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/openinference-trace-projection-session/v0' as const
export const OPENINFERENCE_SPAN_TREE_PROJECTION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/openinference-span-tree-projection/v0' as const
export const OPENINFERENCE_SPAN_TREE_PROJECTION = 'openinference.span_tree' as const

export interface AdapterBoundarySession {
  readonly runtime_log_identity: boolean
  readonly projection_only: boolean
  readonly resume_supported: boolean
  readonly fork_supported: boolean
  readonly raw_bodies: 'local-only' | 'not-owned'
}

export interface LangGraphCheckpointEvent {
  readonly session_id: string
  readonly event_id: string
  readonly checkpoint_id: string
  readonly position: number
  readonly kind: string
  readonly timestamp: string
  readonly checkpoint_ref: string
  readonly state_digest: Sha256Uri
  readonly parent_checkpoint_ids?: readonly string[]
  readonly resume_from_checkpoint_id?: string
  readonly forked_from_checkpoint_id?: string
  readonly metadata?: Record<string, string | number | boolean>
}

export interface LangGraphCheckpointFixture {
  readonly schema: typeof LANGGRAPH_CHECKPOINT_FIXTURE_SCHEMA
  readonly captured_at: string
  readonly source: {
    readonly id: string
    readonly kind: 'langgraph-checkpoint-log'
    readonly version: string
  }
  readonly runtime: {
    readonly name: 'langgraph-checkpointer'
    readonly version: string
    readonly environment: string
  }
  readonly thread: {
    readonly main_session_id: string
    readonly fork_session_id: string
    readonly saver: string
    readonly raw_state_policy: 'local-only'
  }
  readonly checkpoints: readonly LangGraphCheckpointEvent[]
  readonly privacy: {
    readonly raw_checkpoint_bodies: 'omitted'
    readonly fixture_contains: 'checkpoint-ids-state-digests-and-refs'
  }
}

export interface LangGraphCheckpointSessionDefinition {
  readonly schema: typeof LANGGRAPH_CHECKPOINT_SESSION_SCHEMA
  readonly id: string
  readonly source: LangGraphCheckpointFixture['source']
  readonly runtime: LangGraphCheckpointFixture['runtime']
  readonly storage: {
    readonly kind: 'checkpoint-log'
    readonly saver: string
    readonly raw_checkpoint_bodies: 'local-only'
    readonly manifest_material: 'event-hashes-and-checkpoint-refs'
  }
  readonly boundary: AdapterBoundarySession
}

export interface LangGraphCheckpointWindowBundle {
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly session_definition: LangGraphCheckpointSessionDefinition
  readonly verification: ManifestVerificationResult
}

export interface LangGraphCheckpointRuntimeLogProof {
  readonly ok: boolean
  readonly strategy: 'langgraph-checkpoint-runtime-log-v0'
  readonly main: LangGraphCheckpointWindowBundle
  readonly fork: LangGraphCheckpointWindowBundle
  readonly manifest_hashes: {
    readonly main: Sha256Uri
    readonly fork: Sha256Uri
  }
  readonly fixture: {
    readonly main_session_id: string
    readonly fork_session_id: string
    readonly checkpoint_count: number
  }
}

export interface OpenInferenceTraceProjectionSpan {
  readonly trace_id: string
  readonly span_id: string
  readonly parent_span_id?: string
  readonly position: number
  readonly name: string
  readonly kind: string
  readonly timestamp: string
  readonly span_digest: Sha256Uri
  readonly signed_record_hash?: Sha256Uri
  readonly attributes?: Record<string, string | number | boolean>
}

export interface OpenInferenceTraceProjectionFixture {
  readonly schema: typeof OPENINFERENCE_TRACE_PROJECTION_FIXTURE_SCHEMA
  readonly captured_at: string
  readonly source: {
    readonly id: string
    readonly kind: 'openinference-trace-projection'
    readonly version: string
  }
  readonly runtime: {
    readonly name: 'openinference'
    readonly version: string
    readonly environment: string
  }
  readonly trace: {
    readonly id: string
    readonly source_runtime: string
    readonly projection_scope: 'span-tree'
    readonly runtime_identity: 'not-owned'
  }
  readonly spans: readonly OpenInferenceTraceProjectionSpan[]
  readonly privacy: {
    readonly raw_span_bodies: 'omitted'
    readonly fixture_contains: 'span-ids-digests-parent-edges-and-record-refs'
  }
}

export interface OpenInferenceTraceProjectionSessionDefinition {
  readonly schema: typeof OPENINFERENCE_TRACE_PROJECTION_SESSION_SCHEMA
  readonly id: string
  readonly source: OpenInferenceTraceProjectionFixture['source']
  readonly runtime: OpenInferenceTraceProjectionFixture['runtime']
  readonly trace: OpenInferenceTraceProjectionFixture['trace']
  readonly boundary: AdapterBoundarySession & {
    readonly parent_runtime_required_for_replay: true
  }
}

export interface OpenInferenceTraceProjectionBundle {
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly session_definition: OpenInferenceTraceProjectionSessionDefinition
  readonly verification: ManifestVerificationResult
}

export type SecondaryAdapterBoundaryIssueCode =
  | 'runtime_manifest_invalid'
  | 'runtime_fork_missing'
  | 'runtime_session_not_runtime_identity'
  | 'projection_manifest_invalid'
  | 'projection_not_labeled_projection'
  | 'projection_claims_runtime_identity'
  | 'projection_claims_fork_or_resume'
  | 'projection_missing_span_tree_projection'

export interface SecondaryAdapterBoundaryIssue {
  readonly code: SecondaryAdapterBoundaryIssueCode
  readonly message: string
}

export interface SecondaryAdapterBoundaryResult {
  readonly valid: boolean
  readonly checks: {
    readonly runtime_manifest: boolean
    readonly runtime_fork: boolean
    readonly runtime_identity: boolean
    readonly trace_projection_manifest: boolean
    readonly trace_projection_label: boolean
    readonly trace_projection_only: boolean
    readonly trace_projection_no_fork_or_resume: boolean
    readonly trace_projection_root: boolean
  }
  readonly issues: readonly SecondaryAdapterBoundaryIssue[]
}

export interface SecondaryAdapterFamilyProof {
  readonly ok: boolean
  readonly strategy: 'runtime-log-second-adapter-family-v0'
  readonly runtime_adapter: LangGraphCheckpointRuntimeLogProof
  readonly trace_projection_adapter: OpenInferenceTraceProjectionBundle
  readonly trace_projection_manifest_hash: Sha256Uri
  readonly boundary_verification: SecondaryAdapterBoundaryResult
  readonly distinction: {
    readonly runtime_source: 'langgraph-checkpoint-log'
    readonly trace_projection: 'openinference-span-tree'
    readonly projection_is_not_runtime_identity: true
  }
}

interface LangGraphWindowBuildInput {
  readonly request: LogWindowRequest
  readonly label: string
  readonly fork?: {
    readonly parent_manifest: LogWindowManifest
    readonly fork_event_hash: Sha256Uri
    readonly reason: string
  }
}

export class LangGraphCheckpointRuntimeLogSource implements RuntimeLogSource {
  readonly source: RuntimeLogSourceRef

  private readonly fixture: LangGraphCheckpointFixture

  constructor(fixture: LangGraphCheckpointFixture) {
    validateLangGraphCheckpointFixture(fixture)
    this.fixture = fixture
    this.source = {
      id: fixture.source.id,
      kind: fixture.source.kind,
      version: fixture.source.version,
    }
  }

  exportWindow(request: LogWindowRequest): LangGraphCheckpointWindowBundle {
    return this.buildWindow({
      request,
      label: 'LangGraph checkpoint runtime-log window',
    })
  }

  exportFork(
    parentManifest: LogWindowManifest,
    request: LogWindowRequest,
    reason = 'LangGraph checkpoint fork',
  ): LangGraphCheckpointWindowBundle {
    const rows = this.windowRows(request)
    const first = langGraphCheckpointEventsToRefs(rows)[0]!
    return this.buildWindow({
      request,
      label: 'LangGraph checkpoint fork window',
      fork: {
        parent_manifest: parentManifest,
        fork_event_hash: first.event_hash,
        reason,
      },
    })
  }

  private buildWindow(input: LangGraphWindowBuildInput): LangGraphCheckpointWindowBundle {
    const rows = this.windowRows(input.request)
    const events = langGraphCheckpointEventsToRefs(rows)
    const projections = [createLangGraphCheckpointKindProjection(input.request, rows)]
    const sessionDefinition = langGraphCheckpointSessionDefinition(
      this.fixture,
      input.request.session_id,
    )
    const fork = input.fork
      ? {
          parent_window_manifest_hash: hashLogWindowManifest(input.fork.parent_manifest),
          fork_event_hash: input.fork.fork_event_hash,
          reason: input.fork.reason,
        }
      : undefined
    const manifest = createLogWindowManifest({
      source: this.source,
      runtime: this.fixture.runtime,
      session: {
        id: input.request.session_id,
        digest: hashSessionDefinition(sessionDefinition),
        format: 'langgraph-checkpoint-session-v0',
      },
      window: {
        start: input.request.start,
        end: input.request.end,
        label: input.label,
      },
      events,
      projections,
      ...(fork ? { fork } : {}),
      redaction: {
        mode: 'hash-only',
        fields: ['checkpoint_body', 'state', 'messages'],
      },
      privacy_posture: 'host-owned',
      verifier_policy: {
        require_event_root: true,
        require_session_definition: true,
        require_projection_roots: [LANGGRAPH_CHECKPOINT_KIND_PROJECTION],
        trusted_sources: [this.source.id],
        ...(fork ? { require_fork_parent: true } : {}),
      },
    })
    const verification = verifyLogWindowManifest(manifest, {
      session_definition: sessionDefinition,
      events,
      projections,
      ...(input.fork ? { fork_parent_manifest: input.fork.parent_manifest } : {}),
    })
    return {
      manifest,
      events,
      projections,
      session_definition: sessionDefinition,
      verification,
    }
  }

  private windowRows(request: LogWindowRequest): readonly LangGraphCheckpointEvent[] {
    const rows = this.fixture.checkpoints
      .filter((event) => event.session_id === request.session_id)
      .filter(
        (event) => event.position >= Number(request.start) && event.position <= Number(request.end),
      )
      .sort((left, right) => left.position - right.position)
    if (rows.length === 0) {
      throw new Error(`LangGraph checkpoint fixture has no rows for ${request.session_id}`)
    }
    const first = rows[0]!
    const last = rows[rows.length - 1]!
    if (first.position !== request.start || last.position !== request.end) {
      throw new Error(
        `LangGraph checkpoint window must start and end on event positions: requested ${request.start}..${request.end}, got ${first.position}..${last.position}`,
      )
    }
    return rows
  }
}

export class OpenInferenceTraceProjectionSource implements RuntimeLogSource {
  readonly source: RuntimeLogSourceRef

  private readonly fixture: OpenInferenceTraceProjectionFixture

  constructor(fixture: OpenInferenceTraceProjectionFixture) {
    validateOpenInferenceTraceProjectionFixture(fixture)
    this.fixture = fixture
    this.source = {
      id: fixture.source.id,
      kind: fixture.source.kind,
      version: fixture.source.version,
    }
  }

  exportWindow(request: LogWindowRequest): OpenInferenceTraceProjectionBundle {
    if (request.session_id !== this.fixture.trace.id) {
      throw new Error(`unknown OpenInference trace projection: ${request.session_id}`)
    }
    const spans = this.fixture.spans
      .filter(
        (span) => span.position >= Number(request.start) && span.position <= Number(request.end),
      )
      .sort((left, right) => left.position - right.position)
    if (spans.length === 0) {
      throw new Error(`OpenInference projection has no spans for ${request.session_id}`)
    }
    const first = spans[0]!
    const last = spans[spans.length - 1]!
    if (first.position !== request.start || last.position !== request.end) {
      throw new Error(
        `OpenInference projection window must start and end on span positions: requested ${request.start}..${request.end}, got ${first.position}..${last.position}`,
      )
    }

    const events = openInferenceSpansToEventRefs(spans)
    const projections = [createOpenInferenceSpanTreeProjection(this.fixture.trace.id, spans)]
    const sessionDefinition = openInferenceTraceProjectionSessionDefinition(this.fixture)
    const manifest = createLogWindowManifest({
      source: this.source,
      runtime: this.fixture.runtime,
      session: {
        id: this.fixture.trace.id,
        digest: hashSessionDefinition(sessionDefinition),
        format: 'openinference-trace-projection-session-v0',
      },
      window: {
        start: request.start,
        end: request.end,
        label: 'OpenInference trace projection window',
      },
      events,
      projections,
      redaction: {
        mode: 'hash-only',
        fields: ['input', 'output', 'prompt', 'completion', 'messages'],
      },
      privacy_posture: 'host-owned',
      verifier_policy: {
        require_event_root: true,
        require_session_definition: true,
        require_projection_roots: [OPENINFERENCE_SPAN_TREE_PROJECTION],
        trusted_sources: [this.source.id],
      },
    })
    const verification = verifyLogWindowManifest(manifest, {
      session_definition: sessionDefinition,
      events,
      projections,
    })
    return {
      manifest,
      events,
      projections,
      session_definition: sessionDefinition,
      verification,
    }
  }
}

export async function readLangGraphCheckpointFixture(
  path: string,
): Promise<LangGraphCheckpointFixture> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  validateLangGraphCheckpointFixture(parsed)
  return parsed
}

export async function readOpenInferenceTraceProjectionFixture(
  path: string,
): Promise<OpenInferenceTraceProjectionFixture> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  validateOpenInferenceTraceProjectionFixture(parsed)
  return parsed
}

export async function buildLangGraphCheckpointRuntimeLogProof(
  fixturePath: string,
): Promise<LangGraphCheckpointRuntimeLogProof> {
  const fixture = await readLangGraphCheckpointFixture(fixturePath)
  const source = new LangGraphCheckpointRuntimeLogSource(fixture)
  const main = source.exportWindow({
    session_id: fixture.thread.main_session_id,
    start: firstPosition(fixture.checkpoints, fixture.thread.main_session_id),
    end: lastPosition(fixture.checkpoints, fixture.thread.main_session_id),
  })
  const fork = source.exportFork(main.manifest, {
    session_id: fixture.thread.fork_session_id,
    start: firstPosition(fixture.checkpoints, fixture.thread.fork_session_id),
    end: lastPosition(fixture.checkpoints, fixture.thread.fork_session_id),
  })

  return {
    ok: main.verification.valid && fork.verification.valid,
    strategy: 'langgraph-checkpoint-runtime-log-v0',
    main,
    fork,
    manifest_hashes: {
      main: hashLogWindowManifest(main.manifest),
      fork: hashLogWindowManifest(fork.manifest),
    },
    fixture: {
      main_session_id: fixture.thread.main_session_id,
      fork_session_id: fixture.thread.fork_session_id,
      checkpoint_count: fixture.checkpoints.length,
    },
  }
}

export async function buildOpenInferenceTraceProjectionProof(
  fixturePath: string,
): Promise<OpenInferenceTraceProjectionBundle> {
  const fixture = await readOpenInferenceTraceProjectionFixture(fixturePath)
  const source = new OpenInferenceTraceProjectionSource(fixture)
  return source.exportWindow({
    session_id: fixture.trace.id,
    start: firstSpanPosition(fixture.spans),
    end: lastSpanPosition(fixture.spans),
  })
}

export async function buildSecondaryAdapterFamilyProof(options: {
  readonly langGraphFixturePath: string
  readonly openInferenceFixturePath: string
}): Promise<SecondaryAdapterFamilyProof> {
  const runtimeAdapter = await buildLangGraphCheckpointRuntimeLogProof(options.langGraphFixturePath)
  const traceProjectionAdapter = await buildOpenInferenceTraceProjectionProof(
    options.openInferenceFixturePath,
  )
  const boundary = verifySecondaryAdapterFamilyBoundary(runtimeAdapter, traceProjectionAdapter)
  return {
    ok: runtimeAdapter.ok && traceProjectionAdapter.verification.valid && boundary.valid,
    strategy: 'runtime-log-second-adapter-family-v0',
    runtime_adapter: runtimeAdapter,
    trace_projection_adapter: traceProjectionAdapter,
    trace_projection_manifest_hash: hashLogWindowManifest(traceProjectionAdapter.manifest),
    boundary_verification: boundary,
    distinction: {
      runtime_source: 'langgraph-checkpoint-log',
      trace_projection: 'openinference-span-tree',
      projection_is_not_runtime_identity: true,
    },
  }
}

export function verifySecondaryAdapterFamilyBoundary(
  runtimeAdapter: LangGraphCheckpointRuntimeLogProof,
  traceProjectionAdapter: OpenInferenceTraceProjectionBundle,
): SecondaryAdapterBoundaryResult {
  const issues: SecondaryAdapterBoundaryIssue[] = []
  const runtimeIdentity =
    runtimeAdapter.main.session_definition.boundary.runtime_log_identity === true
  const runtimeFork = runtimeAdapter.fork.manifest.fork !== undefined
  const traceBoundary = verifyOpenInferenceTraceProjectionBoundary(
    traceProjectionAdapter.manifest,
    traceProjectionAdapter.session_definition,
  )
  issues.push(...traceBoundary.issues)

  if (!runtimeAdapter.main.verification.valid || !runtimeAdapter.fork.verification.valid) {
    issues.push({
      code: 'runtime_manifest_invalid',
      message: 'LangGraph checkpoint runtime manifests must verify before boundary checks pass.',
    })
  }
  if (!runtimeFork) {
    issues.push({
      code: 'runtime_fork_missing',
      message: 'LangGraph checkpoint runtime adapter must bind its fork to a parent window.',
    })
  }
  if (!runtimeIdentity) {
    issues.push({
      code: 'runtime_session_not_runtime_identity',
      message: 'LangGraph checkpoint session must claim runtime-log identity.',
    })
  }

  return {
    valid: issues.length === 0,
    checks: {
      runtime_manifest:
        runtimeAdapter.main.verification.valid && runtimeAdapter.fork.verification.valid,
      runtime_fork: runtimeFork,
      runtime_identity: runtimeIdentity,
      trace_projection_manifest: traceProjectionAdapter.verification.valid,
      trace_projection_label: traceBoundary.checks.trace_projection_label,
      trace_projection_only: traceBoundary.checks.trace_projection_only,
      trace_projection_no_fork_or_resume: traceBoundary.checks.trace_projection_no_fork_or_resume,
      trace_projection_root: traceBoundary.checks.trace_projection_root,
    },
    issues,
  }
}

export function verifyOpenInferenceTraceProjectionBoundary(
  manifest: LogWindowManifest,
  sessionDefinition: OpenInferenceTraceProjectionSessionDefinition,
): Pick<SecondaryAdapterBoundaryResult, 'valid' | 'issues'> & {
  readonly checks: Pick<
    SecondaryAdapterBoundaryResult['checks'],
    | 'trace_projection_label'
    | 'trace_projection_only'
    | 'trace_projection_no_fork_or_resume'
    | 'trace_projection_root'
  >
} {
  const issues: SecondaryAdapterBoundaryIssue[] = []
  const traceProjectionLabel =
    manifest.source.kind === 'openinference-trace-projection' &&
    sessionDefinition.source.kind === 'openinference-trace-projection'
  const traceProjectionOnly =
    sessionDefinition.boundary.projection_only === true &&
    sessionDefinition.boundary.runtime_log_identity === false
  const noForkOrResume =
    manifest.fork === undefined &&
    manifest.verifier_policy.require_fork_parent !== true &&
    sessionDefinition.boundary.fork_supported === false &&
    sessionDefinition.boundary.resume_supported === false
  const traceProjectionRoot =
    manifest.verifier_policy.require_projection_roots?.includes(
      OPENINFERENCE_SPAN_TREE_PROJECTION,
    ) === true &&
    manifest.projections?.some(
      (projection) => projection.name === OPENINFERENCE_SPAN_TREE_PROJECTION,
    ) === true

  if (!manifest.verifier_policy.trusted_sources?.includes(manifest.source.id)) {
    issues.push({
      code: 'projection_manifest_invalid',
      message: 'OpenInference projection manifest must trust its own projection source id.',
    })
  }
  if (!traceProjectionLabel) {
    issues.push({
      code: 'projection_not_labeled_projection',
      message: 'OpenInference adapter must be labeled as a trace projection source.',
    })
  }
  if (!traceProjectionOnly) {
    issues.push({
      code: 'projection_claims_runtime_identity',
      message: 'OpenInference trace projection must not claim runtime-log identity.',
    })
  }
  if (!noForkOrResume) {
    issues.push({
      code: 'projection_claims_fork_or_resume',
      message: 'OpenInference trace projection must not claim fork or resume ownership.',
    })
  }
  if (!traceProjectionRoot) {
    issues.push({
      code: 'projection_missing_span_tree_projection',
      message:
        'OpenInference trace projection must require and carry its span-tree projection root.',
    })
  }

  return {
    valid: issues.length === 0,
    checks: {
      trace_projection_label: traceProjectionLabel,
      trace_projection_only: traceProjectionOnly,
      trace_projection_no_fork_or_resume: noForkOrResume,
      trace_projection_root: traceProjectionRoot,
    },
    issues,
  }
}

export function langGraphCheckpointEventsToRefs(
  rows: readonly LangGraphCheckpointEvent[],
): RuntimeLogEventRef[] {
  const hashesByCheckpoint = new Map<string, Sha256Uri>()
  for (const row of rows) {
    hashesByCheckpoint.set(
      row.checkpoint_id,
      hashRuntimeLogEvent(langGraphCheckpointEventBody(row)),
    )
  }

  return rows.map((row) => {
    const parentEventHashes = (row.parent_checkpoint_ids ?? [])
      .map((checkpointId) => hashesByCheckpoint.get(checkpointId))
      .filter((value): value is Sha256Uri => value !== undefined)
    return {
      event_id: row.event_id,
      position: row.position,
      event_hash: hashesByCheckpoint.get(row.checkpoint_id)!,
      kind: row.kind,
      timestamp: row.timestamp,
      ...(parentEventHashes.length > 0 ? { parent_event_hashes: parentEventHashes } : {}),
    }
  })
}

export function openInferenceSpansToEventRefs(
  spans: readonly OpenInferenceTraceProjectionSpan[],
): RuntimeLogEventRef[] {
  const hashesBySpan = new Map<string, Sha256Uri>()
  for (const span of spans) {
    hashesBySpan.set(span.span_id, hashRuntimeLogEvent(openInferenceSpanEventBody(span)))
  }

  return spans.map((span) => {
    const parentHash = span.parent_span_id ? hashesBySpan.get(span.parent_span_id) : undefined
    return {
      event_id: span.span_id,
      position: span.position,
      event_hash: hashesBySpan.get(span.span_id)!,
      kind: `openinference.${span.kind.toLowerCase()}`,
      timestamp: span.timestamp,
      ...(parentHash ? { parent_event_hashes: [parentHash] } : {}),
    }
  })
}

export function langGraphCheckpointSessionDefinition(
  fixture: LangGraphCheckpointFixture,
  sessionId: string,
): LangGraphCheckpointSessionDefinition {
  return {
    schema: LANGGRAPH_CHECKPOINT_SESSION_SCHEMA,
    id: sessionId,
    source: fixture.source,
    runtime: fixture.runtime,
    storage: {
      kind: 'checkpoint-log',
      saver: fixture.thread.saver,
      raw_checkpoint_bodies: 'local-only',
      manifest_material: 'event-hashes-and-checkpoint-refs',
    },
    boundary: {
      runtime_log_identity: true,
      projection_only: false,
      resume_supported: true,
      fork_supported: true,
      raw_bodies: 'local-only',
    },
  }
}

export function openInferenceTraceProjectionSessionDefinition(
  fixture: OpenInferenceTraceProjectionFixture,
): OpenInferenceTraceProjectionSessionDefinition {
  return {
    schema: OPENINFERENCE_TRACE_PROJECTION_SESSION_SCHEMA,
    id: fixture.trace.id,
    source: fixture.source,
    runtime: fixture.runtime,
    trace: fixture.trace,
    boundary: {
      runtime_log_identity: false,
      projection_only: true,
      resume_supported: false,
      fork_supported: false,
      raw_bodies: 'not-owned',
      parent_runtime_required_for_replay: true,
    },
  }
}

function createLangGraphCheckpointKindProjection(
  request: LogWindowRequest,
  rows: readonly LangGraphCheckpointEvent[],
): RuntimeLogProjectionRef {
  return {
    name: LANGGRAPH_CHECKPOINT_KIND_PROJECTION,
    format: LANGGRAPH_CHECKPOINT_KIND_PROJECTION_SCHEMA,
    event_count: rows.length,
    root_hash: hashCanonical(
      {
        schema: LANGGRAPH_CHECKPOINT_KIND_PROJECTION_SCHEMA,
        session_id: request.session_id,
        checkpoints: rows.map((row) => ({
          position: row.position,
          checkpoint_id: row.checkpoint_id,
          kind: row.kind,
          resume_from_checkpoint_id: row.resume_from_checkpoint_id ?? null,
          forked_from_checkpoint_id: row.forked_from_checkpoint_id ?? null,
        })),
      },
      'LangGraph checkpoint kind projection',
    ),
  }
}

function createOpenInferenceSpanTreeProjection(
  traceId: string,
  spans: readonly OpenInferenceTraceProjectionSpan[],
): RuntimeLogProjectionRef {
  return {
    name: OPENINFERENCE_SPAN_TREE_PROJECTION,
    format: OPENINFERENCE_SPAN_TREE_PROJECTION_SCHEMA,
    event_count: spans.length,
    root_hash: hashCanonical(
      {
        schema: OPENINFERENCE_SPAN_TREE_PROJECTION_SCHEMA,
        trace_id: traceId,
        nodes: spans.map((span) => ({
          span_id: span.span_id,
          name: span.name,
          kind: span.kind,
          signed_record_hash: span.signed_record_hash ?? null,
        })),
        edges: spans
          .filter((span) => span.parent_span_id !== undefined)
          .map((span) => ({
            parent_span_id: span.parent_span_id,
            child_span_id: span.span_id,
          })),
      },
      'OpenInference span tree projection',
    ),
  }
}

function langGraphCheckpointEventBody(row: LangGraphCheckpointEvent): Record<string, unknown> {
  return {
    schema: 'https://atrib.dev/schemas/runtime-log/langgraph-checkpoint-event/v0',
    session_id: row.session_id,
    checkpoint_id: row.checkpoint_id,
    position: row.position,
    kind: row.kind,
    checkpoint_ref: row.checkpoint_ref,
    state_digest: row.state_digest,
    parent_checkpoint_ids: row.parent_checkpoint_ids ?? [],
    resume_from_checkpoint_id: row.resume_from_checkpoint_id ?? null,
    forked_from_checkpoint_id: row.forked_from_checkpoint_id ?? null,
    metadata: row.metadata ?? {},
  }
}

function openInferenceSpanEventBody(
  span: OpenInferenceTraceProjectionSpan,
): Record<string, unknown> {
  return {
    schema: 'https://atrib.dev/schemas/runtime-log/openinference-span-event/v0',
    trace_id: span.trace_id,
    span_id: span.span_id,
    parent_span_id: span.parent_span_id ?? null,
    position: span.position,
    name: span.name,
    kind: span.kind,
    span_digest: span.span_digest,
    signed_record_hash: span.signed_record_hash ?? null,
    attributes: span.attributes ?? {},
  }
}

function validateLangGraphCheckpointFixture(
  value: unknown,
): asserts value is LangGraphCheckpointFixture {
  if (!value || typeof value !== 'object') {
    throw new Error('LangGraph checkpoint fixture must be an object')
  }
  const fixture = value as Partial<LangGraphCheckpointFixture>
  if (fixture.schema !== LANGGRAPH_CHECKPOINT_FIXTURE_SCHEMA) {
    throw new Error('unsupported LangGraph checkpoint fixture schema')
  }
  if (!fixture.source || fixture.source.kind !== 'langgraph-checkpoint-log') {
    throw new Error('LangGraph checkpoint fixture source must be langgraph-checkpoint-log')
  }
  if (!fixture.thread || typeof fixture.thread.main_session_id !== 'string') {
    throw new Error('LangGraph checkpoint fixture thread is missing')
  }
  if (!Array.isArray(fixture.checkpoints) || fixture.checkpoints.length === 0) {
    throw new Error('LangGraph checkpoint fixture must contain checkpoints')
  }
}

function validateOpenInferenceTraceProjectionFixture(
  value: unknown,
): asserts value is OpenInferenceTraceProjectionFixture {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenInference trace projection fixture must be an object')
  }
  const fixture = value as Partial<OpenInferenceTraceProjectionFixture>
  if (fixture.schema !== OPENINFERENCE_TRACE_PROJECTION_FIXTURE_SCHEMA) {
    throw new Error('unsupported OpenInference trace projection fixture schema')
  }
  if (!fixture.source || fixture.source.kind !== 'openinference-trace-projection') {
    throw new Error('OpenInference fixture source must be openinference-trace-projection')
  }
  if (!fixture.trace || fixture.trace.runtime_identity !== 'not-owned') {
    throw new Error(
      'OpenInference trace projection fixture must mark runtime identity as not-owned',
    )
  }
  if (!Array.isArray(fixture.spans) || fixture.spans.length === 0) {
    throw new Error('OpenInference trace projection fixture must contain spans')
  }
}

function firstPosition(rows: readonly LangGraphCheckpointEvent[], sessionId: string): number {
  return Math.min(...rows.filter((row) => row.session_id === sessionId).map((row) => row.position))
}

function lastPosition(rows: readonly LangGraphCheckpointEvent[], sessionId: string): number {
  return Math.max(...rows.filter((row) => row.session_id === sessionId).map((row) => row.position))
}

function firstSpanPosition(rows: readonly OpenInferenceTraceProjectionSpan[]): number {
  return Math.min(...rows.map((row) => row.position))
}

function lastSpanPosition(rows: readonly OpenInferenceTraceProjectionSpan[]): number {
  return Math.max(...rows.map((row) => row.position))
}

export function fixtureFileUri(path: string): string {
  return pathToFileURL(path).href
}
