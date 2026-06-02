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
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord, ProofBundle, SubmissionQueue } from '@atrib/mcp'

type MaybePromise<T> = T | Promise<T>

export type BrowserWorkflowActionName = 'observe' | 'click' | 'fill' | 'submit'

export type BrowserWorkflowToolName = `browser.action.${BrowserWorkflowActionName}`

const DEFAULT_SERVER_URL = 'browser-workflow://demo'
const encoder = new TextEncoder()

const TOOL_NAMES: Record<BrowserWorkflowActionName, BrowserWorkflowToolName> = {
  observe: 'browser.action.observe',
  click: 'browser.action.click',
  fill: 'browser.action.fill',
  submit: 'browser.action.submit',
}

export interface BrowserWorkflowReceiptOptions {
  /**
   * 32-byte Ed25519 seed as bytes, base64url, or 64 lowercase hex.
   * When omitted, reads `ATRIB_PRIVATE_KEY`.
   */
  privateKey?: Uint8Array | string
  /** Stable trace id for all signed browser actions. Defaults per process. */
  contextId?: string
  /** Logical producer surface used for content_id derivation. */
  serverUrl?: string
  /** Public log endpoint. Defaults to `https://log.atrib.dev/v1/entries`. */
  logEndpoint?: string
  /** Set to `disabled` for offline tests or local-mirror-only demos. */
  logSubmission?: 'enabled' | 'disabled'
  /** Observe records for local mirrors, tests, or demos. Never blocks actions. */
  onRecord?: (record: AtribRecord, sidecar: BrowserWorkflowSidecar) => MaybePromise<void>
  /** Injected clock for deterministic tests. */
  now?: () => number
  /** Injected queue for advanced hosts. */
  submissionQueue?: SubmissionQueue
}

export type BrowserWorkflowSidecar = {
  framework: 'browser-workflow'
  operation: BrowserWorkflowActionName
  page_url: string
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

export interface BrowserWorkflowReceiptState {
  readonly creatorKey: string
  readonly contextId: string
  getSignedRecords(): AtribRecord[]
  getSidecars(): BrowserWorkflowSidecar[]
  getLastRecordHash(): string | undefined
  getProof(recordHash: string): ProofBundle | undefined
  flushAtrib(): Promise<void>
}

export interface BrowserActionCall<TResult> {
  operation: BrowserWorkflowActionName
  pageUrl: string
  args: unknown
  run: () => MaybePromise<TResult>
}

export class BrowserWorkflowReceiptRecorder implements BrowserWorkflowReceiptState {
  creatorKey = ''
  readonly contextId: string

  private readonly privateKey: Uint8Array | undefined
  private readonly serverUrl: string
  private readonly now: () => number
  private readonly queue: SubmissionQueue | undefined
  private readonly onRecord: BrowserWorkflowReceiptOptions['onRecord'] | undefined
  private readonly records: AtribRecord[] = []
  private readonly sidecars: BrowserWorkflowSidecar[] = []
  private lastRecordHashHex: string | undefined
  private initPromise: Promise<void> | undefined

  constructor(options: BrowserWorkflowReceiptOptions = {}) {
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

  async action<TResult>(call: BrowserActionCall<TResult>): Promise<TResult> {
    const argsSnapshot = snapshotCanonical(call.args)
    try {
      const result = await call.run()
      await this.signAction(call.operation, call.pageUrl, argsSnapshot, {
        status: 'ok',
        result,
      })
      return result
    } catch (error) {
      await this.signAction(call.operation, call.pageUrl, argsSnapshot, {
        status: 'error',
        error: normalizeError(error),
      })
      throw error
    }
  }

  getSignedRecords(): AtribRecord[] {
    return [...this.records]
  }

  getSidecars(): BrowserWorkflowSidecar[] {
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

  private async signAction(
    operation: BrowserWorkflowActionName,
    pageUrl: string,
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
      const sidecar: BrowserWorkflowSidecar = {
        framework: 'browser-workflow',
        operation,
        page_url: pageUrl,
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
      // §5.8: browser or workflow actions must not fail because atrib could not sign.
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

export interface BrowserWorkflowSmokeResult {
  ok: true
  note: string
  context_id: string
  signed_records: number
  operations: BrowserWorkflowToolName[]
  record_hashes: string[]
  final_receipt: {
    status: 'submitted'
    confirmation_id: string
    page_url: string
  }
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

export async function runBrowserWorkflowReceiptSmoke(): Promise<BrowserWorkflowSmokeResult> {
  const privateKey = new Uint8Array(32).fill(23)
  const contextId = '62726f777365722d776f726b666c6f77'
  const privatePhrase = 'private approval note: vendor risk reviewed'
  const pageUrl = 'https://demo.browser-agent.local/vendor-approval'
  const page = new FixtureApprovalPage(pageUrl, privatePhrase)
  const recorder = new BrowserWorkflowReceiptRecorder({
    privateKey,
    contextId,
    logSubmission: 'disabled',
    now: timestampClock(1_779_840_000_000),
  })

  await recorder.action({
    operation: 'observe',
    pageUrl,
    args: {
      page_url: pageUrl,
      dom_snapshot: page.snapshot(),
    },
    run: () => page.observe(),
  })
  await recorder.action({
    operation: 'click',
    pageUrl,
    args: {
      page_url: pageUrl,
      selector: '#approve-vendor',
      visible_label: 'Approve vendor',
    },
    run: () => page.clickApprove(),
  })
  await recorder.action({
    operation: 'fill',
    pageUrl,
    args: {
      page_url: pageUrl,
      selector: '#approval-note',
      value: privatePhrase,
    },
    run: () => page.fillNote(privatePhrase),
  })
  const finalReceipt = await recorder.action({
    operation: 'submit',
    pageUrl,
    args: {
      page_url: pageUrl,
      selector: '#submit-approval',
      form_state: page.formState(),
    },
    run: () => page.submit(),
  })

  await recorder.flushAtrib()
  const records = recorder.getSignedRecords()
  const sidecars = recorder.getSidecars()
  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }
  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked browser form data')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable browser action material')
  }

  return {
    ok: true,
    note: 'Signs a deterministic browser-action workflow as hash-only atrib records while local sidecars keep page and form material.',
    context_id: contextId,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name as BrowserWorkflowToolName),
    record_hashes: records.map((record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`),
    final_receipt: finalReceipt,
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This proof uses a deterministic local page model, not Playwright, Browserbase, or Computer Use.',
      'The next proof should run the same receipt shape against a real browser automation host.',
    ],
  }
}

export function resolveBrowserWorkflowPrivateKey(value?: Uint8Array | string): Uint8Array {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw instanceof Uint8Array) {
    if (raw.length !== 32) {
      throw new Error('atrib browser workflow recorder: privateKey must be 32 bytes')
    }
    return new Uint8Array(raw)
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error('atrib browser workflow recorder: provide privateKey or set ATRIB_PRIVATE_KEY')
  }
  const decoded = /^[0-9a-f]{64}$/.test(raw) ? hexDecode(raw) : base64urlDecode(raw)
  if (decoded.length !== 32) {
    throw new Error('atrib browser workflow recorder: privateKey must decode to 32 bytes')
  }
  return decoded
}

class FixtureApprovalPage {
  private approved = false
  private note = ''

  constructor(
    private readonly pageUrl: string,
    private readonly privatePhrase: string,
  ) {}

  snapshot(): string {
    return [
      '<main data-route="vendor-approval">',
      '<h1>Approve vendor invoice</h1>',
      '<button id="approve-vendor">Approve vendor</button>',
      '<textarea id="approval-note"></textarea>',
      `<aside data-private-note="${this.privatePhrase}">`,
      '</main>',
    ].join('')
  }

  observe(): { title: string; controls: string[]; dom_hash: string } {
    const dom = this.snapshot()
    return {
      title: 'Approve vendor invoice',
      controls: ['#approve-vendor', '#approval-note', '#submit-approval'],
      dom_hash: `sha256:${hexEncode(sha256(encoder.encode(dom)))}`,
    }
  }

  clickApprove(): { button_pressed: string; active_panel: string } {
    this.approved = true
    return { button_pressed: 'approve-vendor', active_panel: 'approval-form' }
  }

  fillNote(value: string): { field: string; value_length: number } {
    if (!this.approved) throw new Error('approval note is disabled until approve is clicked')
    this.note = value
    return { field: 'approval-note', value_length: value.length }
  }

  formState(): { approved: boolean; note: string } {
    return { approved: this.approved, note: this.note }
  }

  submit(): { status: 'submitted'; confirmation_id: string; page_url: string } {
    if (!this.approved || this.note.length === 0) {
      throw new Error('approval form is incomplete')
    }
    return {
      status: 'submitted',
      confirmation_id: 'browser-workflow-receipt-001',
      page_url: this.pageUrl,
    }
  }
}

function tryResolvePrivateKey(value?: Uint8Array | string): Uint8Array | undefined {
  const raw = value ?? (typeof process !== 'undefined' ? process.env.ATRIB_PRIVATE_KEY : undefined)
  if (raw === undefined || raw === '') return undefined
  try {
    return resolveBrowserWorkflowPrivateKey(raw)
  } catch {
    return undefined
  }
}

function hashCanonical(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib browser workflow recorder: cannot canonicalize value')
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

function timestampClock(start: number): () => number {
  let offset = 0
  return () => start + offset++
}
