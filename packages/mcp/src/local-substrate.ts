// SPDX-License-Identifier: Apache-2.0

/**
 * P042 local substrate coordinator contract helpers.
 *
 * These helpers do not implement a coordinator. They single-source the
 * adapter/coordinator boundary that startup-spawn MCP wrappers, long-lived
 * agents, and watcher WAL pipelines can target before any default runtime
 * path changes.
 */

import canonicalize from 'canonicalize'
import { base64urlDecode, base64urlEncode } from './base64url.js'
import { canonicalRecord } from './canon.js'
import { hexEncode, sha256 } from './hash.js'
import { getPublicKey, signRecord } from './signing.js'
import { createSubmissionQueue } from './submission.js'
import { encodeToken } from './token.js'
import { EVENT_TYPE_TRANSACTION_URI } from './types.js'
import { zeroize } from './zeroize.js'
import type { AtribRecord, UnsignedAtribRecord } from './types.js'
import type { ArchiveSubmissionOptions, ProofBundle, SubmissionQueue } from './submission.js'

export const LOCAL_SUBSTRATE_REQUEST_SCHEMA = 'atrib.local-substrate-coordinator.request.v0'
export const LOCAL_SUBSTRATE_RESPONSE_SCHEMA = 'atrib.local-substrate-coordinator.response.v0'
export const LOCAL_SUBSTRATE_HEALTH_SCHEMA = 'atrib.local-substrate-coordinator.health.v0'
export const LOCAL_SUBSTRATE_HTTP_DEFAULT_PATH = '/atrib/local-substrate'
export const LOCAL_SUBSTRATE_HTTP_DEFAULT_HEALTH_PATH = '/atrib/local-substrate/health'
export const LOCAL_SUBSTRATE_DEFAULT_TIMEOUT_MS = 1500
export const LOCAL_SUBSTRATE_HEALTH_ACTIVE_CONTEXT_LIMIT = 25

export const LOCAL_SUBSTRATE_HARNESS_CLASSES = [
  'startup-spawn',
  'long-lived-agent',
  'watcher-wal',
] as const

export type LocalSubstrateHarnessClass = (typeof LOCAL_SUBSTRATE_HARNESS_CLASSES)[number]

export const LOCAL_SUBSTRATE_OPERATIONS = [
  'sign_record',
  'enqueue_record_and_join_receipt',
] as const

export type LocalSubstrateOperation = (typeof LOCAL_SUBSTRATE_OPERATIONS)[number]

export const LOCAL_SUBSTRATE_REQUEST_MODES = ['commit', 'shadow_probe'] as const

export type LocalSubstrateRequestMode = (typeof LOCAL_SUBSTRATE_REQUEST_MODES)[number]

export const LOCAL_SUBSTRATE_RESPONSE_STATUSES = ['accepted', 'rejected'] as const

export type LocalSubstrateResponseStatus = (typeof LOCAL_SUBSTRATE_RESPONSE_STATUSES)[number]

export const LOCAL_SUBSTRATE_CREATOR_KEY_POLICIES = [
  'implicit-single-creator',
  'explicit-single-creator',
  'explicit-watcher-creator',
  'explicit-signer-selection',
] as const

export type LocalSubstrateCreatorKeyPolicy = (typeof LOCAL_SUBSTRATE_CREATOR_KEY_POLICIES)[number]

export interface LocalSubstrateProducer {
  name: string
  harness_class: LocalSubstrateHarnessClass
  pid?: number
  transport?: string
  creator_key_policy?: LocalSubstrateCreatorKeyPolicy
}

export interface LocalSubstrateContext {
  source: string
  context_id: string
  chain_tail?: string
  parent_record_hash?: string
  join_back_target?: string
}

export interface LocalSubstrateDegradationPolicy {
  if_unavailable: string
  primary_path_blocking: false
}

export interface LocalSubstrateWalJoin {
  entry_id: string
  source_path: string
  receipt_join_field: string
}

export interface LocalSubstrateCoordinatorRequest {
  schema: typeof LOCAL_SUBSTRATE_REQUEST_SCHEMA
  operation: LocalSubstrateOperation
  /**
   * `commit` lets the coordinator own its configured side effects. `shadow_probe`
   * asks it to validate and sign the exact body, then return the hash without
   * queueing or mirroring so a direct producer can keep owning the hot path.
   * Absence preserves the original commit behavior.
   */
  mode?: LocalSubstrateRequestMode
  producer: LocalSubstrateProducer
  context?: LocalSubstrateContext
  record_body: UnsignedAtribRecord
  wal?: LocalSubstrateWalJoin
  degradation: LocalSubstrateDegradationPolicy
}

export interface LocalSubstrateHealthReport {
  schema: typeof LOCAL_SUBSTRATE_HEALTH_SCHEMA
  coordinator: {
    pid: number
    version: string
    transport: string
    creator_key_scope?: string
  }
  queues: {
    log_submission_depth: number
    archive_submission_depth?: number
  }
  wal: {
    pending: number
    joined?: number
    orphan_receipts: number
  }
  contexts: {
    active: string[]
    active_count?: number
    active_truncated?: boolean
  }
  processes: {
    active_wrappers?: number
    stale_children: number
  }
}

export interface LocalSubstrateCoordinatorResponse {
  schema: typeof LOCAL_SUBSTRATE_RESPONSE_SCHEMA
  operation: LocalSubstrateOperation
  status: LocalSubstrateResponseStatus
  record_hash?: string
  receipt_id?: string
  rejection_reason?: string
  warnings?: string[]
  health_report?: LocalSubstrateHealthReport
}

export interface LocalSubstrateValidationIssue {
  path: string
  message: string
}

export interface LocalSubstrateValidationResult {
  ok: boolean
  issues: LocalSubstrateValidationIssue[]
}

export interface ValidateLocalSubstrateRequestOptions {
  expectedHarnessClass?: LocalSubstrateHarnessClass
  directRecordBody?: UnsignedAtribRecord
}

export interface ValidateLocalSubstrateResponseOptions {
  request?: LocalSubstrateCoordinatorRequest
}

export interface LocalSubstrateTransportOptions {
  timeoutMs: number
  signal?: AbortSignal
}

export type LocalSubstrateCoordinatorTransport = (
  request: LocalSubstrateCoordinatorRequest,
  options: LocalSubstrateTransportOptions,
) => Promise<unknown>

export interface TryLocalSubstrateCoordinatorOptions extends ValidateLocalSubstrateRequestOptions {
  transport: LocalSubstrateCoordinatorTransport
  timeoutMs?: number
  now?: () => number
}

export type TryLocalSubstrateCoordinatorResult =
  | {
      ok: true
      status: 'accepted'
      response: LocalSubstrateCoordinatorResponse
      elapsed_ms: number
    }
  | {
      ok: false
      status: 'invalid_request'
      issues: LocalSubstrateValidationIssue[]
      elapsed_ms: number
    }
  | {
      ok: false
      status: 'invalid_response'
      issues: LocalSubstrateValidationIssue[]
      raw_response: unknown
      elapsed_ms: number
    }
  | {
      ok: false
      status: 'rejected'
      response: LocalSubstrateCoordinatorResponse
      reason?: string
      elapsed_ms: number
    }
  | {
      ok: false
      status: 'unavailable'
      reason: string
      elapsed_ms: number
    }

export interface CreateHttpLocalSubstrateTransportOptions {
  fetch?: typeof fetch
  headers?: Record<string, string>
}

export interface LocalSubstrateCoordinatorService {
  transport: LocalSubstrateCoordinatorTransport
  health: () => LocalSubstrateHealthProbeResult
}

export interface LocalSubstrateCoordinatorHttpOptions {
  endpointPath?: string
  healthPath?: string
  timeoutMs?: number
}

export interface LocalSubstrateCoordinatorHttpResult {
  status: number
  headers: Record<string, string>
  body: string
}

export interface BuildLocalSubstrateHealthReportInput {
  coordinator: {
    pid: number
    version: string
    transport: string
    creatorKeyScope?: string
  }
  queues?: {
    logSubmissionDepth?: number
    archiveSubmissionDepth?: number
  }
  wal?: {
    pending?: number
    joined?: number
    orphanReceipts?: number
  }
  activeContextIds?: readonly string[]
  activeWrapperPids?: readonly number[]
  staleChildPids?: readonly number[]
  activeWrappers?: number
  staleChildren?: number
}

export interface LocalSubstrateHealthProbeResult {
  ok: boolean
  status: 'healthy' | 'degraded' | 'invalid'
  report: LocalSubstrateHealthReport
  issues: LocalSubstrateValidationIssue[]
  warnings: string[]
}

export interface LocalSubstrateCoordinatorRecordContext {
  request: LocalSubstrateCoordinatorRequest
  record_hash: string
  receipt_id: string
}

export type LocalSubstrateCoordinatorRecordObserver = (
  record: AtribRecord,
  context: LocalSubstrateCoordinatorRecordContext,
) => void | Promise<void>

export type LocalSubstrateHealthValue<T> = T | (() => T)

export interface InProcessLocalSubstrateCoordinatorHealthOptions {
  pid?: number
  version?: string
  transport?: string
  creatorKeyScope?: string
  logSubmissionDepth?: LocalSubstrateHealthValue<number>
  archiveSubmissionDepth?: LocalSubstrateHealthValue<number | undefined>
  walPending?: LocalSubstrateHealthValue<number>
  walJoined?: LocalSubstrateHealthValue<number | undefined>
  walOrphanReceipts?: LocalSubstrateHealthValue<number>
  activeContextIds?: LocalSubstrateHealthValue<readonly string[]>
  activeWrapperPids?: LocalSubstrateHealthValue<readonly number[] | undefined>
  staleChildPids?: LocalSubstrateHealthValue<readonly number[] | undefined>
  activeWrappers?: LocalSubstrateHealthValue<number | undefined>
  staleChildren?: LocalSubstrateHealthValue<number | undefined>
}

export interface CreateInProcessLocalSubstrateCoordinatorOptions {
  creatorKey: string
  supportedHarnessClasses?: readonly LocalSubstrateHarnessClass[]
  logEndpoint?: string
  logSubmission?: 'enabled' | 'disabled'
  archiveSubmission?: ArchiveSubmissionOptions
  maxQueueDepth?: number
  onRecord?: LocalSubstrateCoordinatorRecordObserver
  health?: InProcessLocalSubstrateCoordinatorHealthOptions
}

export interface InProcessLocalSubstrateCoordinator {
  transport: LocalSubstrateCoordinatorTransport
  health: () => LocalSubstrateHealthProbeResult
  flush: () => Promise<void>
  getProof: (recordHash: string) => ProofBundle | undefined
  destroy: () => void
}

export interface LocalSubstrateFixture {
  name: string
  harness_class: LocalSubstrateHarnessClass
  input: {
    coordinator_request: LocalSubstrateCoordinatorRequest
    direct_record_body: UnsignedAtribRecord
    health_report: LocalSubstrateHealthReport
  }
  expected: {
    record_bytes_unchanged: true
    canonical_record_body_sha256: string
    fallback_required: true
  }
}

export interface ValidateLocalSubstrateFixtureOptions {
  expectedName?: string
  expectedHarnessClass?: LocalSubstrateHarnessClass
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/
const CONTEXT_ID_RE = /^[0-9a-f]{32}$/

const harnessClasses = new Set<string>(LOCAL_SUBSTRATE_HARNESS_CLASSES)
const operations = new Set<string>(LOCAL_SUBSTRATE_OPERATIONS)
const inProcessSupportedOperations = new Set<LocalSubstrateOperation>(LOCAL_SUBSTRATE_OPERATIONS)
const requestModes = new Set<string>(LOCAL_SUBSTRATE_REQUEST_MODES)
const responseStatuses = new Set<string>(LOCAL_SUBSTRATE_RESPONSE_STATUSES)
const creatorKeyPolicies = new Set<string>(LOCAL_SUBSTRATE_CREATOR_KEY_POLICIES)

const encoder = new TextEncoder()

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function push(issues: LocalSubstrateValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function canonicalJson(value: unknown): string {
  const json = canonicalize(value)
  if (json === undefined) {
    throw new Error('atrib: local-substrate canonicalization produced undefined')
  }
  return json
}

export function canonicalLocalSubstrateRecordBody(recordBody: UnsignedAtribRecord): Uint8Array {
  return encoder.encode(canonicalJson(recordBody))
}

export function hashLocalSubstrateRecordBody(recordBody: UnsignedAtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalLocalSubstrateRecordBody(recordBody)))}`
}

export function localSubstrateRecordBodiesEqual(
  a: UnsignedAtribRecord,
  b: UnsignedAtribRecord,
): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

function validateUnsignedRecordBody(
  value: unknown,
  path: string,
  issues: LocalSubstrateValidationIssue[],
): value is UnsignedAtribRecord {
  if (!isObject(value)) {
    push(issues, path, 'record_body must be an object')
    return false
  }

  if ('signature' in value) {
    push(issues, `${path}.signature`, 'record_body must be unsigned')
  }
  if (value.spec_version !== 'atrib/1.0') {
    push(issues, `${path}.spec_version`, 'must be atrib/1.0')
  }
  if (!isNonEmptyString(value.content_id) || !HASH_RE.test(value.content_id)) {
    push(issues, `${path}.content_id`, 'must be sha256:<64-lowerhex>')
  }
  if (!isNonEmptyString(value.chain_root) || !HASH_RE.test(value.chain_root)) {
    push(issues, `${path}.chain_root`, 'must be sha256:<64-lowerhex>')
  }
  if (!isNonEmptyString(value.creator_key)) {
    push(issues, `${path}.creator_key`, 'must be a non-empty string')
  }
  if (!isNonEmptyString(value.event_type) || !/^https?:\/\//.test(value.event_type)) {
    push(issues, `${path}.event_type`, 'must be an absolute URI')
  }
  if (!isNonEmptyString(value.context_id) || !CONTEXT_ID_RE.test(value.context_id)) {
    push(issues, `${path}.context_id`, 'must be 32 lowercase hex characters')
  }
  if (!isNonNegativeInteger(value.timestamp)) {
    push(issues, `${path}.timestamp`, 'must be a non-negative integer')
  }
  if (
    value.informed_by !== undefined &&
    (!Array.isArray(value.informed_by) ||
      value.informed_by.some((ref) => typeof ref !== 'string' || !HASH_RE.test(ref)))
  ) {
    push(issues, `${path}.informed_by`, 'must contain only sha256:<64-lowerhex> refs')
  }
  if (
    value.annotates !== undefined &&
    (typeof value.annotates !== 'string' || !HASH_RE.test(value.annotates))
  ) {
    push(issues, `${path}.annotates`, 'must be sha256:<64-lowerhex>')
  }
  if (
    value.revises !== undefined &&
    (typeof value.revises !== 'string' || !HASH_RE.test(value.revises))
  ) {
    push(issues, `${path}.revises`, 'must be sha256:<64-lowerhex>')
  }

  return issues.every((issue) => !issue.path.startsWith(path))
}

export function validateLocalSubstrateRequest(
  request: unknown,
  options: ValidateLocalSubstrateRequestOptions = {},
): LocalSubstrateValidationResult {
  const issues: LocalSubstrateValidationIssue[] = []

  if (!isObject(request)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'request must be an object' }],
    }
  }

  if (request.schema !== LOCAL_SUBSTRATE_REQUEST_SCHEMA) {
    push(issues, 'schema', `must be ${LOCAL_SUBSTRATE_REQUEST_SCHEMA}`)
  }
  if (typeof request.operation !== 'string' || !operations.has(request.operation)) {
    push(issues, 'operation', `must be one of ${LOCAL_SUBSTRATE_OPERATIONS.join(', ')}`)
  }
  if (
    request.mode !== undefined &&
    (typeof request.mode !== 'string' || !requestModes.has(request.mode))
  ) {
    push(issues, 'mode', `must be one of ${LOCAL_SUBSTRATE_REQUEST_MODES.join(', ')}`)
  }
  if (request.mode === 'shadow_probe' && request.operation !== 'sign_record') {
    push(issues, 'mode', 'shadow_probe is only valid for sign_record requests')
  }

  const producer = request.producer
  if (!isObject(producer)) {
    push(issues, 'producer', 'must be an object')
  } else {
    if (!isNonEmptyString(producer.name)) {
      push(issues, 'producer.name', 'must be a non-empty string')
    }
    if (typeof producer.harness_class !== 'string' || !harnessClasses.has(producer.harness_class)) {
      push(
        issues,
        'producer.harness_class',
        `must be one of ${LOCAL_SUBSTRATE_HARNESS_CLASSES.join(', ')}`,
      )
    }
    if (
      options.expectedHarnessClass !== undefined &&
      producer.harness_class !== options.expectedHarnessClass
    ) {
      push(issues, 'producer.harness_class', 'must match expected harness class')
    }
    if (producer.pid !== undefined && !isNonNegativeInteger(producer.pid)) {
      push(issues, 'producer.pid', 'must be a non-negative integer')
    }
    if (producer.transport !== undefined && !isNonEmptyString(producer.transport)) {
      push(issues, 'producer.transport', 'must be a non-empty string when present')
    }
    if (
      producer.creator_key_policy !== undefined &&
      (typeof producer.creator_key_policy !== 'string' ||
        !creatorKeyPolicies.has(producer.creator_key_policy))
    ) {
      push(
        issues,
        'producer.creator_key_policy',
        `must be one of ${LOCAL_SUBSTRATE_CREATOR_KEY_POLICIES.join(', ')}`,
      )
    }
  }

  const context = request.context
  if (context !== undefined) {
    if (!isObject(context)) {
      push(issues, 'context', 'must be an object when present')
    } else {
      if (!isNonEmptyString(context.source)) {
        push(issues, 'context.source', 'must be a non-empty string')
      }
      if (!isNonEmptyString(context.context_id) || !CONTEXT_ID_RE.test(context.context_id)) {
        push(issues, 'context.context_id', 'must be 32 lowercase hex characters')
      }
      for (const field of ['chain_tail', 'parent_record_hash'] as const) {
        const value = context[field]
        if (value !== undefined && (typeof value !== 'string' || !HASH_RE.test(value))) {
          push(issues, `context.${field}`, 'must be sha256:<64-lowerhex> when present')
        }
      }
      if (context.join_back_target !== undefined && !isNonEmptyString(context.join_back_target)) {
        push(issues, 'context.join_back_target', 'must be a non-empty string when present')
      }
    }
  }

  const bodyIsValid = validateUnsignedRecordBody(request.record_body, 'record_body', issues)

  const degradation = request.degradation
  if (!isObject(degradation)) {
    push(issues, 'degradation', 'must be an object')
  } else {
    if (!isNonEmptyString(degradation.if_unavailable)) {
      push(issues, 'degradation.if_unavailable', 'must describe fallback behavior')
    }
    if (degradation.primary_path_blocking !== false) {
      push(issues, 'degradation.primary_path_blocking', 'must be false')
    }
  }

  if (bodyIsValid && options.directRecordBody !== undefined) {
    if (
      !localSubstrateRecordBodiesEqual(
        request.record_body as UnsignedAtribRecord,
        options.directRecordBody,
      )
    ) {
      push(issues, 'record_body', 'must equal the direct producer body')
    }
  }

  if (bodyIsValid && isObject(context)) {
    const recordBody = request.record_body as UnsignedAtribRecord
    if (
      typeof context.context_id === 'string' &&
      CONTEXT_ID_RE.test(context.context_id) &&
      context.context_id !== recordBody.context_id
    ) {
      push(issues, 'context.context_id', 'must match record_body.context_id')
    }
    if (
      typeof context.chain_tail === 'string' &&
      HASH_RE.test(context.chain_tail) &&
      context.chain_tail !== recordBody.chain_root
    ) {
      push(issues, 'context.chain_tail', 'must match record_body.chain_root')
    }
    if (
      typeof context.parent_record_hash === 'string' &&
      HASH_RE.test(context.parent_record_hash) &&
      !recordBody.informed_by?.includes(context.parent_record_hash)
    ) {
      push(issues, 'context.parent_record_hash', 'must be present in record_body.informed_by')
    }
  }

  const harnessClass = isObject(producer) ? producer.harness_class : undefined
  const operation = request.operation
  if (harnessClass === 'watcher-wal') {
    if (operation !== 'enqueue_record_and_join_receipt') {
      push(issues, 'operation', 'watcher-wal requests must enqueue and join receipts')
    }
    if (!isObject(context) || !isNonEmptyString(context.join_back_target)) {
      push(
        issues,
        'context.join_back_target',
        'watcher-wal requests must name a receipt join-back target',
      )
    }
    if (!isObject(request.wal)) {
      push(issues, 'wal', 'watcher-wal requests must include WAL join metadata')
    } else {
      for (const field of ['entry_id', 'source_path', 'receipt_join_field'] as const) {
        if (!isNonEmptyString(request.wal[field])) {
          push(issues, `wal.${field}`, 'must be a non-empty string')
        }
      }
    }
  } else if (harnessClass === 'startup-spawn' || harnessClass === 'long-lived-agent') {
    if (operation !== 'sign_record') {
      push(issues, 'operation', `${harnessClass} requests must use sign_record`)
    }
    if (request.wal !== undefined) {
      push(issues, 'wal', `${harnessClass} requests must not include WAL join metadata`)
    }
  }

  return { ok: issues.length === 0, issues }
}

function requireHealthPath(
  value: unknown,
  path: string,
  issues: LocalSubstrateValidationIssue[],
  predicate: (v: unknown) => boolean,
  message: string,
): void {
  if (!predicate(value)) push(issues, path, message)
}

export function validateLocalSubstrateHealthReport(
  report: unknown,
): LocalSubstrateValidationResult {
  const issues: LocalSubstrateValidationIssue[] = []

  if (!isObject(report)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'health report must be an object' }],
    }
  }

  if (report.schema !== LOCAL_SUBSTRATE_HEALTH_SCHEMA) {
    push(issues, 'schema', `must be ${LOCAL_SUBSTRATE_HEALTH_SCHEMA}`)
  }

  const coordinator = isObject(report.coordinator) ? report.coordinator : {}
  if (!isObject(report.coordinator)) push(issues, 'coordinator', 'must be an object')
  requireHealthPath(
    coordinator.pid,
    'coordinator.pid',
    issues,
    isNonNegativeInteger,
    'must be a non-negative integer',
  )
  requireHealthPath(
    coordinator.version,
    'coordinator.version',
    issues,
    isNonEmptyString,
    'must be a non-empty string',
  )
  requireHealthPath(
    coordinator.transport,
    'coordinator.transport',
    issues,
    isNonEmptyString,
    'must be a non-empty string',
  )
  if (
    coordinator.creator_key_scope !== undefined &&
    !isNonEmptyString(coordinator.creator_key_scope)
  ) {
    push(issues, 'coordinator.creator_key_scope', 'must be a non-empty string when present')
  }

  const queues = isObject(report.queues) ? report.queues : {}
  if (!isObject(report.queues)) push(issues, 'queues', 'must be an object')
  requireHealthPath(
    queues.log_submission_depth,
    'queues.log_submission_depth',
    issues,
    isNonNegativeInteger,
    'must be a non-negative integer',
  )
  if (
    queues.archive_submission_depth !== undefined &&
    !isNonNegativeInteger(queues.archive_submission_depth)
  ) {
    push(issues, 'queues.archive_submission_depth', 'must be a non-negative integer when present')
  }

  const wal = isObject(report.wal) ? report.wal : {}
  if (!isObject(report.wal)) push(issues, 'wal', 'must be an object')
  requireHealthPath(
    wal.pending,
    'wal.pending',
    issues,
    isNonNegativeInteger,
    'must be a non-negative integer',
  )
  requireHealthPath(
    wal.orphan_receipts,
    'wal.orphan_receipts',
    issues,
    isNonNegativeInteger,
    'must be a non-negative integer',
  )
  if (wal.joined !== undefined && !isNonNegativeInteger(wal.joined)) {
    push(issues, 'wal.joined', 'must be a non-negative integer when present')
  }

  const contexts = isObject(report.contexts) ? report.contexts : {}
  if (!isObject(report.contexts)) push(issues, 'contexts', 'must be an object')
  if (
    !Array.isArray(contexts.active) ||
    contexts.active.some((value) => typeof value !== 'string' || !CONTEXT_ID_RE.test(value))
  ) {
    push(issues, 'contexts.active', 'must contain 32-lowerhex context ids')
  }
  if (contexts.active_count !== undefined && !isNonNegativeInteger(contexts.active_count)) {
    push(issues, 'contexts.active_count', 'must be a non-negative integer when present')
  }
  if (contexts.active_truncated !== undefined && typeof contexts.active_truncated !== 'boolean') {
    push(issues, 'contexts.active_truncated', 'must be a boolean when present')
  }

  const processes = isObject(report.processes) ? report.processes : {}
  if (!isObject(report.processes)) push(issues, 'processes', 'must be an object')
  requireHealthPath(
    processes.stale_children,
    'processes.stale_children',
    issues,
    isNonNegativeInteger,
    'must be a non-negative integer',
  )
  if (processes.active_wrappers !== undefined && !isNonNegativeInteger(processes.active_wrappers)) {
    push(issues, 'processes.active_wrappers', 'must be a non-negative integer when present')
  }

  return { ok: issues.length === 0, issues }
}

export function validateLocalSubstrateResponse(
  response: unknown,
  options: ValidateLocalSubstrateResponseOptions = {},
): LocalSubstrateValidationResult {
  const issues: LocalSubstrateValidationIssue[] = []

  if (!isObject(response)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'response must be an object' }],
    }
  }

  if (response.schema !== LOCAL_SUBSTRATE_RESPONSE_SCHEMA) {
    push(issues, 'schema', `must be ${LOCAL_SUBSTRATE_RESPONSE_SCHEMA}`)
  }
  if (typeof response.operation !== 'string' || !operations.has(response.operation)) {
    push(issues, 'operation', `must be one of ${LOCAL_SUBSTRATE_OPERATIONS.join(', ')}`)
  }
  if (options.request !== undefined && response.operation !== options.request.operation) {
    push(issues, 'operation', 'must match request.operation')
  }
  if (typeof response.status !== 'string' || !responseStatuses.has(response.status)) {
    push(issues, 'status', `must be one of ${LOCAL_SUBSTRATE_RESPONSE_STATUSES.join(', ')}`)
  }
  if (
    response.record_hash !== undefined &&
    (typeof response.record_hash !== 'string' || !HASH_RE.test(response.record_hash))
  ) {
    push(issues, 'record_hash', 'must be sha256:<64-lowerhex> when present')
  }
  if (response.receipt_id !== undefined && !isNonEmptyString(response.receipt_id)) {
    push(issues, 'receipt_id', 'must be a non-empty string when present')
  }
  if (response.rejection_reason !== undefined && !isNonEmptyString(response.rejection_reason)) {
    push(issues, 'rejection_reason', 'must be a non-empty string when present')
  }
  if (
    response.warnings !== undefined &&
    (!Array.isArray(response.warnings) ||
      response.warnings.some((warning) => !isNonEmptyString(warning)))
  ) {
    push(issues, 'warnings', 'must contain only non-empty strings')
  }
  if (response.status === 'rejected' && !isNonEmptyString(response.rejection_reason)) {
    push(issues, 'rejection_reason', 'rejected responses must describe the reason')
  }
  if (response.status === 'accepted' && !isNonEmptyString(response.record_hash)) {
    push(issues, 'record_hash', 'accepted responses must include the signed record hash')
  }
  if (
    response.status === 'accepted' &&
    response.operation === 'enqueue_record_and_join_receipt' &&
    !isNonEmptyString(response.receipt_id)
  ) {
    push(issues, 'receipt_id', 'accepted WAL join responses must include a receipt id')
  }
  if (response.health_report !== undefined) {
    const healthResult = validateLocalSubstrateHealthReport(response.health_report)
    for (const issue of healthResult.issues) {
      push(issues, `health_report.${issue.path}`, issue.message)
    }
  }

  return { ok: issues.length === 0, issues }
}

function elapsedMs(startedAt: number, now: () => number): number {
  return Math.max(0, now() - startedAt)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function createLocalSubstrateNoopSubmissionQueue(): SubmissionQueue {
  return {
    submit() {},
    getProof() {
      return undefined
    },
    async flush() {},
  }
}

function valueOf<T>(value: LocalSubstrateHealthValue<T> | undefined): T | undefined {
  return typeof value === 'function' ? (value as () => T)() : value
}

function recordHashRef(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function rejectedLocalSubstrateResponse(
  request: LocalSubstrateCoordinatorRequest,
  rejectionReason: string,
  healthReport: LocalSubstrateHealthReport,
): LocalSubstrateCoordinatorResponse {
  return {
    schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
    operation: request.operation,
    status: 'rejected',
    rejection_reason: rejectionReason,
    health_report: healthReport,
  }
}

function localSubstrateHttpPaths(options: LocalSubstrateCoordinatorHttpOptions = {}): {
  endpointPath: string
  healthPath: string
} {
  return {
    endpointPath: options.endpointPath ?? LOCAL_SUBSTRATE_HTTP_DEFAULT_PATH,
    healthPath: options.healthPath ?? LOCAL_SUBSTRATE_HTTP_DEFAULT_HEALTH_PATH,
  }
}

function jsonHttpResult(
  status: number,
  body: unknown,
  options: { head?: boolean; headers?: Record<string, string> } = {},
): LocalSubstrateCoordinatorHttpResult {
  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.head ? '' : JSON.stringify(body),
  }
}

function methodNotAllowed(allow: string): LocalSubstrateCoordinatorHttpResult {
  return {
    status: 405,
    headers: {
      Allow: allow,
      'Content-Type': 'text/plain',
    },
    body: 'Method Not Allowed',
  }
}

async function callWithTimeout(
  transport: LocalSubstrateCoordinatorTransport,
  request: LocalSubstrateCoordinatorRequest,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`local substrate coordinator timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        ;(timer as { unref: () => void }).unref()
      }
    })
    return await Promise.race([
      transport(request, { timeoutMs, signal: controller.signal }),
      timeout,
    ])
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

export async function tryLocalSubstrateCoordinator(
  request: LocalSubstrateCoordinatorRequest,
  options: TryLocalSubstrateCoordinatorOptions,
): Promise<TryLocalSubstrateCoordinatorResult> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const requestValidation = validateLocalSubstrateRequest(request, {
    ...(options.expectedHarnessClass !== undefined
      ? { expectedHarnessClass: options.expectedHarnessClass }
      : {}),
    ...(options.directRecordBody !== undefined
      ? { directRecordBody: options.directRecordBody }
      : {}),
  })
  if (!requestValidation.ok) {
    return {
      ok: false,
      status: 'invalid_request',
      issues: requestValidation.issues,
      elapsed_ms: elapsedMs(startedAt, now),
    }
  }

  const timeoutMs = Math.max(1, options.timeoutMs ?? LOCAL_SUBSTRATE_DEFAULT_TIMEOUT_MS)
  let rawResponse: unknown
  try {
    rawResponse = await callWithTimeout(options.transport, request, timeoutMs)
  } catch (error) {
    return {
      ok: false,
      status: 'unavailable',
      reason: errorMessage(error),
      elapsed_ms: elapsedMs(startedAt, now),
    }
  }

  const responseValidation = validateLocalSubstrateResponse(rawResponse, { request })
  if (!responseValidation.ok) {
    return {
      ok: false,
      status: 'invalid_response',
      issues: responseValidation.issues,
      raw_response: rawResponse,
      elapsed_ms: elapsedMs(startedAt, now),
    }
  }

  const response = rawResponse as LocalSubstrateCoordinatorResponse
  if (response.status === 'accepted') {
    return {
      ok: true,
      status: 'accepted',
      response,
      elapsed_ms: elapsedMs(startedAt, now),
    }
  }

  return {
    ok: false,
    status: 'rejected',
    response,
    ...(response.rejection_reason !== undefined ? { reason: response.rejection_reason } : {}),
    elapsed_ms: elapsedMs(startedAt, now),
  }
}

export function createHttpLocalSubstrateTransport(
  endpoint: string,
  options: CreateHttpLocalSubstrateTransportOptions = {},
): LocalSubstrateCoordinatorTransport {
  return async (request, transportOptions) => {
    const fetchImpl = options.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch is unavailable for local substrate HTTP transport')
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(request),
      ...(transportOptions.signal !== undefined ? { signal: transportOptions.signal } : {}),
    })
    if (!response.ok) {
      throw new Error(`local substrate coordinator returned HTTP ${response.status}`)
    }
    return response.json()
  }
}

export async function handleLocalSubstrateCoordinatorHttpRequest(
  coordinator: LocalSubstrateCoordinatorService,
  method: string,
  pathname: string,
  body?: unknown,
  options: LocalSubstrateCoordinatorHttpOptions = {},
): Promise<LocalSubstrateCoordinatorHttpResult | null> {
  const { endpointPath, healthPath } = localSubstrateHttpPaths(options)
  const isHead = method === 'HEAD'

  if (pathname === healthPath || (pathname === endpointPath && (method === 'GET' || isHead))) {
    if (method !== 'GET' && !isHead) {
      return methodNotAllowed('GET, HEAD')
    }
    return jsonHttpResult(200, coordinator.health(), { head: isHead })
  }

  if (pathname !== endpointPath) {
    return null
  }

  if (method !== 'POST') {
    return methodNotAllowed('GET, HEAD, POST')
  }

  const requestValidation = validateLocalSubstrateRequest(body)
  if (!requestValidation.ok) {
    return jsonHttpResult(400, {
      error: 'invalid_request',
      issues: requestValidation.issues,
    })
  }

  const request = body as LocalSubstrateCoordinatorRequest
  let rawResponse: unknown
  try {
    rawResponse = await coordinator.transport(request, {
      timeoutMs: Math.max(1, options.timeoutMs ?? LOCAL_SUBSTRATE_DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    return jsonHttpResult(503, {
      error: 'unavailable',
      reason: errorMessage(error),
      health_report: coordinator.health().report,
    })
  }

  const responseValidation = validateLocalSubstrateResponse(rawResponse, { request })
  if (!responseValidation.ok) {
    return jsonHttpResult(502, {
      error: 'invalid_response',
      issues: responseValidation.issues,
      health_report: coordinator.health().report,
    })
  }

  return jsonHttpResult(200, rawResponse)
}

export function createLocalSubstrateCoordinatorHttpHandler(
  coordinator: LocalSubstrateCoordinatorService,
  options: LocalSubstrateCoordinatorHttpOptions = {},
): (request: Request) => Promise<Response | null> {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url)
    const { endpointPath } = localSubstrateHttpPaths(options)
    let body: unknown

    if (request.method === 'POST' && url.pathname === endpointPath) {
      try {
        body = await request.json()
      } catch {
        return new Response(
          JSON.stringify({
            error: 'invalid_json',
            message: 'request body must be JSON',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }
    }

    const result = await handleLocalSubstrateCoordinatorHttpRequest(
      coordinator,
      request.method,
      url.pathname,
      body,
      options,
    )

    if (!result) return null

    return new Response(request.method === 'HEAD' ? null : result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
}

export function buildLocalSubstrateHealthReport(
  input: BuildLocalSubstrateHealthReportInput,
): LocalSubstrateHealthReport {
  const activeContexts = [...new Set(input.activeContextIds ?? [])].sort()
  const activeContextSample = activeContexts.slice(0, LOCAL_SUBSTRATE_HEALTH_ACTIVE_CONTEXT_LIMIT)
  const activeContextTruncated = activeContexts.length > activeContextSample.length
  const activeWrappers = input.activeWrappers ?? input.activeWrapperPids?.length
  const staleChildren = input.staleChildren ?? input.staleChildPids?.length ?? 0

  return {
    schema: LOCAL_SUBSTRATE_HEALTH_SCHEMA,
    coordinator: {
      pid: input.coordinator.pid,
      version: input.coordinator.version,
      transport: input.coordinator.transport,
      ...(input.coordinator.creatorKeyScope !== undefined
        ? { creator_key_scope: input.coordinator.creatorKeyScope }
        : {}),
    },
    queues: {
      log_submission_depth: input.queues?.logSubmissionDepth ?? 0,
      ...(input.queues?.archiveSubmissionDepth !== undefined
        ? { archive_submission_depth: input.queues.archiveSubmissionDepth }
        : {}),
    },
    wal: {
      pending: input.wal?.pending ?? 0,
      ...(input.wal?.joined !== undefined ? { joined: input.wal.joined } : {}),
      orphan_receipts: input.wal?.orphanReceipts ?? 0,
    },
    contexts: {
      active: activeContextSample,
      active_count: activeContexts.length,
      ...(activeContextTruncated ? { active_truncated: true } : {}),
    },
    processes: {
      ...(activeWrappers !== undefined ? { active_wrappers: activeWrappers } : {}),
      stale_children: staleChildren,
    },
  }
}

export function probeLocalSubstrateHealth(
  input: BuildLocalSubstrateHealthReportInput,
): LocalSubstrateHealthProbeResult {
  const report = buildLocalSubstrateHealthReport(input)
  const validation = validateLocalSubstrateHealthReport(report)
  const warnings: string[] = []

  if (validation.ok) {
    if (report.processes.stale_children > 0) {
      warnings.push(`stale child process count is ${report.processes.stale_children}`)
    }
    if (report.wal.orphan_receipts > 0) {
      warnings.push(`orphan receipt count is ${report.wal.orphan_receipts}`)
    }
  }

  const status = !validation.ok ? 'invalid' : warnings.length > 0 ? 'degraded' : 'healthy'

  return {
    ok: validation.ok && warnings.length === 0,
    status,
    report,
    issues: validation.issues,
    warnings,
  }
}

export function createInProcessLocalSubstrateCoordinator(
  options: CreateInProcessLocalSubstrateCoordinatorOptions,
): InProcessLocalSubstrateCoordinator {
  const privateKey = base64urlDecode(options.creatorKey)
  if (privateKey.length !== 32) {
    throw new Error('local substrate coordinator creatorKey must decode to 32 bytes')
  }

  const supportedHarnessClasses = new Set<LocalSubstrateHarnessClass>(
    options.supportedHarnessClasses ?? ['startup-spawn'],
  )
  const activeContexts = new Set<string>()
  const queue: SubmissionQueue =
    options.logSubmission === 'disabled'
      ? createLocalSubstrateNoopSubmissionQueue()
      : createSubmissionQueue(options.logEndpoint, {
          ...(options.maxQueueDepth !== undefined ? { maxQueueDepth: options.maxQueueDepth } : {}),
          ...(options.archiveSubmission !== undefined
            ? { archiveSubmission: options.archiveSubmission }
            : {}),
        })
  const publicKeyReady = getPublicKey(new Uint8Array(privateKey)).then(base64urlEncode)
  let destroyed = false

  const health = (): LocalSubstrateHealthProbeResult => {
    const healthOptions = options.health ?? {}
    const archiveSubmissionDepth = valueOf(healthOptions.archiveSubmissionDepth)
    const walJoined = valueOf(healthOptions.walJoined)
    const activeWrapperPids = valueOf(healthOptions.activeWrapperPids)
    const staleChildPids = valueOf(healthOptions.staleChildPids)
    const activeWrappers = valueOf(healthOptions.activeWrappers)
    const staleChildren = valueOf(healthOptions.staleChildren)

    return probeLocalSubstrateHealth({
      coordinator: {
        pid: healthOptions.pid ?? 0,
        version: healthOptions.version ?? '0.0.0-in-process',
        transport: healthOptions.transport ?? 'in-process',
        ...(healthOptions.creatorKeyScope !== undefined
          ? { creatorKeyScope: healthOptions.creatorKeyScope }
          : {}),
      },
      queues: {
        logSubmissionDepth: valueOf(healthOptions.logSubmissionDepth) ?? 0,
        ...(archiveSubmissionDepth !== undefined ? { archiveSubmissionDepth } : {}),
      },
      wal: {
        pending: valueOf(healthOptions.walPending) ?? 0,
        ...(walJoined !== undefined ? { joined: walJoined } : {}),
        orphanReceipts: valueOf(healthOptions.walOrphanReceipts) ?? 0,
      },
      activeContextIds: valueOf(healthOptions.activeContextIds) ?? [...activeContexts],
      ...(activeWrapperPids !== undefined ? { activeWrapperPids } : {}),
      ...(staleChildPids !== undefined ? { staleChildPids } : {}),
      ...(activeWrappers !== undefined ? { activeWrappers } : {}),
      ...(staleChildren !== undefined ? { staleChildren } : {}),
    })
  }

  const transport: LocalSubstrateCoordinatorTransport = async (request, transportOptions) => {
    if (transportOptions.signal?.aborted) {
      throw new Error('local substrate coordinator call aborted')
    }

    const requestValidation = validateLocalSubstrateRequest(request)
    if (!requestValidation.ok) {
      throw new Error(
        `invalid local substrate coordinator request: ${requestValidation.issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join('; ')}`,
      )
    }

    const healthReport = health().report
    if (destroyed) {
      return rejectedLocalSubstrateResponse(request, 'coordinator destroyed', healthReport)
    }

    if (!supportedHarnessClasses.has(request.producer.harness_class)) {
      return rejectedLocalSubstrateResponse(
        request,
        `unsupported harness class: ${request.producer.harness_class}`,
        healthReport,
      )
    }

    if (!inProcessSupportedOperations.has(request.operation)) {
      return rejectedLocalSubstrateResponse(
        request,
        `unsupported operation for in-process coordinator: ${request.operation}`,
        healthReport,
      )
    }

    const publicKeyB64 = await publicKeyReady
    if (transportOptions.signal?.aborted) {
      throw new Error('local substrate coordinator call aborted')
    }
    if (destroyed) {
      return rejectedLocalSubstrateResponse(request, 'coordinator destroyed', health().report)
    }
    if (request.record_body.creator_key !== publicKeyB64) {
      return rejectedLocalSubstrateResponse(
        request,
        'record_body.creator_key does not match coordinator signer',
        health().report,
      )
    }

    const unsigned = { ...request.record_body, signature: '' } as AtribRecord
    const signed = await signRecord(unsigned, privateKey)
    const recordHash = recordHashRef(signed)
    const receiptId = encodeToken(signed)
    activeContexts.add(request.record_body.context_id)

    const shadowProbe = request.mode === 'shadow_probe'

    if (!shadowProbe && options.onRecord) {
      try {
        const observed = options.onRecord(signed, {
          request,
          record_hash: recordHash,
          receipt_id: receiptId,
        })
        void Promise.resolve(observed).catch(() => undefined)
      } catch {
        // §5.8: observer failures never affect coordinator responses.
      }
    }

    if (!shadowProbe) {
      try {
        queue.submit(signed, signed.event_type === EVENT_TYPE_TRANSACTION_URI ? 'high' : 'normal')
      } catch {
        // §5.8: queue failures never affect coordinator responses.
      }
    }

    return {
      schema: LOCAL_SUBSTRATE_RESPONSE_SCHEMA,
      operation: request.operation,
      status: 'accepted',
      record_hash: recordHash,
      receipt_id: receiptId,
      health_report: health().report,
    } satisfies LocalSubstrateCoordinatorResponse
  }

  return {
    transport,
    health,
    flush: () => queue.flush(),
    getProof: (recordHash) => queue.getProof(recordHash.replace(/^sha256:/, '')),
    destroy: () => {
      if (!destroyed) {
        zeroize(privateKey)
        destroyed = true
      }
    },
  }
}

export function validateLocalSubstrateFixture(
  fixture: unknown,
  options: ValidateLocalSubstrateFixtureOptions = {},
): LocalSubstrateValidationResult {
  const issues: LocalSubstrateValidationIssue[] = []

  if (!isObject(fixture)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'fixture must be an object' }],
    }
  }

  if (options.expectedName !== undefined && fixture.name !== options.expectedName) {
    push(issues, 'name', 'must match manifest case name')
  }
  if (typeof fixture.harness_class !== 'string' || !harnessClasses.has(fixture.harness_class)) {
    push(issues, 'harness_class', `must be one of ${LOCAL_SUBSTRATE_HARNESS_CLASSES.join(', ')}`)
  }
  if (
    options.expectedHarnessClass !== undefined &&
    fixture.harness_class !== options.expectedHarnessClass
  ) {
    push(issues, 'harness_class', 'must match expected harness class')
  }

  const input = isObject(fixture.input) ? fixture.input : undefined
  if (input === undefined) {
    push(issues, 'input', 'must be an object')
  } else {
    if (!isObject(input.coordinator_request)) {
      push(issues, 'input.coordinator_request', 'must be an object')
    }

    const directBodyIssues: LocalSubstrateValidationIssue[] = []
    const directBodyValid = validateUnsignedRecordBody(
      input.direct_record_body,
      'input.direct_record_body',
      directBodyIssues,
    )
    for (const issue of directBodyIssues) {
      push(issues, issue.path, issue.message)
    }

    const requestOptions: ValidateLocalSubstrateRequestOptions = {
      expectedHarnessClass: fixture.harness_class as LocalSubstrateHarnessClass,
    }
    if (directBodyValid) {
      requestOptions.directRecordBody = input.direct_record_body as UnsignedAtribRecord
    }

    const requestResult = validateLocalSubstrateRequest(input.coordinator_request, requestOptions)
    for (const issue of requestResult.issues) {
      push(issues, `input.coordinator_request.${issue.path}`, issue.message)
    }

    const healthResult = validateLocalSubstrateHealthReport(input.health_report)
    for (const issue of healthResult.issues) {
      push(issues, `input.health_report.${issue.path}`, issue.message)
    }
  }

  const expected = isObject(fixture.expected) ? fixture.expected : undefined
  if (expected === undefined) {
    push(issues, 'expected', 'must be an object')
  } else {
    if (expected.record_bytes_unchanged !== true) {
      push(issues, 'expected.record_bytes_unchanged', 'must be true')
    }
    if (expected.fallback_required !== true) {
      push(issues, 'expected.fallback_required', 'must be true')
    }
    const recordBody = input?.coordinator_request
    if (isObject(recordBody) && isObject(recordBody.record_body)) {
      const actual = hashLocalSubstrateRecordBody(recordBody.record_body as UnsignedAtribRecord)
      if (expected.canonical_record_body_sha256 !== actual) {
        push(issues, 'expected.canonical_record_body_sha256', `must be ${actual}`)
      }
    }
  }

  return { ok: issues.length === 0, issues }
}
