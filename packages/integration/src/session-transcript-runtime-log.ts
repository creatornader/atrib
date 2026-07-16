// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  EVENT_TYPE_TOOL_CALL_URI,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  getPublicKey,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import {
  createLogWindowManifest,
  hashCanonical,
  hashLogWindow,
  hashLogWindowManifest,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  verifyLogWindowManifest,
} from '@atrib/runtime-log'
import type {
  LogWindowManifest,
  LogWindowRequest,
  ManifestVerificationResult,
  RuntimeLogEventRef,
  RuntimeLogProjectionRef,
  RuntimeLogRuntimeRef,
  RuntimeLogSideEffectReceiptRef,
  RuntimeLogSource,
  RuntimeLogSourceRef,
  SessionDefinitionRef,
  Sha256Uri,
} from '@atrib/runtime-log'

export const SESSION_TRANSCRIPT_SESSION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/session-transcript-session/v0' as const
export const SESSION_TRANSCRIPT_PROJECTION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/session-transcript-tool-use-projection/v0' as const
export const SESSION_TRANSCRIPT_RECEIPT_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/session-transcript-receipt/v0' as const
export const SESSION_TRANSCRIPT_TOOL_USE_PROJECTION = 'session-transcript.tool_use' as const
export const SESSION_TRANSCRIPT_RECEIPT_PROTOCOL = 'session-transcript.atrib-record' as const

export type SessionTranscriptJsonlFormat =
  | 'claude-code-session-jsonl/v1'
  | 'codex-rollout-jsonl/v1'

export interface SessionTranscriptRow {
  readonly line: number
  readonly value: Record<string, unknown>
  readonly event_id: string
  readonly session_id?: string
  readonly type: string
  readonly timestamp?: string
  readonly parent_uuid?: string
  readonly is_sidechain?: boolean
  readonly event_hash: Sha256Uri
}

export interface SessionTranscriptSessionDefinition {
  readonly schema: typeof SESSION_TRANSCRIPT_SESSION_SCHEMA
  readonly id: string
  readonly source: {
    readonly id: string
    readonly kind: 'session-transcript-jsonl'
    readonly version: string
  }
  readonly runtime: RuntimeLogRuntimeRef
  readonly format: SessionTranscriptJsonlFormat
  readonly storage: {
    readonly kind: 'append-only-jsonl'
    readonly raw_bodies: 'local-only'
    readonly manifest_material: 'hashes-and-refs'
  }
}

export interface SessionTranscriptReceiptBody {
  readonly schema: typeof SESSION_TRANSCRIPT_RECEIPT_SCHEMA
  readonly tool_use_id: string
  readonly transcript_event_hash: Sha256Uri
  readonly record_hash: Sha256Uri
}

export interface SessionTranscriptSignedRecord {
  readonly record: AtribRecord
  readonly record_hash: Sha256Uri
  readonly signature_verified: boolean
}

export interface SessionTranscriptWindowBundle {
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly side_effect_receipts: readonly RuntimeLogSideEffectReceiptRef[]
  readonly session_definition: SessionTranscriptSessionDefinition
  readonly verification: ManifestVerificationResult
}

export interface SessionTranscriptRuntimeLogJsonlSourceOptions {
  readonly path: string
  readonly session_id?: string
  readonly source_version?: string
  readonly runtime?: RuntimeLogRuntimeRef
  readonly format?: SessionTranscriptJsonlFormat
}

export interface ManifestSessionTranscriptFileOptions {
  readonly format?: SessionTranscriptJsonlFormat
}

export interface SessionTranscriptFixture {
  readonly session_id: string
  readonly main_window: LogWindowRequest
  readonly fork_window: LogWindowRequest
  readonly continuation_window: LogWindowRequest
  readonly fork_event_hash: Sha256Uri
  readonly compaction_summary_hash: Sha256Uri
}

export interface SessionTranscriptRuntimeLogProof {
  readonly ok: boolean
  readonly strategy: 'session-transcript-runtime-log-v0'
  readonly paths: {
    readonly main: string
    readonly subagent: string
  }
  readonly fixture: SessionTranscriptFixture
  readonly main: SessionTranscriptWindowBundle
  readonly fork: SessionTranscriptWindowBundle
  readonly continuation: SessionTranscriptWindowBundle
  readonly manifest_hashes: {
    readonly main: Sha256Uri
    readonly fork: Sha256Uri
    readonly continuation: Sha256Uri
  }
  readonly signed_records: readonly SessionTranscriptSignedRecord[]
  readonly privacy: {
    readonly raw_bodies_in_jsonl: true
    readonly manifests_are_hash_only: true
    readonly public_log_not_required: true
  }
}

interface SessionTranscriptLineProfile {
  readonly format: SessionTranscriptJsonlFormat
  row(
    value: Record<string, unknown>,
    line: number,
    sessionId: string | undefined,
  ): SessionTranscriptRow
  sessionId(lines: readonly { readonly line: number; readonly value: Record<string, unknown> }[]): string | undefined
  runtime(rows: readonly SessionTranscriptRow[]): RuntimeLogRuntimeRef
}

const CLAUDE_CODE_SESSION_JSONL_PROFILE: SessionTranscriptLineProfile = {
  format: 'claude-code-session-jsonl/v1',
  row(value, line) {
    const uuid = readOptionalString(value, 'uuid')
    const sessionId = readOptionalString(value, 'sessionId')
    const timestamp = readOptionalString(value, 'timestamp')
    const parentUuid = readOptionalString(value, 'parentUuid')
    return {
      line,
      value,
      event_id: uuid ?? `line-${line}`,
      ...(sessionId ? { session_id: sessionId } : {}),
      type: readOptionalString(value, 'type') ?? 'unknown',
      ...(timestamp ? { timestamp } : {}),
      ...(parentUuid ? { parent_uuid: parentUuid } : {}),
      ...(typeof value.isSidechain === 'boolean' ? { is_sidechain: value.isSidechain } : {}),
      event_hash: hashRuntimeLogEvent(value),
    }
  },
  sessionId() {
    return undefined
  },
  runtime() {
    return { name: 'Claude Code', version: 'unknown' }
  },
}

const CODEX_ROLLOUT_JSONL_PROFILE: SessionTranscriptLineProfile = {
  format: 'codex-rollout-jsonl/v1',
  row(value, line, sessionId) {
    const payload = isRecord(value.payload) ? value.payload : undefined
    const type = readOptionalString(value, 'type') ?? 'unknown'
    const payloadType = payload ? readOptionalString(payload, 'type') : undefined
    const eventId = payload ? readNonEmptyString(payload, 'id') : undefined
    const timestamp = readOptionalString(value, 'timestamp')
    return {
      line,
      value,
      event_id: eventId ?? `line-${line}`,
      ...(sessionId ? { session_id: sessionId } : {}),
      type: payloadType ? `${type}.${payloadType}` : type,
      ...(timestamp ? { timestamp } : {}),
      event_hash: hashRuntimeLogEvent(value),
    }
  },
  sessionId(lines) {
    const metadata = lines.find(({ value }) => (
      value.type === 'session_meta' && isRecord(value.payload)
    ))?.value.payload
    if (!isRecord(metadata)) return undefined
    return readOptionalString(metadata, 'session_id') ?? readOptionalString(metadata, 'id')
  },
  runtime(rows) {
    const metadata = rows.find(({ value }) => (
      value.type === 'session_meta' && isRecord(value.payload)
    ))?.value.payload
    return {
      name: 'Codex',
      version: isRecord(metadata) ? readOptionalString(metadata, 'cli_version') ?? 'unknown' : 'unknown',
    }
  },
}

function lineProfileForFormat(
  format: SessionTranscriptJsonlFormat | undefined,
): SessionTranscriptLineProfile {
  return format === 'codex-rollout-jsonl/v1'
    ? CODEX_ROLLOUT_JSONL_PROFILE
    : CLAUDE_CODE_SESSION_JSONL_PROFILE
}

export class SessionTranscriptRuntimeLogJsonlSource implements RuntimeLogSource {
  readonly path: string
  readonly source: RuntimeLogSourceRef

  private readonly sessionId: string | undefined
  private readonly sourceVersion: string
  private readonly runtimeOverride: RuntimeLogRuntimeRef | undefined
  private readonly profile: SessionTranscriptLineProfile

  constructor(options: SessionTranscriptRuntimeLogJsonlSourceOptions) {
    this.path = options.path
    this.sessionId = options.session_id
    this.sourceVersion = options.source_version ?? 'v1'
    this.runtimeOverride = options.runtime
    this.profile = lineProfileForFormat(options.format)
    this.source = {
      id: 'session-transcript-jsonl',
      kind: 'session-transcript-jsonl',
      version: this.sourceVersion,
      uri: transcriptUri(this.sessionId ?? 'unknown-session'),
    }
  }

  async exportWindow(request: LogWindowRequest): Promise<SessionTranscriptWindowBundle> {
    const rows = await this.readWindowRows(request)
    return this.buildWindowBundle(request, rows)
  }

  async readRows(): Promise<readonly SessionTranscriptRow[]> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return []
      throw error
    }

    const parsedLines: Array<{ line: number; value: Record<string, unknown> }> = []
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) continue
      const value = parseTranscriptLine(line, `${this.path}:${index + 1}`)
      parsedLines.push({ line: index + 1, value })
    }
    const sessionId = this.profile.sessionId(parsedLines)
    return parsedLines.map(({ line, value }) => this.profile.row(value, line, sessionId))
  }

  private async readWindowRows(
    request: LogWindowRequest,
  ): Promise<readonly SessionTranscriptRow[]> {
    const rows = (await this.readRows()).filter(
      (row) => row.line >= Number(request.start) && row.line <= Number(request.end),
    )
    if (rows.length === 0) {
      throw new Error(`session transcript window has no events: ${request.start}..${request.end}`)
    }
    if (this.sessionId && request.session_id !== this.sessionId) {
      throw new Error(`expected session ${this.sessionId}, got ${request.session_id}`)
    }
    if (rows[0]!.line !== request.start || rows[rows.length - 1]!.line !== request.end) {
      throw new Error(`session transcript window must start and end on JSONL lines`)
    }
    return rows
  }

  private buildWindowBundle(
    request: LogWindowRequest,
    rows: readonly SessionTranscriptRow[],
    input: {
      readonly receipts?: readonly RuntimeLogSideEffectReceiptRef[]
      readonly fork?: LogWindowManifest
      readonly fork_event_hash?: Sha256Uri
      readonly fork_reason?: string
      readonly compaction?: LogWindowManifest
      readonly compacted_events?: readonly RuntimeLogEventRef[]
      readonly summary_hash?: Sha256Uri
      readonly include_projection?: boolean
    } = {},
  ): SessionTranscriptWindowBundle {
    const events = transcriptRowsToEventRefs(rows)
    const projections = input.include_projection === false ? [] : [toolUseProjection(events, rows)]
    const runtime = this.runtimeForRows(rows)
    const sessionDefinition = this.createSessionDefinition(request.session_id, runtime)
    const session: SessionDefinitionRef = {
      id: request.session_id,
      digest: hashSessionDefinition(sessionDefinition),
      format: this.profile.format,
    }
    const receipts = input.receipts ?? []
    const fork = input.fork
      ? {
          parent_window_manifest_hash: hashLogWindowManifest(input.fork),
          ...(input.fork_event_hash ? { fork_event_hash: input.fork_event_hash } : {}),
          ...(input.fork_reason ? { reason: input.fork_reason } : {}),
        }
      : undefined
    const compaction = input.compaction
      ? {
          source_window_manifest_hash: hashLogWindowManifest(input.compaction),
          compacted_event_root: hashLogWindow(input.compacted_events ?? []),
          ...(input.summary_hash ? { summary_hash: input.summary_hash } : {}),
        }
      : undefined
    const manifest = createLogWindowManifest({
      source: {
        ...this.source,
        uri: transcriptUri(request.session_id),
      },
      runtime,
      session,
      window: { start: request.start, end: request.end },
      events,
      ...(projections.length > 0 ? { projections } : {}),
      ...(fork ? { fork } : {}),
      ...(compaction ? { compaction } : {}),
      ...(receipts.length > 0 ? { side_effect_receipts: receipts } : {}),
      redaction: { mode: 'hash-only', fields: ['message', 'body'] },
      privacy_posture: 'host-owned',
      verifier_policy: {
        require_event_root: true,
        require_session_definition: true,
        ...(projections.length > 0
          ? { require_projection_roots: [SESSION_TRANSCRIPT_TOOL_USE_PROJECTION] }
          : {}),
        ...(receipts.length > 0
          ? { require_receipt_protocols: [SESSION_TRANSCRIPT_RECEIPT_PROTOCOL] }
          : {}),
        ...(fork ? { require_fork_parent: true } : {}),
        ...(compaction ? { require_compaction_source: true } : {}),
      },
    })
    const verification = verifyLogWindowManifest(manifest, {
      session_definition: sessionDefinition,
      events,
      ...(projections.length > 0 ? { projections } : {}),
      ...(receipts.length > 0 ? { side_effect_receipts: receipts } : {}),
      ...(input.fork ? { fork_parent_manifest: input.fork } : {}),
      ...(input.compaction
        ? {
            compaction_source_manifest: input.compaction,
            compaction_events: input.compacted_events,
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

  createSessionDefinition(
    sessionId: string,
    runtime = this.runtimeForRows([]),
  ): SessionTranscriptSessionDefinition {
    return {
      schema: SESSION_TRANSCRIPT_SESSION_SCHEMA,
      id: sessionId,
      source: {
        id: 'session-transcript-jsonl',
        kind: 'session-transcript-jsonl',
        version: this.sourceVersion,
      },
      runtime,
      format: this.profile.format,
      storage: {
        kind: 'append-only-jsonl',
        raw_bodies: 'local-only',
        manifest_material: 'hashes-and-refs',
      },
    }
  }

  buildBoundWindow(
    request: LogWindowRequest,
    rows: readonly SessionTranscriptRow[],
    input: Parameters<SessionTranscriptRuntimeLogJsonlSource['buildWindowBundle']>[2],
  ): SessionTranscriptWindowBundle {
    return this.buildWindowBundle(request, rows, input)
  }

  private runtimeForRows(rows: readonly SessionTranscriptRow[]): RuntimeLogRuntimeRef {
    return this.runtimeOverride ?? this.profile.runtime(rows)
  }
}

export async function writeSessionTranscriptFixture(dir: string): Promise<{
  readonly paths: SessionTranscriptRuntimeLogProof['paths']
  readonly fixture: SessionTranscriptFixture
}> {
  const sessionId = '4cf5c952-1af2-41ad-a75e-1fd3fe3055e1'
  const main = join(dir, `${sessionId}.jsonl`)
  const subagent = join(dir, 'subagents', 'agent-001.jsonl')
  const mainRows: readonly Record<string, unknown>[] = [
    transcriptEvent('a1000000-0000-4000-8000-000000000001', null, 'user', sessionId, '2026-06-30T12:00:00.000Z', {
      content: 'Find the current account owner and prepare a short reply.',
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'assistant', sessionId, '2026-06-30T12:00:01.000Z', {
      content: [{ type: 'tool_use', id: 'toolu-search-001', name: 'search_accounts', input: { query: 'account owner' } }],
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', 'user', sessionId, '2026-06-30T12:00:02.000Z', {
      content: [{ type: 'tool_result', tool_use_id: 'toolu-search-001', content: 'Owner: Ada Lovelace' }],
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', 'assistant', sessionId, '2026-06-30T12:00:03.000Z', {
      content: 'I found the account owner. I will check the preferred reply style.',
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000004', 'assistant', sessionId, '2026-06-30T12:00:04.000Z', {
      content: [{ type: 'tool_use', id: 'toolu-style-002', name: 'read_preferences', input: { account: 'Ada Lovelace' } }],
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000005', 'user', sessionId, '2026-06-30T12:00:05.000Z', {
      content: [{ type: 'tool_result', tool_use_id: 'toolu-style-002', content: 'Tone: concise' }],
    }),
    {
      ...transcriptEvent('a1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000006', 'summary', sessionId, '2026-06-30T12:00:06.000Z', {
        summary: 'Owner is Ada Lovelace. Preferred tone is concise.',
      }),
      isCompactSummary: true,
    },
    transcriptEvent('a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000007', 'user', sessionId, '2026-06-30T12:00:07.000Z', {
      content: 'Send the concise reply now.',
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000008', 'assistant', sessionId, '2026-06-30T12:00:08.000Z', {
      content: 'Draft: Hello Ada, your account update is ready.',
    }),
    transcriptEvent('a1000000-0000-4000-8000-000000000010', 'a1000000-0000-4000-8000-000000000009', 'assistant', sessionId, '2026-06-30T12:00:09.000Z', {
      content: 'The concise reply is ready for delivery.',
    }),
  ]
  const subagentRows: readonly Record<string, unknown>[] = [
    {
      ...transcriptEvent('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'assistant', sessionId, '2026-06-30T12:00:01.500Z', {
        content: 'I am checking account ownership independently.',
      }),
      isSidechain: true,
    },
    {
      ...transcriptEvent('b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'assistant', sessionId, '2026-06-30T12:00:02.500Z', {
        content: 'The owner is Ada Lovelace.',
      }),
      isSidechain: true,
    },
  ]

  await mkdir(dirname(main), { recursive: true })
  await mkdir(dirname(subagent), { recursive: true })
  await writeFile(main, `${mainRows.map((row) => JSON.stringify(row)).join('\n')}\n`)
  await writeFile(subagent, `${subagentRows.map((row) => JSON.stringify(row)).join('\n')}\n`)

  const mainEventRefs = transcriptRowsToEventRefs(await readSessionTranscriptRows(main))
  return {
    paths: { main, subagent },
    fixture: {
      session_id: sessionId,
      main_window: { session_id: sessionId, start: 1, end: 6 },
      fork_window: { session_id: sessionId, start: 1, end: 2 },
      continuation_window: { session_id: sessionId, start: 8, end: 10 },
      fork_event_hash: mainEventRefs[1]!.event_hash,
      compaction_summary_hash: mainEventRefs[6]!.event_hash,
    },
  }
}

export async function writeCodexRolloutFixture(dir: string): Promise<{
  readonly path: string
  readonly session_id: string
  readonly window: LogWindowRequest
}> {
  const sessionId = '019f6d3f-4f3a-7d72-8c3a-2cfc4f144001'
  const path = join(dir, 'rollout-2026-07-15T12-00-00-codex-fixture.jsonl')
  const rows: readonly Record<string, unknown>[] = [
    {
      timestamp: '2026-07-15T12:00:00.000Z',
      type: 'session_meta',
      payload: {
        id: 'meta-001',
        session_id: sessionId,
        cli_version: '0.94.0',
        cwd: '/workspaces/atrib',
        git: { branch: 'main' },
        model_provider: 'openai',
      },
    },
    {
      timestamp: '2026-07-15T12:00:01.000Z',
      type: 'response_item',
      payload: { id: 'item-user-001', type: 'message', role: 'user', content: 'Inspect the session.' },
    },
    {
      timestamp: '2026-07-15T12:00:02.000Z',
      type: 'response_item',
      payload: { id: 'item-reasoning-001', type: 'reasoning', summary: [] },
    },
    {
      timestamp: '2026-07-15T12:00:03.000Z',
      type: 'response_item',
      payload: { id: 'item-call-001', type: 'function_call', name: 'read_file', arguments: '{"path":"README.md"}' },
    },
    {
      timestamp: '2026-07-15T12:00:04.000Z',
      type: 'response_item',
      payload: { id: 'item-output-001', type: 'function_call_output', call_id: 'item-call-001', output: 'ok' },
    },
    {
      timestamp: '2026-07-15T12:00:05.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', total_token_usage: { input_tokens: 123, output_tokens: 45 } },
    },
    {
      timestamp: '2026-07-15T12:00:06.000Z',
      type: 'turn_context',
      payload: { cwd: '/workspaces/atrib', turn_id: 'turn-001' },
    },
    {
      timestamp: '2026-07-15T12:00:07.000Z',
      type: 'inter_agent_communication_metadata',
      payload: { thread_id: 'thread-001' },
    },
    {
      timestamp: '2026-07-15T12:00:08.000Z',
      type: 'response_item',
      payload: { id: 'item-agent-001', type: 'agent_message', role: 'assistant', content: 'The session is ready.' },
    },
  ]

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
  return {
    path,
    session_id: sessionId,
    window: { session_id: sessionId, start: 1, end: rows.length },
  }
}

export async function buildSessionTranscriptProof(
  dir: string,
): Promise<SessionTranscriptRuntimeLogProof> {
  const written = await writeSessionTranscriptFixture(dir)
  const runtime = { name: 'Claude Code', version: 'fixture-v1' } as const
  const mainSource = new SessionTranscriptRuntimeLogJsonlSource({
    path: written.paths.main,
    session_id: written.fixture.session_id,
    runtime,
  })
  const mainRows = await mainSource.readRows()
  const mainWindowRows = mainRows.slice(0, 6)
  const mainEvents = transcriptRowsToEventRefs(mainWindowRows)
  const signedRecords = await signToolUseRecords(mainWindowRows, written.fixture.session_id)
  const receipts = signedRecords.map(({ record_hash, record }, index) => {
    const transcript = mainWindowRows.filter(hasToolUse)[index]!
    const body: SessionTranscriptReceiptBody = {
      schema: SESSION_TRANSCRIPT_RECEIPT_SCHEMA,
      tool_use_id: toolUseId(transcript) ?? transcript.event_id,
      transcript_event_hash: transcript.event_hash,
      record_hash,
    }
    return {
      protocol: SESSION_TRANSCRIPT_RECEIPT_PROTOCOL,
      receipt_hash: hashCanonical(body),
      record_hash,
      uri: `https://archive.atrib.dev/v1/record/${record_hash}`,
      record,
    }
  })
  const main = mainSource.buildBoundWindow(written.fixture.main_window, mainWindowRows, {
    receipts: receipts.map(({ record: _, ...receipt }) => receipt),
  })
  const subagentSource = new SessionTranscriptRuntimeLogJsonlSource({
    path: written.paths.subagent,
    session_id: written.fixture.session_id,
    runtime,
  })
  const fork = subagentSource.buildBoundWindow(
    written.fixture.fork_window,
    await subagentSource.readRows(),
    {
      fork: main.manifest,
      fork_event_hash: written.fixture.fork_event_hash,
      fork_reason: 'subagent-transcript',
      include_projection: false,
    },
  )
  const continuation = mainSource.buildBoundWindow(
    written.fixture.continuation_window,
    mainRows.slice(7),
    {
      compaction: main.manifest,
      compacted_events: mainEvents,
      summary_hash: written.fixture.compaction_summary_hash,
      include_projection: false,
    },
  )
  const signed_records = await Promise.all(
    signedRecords.map(async ({ record, record_hash }) => ({
      record,
      record_hash,
      signature_verified: await verifyRecord(record),
    })),
  )
  return {
    ok:
      main.verification.valid &&
      fork.verification.valid &&
      continuation.verification.valid &&
      signed_records.every((record) => record.signature_verified),
    strategy: 'session-transcript-runtime-log-v0',
    paths: written.paths,
    fixture: written.fixture,
    main,
    fork,
    continuation,
    manifest_hashes: {
      main: hashLogWindowManifest(main.manifest),
      fork: hashLogWindowManifest(fork.manifest),
      continuation: hashLogWindowManifest(continuation.manifest),
    },
    signed_records,
    privacy: {
      raw_bodies_in_jsonl: true,
      manifests_are_hash_only: true,
      public_log_not_required: true,
    },
  }
}

export async function manifestSessionTranscriptFile(
  path: string,
  options: ManifestSessionTranscriptFileOptions = {},
): Promise<SessionTranscriptWindowBundle> {
  const format = options.format ?? await detectSessionTranscriptFormat(path)
  const source = new SessionTranscriptRuntimeLogJsonlSource({ path, format })
  const rows = await source.readRows()
  if (rows.length === 0) {
    throw new Error(`session transcript is missing or has no JSONL events: ${path}`)
  }
  const sessionId = rows.find((row) => row.session_id)?.session_id ?? basename(path)
  return source.exportWindow({ session_id: sessionId, start: rows[0]!.line, end: rows[rows.length - 1]!.line })
}

export async function readSessionTranscriptRows(
  path: string,
): Promise<readonly SessionTranscriptRow[]> {
  return new SessionTranscriptRuntimeLogJsonlSource({ path }).readRows()
}

export function transcriptRowsToEventRefs(
  rows: readonly SessionTranscriptRow[],
): readonly RuntimeLogEventRef[] {
  const hashesByUuid = new Map<string, Sha256Uri>()
  for (const row of rows) {
    const uuid = readOptionalString(row.value, 'uuid')
    if (uuid) hashesByUuid.set(uuid, row.event_hash)
  }
  return rows.map((row) => ({
    event_id: row.event_id,
    position: row.line,
    event_hash: row.event_hash,
    kind: row.type,
    ...(row.timestamp ? { timestamp: row.timestamp } : {}),
    ...(row.parent_uuid && hashesByUuid.get(row.parent_uuid)
      ? { parent_event_hashes: [hashesByUuid.get(row.parent_uuid)!] }
      : {}),
  }))
}

async function detectSessionTranscriptFormat(path: string): Promise<SessionTranscriptJsonlFormat> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return 'claude-code-session-jsonl/v1'
    throw error
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    try {
      const value = JSON.parse(line) as unknown
      if (isRecord(value) && value.type === 'session_meta' && isRecord(value.payload)) {
        return 'codex-rollout-jsonl/v1'
      }
      return 'claude-code-session-jsonl/v1'
    } catch {
      continue
    }
  }
  return 'claude-code-session-jsonl/v1'
}

function toolUseProjection(
  events: readonly RuntimeLogEventRef[],
  rows: readonly SessionTranscriptRow[],
): RuntimeLogProjectionRef {
  const refs = events.filter((_, index) => hasToolUse(rows[index]!))
  return {
    name: SESSION_TRANSCRIPT_TOOL_USE_PROJECTION,
    format: SESSION_TRANSCRIPT_PROJECTION_SCHEMA,
    root_hash: hashLogWindow(refs),
    event_count: refs.length,
  }
}

// Fixed fixture seed: the proof key is synthetic and offline-only, and a
// deterministic key keeps every record, receipt, and manifest hash byte-stable
// across rebuilds so fork and compaction windows can bind the one real main
// manifest. Never reuse this seed outside fixture code.
const FIXTURE_SIGNING_SEED = Uint8Array.from({ length: 32 }, (_, index) => index + 1)

async function signToolUseRecords(
  rows: readonly SessionTranscriptRow[],
  sessionId: string,
): Promise<readonly { record: AtribRecord; record_hash: Sha256Uri }[]> {
  const privateKey = FIXTURE_SIGNING_SEED
  const creatorKeyBase64url = base64urlEncode(await getPublicKey(privateKey))
  const contextId = sessionId.replaceAll('-', '')
  let chainTail: string | undefined
  const signed: { record: AtribRecord; record_hash: Sha256Uri }[] = []
  for (const row of rows.filter(hasToolUse)) {
    const record = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: computeContentId('session-transcript://claude-code', 'tool_use'),
        creator_key: creatorKeyBase64url,
        chain_root: resolveChainRoot({ contextId, autoChainTailHex: chainTail, env: {} }),
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        context_id: contextId,
        timestamp: 1782811200000,
        signature: '',
        args_hash: hashCanonical({ tool_use_id: toolUseId(row), transcript_event_hash: row.event_hash }),
        result_hash: hashCanonical({ transcript_event_hash: row.event_hash }),
        tool_name: 'session-transcript.tool_use',
      },
      privateKey,
    )
    const record_hash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}` as Sha256Uri
    chainTail = record_hash.slice('sha256:'.length)
    signed.push({ record, record_hash })
  }
  return signed
}

function transcriptEvent(
  uuid: string,
  parentUuid: string | null,
  type: string,
  sessionId: string,
  timestamp: string,
  message: Record<string, unknown>,
): Record<string, unknown> {
  return { uuid, parentUuid, type, timestamp, sessionId, message }
}

function hasToolUse(row: SessionTranscriptRow): boolean {
  if (row.type !== 'assistant' || !isRecord(row.value.message)) return false
  return Array.isArray(row.value.message.content) && row.value.message.content.some(
    (item) => isRecord(item) && item.type === 'tool_use',
  )
}

function toolUseId(row: SessionTranscriptRow): string | undefined {
  if (!isRecord(row.value.message) || !Array.isArray(row.value.message.content)) return undefined
  const toolUse = row.value.message.content.find(
    (item) => isRecord(item) && item.type === 'tool_use',
  )
  return isRecord(toolUse) ? readOptionalString(toolUse, 'id') : undefined
}

function parseTranscriptLine(line: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${errorMessage(error)}`)
  }
  if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object`)
  return parsed
}

function transcriptUri(sessionId: string): string {
  return `hf://buckets/example/agent-traces/claude_code/${sessionId}.jsonl`
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = readOptionalString(value, key)
  return candidate && candidate.trim().length > 0 ? candidate : undefined
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
