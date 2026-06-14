#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { realpathSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  LOG_WINDOW_MANIFEST_SCHEMA,
  buildRuntimeLogInspection,
  createLogWindowManifest,
  hashRuntimeLogEvent,
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
      await writeJsonOutput(parsed.flags, manifest, stdout)
      return 0
    }

    if (parsed.command === 'verify') {
      const result = await runVerify(parsed.flags)
      await writeJsonOutput(parsed.flags, result, stdout)
      return result.valid ? 0 : 1
    }

    if (parsed.command === 'inspect') {
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

async function writeJsonOutput(
  flags: Map<string, string | true>,
  value: unknown,
  stdout: (text: string) => void,
): Promise<void> {
  const json = `${JSON.stringify(value, null, 2)}\n`
  const out = optionalFlag(flags, 'out')
  if (out) {
    await writeFile(out, json)
  } else {
    stdout(json)
  }
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
