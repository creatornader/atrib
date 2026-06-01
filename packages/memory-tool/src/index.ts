// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import canonicalize from 'canonicalize'
import type { MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory'
import type {
  BetaMemoryTool20250818Command,
  BetaToolResultContentBlockParam,
} from '@anthropic-ai/sdk/resources/beta'
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

type MemoryCommandName = BetaMemoryTool20250818Command['command']
type MemoryCommandFor<K extends MemoryCommandName> = Extract<
  BetaMemoryTool20250818Command,
  { command: K }
>
type MemoryToolResult = string | Array<BetaToolResultContentBlockParam>
type MaybePromise<T> = T | Promise<T>

const DEFAULT_SERVER_URL = 'anthropic://memory-tool'
const encoder = new TextEncoder()

const MUTATING_COMMANDS = new Set<MemoryCommandName>([
  'create',
  'str_replace',
  'insert',
  'delete',
  'rename',
])

export interface AtribMemoryToolOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed memory commands. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only hosts. */
  logSubmission?: 'enabled' | 'disabled'
  /** Sign read-only `view` commands. Defaults to false. */
  signReads?: boolean
  /** Observe records for local mirrors, tests, or demos. Never blocks callers. */
  onRecord?: (record: AtribRecord, sidecar: AtribMemorySidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export interface AtribMemorySidecar {
  command: BetaMemoryTool20250818Command
  status: 'ok' | 'error'
  result?: MemoryToolResult
  error?: { name: string; message: string }
  record_hash: string
}

export interface AtribMemoryToolState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export type AtribMemoryToolHandlers = MemoryToolHandlers & AtribMemoryToolState

export function attributeMemoryTool(
  handlers: MemoryToolHandlers,
  options: AtribMemoryToolOptions = {},
): AtribMemoryToolHandlers {
  return new AtribMemoryTool(handlers, options)
}

export class AtribMemoryTool implements AtribMemoryToolHandlers {
  creatorKey: string
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly handlers: MemoryToolHandlers
  private readonly serverUrl: string
  private readonly signReads: boolean
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: AtribMemoryToolOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private lastRecordHashHex: string | undefined

  constructor(handlers: MemoryToolHandlers, options: AtribMemoryToolOptions = {}) {
    this.handlers = handlers
    this.privateKey = tryResolvePrivateKey(options.privateKey)
    this.creatorKey = ''
    this.contextId = options.contextId ?? randomContextId()
    this.serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL
    this.signReads = options.signReads ?? false
    this.now = options.now ?? Date.now
    this.onRecord = options.onRecord

    if (!this.privateKey || options.logSubmission === 'disabled') {
      this.queue = options.submissionQueue
    } else {
      this.queue = options.submissionQueue ?? createSubmissionQueue(options.logEndpoint)
    }
  }

  async init(): Promise<this> {
    if (this.privateKey) {
      this.creatorKey = base64urlEncode(await getPublicKey(this.privateKey))
    }
    return this
  }

  view(command: MemoryCommandFor<'view'>): Promise<MemoryToolResult> {
    return this.run('view', command, (cmd) => this.handlers.view(cmd))
  }

  create(command: MemoryCommandFor<'create'>): Promise<MemoryToolResult> {
    return this.run('create', command, (cmd) => this.handlers.create(cmd))
  }

  str_replace(command: MemoryCommandFor<'str_replace'>): Promise<MemoryToolResult> {
    return this.run('str_replace', command, (cmd) => this.handlers.str_replace(cmd))
  }

  insert(command: MemoryCommandFor<'insert'>): Promise<MemoryToolResult> {
    return this.run('insert', command, (cmd) => this.handlers.insert(cmd))
  }

  delete(command: MemoryCommandFor<'delete'>): Promise<MemoryToolResult> {
    return this.run('delete', command, (cmd) => this.handlers.delete(cmd))
  }

  rename(command: MemoryCommandFor<'rename'>): Promise<MemoryToolResult> {
    return this.run('rename', command, (cmd) => this.handlers.rename(cmd))
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
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

  private async run<K extends MemoryCommandName>(
    name: K,
    command: MemoryCommandFor<K>,
    handler: (command: MemoryCommandFor<K>) => MaybePromise<MemoryToolResult>,
  ): Promise<MemoryToolResult> {
    try {
      const result = await handler(command)
      await this.signCommand(name, command, { status: 'ok', result })
      return result
    } catch (error) {
      await this.signCommand(name, command, {
        status: 'error',
        error: normalizeError(error),
      })
      throw error
    }
  }

  private async signCommand(
    name: MemoryCommandName,
    command: BetaMemoryTool20250818Command,
    outcome:
      | { status: 'ok'; result: MemoryToolResult }
      | {
          status: 'error'
          error: { name: string; message: string }
        },
  ): Promise<void> {
    const privateKey = this.privateKey
    if (!privateKey || !this.shouldSign(name)) return

    try {
      if (!this.creatorKey) await this.init()
      const toolName = `anthropic.memory.${name}`
      const record: AtribRecord = {
        spec_version: 'atrib/1.0',
        content_id: computeContentId(this.serverUrl, toolName),
        creator_key: this.creatorKey,
        chain_root: resolveChainRoot({
          contextId: this.contextId,
          autoChainTailHex: this.lastRecordHashHex,
        }),
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        context_id: this.contextId,
        timestamp: this.now(),
        signature: '',
        args_hash: hashCanonical(command),
        result_hash: hashCanonical(outcome),
        tool_name: toolName,
      }
      const signed = await signRecord(record, privateKey)
      const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
      this.lastRecordHashHex = recordHashHex
      this.records.push(signed)
      this.queue?.submit(signed, 'normal')
      const sidecar: AtribMemorySidecar = {
        command,
        status: outcome.status,
        record_hash: `sha256:${recordHashHex}`,
        ...(outcome.status === 'ok' ? { result: outcome.result } : { error: outcome.error }),
      }
      await this.onRecord?.(signed, sidecar)
    } catch {
      // §5.8: memory operations must not fail because atrib could not sign.
    }
  }

  private shouldSign(name: MemoryCommandName): boolean {
    return this.privateKey !== undefined && (this.signReads || MUTATING_COMMANDS.has(name))
  }
}

export async function createAtribMemoryTool(
  handlers: MemoryToolHandlers,
  options: AtribMemoryToolOptions = {},
): Promise<AtribMemoryToolHandlers> {
  return new AtribMemoryTool(handlers, options).init()
}

export function resolvePrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) throw new Error('atrib memory tool: privateKey must be 32 bytes')
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      'atrib memory tool: provide privateKey or set ATRIB_PRIVATE_KEY to a 32-byte seed',
    )
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib memory tool: privateKey must decode to 32 bytes')
  }
  return decoded
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolvePrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib memory tool: cannot canonicalize value')
  }
  return `sha256:${hexEncode(sha256(encoder.encode(json)))}`
}

function randomContextId(): string {
  return randomBytes(16).toString('hex')
}

function normalizeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message }
  return { name: 'Error', message: String(error) }
}
