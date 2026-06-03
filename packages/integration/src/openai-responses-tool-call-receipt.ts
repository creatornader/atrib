// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import canonicalize from 'canonicalize'
import type { Response, ResponseFunctionToolCall } from 'openai/resources/responses/responses'
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

const DEFAULT_SERVER_URL = 'openai-responses://runtime'
const encoder = new TextEncoder()

export interface OpenAIResponsesToolCallOutcome {
  status: 'completed'
  result: unknown
}

export interface OpenAIResponsesToolCallSidecar {
  framework: 'openai-responses'
  sdk_package: 'openai'
  api: 'responses.create'
  surface: 'tool-call'
  operation: string
  event_type: string
  response_id: string
  previous_response_id?: string
  model: string
  function_name: string
  call_id: string
  item_id?: string
  args: unknown
  record_hash: string
  status: OpenAIResponsesToolCallOutcome['status']
  result: unknown
}

export interface OpenAIResponsesToolCallReceiptOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed OpenAI Responses operations. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks Responses execution. */
  onRecord?: (record: AtribRecord, sidecar: OpenAIResponsesToolCallSidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export interface OpenAIResponsesToolCallReceiptState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): OpenAIResponsesToolCallSidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export interface OpenAIResponsesFunctionToolCall {
  response: Response
  toolCall: ResponseFunctionToolCall
  result: unknown
  previousResponseId?: string
}

export class OpenAIResponsesToolCallReceiptRecorder implements OpenAIResponsesToolCallReceiptState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: OpenAIResponsesToolCallReceiptOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private readonly sidecars: OpenAIResponsesToolCallSidecar[] = []
  private readonly pending = new Set<Promise<void>>()
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(options: OpenAIResponsesToolCallReceiptOptions = {}) {
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

  recordFunctionToolCall(call: OpenAIResponsesFunctionToolCall): void {
    const pending = this.signFunctionToolCall(call)
    this.pending.add(pending)
    pending.finally(() => {
      this.pending.delete(pending)
    })
  }

  async recordFunctionToolCallNow(call: OpenAIResponsesFunctionToolCall): Promise<void> {
    await this.signFunctionToolCall(call)
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): OpenAIResponsesToolCallSidecar[] {
    return [...this.sidecars]
  }

  getLastRecordHash(): string | undefined {
    return this.lastRecordHashHex ? `sha256:${this.lastRecordHashHex}` : undefined
  }

  getProof(recordHash: string): ProofBundle | undefined {
    return this.queue?.getProof(recordHash)
  }

  async flushAtrib(): Promise<void> {
    await Promise.all([...this.pending])
    await this.queue?.flush()
  }

  private async signFunctionToolCall(call: OpenAIResponsesFunctionToolCall): Promise<void> {
    const argsSnapshot = snapshotCanonical(parseJsonMaybe(call.toolCall.arguments))
    const outcomeSnapshot = snapshotCanonical({
      status: 'completed',
      result: call.result,
    }) as OpenAIResponsesToolCallOutcome | undefined
    if (argsSnapshot === undefined || outcomeSnapshot === undefined) return

    const operation = [
      'openai',
      'responses',
      'tool-call',
      normalizeSegment(call.toolCall.name),
    ].join('.')
    await this.signOperation({
      call,
      operation,
      argsSnapshot,
      outcomeSnapshot,
    })
  }

  private async signOperation({
    call,
    operation,
    argsSnapshot,
    outcomeSnapshot,
  }: {
    call: OpenAIResponsesFunctionToolCall
    operation: string
    argsSnapshot: unknown
    outcomeSnapshot: OpenAIResponsesToolCallOutcome
  }): Promise<void> {
    const privateKey = this.privateKey
    if (!privateKey) return

    try {
      await this.init()
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
        outcome: outcomeSnapshot,
        recordHash: `sha256:${recordHashHex}`,
      })
      this.lastRecordHashHex = recordHashHex
      this.records.push(signed)
      this.sidecars.push(sidecar)
      this.queue?.submit(signed, 'normal')
      await this.onRecord?.(signed, sidecar)
    } catch {
      // §5.8: OpenAI Responses execution must not fail because atrib could not sign.
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

export function resolveOpenAIResponsesToolCallPrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32)
      throw new Error('atrib OpenAI Responses recorder: privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib OpenAI Responses recorder: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib OpenAI Responses recorder: privateKey must decode to 32 bytes')
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
  call: OpenAIResponsesFunctionToolCall
  operation: string
  args: unknown
  outcome: OpenAIResponsesToolCallOutcome
  recordHash: string
}): OpenAIResponsesToolCallSidecar {
  const sidecar: OpenAIResponsesToolCallSidecar = {
    framework: 'openai-responses',
    sdk_package: 'openai',
    api: 'responses.create',
    surface: 'tool-call',
    operation,
    event_type: EVENT_TYPE_TOOL_CALL_URI,
    response_id: call.response.id,
    model: call.response.model,
    function_name: call.toolCall.name,
    call_id: call.toolCall.call_id,
    args,
    record_hash: recordHash,
    status: outcome.status,
    result: outcome.result,
  }
  if (call.previousResponseId !== undefined) {
    sidecar.previous_response_id = call.previousResponseId
  }
  if (call.toolCall.id !== undefined) {
    sidecar.item_id = call.toolCall.id
  }
  return sidecar
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveOpenAIResponsesToolCallPrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib OpenAI Responses recorder: cannot canonicalize value')
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

function parseJsonMaybe(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function normalizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'function'
}

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}
