// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
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

const DEFAULT_SERVER_URL = 'mastra://runtime'
const encoder = new TextEncoder()

export type MastraRuntimeSurface = 'mcp-client-tool'

export type MastraRuntimeOutcome =
  | {
      status: 'ok'
      result: unknown
    }
  | {
      status: 'error'
      error: { name: string; message: string }
    }

export interface MastraRuntimeSidecar {
  framework: 'mastra-runtime'
  surface: MastraRuntimeSurface
  server_name: string
  tool_name: string
  namespaced_tool_name: string
  operation: string
  tool_call_id: string
  args: unknown
  record_hash: string
  status: 'ok' | 'error'
  result?: unknown
  error?: { name: string; message: string }
}

export interface MastraRuntimeReceiptOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed Mastra runtime operations. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks Mastra calls. */
  onRecord?: (record: AtribRecord, sidecar: MastraRuntimeSidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export interface MastraRuntimeReceiptState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): MastraRuntimeSidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export interface MastraRuntimeToolCall<TResult> {
  surface: MastraRuntimeSurface
  serverName: string
  toolName: string
  namespacedToolName: string
  toolCallId: string
  args: unknown
  run: () => MaybePromise<TResult>
}

export class MastraRuntimeReceiptRecorder implements MastraRuntimeReceiptState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: MastraRuntimeReceiptOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private readonly sidecars: MastraRuntimeSidecar[] = []
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(options: MastraRuntimeReceiptOptions = {}) {
    this.privateKey = tryResolvePrivateKey(options.privateKey)
    this.contextId = options.contextId ?? randomContextId()
    this.serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL
    this.now = options.now ?? Date.now
    this.onRecord = options.onRecord

    if (!this.privateKey || options.logSubmission === 'disabled') {
      this.queue = options.submissionQueue
    } else {
      this.queue = options.submissionQueue ?? createSubmissionQueue(options.logEndpoint)
    }
  }

  async toolCall<TResult>(call: MastraRuntimeToolCall<TResult>): Promise<TResult> {
    const argsSnapshot = snapshotCanonical(call.args)
    try {
      const result = await call.run()
      await this.signToolCall(call, argsSnapshot, { status: 'ok', result })
      return result
    } catch (error) {
      await this.signToolCall(call, argsSnapshot, {
        status: 'error',
        error: normalizeError(error),
      })
      throw error
    }
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): MastraRuntimeSidecar[] {
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

  private async signToolCall(
    call: Omit<MastraRuntimeToolCall<unknown>, 'run' | 'args'>,
    argsSnapshot: unknown | undefined,
    outcome: MastraRuntimeOutcome,
  ): Promise<void> {
    const privateKey = this.privateKey
    if (!privateKey || argsSnapshot === undefined) return

    try {
      await this.init()
      const operation = `mastra.${call.surface}.${call.serverName}.${call.toolName}`
      const outcomeSnapshot = snapshotCanonical(outcome)
      if (outcomeSnapshot === undefined) return

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
      }
      const signed = await signRecord(record, privateKey)
      const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
      const sidecar = buildSidecar({
        call,
        operation,
        args: argsSnapshot,
        outcome: outcomeSnapshot as MastraRuntimeOutcome,
        recordHash: `sha256:${recordHashHex}`,
      })
      this.lastRecordHashHex = recordHashHex
      this.records.push(signed)
      this.sidecars.push(sidecar)
      this.queue?.submit(signed, 'normal')
      await this.onRecord?.(signed, sidecar)
    } catch {
      // §5.8: Mastra tool execution must not fail because atrib could not sign.
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

export function resolveMastraRuntimePrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) throw new Error('atrib Mastra recorder: privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib Mastra recorder: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib Mastra recorder: privateKey must decode to 32 bytes')
  }
  return decoded
}

function buildSidecar({
  call,
  operation,
  args,
  outcome,
  recordHash,
}: {
  call: Omit<MastraRuntimeToolCall<unknown>, 'run' | 'args'>
  operation: string
  args: unknown
  outcome: MastraRuntimeOutcome
  recordHash: string
}): MastraRuntimeSidecar {
  const base = {
    framework: 'mastra-runtime' as const,
    surface: call.surface,
    server_name: call.serverName,
    tool_name: call.toolName,
    namespaced_tool_name: call.namespacedToolName,
    operation,
    tool_call_id: call.toolCallId,
    args,
    record_hash: recordHash,
  }
  return outcome.status === 'ok'
    ? { ...base, status: 'ok', result: outcome.result }
    : { ...base, status: 'error', error: outcome.error }
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveMastraRuntimePrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib Mastra recorder: cannot canonicalize value')
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

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}
