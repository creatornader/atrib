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
import { hexEncode, sha256 } from './hash.js'
import type { UnsignedAtribRecord } from './types.js'

export const LOCAL_SUBSTRATE_REQUEST_SCHEMA = 'atrib.local-substrate-coordinator.request.v0'
export const LOCAL_SUBSTRATE_HEALTH_SCHEMA = 'atrib.local-substrate-coordinator.health.v0'

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
  }
  processes: {
    active_wrappers?: number
    stale_children: number
  }
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
