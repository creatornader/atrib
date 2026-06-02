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
import type { Memory as LlamaIndexMemory } from 'llamaindex'

type MaybePromise<T> = T | Promise<T>

export type LlamaIndexMemoryOperationName =
  | 'add'
  | 'get'
  | 'get_llm'
  | 'manage_memory_blocks'
  | 'clear'
  | 'snapshot'

type LlamaIndexMemoryToolName = `llamaindex.memory.${LlamaIndexMemoryOperationName}`

const DEFAULT_SERVER_URL = 'llamaindex://memory'
const encoder = new TextEncoder()

const TOOL_NAMES: Record<LlamaIndexMemoryOperationName, LlamaIndexMemoryToolName> = {
  add: 'llamaindex.memory.add',
  get: 'llamaindex.memory.get',
  get_llm: 'llamaindex.memory.get_llm',
  manage_memory_blocks: 'llamaindex.memory.manage_memory_blocks',
  clear: 'llamaindex.memory.clear',
  snapshot: 'llamaindex.memory.snapshot',
}

export type LlamaIndexMemoryLike = Pick<
  LlamaIndexMemory<Record<string, never>, object>,
  'add' | 'get' | 'getLLM' | 'manageMemoryBlocks' | 'clear' | 'snapshot'
>

export interface AtribLlamaIndexMemoryOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed memory operations. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks callers. */
  onRecord?: (record: AtribRecord, sidecar: AtribLlamaIndexMemorySidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export type AtribLlamaIndexMemorySidecar = {
  operation: LlamaIndexMemoryOperationName
  args: unknown
  record_hash: string
} & (
  | {
      status: 'ok'
      result: unknown
    }
  | {
      status: 'error'
      error: { name: string; message: string }
    }
)

export interface AtribLlamaIndexMemoryState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): AtribLlamaIndexMemorySidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export type AtribLlamaIndexMemory<TMemory extends LlamaIndexMemoryLike> = TMemory &
  AtribLlamaIndexMemoryState

export function attributeLlamaIndexMemory<TMemory extends LlamaIndexMemoryLike>(
  memory: TMemory,
  options: AtribLlamaIndexMemoryOptions = {},
): AtribLlamaIndexMemory<TMemory> {
  return new AtribLlamaIndexMemoryWrapper(
    memory,
    options,
  ) as unknown as AtribLlamaIndexMemory<TMemory>
}

class AtribLlamaIndexMemoryWrapper<
  TMemory extends LlamaIndexMemoryLike,
> implements AtribLlamaIndexMemoryState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly memory: TMemory
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: AtribLlamaIndexMemoryOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private readonly sidecars: AtribLlamaIndexMemorySidecar[] = []
  private readonly pendingSigns = new Set<Promise<void>>()
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(memory: TMemory, options: AtribLlamaIndexMemoryOptions) {
    this.memory = memory
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

  async add(message: unknown): Promise<void> {
    return this.run('add', [message], () => this.memory.add(message))
  }

  async get(options?: unknown): Promise<unknown> {
    const args = options === undefined ? [] : [options]
    return this.run('get', args, () => this.memory.get(options as never))
  }

  async getLLM(llm?: unknown, transientMessages?: unknown): Promise<unknown> {
    const args =
      transientMessages === undefined ? (llm === undefined ? [] : [llm]) : [llm, transientMessages]
    return this.run('get_llm', args, () =>
      this.memory.getLLM(llm as never, transientMessages as never),
    )
  }

  async manageMemoryBlocks(): Promise<void> {
    return this.run('manage_memory_blocks', [], () => this.memory.manageMemoryBlocks())
  }

  async clear(): Promise<void> {
    return this.run('clear', [], () => this.memory.clear())
  }

  snapshot(): string {
    const argsSnapshot = snapshotCanonical([])
    try {
      const result = this.memory.snapshot()
      this.scheduleSign('snapshot', argsSnapshot, { status: 'ok', result })
      return result
    } catch (error) {
      this.scheduleSign('snapshot', argsSnapshot, {
        status: 'error',
        error: normalizeError(error),
      })
      throw error
    }
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): AtribLlamaIndexMemorySidecar[] {
    return [...this.sidecars]
  }

  getLastRecordHash(): string | undefined {
    return this.lastRecordHashHex ? `sha256:${this.lastRecordHashHex}` : undefined
  }

  getProof(recordHash: string): ProofBundle | undefined {
    return this.queue?.getProof(recordHash)
  }

  async flushAtrib(): Promise<void> {
    await Promise.all([...this.pendingSigns])
    await this.queue?.flush()
  }

  private async run<TResult>(
    operation: LlamaIndexMemoryOperationName,
    args: unknown[],
    call: () => MaybePromise<TResult>,
  ): Promise<TResult> {
    const argsSnapshot = snapshotCanonical(args)
    try {
      const result = await call()
      await this.signOperation(operation, argsSnapshot, { status: 'ok', result })
      return result
    } catch (error) {
      await this.signOperation(operation, argsSnapshot, {
        status: 'error',
        error: normalizeError(error),
      })
      throw error
    }
  }

  private scheduleSign(
    operation: LlamaIndexMemoryOperationName,
    argsSnapshot: unknown | undefined,
    outcome:
      | { status: 'ok'; result: unknown }
      | {
          status: 'error'
          error: { name: string; message: string }
        },
  ): void {
    const pending = this.signOperation(operation, argsSnapshot, outcome)
    this.pendingSigns.add(pending)
    void pending.finally(() => {
      this.pendingSigns.delete(pending)
    })
  }

  private async signOperation(
    operation: LlamaIndexMemoryOperationName,
    argsSnapshot: unknown | undefined,
    outcome:
      | { status: 'ok'; result: unknown }
      | {
          status: 'error'
          error: { name: string; message: string }
        },
  ): Promise<void> {
    const privateKey = this.privateKey
    if (!privateKey || argsSnapshot === undefined) return

    try {
      await this.init()
      const toolName = TOOL_NAMES[operation]
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
        args_hash: hashCanonical(argsSnapshot),
        result_hash: hashCanonical(outcome),
        tool_name: toolName,
      }
      const signed = await signRecord(record, privateKey)
      const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
      const sidecar: AtribLlamaIndexMemorySidecar = {
        operation,
        args: argsSnapshot,
        record_hash: `sha256:${recordHashHex}`,
        ...(outcome.status === 'ok' ? { status: 'ok', result: outcome.result } : outcome),
      }
      this.lastRecordHashHex = recordHashHex
      this.records.push(signed)
      this.sidecars.push(sidecar)
      this.queue?.submit(signed, 'normal')
      await this.onRecord?.(signed, sidecar)
    } catch {
      // §5.8: memory operations must not fail because atrib could not sign.
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

export function resolveLlamaIndexMemoryPrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) {
      throw new Error('atrib LlamaIndex memory wrapper: privateKey must be 32 bytes')
    }
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib LlamaIndex memory wrapper: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib LlamaIndex memory wrapper: privateKey must decode to 32 bytes')
  }
  return decoded
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveLlamaIndexMemoryPrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib LlamaIndex memory wrapper: cannot canonicalize value')
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
