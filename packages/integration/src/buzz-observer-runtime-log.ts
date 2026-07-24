// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import {
  createLogWindowManifest,
  hashCanonical,
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
  RuntimeLogSource,
  RuntimeLogSourceRef,
  Sha256Uri,
} from '@atrib/runtime-log'
import { verifyNostrEvent, type NostrEvent, type NostrEventVerification } from '@atrib/verify'

export const BUZZ_OBSERVER_SESSION_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/buzz-observer-session/v0' as const
export const BUZZ_OBSERVER_EVENT_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/buzz-observer-event/v0' as const
export const BUZZ_OBSERVER_SEQUENCE_AUDIT_SCHEMA =
  'https://atrib.dev/schemas/runtime-log/buzz-observer-sequence-audit/v0' as const
export const BUZZ_OBSERVER_SEQUENCE_PROJECTION = 'buzz.observer-sequence-audit' as const

export type BuzzObserverCaptureKind = 'live-subscription' | 'desktop-local-archive'
export type BuzzObserverSequencePolicy = 'require-contiguous' | 'report-gaps'

export interface BuzzObserverTelemetry {
  readonly seq: number
  readonly timestamp: string
  readonly kind: string
  readonly agentIndex: number | null
  readonly channelId: string | null
  readonly sessionId: string | null
  readonly turnId: string | null
  readonly payload: Record<string, unknown>
}

export interface BuzzObserverFrame {
  readonly capture_line: number
  readonly event: NostrEvent
  readonly event_verification: NostrEventVerification
  readonly owner_pubkey: string
  readonly agent_pubkey: string
  readonly telemetry: BuzzObserverTelemetry
  readonly ciphertext_hash: Sha256Uri
  readonly plaintext_hash: Sha256Uri
  readonly event_hash: Sha256Uri
}

export interface BuzzObserverMissingRange {
  readonly start: number
  readonly end: number
}

export interface BuzzObserverOutOfOrderPair {
  readonly previous: number
  readonly current: number
  readonly capture_line: number
}

export interface BuzzObserverSequenceAudit {
  readonly schema: typeof BUZZ_OBSERVER_SEQUENCE_AUDIT_SCHEMA
  readonly capture_id: string
  readonly sequence_scope: 'process-local'
  readonly requested_window: {
    readonly start: number
    readonly end: number
  }
  readonly captured_event_count: number
  readonly sequence_complete: boolean
  readonly duplicate_seq: readonly number[]
  readonly duplicate_event_ids: readonly string[]
  readonly out_of_order: readonly BuzzObserverOutOfOrderPair[]
  readonly missing_ranges: readonly BuzzObserverMissingRange[]
  readonly basis: 'complete-captured-window' | 'incomplete-captured-window'
}

export interface BuzzObserverSessionDefinition {
  readonly schema: typeof BUZZ_OBSERVER_SESSION_SCHEMA
  readonly id: string
  readonly source: {
    readonly id: 'buzz-observer-frames'
    readonly kind: 'buzz-nip-ao-capture'
    readonly version: string
  }
  readonly runtime: RuntimeLogRuntimeRef
  readonly format: 'buzz-nip-ao-24200/v1'
  readonly owner_pubkey: string
  readonly capture_kind: BuzzObserverCaptureKind
  readonly sequence_scope: 'process-local'
  readonly sequence_policy: BuzzObserverSequencePolicy
  readonly storage: {
    readonly raw_events: 'host-owned'
    readonly decrypted_payloads: 'local-only'
    readonly manifest_material: 'hashes-and-refs'
  }
  readonly claim_boundary: {
    readonly event_signature: 'verifier-checked'
    readonly decrypted_payload: 'host-decrypt-callback'
    readonly telemetry_timestamp: 'sender-declared'
    readonly relay_admission: 'not-claimed'
    readonly runtime_execution: 'observer-telemetry-only'
  }
}

export interface BuzzObserverWindowBundle {
  readonly manifest: LogWindowManifest
  readonly events: readonly RuntimeLogEventRef[]
  readonly projections: readonly RuntimeLogProjectionRef[]
  readonly session_definition: BuzzObserverSessionDefinition
  readonly sequence_audit: BuzzObserverSequenceAudit
  readonly frames: readonly BuzzObserverFrame[]
  readonly verification: ManifestVerificationResult
}

export interface BuzzObserverRuntimeLogSourceOptions {
  readonly path: string
  readonly owner_pubkey: string
  readonly capture_id?: string
  readonly decrypt: (event: NostrEvent) => unknown | Promise<unknown>
  readonly capture_kind?: BuzzObserverCaptureKind
  readonly sequence_policy?: BuzzObserverSequencePolicy
  readonly source_version?: string
  readonly runtime?: RuntimeLogRuntimeRef
}

export class BuzzObserverRuntimeLogSource implements RuntimeLogSource {
  readonly source: RuntimeLogSourceRef

  private readonly path: string
  private readonly ownerPubkey: string
  private readonly captureId: string
  private readonly decrypt: BuzzObserverRuntimeLogSourceOptions['decrypt']
  private readonly captureKind: BuzzObserverCaptureKind
  private readonly sequencePolicy: BuzzObserverSequencePolicy
  private readonly sourceVersion: string
  private readonly runtime: RuntimeLogRuntimeRef

  constructor(options: BuzzObserverRuntimeLogSourceOptions) {
    assertHex32(options.owner_pubkey, 'owner_pubkey')
    this.path = options.path
    this.ownerPubkey = options.owner_pubkey
    this.captureId = options.capture_id ?? 'buzz-observer-process'
    if (this.captureId.length === 0) throw new Error('capture_id must not be empty')
    this.decrypt = options.decrypt
    this.captureKind = options.capture_kind ?? 'live-subscription'
    this.sequencePolicy = options.sequence_policy ?? 'require-contiguous'
    this.sourceVersion = options.source_version ?? 'v1'
    this.runtime = options.runtime ?? {
      name: 'Buzz',
      version: 'unknown',
      environment: 'NIP-AO observer frames',
    }
    this.source = {
      id: 'buzz-observer-frames',
      kind: 'buzz-nip-ao-capture',
      version: this.sourceVersion,
      uri: `buzz-observer://capture/${encodeURIComponent(this.captureId)}`,
    }
  }

  async exportWindow(request: LogWindowRequest): Promise<BuzzObserverWindowBundle> {
    const start = parseSequence(request.start, 'window.start')
    const end = parseSequence(request.end, 'window.end')
    if (end < start) throw new Error('window.end must be greater than or equal to window.start')
    if (request.session_id !== this.captureId) {
      throw new Error(`expected observer capture ${this.captureId}, got ${request.session_id}`)
    }

    const frames = (await this.readFrames()).filter(
      (frame) => frame.telemetry.seq >= start && frame.telemetry.seq <= end,
    )
    if (frames.length === 0) {
      throw new Error(`Buzz observer window has no events: ${this.captureId} ${start}..${end}`)
    }

    const sequenceAudit = auditBuzzObserverSequence(this.captureId, start, end, frames)
    if (this.sequencePolicy === 'require-contiguous' && !sequenceAudit.sequence_complete) {
      throw new Error(formatSequenceFailure(sequenceAudit))
    }

    const orderedFrames = [...frames].sort(
      (left, right) =>
        left.telemetry.seq - right.telemetry.seq || left.capture_line - right.capture_line,
    )
    const events: RuntimeLogEventRef[] = orderedFrames.map((frame) => ({
      event_id: frame.event.id,
      position: frame.telemetry.seq,
      event_hash: frame.event_hash,
      kind: `buzz.observer.${frame.telemetry.kind}`,
      timestamp: frame.telemetry.timestamp,
    }))
    const projections: RuntimeLogProjectionRef[] = [
      {
        name: BUZZ_OBSERVER_SEQUENCE_PROJECTION,
        format: BUZZ_OBSERVER_SEQUENCE_AUDIT_SCHEMA,
        root_hash: hashCanonical(sequenceAudit, 'Buzz observer sequence audit'),
        event_count: frames.length,
        uri: `buzz-observer://capture/${encodeURIComponent(this.captureId)}/sequence-audit`,
      },
    ]
    const sessionDefinition: BuzzObserverSessionDefinition = {
      schema: BUZZ_OBSERVER_SESSION_SCHEMA,
      id: this.captureId,
      source: {
        id: 'buzz-observer-frames',
        kind: 'buzz-nip-ao-capture',
        version: this.sourceVersion,
      },
      runtime: this.runtime,
      format: 'buzz-nip-ao-24200/v1',
      owner_pubkey: this.ownerPubkey,
      capture_kind: this.captureKind,
      sequence_scope: 'process-local',
      sequence_policy: this.sequencePolicy,
      storage: {
        raw_events: 'host-owned',
        decrypted_payloads: 'local-only',
        manifest_material: 'hashes-and-refs',
      },
      claim_boundary: {
        event_signature: 'verifier-checked',
        decrypted_payload: 'host-decrypt-callback',
        telemetry_timestamp: 'sender-declared',
        relay_admission: 'not-claimed',
        runtime_execution: 'observer-telemetry-only',
      },
    }
    const manifest = createLogWindowManifest({
      source: this.source,
      runtime: this.runtime,
      session: {
        id: this.captureId,
        digest: hashSessionDefinition(sessionDefinition),
        format: sessionDefinition.format,
        uri: `buzz-observer://capture/${encodeURIComponent(this.captureId)}`,
      },
      window: {
        start,
        end,
        label: `Buzz process observer sequence ${start}..${end}`,
      },
      events,
      projections,
      redaction: {
        mode: 'hash-only',
        rule: 'Nostr ciphertext and decrypted observer payloads stay in the host capture',
        fields: ['content', 'payload'],
      },
      privacy_posture: 'host-owned',
      verifier_policy: {
        require_event_root: true,
        require_session_definition: true,
        require_projection_roots: [BUZZ_OBSERVER_SEQUENCE_PROJECTION],
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
      sequence_audit: sequenceAudit,
      frames: orderedFrames,
      verification,
    }
  }

  async readFrames(): Promise<readonly BuzzObserverFrame[]> {
    const text = await readFile(this.path, 'utf8')
    const frames: BuzzObserverFrame[] = []
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) continue
      const captureLine = index + 1
      const parsed = parseJsonObject(line, `${this.path}:${captureLine}`)
      const eventVerification = await verifyNostrEvent(parsed)
      if (!eventVerification.valid) {
        throw new Error(
          `invalid Nostr observer event at ${this.path}:${captureLine}: ${eventVerification.errors.join(',')}`,
        )
      }
      const event = parsed as unknown as NostrEvent
      const tags = validateTelemetryTags(event, this.ownerPubkey)
      const decrypted = await this.decrypt(event)
      const telemetry = parseTelemetry(decrypted, `${this.path}:${captureLine}`)
      frames.push({
        capture_line: captureLine,
        event,
        event_verification: eventVerification,
        owner_pubkey: this.ownerPubkey,
        agent_pubkey: tags.agent,
        telemetry,
        ciphertext_hash: hashRuntimeLogEvent(event.content),
        plaintext_hash: hashRuntimeLogEvent(telemetry),
        event_hash: hashRuntimeLogEvent({
          schema: BUZZ_OBSERVER_EVENT_SCHEMA,
          capture_line: captureLine,
          nostr_event_id: event.id,
          author_pubkey: event.pubkey,
          recipient_pubkey: tags.recipient,
          agent_pubkey: tags.agent,
          event_created_at: event.created_at,
          seq: telemetry.seq,
          timestamp: telemetry.timestamp,
          kind: telemetry.kind,
          ciphertext_hash: hashRuntimeLogEvent(event.content),
          plaintext_hash: hashRuntimeLogEvent(telemetry),
        }),
      })
    }
    return frames
  }
}

export function auditBuzzObserverSequence(
  captureId: string,
  start: number,
  end: number,
  frames: readonly BuzzObserverFrame[],
): BuzzObserverSequenceAudit {
  const seenSeq = new Set<number>()
  const duplicateSeq = new Set<number>()
  const seenEventIds = new Set<string>()
  const duplicateEventIds = new Set<string>()
  const outOfOrder: BuzzObserverOutOfOrderPair[] = []
  let previous: number | undefined

  for (const frame of frames) {
    const current = frame.telemetry.seq
    if (seenSeq.has(current)) duplicateSeq.add(current)
    seenSeq.add(current)
    if (seenEventIds.has(frame.event.id)) duplicateEventIds.add(frame.event.id)
    seenEventIds.add(frame.event.id)
    if (previous !== undefined && current < previous) {
      outOfOrder.push({
        previous,
        current,
        capture_line: frame.capture_line,
      })
    }
    previous = current
  }

  const sorted = [...seenSeq]
    .filter((position) => position >= start && position <= end)
    .sort((left, right) => left - right)
  const missingRanges: BuzzObserverMissingRange[] = []
  let cursor = start
  for (const position of sorted) {
    if (position > cursor) missingRanges.push({ start: cursor, end: position - 1 })
    cursor = Math.max(cursor, position + 1)
  }
  if (cursor <= end) missingRanges.push({ start: cursor, end })

  const sequenceComplete =
    duplicateSeq.size === 0 &&
    duplicateEventIds.size === 0 &&
    outOfOrder.length === 0 &&
    missingRanges.length === 0

  return {
    schema: BUZZ_OBSERVER_SEQUENCE_AUDIT_SCHEMA,
    capture_id: captureId,
    sequence_scope: 'process-local',
    requested_window: { start, end },
    captured_event_count: frames.length,
    sequence_complete: sequenceComplete,
    duplicate_seq: [...duplicateSeq].sort((left, right) => left - right),
    duplicate_event_ids: [...duplicateEventIds].sort(),
    out_of_order: outOfOrder,
    missing_ranges: missingRanges,
    basis: sequenceComplete ? 'complete-captured-window' : 'incomplete-captured-window',
  }
}

function validateTelemetryTags(
  event: NostrEvent,
  ownerPubkey: string,
): { recipient: string; agent: string } {
  if (event.kind !== 24_200) throw new Error(`expected Buzz observer kind 24200, got ${event.kind}`)
  const recipient = exactSingleTag(event, 'p')
  const agent = exactSingleTag(event, 'agent')
  const frame = exactSingleTag(event, 'frame')
  if (frame !== 'telemetry') {
    throw new Error(`Buzz runtime-log source accepts telemetry frames, got ${frame}`)
  }
  if (recipient !== ownerPubkey) throw new Error('observer frame recipient does not match owner')
  if (agent !== event.pubkey) throw new Error('observer frame author does not match agent tag')
  return { recipient, agent }
}

function exactSingleTag(event: NostrEvent, name: string): string {
  const matches = event.tags.filter((tag) => tag[0] === name)
  if (matches.length !== 1 || matches[0]!.length < 2 || matches[0]![1] === '') {
    throw new Error(`observer frame must contain exactly one ${name} tag with a value`)
  }
  return matches[0]![1]!
}

function parseTelemetry(value: unknown, label: string): BuzzObserverTelemetry {
  const parsed =
    typeof value === 'string'
      ? parseJsonObject(value, `${label} decrypted content`)
      : requireObject(value, `${label} decrypted content`)
  const seq = readSafeUint(parsed, 'seq')
  const timestamp = readNonEmptyString(parsed, 'timestamp')
  if (!isRfc3339(timestamp)) throw new Error(`${label} timestamp must be RFC 3339`)
  const kind = readNonEmptyString(parsed, 'kind')
  const payload = requireObject(parsed.payload, `${label} payload`)
  return {
    seq,
    timestamp,
    kind,
    agentIndex: readNullableIndex(parsed, 'agentIndex'),
    channelId: readNullableString(parsed, 'channelId'),
    sessionId: readNullableString(parsed, 'sessionId'),
    turnId: readNullableString(parsed, 'turnId'),
    payload,
  }
}

function formatSequenceFailure(audit: BuzzObserverSequenceAudit): string {
  const codes: string[] = []
  if (audit.duplicate_seq.length > 0) codes.push('duplicate_seq')
  if (audit.duplicate_event_ids.length > 0) codes.push('duplicate_event_id')
  if (audit.out_of_order.length > 0) codes.push('out_of_order')
  if (audit.missing_ranges.length > 0) codes.push('sequence_gap')
  return `Buzz observer sequence is incomplete: ${codes.join(',')}`
}

function parseSequence(value: string | number, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return parsed
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
  return requireObject(value, label)
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function readSafeUint(value: Record<string, unknown>, key: string): number {
  const member = value[key]
  if (!Number.isSafeInteger(member) || (member as number) < 0) {
    throw new Error(`${key} must be a non-negative safe integer`)
  }
  return member as number
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string {
  const member = value[key]
  if (typeof member !== 'string' || member.length === 0) {
    throw new Error(`${key} must be a non-empty string`)
  }
  return member
}

function readNullableString(value: Record<string, unknown>, key: string): string | null {
  const member = value[key]
  if (member === undefined || member === null) return null
  if (typeof member !== 'string' || member.length === 0) {
    throw new Error(`${key} must be a non-empty string or null`)
  }
  return member
}

function readNullableIndex(value: Record<string, unknown>, key: string): number | null {
  const member = value[key]
  if (member === undefined || member === null) return null
  if (!Number.isSafeInteger(member) || (member as number) < 0) {
    throw new Error(`${key} must be a non-negative safe integer or null`)
  }
  return member as number
}

function isRfc3339(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function assertHex32(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} must be 64 lowercase hex characters`)
  }
}
