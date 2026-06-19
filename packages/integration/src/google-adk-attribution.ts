// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { BasePlugin } from '@google/adk'
import type { BaseTool, Context } from '@google/adk'
import canonicalize from 'canonicalize'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  createSubmissionQueue,
  EVENT_TYPE_TOOL_CALL_URI,
  getPublicKey,
  hexDecode,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
} from '@atrib/mcp'
import type { AtribRecord, ProofBundle, SubmissionQueue } from '@atrib/mcp'

type MaybePromise<T> = T | Promise<T>

const DEFAULT_SERVER_URL = 'adk://runner'
const DEFAULT_PLUGIN_NAME = 'atrib_google_adk'
const encoder = new TextEncoder()

export type AtribAdkToolOutcome =
  | {
      status: 'ok'
      result: unknown
    }
  | {
      status: 'error'
      error: { name: string; message: string }
    }

export interface AtribAdkToolSidecar {
  framework: 'google-adk'
  plugin_name: string
  operation: string
  tool_name: string
  function_call_id?: string
  invocation_id: string
  app_name: string
  agent_name: string
  session_id: string
  user_id: string
  args: unknown
  record_hash: string
  informed_by?: string[]
  status: 'ok' | 'error'
  result?: unknown
  error?: { name: string; message: string }
}

export interface AtribAdkPluginOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed ADK tool operations. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks ADK. */
  onRecord?: (record: AtribRecord, sidecar: AtribAdkToolSidecar) => MaybePromise<void>
  /** Parent atrib record hashes that justify the first ADK tool action. */
  parentRecordHashes?: string[]
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
  /** ADK plugin name. Must be unique within a Runner. */
  pluginName?: string
}

export interface AtribAdkPluginState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): AtribAdkToolSidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export class AtribAdkPlugin extends BasePlugin implements AtribAdkPluginState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: AtribAdkPluginOptions['onRecord'] | undefined
  private readonly parentRecordHashes: string[]
  private readonly records: AtribRecord[] = []
  private readonly sidecars: AtribAdkToolSidecar[] = []
  private readonly errorSignedCalls = new Set<string>()
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(options: AtribAdkPluginOptions = {}) {
    super(options.pluginName ?? DEFAULT_PLUGIN_NAME)
    this.privateKey = tryResolvePrivateKey(options.privateKey)
    this.contextId = options.contextId ?? randomContextId()
    this.serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL
    this.now = options.now ?? Date.now
    this.onRecord = options.onRecord
    this.parentRecordHashes = normalizeRecordHashes(options.parentRecordHashes ?? [])

    if (!this.privateKey || options.logSubmission === 'disabled') {
      this.queue = options.submissionQueue
    } else {
      this.queue = options.submissionQueue ?? createSubmissionQueue(options.logEndpoint)
    }
  }

  override async afterToolCallback({
    tool,
    toolArgs,
    toolContext,
    result,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    result: Record<string, unknown>
  }): Promise<Record<string, unknown> | undefined> {
    const marker = toolCallMarker(tool, toolContext)
    if (this.errorSignedCalls.delete(marker)) return undefined
    await this.signToolOutcome(tool, toolArgs, toolContext, { status: 'ok', result })
    return undefined
  }

  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool
    toolArgs: Record<string, unknown>
    toolContext: Context
    error: Error
  }): Promise<Record<string, unknown> | undefined> {
    await this.signToolOutcome(tool, toolArgs, toolContext, {
      status: 'error',
      error: normalizeError(error),
    })
    this.errorSignedCalls.add(toolCallMarker(tool, toolContext))
    return undefined
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): AtribAdkToolSidecar[] {
    return [...this.sidecars]
  }

  getLastRecordHash(): string | undefined {
    return this.lastRecordHashHex ? `sha256:${this.lastRecordHashHex}` : undefined
  }

  getProof(recordHash: string): ProofBundle | undefined {
    return this.queue?.getProof(recordHash)
  }

  async flushAtrib(): Promise<void> {
    await this.queue?.flush()
  }

  private async signToolOutcome(
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    toolContext: Context,
    outcome: AtribAdkToolOutcome,
  ): Promise<void> {
    const privateKey = this.privateKey
    if (!privateKey) return

    const argsSnapshot = snapshotCanonical(toolArgs)
    const outcomeSnapshot = snapshotCanonical(outcome) as AtribAdkToolOutcome | undefined
    if (argsSnapshot === undefined || outcomeSnapshot === undefined) return

    try {
      await this.init()
      const operation = `google.adk.tool.${tool.name}`
      const informedBy = this.lastRecordHashHex
        ? [`sha256:${this.lastRecordHashHex}`]
        : this.parentRecordHashes
      const record: AtribRecord = {
        spec_version: 'atrib/1.0',
        content_id: computeContentId(this.serverUrl, operation),
        creator_key: this.creatorKey,
        chain_root: resolveChainRoot({
          contextId: this.contextId,
          autoChainTailHex: this.lastRecordHashHex,
        }),
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        context_id: this.contextId,
        timestamp: this.now(),
        signature: '',
        args_hash: hashCanonical(argsSnapshot),
        result_hash: hashCanonical(outcomeSnapshot),
        tool_name: operation,
        ...(informedBy.length > 0 ? { informed_by: informedBy } : {}),
      }
      const signed = await signRecord(record, privateKey)
      const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
      const sidecar = buildSidecar({
        pluginName: this.name,
        operation,
        tool,
        toolContext,
        args: argsSnapshot,
        outcome: outcomeSnapshot,
        recordHash: `sha256:${recordHashHex}`,
        informedBy,
      })
      this.lastRecordHashHex = recordHashHex
      this.records.push(signed)
      this.sidecars.push(sidecar)
      this.queue?.submit(signed, 'normal')
      await this.onRecord?.(signed, sidecar)
    } catch {
      // §5.8: ADK tool execution must not fail because atrib could not sign.
    }
  }

  private async init(): Promise<void> {
    if (!this.privateKey || this.creatorKey) return
    this.initPromise ??= getPublicKey(this.privateKey).then((pubkey) => {
      this.creatorKey = base64urlEncode(pubkey)
    })
    await this.initPromise
  }
}

export function resolveAdkPrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) throw new Error('atrib ADK plugin: privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib ADK plugin: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib ADK plugin: privateKey must decode to 32 bytes')
  }
  return decoded
}

function buildSidecar({
  pluginName,
  operation,
  tool,
  toolContext,
  args,
  outcome,
  recordHash,
  informedBy,
}: {
  pluginName: string
  operation: string
  tool: BaseTool
  toolContext: Context
  args: unknown
  outcome: AtribAdkToolOutcome
  recordHash: string
  informedBy: string[]
}): AtribAdkToolSidecar {
  const base = {
    framework: 'google-adk' as const,
    plugin_name: pluginName,
    operation,
    tool_name: tool.name,
    invocation_id: toolContext.invocationId,
    app_name: toolContext.invocationContext.appName,
    agent_name: toolContext.agentName,
    session_id: toolContext.sessionId,
    user_id: toolContext.userId,
    args,
    record_hash: recordHash,
    ...(informedBy.length > 0 ? { informed_by: informedBy } : {}),
  }
  const callScoped =
    toolContext.functionCallId === undefined
      ? base
      : { ...base, function_call_id: toolContext.functionCallId }
  return outcome.status === 'ok'
    ? { ...callScoped, status: 'ok', result: outcome.result }
    : { ...callScoped, status: 'error', error: outcome.error }
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveAdkPrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib ADK plugin: cannot canonicalize value')
  }
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

function snapshotCanonical(value: unknown): unknown | undefined {
  try {
    const json = canonicalize(value)
    if (json === undefined) return undefined
    return JSON.parse(json) as unknown
  } catch {
    return undefined
  }
}

function normalizeRecordHashes(values: string[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    if (!/^sha256:[0-9a-f]{64}$/.test(value)) {
      throw new Error('atrib ADK plugin: parentRecordHashes must be sha256:<64 lowercase hex>')
    }
    unique.add(value)
  }
  return [...unique].sort()
}

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}

function toolCallMarker(tool: BaseTool, toolContext: Context): string {
  return `${tool.name}:${toolContext.functionCallId ?? 'no-call-id'}`
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}
