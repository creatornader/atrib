#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { createReadStream, realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hostCaptureSourceVerifier, verifyEvidenceSet, type EvidenceSetResult } from '@atrib/verify'
import { EVIDENCE_PREFIX, EVIDENCE_TYPES, HOST_CAPTURE_METHOD, sha256, hexEncode } from '@atrib/mcp'
import {
  LOG_WINDOW_MANIFEST_SCHEMA,
  buildRuntimeLogInspection,
  createLogWindowManifest,
  hashRuntimeLogEvent,
  hashCanonical,
  RUNTIME_COVERAGE_METHOD,
  runtimeCoverageSourceVerifier,
  hashSessionDefinition,
  isSha256Uri,
  renderRuntimeLogInspectionHtml,
  verifyLogWindowManifest,
  type LogWindowManifest,
  type LogWindowManifestEvidence,
  type RuntimeLogEventRef,
  type RuntimeLogPosition,
  type RuntimeLogPrivacyPosture,
  type RuntimeLogProjectionRef,
  type RuntimeLogSideEffectReceiptRef,
} from './index.js'

type Command = 'attest' | 'verify' | 'inspect' | 'help'

interface RuntimeLogCliIO {
  readonly stdout?: (text: string) => void
  readonly stderr?: (text: string) => void
}

interface ParsedArgs {
  readonly command: Command
  readonly flags: Map<string, string | true>
}

type CliOutput = string | unknown

const VERSION = '0.1.0'

const HELP = `atrib-runtime-log ${VERSION}

Usage:
  atrib-runtime-log attest --events events.jsonl --session-definition session.json [options]
  atrib-runtime-log verify --manifest manifest.json [--events events.jsonl] [--session-definition session.json]
  atrib-runtime-log inspect --manifest manifest.json [--format json|html] [verify options]
  atrib-runtime-log inspect --mirror records.jsonl --policy policy.json --request HASH --evaluated-at MS [--dispatch HASH] [--format json|text]
  atrib-runtime-log --version | --help

Commands:
  attest   Build a log_window_manifest from local files only.
  verify   Replay supplied local evidence against a manifest.
  inspect  Render a reviewer-facing proof packet as JSON or static HTML.

attest options:
  --out PATH                 Write manifest JSON to PATH instead of stdout.
  --source-id ID             Default: file.runtime-log
  --source-kind KIND         Default: jsonl
  --source-version VERSION   Default: 0.1.0
  --runtime-name NAME        Default: file-runtime-log
  --runtime-version VERSION  Default: 0.1.0
  --session-id ID            Default: session.id, session.session_id, or file-session
  --window-start VALUE       Default: first event position
  --window-end VALUE         Default: last event position
  --privacy-posture VALUE    Default: host-owned
  --created-at ISO           Optional manifest timestamp

verify options:
  --out PATH                       Write verifier result JSON to PATH.
  --projections PATH               JSON array or JSONL projection refs.
  --side-effect-receipts PATH      JSON array or JSONL receipt refs.
  --fork-parent-manifest PATH      Parent manifest JSON for fork verification.
  --compaction-source-manifest PATH Source manifest JSON for compaction verification.
  --compaction-events PATH         Event JSONL for compacted event-root replay.

inspect options:
  --format VALUE                   json (default) or html.
  --title TEXT                     Override the proof packet title.
  --signed-record HASH             Optional sha256 record hash for the atrib record
                                   that commits to this manifest.
  --signed-record-uri URI          Optional public log, archive, or local URI for
                                   the signed record.
  --mirror PATH                    Inspect retained private evidence envelopes.
  --policy PATH                    Receiver-pinned policy JSON, required with --mirror.
  --request HASH                   Request record to reconstruct.
  --dispatch HASH                  Select one dispatch. Default: inspect all matching dispatches.
  --evaluated-at MS                Explicit evaluation time in epoch milliseconds.

Event JSONL:
  Each non-empty line can be either a RuntimeLogEventRef with event_id,
  position, and event_hash, or a raw runtime event body. Raw bodies are hashed
  with hashRuntimeLogEvent(), and event_id / position default from line order.
`

export async function runRuntimeLogCli(
  argv: readonly string[] = process.argv.slice(2),
  io: RuntimeLogCliIO = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text))

  try {
    const parsed = parseArgs(argv)
    if (parsed.flags.has('version')) {
      stdout(`${VERSION}\n`)
      return 0
    }
    if (parsed.flags.has('help') || parsed.command === 'help') {
      stdout(HELP)
      return 0
    }

    if (parsed.command === 'attest') {
      const manifest = await runAttest(parsed.flags)
      await writeCliOutput(parsed.flags, manifest, stdout)
      return 0
    }

    if (parsed.command === 'verify') {
      const result = await runVerify(parsed.flags)
      await writeCliOutput(parsed.flags, result, stdout)
      return result.valid ? 0 : 1
    }

    if (parsed.command === 'inspect') {
      if (parsed.flags.has('mirror')) {
        const inspection = await runMirrorInspect(parsed.flags)
        const format = optionalFlag(parsed.flags, 'format') ?? 'json'
        if (!['json', 'text'].includes(format)) throw new Error(`unsupported --format: ${format}`)
        await writeCliOutput(
          parsed.flags,
          format === 'text' ? renderMirrorInspection(inspection) : inspection,
          stdout,
        )
        return inspection.accepted ? 0 : 1
      }
      const summary = await runInspect(parsed.flags)
      await writeCliOutput(parsed.flags, summary, stdout)
      return 0
    }

    stderr(`unknown command: ${parsed.command}\n`)
    return 2
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

type JsonObject = Record<string, unknown>

async function runMirrorInspect(flags: Map<string, string | true>) {
  const policy = await readJsonFile(requireFlag(flags, 'policy'))
  const requestHash = sha256Value(requireFlag(flags, 'request'), '--request')
  const evaluatedAtText = requireFlag(flags, 'evaluated-at')
  const evaluatedAt = Number(evaluatedAtText)
  if (!/^\d+$/.test(evaluatedAtText) || !Number.isSafeInteger(evaluatedAt))
    throw new Error('--evaluated-at must be a nonnegative safe integer in epoch milliseconds')
  if (flags.has('manifest')) throw new Error('--mirror and --manifest cannot be combined')
  const mirror = await readEvidenceMirror(requireFlag(flags, 'mirror'))
  const selected = optionalFlag(flags, 'dispatch')
  const dispatches = selected
    ? [sha256Value(selected, '--dispatch')]
    : [...mirror.openings]
        .filter(([, opening]) => {
          if (!isRecord(opening) || !isRecord(opening.assertion) || !isRecord(opening.target))
            return false
          return (
            opening.assertion.phase === 'dispatch' && opening.target.record_hash === requestHash
          )
        })
        .map(([hash]) => hash)
        .sort()
  const gaps: string[] = []
  if (!dispatches.length)
    gaps.push(
      'No dispatch opening available; dispatch ordering and historical authority unresolved. Retained evidence is evaluated at the supplied time.',
    )
  for (const record of mirror.records) {
    const hash = hashCanonical(record)
    if (
      typeof record.event_type === 'string' &&
      record.event_type.startsWith(EVIDENCE_PREFIX) &&
      !mirror.openings.has(hash)
    ) {
      const kind =
        Object.entries(EVIDENCE_TYPES).find(([, type]) => type === record.event_type)?.[0] ??
        'evidence record'
      gaps.push(
        `Unattributed ${kind} ${hash}: opening unavailable; no request relationship inferred.`,
      )
      if (hash === requestHash || dispatches.includes(hash))
        gaps.push(`Missing opening for ${hash}.`)
    }
  }
  const inspections: Array<{
    dispatch_record: string | null
    accepted: boolean
    verification: EvidenceSetResult
  }> = []
  for (const dispatch of dispatches.length ? dispatches : [null]) {
    const verification = await verifyEvidenceSet({
      records: mirror.records,
      openings: mirror.openings,
      artifacts: mirror.artifacts,
      policy,
      evaluation: dispatch
        ? { purpose: 'historical', evaluated_at: evaluatedAt, dispatch_record: dispatch }
        : { purpose: 'current', evaluated_at: evaluatedAt },
      requestHash,
      sourceVerifiers: {
        [HOST_CAPTURE_METHOD]: hostCaptureSourceVerifier,
        [RUNTIME_COVERAGE_METHOD]: runtimeCoverageSourceVerifier,
      },
    })
    inspections.push({
      dispatch_record: dispatch,
      accepted: Boolean(
        dispatch &&
        verification.policy &&
        verification.request?.reliance.accepted &&
        verification.request.dimensions.source.state === 'supported' &&
        verification.request.dimensions.binding.state === 'supported',
      ),
      verification,
    })
  }
  const claims = [...mirror.openings].flatMap(([recordHash, opening]) => {
    if (!isRecord(opening) || !isRecord(opening.assertion)) return []
    const record = mirror.records.find((record) => hashCanonical(record) === recordHash)
    if (
      record?.event_type !== `${EVIDENCE_PREFIX}report` ||
      !isRecord(opening.target) ||
      opening.target.record_hash !== requestHash
    )
      return []
    return [{ record_hash: recordHash, assertion: opening.assertion }]
  })
  const requestRecord = mirror.records.find((record) => hashCanonical(record) === requestHash)
  const requestOpening = mirror.openings.get(requestHash)
  const requested = {
    record_hash: requestHash,
    signer: requestRecord?.creator_key,
    descriptor:
      isRecord(requestOpening) && isRecord(requestOpening.assertion)
        ? requestOpening.assertion.descriptor
        : undefined,
  }
  const authorizations = mirror.records.flatMap((record) => {
    const recordHash = hashCanonical(record)
    const opening = mirror.openings.get(recordHash)
    if (
      record.event_type !== `${EVIDENCE_PREFIX}authorization` ||
      !isRecord(opening) ||
      !isRecord(opening.target) ||
      opening.target.record_hash !== requestHash ||
      !isRecord(opening.assertion)
    )
      return []
    return [
      { record_hash: recordHash, signer: record.creator_key, decision: opening.assertion.decision },
    ]
  })
  return {
    request_record: requestHash,
    requested,
    authorizations,
    accepted: inspections.length > 0 && inspections.every((inspection) => inspection.accepted),
    claims,
    gaps,
    inspections,
  }
}

/** Reads private retention metadata only. The receiver evaluates signed evidence. */
async function readEvidenceMirror(path: string) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 67_108_864) throw new Error('mirror exceeds 64 MiB inspection limit')
    chunks.push(bytes)
  }
  const bytes = Buffer.concat(chunks)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (text && !text.endsWith('\n')) throw new Error('mirror truncated: last line has no newline')
  const rows = text.split('\n').flatMap((line, index) => {
    if (!line.trim()) return []
    try {
      return [{ value: JSON.parse(line) as unknown, line: index + 1 }]
    } catch {
      throw new Error(`invalid mirror JSON on line ${index + 1}`)
    }
  })
  const records: JsonObject[] = []
  const openings = new Map<string, unknown>()
  const artifacts = new Map<string, Uint8Array>()
  for (const { value, line } of rows) {
    if (!isRecord(value)) throw new Error(`invalid mirror entry on line ${line}`)
    const record = 'record' in value ? value.record : value
    if (!isRecord(record)) throw new Error(`invalid mirror record on line ${line}`)
    records.push(record)
    const hash = hashCanonical(record)
    if (value._local !== undefined && !isRecord(value._local))
      throw new Error(`invalid mirror metadata on line ${line}`)
    const evidence = isRecord(value._local) ? value._local.evidence : undefined
    if (evidence === undefined) continue
    if (!isRecord(evidence)) throw new Error(`invalid retained evidence on line ${line}`)
    if (evidence.opening !== undefined) {
      if (
        openings.has(hash) &&
        hashCanonical(openings.get(hash)) !== hashCanonical(evidence.opening)
      )
        throw new Error(`conflicting retained openings on line ${line}`)
      openings.set(hash, evidence.opening)
    }
    if (evidence.artifacts === undefined) continue
    if (!Array.isArray(evidence.artifacts))
      throw new Error(`invalid retained artifacts on line ${line}`)
    for (const artifact of evidence.artifacts) {
      if (
        !isRecord(artifact) ||
        typeof artifact.hash !== 'string' ||
        typeof artifact.base64 !== 'string'
      )
        throw new Error(`invalid retained artifact on line ${line}`)
      const content = Buffer.from(artifact.base64, 'base64')
      if (
        content.toString('base64') !== artifact.base64 ||
        `sha256:${hexEncode(sha256(content))}` !== artifact.hash
      )
        throw new Error(`retained artifact hash mismatch on line ${line}`)
      artifacts.set(artifact.hash, content)
    }
  }
  return { records, openings, artifacts }
}

function renderMirrorInspection(inspection: Awaited<ReturnType<typeof runMirrorInspect>>): string {
  const plain = (value: unknown) =>
    Array.from(String(value), (character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || (code >= 127 && code <= 159) ? ' ' : character
    }).join('')
  const lines = [
    inspection.accepted
      ? 'Required evidence is supported.'
      : 'Required evidence is incomplete or invalid.',
    'Host capture and runtime coverage are host accounts.',
    'Supported runtime coverage checks consistency with a host-signed native inventory.',
    'Runtime vendor provenance and independent operator provenance are not established by these methods.',
    'Evidence acceptance does not authorize execution.',
  ]
  if (inspection.requested.signer)
    lines.push(`Request signer: ${plain(inspection.requested.signer)}.`)
  if (isRecord(inspection.requested.descriptor)) {
    const descriptor = inspection.requested.descriptor
    lines.push(`Requested: ${plain(descriptor.service)} ${plain(descriptor.operation)}.`)
  }
  for (const authorization of inspection.authorizations)
    lines.push(
      `Authorization claim: ${plain(authorization.decision)}, signed by ${plain(authorization.signer)}.`,
    )
  for (const claim of inspection.claims) {
    const text = typeof claim.assertion.text === 'string' ? plain(claim.assertion.text) : ''
    lines.push(`Reported claim: ${text} (${claim.record_hash}).`)
  }
  if (!inspection.claims.length) lines.push('Reported claim: none retained for this request.')
  for (const item of inspection.inspections) {
    const result: EvidenceSetResult = item.verification
    const dimensions = result.request?.dimensions
    lines.push(
      item.dispatch_record
        ? `Dispatch ${item.dispatch_record}`
        : 'No dispatch opening available; dispatch ordering and historical authority unresolved.',
    )
    if (!dimensions) {
      lines.push('Request: missing or invalid.')
      continue
    }
    lines.push(
      `Claim integrity: ${dimensions.integrity.state}.`,
      `Observed source: ${dimensions.source.state}. Request binding: ${dimensions.binding.state}.`,
      `Authority: ${dimensions.authority.state}.`,
      `Remote effect: ${dimensions.effect.state}.`,
      `Capture coverage: ${dimensions.coverage.state}.`,
      `Execution: ${result.request!.execution.deliveries.map((delivery) => delivery.state).join(', ') || 'unknown'}.`,
    )
    for (const [name, dimension] of Object.entries(dimensions))
      if (dimension.reasons.length) lines.push(`${name}: ${dimension.reasons.join(', ')}.`)
  }
  lines.push(...inspection.gaps)
  return `${lines.join('\n')}\n`
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string | true>()
  let command: Command = 'help'
  let index = 0

  if (argv.length > 0 && !argv[0]!.startsWith('-')) {
    command = argv[0] as Command
    index = 1
  }

  for (let i = index; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') {
      flags.set('help', true)
      continue
    }
    if (arg === '--version' || arg === '-v') {
      flags.set('version', true)
      continue
    }
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${arg}`)
    }
    const name = arg.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`)
    }
    flags.set(name, value)
    i++
  }

  if (!['attest', 'verify', 'inspect', 'help'].includes(command)) {
    throw new Error(`unknown command: ${command}`)
  }

  return { command, flags }
}

async function runAttest(flags: Map<string, string | true>): Promise<LogWindowManifest> {
  const eventPath = requireFlag(flags, 'events')
  const sessionDefinitionPath = requireFlag(flags, 'session-definition')
  const events = await readEventRefs(eventPath)
  if (events.length === 0) {
    throw new Error('--events must contain at least one runtime event')
  }

  const sessionDefinition = await readJsonFile(sessionDefinitionPath)
  const sessionId =
    optionalFlag(flags, 'session-id') ??
    readStringField(sessionDefinition, 'id') ??
    readStringField(sessionDefinition, 'session_id') ??
    'file-session'
  const createdAt = optionalFlag(flags, 'created-at')

  return createLogWindowManifest({
    source: {
      id: optionalFlag(flags, 'source-id') ?? 'file.runtime-log',
      kind: optionalFlag(flags, 'source-kind') ?? 'jsonl',
      version: optionalFlag(flags, 'source-version') ?? '0.1.0',
      uri: pathToFileURL(eventPath).href,
    },
    runtime: {
      name: optionalFlag(flags, 'runtime-name') ?? 'file-runtime-log',
      version: optionalFlag(flags, 'runtime-version') ?? '0.1.0',
    },
    session: {
      id: sessionId,
      digest: hashSessionDefinition(sessionDefinition),
      format: 'json',
      uri: pathToFileURL(sessionDefinitionPath).href,
    },
    window: {
      start: optionalPosition(flags, 'window-start') ?? events[0]!.position,
      end: optionalPosition(flags, 'window-end') ?? events[events.length - 1]!.position,
    },
    events,
    privacy_posture: privacyPosture(flags),
    verifier_policy: {
      require_event_root: true,
      require_session_definition: true,
    },
    ...(createdAt ? { created_at: createdAt } : {}),
  })
}

async function runVerify(flags: Map<string, string | true>) {
  const manifest = await readManifest(requireFlag(flags, 'manifest'))
  const evidence = await readEvidence(flags)

  return verifyLogWindowManifest(manifest, evidence)
}

async function runInspect(flags: Map<string, string | true>) {
  const manifest = await readManifest(requireFlag(flags, 'manifest'))
  const evidence = await readEvidence(flags)
  const signedRecordHash = optionalFlag(flags, 'signed-record')
  const inspection = buildRuntimeLogInspection({
    manifest,
    evidence,
    ...(optionalFlag(flags, 'title') ? { title: requireFlag(flags, 'title') } : {}),
    ...(signedRecordHash
      ? {
          signed_record: {
            record_hash: sha256Value(signedRecordHash, '--signed-record'),
            ...(optionalFlag(flags, 'signed-record-uri')
              ? { uri: requireFlag(flags, 'signed-record-uri') }
              : {}),
          },
        }
      : {}),
  })
  const format = optionalFlag(flags, 'format') ?? 'json'
  if (format === 'json') return inspection
  if (format === 'html') return renderRuntimeLogInspectionHtml(inspection)
  throw new Error(`unsupported --format: ${format}`)
}

async function readEventRefs(path: string): Promise<RuntimeLogEventRef[]> {
  const rows = await readJsonLines(path)
  return rows.map((row, index) => eventRefFromRow(row, index))
}

function eventRefFromRow(row: unknown, index: number): RuntimeLogEventRef {
  if (!isRecord(row)) {
    return {
      event_id: `event-${index + 1}`,
      position: index + 1,
      event_hash: hashRuntimeLogEvent(row),
    }
  }

  if (
    typeof row.event_id === 'string' &&
    row.position !== undefined &&
    typeof row.event_hash === 'string'
  ) {
    if (!isSha256Uri(row.event_hash)) {
      throw new Error(`event_hash for ${row.event_id} must be sha256:<64 lowercase hex chars>`)
    }
    return {
      event_id: row.event_id,
      position: runtimePosition(row.position, `position for ${row.event_id}`),
      event_hash: row.event_hash,
      ...(typeof row.kind === 'string' ? { kind: row.kind } : {}),
      ...(typeof row.timestamp === 'string' ? { timestamp: row.timestamp } : {}),
      ...(Array.isArray(row.parent_event_hashes)
        ? {
            parent_event_hashes: row.parent_event_hashes.map((value) =>
              sha256Value(value, 'parent_event_hash'),
            ),
          }
        : {}),
    }
  }

  const id =
    readStringField(row, 'event_id') ??
    readStringField(row, 'id') ??
    readStringField(row, 'name') ??
    `event-${index + 1}`
  return {
    event_id: id,
    position:
      row.position !== undefined ? runtimePosition(row.position, `position for ${id}`) : index + 1,
    event_hash: hashRuntimeLogEvent(row),
    ...(typeof row.kind === 'string' ? { kind: row.kind } : {}),
    ...(typeof row.timestamp === 'string' ? { timestamp: row.timestamp } : {}),
  }
}

async function readJsonLines(path: string): Promise<unknown[]> {
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown
      } catch (error) {
        throw new Error(`invalid JSON on ${path}:${index + 1}: ${errorMessage(error)}`)
      }
    })
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`invalid JSON file ${path}: ${errorMessage(error)}`)
  }
}

async function readManifest(path: string): Promise<LogWindowManifest> {
  const value = await readJsonFile(path)
  if (!isRecord(value) || value.schema !== LOG_WINDOW_MANIFEST_SCHEMA) {
    throw new Error(`${path} is not a log_window_manifest`)
  }
  return value as unknown as LogWindowManifest
}

async function readEvidence(flags: Map<string, string | true>): Promise<LogWindowManifestEvidence> {
  return {
    ...(optionalFlag(flags, 'events')
      ? { events: await readEventRefs(requireFlag(flags, 'events')) }
      : {}),
    ...(optionalFlag(flags, 'session-definition')
      ? { session_definition: await readJsonFile(requireFlag(flags, 'session-definition')) }
      : {}),
    ...(optionalFlag(flags, 'projections')
      ? {
          projections: await readArrayFile<RuntimeLogProjectionRef>(
            requireFlag(flags, 'projections'),
            'projections',
          ),
        }
      : {}),
    ...(optionalFlag(flags, 'side-effect-receipts')
      ? {
          side_effect_receipts: await readArrayFile<RuntimeLogSideEffectReceiptRef>(
            requireFlag(flags, 'side-effect-receipts'),
            'side_effect_receipts',
          ),
        }
      : {}),
    ...(optionalFlag(flags, 'fork-parent-manifest')
      ? { fork_parent_manifest: await readManifest(requireFlag(flags, 'fork-parent-manifest')) }
      : {}),
    ...(optionalFlag(flags, 'compaction-source-manifest')
      ? {
          compaction_source_manifest: await readManifest(
            requireFlag(flags, 'compaction-source-manifest'),
          ),
        }
      : {}),
    ...(optionalFlag(flags, 'compaction-events')
      ? { compaction_events: await readEventRefs(requireFlag(flags, 'compaction-events')) }
      : {}),
  }
}

async function readArrayFile<T>(path: string, propertyName: string): Promise<T[]> {
  const text = (await readFile(path, 'utf8')).trim()
  if (text.length === 0) return []
  if (text.startsWith('[')) return JSON.parse(text) as T[]
  if (text.startsWith('{')) {
    const object = JSON.parse(text) as unknown
    if (isRecord(object) && Array.isArray(object[propertyName])) return object[propertyName] as T[]
    return [object as T]
  }
  return (await readJsonLines(path)) as T[]
}

async function writeCliOutput(
  flags: Map<string, string | true>,
  value: CliOutput,
  stdout: (text: string) => void,
): Promise<void> {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`
  const out = optionalFlag(flags, 'out')
  if (out) {
    await writeFile(out, text)
  } else {
    stdout(text)
  }
}

function requireFlag(flags: Map<string, string | true>, name: string): string {
  const value = optionalFlag(flags, name)
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function optionalFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function optionalPosition(
  flags: Map<string, string | true>,
  name: string,
): RuntimeLogPosition | undefined {
  const value = optionalFlag(flags, name)
  return value === undefined ? undefined : runtimePosition(value, `--${name}`)
}

function runtimePosition(value: unknown, label: string): RuntimeLogPosition {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length > 0) {
    const number = Number(value)
    return Number.isFinite(number) && String(number) === value ? number : value
  }
  throw new Error(`${label} must be a string or finite number`)
}

function privacyPosture(flags: Map<string, string | true>): RuntimeLogPrivacyPosture {
  const value = optionalFlag(flags, 'privacy-posture') ?? 'host-owned'
  if (['host-owned', 'local-mirror', 'archive-ref', 'public-fixture'].includes(value)) {
    return value as RuntimeLogPrivacyPosture
  }
  throw new Error(`unsupported --privacy-posture: ${value}`)
}

function sha256Value(value: unknown, label: string) {
  if (typeof value !== 'string' || !isSha256Uri(value)) {
    throw new Error(`${label} must be sha256:<64 lowercase hex chars>`)
  }
  return value
}

function readStringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isRuntimeLogCliEntrypoint(
  moduleUrl: string = import.meta.url,
  argvPath: string | undefined = process.argv[1],
): boolean {
  if (!argvPath) return false
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath)
  } catch {
    return pathToFileURL(argvPath).href === moduleUrl
  }
}

if (isRuntimeLogCliEntrypoint()) {
  runRuntimeLogCli().then((code) => {
    process.exitCode = code
  })
}
