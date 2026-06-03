// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import canonicalize from 'canonicalize'
import type { Agent, AgentOutputType, FunctionCallItem, FunctionTool } from '@openai/agents'
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

const DEFAULT_SERVER_URL = 'openai-agents://runtime'
const encoder = new TextEncoder()

export type OpenAIAgentsRuntimeSurface = 'function-tool'

export type OpenAIAgentsRuntimeOutcome = {
  status: 'ok'
  result: unknown
}

export interface OpenAIAgentsRuntimeSidecar {
  framework: 'openai-agents-js'
  surface: OpenAIAgentsRuntimeSurface
  agent_name: string
  tool_name: string
  operation: string
  tool_call_id: string
  args: unknown
  record_hash: string
  status: 'ok'
  result: unknown
}

export interface OpenAIAgentsRuntimeReceiptOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed OpenAI Agents operations. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks agent execution. */
  onRecord?: (record: AtribRecord, sidecar: OpenAIAgentsRuntimeSidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export interface OpenAIAgentsRuntimeReceiptState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): OpenAIAgentsRuntimeSidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export interface OpenAIAgentsRuntimeToolEnd {
  surface: OpenAIAgentsRuntimeSurface
  agentName: string
  toolName: string
  toolCallId: string
  args: unknown
  result: unknown
}

export class OpenAIAgentsRuntimeReceiptRecorder implements OpenAIAgentsRuntimeReceiptState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: OpenAIAgentsRuntimeReceiptOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private readonly sidecars: OpenAIAgentsRuntimeSidecar[] = []
  private readonly pending = new Set<Promise<void>>()
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(options: OpenAIAgentsRuntimeReceiptOptions = {}) {
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

  attachAgent<TContext, TOutput extends AgentOutputType>(
    agent: Agent<TContext, TOutput>,
  ): Agent<TContext, TOutput> {
    agent.on('agent_tool_end', (_context, tool, result, details) => {
      if (tool.type !== 'function' || details.toolCall.type !== 'function_call') return
      const pending = this.signFromToolEnd(agent, tool, result, details.toolCall)
      this.pending.add(pending)
      pending.finally(() => {
        this.pending.delete(pending)
      })
    })
    return agent
  }

  async recordToolEnd(call: OpenAIAgentsRuntimeToolEnd): Promise<void> {
    await this.signToolEnd(call)
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): OpenAIAgentsRuntimeSidecar[] {
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

  private async signFromToolEnd<TContext, TOutput extends AgentOutputType>(
    agent: Agent<TContext, TOutput>,
    tool: FunctionTool<TContext>,
    result: string,
    toolCall: FunctionCallItem,
  ): Promise<void> {
    const args = parseJsonMaybe(toolCall.arguments)
    const output = parseToolResult(result)
    await this.signToolEnd({
      surface: 'function-tool',
      agentName: agent.name,
      toolName: tool.name,
      toolCallId: toolCall.callId,
      args,
      result: output,
    })
  }

  private async signToolEnd(call: OpenAIAgentsRuntimeToolEnd): Promise<void> {
    const privateKey = this.privateKey
    if (!privateKey) return

    const argsSnapshot = snapshotCanonical(call.args)
    const outcomeSnapshot = snapshotCanonical({
      status: 'ok',
      result: call.result,
    }) as OpenAIAgentsRuntimeOutcome | undefined
    if (argsSnapshot === undefined || outcomeSnapshot === undefined) return

    try {
      await this.init()
      const operation = [
        'openai',
        'agents',
        call.surface,
        normalizeSegment(call.agentName),
        call.toolName,
      ].join('.')
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
      // §5.8: OpenAI Agents tool execution must not fail because atrib could not sign.
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

export function resolveOpenAIAgentsRuntimePrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32)
      throw new Error('atrib OpenAI Agents recorder: privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib OpenAI Agents recorder: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib OpenAI Agents recorder: privateKey must decode to 32 bytes')
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
  call: OpenAIAgentsRuntimeToolEnd
  operation: string
  args: unknown
  outcome: OpenAIAgentsRuntimeOutcome
  recordHash: string
}): OpenAIAgentsRuntimeSidecar {
  return {
    framework: 'openai-agents-js',
    surface: call.surface,
    agent_name: call.agentName,
    tool_name: call.toolName,
    operation,
    tool_call_id: call.toolCallId,
    args,
    record_hash: recordHash,
    status: 'ok',
    result: outcome.result,
  }
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveOpenAIAgentsRuntimePrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib OpenAI Agents recorder: cannot canonicalize value')
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

function parseToolResult(result: string): unknown {
  try {
    const parsed = JSON.parse(result) as unknown
    const text = extractTextOutput(parsed)
    return text === undefined ? parsed : parseJsonMaybe(text)
  } catch {
    return result
  }
}

function extractTextOutput(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const maybe = value as { type?: unknown; text?: unknown }
  if (maybe.type === 'text' && typeof maybe.text === 'string') return maybe.text
  return undefined
}

function normalizeSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'agent'
}

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}
