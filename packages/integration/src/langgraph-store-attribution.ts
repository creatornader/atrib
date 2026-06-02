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

export type LangGraphStoreOperationName =
  | 'put'
  | 'get'
  | 'search'
  | 'delete'
  | 'batch'
  | 'list_namespaces'

type LangGraphStoreToolName = `langgraph.store.${LangGraphStoreOperationName}`

const DEFAULT_SERVER_URL = 'langgraph://store'
const encoder = new TextEncoder()

const TOOL_NAMES: Record<LangGraphStoreOperationName, LangGraphStoreToolName> = {
  put: 'langgraph.store.put',
  get: 'langgraph.store.get',
  search: 'langgraph.store.search',
  delete: 'langgraph.store.delete',
  batch: 'langgraph.store.batch',
  list_namespaces: 'langgraph.store.list_namespaces',
}

export interface LangGraphSearchOptions {
  filter?: Record<string, unknown>
  limit?: number
  offset?: number
  query?: string
}

export interface LangGraphListNamespacesOptions {
  prefix?: string[]
  suffix?: string[]
  maxDepth?: number
  limit?: number
  offset?: number
}

export interface LangGraphStoreLike {
  put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index?: false | string[],
  ): MaybePromise<void>
  get(namespace: string[], key: string): MaybePromise<unknown>
  search(namespacePrefix: string[], options?: LangGraphSearchOptions): MaybePromise<unknown>
  delete(namespace: string[], key: string): MaybePromise<void>
  batch(operations: readonly unknown[]): MaybePromise<unknown>
  listNamespaces(options?: LangGraphListNamespacesOptions): MaybePromise<string[][]>
  start?(): MaybePromise<void>
  stop?(): MaybePromise<void>
}

export interface AtribLangGraphStoreOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed store operations. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks callers. */
  onRecord?: (record: AtribRecord, sidecar: AtribLangGraphStoreSidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export type AtribLangGraphStoreSidecar = {
  operation: LangGraphStoreOperationName
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

export interface AtribLangGraphStoreState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): AtribLangGraphStoreSidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export type AtribLangGraphStore<TStore extends LangGraphStoreLike> = TStore &
  AtribLangGraphStoreState

export function attributeLangGraphStore<TStore extends LangGraphStoreLike>(
  store: TStore,
  options: AtribLangGraphStoreOptions = {},
): AtribLangGraphStore<TStore> {
  return new AtribLangGraphStoreWrapper(store, options) as unknown as AtribLangGraphStore<TStore>
}

class AtribLangGraphStoreWrapper<
  TStore extends LangGraphStoreLike,
> implements AtribLangGraphStoreState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly store: TStore
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: AtribLangGraphStoreOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private readonly sidecars: AtribLangGraphStoreSidecar[] = []
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(store: TStore, options: AtribLangGraphStoreOptions) {
    this.store = store
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

  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index?: false | string[],
  ): Promise<void> {
    const args = index === undefined ? [namespace, key, value] : [namespace, key, value, index]
    return this.run('put', args, () => this.store.put(namespace, key, value, index))
  }

  async get(namespace: string[], key: string): Promise<unknown> {
    return this.run('get', [namespace, key], () => this.store.get(namespace, key))
  }

  async search(namespacePrefix: string[], options?: LangGraphSearchOptions): Promise<unknown> {
    const args = options === undefined ? [namespacePrefix] : [namespacePrefix, options]
    return this.run('search', args, () => this.store.search(namespacePrefix, options))
  }

  async delete(namespace: string[], key: string): Promise<void> {
    return this.run('delete', [namespace, key], () => this.store.delete(namespace, key))
  }

  async batch(operations: readonly unknown[]): Promise<unknown> {
    return this.run('batch', [operations], () => this.store.batch(operations))
  }

  async listNamespaces(options?: LangGraphListNamespacesOptions): Promise<string[][]> {
    const args = options === undefined ? [] : [options]
    return this.run('list_namespaces', args, () => this.store.listNamespaces(options))
  }

  start(): MaybePromise<void> {
    return this.store.start?.()
  }

  stop(): MaybePromise<void> {
    return this.store.stop?.()
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): AtribLangGraphStoreSidecar[] {
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

  private async run<TResult>(
    operation: LangGraphStoreOperationName,
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

  private async signOperation(
    operation: LangGraphStoreOperationName,
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
      const sidecar: AtribLangGraphStoreSidecar = {
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
      // §5.8: store operations must not fail because atrib could not sign.
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

export function resolveLangGraphStorePrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) {
      throw new Error('atrib LangGraph store wrapper: privateKey must be 32 bytes')
    }
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib LangGraph store wrapper: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib LangGraph store wrapper: privateKey must decode to 32 bytes')
  }
  return decoded
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveLangGraphStorePrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib LangGraph store wrapper: cannot canonicalize value')
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
